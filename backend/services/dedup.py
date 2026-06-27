"""
Perceptual hash computation and duplicate detection.
Uses imagehash pHash via Pillow. Background thread pattern mirrors ai_tagger.py.

Key design notes
----------------
* _hash_file:      uses `with` to guarantee file handles are closed, even on error.
* _compute_hashes_thread: processes images in ID-batches of HASH_BATCH to keep RAM
  bounded; expires the SQLAlchemy identity map between batches; sleeps 2 ms per image
  so the CPU isn't fully pegged and the FastAPI server stays responsive.
* get_duplicate_groups: pre-converts hex hashes to uint64 integers and uses numpy byte-
  level popcount for the O(n²) hamming pass — ~50–100× faster than pure Python.
  Runs in a background thread; result is cached in _search_state so GET /groups
  returns immediately from cache and does not block the server.
"""
import threading
import logging
import os
import time
import json

logger = logging.getLogger(__name__)

# ── Hash-build state ──────────────────────────────────────────────────────────

_lock = threading.Lock()
_state: dict = {
    "running":   False,
    "progress":  0,
    "total":     0,
    "hashed":    0,
    "errors":    0,
    "message":   "Idle",
    "cancelled": False,
}


def get_state() -> dict:
    with _lock:
        return dict(_state)

def _set(**kwargs):
    with _lock:
        _state.update(kwargs)

def cancel():
    _set(cancelled=True)

def _is_cancelled() -> bool:
    with _lock:
        return _state["cancelled"]


# ── Duplicate-search state ─────────────────────────────────────────────────────

_search_lock = threading.Lock()
_search_state: dict = {
    "running":   False,
    "groups":    None,    # cached result list, or None
    "threshold": None,    # threshold the cached result was computed with
    "message":   "Not yet searched",
}


def get_search_state() -> dict:
    with _search_lock:
        return dict(_search_state)

def _set_search(**kwargs):
    with _search_lock:
        _search_state.update(kwargs)

def clear_search_cache():
    """Invalidate the cached duplicate-group result.
    Call after bulk image deletion so the next /groups request triggers a fresh search."""
    _set_search(groups=None, threshold=None, message="Cache cleared — run search again")


# ── Permanent ignore ("Keep Both") ───────────────────────────────────────────
# Stored as a JSON file next to vault.db so it survives restarts.
# Each entry is a sorted list of image IDs that form an intentional group
# (e.g. original + upscale). Groups matching any entry are hidden forever.

def _ignored_file() -> str:
    from database import DB_PATH
    return os.path.join(os.path.dirname(DB_PATH), 'dedup_ignored.json')

def _load_ignored() -> list:
    """Return list of frozensets of image IDs that are permanently ignored."""
    try:
        path = _ignored_file()
        if os.path.isfile(path):
            with open(path, 'r', encoding='utf-8') as f:
                return [frozenset(g) for g in json.load(f)]
    except Exception:
        pass
    return []

def _save_ignored(groups: list) -> None:
    try:
        path = _ignored_file()
        with open(path, 'w', encoding='utf-8') as f:
            json.dump([sorted(g) for g in groups], f)
    except Exception:
        pass

def ignore_group_permanent(image_ids: list) -> int:
    """Permanently mark a group as 'Keep Both'. Returns total ignored count.
    NEVER deletes any files — only adds to the ignore list."""
    if len(image_ids) < 2:
        return 0
    groups = _load_ignored()
    key = frozenset(image_ids)
    if key not in groups:
        groups.append(key)
        _save_ignored(groups)
    return len(groups)

def clear_ignored_permanent() -> None:
    """Clear all permanently ignored groups."""
    try:
        os.unlink(_ignored_file())
    except Exception:
        pass

def get_ignored_count() -> int:
    return len(_load_ignored())


# ── Perceptual hash ────────────────────────────────────────────────────────────

def _hash_file(file_path: str):
    """Return hex pHash string, or None on failure.
    Uses a `with` block so the underlying file handle is always closed."""
    try:
        import imagehash
        from PIL import Image as PILImage
        with PILImage.open(file_path) as raw:
            rgb = raw.convert("RGB")
        return str(imagehash.phash(rgb))
    except Exception as e:
        logger.debug("pHash failed for %s: %s", file_path, e)
        return None


