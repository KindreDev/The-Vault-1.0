"""Deterministic recipes and palette selection for TCG V2 Character cards."""

from __future__ import annotations

import colorsys
import json
import math
import os
from datetime import datetime
from pathlib import Path
from typing import Any, Iterable

import numpy as np
from PIL import Image as PILImage


CHARACTER_MASK_PIPELINE_VERSION = "scene-mask-hybrid-v2"
MIN_CHARACTER_CUTOUT_COVERAGE = 0.30
MAX_CHARACTER_CUTOUT_COVERAGE = 0.80
MAX_CHARACTER_MIRROR_DISAGREEMENT = 0.085
MIN_CHARACTER_SILHOUETTE_SOLIDITY = 0.77
MAX_CHARACTER_SOFT_INTERIOR_FRACTION = 0.08


def _hex(rgb: tuple[int, int, int]) -> str:
    return "#" + "".join(f"{max(0, min(255, int(value))):02X}" for value in rgb)


def _rgb(hex_color: str) -> tuple[int, int, int]:
    value = hex_color.lstrip("#")
    if len(value) != 6:
        raise ValueError(f"Invalid palette color: {hex_color}")
    return tuple(int(value[index:index + 2], 16) for index in (0, 2, 4))


def _relative_luminance(rgb: tuple[int, int, int]) -> float:
    channels = []
    for value in rgb:
        channel = value / 255
        channels.append(channel / 12.92 if channel <= 0.04045 else ((channel + 0.055) / 1.055) ** 2.4)
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]


def contrast_ratio(first: str, second: str) -> float:
    light, dark = sorted((_relative_luminance(_rgb(first)), _relative_luminance(_rgb(second))), reverse=True)
    return (light + 0.05) / (dark + 0.05)


def derive_character_palette(source_colors: Iterable[tuple[int, int, int]]) -> dict[str, str]:
    """Create a bright print palette from real source hues, with safe contrast."""
    colors = [tuple(map(int, color)) for color in source_colors]
    if not colors:
        raise ValueError("Character palette requires real source colors")
    ranked = sorted(colors, key=lambda color: colorsys.rgb_to_hsv(*(value / 255 for value in color))[1], reverse=True)
    hue, saturation, _ = colorsys.rgb_to_hsv(*(value / 255 for value in ranked[0]))
    accent_hue = (hue + 0.47) % 1.0
    secondary_hue = (hue + 0.16) % 1.0
    background = _hex(tuple(round(value * 255) for value in colorsys.hsv_to_rgb(hue, max(0.58, saturation), 0.96)))
    primary = _hex(tuple(round(value * 255) for value in colorsys.hsv_to_rgb(accent_hue, 0.72, 0.78)))
    secondary = _hex(tuple(round(value * 255) for value in colorsys.hsv_to_rgb(secondary_hue, 0.78, 0.95)))
    ink = "#111318" if contrast_ratio(background, "#111318") >= 4.5 else "#FFF9E8"
    return {"background": background, "primary": primary, "secondary": secondary, "ink": ink}


def extract_character_palette(source_path: str, color_count: int = 8) -> dict[str, str]:
    path = Path(source_path)
    if not path.is_file():
        raise ValueError("Character palette source file is missing")
    with PILImage.open(path) as image:
        sample = image.convert("RGB")
        sample.thumbnail((192, 192), PILImage.Resampling.LANCZOS)
        quantized = sample.quantize(colors=color_count, method=PILImage.Quantize.MEDIANCUT).convert("RGB")
        colors = [color for count, color in quantized.getcolors(maxcolors=256) or [] if count > 0]
    return derive_character_palette(colors)


def _convex_hull(points: list[tuple[int, int]]) -> list[tuple[int, int]]:
    """Andrew's monotone chain; enough for a small diagnostic silhouette."""
    unique = sorted(set(points))
    if len(unique) <= 1:
        return unique

    def cross(origin, first, second):
        return ((first[0] - origin[0]) * (second[1] - origin[1])
                - (first[1] - origin[1]) * (second[0] - origin[0]))

    lower: list[tuple[int, int]] = []
    for point in unique:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], point) <= 0:
            lower.pop()
        lower.append(point)
    upper: list[tuple[int, int]] = []
    for point in reversed(unique):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], point) <= 0:
            upper.pop()
        upper.append(point)
    return lower[:-1] + upper[:-1]


