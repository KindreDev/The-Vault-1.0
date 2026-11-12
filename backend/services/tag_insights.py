"""Tag roles and what the library's tags say about the collection and its owner.

Roles: every tag does one job. Content tags (latex, underboob, on all fours)
are what rankings, Tag Hall of Fame and sets are about. Looks (hair, eyes, body
type), framing, people count, medium, Spice and system tags each have their
own place. Baseline tags are content tags so common in this collection that
they say nothing (breasts, solo-ish anatomy): still searchable, never ranked.

Taste profile: lifetime cums, edges, ratings and viewing per file are joined
with tags to find which tags turn up on engaged files more than chance.
"""
import math
import threading
import time
from typing import Optional

from sqlalchemy import text
from sqlalchemy.orm import Session

# ── Roles ─────────────────────────────────────────────────────────────────────
ROLES = ("content", "looks", "baseline", "framing", "people", "medium", "spice", "system")
RANKED_ROLES = {"content", "looks"}          # what rankings and insights use
SPICE_LEVELS = ("safe", "suggestive", "explicit", "hardcore")

ROLE_BY_CATEGORY = {
    "rating": "spice",
    "subject": "people",
    "style": "medium",
    "physical_feature": "looks",
}
FRAMING_TAGS = {"upper body", "full body", "close-up", "from below", "from above",
                "portrait", "cowboy shot", "from side"}
SYSTEM_CATEGORIES = {"funscript", "source", "type"}
# A content/looks tag on at least half of all tagged files carries no signal.
BASELINE_SHARE = 0.50

# Categories that make a tag pair worth showing (see surprising_pairs).
PAIR_ANCHORS = {"clothing", "pose"}

CACHE_SECONDS = 600
_cache: dict = {}
_lock = threading.Lock()


def _cached(key, compute, seconds=CACHE_SECONDS):
    now = time.monotonic()
    with _lock:
        hit = _cache.get(key)
        if hit and now - hit[0] < seconds:
            return hit[1]
    value = compute()
    with _lock:
        _cache[key] = (time.monotonic(), value)
    return value


def invalidate():
    with _lock:
        _cache.clear()


def tagged_file_count(db: Session) -> int:
    return _cached("tagged_files", lambda: int(db.execute(
        text("SELECT COUNT(*) FROM images WHERE ai_tagged = 1")).scalar() or 0) or 1)


def auto_role(name: str, category: Optional[str], use_count: int, total: int) -> str:
    category = (category or "general").lower()
    if category in SYSTEM_CATEGORIES:
        return "system"
    if name in FRAMING_TAGS:
        return "framing"
    role = ROLE_BY_CATEGORY.get(category, "content")
    if role in RANKED_ROLES and total and use_count / total >= BASELINE_SHARE:
        return "baseline"
    return role


def tag_roles(db: Session) -> dict[int, dict]:
    """{tag_id: {name, category, use_count, role, auto_role, share}} for every tag."""
    def compute():
        total = tagged_file_count(db)
        out = {}
        for tid, name, category, use_count, override in db.execute(text(
                "SELECT id, name, category, use_count, role_override FROM tags")):
            auto = auto_role(name, category, use_count or 0, total)
            out[tid] = {
                "id": tid, "name": name, "category": category or "general",
                "use_count": use_count or 0, "auto_role": auto,
                "role": override if override in ROLES else auto,
                "share": round((use_count or 0) / total, 4),
            }
        return out
    return _cached("roles", compute)


def ranked_tag_ids(db: Session) -> set[int]:
    return {tid for tid, info in tag_roles(db).items() if info["role"] in RANKED_ROLES}


def spice_tag_ids(db: Session) -> dict[str, int]:
    return {info["name"]: tid for tid, info in tag_roles(db).items()
            if info["role"] == "spice" and info["name"] in SPICE_LEVELS}


def set_role_override(db: Session, tag_id: int, role: Optional[str]):
    if role is not None and role not in ROLES:
        raise ValueError(f"role must be one of {', '.join(ROLES)}")
    db.execute(text("UPDATE tags SET role_override = :r WHERE id = :id"), {"r": role, "id": tag_id})
    db.commit()
    invalidate()


