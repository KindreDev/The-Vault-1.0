"""
Intake / Triage service.

A staging pipeline between a messy downloads folder and the organised vault.

    Downloads  →  [ intake_items: DB-only, no move ]  →  you classify  →  [ MOVE ]  →  vault

Intake roots are deliberately NOT library roots — the library scanner never
walks them, so nothing here becomes a gallery until it is *committed*.
Committing physically moves the file into a chosen destination, then reuses the
normal scanner (`scan_folder_path`) to register it — which auto-links the
creator via `Creator.source_folder`. All the hard parts (thumbnails, funscript
detection, gamification) are reused, not re-implemented.
"""
import os
import re
import json
import time
import shutil
import subprocess
import zipfile
from collections import Counter
from datetime import datetime
from pathlib import Path
from typing import Optional

from sqlalchemy.orm import Session

from models import IntakeRoot, IntakeItem, Creator, Gallery, LibraryRoot
from database import CONFIG_FILE, SessionLocal
from services.scanner import (
    IMAGE_EXTENSIONS, VIDEO_EXTENSIONS,
    make_thumb_path, generate_thumbnail, generate_video_thumbnail,
    scan_folder_path,
)

ARCHIVE_EXTENSIONS = {".zip", ".rar", ".7z"}
# Files still being written by a browser / torrent client — never intake these.
PARTIAL_EXTENSIONS = {".part", ".crdownload", ".tmp", ".!ut", ".download", ".opdownload"}
_FRESH_FILE_SECONDS = 5   # skip files modified within the last N seconds (mid-download)


# ── Progress state (shared by scan + commit, polled by the task queue) ─────────
# job_id / done_job_id let the frontend match a poll to the job *it* started —
# the task queue may delay the start, so `running: False` alone is ambiguous.
_intake_state = {
    "running": False,
    "progress": 0,
    "total": 0,
    "current_path": None,
    "message": "Idle",
    "cancelled": False,
    "job_id": None,
    "done_job_id": None,
}


def get_intake_state() -> dict:
    return {k: v for k, v in _intake_state.items() if k != "cancelled"}


def _set_state(**kw):
    _intake_state.update(kw)


def cancel_intake():
    _intake_state["cancelled"] = True


def _cancelled() -> bool:
    return bool(_intake_state.get("cancelled"))


# ── Config (new-creator base folder + archive extraction toggle) ───────────────
def _read_config() -> dict:
    try:
        if os.path.isfile(CONFIG_FILE):
            with open(CONFIG_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
    except Exception:
        pass
    return {}


def _write_config(cfg: dict):
    tmp = CONFIG_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(cfg, f, indent=2)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, CONFIG_FILE)


# What to do with the original archive file once it has been extracted.
_ARCHIVE_AFTER_CHOICES = {"delete", "move", "keep"}


def get_intake_config() -> dict:
    cfg = _read_config()
    after = cfg.get("intake_archive_after", "delete")
    if after not in _ARCHIVE_AFTER_CHOICES:
        after = "delete"
    return {
        "new_creator_base": cfg.get("intake_new_creator_base", ""),
        "extract_archives": cfg.get("intake_extract_archives", True),
        "archive_after": after,
    }


def set_intake_config(new_creator_base: Optional[str], extract_archives: Optional[bool],
                      archive_after: Optional[str] = None) -> dict:
    cfg = _read_config()
    if new_creator_base is not None:
        base = new_creator_base.strip()
        if base and not os.path.isdir(base):
            os.makedirs(base, exist_ok=True)
        cfg["intake_new_creator_base"] = base
    if extract_archives is not None:
        cfg["intake_extract_archives"] = bool(extract_archives)
    if archive_after is not None:
        val = str(archive_after).strip().lower()
        if val in _ARCHIVE_AFTER_CHOICES:
            cfg["intake_archive_after"] = val
    _write_config(cfg)
    return get_intake_config()


# ── Filesystem helpers ─────────────────────────────────────────────────────────
_INVALID_NAME = re.compile(r'[<>:"/\\|?*\x00-\x1f]')


def _sanitize(name: str) -> str:
    """Make a string safe to use as a single folder name on Windows."""
    cleaned = _INVALID_NAME.sub("", (name or "").strip()).rstrip(". ")
    return cleaned or "Untitled"


