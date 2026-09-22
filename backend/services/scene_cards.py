"""Deterministic eligibility and recipe helpers for TCG V2 Scene cards.

This module deliberately contains no database writes. Mint orchestration can
call it with real source metadata, then persist the returned frozen-data recipe
alongside the card when the V2 schema is enabled.
"""

from __future__ import annotations

import colorsys
from collections import deque
from datetime import datetime
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image as PILImage, ImageFilter


CANVAS_WIDTH = 1024
CANVAS_HEIGHT = 1536
MIN_COVERAGE = 0.07
MAX_COVERAGE = 0.72
MAX_TOUCHED_EDGES = 1
MAX_AUTO_FILLED_HOLE_FRACTION = 0.01
MAX_MIRROR_DISAGREEMENT = 0.085
MAX_CROSS_MODEL_MERGE_DISAGREEMENT = 0.05
SCENE_MASK_PIPELINE_VERSION = "scene-mask-hybrid-v2"
TEXT_ZONES = {
    "creatorIdentity": (360, 20, 620, 160),
    "subjectName": (48, 360, 150, 610),
}


def extract_scene_outline_palette(source_path: str) -> tuple[str, str]:
    """Choose two visible outline colors while preserving source-image hues."""
    path = Path(source_path)
    if not path.is_file():
        raise ValueError("Scene palette source file is missing")
    with PILImage.open(path) as image:
        sample = image.convert("RGB")
        sample.thumbnail((192, 192), PILImage.Resampling.LANCZOS)
        quantized = sample.quantize(colors=12, method=PILImage.Quantize.MEDIANCUT).convert("RGB")
        counted = quantized.getcolors(maxcolors=256) or []

    ranked = []
    for count, rgb in counted:
        hue, saturation, value = colorsys.rgb_to_hsv(*(channel / 255 for channel in rgb))
        ranked.append((count * (.24 + saturation) * (.45 + value), hue, saturation, value))
    ranked.sort(reverse=True)
    if not ranked:
        raise ValueError("Scene palette source has no colors")

    first = ranked[0]
    second = next((entry for entry in ranked[1:]
                   if min(abs(entry[1] - first[1]), 1 - abs(entry[1] - first[1])) >= .08),
                  ranked[min(1, len(ranked) - 1)])

    def visible_hex(entry):
        _, hue, saturation, _ = entry
        rgb = colorsys.hsv_to_rgb(hue, max(.48, min(.88, saturation)), .96)
        return "#" + "".join(f"{round(channel * 255):02X}" for channel in rgb)

    return visible_hex(first), visible_hex(second)


def _components(hard: np.ndarray) -> list[list[int]]:
    """Return 4-connected foreground components as flat pixel indices."""
    height, width = hard.shape
    seen = np.zeros_like(hard, dtype=bool)
    components: list[list[int]] = []
    for start_y, start_x in zip(*np.where(hard & ~seen)):
        if seen[start_y, start_x]:
            continue
        queue = deque([(int(start_y), int(start_x))])
        seen[start_y, start_x] = True
        pixels: list[int] = []
        while queue:
            y, x = queue.popleft()
            pixels.append(y * width + x)
            for next_y, next_x in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
                if (0 <= next_y < height and 0 <= next_x < width
                        and hard[next_y, next_x] and not seen[next_y, next_x]):
                    seen[next_y, next_x] = True
                    queue.append((next_y, next_x))
        components.append(pixels)
    return components