# ── Engagement weights ────────────────────────────────────────────────────────
# What counts as "this file did something for me". A cum is the loudest signal,
# an edge real intent, a high 10-star rating a deliberate opinion, and viewing
# a faint one.
CUM_W, EDGE_W, VIEW_W, MINUTE_W = 5.0, 3.0, 0.2, 0.1


def _rating_w(rating) -> float:
    return max(0.0, float(rating or 0) - 5.0) * 0.5


def weights_all_time(db: Session) -> dict[int, float]:
    def compute():
        out = {}
        for iid, cum, edge, views, secs, rating in db.execute(text("""
                SELECT id, cum_count, edge_count, view_count, view_seconds, rating FROM images
                WHERE cum_count > 0 OR edge_count > 0 OR view_count > 0 OR rating > 5""")):
            w = ((cum or 0) * CUM_W + (edge or 0) * EDGE_W + min(views or 0, 10) * VIEW_W
                 + min((secs or 0) / 60.0, 10) * MINUTE_W + _rating_w(rating))
            if w > 0:
                out[iid] = w
        return out
    return _cached("weights_all", compute)


def weights_window(db: Session, since, until=None) -> dict[int, float]:
    params = {"since": since}
    clause = "logged_at >= :since"
    if until is not None:
        clause += " AND logged_at < :until"
        params["until"] = until
    out: dict[int, float] = {}
    for iid, kind, amount in db.execute(text(f"""
            SELECT image_id, kind, SUM(amount) FROM activity_events
            WHERE image_id IS NOT NULL AND kind IN ('cum','edge','view','seconds') AND {clause}
            GROUP BY image_id, kind"""), params):
        w = {"cum": CUM_W, "edge": EDGE_W, "view": VIEW_W}.get(kind, MINUTE_W / 60.0) * float(amount or 0)
        out[iid] = out.get(iid, 0.0) + w
    return out


def _tag_weight_sums(db: Session, weights: dict[int, float]) -> tuple[dict[int, float], dict[int, int]]:
    """Sum of file weights and engaged-file count per tag."""
    if not weights:
        return {}, {}
    db.execute(text("DROP TABLE IF EXISTS temp._w"))
    db.execute(text("CREATE TEMP TABLE _w (image_id INTEGER PRIMARY KEY, w REAL)"))
    db.execute(text("INSERT INTO _w VALUES (:i, :w)"), [{"i": i, "w": w} for i, w in weights.items()])
    sums, counts = {}, {}
    for tid, s, n in db.execute(text("""
            SELECT it.tag_id, SUM(_w.w), COUNT(*) FROM _w CROSS JOIN image_tags it ON it.image_id = _w.image_id
            GROUP BY it.tag_id""")):
        sums[tid], counts[tid] = float(s), int(n)
    db.execute(text("DROP TABLE IF EXISTS temp._w"))
    return sums, counts


def lift_profile(db: Session, weights: dict[int, float], min_files: int = 5,
                 roles: set[str] = RANKED_ROLES, prior: float = 25.0) -> list[dict]:
    """Tags ranked by how much more they show up on engaged files than in the
    library. prior pulls thin evidence towards 1x (no preference)."""
    sums, counts = _tag_weight_sums(db, weights)
    total_w = sum(weights.values()) or 1.0
    info = tag_roles(db)
    out = []
    for tid, s in sums.items():
        meta = info.get(tid)
        if not meta or meta["role"] not in roles or counts[tid] < min_files:
            continue
        expected = meta["share"] * total_w
        lift = (s + prior) / (expected + prior)
        out.append({"id": tid, "name": meta["name"], "category": meta["category"], "role": meta["role"],
                    "lift": round(lift, 2), "engaged_files": counts[tid], "use_count": meta["use_count"]})
    out.sort(key=lambda r: r["lift"], reverse=True)
    return out


def taste_profile(db: Session) -> list[dict]:
    return _cached("taste", lambda: lift_profile(db, weights_all_time(db)), seconds=3600)


