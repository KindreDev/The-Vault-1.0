"""
Recommendation logic for the "More like this" tile on the end-of-slideshow
screen.

Different from `/galleries/{id}/similar`, which ranks purely on how many tags
two galleries share. Raw overlap is dominated by tags that are on half the
collection — "1girl" tells you nothing about what you just watched. Here each
tag is weighted by how rare it is, so the handful of tags that actually
characterise the gallery drive the match.

The contract is that this ALWAYS returns something. Requirements relax step by
step, and the last resort is a random gallery.
"""
import math
import random

from sqlalchemy import text
from sqlalchemy.orm import Session

from models import Gallery

# How many characteristic tags to describe the watched gallery with.
MAX_SIGNATURE_TAGS = 6
MIN_SIGNATURE_TAGS = 3
# Fraction of the signature a candidate must match to qualify at full strength.
MATCH_FRACTION = 0.5


def _signature_tags(db: Session, gallery_id: int) -> list[tuple[int, float]]:
    """The tags that most characterise this gallery, as (tag_id, weight).

    Weight is TF-IDF flavoured: how often the tag appears on this gallery's
    images, scaled by how rare it is across the whole library. A tag on every
    image in the gallery but also on 80% of the collection scores near zero.
    """
    total_images = db.execute(text("SELECT COUNT(*) FROM images")).scalar() or 1

    rows = db.execute(text("""
        SELECT it.tag_id,
               COUNT(DISTINCT it.image_id) AS local_count,
               (SELECT COUNT(DISTINCT it2.image_id)
                  FROM image_tags it2
                 WHERE it2.tag_id = it.tag_id) AS global_count
          FROM image_tags it
          JOIN images i ON i.id = it.image_id
         WHERE i.gallery_id = :gid
      GROUP BY it.tag_id
    """), {"gid": gallery_id}).fetchall()

    scored = []
    for tag_id, local_count, global_count in rows:
        if not global_count:
            continue
        # idf: rare tags score high, ubiquitous tags approach 0
        idf = math.log(total_images / global_count) if global_count < total_images else 0.0
        if idf <= 0:
            continue
        scored.append((tag_id, local_count * idf))

    scored.sort(key=lambda x: x[1], reverse=True)
    return scored[:MAX_SIGNATURE_TAGS]


def _candidates(db: Session, gallery_id: int, tag_ids: list[int], required: int) -> list[dict]:
    """Galleries sharing at least `required` of the given tags, best match first."""
    if not tag_ids:
        return []
    placeholders = ",".join(f":t{i}" for i in range(len(tag_ids)))
    params = {f"t{i}": t for i, t in enumerate(tag_ids)}
    params.update({"gid": gallery_id, "required": required})

    rows = db.execute(text(f"""
        SELECT g.id, g.name, g.cover_thumb, g.image_count,
               g.cum_count, g.view_count,
               COUNT(DISTINCT it.tag_id) AS shared_tags
          FROM galleries g
          JOIN images i ON i.gallery_id = g.id
          JOIN image_tags it ON it.image_id = i.id
         WHERE it.tag_id IN ({placeholders})
           AND g.id != :gid
      GROUP BY g.id
        HAVING shared_tags >= :required
      ORDER BY shared_tags DESC
         LIMIT 40
    """), params).fetchall()

    return [{"id": r[0], "name": r[1], "cover_thumb": r[2], "image_count": r[3],
             "cum_count": r[4], "view_count": r[5], "shared_tags": r[6]}
            for r in rows]


def more_like_this(db: Session, gallery_id: int, limit: int = 3) -> dict:
    """Pick galleries resembling the one just watched.

    Returns {"matches": [...], "signature": [...], "match_strength": str}.
    `match_strength` tells the UI how confident the pick is, so it can say
    "closely matches 4 tags" instead of pretending a random fallback was smart.
    """
    signature = _signature_tags(db, gallery_id)
    tag_ids = [t for t, _ in signature]

    tag_names = []
    if tag_ids:
        placeholders = ",".join(f":t{i}" for i in range(len(tag_ids)))
        name_rows = db.execute(
            text(f"SELECT id, name FROM tags WHERE id IN ({placeholders})"),
            {f"t{i}": t for i, t in enumerate(tag_ids)},
        ).fetchall()
        by_id = {r[0]: r[1] for r in name_rows}
        tag_names = [by_id[t] for t in tag_ids if t in by_id]

    # Step down the requirement until something matches: half the signature
    # first, then progressively fewer shared tags, then a single one.
    if tag_ids:
        start = max(1, math.ceil(len(tag_ids) * MATCH_FRACTION))
        for required in range(start, 0, -1):
            found = _candidates(db, gallery_id, tag_ids, required)
            if found:
                # Weighted sample so the same gallery isn't served every time,
                # while stronger matches stay more likely.
                keyed = [(random.random() ** (1.0 / max(1, c["shared_tags"])), c) for c in found]
                keyed.sort(key=lambda x: x[0], reverse=True)
                picked = [c for _, c in keyed[:limit]]
                strength = "strong" if required >= start else "loose"
                return {"matches": picked, "signature": tag_names, "match_strength": strength}

    # Nothing shares a tag — or the gallery has no usable tags at all. Still
    # show something rather than a dead end.
    fallback = (
        db.query(Gallery)
          .filter(Gallery.id != gallery_id, Gallery.image_count > 0)
          .order_by(text("RANDOM()"))
          .limit(limit)
          .all()
    )
    return {
        "matches": [{"id": g.id, "name": g.name, "cover_thumb": g.cover_thumb,
                     "image_count": g.image_count, "cum_count": g.cum_count,
                     "view_count": g.view_count, "shared_tags": 0}
                    for g in fallback],
        "signature": tag_names,
        "match_strength": "random",
    }
