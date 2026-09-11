"""Subject/background masks — the foundation of the foil effects.

WHY THIS EXISTS
On a real trading card the holo does not cover everything: on lower rarities
only the background shines, and on the chase rarities the subject shines too but
*differently*, with a general overlay on top. All of that needs one thing the
Vault does not currently have — to know where the subject is.

THE ECONOMICS
Masks are computed per SOURCE IMAGE, not per card, and cached forever. Ten cards
minted from one photo share one mask, and only a tiny fraction of a 400k library
ever becomes a card. So this is generated lazily at mint time (plus an optional
sweep), which turns "mask hundreds of images" into "a few hundred milliseconds,
once, never again".

WHAT COMES OUT
A single RGBA PNG so a shader needs one texture fetch:

    R  subject alpha, eroded then feathered
    G  edge band (dilate - erode) — rim light, etched outline, foil seam
    B  reserved (zero)
    A  255 (reserved)

FAILING HONESTLY
Cosplay shoots often have props and clutter right behind the subject, and a bad
cutout looks far worse than no cutout. Since the library is far too large to
check by hand, every mask is SCORED, and anything below the confidence bar is
marked unusable so the card falls back to a whole-card holo. It still looks
premium; it simply does not attempt a trick it would fail.
"""
import io
import logging
import os
import threading
from typing import Optional

import numpy as np
from PIL import Image as PILImage, ImageFilter

logger = logging.getLogger(__name__)

ANIMATED_IMAGE_EXTENSIONS = {".gif"}


def is_temporal_source(image) -> bool:
    """Return whether one static subject mask would become visually incorrect."""
    if getattr(image, "is_video", False):
        return True
    source_path = getattr(image, "file_path", None) or getattr(image, "filename", None) or ""
    return os.path.splitext(str(source_path))[1].lower() in ANIMATED_IMAGE_EXTENSIONS

# BRIA RMBG-1.4 — fast, ~44 MB, very strong on people. BiRefNet is the drop-in
# upgrade if hair edges disappoint; same interface, bigger and slower.
MODEL_REPO = "briaai/RMBG-1.4"
MODEL_FILE = "onnx/model.onnx"
INPUT_SIZE = 1024          # RMBG-1.4's training resolution
MASK_LONG_EDGE = 768       # stored size; masks are smooth and compress hard

# Quality gates. Tuned to reject the failure modes that actually occur:
# a mask that ate the whole frame, one that found almost nothing, and one
# shattered into confetti across a busy background.
MIN_COVERAGE = 0.04        # subject smaller than this => probably found nothing
MAX_COVERAGE = 0.92        # subject larger than this  => probably ate the frame
MIN_DECISIVENESS = 0.55    # share of pixels that are confidently 0 or 1
MAX_COMPONENTS = 14        # connected blobs above a size floor
MIN_QUALITY = 0.55         # below this the card falls back to whole-card holo
ERODE_SKIP_DECISIVENESS = 0.94   # above this the edge is clean; don't erode it
MASK_PIPELINE_VERSION = "rmbg-1.4-v4"

_session = None
_session_device = None
_session_lock = threading.RLock()


# ── model plumbing (mirrors services/ai_tagger.py) ───────────────────────────

def _model_dir() -> str:
    from database import DATA_DIR
    d = os.path.join(DATA_DIR, "models", "rmbg")
    os.makedirs(d, exist_ok=True)
    return d


def _model_path() -> str:
    return os.path.join(_model_dir(), "model.onnx")


def is_ready() -> bool:
    return os.path.exists(_model_path())


def download_model():
    """Fetch RMBG-1.4 on demand, exactly like the taggers do."""
    from huggingface_hub import hf_hub_download
    d = _model_dir()
    src = hf_hub_download(MODEL_REPO, MODEL_FILE, local_dir=d)
    if os.path.abspath(src) != os.path.abspath(_model_path()):
        import shutil
        shutil.copy2(src, _model_path())
    logger.info("masking: model ready at %s", _model_path())
    return _model_path()


