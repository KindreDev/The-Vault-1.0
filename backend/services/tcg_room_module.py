"""Versioned, resumable installer for the optional TCG room asset module."""

from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import threading
import urllib.error
import urllib.parse
import urllib.request
import uuid
from pathlib import Path, PurePosixPath

from database import DATA_DIR


MODULE_ID = "tcg-room"
MANIFEST_PATH = Path(__file__).resolve().parents[1] / "data" / "tcg_room" / "module-manifest-v1.json"
REQUIRED_ASSET_IDS = (
    "room_floor", "room_ceiling", "wall_north", "wall_south_windowed", "wall_east",
    "wall_west_door", "window_double", "bedroom_door", "baseboard_trim", "kitchen_partition",
    "bed_frame", "mattress_bedding", "nightstand", "wardrobe", "computer_desk", "office_chair",
    "kitchen_counter", "upper_kitchen_cabinet", "refrigerator", "microwave", "kitchen_sink",
    "dining_table", "dining_chair", "area_rug", "bookshelf_wide", "bookshelf_narrow",
    "bookshelf_corner", "glass_cabinet_tall", "glass_cabinet_wide", "binder_shelf_insert",
    "card_drawer_unit", "loose_card_tray", "sorting_mat", "display_stand_single",
    "display_stand_triple", "acrylic_card_case", "card_toploader", "wall_frame_portrait",
    "wall_frame_landscape", "poster_frame", "set_storage_box", "pc_tower", "pc_monitor",
    "pc_keyboard", "pc_mouse", "shop_notebook", "door_mail_slot", "shipping_box_small",
    "padded_mailer", "booster_pack_mesh", "card_stack_mesh", "ceiling_light", "desk_lamp",
    "led_strip", "floating_wall_shelf", "window_curtains", "waste_bin",
)
REQUIRED_MATERIAL_IDS = (
    "wall_paint", "light_wood", "dark_wood", "carpet", "black_metal", "chrome",
    "cabinet_glass", "clear_acrylic", "binder_leather", "binder_canvas", "binder_vinyl",
    "card_paper", "cardboard", "booster_foil", "hard_plastic", "bedding_fabric",
    "led_emissive", "poster_paper",
)
REQUIRED_MATERIAL_MAPS = {"base_color", "normal", "roughness", "metallic", "ao"}
_VERSION_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")
_worker_lock = threading.Lock()
_worker: threading.Thread | None = None


def modules_root() -> Path:
    root = Path(DATA_DIR) / "modules" / MODULE_ID
    root.mkdir(parents=True, exist_ok=True)
    return root


def _state_path() -> Path:
    return modules_root() / "install-state.json"


def _default_state() -> dict:
    return {
        "phase": "idle", "action": None, "version": None,
        "current_file": None, "bytes_done": 0, "bytes_total": 0,
        "files_done": 0, "files_total": 0, "cancel_requested": False,
        "error": None,
    }