# ── Rankings for the Dashboard tag widget ─────────────────────────────────────
def top_tags(db: Session, limit: int = 8) -> list[dict]:
    rows = [r for r in tag_roles(db).values() if r["role"] in RANKED_ROLES]
    rows.sort(key=lambda r: r["use_count"], reverse=True)
    return rows[:limit]


def trending_tags(db: Session, limit: int = 8, days: int = 7) -> list[dict]:
    """Tags rising in what you actually watch and finish to: this week's share
    of engagement against the four weeks before it."""
    def compute():
        from datetime import datetime, timedelta
        now = datetime.utcnow()
        recent = weights_window(db, now - timedelta(days=days))
        before = weights_window(db, now - timedelta(days=days * 5), now - timedelta(days=days))
        r_sums, r_counts = _tag_weight_sums(db, recent)
        b_sums, _ = _tag_weight_sums(db, before)
        r_total, b_total = sum(recent.values()) or 1.0, sum(before.values()) or 1.0
        info = tag_roles(db)
        out = []
        for tid, s in r_sums.items():
            meta = info.get(tid)
            if not meta or meta["role"] not in RANKED_ROLES or r_counts[tid] < 3:
                continue
            r_share = s / r_total
            b_share = b_sums.get(tid, 0.0) / b_total
            # Smoothed against the tag's library share, so a tag that was simply
            # absent last month doesn't jump to an infinite rise.
            base = 0.5 * b_share + 0.5 * meta["share"] * 0.2
            out.append({"id": tid, "name": meta["name"], "category": meta["category"],
                        "rise": round((r_share + 0.002) / (base + 0.002), 2),
                        "recent_files": r_counts[tid], "use_count": meta["use_count"]})
        out.sort(key=lambda r: r["rise"], reverse=True)
        return out
    return _cached(("trending", days), compute, seconds=300)[:limit]


def surprising_pairs(db: Session, limit: int = 8) -> list[dict]:
    """Tag pairs that appear together far more than chance (lift), measured on a
    1-in-16 sample of files so it stays fast on a large library. At least one
    side must be clothing, a pose or a look: explicit anatomy pairs (nipples +
    nude, penis + sex) are true but never interesting."""
    def compute():
        info = tag_roles(db)
        candidates = [tid for tid, m in info.items() if m["role"] in RANKED_ROLES and m["use_count"] >= 300]
        if len(candidates) < 2:
            return []
        db.execute(text("DROP TABLE IF EXISTS temp._cand"))
        db.execute(text("CREATE TEMP TABLE _cand (tag_id INTEGER PRIMARY KEY)"))
        db.execute(text("INSERT INTO _cand VALUES (:t)"), [{"t": t} for t in candidates])
        n = db.execute(text("SELECT COUNT(DISTINCT image_id) FROM image_tags WHERE image_id % 16 = 0")).scalar() or 1
        singles = dict(db.execute(text("""
            SELECT it.tag_id, COUNT(*) FROM image_tags it JOIN _cand c ON c.tag_id = it.tag_id
            WHERE it.image_id % 16 = 0 GROUP BY it.tag_id""")).fetchall())
        pairs = db.execute(text("""
            SELECT a.tag_id, b.tag_id, COUNT(*) FROM image_tags a
            JOIN _cand ca ON ca.tag_id = a.tag_id
            CROSS JOIN image_tags b ON b.image_id = a.image_id AND b.tag_id > a.tag_id
            JOIN _cand cb ON cb.tag_id = b.tag_id
            WHERE a.image_id % 16 = 0
            GROUP BY a.tag_id, b.tag_id HAVING COUNT(*) >= 30""")).fetchall()
        db.execute(text("DROP TABLE IF EXISTS temp._cand"))
        out = []
        for a, b, together in pairs:
            lift = together * n / (singles[a] * singles[b])
            # Skip pairs where one tag nearly implies the other (bikini →
            # swimsuit, blowjob → oral sex): true, but not an insight.
            if lift < 1.5 or max(together / singles[a], together / singles[b]) > 0.85:
                continue
            if not ({info[a]["category"], info[b]["category"]} & PAIR_ANCHORS or "looks" in (info[a]["role"], info[b]["role"])):
                continue
            out.append({"tag1": {"id": a, "name": info[a]["name"], "category": info[a]["category"]},
                        "tag2": {"id": b, "name": info[b]["name"], "category": info[b]["category"]},
                        "lift": round(lift, 1), "co_count": together * 16,
                        # Prefer strong AND common pairs over rare perfect ones.
                        "_score": math.log(lift) * math.sqrt(together)})
        out.sort(key=lambda r: r["_score"], reverse=True)
        for row in out:
            row.pop("_score")
        return out
    return _cached("pairs", compute, seconds=6 * 3600)[:limit]