def _same_volume(a: str, b: str) -> bool:
    da = os.path.splitdrive(os.path.abspath(a))[0].lower()
    db_ = os.path.splitdrive(os.path.abspath(b))[0].lower()
    return da == db_


def _unique_dest(dest_dir: str, filename: str) -> str:
    """Return a non-colliding path in dest_dir. `photo.jpg` → `photo (2).jpg`."""
    base, ext = os.path.splitext(filename)
    candidate = os.path.join(dest_dir, filename)
    n = 2
    while os.path.exists(candidate):
        candidate = os.path.join(dest_dir, f"{base} ({n}){ext}")
        n += 1
    return candidate


def _unique_dir(parent: str, name: str) -> str:
    candidate = os.path.join(parent, name)
    n = 2
    while os.path.exists(candidate):
        candidate = os.path.join(parent, f"{name} ({n})")
        n += 1
    return candidate


def _move_file(src: str, dest: str):
    """Move a file, safe across volumes. Same drive → atomic rename; different
    drive → copy, verify size, then delete the source (never delete on mismatch)."""
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    if _same_volume(src, dest):
        os.replace(src, dest)
    else:
        shutil.copy2(src, dest)
        if os.path.getsize(src) != os.path.getsize(dest):
            try:
                os.remove(dest)
            except OSError:
                pass
            raise IOError("size mismatch after cross-volume copy — source kept")
        os.remove(src)


def _move_funscript(src_media: str, dest_media: str):
    """Move a `<base>.funscript` sidecar alongside its video, matching the
    (possibly renamed) destination base so filename-match sync still works."""
    fs_src = os.path.splitext(src_media)[0] + ".funscript"
    if not os.path.exists(fs_src):
        return
    fs_dest = os.path.splitext(dest_media)[0] + ".funscript"
    _move_file(fs_src, fs_dest)


# ── 7-Zip (7z.exe) driver ───────────────────────────────────────────────────────
# rar support depends entirely on an installed 7-Zip binary — the `rarfile`
# package (which needs external unrar/unar/bsdtar) is deliberately NOT used.
# 7z.exe natively lists and extracts rar (and 7z) archives, so it doubles as
# a fallback handler for .7z if py7zr is ever unavailable.
_7Z_EXE_CACHE = {"probed": False, "path": None}

_7Z_COMMON_PATHS = [
    r"C:\Program Files\7-Zip\7z.exe",
    r"C:\Program Files (x86)\7-Zip\7z.exe",
]


def _find_7z_exe() -> Optional[str]:
    """Locate a 7-Zip executable, probing once and caching the result."""
    if _7Z_EXE_CACHE["probed"]:
        return _7Z_EXE_CACHE["path"]
    found = shutil.which("7z") or shutil.which("7za")
    if not found:
        for candidate in _7Z_COMMON_PATHS:
            if os.path.isfile(candidate):
                found = candidate
                break
    _7Z_EXE_CACHE["probed"] = True
    _7Z_EXE_CACHE["path"] = found
    return found


def _7z_subprocess_kwargs() -> dict:
    kw = {"capture_output": True, "text": True}
    if os.name == "nt":
        kw["creationflags"] = subprocess.CREATE_NO_WINDOW
    return kw


def _7z_run(args: list, timeout: int):
    proc = subprocess.run(args, timeout=timeout, **_7z_subprocess_kwargs())
    if proc.returncode != 0:
        detail = (proc.stderr or proc.stdout or "").strip()[:500]
        raise RuntimeError(f"7z exited with code {proc.returncode}: {detail}")
    return proc


def _7z_list(exe: str, path: str) -> list:
    """List archive entries via `7z l -slt`. The -slt (technical) output is a
    series of blocks separated by blank lines, one block per entry, each with
    `Key = Value` lines such as `Path = ...`, `Size = ...`, `Folder = +/-`,
    `Attributes = ....D....` (D flag = directory). The blocks before the first
    '----------' separator are archive/header metadata and are skipped."""
    proc = _7z_run([exe, "l", "-slt", "-y", path], timeout=60)
    out = proc.stdout or ""
    # Only the section after the '----------' separator lists real entries.
    sep_idx = out.find("----------")
    body = out[sep_idx + len("----------"):] if sep_idx != -1 else out

    entries = []
    block: dict = {}

    def flush():
        if "Path" not in block:
            return
        is_dir = block.get("Folder") == "+" or "D" in (block.get("Attributes") or "")
        size_raw = block.get("Size")
        try:
            size = int(size_raw) if size_raw else 0
        except ValueError:
            size = 0
        entries.append({"name": block["Path"], "size": size, "is_dir": is_dir})

    for line in body.splitlines():
        line = line.rstrip("\r")
        if not line.strip():
            flush()
            block = {}
            continue
        if " = " not in line:
            continue
        key, _, value = line.partition(" = ")
        block[key.strip()] = value.strip()
    flush()  # last block has no trailing blank line
    return entries


