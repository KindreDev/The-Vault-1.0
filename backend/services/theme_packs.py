"""Validate and store local cosmetic packs outside the source checkout."""
from __future__ import annotations

import json
import re
import shutil
import tempfile
import zipfile
from datetime import datetime
from pathlib import Path

from database import DATA_DIR

PACK_ROOT = Path(DATA_DIR) / "theme_packs"
PACK_ID = re.compile(r"[a-z0-9][a-z0-9-]{0,63}\Z")
ASSET_PATH = re.compile(r"assets/[a-f0-9]{32}\.(?:png|jpg|webp|gif|avif)\Z")
FONT_PATH = re.compile(r"assets/[a-f0-9]{32}\.(?:woff2|woff|ttf|otf)\Z")
COLOR = re.compile(r"#[0-9a-fA-F]{6}\Z")
SIZES = ("compact", "standard", "wide", "4k")
SCOPES = {
    "page", "modal", "dashboard-curation", "dashboard-session",
    "sidebar-brand", "page-heading", "dashboard-tools", "settings-option",
}
PAGES = {
    "all",
    "dashboard", "feed", "explore", "galleries", "gallery-detail", "images", "videos",
    "funscripts", "creators", "creator-detail", "playlists", "playlist-detail",
    "multi-panel", "device-control", "quests", "stats", "recap", "xp-history",
    "settings", "scan-log", "collection", "collection-room", "profile",
    "hall-of-fame", "tags", "duplicates", "task-queue", "console", "help", "erika",
}
PALETTE_KEYS = ("accent", "pink", "amber", "green", "bg", "surface", "card")
TEXTURE_SLOTS = ("panel", "button", "sidebar")
TEXT_KEYS = ("primary", "secondary", "muted")


def _number(value, low, high):
    if isinstance(value, bool):
        raise ValueError("Invalid placement number")
    result = float(value)
    if not low <= result <= high:
        raise ValueError("Placement is outside the canvas")
    return round(result, 6)


def validate_manifest(raw):
    if not isinstance(raw, dict) or raw.get("format") != "vault-theme-pack" or raw.get("version") != 1:
        raise ValueError("Unsupported theme pack")
    pack_id = raw.get("id")
    if not isinstance(pack_id, str) or not PACK_ID.fullmatch(pack_id):
        raise ValueError("Invalid theme pack ID")
    name = raw.get("name")
    if not isinstance(name, str) or not name.strip() or len(name) > 100:
        raise ValueError("Invalid theme pack name")
    palette = raw.get("palette")
    if not isinstance(palette, dict) or any(not isinstance(palette.get(key), str) or not COLOR.fullmatch(palette[key]) for key in PALETTE_KEYS):
        raise ValueError("Invalid theme pack colors")
    ui = raw.get("ui") or {}
    if not isinstance(ui, dict):
        raise ValueError("Invalid theme UI")
    textures = ui.get("textures") or {}
    if not isinstance(textures, dict):
        raise ValueError("Invalid theme textures")
    cleaned_textures = {}
    for slot in TEXTURE_SLOTS:
        asset = textures.get(slot)
        if asset is not None:
            if not isinstance(asset, str) or not ASSET_PATH.fullmatch(asset):
                raise ValueError("Invalid theme texture path")
            cleaned_textures[slot] = asset
    preview = ui.get("preview")
    if preview is not None and (not isinstance(preview, str) or not ASSET_PATH.fullmatch(preview)):
        raise ValueError("Invalid theme preview path")
    edge = ui.get("edge", palette["amber"])
    if not isinstance(edge, str) or not COLOR.fullmatch(edge):
        raise ValueError("Invalid theme edge color")
    text_colors = ui.get("text") or {}
    if not isinstance(text_colors, dict) or any(
        key not in TEXT_KEYS or not isinstance(value, str) or not COLOR.fullmatch(value)
        for key, value in text_colors.items()
    ):
        raise ValueError("Invalid theme text colors")
    font = ui.get("font")
    if font is not None:
        if not isinstance(font, dict):
            raise ValueError("Invalid theme font")
        asset = font.get("asset")
        label = font.get("label")
        notice = font.get("notice", "")
        if (not isinstance(asset, str) or not FONT_PATH.fullmatch(asset)
                or not isinstance(label, str) or not 1 <= len(label.strip()) <= 64
                or not isinstance(notice, str) or len(notice) > 16000):
            raise ValueError("Invalid theme font")
        font = {"asset": asset, "label": label.strip(), "notice": notice}
    layers = raw.get("layers")
    if not isinstance(layers, list) or len(layers) > 500:
        raise ValueError("Invalid theme pack layers")
    cleaned = []
    for layer in layers:
        if not isinstance(layer, dict) or layer.get("page") not in PAGES or layer.get("state") not in ("default", "empty", "busy", "chat"):
            raise ValueError("Invalid theme page or state")
        asset = layer.get("asset")
        if not isinstance(asset, str) or not ASSET_PATH.fullmatch(asset):
            raise ValueError("Invalid theme image path")
        placements = layer.get("placements") or {}
        if not isinstance(placements, dict):
            raise ValueError("Invalid theme placements")
        responsive = {}
        for size in SIZES:
            if size in placements:
                responsive[size] = {
                    "x": _number(placements[size]["x"], -1, 2),
                    "y": _number(placements[size]["y"], -1, 2),
                    "width": _number(placements[size]["width"], 0.02, 2),
                }
        z = _number(layer.get("z", 0), -100, 100)
        if not z.is_integer():
            raise ValueError("Invalid image order")
        cleaned.append({
            "id": str(layer.get("id", ""))[:64],
            "label": str(layer.get("label") or "Image")[:100],
            "page": layer["page"], "state": layer["state"], "asset": asset,
            "scope": layer.get("scope", "page") if layer.get("scope", "page") in SCOPES else "page",
            "x": _number(layer["x"], -1, 2),
            "y": _number(layer["y"], -1, 2),
            "width": _number(layer["width"], 0.02, 2),
            "placements": responsive,
            "opacity": _number(layer.get("opacity", 1), 0, 1),
            "rotate": _number(layer.get("rotate", 0), -180, 180),
            "mirror": bool(layer.get("mirror", False)),
            "z": int(z),
            "locked": bool(layer.get("locked", False)),
        })
    return {"format": "vault-theme-pack", "version": 1, "id": pack_id,
            "name": name.strip(), "palette": {key: palette[key] for key in PALETTE_KEYS},
            "ui": {"preview": preview, "textures": cleaned_textures, "edge": edge, "text": text_colors, "font": font}, "layers": cleaned}


