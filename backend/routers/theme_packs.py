"""Local cosmetic pack import and listing."""
import zipfile

from fastapi import APIRouter, File, HTTPException, UploadFile

from services import theme_packs

router = APIRouter()


@router.get("")
def list_theme_packs():
    return theme_packs.list_packs()


@router.get("/{pack_id}")
def get_theme_pack(pack_id: str):
    try:
        return theme_packs.get_pack(pack_id)
    except FileNotFoundError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except (ValueError, KeyError, TypeError) as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@router.post("/import")
def import_theme_pack(file: UploadFile = File(...)):
    if not file.filename or not file.filename.lower().endswith(".vaulttheme"):
        raise HTTPException(status_code=400, detail="Choose a .vaulttheme file")
    try:
        return theme_packs.install_pack(file.file)
    except FileExistsError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    except (ValueError, KeyError, TypeError, OSError, zipfile.BadZipFile) as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@router.delete("/{pack_id}")
def remove_theme_pack(pack_id: str):
    try:
        return theme_packs.remove_pack(pack_id)
    except FileNotFoundError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