def _7z_extract_all(exe: str, src: str, out: str):
    _7z_run([exe, "x", src, f"-o{out}", "-y"], timeout=300)


def _7z_extract_one(exe: str, src: str, out_dir: str, name: str) -> str:
    _7z_run([exe, "x", src, f"-o{out_dir}", "-y", "--", name], timeout=300)
    fp = os.path.join(out_dir, *name.replace("\\", "/").split("/"))
    if not os.path.isfile(fp):
        raise KeyError(name)
    return fp


def _extract_archive(src: str, dest_dir: str) -> str:
    """Extract an archive into its own subfolder under dest_dir (one archive =
    one gallery folder). Returns the extracted folder path. zip is handled
    natively, 7z via py7zr (falling back to 7z.exe if that raises), rar via
    7z.exe (the only handler available — 7-Zip must be installed)."""
    stem = _sanitize(os.path.splitext(os.path.basename(src))[0])
    out = _unique_dir(dest_dir, stem)
    os.makedirs(out, exist_ok=True)
    ext = os.path.splitext(src)[1].lower()
    if ext == ".zip":
        with zipfile.ZipFile(src) as z:
            z.extractall(out)
    elif ext == ".7z":
        try:
            import py7zr
            with py7zr.SevenZipFile(src, "r") as z:
                z.extractall(path=out)
        except Exception:
            exe = _find_7z_exe()
            if not exe:
                raise
            _7z_extract_all(exe, src, out)
    elif ext == ".rar":
        exe = _find_7z_exe()
        if not exe:
            raise RuntimeError(
                "7-Zip is required to extract .rar archives — install 7-Zip.")
        _7z_extract_all(exe, src, out)
    else:
        shutil.unpack_archive(src, out)
    return out


# ── Archive inspection (peek inside zip/rar/7z without extracting) ─────────────
_PREVIEW_MAX_BYTES = 25 * 1024 * 1024


def list_archive_contents(path: str) -> dict:
    """List an archive's entries with per-kind counts. zip is native; 7z uses
    py7zr (falling back to 7z.exe); rar is listed via 7z.exe only — a graceful
    unsupported response is returned if no handler is available, never an
    exception."""
    ext = os.path.splitext(path)[1].lower()
    entries = []
    supported, error = True, None
    try:
        if ext == ".zip":
            with zipfile.ZipFile(path) as z:
                for info in z.infolist():
                    entries.append({"name": info.filename, "size": info.file_size,
                                    "is_dir": info.is_dir()})
        elif ext == ".rar":
            exe = _find_7z_exe()
            if exe:
                entries = _7z_list(exe, path)
            else:
                supported = False
                error = "Install 7-Zip to read .rar archives."
        elif ext == ".7z":
            try:
                import py7zr
                with py7zr.SevenZipFile(path) as sz:
                    for info in sz.list():
                        entries.append({"name": info.filename, "size": info.uncompressed,
                                        "is_dir": info.is_directory})
            except ImportError:
                exe = _find_7z_exe()
                if exe:
                    entries = _7z_list(exe, path)
                else:
                    supported = False
                    error = "Install 7-Zip or the py7zr package to read .7z archives."
        else:
            supported = False
            error = f"Not an archive: {ext}"
    except Exception as e:
        supported = False
        error = str(e)

    images = videos = other = 0
    preview_names = []
    for e_ in entries:
        if e_["is_dir"]:
            e_["kind"] = "dir"
            continue
        x = os.path.splitext(e_["name"])[1].lower()
        if x in IMAGE_EXTENSIONS:
            images += 1
            e_["kind"] = "image"
            preview_names.append(e_["name"])
        elif x in VIDEO_EXTENSIONS:
            videos += 1
            e_["kind"] = "video"
        else:
            other += 1
            e_["kind"] = "other"

    if ext == ".zip":
        can_preview = True
    elif ext == ".7z":
        can_preview = True  # py7zr declared dependency or 7z.exe fallback
    elif ext == ".rar":
        can_preview = _find_7z_exe() is not None
    else:
        can_preview = False

    return {
        "supported": supported, "error": error,
        "counts": {"images": images, "videos": videos, "other": other},
        "entries": entries[:500],
        "preview_names": preview_names[:24],
        "can_preview": can_preview,
    }


