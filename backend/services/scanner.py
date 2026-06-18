import os
import re
import sys
import hashlib
import subprocess
from datetime import datetime
from pathlib import Path
from typing import Optional
from sqlalchemy.orm import Session
from PIL import Image as PILImage

from models import Gallery, Image, LibraryRoot, Tag, TagSource, Creator
from database import DATA_DIR
import services.gamification as gami

def _natural_sort_key(s: str):
    """Windows-style natural sort: F1, F2 ... F9, F10, F11."""
    return [int(c) if c.isdigit() else c.lower() for c in re.split(r'(\d+)', s or '')]

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".tiff", ".avif"}
VIDEO_EXTENSIONS = {".mp4", ".mkv", ".webm", ".avi", ".mov", ".m4v", ".wmv"}

# DETACHED_PROCESS (0x8) — no console allocated at all, so no conhost.exe is created.
# CREATE_NO_WINDOW (0x8000000) still allocates an invisible console and spawns conhost.
# For ffmpeg calls that only use pipes we never need a console, so DETACHED is cleaner.
_NO_WINDOW = 0x00000008 if sys.platform == "win32" else 0

# Thumbnails go to the writable data directory (AppData when frozen, backend/ in dev)
THUMB_DIR = os.path.join(DATA_DIR, "thumbs")


def _get_ffmpeg_exe() -> str:
    """
    Returns the path to the ffmpeg executable.
    When running as a frozen PyInstaller bundle, looks for the
    bundled copy first. Falls back to whatever is on PATH.
    """
    exe_name = 'ffmpeg.exe' if sys.platform == 'win32' else 'ffmpeg'
    if getattr(sys, 'frozen', False):
        bundled = os.path.join(sys._MEIPASS, exe_name)
        if os.path.isfile(bundled):
            return bundled
    return exe_name


THUMB_SIZE = (640, 640)

# Global scan state
_scan_state = {
    "running": False,
    "progress": 0,
    "total": 0,
    "current_path": None,
    "new_galleries": 0,
    "new_images": 0,
    "message": "Idle",
    "cancelled": False,
}

_scan_log: list[str] = []
_MAX_LOG = 500


def get_scan_state() -> dict:
    return {k: v for k, v in _scan_state.items() if k != "cancelled"}


def _log(msg: str):
    _scan_log.append(msg)
    if len(_scan_log) > _MAX_LOG:
        _scan_log.pop(0)


def get_scan_log() -> list[str]:
    return list(_scan_log)


def cancel_scan():
    _scan_state["cancelled"] = True


def is_scan_cancelled() -> bool:
    """Return True if a cancellation has been requested."""
    return bool(_scan_state.get("cancelled"))


def set_scan_state(**kwargs):
    """Merge keyword arguments into the global scan state dict."""
    _scan_state.update(kwargs)


def make_thumb_path(file_path: str) -> str:
    h = hashlib.md5(file_path.encode()).hexdigest()
    return os.path.join(THUMB_DIR, f"{h}.jpg")


def generate_thumbnail(file_path: str, thumb_path: str) -> bool:
    try:
        os.makedirs(os.path.dirname(thumb_path), exist_ok=True)
        with PILImage.open(file_path) as img:
            img = img.convert("RGB")
            img.thumbnail(THUMB_SIZE, PILImage.LANCZOS)
            img.save(thumb_path, "JPEG", quality=85, optimize=True)
        return True
    except Exception:
        return False


def generate_video_thumbnail(file_path: str, thumb_path: str) -> bool:
    """Extract a representative frame from a video using FFmpeg."""
    try:
        os.makedirs(os.path.dirname(thumb_path), exist_ok=True)
        # Try seeking to 5 seconds in; if video is shorter that's fine (ffmpeg handles it)
        ffmpeg = _get_ffmpeg_exe()
        result = subprocess.run(
            [
                ffmpeg, "-y",
                "-ss", "5",
                "-i", file_path,
                "-vframes", "1",
                "-vf", "scale=640:640:force_original_aspect_ratio=decrease,pad=640:640:(ow-iw)/2:(oh-ih)/2:black",
                "-q:v", "3",
                thumb_path,
            ],
            stdin=subprocess.DEVNULL,
            capture_output=True,
            timeout=30,
            creationflags=_NO_WINDOW,
        )
        if result.returncode == 0 and os.path.exists(thumb_path):
            return True
        # Fallback: try without seeking (for very short videos)
        result2 = subprocess.run(
            [
                ffmpeg, "-y",
                "-i", file_path,
                "-vframes", "1",
                "-vf", "scale=640:640:force_original_aspect_ratio=decrease,pad=640:640:(ow-iw)/2:(oh-ih)/2:black",
                "-q:v", "3",
                thumb_path,
            ],
            stdin=subprocess.DEVNULL,
            capture_output=True,
            timeout=30,
            creationflags=_NO_WINDOW,
        )
        return result2.returncode == 0 and os.path.exists(thumb_path)
    except (subprocess.TimeoutExpired, FileNotFoundError, Exception):
        return False