def _polygon_area(points: list[tuple[int, int]]) -> float:
    if len(points) < 3:
        return 0.0
    return abs(sum(
        first[0] * second[1] - second[0] * first[1]
        for first, second in zip(points, points[1:] + points[:1])
    )) / 2


def _silhouette_solidity(hard: np.ndarray) -> float:
    """Foreground area divided by its convex hull, measured on a small grid."""
    height, width = hard.shape
    scale = min(1.0, 128 / max(width, height))
    sample = PILImage.fromarray((hard * 255).astype(np.uint8), "L").resize(
        (max(1, round(width * scale)), max(1, round(height * scale))),
        PILImage.Resampling.NEAREST,
    )
    sampled = np.asarray(sample, dtype=np.uint8) >= 128
    ys, xs = np.where(sampled)
    if not len(xs):
        return 0.0
    hull = _convex_hull(list(zip(xs.tolist(), ys.tolist())))
    hull_area = _polygon_area(hull)
    return min(1.0, float(sampled.sum()) / hull_area) if hull_area > 0 else 0.0


def evaluate_character_matte(matte: np.ndarray, *,
                             mirror_disagreement: float | None = None) -> dict[str, Any]:
    """Decide whether a matte supports the bold Character cutout treatment.

    A mask may be technically coherent yet still make a poor pop-art card when
    the subject is tiny. Those images remain eligible and use the full-bleed
    Character template instead.
    """
    values = np.asarray(matte, dtype=np.uint8)
    hard = values >= 96
    coverage = float(hard.mean())
    solidity = _silhouette_solidity(hard)
    confident = values >= 220
    soft_interior_fraction = (
        float((hard & ~confident).sum()) / float(hard.sum()) if hard.any() else 1.0
    )
    reasons: list[str] = []
    if coverage < MIN_CHARACTER_CUTOUT_COVERAGE:
        reasons.append("subject-too-small-for-character-cutout")
    if coverage > MAX_CHARACTER_CUTOUT_COVERAGE:
        reasons.append("subject-dominates-character-frame")
    if solidity < MIN_CHARACTER_SILHOUETTE_SOLIDITY:
        reasons.append("irregular-character-silhouette")
    if soft_interior_fraction > MAX_CHARACTER_SOFT_INTERIOR_FRACTION:
        reasons.append("soft-character-silhouette")
    if (mirror_disagreement is not None
            and mirror_disagreement > MAX_CHARACTER_MIRROR_DISAGREEMENT):
        reasons.append("unstable-subject-extraction")
    return {
        "coverage": round(coverage, 4),
        "silhouetteSolidity": round(solidity, 4),
        "softInteriorFraction": round(soft_interior_fraction, 4),
        "mirrorDisagreement": (
            None if mirror_disagreement is None else round(float(mirror_disagreement), 6)
        ),
        "accepted": not reasons,
        "reasons": reasons,
    }