def _get_session(*, force_cpu: bool = False):
    """Reuse the tagger's provider selection so GPU/CPU behaviour and the
    use_gpu setting stay consistent across every model the Vault runs."""
    global _session, _session_device
    with _session_lock:
        if not is_ready():
            download_model()
        if force_cpu:
            if _session is None or _session_device != "cpu":
                import onnxruntime as ort
                _session = ort.InferenceSession(
                    _model_path(), providers=["CPUExecutionProvider"]
                )
                _session_device = "cpu"
            return _session
        if _session is None:
            from services.ai_tagger import _make_session
            _session = _make_session(_model_path())
            _session_device = "auto"
        return _session


def reset_session():
    global _session, _session_device
    with _session_lock:
        _session = None
        _session_device = None


def masks_dir() -> str:
    from database import DATA_DIR
    d = os.path.join(DATA_DIR, "masks")
    os.makedirs(d, exist_ok=True)
    return d


MASK_CHANNELS = {"subject": 0, "edge": 1}


def mask_channel_png(packed_path: str, channel: str) -> bytes:
    """Return one packed channel as a white PNG whose alpha is the channel."""
    invert = channel == "background"
    source_channel = "subject" if invert else channel
    if source_channel not in MASK_CHANNELS:
        raise ValueError(f"Unsupported mask channel: {channel}")
    with PILImage.open(packed_path) as packed_image:
        packed = packed_image.convert("RGBA")
        alpha = packed.getchannel(MASK_CHANNELS[source_channel])
        if invert:
            alpha = alpha.point(lambda value: 255 - value)
        output = PILImage.new("RGBA", packed.size, (255, 255, 255, 0))
        output.putalpha(alpha)
        buffer = io.BytesIO()
        output.save(buffer, "PNG", optimize=True)
    return buffer.getvalue()


# ── inference ────────────────────────────────────────────────────────────────

def _raw_matte(img: PILImage.Image, *, force_cpu: bool = False) -> np.ndarray:
    """Run the model and return a float32 0..1 matte at the image's aspect."""
    sess = _get_session(force_cpu=force_cpu)
    w, h = img.size
    x = img.convert("RGB").resize((INPUT_SIZE, INPUT_SIZE), PILImage.BILINEAR)
    arr = np.asarray(x, dtype=np.float32) / 255.0
    arr = (arr - 0.5) / 1.0                       # RMBG normalisation
    arr = np.transpose(arr, (2, 0, 1))[None, ...]

    # ORT sessions are shared by pack opens, collection backfills, and manual
    # retries. Serializing run/reset prevents a concurrent failed provider from
    # poisoning the next request's inference session.
    with _session_lock:
        out = sess.run(None, {sess.get_inputs()[0].name: arr})[0]
    m = np.squeeze(out).astype(np.float32)
    mn, mx = float(m.min()), float(m.max())
    m = (m - mn) / (mx - mn) if mx > mn else np.zeros_like(m)

    return np.asarray(
        PILImage.fromarray((m * 255).astype(np.uint8)).resize((w, h), PILImage.BILINEAR),
        dtype=np.float32) / 255.0


# ── post-process ─────────────────────────────────────────────────────────────

def _refine(matte: np.ndarray) -> np.ndarray:
    """Erode a hair's breadth, then feather — but only when it's needed.

    Raw model output haloes: it claims a rim of background pixels around the
    subject, and that rim glows when the background is the part being holo'd.
    Pulling the edge in before softening it is what separates 'looks bought'
    from 'looks cut out in Paint'.

    The cost is that erosion also nibbles genuinely thin features — an ear tip,
    a stray lock of hair. So it is now ADAPTIVE: a matte the model was decisive
    about has a clean edge and no halo worth fighting, and gets feathering only.
    Mushy, uncertain mattes are the ones that halo, and those still get eroded.
    """
    decisive = float(((matte < 0.15) | (matte > 0.85)).mean())
    im = PILImage.fromarray((np.clip(matte, 0, 1) * 255).astype(np.uint8))
    if decisive < ERODE_SKIP_DECISIVENESS:
        im = im.filter(ImageFilter.MinFilter(3))              # erode ~1px
        im = im.filter(ImageFilter.GaussianBlur(radius=1.6))
    else:
        im = im.filter(ImageFilter.GaussianBlur(radius=1.1))  # feather only
    return np.asarray(im, dtype=np.float32) / 255.0