def get_image_dimensions(file_path: str) -> tuple[Optional[int], Optional[int]]:
    try:
        with PILImage.open(file_path) as img:
            return img.width, img.height
    except Exception:
        return None, None


_MONTH_MAP = {
    'january': 1, 'jan': 1, 'february': 2, 'feb': 2, 'march': 3, 'mar': 3,
    'april': 4, 'apr': 4, 'may': 5, 'june': 6, 'jun': 6, 'july': 7, 'jul': 7,
    'august': 8, 'aug': 8, 'september': 9, 'sep': 9, 'sept': 9,
    'october': 10, 'oct': 10, 'november': 11, 'nov': 11, 'december': 12, 'dec': 12,
}


def _parse_period_name(name: str):
    """Try to extract (month, year) from a single folder/file name string."""
    s = name.lower()
    # "february 2026" / "2026 february"
    for mn, mv in _MONTH_MAP.items():
        m = re.search(rf'\b{mn}\s+(\d{{2,4}})\b', s)
        if m:
            y = int(m.group(1)); y = y + 2000 if y < 100 else y
            if 2000 <= y <= 2100: return mv, y
        m = re.search(rf'\b(\d{{2,4}})\s+{mn}\b', s)
        if m:
            y = int(m.group(1)); y = y + 2000 if y < 100 else y
            if 2000 <= y <= 2100: return mv, y
    # "02-26" / "02/26" (MM-YY)
    m = re.search(r'\b(0?[1-9]|1[0-2])[-/](2\d)\b', s)
    if m:
        return int(m.group(1)), 2000 + int(m.group(2))
    # "02-2026" / "2026-02"
    m = re.search(r'\b(0?[1-9]|1[0-2])[-/](20\d{2})\b', s)
    if m:
        return int(m.group(1)), int(m.group(2))
    m = re.search(r'\b(20\d{2})[-/](0?[1-9]|1[0-2])\b', s)
    if m:
        return int(m.group(2)), int(m.group(1))
    return None


def detect_period_from_path(dirpath: str, file_paths: list) -> tuple:
    """
    Return (month, year) for the gallery period, or (None, None).

    Priority:
    1. The folder name itself
    2. Parent folder names (up to 2 levels up — handles 'feb 2026/set_name' layout)
    3. File last-modified date minus 1 month (creators publish next month's content)
    """
    path = dirpath
    for _ in range(3):
        name = os.path.basename(path)
        result = _parse_period_name(name)
        if result:
            return result
        parent = os.path.dirname(path)
        if parent == path:
            break
        path = parent

    # Fallback: latest file mtime, subtract 1 month
    mtimes = []
    for fp in file_paths:
        try:
            mtimes.append(os.path.getmtime(fp))
        except OSError:
            pass
    if mtimes:
        dt = datetime.fromtimestamp(max(mtimes))
        month = dt.month - 1 or 12
        year  = dt.year if dt.month > 1 else dt.year - 1
        return month, year

    return None, None


def _get_or_create_video_tag(db: Session) -> Tag:
    """Return the 'video' tag, creating it if needed."""
    tag = db.query(Tag).filter(Tag.name == "video").first()
    if not tag:
        tag = Tag(name="video", category="type", source=TagSource.manual)
        db.add(tag)
        db.flush()
    return tag


def _get_or_create_funscripted_tag(db: Session) -> Tag:
    """Return the 'funscripted' tag, creating it if needed."""
    tag = db.query(Tag).filter(Tag.name == "funscripted").first()
    if not tag:
        tag = Tag(name="funscripted", category="type", source=TagSource.manual)
        db.add(tag)
        db.flush()
    return tag