def clean_scene_matte(matte: np.ndarray) -> np.ndarray:
    """Remove thin background bridges and detached false positives."""
    matte_u8 = np.clip(matte, 0, 255).astype(np.uint8)
    source_height, source_width = matte_u8.shape
    scale = min(1.0, 384 / max(source_width, source_height))
    work_size = (max(1, round(source_width * scale)), max(1, round(source_height * scale)))
    work = PILImage.fromarray(matte_u8, "L").resize(work_size, PILImage.Resampling.BILINEAR)
    hard_image = work.point(lambda value: 255 if value >= 48 else 0)
    opened = hard_image.filter(ImageFilter.MinFilter(3)).filter(ImageFilter.MaxFilter(5))
    opened_hard = np.asarray(opened, dtype=np.uint8) >= 128
    components = _components(opened_hard)
    if not components:
        return np.zeros_like(matte_u8)
    largest = max(len(component) for component in components)
    minimum = max(90, round(largest * 0.018))
    keep = np.zeros(opened_hard.size, dtype=np.uint8)
    for component in components:
        if len(component) >= minimum:
            keep[np.asarray(component, dtype=np.int64)] = 255
    keep = keep.reshape(opened_hard.shape)
    hole_fill = np.zeros_like(keep)
    work_height, work_width = keep.shape
    maximum_hole = round(keep.size * MAX_AUTO_FILLED_HOLE_FRACTION)
    for component in _components(keep == 0):
        indexes = np.asarray(component, dtype=np.int64)
        ys, xs = indexes // work_width, indexes % work_width
        touches_border = bool(
            (ys == 0).any() or (ys == work_height - 1).any()
            or (xs == 0).any() or (xs == work_width - 1).any()
        )
        if not touches_border and len(component) <= maximum_hole:
            hole_fill.reshape(-1)[indexes] = 255
    keep = np.maximum(keep, hole_fill)
    keep_image = PILImage.fromarray(keep, "L").filter(ImageFilter.MaxFilter(5)).filter(
        ImageFilter.GaussianBlur(0.8)
    )
    gate = np.asarray(
        keep_image.resize((source_width, source_height), PILImage.Resampling.BILINEAR),
        dtype=np.float32,
    ) / 255.0
    filled = np.asarray(
        PILImage.fromarray(hole_fill, "L").filter(ImageFilter.GaussianBlur(0.65)).resize(
            (source_width, source_height), PILImage.Resampling.BILINEAR
        ),
        dtype=np.float32,
    )
    cleaned = matte_u8.astype(np.float32) * gate
    return np.round(np.maximum(cleaned, filled)).astype(np.uint8)


def project_scene_matte(matte: np.ndarray, *, source_width: int,
                        source_height: int, focal_x: float = 0.5,
                        focal_y: float = 0.5) -> np.ndarray:
    """Project a source matte using the same cover geometry as SceneCard."""
    if source_width <= 0 or source_height <= 0:
        raise ValueError("Scene matte projection requires source dimensions")
    scale = max(CANVAS_WIDTH / source_width, CANVAS_HEIGHT / source_height)
    rendered_width = round(source_width * scale)
    rendered_height = round(source_height * scale)
    x = round(-(rendered_width - CANVAS_WIDTH) * min(1.0, max(0.0, focal_x)))
    y = round(-(rendered_height - CANVAS_HEIGHT) * min(1.0, max(0.0, focal_y)))

    rendered = PILImage.fromarray(np.clip(matte, 0, 255).astype(np.uint8), "L").resize(
        (rendered_width, rendered_height), PILImage.Resampling.BILINEAR
    )
    canvas = PILImage.new("L", (CANVAS_WIDTH, CANVAS_HEIGHT), 0)
    canvas.paste(rendered, (x, y))
    return np.asarray(canvas, dtype=np.uint8)


def combine_scene_mattes(primary: np.ndarray, secondary: np.ndarray) -> tuple[np.ndarray, dict[str, Any]]:
    """Recover conservative omissions only when two independent models agree."""
    primary_f = np.clip(primary, 0, 255).astype(np.float32) / 255.0
    secondary_f = np.clip(secondary, 0, 255).astype(np.float32) / 255.0
    disagreement = float(np.mean(np.abs(primary_f - secondary_f)))
    merged = disagreement <= MAX_CROSS_MODEL_MERGE_DISAGREEMENT
    result = np.maximum(primary_f, secondary_f) if merged else primary_f
    return np.round(result * 255).astype(np.uint8), {
        "crossModelDisagreement": round(disagreement, 6),
        "crossModelMerged": merged,
    }