# ── Picks ─────────────────────────────────────────────────────────────────────
def _liked_tags(db: Session, top: int = 40) -> dict[int, float]:
    return {r["id"]: math.log(r["lift"]) for r in taste_profile(db)[:top] if r["lift"] >= 1.15}


def _taste_scored_unseen(db: Session) -> list[tuple]:
    """(image_id, gallery_id, score) for unseen files, best taste match first."""
    def compute():
        liked = _liked_tags(db)
        if not liked:
            return []
        db.execute(text("DROP TABLE IF EXISTS temp._liked"))
        db.execute(text("CREATE TEMP TABLE _liked (tag_id INTEGER PRIMARY KEY, w REAL)"))
        db.execute(text("INSERT INTO _liked VALUES (:t, :w)"), [{"t": t, "w": w} for t, w in liked.items()])
        rows = db.execute(text("""
            SELECT it.image_id, i.gallery_id, SUM(l.w) AS s FROM image_tags it
            JOIN _liked l ON l.tag_id = it.tag_id
            JOIN images i ON i.id = it.image_id
            WHERE COALESCE(i.view_count, 0) = 0
            GROUP BY it.image_id ORDER BY s DESC LIMIT 4000""")).fetchall()
        db.execute(text("DROP TABLE IF EXISTS temp._liked"))
        return [(r[0], r[1], float(r[2])) for r in rows]
    return _cached("unseen_scored", compute)


def _image_cards(db: Session, ids: list[int]) -> list[dict]:
    if not ids:
        return []
    rows = {r[0]: r for r in db.execute(text(f"""
        SELECT i.id, i.filename, i.thumb_path, i.gallery_id, i.is_video, g.name
        FROM images i JOIN galleries g ON g.id = i.gallery_id
        WHERE i.id IN ({','.join(map(str, ids))})""")).fetchall()}
    return [{"id": r[0], "filename": r[1], "thumb_path": r[2], "gallery_id": r[3],
             "is_video": bool(r[4]), "gallery_name": r[5]} for i in ids if (r := rows.get(i))]


def for_you(db: Session, limit: int = 24, seed: int = 0, media: str = "all") -> list[dict]:
    """Unseen files that match your taste, shuffled from the strongest matches
    (max two per gallery so one shoot doesn't fill the row)."""
    import random
    scored = _taste_scored_unseen(db)[:900]
    rng = random.Random(seed)
    pool = scored[:]
    rng.shuffle(pool)
    pool.sort(key=lambda r: r[2] * rng.uniform(0.75, 1.0), reverse=True)
    per_gallery: dict[int, int] = {}
    ids = []
    for iid, gid, _ in pool:
        if per_gallery.get(gid, 0) >= 2:
            continue
        per_gallery[gid] = per_gallery.get(gid, 0) + 1
        ids.append(iid)
        if len(ids) >= limit * 3:
            break
    cards = _image_cards(db, ids)
    if media in ("photos", "videos"):
        cards = [c for c in cards if c["is_video"] == (media == "videos")]
    return cards[:limit]


def hidden_gems(db: Session, limit: int = 12) -> list[dict]:
    """Galleries you have never opened that are full of your kind of thing."""
    by_gallery: dict[int, list[float]] = {}
    for _, gid, score in _taste_scored_unseen(db):
        by_gallery.setdefault(gid, []).append(score)
    if not by_gallery:
        return []
    rows = db.execute(text(f"""
        SELECT g.id, g.name, g.cover_thumb, g.view_count,
               (SELECT COUNT(*) FROM images x WHERE x.gallery_id = g.id) AS files
        FROM galleries g WHERE g.id IN ({','.join(map(str, by_gallery))}) AND COALESCE(g.view_count, 0) = 0
    """)).fetchall()
    out = []
    for gid, name, cover, _, files in rows:
        hits = by_gallery[gid]
        out.append({"id": gid, "name": name, "cover_thumb": cover, "files": files,
                    "matches": len(hits), "score": round(sum(hits), 1)})
    out.sort(key=lambda r: r["score"], reverse=True)
    return out[:limit]


