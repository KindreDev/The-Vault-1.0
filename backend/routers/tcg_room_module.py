"""Thin API for the optional TCG room module lifecycle."""

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel

from services import tcg_room_module


router = APIRouter(prefix="/api/tcg-room/module", tags=["tcg-room-module"])


class VersionRequest(BaseModel):
    version: str


class RepairRequest(BaseModel):
    version: str | None = None


def _result(fn, *args):
    try:
        return fn(*args)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.get("/status")
def status():
    return tcg_room_module.status()


@router.post("/download")
def download():
    return _result(tcg_room_module.start_install, "download")


@router.post("/cancel")
def cancel():
    return _result(tcg_room_module.cancel_install)


@router.post("/verify")
def verify(request: VersionRequest):
    return _result(tcg_room_module.verify_version, request.version)


@router.post("/repair")
def repair(request: RepairRequest):
    return _result(tcg_room_module.start_install, "repair", request.version)


@router.post("/update")
def update():
    return _result(tcg_room_module.start_install, "update")


@router.post("/uninstall")
def uninstall(request: VersionRequest):
    return _result(tcg_room_module.uninstall, request.version)


@router.get("/assets/{version}/{asset_path:path}")
def installed_asset(version: str, asset_path: str):
    """Serve only files declared by a verified installed module manifest."""
    try:
        file_path = tcg_room_module.resolve_verified_file(version, asset_path)
    except FileNotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from exc
    media_type = "model/gltf-binary" if file_path.suffix.lower() == ".glb" else None
    return FileResponse(file_path, media_type=media_type, headers={"Cache-Control": "public, max-age=31536000, immutable"})