def build_character_recipe(*, rarity: str, character_id: int, character_name: str,
                           series: str | None, card_id: str, minted_at: datetime | str,
                           image_id: int | None, source_width: int, source_height: int,
                           focal_x: float, focal_y: float, palette: dict[str, str],
                           mask_metrics: dict[str, Any] | None,
                           mask_pipeline_version: str = CHARACTER_MASK_PIPELINE_VERSION,
                           orb_icon: str = "star", source_kind: str = "image") -> dict[str, Any]:
    rarity = str(rarity or "").upper()
    if rarity not in {"C", "R", "SR", "UR", "SPR"}:
        raise ValueError(f"Unsupported Character rarity: {rarity}")
    if not character_id:
        raise ValueError("Character recipe requires a real character ID")
    if source_kind not in {"image", "avatar"}:
        raise ValueError(f"Unsupported Character source kind: {source_kind}")
    if source_kind == "image" and not image_id:
        raise ValueError("Character recipe requires a real source image ID")
    required = {"characterName": character_name, "cardId": card_id}
    missing = [key for key, value in required.items() if not str(value or "").strip()]
    if missing:
        raise ValueError("Character recipe missing real data: " + ", ".join(missing))
    if source_width <= 0 or source_height <= 0:
        raise ValueError("Character recipe requires valid source dimensions")
    for role in ("background", "primary", "secondary", "ink"):
        _rgb(palette.get(role, ""))
    metrics = dict(mask_metrics or {})
    extracted = bool(metrics.get("accepted"))
    minted_value = minted_at.isoformat() if isinstance(minted_at, datetime) else str(minted_at or "").strip()
    if not minted_value:
        raise ValueError("Character recipe missing real data: mintedAt")
    reasons = [str(reason) for reason in metrics.get("reasons", []) if reason]
    if not extracted and not reasons:
        reasons = ["mask-not-available"]
    return {
        "schema": "vault.character-card-recipe",
        "version": 1,
        "cardType": "character",
        "rarity": rarity,
        "templateId": "character-pop-art-v1" if extracted else "character-full-bleed-v1",
        "visualMode": "cutout" if extracted else "full-bleed",
        "snapshot": {
            "characterId": character_id,
            "characterName": str(character_name).strip(),
            "series": str(series or "").strip() or None,
            "cardId": str(card_id).strip(),
            "mintedAt": minted_value,
        },
        "source": {
            "kind": source_kind,
            "imageId": image_id,
            "characterId": character_id if source_kind == "avatar" else None,
            "width": source_width,
            "height": source_height,
            "focalX": min(1.0, max(0.0, float(focal_x))),
            "focalY": min(1.0, max(0.0, float(focal_y))),
        },
        "palette": dict(palette),
        "orbIcon": str(orb_icon or "star"),
        "extraction": {
            "status": "usable" if extracted else "fallback",
            "failureReason": None if extracted else ",".join(reasons),
            "pipelineVersion": str(mask_pipeline_version or CHARACTER_MASK_PIPELINE_VERSION),
        },
        "maskMetrics": metrics,
        "effectHooks": ["background", "background-foil", "subject", "subject-foil", "edge-foil", "frame", "rarity", "signature", "orb"],
    }


def _candidate_score(image, *, direct_link: bool) -> tuple:
    """Deterministic source ranking using only real collection metadata."""
    width, height = int(image.width or 0), int(image.height or 0)
    pixels = width * height
    aspect = width / height if height else 0.0
    portrait_fit = max(0.0, 1.0 - abs(aspect - (2 / 3)))
    engagement = math.log1p(
        max(0, int(image.view_count or 0))
        + max(0, int(image.cum_count or 0)) * 8
        + max(0, int(image.view_seconds or 0)) / 30
    )
    # Exact file-level character links beat inherited gallery links. Everything
    # after that chooses the strongest actual photograph without randomness.
    return (
        1 if direct_link else 0,
        1 if image.is_favorite else 0,
        float(image.rating or 0),
        round(engagement, 6),
        round(portrait_fit, 6),
        pixels,
        -int(image.id or 0),
    )