def scan_library(db: Session, root_id: Optional[int] = None):
    """
    Walk all enabled library roots (or a specific one), create Gallery records
    for each folder containing media, and Image records for each file found.
    One folder = one gallery.
    """
    global _scan_state

    if _scan_state["running"]:
        return {"error": "Scan already in progress"}

    _scan_state.update({
        "running": True,
        "progress": 0,
        "total": 0,
        "new_galleries": 0,
        "new_images": 0,
        "message": "Starting scan...",
        "cancelled": False,
    })
    _log("Scan started")

    try:
        query = db.query(LibraryRoot).filter(LibraryRoot.enabled == True)
        if root_id:
            query = query.filter(LibraryRoot.id == root_id)
        roots = query.all()

        if not roots:
            _scan_state["message"] = "No library roots configured"
            _scan_state["running"] = False
            return

        folders_to_scan = []
        for root in roots:
            if not os.path.exists(root.path):
                continue
            for dirpath, dirnames, filenames in os.walk(root.path):
                has_media = any(
                    Path(f).suffix.lower() in IMAGE_EXTENSIONS | VIDEO_EXTENSIONS
                    for f in filenames
                )
                if has_media:
                    folders_to_scan.append((root, dirpath, filenames))

        _scan_state["total"] = len(folders_to_scan)
        _scan_state["message"] = f"Found {len(folders_to_scan)} folders to scan"

        for idx, (root, dirpath, filenames) in enumerate(folders_to_scan):
            if _scan_state["cancelled"]:
                _log("Scan cancelled by user")
                _scan_state["message"] = "Scan cancelled"
                break
            _scan_state["progress"] = idx + 1
            _scan_state["current_path"] = dirpath
            _log(f"Scanning: {dirpath}")
            _process_folder(db, root, dirpath, filenames)
            root.last_scan = datetime.utcnow()
            db.commit()

        if not _scan_state["cancelled"]:
            msg = (
                f"Scan complete. "
                f"{_scan_state['new_galleries']} new galleries, "
                f"{_scan_state['new_images']} new images."
            )
            _scan_state["message"] = msg
            _log(msg)

    except Exception as e:
        _scan_state["message"] = f"Scan error: {str(e)}"
        _log(f"ERROR: {str(e)}")
    finally:
        _scan_state["running"] = False
        _scan_state["current_path"] = None


def scan_folder_path(db: Session, folder_path: str):
    """Scan a specific folder path (without requiring a registered library root)."""
    global _scan_state

    if _scan_state["running"]:
        return

    _scan_state.update({
        "running": True,
        "progress": 0,
        "total": 0,
        "new_galleries": 0,
        "new_images": 0,
        "message": f"Scanning {folder_path}...",
        "cancelled": False,
    })
    _log(f"Folder scan started: {folder_path}")

    try:
        folders_to_scan = []
        for dirpath, dirnames, filenames in os.walk(folder_path):
            has_media = any(
                Path(f).suffix.lower() in IMAGE_EXTENSIONS | VIDEO_EXTENSIONS
                for f in filenames
            )
            if has_media:
                folders_to_scan.append((dirpath, filenames))

        _scan_state["total"] = len(folders_to_scan)

        for idx, (dirpath, filenames) in enumerate(folders_to_scan):
            if _scan_state["cancelled"]:
                _log("Scan cancelled by user")
                _scan_state["message"] = "Scan cancelled"
                break
            _scan_state["progress"] = idx + 1
            _scan_state["current_path"] = dirpath
            _log(f"Scanning: {dirpath}")
            _process_folder(db, None, dirpath, filenames)
            db.commit()

        if not _scan_state["cancelled"]:
            msg = (
                f"Folder scan complete. "
                f"{_scan_state['new_galleries']} new galleries, "
                f"{_scan_state['new_images']} new images."
            )
            _scan_state["message"] = msg
            _log(msg)

    except Exception as e:
        _scan_state["message"] = f"Scan error: {str(e)}"
        _log(f"ERROR: {str(e)}")
    finally:
        _scan_state["running"] = False
        _scan_state["current_path"] = None