def _write_json(path: Path, value: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
    with temp.open("w", encoding="utf-8") as handle:
        json.dump(value, handle, indent=2, sort_keys=True)
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(temp, path)


def _load_state() -> dict:
    try:
        with _state_path().open("r", encoding="utf-8") as handle:
            return {**_default_state(), **json.load(handle)}
    except (OSError, ValueError, TypeError):
        return _default_state()


def _set_state(**values) -> dict:
    state = {**_load_state(), **values}
    _write_json(_state_path(), state)
    return state


def bundled_manifest() -> dict:
    with MANIFEST_PATH.open("r", encoding="utf-8") as handle:
        manifest = json.load(handle)
    _validate_manifest(manifest)
    return manifest


def _safe_version(version: str) -> str:
    value = str(version or "")
    if not _VERSION_RE.fullmatch(value):
        raise ValueError("Invalid room module version")
    return value


def _safe_relative_path(value: str) -> PurePosixPath:
    path = PurePosixPath(str(value or ""))
    if not str(path) or path.is_absolute() or ".." in path.parts or "." in path.parts:
        raise ValueError("Invalid room module file path")
    return path


def _validate_manifest(manifest: dict) -> None:
    if manifest.get("module_id") != MODULE_ID or int(manifest.get("schema_version", 0)) != 1:
        raise ValueError("Unsupported room module manifest")
    _safe_version(manifest.get("version"))
    files = manifest.get("files")
    if not isinstance(files, list):
        raise ValueError("Room module manifest files must be a list")
    assets = manifest.get("assets")
    materials = manifest.get("materials")
    if not isinstance(assets, list) or not isinstance(materials, list):
        raise ValueError("Room module manifest must enumerate assets and materials")
    asset_ids = [str(item.get("id") or "") for item in assets if isinstance(item, dict)]
    material_ids = [str(item.get("id") or "") for item in materials if isinstance(item, dict)]
    if len(asset_ids) != len(assets) or len(asset_ids) != len(set(asset_ids)):
        raise ValueError("Room module manifest contains duplicate or invalid asset IDs")
    if len(material_ids) != len(materials) or len(material_ids) != len(set(material_ids)):
        raise ValueError("Room module manifest contains duplicate or invalid material IDs")
    if set(asset_ids) != set(REQUIRED_ASSET_IDS) or len(asset_ids) != len(REQUIRED_ASSET_IDS):
        raise ValueError("Room module manifest must contain the exact required asset set")
    if set(material_ids) != set(REQUIRED_MATERIAL_IDS) or len(material_ids) != len(REQUIRED_MATERIAL_IDS):
        raise ValueError("Room module manifest must contain the exact required material set")
    for asset in assets:
        expected_fields = {
            "path", "lod0_path", "lod1_expected", "collision_proxy_path", "material_slots",
            "texture_dependencies", "snap_anchors", "blender_version", "export_sha256", "published",
        }
        if not expected_fields.issubset(asset):
            raise ValueError("Room module asset metadata is incomplete")
    for material in materials:
        maps = material.get("maps")
        if not isinstance(maps, dict) or set(maps) != REQUIRED_MATERIAL_MAPS:
            raise ValueError("Room module material map metadata is incomplete")
        if not {"ktx2_expected", "transmission_expected", "foil_response_expected", "published"}.issubset(material):
            raise ValueError("Room module material metadata is incomplete")
    seen = set()
    for item in files:
        relative = str(_safe_relative_path(item.get("path")))
        if relative in seen:
            raise ValueError("Room module manifest contains duplicate paths")
        seen.add(relative)
        if int(item.get("size", -1)) < 0 or not re.fullmatch(r"[0-9a-fA-F]{64}", str(item.get("sha256", ""))):
            raise ValueError("Room module manifest contains invalid file integrity data")


def _version_dir(version: str) -> Path:
    return modules_root() / _safe_version(version)


def _stage_dir(version: str) -> Path:
    return modules_root() / f".staging-{_safe_version(version)}"


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _manifest_digest(manifest: dict) -> str:
    encoded = json.dumps(manifest, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _file_ok(path: Path, item: dict) -> bool:
    return path.is_file() and path.stat().st_size == int(item["size"]) and _sha256(path).lower() == item["sha256"].lower()


def _installed_versions() -> list[dict]:
    result = []
    for child in modules_root().iterdir():
        if not child.is_dir() or child.name.startswith(".") or not _VERSION_RE.fullmatch(child.name):
            continue
        manifest_path = child / "manifest.json"
        try:
            with manifest_path.open("r", encoding="utf-8") as handle:
                manifest = json.load(handle)
            _validate_manifest(manifest)
            marker_path = child / "verification.json"
            with marker_path.open("r", encoding="utf-8") as handle:
                marker = json.load(handle)
            verified = marker.get("manifest_sha256") == _manifest_digest(manifest)
            result.append({"version": child.name, "verified": verified})
        except (OSError, ValueError, TypeError):
            result.append({"version": child.name, "verified": False})
    return sorted(result, key=lambda item: item["version"])


def status() -> dict:
    state = _load_state()
    global _worker
    if state["phase"] in {"preparing", "downloading", "verifying", "promoting"} and not (_worker and _worker.is_alive()):
        state = _set_state(phase="paused", cancel_requested=False, error="Download was interrupted and can be resumed")
    manifest = bundled_manifest()
    return {
        **state,
        "module_id": MODULE_ID,
        "available": bool(manifest.get("published") and manifest.get("files")),
        "available_version": manifest["version"],
        "asset_count": len(manifest["assets"]),
        "material_count": len(manifest["materials"]),
        "installed_versions": _installed_versions(),
    }


def verify_version(version: str) -> dict:
    target = _version_dir(version)
    manifest_path = target / "manifest.json"
    if not manifest_path.is_file():
        return {"version": version, "valid": False, "missing": ["manifest.json"], "corrupt": []}
    with manifest_path.open("r", encoding="utf-8") as handle:
        manifest = json.load(handle)
    _validate_manifest(manifest)
    missing, corrupt = [], []
    for item in manifest["files"]:
        path = target.joinpath(*_safe_relative_path(item["path"]).parts)
        if not path.is_file():
            missing.append(item["path"])
        elif not _file_ok(path, item):
            corrupt.append(item["path"])
    valid = not missing and not corrupt
    if valid:
        _write_json(target / "verification.json", {"manifest_sha256": _manifest_digest(manifest)})
    else:
        (target / "verification.json").unlink(missing_ok=True)
    return {"version": version, "valid": valid, "missing": missing, "corrupt": corrupt}


def resolve_verified_file(version: str, asset_path: str) -> Path:
    """Resolve a declared file without repeating the expensive full integrity audit."""
    target = _version_dir(version)
    manifest_path = target / "manifest.json"
    marker_path = target / "verification.json"
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        marker = json.loads(marker_path.read_text(encoding="utf-8"))
    except (OSError, ValueError, TypeError) as exc:
        raise ValueError("Room module is not verified") from exc
    _validate_manifest(manifest)
    if marker.get("manifest_sha256") != _manifest_digest(manifest):
        raise ValueError("Room module is not verified")
    relative = _safe_relative_path(asset_path)
    normalized = relative.as_posix()
    if normalized not in {item["path"] for item in manifest["files"]}:
        raise FileNotFoundError("Room module asset is not declared")
    file_path = target.joinpath(*relative.parts)
    if not file_path.is_file() or target.resolve() not in file_path.resolve().parents:
        raise FileNotFoundError("Room module asset was not found")
    return file_path


def _download_url(manifest: dict, item: dict) -> str:
    direct = str(item.get("url") or "").strip()
    if direct:
        return direct
    base = str(manifest.get("base_url") or "").rstrip("/") + "/"
    if base == "/":
        raise ValueError("Room module file has no download URL")
    return urllib.parse.urljoin(base, urllib.parse.quote(item["path"]))


def _open_download(request: urllib.request.Request):
    return urllib.request.urlopen(request, timeout=90)


def _cancelled() -> bool:
    return bool(_load_state().get("cancel_requested"))


def _download_file(manifest: dict, item: dict, destination: Path, completed_before: int) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    part = destination.with_name(destination.name + ".part")
    expected = int(item["size"])
    offset = part.stat().st_size if part.is_file() else 0
    if offset > expected:
        part.unlink()
        offset = 0
    headers = {"User-Agent": "TheVault-TCGRoom/1.0"}
    if offset:
        headers["Range"] = f"bytes={offset}-"
    request = urllib.request.Request(_download_url(manifest, item), headers=headers)
    try:
        response = _open_download(request)
    except urllib.error.HTTPError as exc:
        if exc.code == 416 and offset == expected:
            response = None
        else:
            raise
    if response is not None:
        with response:
            code = getattr(response, "status", response.getcode())
            if offset and code != 206:
                offset = 0
                part.unlink(missing_ok=True)
            mode = "ab" if offset else "wb"
            with part.open(mode) as handle:
                while True:
                    if _cancelled():
                        raise InterruptedError("Room module download cancelled")
                    chunk = response.read(1024 * 1024)
                    if not chunk:
                        break
                    handle.write(chunk)
                    offset += len(chunk)
                    _set_state(bytes_done=completed_before + offset)
    if part.stat().st_size != expected or _sha256(part).lower() != item["sha256"].lower():
        raise ValueError(f"Integrity verification failed for {item['path']}")
    os.replace(part, destination)


def _copy_valid_existing(manifest: dict, target: Path, stage: Path) -> None:
    if not target.is_dir():
        return
    for item in manifest["files"]:
        relative = _safe_relative_path(item["path"])
        source = target.joinpath(*relative.parts)
        destination = stage.joinpath(*relative.parts)
        if _file_ok(source, item):
            destination.parent.mkdir(parents=True, exist_ok=True)
            try:
                os.link(source, destination)
            except OSError:
                shutil.copy2(source, destination)


def install_manifest_sync(manifest: dict, action: str = "download") -> dict:
    """Install a validated manifest; public for deterministic service tests."""
    _validate_manifest(manifest)
    if not manifest.get("published") or not manifest["files"]:
        raise ValueError("The TCG room asset module has not been published yet")
    version = _safe_version(manifest["version"])
    target, stage = _version_dir(version), _stage_dir(version)
    stage.mkdir(parents=True, exist_ok=True)
    _copy_valid_existing(manifest, target, stage)
    total = sum(int(item["size"]) for item in manifest["files"])
    complete = sum(int(item["size"]) for item in manifest["files"] if _file_ok(stage.joinpath(*_safe_relative_path(item["path"]).parts), item))
    _set_state(phase="preparing", action=action, version=version, bytes_done=complete,
               bytes_total=total, files_done=0, files_total=len(manifest["files"]),
               current_file=None, cancel_requested=False, error=None)
    files_done = 0
    try:
        for item in manifest["files"]:
            relative = _safe_relative_path(item["path"])
            destination = stage.joinpath(*relative.parts)
            if not _file_ok(destination, item):
                _set_state(phase="downloading", current_file=item["path"], files_done=files_done)
                _download_file(manifest, item, destination, complete)
                complete += int(item["size"])
            files_done += 1
            _set_state(bytes_done=complete, files_done=files_done)
        _set_state(phase="verifying", current_file=None)
        for item in manifest["files"]:
            if _cancelled():
                raise InterruptedError("Room module download cancelled")
            if not _file_ok(stage.joinpath(*_safe_relative_path(item["path"]).parts), item):
                raise ValueError(f"Integrity verification failed for {item['path']}")
        _write_json(stage / "manifest.json", manifest)
        _write_json(stage / "verification.json", {"manifest_sha256": _manifest_digest(manifest)})
        _set_state(phase="promoting")
        backup = modules_root() / f".backup-{version}-{uuid.uuid4().hex}"
        if target.exists():
            os.replace(target, backup)
        try:
            os.replace(stage, target)
        except Exception:
            if backup.exists() and not target.exists():
                os.replace(backup, target)
            raise
        if backup.exists():
            shutil.rmtree(backup)
        return _set_state(phase="installed", current_file=None, bytes_done=total,
                          files_done=len(manifest["files"]), cancel_requested=False, error=None)
    except InterruptedError as exc:
        return _set_state(phase="paused", cancel_requested=False, error=str(exc))
    except Exception as exc:
        _set_state(phase="error", cancel_requested=False, error=str(exc))
        raise


def _manifest_for_install(version: str | None = None) -> dict:
    if version is None:
        return bundled_manifest()
    version = _safe_version(version)
    bundled = bundled_manifest()
    if bundled["version"] == version:
        return bundled
    path = _version_dir(version) / "manifest.json"
    if not path.is_file():
        raise ValueError("Room module version is not installed")
    with path.open("r", encoding="utf-8") as handle:
        manifest = json.load(handle)
    _validate_manifest(manifest)
    return manifest


def _run_worker(action: str, version: str | None) -> None:
    global _worker
    try:
        install_manifest_sync(_manifest_for_install(version), action=action)
    except Exception:
        pass
    finally:
        with _worker_lock:
            _worker = None


def start_install(action: str = "download", version: str | None = None) -> dict:
    global _worker
    manifest = _manifest_for_install(version)
    if not manifest.get("published") or not manifest["files"]:
        raise ValueError("The TCG room asset module has not been published yet")
    with _worker_lock:
        if _worker and _worker.is_alive():
            raise ValueError("A room module operation is already running")
        _worker = threading.Thread(target=_run_worker, args=(action, version), daemon=True)
        _worker.start()
    return status()


def cancel_install() -> dict:
    state = _load_state()
    if state["phase"] not in {"preparing", "downloading", "verifying"}:
        raise ValueError("No cancellable room module operation is running")
    return _set_state(cancel_requested=True)


def uninstall(version: str) -> dict:
    version = _safe_version(version)
    if _worker and _worker.is_alive():
        raise ValueError("Cancel the room module operation before uninstalling")
    target = _version_dir(version)
    if not target.is_dir():
        raise ValueError("Room module version is not installed")
    if target.resolve().parent != modules_root().resolve():
        raise ValueError("Room module uninstall target is outside the module directory")
    shutil.rmtree(target)
    state = _load_state()
    if state.get("version") == version:
        _set_state(**_default_state())
    return status()