def _edge_band(matte: np.ndarray) -> np.ndarray:
    """dilate - erode: a thin ribbon hugging the silhouette."""
    im = PILImage.fromarray((np.clip(matte, 0, 1) * 255).astype(np.uint8))
    d = np.asarray(im.filter(ImageFilter.MaxFilter(5)), dtype=np.float32)
    e = np.asarray(im.filter(ImageFilter.MinFilter(5)), dtype=np.float32)
    band = np.clip(d - e, 0, 255)
    band = np.asarray(
        PILImage.fromarray(band.astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.2)),
        dtype=np.float32)
    mx = band.max()
    return band / mx if mx > 0 else band


def upgrade_mask_channels(_image_path: str, packed_path: str) -> dict:
    """Clear the retired third channel without rerunning subject inference."""
    with PILImage.open(packed_path) as packed_image:
        packed = np.asarray(packed_image.convert("RGBA"), dtype=np.uint8).copy()
    packed[..., 2] = 0
    packed[..., 3] = 255
    PILImage.fromarray(packed, mode="RGBA").save(packed_path, "PNG", optimize=True)
    return {"pipeline_version": MASK_PIPELINE_VERSION}


def score_mask(matte: np.ndarray) -> tuple[float, dict]:
    """How much do we trust this mask? 0..1, plus the reasons.

    This is the piece that makes a fully automatic pipeline viable over 400k
    files: nobody is going to inspect these, so the pipeline has to notice its
    own failures and stand down.
    """
    hard = matte > 0.5
    coverage = float(hard.mean())

    # decisiveness — a good matte is mostly confident; a bad one is grey mush
    decisive = float(((matte < 0.15) | (matte > 0.85)).mean())

    # fragmentation — count blobs on a coarse grid (cheap stand-in for a real
    # connected-component pass; confetti shows up as many occupied cells that
    # do not touch the main body)
    small = np.asarray(
        PILImage.fromarray((hard * 255).astype(np.uint8)).resize((64, 64), PILImage.BILINEAR),
        dtype=np.float32) / 255.0
    occupied = small > 0.5
    comps = _count_blobs(occupied)

    reasons = {}
    q = 1.0
    if coverage < MIN_COVERAGE:
        q *= 0.15
        reasons["coverage_low"] = round(coverage, 4)
    elif coverage > MAX_COVERAGE:
        q *= 0.25
        reasons["coverage_high"] = round(coverage, 4)
    if decisive < MIN_DECISIVENESS:
        q *= max(0.2, decisive / MIN_DECISIVENESS)
        reasons["indecisive"] = round(decisive, 4)
    if comps > MAX_COMPONENTS:
        q *= max(0.25, MAX_COMPONENTS / comps)
        reasons["fragmented"] = comps

    return round(min(1.0, q), 4), {
        "coverage": round(coverage, 4),
        "decisiveness": round(decisive, 4),
        "components": comps,
        **reasons,
    }


def _count_blobs(occ: np.ndarray) -> int:
    """Flood-fill blob count on a small boolean grid, ignoring specks."""
    seen = np.zeros_like(occ, dtype=bool)
    h, w = occ.shape
    n = 0
    for sy in range(h):
        for sx in range(w):
            if not occ[sy, sx] or seen[sy, sx]:
                continue
            stack = [(sy, sx)]
            seen[sy, sx] = True
            size = 0
            while stack:
                y, x = stack.pop()
                size += 1
                for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    ny, nx = y + dy, x + dx
                    if 0 <= ny < h and 0 <= nx < w and occ[ny, nx] and not seen[ny, nx]:
                        seen[ny, nx] = True
                        stack.append((ny, nx))
            if size >= 6:                 # ignore specks
                n += 1
    return n


# ── public entry point ───────────────────────────────────────────────────────