def _process_folder(db: Session, root, dirpath: str, filenames: list):
    global _scan_state

    gallery = db.query(Gallery).filter(Gallery.folder_path == dirpath).first()
    folder_name = os.path.basename(dirpath) or dirpath
    media_files = [
        f for f in sorted(filenames, key=_natural_sort_key)
        if Path(f).suffix.lower() in IMAGE_EXTENSIONS | VIDEO_EXTENSIONS
    ]

    if not media_files:
        return

    is_new_gallery = False
    if not gallery:
        full_paths = [os.path.join(dirpath, f) for f in media_files]
        p_month, p_year = detect_period_from_path(dirpath, full_paths)
        gallery = Gallery(
            name=folder_name,
            folder_path=dirpath,
            library_root_id=root.id if root else None,
            scanned_at=datetime.utcnow(),
            period_month=p_month,
            period_year=p_year,
        )
        db.add(gallery)
        db.flush()
        _scan_state["new_galleries"] += 1
        is_new_gallery = True

        # Auto-assign creators whose source_folder matches this gallery's path.
        # This means adding files to a creator's folder and re-scanning is enough —
        # no manual assignment needed.
        norm_gal = os.path.normcase(os.path.normpath(dirpath))
        for c in db.query(Creator).filter(Creator.source_folder.isnot(None)).all():
            norm_src = os.path.normcase(os.path.normpath(c.source_folder))
            if norm_gal == norm_src or norm_gal.startswith(norm_src + os.sep):
                if c not in gallery.creators:
                    gallery.creators.append(c)
                    gallery.is_tagged = True
                if gallery.creator_id is None:
                    gallery.creator_id = c.id

    new_image_count = 0
    cover_set = False

    for filename in media_files:
        file_path = os.path.join(dirpath, filename)
        ext = Path(filename).suffix.lower()
        is_video = ext in VIDEO_EXTENSIONS

        existing = db.query(Image).filter(Image.file_path == file_path).first()
        if existing:
            # Regenerate missing thumbnail (catches videos scanned before FFmpeg support)
            if not existing.thumb_path or not os.path.exists(existing.thumb_path or ''):
                new_thumb = make_thumb_path(file_path)
                if not os.path.exists(new_thumb):
                    if is_video:
                        generate_video_thumbnail(file_path, new_thumb)
                    else:
                        generate_thumbnail(file_path, new_thumb)
                if os.path.exists(new_thumb):
                    existing.thumb_path = new_thumb
                    if not cover_set:
                        gallery.cover_thumb = f"/thumbs/{os.path.basename(new_thumb)}"
            if not cover_set and existing.thumb_path and os.path.exists(existing.thumb_path):
                cover_set = True
            # Retroactively add video tag if missing
            if is_video:
                video_tag = _get_or_create_video_tag(db)
                if video_tag not in existing.tags:
                    existing.tags.append(video_tag)
                    video_tag.use_count += 1
                # Retroactively detect funscript and apply tag
                fs_path = os.path.splitext(file_path)[0] + ".funscript"
                if os.path.exists(fs_path):
                    if not existing.funscript_path:
                        existing.funscript_path = fs_path
                    fs_tag = _get_or_create_funscripted_tag(db)
                    if fs_tag not in existing.tags:
                        existing.tags.append(fs_tag)
                        fs_tag.use_count += 1
            continue

        thumb_path = make_thumb_path(file_path)
        width, height = None, None

        if is_video:
            # Generate video thumbnail via FFmpeg
            if not os.path.exists(thumb_path):
                generate_video_thumbnail(file_path, thumb_path)
        else:
            w, h = get_image_dimensions(file_path)
            width, height = w, h
            if not os.path.exists(thumb_path):
                generate_thumbnail(file_path, thumb_path)

        file_size = os.path.getsize(file_path) if os.path.exists(file_path) else None
        try:
            file_mtime = datetime.fromtimestamp(os.path.getmtime(file_path))
        except OSError:
            file_mtime = None

        funscript_path = None
        if is_video:
            fs_path = os.path.splitext(file_path)[0] + ".funscript"
            if os.path.exists(fs_path):
                funscript_path = fs_path

        img = Image(
            filename=filename,
            file_path=file_path,
            thumb_path=thumb_path if os.path.exists(thumb_path) else None,
            gallery_id=gallery.id,
            width=width,
            height=height,
            file_size=file_size,
            is_video=is_video,
            funscript_path=funscript_path,
            sort_order=new_image_count,
            file_modified_at=file_mtime,
        )
        db.add(img)
        db.flush()  # get img.id

        # Auto-tag videos
        if is_video:
            video_tag = _get_or_create_video_tag(db)
            img.tags.append(video_tag)
            video_tag.use_count += 1
            # Funscripted badge
            if funscript_path:
                fs_tag = _get_or_create_funscripted_tag(db)
                img.tags.append(fs_tag)
                fs_tag.use_count += 1

        new_image_count += 1
        _scan_state["new_images"] += 1

        # Set first non-video image as gallery cover; use video thumb if no images
        if not cover_set:
            if not is_video and os.path.exists(thumb_path):
                gallery.cover_thumb = f"/thumbs/{os.path.basename(thumb_path)}"
                cover_set = True
            elif is_video and os.path.exists(thumb_path):
                gallery.cover_thumb = f"/thumbs/{os.path.basename(thumb_path)}"
                # don't set cover_set=True so a real image can override this

    # New images were db.flush()'d inside the loop, so the count() below already
    # includes them — do NOT add new_image_count again or new images double-count.
    gallery.image_count = db.query(Image).filter(Image.gallery_id == gallery.id).count()
    gallery.scanned_at = datetime.utcnow()
    db.flush()

    # Fire gamification after images are flushed so image-count milestones are accurate.
    if is_new_gallery:
        gami.notify_action(db, "gallery_imported")