def _preview_asset(pack):
    """Return the explicit pack preview, with a compatibility fallback for old packs."""
    preview = (pack.get("ui") or {}).get("preview")
    if preview:
        return preview
    return next((layer["asset"] for layer in pack.get("layers", [])
                 if layer.get("scope") == "settings-option"), None)


def list_packs():
    PACK_ROOT.mkdir(parents=True, exist_ok=True)
    packs = []
    for directory in PACK_ROOT.iterdir():
        if not directory.is_dir() or not PACK_ID.fullmatch(directory.name):
            continue
        try:
            pack = validate_manifest(json.loads((directory / "pack.json").read_text(encoding="utf-8")))
            packs.append({"id": pack["id"], "name": pack["name"],
                          "palette": pack["palette"], "image_count": len(pack["layers"]),
                          "preview_asset": _preview_asset(pack),
                          "font": {"label": pack["ui"]["font"]["label"]} if pack["ui"]["font"] else None})
        except (OSError, ValueError, KeyError, TypeError):
            continue
    return sorted(packs, key=lambda item: item["name"].lower())


def get_pack(pack_id):
    if not PACK_ID.fullmatch(pack_id):
        raise ValueError("Invalid theme pack ID")
    path = PACK_ROOT / pack_id / "pack.json"
    if not path.is_file():
        raise FileNotFoundError("Theme pack is not installed")
    return validate_manifest(json.loads(path.read_text(encoding="utf-8")))


def install_pack(file):
    with zipfile.ZipFile(file) as archive:
        entries = archive.infolist()
        if len(entries) > 600 or sum(item.file_size for item in entries) > 500 * 1024 * 1024:
            raise ValueError("Theme pack is too large")
        if "pack.json" not in archive.namelist() or archive.getinfo("pack.json").file_size > 256 * 1024:
            raise ValueError("Theme pack manifest is missing or oversized")
        pack = validate_manifest(json.loads(archive.read("pack.json")))
        expected = {layer["asset"] for layer in pack["layers"]} | set(pack["ui"]["textures"].values())
        if pack["ui"].get("preview"):
            expected.add(pack["ui"]["preview"])
        font = pack["ui"]["font"]
        if font:
            expected.add(font["asset"])
        names = set(archive.namelist())
        if not expected.issubset(names):
            raise ValueError("Theme pack is missing images")
        if any(item.file_size > 40 * 1024 * 1024 for item in entries if item.filename in expected):
            raise ValueError("A theme image is too large")
        if font:
            font_file = archive.getinfo(font["asset"])
            if font_file.file_size > 5 * 1024 * 1024:
                raise ValueError("A theme font is too large")
            signature = archive.read(font["asset"])[:4]
            expected_signature = {".woff2": b"wOF2", ".woff": b"wOFF", ".ttf": b"\x00\x01\x00\x00", ".otf": b"OTTO"}[Path(font["asset"]).suffix]
            if signature != expected_signature:
                raise ValueError("Theme font file is invalid")
        PACK_ROOT.mkdir(parents=True, exist_ok=True)
        target = PACK_ROOT / pack["id"]
        with tempfile.TemporaryDirectory(dir=PACK_ROOT, prefix="_import-") as temp:
            temp_path = Path(temp)
            (temp_path / "assets").mkdir()
            for asset in expected:
                destination = temp_path / asset
                with archive.open(asset) as source, destination.open("wb") as output:
                    shutil.copyfileobj(source, output)
            (temp_path / "pack.json").write_text(json.dumps(pack, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
            backup = None
            if target.exists():
                backup_root = PACK_ROOT / "_previous"
                backup_root.mkdir(exist_ok=True)
                backup = backup_root / (pack["id"] + "-" + datetime.now().strftime("%Y%m%d-%H%M%S-%f"))
                target.rename(backup)
            try:
                temp_path.rename(target)
            except Exception:
                if backup is not None and backup.exists():
                    backup.rename(target)
                raise
    return {"id": pack["id"], "name": pack["name"],
            "palette": pack["palette"], "image_count": len(pack["layers"]),
            "preview_asset": _preview_asset(pack)}


def remove_pack(pack_id):
    if not isinstance(pack_id, str) or not PACK_ID.fullmatch(pack_id):
        raise ValueError("Invalid theme pack ID")
    root = PACK_ROOT.resolve()
    target = (PACK_ROOT / pack_id).resolve()
    if not target.is_relative_to(root) or not target.is_dir():
        raise FileNotFoundError("Theme pack is not installed")
    backup_root = PACK_ROOT / "_previous"
    backup_root.mkdir(exist_ok=True)
    backup = (backup_root / (pack_id + "-" + datetime.now().strftime("%Y%m%d-%H%M%S-%f"))).resolve()
    if not backup.is_relative_to(root):
        raise ValueError("Invalid theme backup location")
    target.rename(backup)
    return {"id": pack_id, "archived": True}