def similar_files(db: Session, image_id: int, limit: int = 24) -> list[dict]:
    """Files sharing this one's most distinctive tags (rarer tags count more),
    plus its Spice, at most two per gallery and never the same gallery first."""
    info = tag_roles(db)
    total = tagged_file_count(db)
    own = db.execute(text("SELECT tag_id FROM image_tags WHERE image_id = :i"), {"i": image_id}).scalars().all()
    gallery_id = db.execute(text("SELECT gallery_id FROM images WHERE id = :i"), {"i": image_id}).scalar()
    feats = {}
    for tid in own:
        meta = info.get(tid)
        if not meta:
            continue
        if meta["role"] in RANKED_ROLES:
            feats[tid] = math.log(total / max(1, meta["use_count"]))
        elif meta["role"] == "spice":
            feats[tid] = 1.0
    if not feats:
        return []
    top = dict(sorted(feats.items(), key=lambda kv: kv[1], reverse=True)[:10])
    values = ",".join(f"({t},{w})" for t, w in top.items())
    rows = db.execute(text(f"""
        WITH f(tag_id, w) AS (VALUES {values})
        SELECT it.image_id, i.gallery_id, SUM(f.w) AS s FROM image_tags it
        JOIN f ON f.tag_id = it.tag_id JOIN images i ON i.id = it.image_id
        WHERE it.image_id != :i GROUP BY it.image_id ORDER BY s DESC LIMIT 400"""), {"i": image_id}).fetchall()
    per_gallery: dict[int, int] = {}
    others, same = [], []
    for iid, gid, _ in rows:
        if per_gallery.get(gid, 0) >= 2:
            continue
        per_gallery[gid] = per_gallery.get(gid, 0) + 1
        (same if gid == gallery_id else others).append(iid)
    return _image_cards(db, (others + same)[:limit])


# ── Spice ramp ────────────────────────────────────────────────────────────────
def spice_order(db: Session, image_ids: list[int]) -> list[dict]:
    """The given files ordered Safe → Hardcore, keeping their order inside each
    level. Files with no Spice yet sit with Safe."""
    ids = [int(i) for i in image_ids][:5000]
    if not ids:
        return []
    levels = {name: n for n, name in enumerate(SPICE_LEVELS)}
    spice_ids = spice_tag_ids(db)
    by_tag = {tid: levels[name] for name, tid in spice_ids.items()}
    found = {}
    if by_tag:
        for iid, tid in db.execute(text(f"""
                SELECT image_id, tag_id FROM image_tags
                WHERE image_id IN ({','.join(map(str, ids))}) AND tag_id IN ({','.join(map(str, by_tag))})""")):
            found[iid] = max(found.get(iid, 0), by_tag[tid])
    order = sorted(range(len(ids)), key=lambda n: (found.get(ids[n], 0), n))
    return [{"id": ids[n], "spice": SPICE_LEVELS[found.get(ids[n], 0)]} for n in order]