def read_archive_entry(path: str, name: str) -> bytes:
    """Return the raw bytes of one entry inside an archive (for image preview).
    zip streams the member directly; 7z has no random-member read API in py7zr,
    so a single entry is extracted to a temp dir and read back (falling back to
    7z.exe if py7zr is unavailable); rar is extracted via 7z.exe only. Raises
    KeyError if the entry is absent, ValueError if it's too large / unsupported
    format."""
    import tempfile
    ext = os.path.splitext(path)[1].lower()
    if ext == ".zip":
        with zipfile.ZipFile(path) as z:
            info = z.getinfo(name)
            if info.file_size > _PREVIEW_MAX_BYTES:
                raise ValueError("Entry too large to preview")
            return z.read(name)
    if ext == ".7z":
        try:
            import py7zr
        except ImportError:
            py7zr = None
        if py7zr is not None:
            with py7zr.SevenZipFile(path, "r") as z:
                target = next((i for i in z.list() if i.filename == name and not i.is_directory), None)
            if target is None:
                raise KeyError(name)
            if (target.uncompressed or 0) > _PREVIEW_MAX_BYTES:
                raise ValueError("Entry too large to preview")
            with tempfile.TemporaryDirectory() as td:
                with py7zr.SevenZipFile(path, "r") as z:
                    z.extract(path=td, targets=[name])
                fp = os.path.join(td, *name.split("/"))
                if not os.path.isfile(fp):
                    raise KeyError(name)
                with open(fp, "rb") as f:
                    return f.read()
        exe = _find_7z_exe()
        if not exe:
            raise ValueError("Install 7-Zip or the py7zr package to read .7z archives.")
        entries = _7z_list(exe, path)
        target = next((e for e in entries if e["name"] == name and not e["is_dir"]), None)
        if target is None:
            raise KeyError(name)
        if target["size"] > _PREVIEW_MAX_BYTES:
            raise ValueError("Entry too large to preview")
        with tempfile.TemporaryDirectory() as td:
            fp = _7z_extract_one(exe, path, td, name)
            with open(fp, "rb") as f:
                return f.read()
    if ext == ".rar":
        exe = _find_7z_exe()
        if not exe:
            raise ValueError("Install 7-Zip to read .rar archives.")
        entries = _7z_list(exe, path)
        target = next((e for e in entries if e["name"] == name and not e["is_dir"]), None)
        if target is None:
            raise KeyError(name)
        if target["size"] > _PREVIEW_MAX_BYTES:
            raise ValueError("Entry too large to preview")
        with tempfile.TemporaryDirectory() as td:
            fp = _7z_extract_one(exe, path, td, name)
            with open(fp, "rb") as f:
                return f.read()
    raise ValueError("Inline preview is only supported for .zip, .7z, and .rar archives")


# ── Scan: discover candidate files ─────────────────────────────────────────────
def _is_partial(filename: str, full_path: str) -> bool:
    if os.path.splitext(filename)[1].lower() in PARTIAL_EXTENSIONS:
        return True
    try:
        if time.time() - os.path.getmtime(full_path) < _FRESH_FILE_SECONDS:
            return True  # still being written
    except OSError:
        return True
    return False


def _classify(ext: str):
    ext = ext.lower()
    if ext in VIDEO_EXTENSIONS:
        return "video"
    if ext in IMAGE_EXTENSIONS:
        return "image"
    if ext in ARCHIVE_EXTENSIONS:
        return "archive"
    return None


# ── Duplicate awareness ────────────────────────────────────────────────────────
_DUP_HAMMING_THRESHOLD = 6   # pHash distance at or below which two images count as dupes


def _load_vault_hashes(db: Session) -> list:
    """[(image_id, hash_as_int)] for every hashed vault image, loaded once per scan."""
    from models import Image
    rows = (db.query(Image.id, Image.perceptual_hash)
              .filter(Image.perceptual_hash.isnot(None),
                      Image.perceptual_hash != "failed",
                      Image.perceptual_hash != "").all())
    out = []
    for iid, h in rows:
        try:
            out.append((iid, int(h, 16)))
        except (ValueError, TypeError):
            pass
    return out