def _hamming(h1: str, h2: str) -> int:
    """Hamming distance between two hex hash strings (pure Python fallback)."""
    return bin(int(h1, 16) ^ int(h2, 16)).count('1')


# ── numpy-accelerated hamming ─────────────────────────────────────────────────

def _build_popcount_table():
    import numpy as np
    tbl = np.zeros(256, dtype=np.uint8)
    for i in range(256):
        tbl[i] = bin(i).count('1')
    return tbl

_POPCOUNT_TABLE = None

def _hamming_vec(scalar_int: int, arr):
    """Return 1-D array of Hamming distances between scalar_int and each element
    of arr (numpy uint64 array). Uses byte-level popcount lookup table."""
    import numpy as np
    global _POPCOUNT_TABLE
    if _POPCOUNT_TABLE is None:
        _POPCOUNT_TABLE = _build_popcount_table()
    xor = (scalar_int ^ arr).view(np.uint8).reshape(-1, 8)
    return _POPCOUNT_TABLE[xor].sum(axis=1).astype(np.int32)


# ── Background hash computation ───────────────────────────────────────────────

HASH_BATCH = 200   # images loaded per DB round-trip (keeps RAM bounded)
HASH_SLEEP = 0.002  # seconds between images (~500 imgs/sec max, ~20% CPU)

def _compute_hashes_thread(db_factory):
    from models import Image as ImageModel
    from sqlalchemy import func
    db = db_factory()
    try:
        # Clear stale "failed" sentinels so they are retried this run
        db.query(ImageModel).filter(
            ImageModel.perceptual_hash == "failed",
            ImageModel.is_video == False
        ).update({"perceptual_hash": None})
        db.commit()

        total = (
            db.query(func.count(ImageModel.id))
            .filter(ImageModel.perceptual_hash == None,   # noqa: E711
                    ImageModel.is_video == False)
            .scalar() or 0
        )
        _set(running=True, progress=0, total=total, hashed=0, errors=0,
             message=f"Found {total} images to hash…", cancelled=False)

        if total == 0:
            _set(running=False, message="All images already hashed.")
            return

        hashed = errors = processed = 0

        while True:
            if _is_cancelled():
                db.commit()
                _set(running=False, message=f"Cancelled — {hashed} hashed.")
                return

            # Load only the next batch of un-hashed images
            batch = (
                db.query(ImageModel)
                .filter(ImageModel.perceptual_hash == None,   # noqa: E711
                        ImageModel.is_video == False)
                .limit(HASH_BATCH)
                .all()
            )
            if not batch:
                break

            for img in batch:
                if _is_cancelled():
                    db.commit()
                    _set(running=False, message=f"Cancelled — {hashed} hashed.")
                    return

                processed += 1

                if not img.file_path or not os.path.isfile(img.file_path):
                    img.perceptual_hash = "failed"
                    errors += 1
                    _set(progress=processed, errors=errors)
                else:
                    h = _hash_file(img.file_path)
                    if h:
                        img.perceptual_hash = h
                        hashed += 1
                    else:
                        img.perceptual_hash = "failed"
                        errors += 1

                _set(progress=processed, hashed=hashed, errors=errors,
                     message=f"Hashing {img.filename}…")

                time.sleep(HASH_SLEEP)

            # Commit after every batch and expire identity map to free RAM
            db.commit()
            db.expire_all()

        _set(running=False, message=f"Done — {hashed} hashed, {errors} errors.")

        # Invalidate any cached search result so next search uses fresh hashes
        _set_search(groups=None, threshold=None,
                    message="Index updated — run a new search to see results.")

    except Exception as e:
        logger.exception("Hash computation failed")
        try:
            db.commit()   # save whatever was accumulated before the crash
        except Exception:
            pass
        _set(running=False, message=f"Error: {e}")
    finally:
        db.close()


def start_compute_hashes(db_factory):
    if get_state()["running"]:
        raise ValueError("Hash computation already running")
    t = threading.Thread(target=_compute_hashes_thread, args=(db_factory,), daemon=True)
    t.start()


# ── Background duplicate search ───────────────────────────────────────────────