def select_character_source(db, character_id: int, *, excluded_image_ids: Iterable[int] = ()) -> dict[str, Any] | None:
    """Choose a Character card's full-resolution source, falling back to avatar.

    Images explicitly linked to the character are strongest, followed by still
    images in galleries linked through either the current M2M or legacy FKs.
    The returned selection is deterministic and can therefore be frozen safely.
    """
    from sqlalchemy import or_, select
    from models import Creator, Gallery, Image, gallery_creators, image_creators

    character = db.query(Creator).filter(Creator.id == character_id).first()
    if not character:
        raise ValueError("Character not found")
    creator_type = character.creator_type.value if hasattr(character.creator_type, "value") else character.creator_type
    if creator_type != "character":
        raise ValueError("Character source selection requires a character-type creator")

    linked_gallery_ids = select(gallery_creators.c.gallery_id).where(
        gallery_creators.c.creator_id == character_id
    )
    direct_image_ids = {
        row[0] for row in db.query(image_creators.c.image_id).filter(
            image_creators.c.creator_id == character_id
        ).all()
    }
    excluded = {int(value) for value in excluded_image_ids if value}
    query = db.query(Image).filter(
        Image.is_video == False,  # noqa: E712
        Image.file_path.isnot(None),
        Image.width.isnot(None),
        Image.height.isnot(None),
        or_(
            Image.id.in_(direct_image_ids or {-1}),
            Image.gallery_id.in_(linked_gallery_ids),
            Image.gallery_id.in_(
                select(Gallery.id).where(or_(
                    Gallery.creator_id == character_id,
                    Gallery.linked_character_id == character_id,
                ))
            ),
        ),
    )
    if excluded:
        query = query.filter(~Image.id.in_(excluded))
    candidates = [image for image in query.all()
                  if int(image.width or 0) > 0 and int(image.height or 0) > 0
                  and os.path.isfile(image.file_path)]
    if candidates:
        chosen = max(candidates, key=lambda image: _candidate_score(
            image, direct_link=image.id in direct_image_ids
        ))
        return {"kind": "image", "image": chosen, "character": character}

    if character.avatar_path and os.path.isfile(character.avatar_path):
        with PILImage.open(character.avatar_path) as avatar:
            width, height = avatar.size
        return {
            "kind": "avatar", "image": None, "character": character,
            "path": character.avatar_path, "width": width, "height": height,
        }
    return None


def _matte_from_packed_mask(mask_path: str) -> np.ndarray:
    with PILImage.open(mask_path) as packed:
        return np.asarray(packed.convert("RGBA"), dtype=np.uint8)[..., 0]


def prepare_character_visual(db, card, character_id: int, *, ensure_mask_fn=None) -> dict[str, Any]:
    """Prepare and freeze one real Character render recipe on a Card record."""
    if card.visual_recipe:
        recipe = json.loads(card.visual_recipe)
        if recipe.get("schema") == "vault.character-card-recipe":
            return recipe

    selection = select_character_source(db, character_id)
    if not selection:
        raise ValueError("Character has no eligible gallery image or avatar")
    character = selection["character"]
    source_kind = selection["kind"]
    image = selection.get("image")
    source_path = image.file_path if image else selection["path"]
    width = int(image.width if image else selection["width"])
    height = int(image.height if image else selection["height"])
    focal_x = float(image.focal_x if image and image.focal_x is not None else 0.5)
    focal_y = float(image.focal_y if image and image.focal_y is not None else 0.25)

    metrics: dict[str, Any] = {"accepted": False, "reasons": ["avatar-source"]}
    pipeline_version = CHARACTER_MASK_PIPELINE_VERSION
    if image:
        card.source_image_id = image.id
        if ensure_mask_fn is None:
            from services.masking import ensure_mask as ensure_mask_fn
        mask_info = ensure_mask_fn(db, image)
        pipeline_version = image.mask_pipeline_version or CHARACTER_MASK_PIPELINE_VERSION
        if (mask_info and mask_info.get("usable") and image.mask_path
                and os.path.isfile(image.mask_path)):
            metrics = evaluate_character_matte(_matte_from_packed_mask(image.mask_path))
        else:
            reason = image.mask_failure_reason or "mask-not-available"
            metrics = {"accepted": False, "reasons": [reason]}

    recipe = build_character_recipe(
        rarity=(card.rarity_class or "C"),
        character_id=character.id,
        character_name=character.name,
        series=character.series,
        card_id=f"CHR-{card.id:06d}",
        minted_at=card.generated_at,
        image_id=image.id if image else None,
        source_width=width,
        source_height=height,
        focal_x=focal_x,
        focal_y=focal_y,
        palette=extract_character_palette(source_path),
        mask_metrics=metrics,
        mask_pipeline_version=pipeline_version,
        source_kind=source_kind,
    )
    card.visual_recipe = json.dumps(recipe, separators=(",", ":"), sort_keys=True)
    db.flush()
    return recipe