def _find_duplicate(db: Session, full_path: str, is_video: bool,
                    size: Optional[int], vault_hashes: list):
    """Return (phash_hex_or_None, duplicate_image_id_or_None).
    Images: pHash near-match against the vault index. Videos: exact byte-size
    match (pHashing video frames at intake time is not worth the cost)."""
    from models import Image
    if is_video:
        if size:
            m = (db.query(Image.id)
                   .filter(Image.is_video == True, Image.file_size == size)  # noqa: E712
                   .first())
            return None, (m[0] if m else None)
        return None, None
    from services.dedup import _hash_file
    h = _hash_file(full_path)
    if not h:
        return "", None   # "" = tried and failed; don't retry every scan
    hv = int(h, 16)
    for iid, other in vault_hashes:
        if bin(hv ^ other).count("1") <= _DUP_HAMMING_THRESHOLD:
            return h, iid
    return h, None


def scan_intake(db: Session, root_id: Optional[int] = None, job_id: Optional[str] = None):
    """Walk enabled intake roots and upsert `intake_items` (status=pending).
    Does NOT create Gallery/Image rows."""
    _set_state(running=True, progress=0, total=0, current_path=None,
               cancelled=False, message="Scanning intake…",
               job_id=job_id, done_job_id=None)
    try:
        q = db.query(IntakeRoot).filter(IntakeRoot.enabled == True)  # noqa: E712
        if root_id:
            q = q.filter(IntakeRoot.id == root_id)
        roots = q.all()
        if not roots:
            _set_state(message="No intake folders configured.")
            return

        # Gather candidates first so we have an accurate progress total.
        candidates = []  # (root, dirpath, filename)
        for root in roots:
            if not os.path.isdir(root.path):
                continue
            for dirpath, _dirs, files in os.walk(root.path):
                for fn in files:
                    if _classify(os.path.splitext(fn)[1]) is None:
                        continue
                    full = os.path.join(dirpath, fn)
                    if _is_partial(fn, full):
                        continue
                    candidates.append((root, dirpath, fn))

        _set_state(total=len(candidates), message=f"Found {len(candidates)} candidate file(s).")

        vault_hashes = _load_vault_hashes(db)
        found = 0
        for idx, (root, dirpath, fn) in enumerate(candidates):
            if _cancelled():
                _set_state(message="Intake scan cancelled.")
                break
            full = os.path.join(dirpath, fn)
            _set_state(progress=idx + 1, current_path=full)

            if db.query(IntakeItem).filter(IntakeItem.source_path == full).first():
                continue  # already known (pending/committed/error)

            kind = _classify(os.path.splitext(fn)[1])
            is_video = kind == "video"
            is_archive = kind == "archive"
            try:
                size = os.path.getsize(full)
            except OSError:
                size = None

            thumb_path = None
            if not is_archive:
                tp = make_thumb_path(full)
                ok = generate_video_thumbnail(full, tp) if is_video else generate_thumbnail(full, tp)
                thumb_path = tp if ok and os.path.exists(tp) else None

            has_fs = False
            if is_video:
                has_fs = os.path.exists(os.path.splitext(full)[0] + ".funscript")

            phash, dup_of = (None, None)
            if not is_archive:
                phash, dup_of = _find_duplicate(db, full, is_video, size, vault_hashes)

            db.add(IntakeItem(
                root_id=root.id, source_path=full, filename=fn, file_size=size,
                is_video=is_video, is_archive=is_archive, has_funscript=has_fs,
                thumb_path=thumb_path, phash=phash, duplicate_of=dup_of,
                status="pending",
            ))
            found += 1
            root.last_scan = datetime.utcnow()
            db.commit()

        # Prune pending rows whose file vanished from disk (moved/deleted by hand).
        # Also backfill duplicate info for pending items scanned before the
        # duplicate-awareness columns existed (phash NULL = never attempted).
        removed = 0
        for it in db.query(IntakeItem).filter(IntakeItem.status == "pending").all():
            if os.path.exists(it.source_path):
                if not it.is_archive and it.phash is None and it.duplicate_of is None:
                    it.phash, it.duplicate_of = _find_duplicate(
                        db, it.source_path, it.is_video, it.file_size, vault_hashes)
                continue
            if it.thumb_path and os.path.exists(it.thumb_path):
                try:
                    os.remove(it.thumb_path)
                except OSError:
                    pass
            db.delete(it)
            removed += 1
        db.commit()  # persists prunes + duplicate backfills

        if not _cancelled():
            msg = f"Intake scan complete. {found} new item(s)."
            if removed:
                msg += f" {removed} stale item(s) cleared."
            _set_state(message=msg)
    except Exception as e:
        db.rollback()
        _set_state(message=f"Intake scan error: {e}")
    finally:
        _set_state(done_job_id=job_id, running=False, current_path=None)
        db.close()