def generate_mask(image_path: str, out_path: str, *, force_cpu: bool = False) -> dict:
    """Build and save the packed RGBA mask. Returns quality metadata."""
    src = PILImage.open(image_path)
    src.thumbnail((MASK_LONG_EDGE, MASK_LONG_EDGE), PILImage.LANCZOS)

    matte = _refine(_raw_matte(src, force_cpu=force_cpu))
    quality, stats = score_mask(matte)

    rgba = np.zeros((matte.shape[0], matte.shape[1], 4), dtype=np.uint8)
    rgba[..., 0] = (np.clip(matte, 0, 1) * 255).astype(np.uint8)
    rgba[..., 1] = (_edge_band(matte) * 255).astype(np.uint8)
    rgba[..., 3] = 255

    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    PILImage.fromarray(rgba, mode="RGBA").save(out_path, "PNG", optimize=True)

    return {
        "path": out_path,
        "quality": quality,
        "usable": quality >= MIN_QUALITY,
        "width": int(matte.shape[1]),
        "height": int(matte.shape[0]),
        "pipeline_version": MASK_PIPELINE_VERSION,
        **stats,
    }


def mask_path_for(image_id: int) -> str:
    return os.path.join(masks_dir(), f"{image_id}.png")


# ── batch backfill ───────────────────────────────────────────────────────────

_lock = threading.Lock()
_state: dict = {
    "running": False, "progress": 0, "total": 0,
    "made": 0, "skipped": 0, "unusable": 0, "errors": 0,
    "message": "Idle", "cancelled": False,
}


def get_state() -> dict:
    with _lock:
        return dict(_state)


def _set(**kw):
    with _lock:
        _state.update(kw)


def cancel():
    _set(cancelled=True)


def _is_cancelled() -> bool:
    with _lock:
        return _state["cancelled"]


def card_source_image_ids(db) -> list:
    """Images that back a card in the user's owned inventory.

    This is the whole reason a 400k library is tractable: masks are only needed
    where a card exists, which is a tiny slice of the collection. Masking the
    library wholesale would be days of GPU time for art nobody will ever see on
    a card face.
    """
    from models import Card, CardInventory
    rows = (db.query(Card.source_image_id)
              .join(CardInventory, CardInventory.card_id == Card.id)
              .filter(CardInventory.quantity > 0, Card.source_image_id.isnot(None))
              .distinct()
              .all())
    return [r[0] for r in rows]


def backfill_thread(db_factory, only_cards: bool = True, force: bool = False):
    """Generate every missing mask. Runs on the shared task queue."""
    from models import Image as ImageModel

    db = db_factory()
    _set(running=True, cancelled=False, progress=0, made=0, skipped=0,
         unusable=0, errors=0, message="Preparing…")
    try:
        q = db.query(ImageModel).filter(ImageModel.is_video == False)  # noqa: E712
        if only_cards:
            ids = card_source_image_ids(db)
            if not ids:
                _set(running=False, message="No cards have source images yet.")
                return
            q = q.filter(ImageModel.id.in_(ids))
        if not force:
            from sqlalchemy import or_
            q = q.filter(or_(
                ImageModel.mask_path.is_(None),
                ImageModel.mask_pipeline_version.is_(None),
                ImageModel.mask_pipeline_version != MASK_PIPELINE_VERSION,
            ))

        images = q.all()
        _set(total=len(images), message=f"Masking {len(images)} images…")

        for i, im in enumerate(images, 1):
            if _is_cancelled():
                _set(message="Cancelled.")
                break
            try:
                info = ensure_mask(db, im, force=force, upgrade_stale=True)
                if info is None:
                    _set(skipped=_state["skipped"] + 1)
                elif not info.get("usable"):
                    _set(unusable=_state["unusable"] + 1)
                else:
                    _set(made=_state["made"] + 1)
            except Exception as e:
                logger.warning("masking: image %s failed: %s", im.id, e)
                _set(errors=_state["errors"] + 1)

            if i % 20 == 0:
                db.commit()
            _set(progress=i, message=f"Masking {i}/{len(images)}…")

        db.commit()
        s = get_state()
        _set(message=(f"Done — {s['made']} masked, {s['unusable']} unusable "
                      f"(whole-card holo), {s['skipped']} skipped, {s['errors']} errors."))
    finally:
        _set(running=False)
        db.close()