def evaluate_scene_matte(matte: np.ndarray, *, person_count: int | None = None,
                         mirror_disagreement: float | None = None,
                         cross_model_disagreement: float | None = None) -> dict[str, Any]:
    """Return a strict eligibility result with stable, user-readable reasons."""
    hard = np.asarray(matte, dtype=np.uint8) >= 96
    coverage = float(hard.mean())
    margin = 8
    touched = {
        "top": bool(hard[:margin, :].any()),
        "right": bool(hard[:, -margin:].any()),
        "bottom": bool(hard[-margin:, :].any()),
        "left": bool(hard[:, :margin].any()),
    }
    zone_occupancy = {
        name: round(float(hard[y:y + height, x:x + width].mean()), 4)
        for name, (x, y, width, height) in TEXT_ZONES.items()
    }
    reasons: list[str] = []
    warnings: list[str] = []
    if coverage < MIN_COVERAGE:
        reasons.append("subject-too-small")
    if coverage > MAX_COVERAGE:
        reasons.append("subject-dominates-frame")
    if sum(touched.values()) > MAX_TOUCHED_EDGES:
        warnings.append("silhouette-touches-too-many-edges")
    if touched["top"] or touched["left"] or touched["right"]:
        warnings.append("silhouette-clipped-by-card-edge")
    if zone_occupancy["creatorIdentity"] > 0.08:
        warnings.append("subject-collides-with-creator-identity")
    if zone_occupancy["subjectName"] > 0.12:
        warnings.append("subject-collides-with-name-rail")
    if person_count is not None and person_count != 1:
        warnings.append("multiple-people-detected")
    if mirror_disagreement is not None and mirror_disagreement > MAX_MIRROR_DISAGREEMENT:
        warnings.append("mirrored-pass-disagrees")
    if (cross_model_disagreement is not None
            and cross_model_disagreement > MAX_CROSS_MODEL_MERGE_DISAGREEMENT):
        warnings.append("independent-models-disagree")
    return {
        "coverage": round(coverage, 4),
        "touchedEdges": [name for name, value in touched.items() if value],
        "textZoneOccupancy": zone_occupancy,
        "personCount": person_count,
        "mirrorDisagreement": (
            None if mirror_disagreement is None else round(float(mirror_disagreement), 6)
        ),
        "crossModelDisagreement": (
            None if cross_model_disagreement is None else round(float(cross_model_disagreement), 6)
        ),
        "accepted": not reasons,
        "reasons": reasons,
        "warnings": warnings,
    }


def scene_mask_quality(metrics: dict[str, Any]) -> float:
    """Convert the strict scene decision into the shared mask confidence field.

    Scene eligibility is deliberately binary: a warning may still be rendered,
    but a hard extraction reason must use the flat-card fallback.  Keeping the
    stored value binary prevents the generic ``MIN_QUALITY`` gate from making a
    different decision than the scene evaluator.
    """
    return 1.0 if metrics.get("accepted") else 0.0


def build_scene_recipe(*, rarity: str, creator_name: str, creator_type: str,
                       subject_name: str, period_label: str, card_id: str,
                       minted_at: datetime | str, image_id: int | None,
                       source_width: int, source_height: int,
                       focal_x: float, focal_y: float,
                       outline_primary: str, outline_secondary: str,
                       mask_metrics: dict[str, Any] | None,
                       mask_pipeline_version: str = SCENE_MASK_PIPELINE_VERSION) -> dict[str, Any]:
    """Build the immutable-data payload; missing display data is an error."""
    values = {
        "creatorName": creator_name,
        "creatorType": creator_type,
        "subjectName": subject_name,
        "periodLabel": period_label,
        "cardId": card_id,
    }
    missing = [key for key, value in values.items() if not str(value or "").strip()]
    if missing:
        raise ValueError("Scene recipe missing real data: " + ", ".join(missing))
    rarity = rarity.upper()
    if rarity not in {"C", "R", "SR", "UR", "SPR"}:
        raise ValueError(f"Unsupported Scene rarity: {rarity}")
    metrics = dict(mask_metrics or {})
    layered = bool(metrics.get("accepted"))
    failure_reasons = [str(reason) for reason in (metrics.get("reasons") or []) if reason]
    if not layered and not failure_reasons:
        failure_reasons = ["mask-not-available"]
    visual_mode = "layered" if layered else "flat"
    minted_value = minted_at.isoformat() if isinstance(minted_at, datetime) else str(minted_at or "").strip()
    if not minted_value:
        raise ValueError("Scene recipe missing real data: mintedAt")
    if source_width <= 0 or source_height <= 0:
        raise ValueError("Scene recipe requires valid source dimensions")
    return {
        "schema": "vault.scene-card-recipe",
        "version": 1,
        "templateId": "scene-floral-outline-v1",
        "cardType": "scene",
        "rarity": rarity,
        "visualMode": visual_mode,
        "snapshot": {
            **values,
            "periodLabel": period_label.upper(),
            "mintedAt": minted_value,
        },
        "source": {
            "imageId": image_id,
            "width": source_width,
            "height": source_height,
            "focalX": min(1.0, max(0.0, float(focal_x))),
            "focalY": min(1.0, max(0.0, float(focal_y))),
        },
        "outline": {"primary": outline_primary, "secondary": outline_secondary},
        "extraction": {
            "status": "usable" if layered else "fallback",
            "failureReason": None if layered else ",".join(failure_reasons),
            "pipelineVersion": str(mask_pipeline_version or SCENE_MASK_PIPELINE_VERSION),
        },
        "maskMetrics": metrics,
        "effectHooks": [
            "photograph", "background-foil", "subject-foil", "edge-foil",
            "outline", "frame", "rarity", "text", "signature",
        ],
    }