# ── Destination resolution ─────────────────────────────────────────────────────
def _detect_creator_folder(creator: Creator) -> Optional[str]:
    """Guess a creator's root folder from where the majority of their existing
    gallery folders live (the most common parent directory)."""
    parents = []
    galleries = list(creator.galleries or []) + list(creator.linked_galleries or [])
    for g in galleries:
        if g.folder_path:
            parents.append(os.path.dirname(g.folder_path))
    if not parents:
        return None
    parent, _count = Counter(parents).most_common(1)[0]
    return parent or None


def _resolve_creator_root(db: Session, creator: Creator) -> str:
    """The creator's base folder for intake. Order: explicit source_folder →
    auto-detected majority folder → new-creator base / <name>. Persists whatever
    it resolves to `source_folder` so future scans auto-link this creator."""
    if creator.source_folder and creator.source_folder.strip():
        return creator.source_folder.strip()

    detected = _detect_creator_folder(creator)
    if detected:
        creator.source_folder = detected
        db.flush()
        return detected

    base = _read_config().get("intake_new_creator_base", "").strip()
    if not base:
        raise ValueError(
            f"'{creator.name}' has no folder yet and no base folder for new creators is set. "
            "Set one in Intake settings first."
        )
    path = os.path.join(base, _sanitize(creator.name))
    os.makedirs(path, exist_ok=True)
    creator.source_folder = path
    db.flush()
    return path


def _resolve_target(db: Session, target: dict) -> tuple[str, Optional[Gallery]]:
    """Turn a target spec into a concrete destination directory on disk.
    Returns (dest_dir, gallery_or_none). Persists creator.source_folder as needed
    so the post-move scan auto-links the creator."""
    mode = target.get("mode")

    if mode == "existing_gallery":
        g = db.query(Gallery).filter(Gallery.id == target.get("gallery_id")).first()
        if not g or not g.folder_path:
            raise ValueError("Target gallery not found.")
        return g.folder_path, g

    if mode == "new_creator":
        nc = target.get("new_creator") or {}
        name = (nc.get("name") or "").strip()
        if not name:
            raise ValueError("New creator name is required.")
        creator = Creator(name=name)
        ct = nc.get("creator_type")
        if ct:
            try:
                creator.creator_type = ct
            except Exception:
                pass
        db.add(creator)
        db.flush()
        root = _resolve_creator_root(db, creator)
        return root, None

    # creator_root | new_folder
    creator = db.query(Creator).filter(Creator.id == target.get("creator_id")).first()
    if not creator:
        raise ValueError("Target creator not found.")
    root = _resolve_creator_root(db, creator)

    if mode == "new_folder":
        folder = _sanitize(target.get("folder_name") or "")
        dest = _unique_dir(root, folder)
        os.makedirs(dest, exist_ok=True)
        return dest, None

    # creator_root
    os.makedirs(root, exist_ok=True)
    return root, None