# ── Tag Hall of Fame ──────────────────────────────────────────────────────────
def tag_hall_of_fame(db: Session, tag_id: int, period: str = "all", limit: int = 15, ago: int = 0) -> dict:
    """Best photos, videos, galleries and creators for one tag, scored exactly
    like the main Hall of Fame (all time from counters, periods from events)."""
    from services import activity, ranking
    since, until = activity.period_bounds(period, ago)
    if since is None:
        scores = {iid: {"score": float(score), "cum": cum, "edges": edges, "views": views, "secs": secs}
                  for iid, score, cum, edges, views, secs in db.execute(text(f"""
            SELECT i.id, (COALESCE(i.cum_count,0)*{ranking.IMAGE_CUM_WEIGHT}
                         + COALESCE(i.edge_count,0)*{ranking.IMAGE_EDGE_WEIGHT}
                         + COALESCE(i.view_count,0)*{ranking.IMAGE_VIEW_WEIGHT_}
                         + COALESCE(i.view_seconds,0)*{ranking.IMAGE_SECOND_WEIGHT}) AS score,
                   i.cum_count, i.edge_count, i.view_count, i.view_seconds
            FROM image_tags it JOIN images i ON i.id = it.image_id
            WHERE it.tag_id = :t AND score > 0"""), {"t": tag_id})}
    else:
        windowed = ranking.score_all_images_in_period(db, since, until)
        tagged = set(db.execute(text(f"SELECT it.image_id FROM image_tags it WHERE it.tag_id = :t"),
                                {"t": tag_id}).scalars().all())
        scores = {iid: {"score": float(s["score"]), "cum": s["period_cum"], "edges": s["period_edges"],
                        "views": s["period_views"], "secs": s["period_view_seconds"]}
                  for iid, s in windowed.items() if iid in tagged}
    if not scores:
        return {"photos": [], "videos": [], "galleries": [], "creators": [], "files_scored": 0}

    ordered = sorted(scores, key=lambda i: scores[i]["score"], reverse=True)
    meta = {r[0]: r for r in db.execute(text(f"""
        SELECT i.id, i.filename, i.thumb_path, i.gallery_id, i.is_video, g.name
        FROM images i JOIN galleries g ON g.id = i.gallery_id
        WHERE i.id IN ({','.join(map(str, ordered[:2000]))})""")).fetchall()}

    def card(iid, rank):
        r, s = meta[iid], scores[iid]
        return {"id": iid, "rank": rank, "filename": r[1], "thumb_path": r[2], "gallery_id": r[3],
                "is_video": bool(r[4]), "gallery_name": r[5], "cum_count": s["cum"] or 0,
                "edge_count": s["edges"] or 0, "view_count": s["views"] or 0, "view_seconds": s["secs"] or 0,
                "score": round(s["score"])}

    photos = [i for i in ordered if i in meta and not meta[i][4]][:limit]
    videos = [i for i in ordered if i in meta and meta[i][4]][:limit]

    gallery_scores: dict[int, float] = {}
    for iid in ordered:
        if iid in meta:
            gallery_scores[meta[iid][3]] = gallery_scores.get(meta[iid][3], 0.0) + scores[iid]["score"]
    top_galleries = sorted(gallery_scores, key=gallery_scores.get, reverse=True)[:limit]
    gal_rows = {r[0]: r for r in db.execute(text(f"""
        SELECT id, name, cover_thumb FROM galleries WHERE id IN ({','.join(map(str, top_galleries)) or '0'})""")).fetchall()}

    creator_scores: dict[int, float] = {}
    for gid, cid in db.execute(text(f"""
            SELECT gallery_id, creator_id FROM gallery_creators
            WHERE gallery_id IN ({','.join(map(str, gallery_scores)) or '0'})""")):
        creator_scores[cid] = creator_scores.get(cid, 0.0) + gallery_scores[gid]
    top_creators = sorted(creator_scores, key=creator_scores.get, reverse=True)[:10]
    cr_rows = {r[0]: r for r in db.execute(text(f"""
        SELECT id, name, avatar_path, creator_type FROM creators
        WHERE id IN ({','.join(map(str, top_creators)) or '0'})""")).fetchall()}

    return {
        "photos": [card(i, n + 1) for n, i in enumerate(photos)],
        "videos": [card(i, n + 1) for n, i in enumerate(videos)],
        "galleries": [{"id": g, "rank": n + 1, "name": gal_rows[g][1], "cover_thumb": gal_rows[g][2],
                       "score": round(gallery_scores[g])} for n, g in enumerate(top_galleries) if g in gal_rows],
        "creators": [{"id": c, "rank": n + 1, "name": cr_rows[c][1], "avatar_path": cr_rows[c][2],
                      "creator_type": cr_rows[c][3], "score": round(creator_scores[c])}
                     for n, c in enumerate(top_creators) if c in cr_rows],
        "files_scored": len(scores),
    }
