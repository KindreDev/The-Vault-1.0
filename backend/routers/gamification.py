import random
import os
import uuid
import io
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import FileResponse, Response
from sqlalchemy.orm import Session

from database import get_db, DATA_DIR
from models import UserProfile, Quest, Achievement, XPEvent, QuestStatus, Gallery, Image, gallery_creators
import services.gamification as gami

THUMBS_DIR = os.path.join(DATA_DIR, "thumbs")
PROFILE_AVATAR_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".gif"}
AVATAR_FORMAT_EXT = {"JPEG": ".jpg", "PNG": ".png", "WEBP": ".webp", "GIF": ".gif"}

router = APIRouter()


@router.get("/profile")
def get_profile(db: Session = Depends(get_db)):
    profile = gami.get_or_create_profile(db)
    _, _, xp_to_next = gami._compute_level(profile.total_xp)
    d = {c.name: getattr(profile, c.name) for c in profile.__table__.columns}
    d["xp_to_next"] = xp_to_next
    # Always derive the title from the current level so renamed titles apply immediately
    d["level_title"] = gami._get_title(profile.level)
    return d


@router.post("/login")
def daily_login(db: Session = Depends(get_db)):
    return gami.handle_login(db)


@router.post("/spin")
def daily_spin(db: Session = Depends(get_db)):
    return gami.do_daily_spin(db)


@router.get("/quests")
def get_quests(db: Session = Depends(get_db)):
    quests = db.query(Quest).order_by(Quest.quest_type, Quest.id).all()
    return quests


@router.get("/achievements")
def get_achievements(db: Session = Depends(get_db)):
    return db.query(Achievement).order_by(Achievement.unlocked.desc(), Achievement.id).all()


@router.get("/xp-history")
def xp_history(db: Session = Depends(get_db), limit: int = 20):
    return db.query(XPEvent).order_by(XPEvent.earned_at.desc()).limit(limit).all()


@router.patch("/profile")
def update_profile(data: dict, db: Session = Depends(get_db)):
    profile = gami.get_or_create_profile(db)
    allowed = {"username", "theme_accent", "selected_title", "avatar_focal_x", "avatar_focal_y"}
    for k, v in data.items():
        if k in allowed:
            setattr(profile, k, v)
    db.commit()
    db.refresh(profile)
    return profile


@router.post("/profile/avatar")
async def upload_profile_avatar(file: UploadFile = File(...), db: Session = Depends(get_db)):
    """Upload a profile picture from the user's PC."""
    MAX_SIZE = 8 * 1024 * 1024
    body = await file.read(MAX_SIZE + 1)
    if len(body) > MAX_SIZE:
        raise HTTPException(413, "File too large (max 8 MB)")

    from PIL import Image as PILImage
    try:
        img = PILImage.open(io.BytesIO(body))
        fmt = img.format or "JPEG"
    except Exception:
        raise HTTPException(400, "Invalid image file")
    if fmt not in AVATAR_FORMAT_EXT:
        fmt = "JPEG"
    if img.mode == "RGBA":
        img = img.convert("RGB")
    elif img.mode not in ("RGB", "L"):
        img = img.convert("RGB")

    # Resize to reasonable max (1024px) preserving aspect ratio
    img.thumbnail((1024, 1024), PILImage.LANCZOS)

    save_fmt = "JPEG" if fmt in ("JPEG", "GIF") else fmt
    save_kwargs = {"quality": 88} if save_fmt == "JPEG" else {}
    ext = ".jpg" if save_fmt == "JPEG" else (AVATAR_FORMAT_EXT.get(save_fmt, ".png"))

    os.makedirs(THUMBS_DIR, exist_ok=True)
    filename = f"profile_avatar_{uuid.uuid4().hex[:12]}{ext}"
    dest = os.path.join(THUMBS_DIR, filename)
    img.save(dest, format=save_fmt, **save_kwargs)

    profile = gami.get_or_create_profile(db)
    # Delete old avatar file if it's a profile avatar (not a creator avatar)
    if profile.avatar_path and os.path.isfile(profile.avatar_path):
        try:
            os.remove(profile.avatar_path)
        except Exception:
            pass
    profile.avatar_path = dest
    db.commit()
    return {"avatar_path": dest}


@router.get("/profile/avatar")
def serve_profile_avatar(db: Session = Depends(get_db)):
    """Serve the user's profile picture."""
    profile = gami.get_or_create_profile(db)
    if not profile.avatar_path or not os.path.isfile(profile.avatar_path):
        raise HTTPException(404, "No profile avatar set")
    ext = os.path.splitext(profile.avatar_path)[1].lower()
    if ext not in PROFILE_AVATAR_EXTS:
        raise HTTPException(404, "Invalid avatar file")
    # no-cache so a fresh upload (e.g. from the mobile app) is picked up
    # everywhere immediately instead of serving a stale browser-cached image.
    # FileResponse still sends ETag/Last-Modified, so unchanged images return a
    # cheap 304 rather than re-downloading.
    return FileResponse(profile.avatar_path, headers={"Cache-Control": "no-cache"})


@router.post("/claim-completion-bonus")
def claim_completion_bonus(body: dict, db: Session = Depends(get_db)):
    """
    Claim the pack reward for completing all daily or weekly quests.
    Body: { "type": "daily" | "weekly" }
    """
    quest_type = (body.get("type") or "").strip().lower()
    if quest_type not in ("daily", "weekly"):
        raise HTTPException(400, "type must be 'daily' or 'weekly'")
    result = gami.claim_completion_bonus(db, quest_type)
    if "error" in result:
        raise HTTPException(400, result["error"])
    return result
