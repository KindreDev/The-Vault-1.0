"""Deterministic media provenance detection from embedded file metadata."""

import json
from pathlib import Path
from typing import Any

from PIL import Image as PILImage
from sqlalchemy import func
from sqlalchemy.orm import Session

from models import Image, Tag, TagSource


AI_GENERATED_TAG = "ai generated"
_METADATA_IMAGE_EXTENSIONS = {".png", ".webp"}


def _json_value(value: Any) -> Any:
    if isinstance(value, (dict, list)):
        return value
    if isinstance(value, bytes):
        value = value.decode("utf-8", errors="ignore").lstrip("\x00")
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        return json.loads(value)
    except (TypeError, ValueError, json.JSONDecodeError):
        return None


def _is_comfy_prompt(value: Any) -> bool:
    prompt = _json_value(value)
    return isinstance(prompt, dict) and any(
        isinstance(node, dict) and isinstance(node.get("class_type"), str)
        for node in prompt.values()
    )


def _is_comfy_workflow(value: Any) -> bool:
    workflow = _json_value(value)
    if not isinstance(workflow, dict):
        return False
    nodes = workflow.get("nodes")
    return isinstance(nodes, list) and any(
        isinstance(node, dict) and ("type" in node or "class_type" in node)
        for node in nodes
    )


def detect_generation_source(file_path: str) -> str | None:
    """Return ``comfyui`` only when embedded metadata has its workflow shape.

    Reading Pillow's ``info`` parses container metadata without decoding the
    image pixels, so this stays cheap enough to run during normal import.
    """
    if Path(file_path).suffix.lower() not in _METADATA_IMAGE_EXTENSIONS:
        return None
    try:
        with PILImage.open(file_path) as image:
            metadata = dict(image.info or {})
            if _is_comfy_prompt(metadata.get("prompt")):
                return "comfyui"
            if _is_comfy_workflow(metadata.get("workflow")):
                return "comfyui"
    except (OSError, ValueError, TypeError):
        return None
    return None


def apply_generation_provenance_tag(db: Session, image: Image, file_path: str) -> bool:
    """Attach the deterministic AI provenance tag when metadata proves it."""
    if detect_generation_source(file_path) != "comfyui":
        return False

    tag = (
        db.query(Tag)
        .filter(func.lower(Tag.name) == AI_GENERATED_TAG)
        .first()
    )
    if tag is None:
        tag = Tag(
            name=AI_GENERATED_TAG,
            category="source",
            source=TagSource.manual,
        )
        db.add(tag)
        db.flush()

    if tag in image.tags:
        return False
    image.tags.append(tag)
    tag.use_count += 1
    return True
