"""Source-aligned foil surface maps derived from image detail and packed masks."""

import os

import numpy as np
from PIL import Image as PILImage, ImageFilter


FOIL_MAP_VERSION = "detail-etch-v2"
FOIL_LONG_EDGE = 1536


def foil_maps_dir() -> str:
    from database import DATA_DIR

    directory = os.path.join(DATA_DIR, "foil_maps")
    os.makedirs(directory, exist_ok=True)
    return directory


def foil_map_path(image_id: int) -> str:
    return os.path.join(foil_maps_dir(), f"{int(image_id)}.png")


def foil_map_url(image_id: int) -> str | None:
    path = foil_map_path(image_id)
    if not os.path.exists(path):
        return None
    stamp = int(os.path.getmtime(path))
    return f"/foil-maps/{int(image_id)}.png?v={FOIL_MAP_VERSION}-{stamp}"


def ensure_foil_map(image) -> dict | None:
    """Create a cached map after a usable packed mask exists."""
    from services.masking import is_temporal_source

    if (not image or is_temporal_source(image)
            or not getattr(image, "file_path", None)
            or not os.path.isfile(image.file_path)
            or not getattr(image, "mask_path", None)
            or not os.path.isfile(image.mask_path)):
        return None
    out_path = foil_map_path(image.id)
    if os.path.isfile(out_path):
        return {"path": out_path, "version": FOIL_MAP_VERSION, "cached": True}
    return generate_foil_map(image.file_path, image.mask_path, out_path)


def _target_size(width: int, height: int) -> tuple[int, int]:
    scale = FOIL_LONG_EDGE / max(width, height)
    return max(1, round(width * scale)), max(1, round(height * scale))


def _as_float(image: PILImage.Image) -> np.ndarray:
    return np.asarray(image, dtype=np.float32) / 255.0


def generate_foil_map(image_path: str, packed_mask_path: str, out_path: str) -> dict:
    """Generate one neutral RGBA relief map in the source image coordinate space."""
    with PILImage.open(image_path) as source_image:
        source = source_image.convert("RGB")
        target_size = _target_size(*source.size)
        source = source.resize(target_size, PILImage.Resampling.LANCZOS)

    with PILImage.open(packed_mask_path) as packed_image:
        packed = packed_image.convert("RGBA").resize(target_size, PILImage.Resampling.BILINEAR)

    rgb = _as_float(source)
    luma = rgb[..., 0] * 0.2126 + rgb[..., 1] * 0.7152 + rgb[..., 2] * 0.0722
    luma_image = PILImage.fromarray((luma * 255).astype(np.uint8), mode="L")
    broad = _as_float(luma_image.filter(ImageFilter.GaussianBlur(10)))
    fine = _as_float(luma_image.filter(ImageFilter.GaussianBlur(2)))
    edges = _as_float(luma_image.filter(ImageFilter.FIND_EDGES).filter(ImageFilter.GaussianBlur(.7)))

    height, width = luma.shape
    yy, xx = np.mgrid[0:height, 0:width].astype(np.float32)
    phase_detail = broad * np.pi * 5.0
    primary_etch = np.sin((xx * .72 + yy * .34) * (2 * np.pi / 7.0) + phase_detail)
    cross_etch = np.sin((-xx * .28 + yy * .96) * (2 * np.pi / 13.0) - phase_detail * .35)
    etch = primary_etch * .68 + cross_etch * .32

    high_pass = np.clip(luma - broad, -.35, .35)
    micro_detail = np.clip(luma - fine, -.2, .2)
    relief = np.clip(.5 + high_pass * .72 + micro_detail * .55 + etch * .055 + edges * .16, 0, 1)

    subject = _as_float(packed.getchannel(0))
    edge_band = _as_float(packed.getchannel(1))
    background = 1.0 - subject
    region_strength = background * .78 + subject * .24 + edge_band * .16
    relief_alpha = np.clip((relief - .28) / .54, 0, 1)
    alpha = np.clip(region_strength * (.2 + relief_alpha * .8), .06, .9)

    surface = np.stack([
        np.clip(relief + etch * .018, 0, 1),
        relief,
        np.clip(relief - etch * .018, 0, 1),
        alpha,
    ], axis=-1)
    output = PILImage.fromarray((surface * 255).astype(np.uint8), mode="RGBA")
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    output.save(out_path, "PNG", optimize=True)
    return {
        "path": out_path,
        "width": width,
        "height": height,
        "version": FOIL_MAP_VERSION,
    }
