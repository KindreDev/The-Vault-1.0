"""Reusable include/exclude tag predicates for library list queries."""

from sqlalchemy import and_, or_, select

from models import Gallery, Image, Tag, image_tags


def parse_tag_names(raw: str | None) -> list[str]:
    """Normalize a comma-separated tag list while preserving its order."""
    seen = set()
    out = []
    for value in (raw or "").split(","):
        name = value.strip().lower()
        if name and name not in seen:
            seen.add(name)
            out.append(name)
    return out


def parse_tag_ids(raw: str | None) -> list[int]:
    seen = set()
    out = []
    for value in (raw or "").split(","):
        value = value.strip()
        if value.isdigit():
            tag_id = int(value)
            if tag_id not in seen:
                seen.add(tag_id)
                out.append(tag_id)
    return out


def _tag_selectors(names_raw: str | None, ids_raw: str | None):
    return [Tag.name == name for name in parse_tag_names(names_raw)] + [Tag.id == tag_id for tag_id in parse_tag_ids(ids_raw)]


def _combine(predicates, mode: str):
    return or_(*predicates) if mode == "any" else and_(*predicates)


def apply_image_tag_filters(
    query,
    *,
    include_raw: str | None = None,
    include_ids_raw: str | None = None,
    include_mode: str = "all",
    exclude_raw: str | None = None,
    exclude_ids_raw: str | None = None,
    exclude_mode: str = "any",
):
    """Apply positive and negative tag groups to an Image query."""
    include_selectors = _tag_selectors(include_raw, include_ids_raw)
    exclude_selectors = _tag_selectors(exclude_raw, exclude_ids_raw)

    if include_selectors:
        predicates = [Image.tags.any(selector) for selector in include_selectors]
        query = query.filter(_combine(predicates, include_mode))

    if exclude_selectors:
        predicates = [Image.tags.any(selector) for selector in exclude_selectors]
        query = query.filter(~_combine(predicates, exclude_mode))

    return query


def _gallery_has_tag(selector):
    # A gallery's searchable tag set is the union of its own tags and the tags
    # on every file it contains. This preserves the pre-existing behavior.
    image_gallery_ids = (
        select(Image.gallery_id)
        .join(image_tags, image_tags.c.image_id == Image.id)
        .join(Tag, Tag.id == image_tags.c.tag_id)
        .where(selector, Image.gallery_id.isnot(None))
    )
    return or_(
        Gallery.tags.any(selector),
        Gallery.id.in_(image_gallery_ids),
    )


def apply_gallery_tag_filters(
    query,
    *,
    include_raw: str | None = None,
    include_ids_raw: str | None = None,
    include_mode: str = "all",
    exclude_raw: str | None = None,
    exclude_ids_raw: str | None = None,
    exclude_mode: str = "any",
):
    """Apply tag groups against each gallery's combined gallery/file tag set."""
    include_selectors = _tag_selectors(include_raw, include_ids_raw)
    exclude_selectors = _tag_selectors(exclude_raw, exclude_ids_raw)

    if include_selectors:
        query = query.filter(_combine([_gallery_has_tag(s) for s in include_selectors], include_mode))

    if exclude_selectors:
        query = query.filter(~_combine([_gallery_has_tag(s) for s in exclude_selectors], exclude_mode))

    return query