def start_search(db_factory, threshold: int):
    """Start a background duplicate search unless one is already running or
    the cache already holds a result for this threshold."""
    with _search_lock:
        if _search_state["running"]:
            return   # already running
        if (_search_state["threshold"] == threshold and
                _search_state["groups"] is not None):
            return   # cache valid
        _search_state["running"] = True
        _search_state["message"] = "Searching for duplicates…"
    t = threading.Thread(target=_search_thread, args=(db_factory, threshold), daemon=True)
    t.start()


def _search_thread(db_factory, threshold: int):
    db = db_factory()
    try:
        groups = _compute_duplicate_groups(db, threshold)
        _set_search(running=False, groups=groups, threshold=threshold,
                    message=f"Found {len(groups)} duplicate group(s)")
    except Exception as e:
        logger.exception("Duplicate search failed")
        # Set groups=[] and threshold so get_duplicate_groups returns the error
        # message instead of restarting the search on every subsequent poll
        _set_search(running=False, groups=[], threshold=threshold,
                    message=f"Search error: {e}")
    finally:
        db.close()


# ── Duplicate group computation ───────────────────────────────────────────────

def _compute_duplicate_groups(db, threshold: int) -> list:
    """
    Find duplicate clusters across all hashed images.

    Algorithm selection
    -------------------
    threshold == 0
        O(n) exact-match via a plain dict.

    threshold 1–7  AND  n > 2 000   →  multi-index hashing  (default path)
        Split the 64-bit hash into k = threshold+1 blocks that together cover
        all 64 bits.  By pigeonhole, if HD(a,b) ≤ threshold and we have k > t
        blocks, at least one block must be identical.  We index every image
        under each of its block values and, for each image, only run a full
        Hamming comparison against images that share any block.
        Complexity: O(n · avg_candidates) — roughly 8 000× faster than O(n²)
        for a 266k-image library at threshold=3.

    everything else  →  vectorised numpy O(n²)
        Best for small n or very high thresholds where block sizes would be
        too small to discriminate.  Reports live progress so the UI stays
        responsive during long runs.
    """
    from models import Image as ImageModel, Gallery as GalleryModel
    from sqlalchemy.orm import selectinload
    from collections import defaultdict

    images = (
        db.query(ImageModel)
        .options(selectinload(ImageModel.gallery).selectinload(GalleryModel.creator))
        .filter(ImageModel.perceptual_hash != None,   # noqa: E711
                ImageModel.perceptual_hash != "failed",
                ImageModel.is_video == False)
        .all()
    )
    if not images:
        return []

    n = len(images)
    parent = list(range(n))

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(x, y):
        parent[find(x)] = find(y)

    if threshold == 0:
        # ── Exact-match O(n) ──────────────────────────────────────────────────
        h2i: dict = defaultdict(list)
        for i, img in enumerate(images):
            h2i[img.perceptual_hash].append(i)
        for indices in h2i.values():
            for a in range(len(indices)):
                for b in range(a + 1, len(indices)):
                    union(indices[a], indices[b])

    elif n > 2_000 and (64 // (threshold + 1)) >= 8:
        # ── Multi-index hashing ───────────────────────────────────────────────
        # k blocks that together partition all 64 bits.
        # Blocks 0..k-2 are base_bits wide; block k-1 takes the remainder so
        # every bit of the hash is covered.
        k         = threshold + 1
        base_bits = 64 // k
        block_widths = [base_bits] * (k - 1) + [64 - (k - 1) * base_bits]
        block_starts = [sum(block_widths[:b]) for b in range(k)]
        block_masks  = [(1 << w) - 1 for w in block_widths]

        tables: list = [defaultdict(list) for _ in range(k)]
        hash_ints: list = []
        for i, img in enumerate(images):
            h = int(img.perceptual_hash, 16)
            hash_ints.append(h)
            for b in range(k):
                bv = (h >> block_starts[b]) & block_masks[b]
                tables[b][bv].append(i)

        for i, h_i in enumerate(hash_ints):
            if i % 20_000 == 0 and i > 0:
                _set_search(message=f"Searching… {round(i / n * 100)}%")
            for b in range(k):
                bv = (h_i >> block_starts[b]) & block_masks[b]
                for j in tables[b][bv]:
                    if j <= i:
                        continue
                    # union() is idempotent so duplicate pair visits are fine
                    if bin(h_i ^ hash_ints[j]).count('1') <= threshold:
                        union(i, j)

    else:
        # ── Numpy vectorised O(n²) ─────────────────────────────────────────────
        # Still the best option for small n or high thresholds (blocks < 8 bits).
        # Progress updates every 1 000 rows keep the UI spinning correctly.
        try:
            import numpy as np
            hash_ints_np = np.array(
                [int(img.perceptual_hash, 16) for img in images],
                dtype=np.uint64
            )
            for i in range(n):
                if i % 1_000 == 0:
                    _set_search(message=f"Searching… {round(i / n * 100)}%")
                if i + 1 >= n:
                    break
                dists = _hamming_vec(int(hash_ints_np[i]), hash_ints_np[i + 1:])
                for offset in np.where(dists <= threshold)[0]:
                    union(i, int(offset) + i + 1)
        except Exception:
            # Pure Python fallback
            for i in range(n):
                if i % 500 == 0:
                    _set_search(message=f"Searching… {round(i / n * 100)}%")
                hi = images[i].perceptual_hash
                for j in range(i + 1, n):
                    if _hamming(hi, images[j].perceptual_hash) <= threshold:
                        union(i, j)

    clusters: dict = defaultdict(list)
    for i, img in enumerate(images):
        clusters[find(i)].append(img)

    groups = []
    for cluster in clusters.values():
        if len(cluster) < 2:
            continue

        hashes = [img.perceptual_hash for img in cluster]
        distances = []
        for i in range(len(hashes)):
            for j in range(i + 1, len(hashes)):
                distances.append(_hamming(hashes[i], hashes[j]))
        avg_dist = sum(distances) / len(distances) if distances else 0
        similarity = round(1.0 - avg_dist / 64.0, 3)

        group_imgs = []
        for img in cluster:
            gallery  = img.gallery
            creator  = gallery.creator if gallery else None
            group_imgs.append({
                "id":             img.id,
                "filename":       img.filename,
                "file_path":      img.file_path,
                "thumb_path":     img.thumb_path,
                "file_size":      img.file_size,
                "width":          img.width,
                "height":         img.height,
                "gallery_id":     img.gallery_id,
                "gallery_name":   gallery.name    if gallery  else None,
                "creator_id":     creator.id       if creator  else None,
                "creator_name":   creator.name     if creator  else None,
                "cum_count":      img.cum_count,
                "rating":         img.rating,
                "perceptual_hash": img.perceptual_hash,
            })

        groups.append({
            "images":     group_imgs,
            "similarity": similarity,
            "count":      len(group_imgs),
        })

    groups.sort(key=lambda g: g["similarity"], reverse=True)
    return groups


# ── Public query helpers ───────────────────────────────────────────────────────

def get_duplicate_groups(db_factory, threshold: int) -> dict:
    """Non-blocking entry point. Returns cached result immediately, or
    triggers a background search and returns {computing: True, groups: []}."""
    state = get_search_state()
    if state["threshold"] == threshold and state["groups"] is not None:
        groups = state["groups"]
        # Filter out permanently ignored groups ("Keep Both") without touching the cache
        ignored = _load_ignored()
        if ignored:
            groups = [
                g for g in groups
                if frozenset(img["id"] for img in g["images"]) not in ignored
            ]
        return {"computing": False, "groups": groups, "message": state["message"]}
    start_search(db_factory, threshold)
    return {"computing": True, "groups": [], "message": state["message"]}


def get_image_duplicates(db, image_id: int, threshold: int = 10) -> list:
    """Return duplicate matches for a single image. Used by viewer sidebar."""
    from models import Image as ImageModel
    from sqlalchemy.orm import selectinload

    img = db.query(ImageModel).filter(ImageModel.id == image_id).first()
    if not img or not img.perceptual_hash or img.is_video:
        return []

    candidates = (
        db.query(ImageModel)
        .options(selectinload(ImageModel.gallery))
        .filter(ImageModel.perceptual_hash != None,   # noqa: E711
                ImageModel.id != image_id,
                ImageModel.is_video == False)
        .all()
    )

    matches = []
    for c in candidates:
        dist = _hamming(img.perceptual_hash, c.perceptual_hash)
        if dist <= threshold:
            matches.append({
                "id":           c.id,
                "filename":     c.filename,
                "gallery_id":   c.gallery_id,
                "gallery_name": c.gallery.name if c.gallery else None,
                "similarity":   round(1.0 - dist / 64.0, 3),
                "file_size":    c.file_size,
            })

    matches.sort(key=lambda m: m["similarity"], reverse=True)
    return matches


def get_hash_stats(db) -> dict:
    """Quick stats for the dedup page header."""
    from models import Image as ImageModel
    from sqlalchemy import func

    total   = db.query(func.count(ImageModel.id)).filter(ImageModel.is_video == False).scalar() or 0
    hashed  = db.query(func.count(ImageModel.id)).filter(
        ImageModel.is_video == False,
        ImageModel.perceptual_hash != None   # noqa: E711
    ).scalar() or 0
    return {"total": total, "hashed": hashed}


def get_gallery_overlaps(db_factory, threshold: int) -> dict:
    """
    Aggregate cached duplicate groups into gallery-pair overlaps.
    Returns immediately from cache; returns {computing: True} if groups not ready.
    """
    from collections import defaultdict

    state = get_search_state()
    if state["threshold"] != threshold or state["groups"] is None:
        return {"computing": True, "pairs": []}

    groups = state["groups"]
    ignored = _load_ignored()
    if ignored:
        groups = [g for g in groups if frozenset(img["id"] for img in g["images"]) not in ignored]

    pair_map = defaultdict(lambda: {"a_img_map": {}, "b_img_map": {}})

    for group in groups:
        by_gallery = defaultdict(list)
        for img in group["images"]:
            gid = img.get("gallery_id")
            if gid is not None:
                by_gallery[gid].append(img)

        gallery_ids = sorted(by_gallery.keys())
        if len(gallery_ids) < 2:
            continue

        for i in range(len(gallery_ids)):
            for j in range(i + 1, len(gallery_ids)):
                gid_a, gid_b = gallery_ids[i], gallery_ids[j]
                key = (gid_a, gid_b)
                for img in by_gallery[gid_a]:
                    pair_map[key]["a_img_map"][img["id"]] = img
                for img in by_gallery[gid_b]:
                    pair_map[key]["b_img_map"][img["id"]] = img

    if not pair_map:
        return {"computing": False, "pairs": []}

    all_gallery_ids = set()
    for gid_a, gid_b in pair_map:
        all_gallery_ids.add(gid_a)
        all_gallery_ids.add(gid_b)

    db = db_factory()
    try:
        from models import Gallery as GalleryModel, Image as ImageModel
        from sqlalchemy import func

        galleries = {
            g.id: g
            for g in db.query(GalleryModel)
            .filter(GalleryModel.id.in_(all_gallery_ids))
            .all()
        }

        counts = dict(
            db.query(ImageModel.gallery_id, func.count(ImageModel.id))
            .filter(
                ImageModel.gallery_id.in_(all_gallery_ids),
                ImageModel.is_video == False,
            )
            .group_by(ImageModel.gallery_id)
            .all()
        )

        pairs = []
        for (gid_a, gid_b), data in pair_map.items():
            ga = galleries.get(gid_a)
            gb = galleries.get(gid_b)
            if not ga or not gb:
                continue

            creator_a = ga.creator
            creator_b = gb.creator

            def _sort_key(img):
                return -((img.get("width") or 0) * (img.get("height") or 0))

            a_imgs = sorted(data["a_img_map"].values(), key=_sort_key)
            b_imgs = sorted(data["b_img_map"].values(), key=_sort_key)

            pairs.append({
                "gallery_a": {
                    "id":            gid_a,
                    "name":          ga.name,
                    "creator_name":  creator_a.name if creator_a else None,
                    "creator_id":    creator_a.id   if creator_a else None,
                    "total_images":  counts.get(gid_a, 0),
                    "matched_count": len(a_imgs),
                    "images":        a_imgs,
                },
                "gallery_b": {
                    "id":            gid_b,
                    "name":          gb.name,
                    "creator_name":  creator_b.name if creator_b else None,
                    "creator_id":    creator_b.id   if creator_b else None,
                    "total_images":  counts.get(gid_b, 0),
                    "matched_count": len(b_imgs),
                    "images":        b_imgs,
                },
                "overlap_count": max(len(a_imgs), len(b_imgs)),
            })

        pairs.sort(key=lambda p: p["overlap_count"], reverse=True)
        return {"computing": False, "pairs": pairs}

    finally:
        db.close()