def ensure_mask(db, image, force: bool = False, upgrade_stale: bool = False) -> Optional[dict]:
    """Generate this image's mask if it doesn't have a usable one yet.

    Videos are skipped deliberately: a still mask cannot track a moving subject,
    so a video-sourced card ghosts. Those fall back to the whole-card holo — the
    same path a low-confidence mask takes, so it costs nothing extra to support.
    """
    if is_temporal_source(image):
        reason = "video-source" if getattr(image, "is_video", False) else "animated-image-source"
        image.mask_status = "fallback"
        image.mask_failure_reason = reason
        image.mask_pipeline_version = MASK_PIPELINE_VERSION
        image.mask_visual_mode = "flat"
        db.flush()
        return {"path": None, "quality": None, "usable": False,
                "status": "fallback", "failure_reason": reason,
                "pipeline_version": MASK_PIPELINE_VERSION, "visual_mode": "flat"}
    if not image.file_path or not os.path.exists(image.file_path):
        image.mask_status = "fallback"
        image.mask_failure_reason = "source-file-missing"
        image.mask_pipeline_version = MASK_PIPELINE_VERSION
        image.mask_visual_mode = "flat"
        db.flush()
        return {"path": None, "quality": None, "usable": False,
                "status": "fallback", "failure_reason": "source-file-missing",
                "pipeline_version": MASK_PIPELINE_VERSION, "visual_mode": "flat"}

    out = mask_path_for(image.id)
    if not force and image.mask_path and os.path.exists(image.mask_path):
        if upgrade_stale and image.mask_pipeline_version != MASK_PIPELINE_VERSION:
            info = upgrade_mask_channels(image.file_path, image.mask_path)
            image.mask_pipeline_version = info["pipeline_version"]
        usable = (image.mask_quality or 0) >= MIN_QUALITY
        image.mask_status = "usable" if usable else "fallback"
        image.mask_failure_reason = None if usable else "quality-below-threshold"
        image.mask_visual_mode = "layered" if usable else "flat"
        db.flush()
        return {"path": image.mask_path, "quality": image.mask_quality,
                "usable": usable, "cached": True, "status": image.mask_status,
                "failure_reason": image.mask_failure_reason,
                "pipeline_version": image.mask_pipeline_version or "legacy",
                "visual_mode": image.mask_visual_mode}

    first_error = None
    try:
        info = generate_mask(image.file_path, out)
    except Exception as e:
        first_error = e
        # CUDA provider failures and concurrent ORT session faults are
        # recoverable. Reset the shared session and retry once on CPU before
        # declaring a static source unavailable.
        logger.exception("masking: primary inference failed for image %s", image.id)
        reset_session()
        try:
            info = generate_mask(image.file_path, out, force_cpu=True)
        except Exception as retry_error:
            detail = f"{type(retry_error).__name__}: {retry_error}"
            if first_error:
                detail = (
                    f"primary={type(first_error).__name__}: {first_error}; "
                    f"retry={detail}"
                )
            detail = detail[:500]
            logger.exception("masking: CPU retry failed for image %s", image.id)
            logger.error("masking: image %s failure detail: %s", image.id, detail)
            image.mask_status = "fallback"
            image.mask_failure_reason = f"generation-error: {detail}"
            image.mask_pipeline_version = MASK_PIPELINE_VERSION
            image.mask_visual_mode = "flat"
            db.flush()
            return {"path": None, "quality": None, "usable": False,
                    "status": "fallback", "failure_reason": "generation-error",
                    "failure_detail": detail,
                    "pipeline_version": MASK_PIPELINE_VERSION, "visual_mode": "flat"}

    image.mask_path = info["path"]
    image.mask_quality = info["quality"]
    usable = bool(info.get("usable"))
    image.mask_status = "usable" if usable else "fallback"
    image.mask_failure_reason = None if usable else "quality-below-threshold"
    image.mask_pipeline_version = info.get("pipeline_version") or MASK_PIPELINE_VERSION
    image.mask_visual_mode = "layered" if usable else "flat"
    db.flush()
    return {**info, "status": image.mask_status,
            "failure_reason": image.mask_failure_reason,
            "pipeline_version": image.mask_pipeline_version,
            "visual_mode": image.mask_visual_mode}