# ── Commit: physically move items into the vault ───────────────────────────────
def commit_items(db: Session, item_ids: list, target: dict, job_id: Optional[str] = None):
    """Move each pending item to the resolved destination, then rescan the
    affected folders so the vault registers them. Per-item resilient — one
    failure never aborts the batch."""
    _intake_state.pop("report", None)  # a stale report must never masquerade as this job's
    _set_state(running=True, progress=0, total=len(item_ids), current_path=None,
               cancelled=False, message="Committing…",
               job_id=job_id, done_job_id=None)
    report = []
    scan_dirs = set()
    try:
        dest_dir, _gallery = _resolve_target(db, target)
        db.commit()  # persist creator/source_folder BEFORE the scan auto-links
        cfg_now = get_intake_config()
        extract = bool(cfg_now["extract_archives"])
        archive_after = cfg_now["archive_after"]   # delete | move | keep

        for idx, iid in enumerate(item_ids):
            if _cancelled():
                _set_state(message="Commit cancelled.")
                break
            item = db.query(IntakeItem).filter(IntakeItem.id == iid).first()
            if not item or item.status == "committed":
                continue
            _set_state(progress=idx + 1, current_path=item.source_path)
            try:
                if not os.path.exists(item.source_path):
                    raise FileNotFoundError("source file no longer exists")

                if item.is_archive and extract:
                    out = _extract_archive(item.source_path, dest_dir)
                    # The original archive: delete it (default), move it into the
                    # destination folder, or leave it where it was downloaded.
                    if archive_after == "move":
                        try:
                            _move_file(item.source_path, _unique_dest(dest_dir, item.filename))
                        except Exception:
                            pass   # extraction already succeeded — never fail the item over the leftover
                    elif archive_after == "keep":
                        pass
                    else:  # delete
                        try:
                            os.remove(item.source_path)
                        except OSError:
                            pass
                    scan_dirs.add(out)
                    result, dest = "extracted", out
                else:
                    dest = _unique_dest(dest_dir, item.filename)
                    renamed = os.path.basename(dest) != item.filename
                    _move_file(item.source_path, dest)
                    if item.has_funscript:
                        _move_funscript(item.source_path, dest)
                    scan_dirs.add(dest_dir)
                    result = "renamed" if renamed else "moved"

                if item.thumb_path and os.path.exists(item.thumb_path):
                    try:
                        os.remove(item.thumb_path)
                    except OSError:
                        pass
                item.status = "committed"
                item.error = None
                report.append({"item_id": iid, "filename": item.filename,
                               "result": result, "dest": dest})
            except Exception as e:
                item.status = "error"
                item.error = str(e)
                report.append({"item_id": iid, "filename": item.filename,
                               "result": "error", "message": str(e)})
            db.commit()

        # Register everything that landed. One rescan per unique folder. Uses a
        # fresh session because scan_folder_path drives its own commit lifecycle.
        moved_ok = [r for r in report if r["result"] != "error"]
        if moved_ok:
            _set_state(message="Registering moved files…", current_path=None)
            for d in scan_dirs:
                if os.path.isdir(d):
                    scan_db = SessionLocal()
                    try:
                        scan_folder_path(scan_db, d)
                    finally:
                        scan_db.close()

        _set_state(message=(f"Committed {len(moved_ok)} item(s)."
                            + (f" {len(report) - len(moved_ok)} failed." if len(report) != len(moved_ok) else "")))
    except Exception as e:
        db.rollback()
        _set_state(message=f"Commit error: {e}")
    finally:
        # Report must be visible before done_job_id/running flip, or a poll
        # landing in between reads "finished, empty report" → "0 sorted".
        _intake_state["report"] = report
        _set_state(done_job_id=job_id, running=False, current_path=None)
        db.close()
    return report


def discard_items(db: Session, item_ids: list, delete_file: bool = False) -> dict:
    """Drop intake rows. With delete_file=True the source file is deleted from
    disk too; otherwise it is left in place (just removed from the triage list)."""
    removed = 0
    deleted = 0
    for iid in item_ids:
        item = db.query(IntakeItem).filter(IntakeItem.id == iid).first()
        if not item:
            continue
        if delete_file and item.source_path and os.path.exists(item.source_path):
            try:
                os.remove(item.source_path)
                deleted += 1
            except OSError:
                pass
        if item.thumb_path and os.path.exists(item.thumb_path):
            try:
                os.remove(item.thumb_path)
            except OSError:
                pass
        db.delete(item)
        removed += 1
    db.commit()
    return {"removed": removed, "deleted_files": deleted}


# ── Intake root management ─────────────────────────────────────────────────────
def _overlaps_library(db: Session, path: str) -> bool:
    """True if `path` equals, contains, or sits inside any library root — we must
    never let the intake and library scanners fight over the same tree."""
    norm = os.path.normcase(os.path.normpath(path))
    for lr in db.query(LibraryRoot).all():
        if not lr.path:
            continue
        other = os.path.normcase(os.path.normpath(lr.path))
        if norm == other or norm.startswith(other + os.sep) or other.startswith(norm + os.sep):
            return True
    return False
