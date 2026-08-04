from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from sqlalchemy.orm import Session
from typing import List, Optional

from database import get_db, SessionLocal
from models import LibraryRoot, Image
from schemas import LibraryRootCreate, LibraryRootOut, ScanStatus, TaggerStatus, TaggerStartRequest, ModelStatus
from services.scanner import scan_library, scan_folder_path, get_scan_state, cancel_scan, get_scan_log, set_scan_state, is_scan_cancelled, match_funscript_library
from services.scanner import make_thumb_path, generate_thumbnail, generate_video_thumbnail
import services.ai_tagger as ai_tagger
import services.gpu_setup as gpu_setup
from services import task_queue, video_meta
import threading
import os

router = APIRouter()


def _launch_in_thread(fn, *args):
    """Launch fn(*args) in a daemon thread and return immediately."""
    t = threading.Thread(target=fn, args=args, daemon=True)
    t.start()


@router.get("/roots", response_model=List[LibraryRootOut])
def list_roots(db: Session = Depends(get_db)):
    return db.query(LibraryRoot).all()


@router.post("/roots", response_model=LibraryRootOut, status_code=201)
def add_root(data: LibraryRootCreate, db: Session = Depends(get_db)):
    if not os.path.exists(data.path):
        raise HTTPException(400, f"Path does not exist: {data.path}")
    existing = db.query(LibraryRoot).filter(LibraryRoot.path == data.path).first()
    if existing:
        raise HTTPException(400, "Library root already exists")
    root = LibraryRoot(path=data.path, label=data.label)
    db.add(root)
    db.commit()
    db.refresh(root)
    return root


@router.delete("/roots/{root_id}", status_code=204)
def remove_root(root_id: int, db: Session = Depends(get_db)):
    root = db.query(LibraryRoot).filter(LibraryRoot.id == root_id).first()
    if not root:
        raise HTTPException(404, "Library root not found")
    db.delete(root)
    db.commit()


@router.post("/scan")
def start_scan(root_id: int = None):
    label = f"Library scan" + (f" (root {root_id})" if root_id else " (all roots)")
    task_queue.submit(
        'scan', label,
        start_fn=lambda: _launch_in_thread(scan_library, SessionLocal(), root_id),
        poll_fn=get_scan_state,
        cancel_fn=cancel_scan,
    )
    return {"message": "Queued", "queued": True}


@router.post("/backfill-video-durations")
def start_duration_backfill(db: Session = Depends(get_db)):
    """Fill in duration for videos scanned before the probe existed.

    A normal rescan can't do this — the scanner skips images it already has, so
    the column stays empty. This walks them explicitly.
    """
    missing = video_meta.missing_count(db)
    if missing == 0:
        return {"queued": False, "message": "Every video already has a duration", "missing": 0}
    task_queue.submit(
        'video_duration', f'Read length of {missing} videos',
        start_fn=lambda: threading.Thread(
            target=video_meta._backfill_thread, args=(SessionLocal,), daemon=True
        ).start(),
        poll_fn=video_meta.get_state,
        cancel_fn=video_meta.cancel,
    )
    return {"queued": True, "missing": missing}


@router.get("/video-duration-status")
def duration_backfill_status(db: Session = Depends(get_db)):
    st = video_meta.get_state()
    st["missing"] = video_meta.missing_count(db)
    return st


@router.post("/scan-folder")
def start_folder_scan(body: dict):
    """Scan a specific directory path without adding it as a library root."""
    folder_path = (body.get("path") or "").strip()
    if not folder_path:
        raise HTTPException(400, "path required")
    if not os.path.exists(folder_path):
        raise HTTPException(400, f"Path does not exist: {folder_path}")
    label = f"Scan folder: {os.path.basename(folder_path) or folder_path}"
    task_queue.submit(
        'scan', label,
        start_fn=lambda: _launch_in_thread(scan_folder_path, SessionLocal(), folder_path),
        poll_fn=get_scan_state,
        cancel_fn=cancel_scan,
    )
    return {"message": "Queued", "queued": True}


@router.post("/match-funscripts")
def match_funscripts(body: dict = None):
    """Match a central funscript library folder against all videos by filename."""
    from database import _read_config
    body = body or {}
    path = (body.get("path") or "").strip() or _read_config().get("funscript_library_path", "").strip()
    if not path:
        raise HTTPException(400, "No funscript library folder configured")
    if not os.path.isdir(path):
        raise HTTPException(400, f"Path does not exist: {path}")
    task_queue.submit(
        'scan', f'Match funscripts: {os.path.basename(path) or path}',
        start_fn=lambda: _launch_in_thread(match_funscript_library, SessionLocal(), path),
        poll_fn=get_scan_state,
        cancel_fn=cancel_scan,
    )
    return {"message": "Queued", "queued": True}


@router.get("/status", response_model=ScanStatus)
def scan_status():
    return get_scan_state()


@router.post("/cancel")
def cancel_scan_endpoint():
    task_queue.cancel_current()
    return {"message": "Cancel requested"}


def _apply_type_filter(q, only: str | None):
    if only == "videos":
        return q.filter(Image.is_video == True)
    if only == "images":
        return q.filter(Image.is_video == False)
    return q


def _regen_thumbs_task(db: Session, only: str | None = None):
    """Background task: regenerate thumbnails that are missing or whose file is gone.
    `only` restricts the pass to 'videos' or 'images'."""
    q = _apply_type_filter(db.query(Image).filter(Image.file_path.isnot(None)), only)
    images = q.all()
    set_scan_state(
        running=True,
        progress=0,
        total=len(images),
        message=f"Regenerating thumbnails for {len(images)} images…",
        cancelled=False,
        current_path=None,
    )
    fixed = 0
    try:
        for idx, img in enumerate(images):
            if is_scan_cancelled():
                set_scan_state(message="Thumbnail regeneration cancelled.")
                break
            set_scan_state(progress=idx + 1, current_path=img.file_path)
            src = img.file_path
            if not src or not os.path.exists(src):
                continue
            thumb = img.thumb_path or make_thumb_path(src)
            if img.thumb_path and os.path.exists(img.thumb_path):
                continue  # already fine
            ok = generate_video_thumbnail(src, thumb) if img.is_video else generate_thumbnail(src, thumb)
            if ok:
                img.thumb_path = thumb
                fixed += 1
            # Backfill missing video durations while we're touching every video anyway
            # (older scans never probed it — powers the duration badge on video cells)
            if img.is_video and img.duration is None:
                from services.ai_tagger import _video_duration
                img.duration = _video_duration(src)
        if fixed:
            db.commit()
        if not is_scan_cancelled():
            set_scan_state(message=f"Done — {fixed} thumbnail(s) regenerated.")
    finally:
        set_scan_state(running=False, current_path=None)


def _purge_thumbs_task(db: Session, only: str | None = None):
    """Background task: delete thumbnail files from disk (records keep their paths,
    so a follow-up regenerate pass rebuilds them fresh)."""
    q = _apply_type_filter(db.query(Image).filter(Image.thumb_path.isnot(None)), only)
    images = q.all()
    label = only or "all"
    set_scan_state(
        running=True, progress=0, total=len(images),
        message=f"Purging {label} thumbnails ({len(images)})…",
        cancelled=False, current_path=None,
    )
    removed = 0
    try:
        for idx, img in enumerate(images):
            if is_scan_cancelled():
                set_scan_state(message="Thumbnail purge cancelled.")
                break
            set_scan_state(progress=idx + 1)
            try:
                if img.thumb_path and os.path.exists(img.thumb_path):
                    os.remove(img.thumb_path)
                    removed += 1
            except OSError:
                pass
        if not is_scan_cancelled():
            set_scan_state(message=f"Done — {removed} thumbnail(s) purged.")
    finally:
        set_scan_state(running=False, current_path=None)


def _thumb_type(body: dict | None) -> str | None:
    t = (body or {}).get("type")
    return t if t in ("videos", "images") else None


@router.post("/regen-thumbs")
def regen_thumbs(body: dict = None):
    """Regenerate missing thumbnails. Pass {"type": "videos"|"images"} to restrict."""
    only = _thumb_type(body)
    task_queue.submit(
        'regen_thumbs', f"Regenerate {only or 'all'} thumbnails",
        start_fn=lambda: _launch_in_thread(_regen_thumbs_task, SessionLocal(), only),
        poll_fn=get_scan_state,
        cancel_fn=cancel_scan,
    )
    return {"message": "Queued", "queued": True}


@router.post("/purge-thumbs")
def purge_thumbs(body: dict = None):
    """Delete thumbnail files from disk. Pass {"type": "videos"|"images"} to restrict."""
    only = _thumb_type(body)
    task_queue.submit(
        'purge_thumbs', f"Purge {only or 'all'} thumbnails",
        start_fn=lambda: _launch_in_thread(_purge_thumbs_task, SessionLocal(), only),
        poll_fn=get_scan_state,
        cancel_fn=cancel_scan,
    )
    return {"message": "Queued", "queued": True}


@router.get("/log")
def scan_log():
    return {"log": get_scan_log()}


# ── AI Tagger endpoints ───────────────────────────────────────────────────────

@router.get("/ai-tag-models", response_model=ModelStatus)
def ai_tag_model_status():
    """Check which tagger models are downloaded and their sizes."""
    return ModelStatus(
        wd14_downloaded=ai_tagger.wd14_is_ready(),
        joytag_downloaded=ai_tagger.joytag_is_ready(),
        wd14_size_mb=ai_tagger._dir_size_mb(ai_tagger._wd14_dir()) if ai_tagger.wd14_is_ready() else None,
        joytag_size_mb=ai_tagger._dir_size_mb(ai_tagger._joytag_dir()) if ai_tagger.joytag_is_ready() else None,
    )


@router.post("/ai-tag-download")
def ai_tag_download(body: dict):
    """Download WD14, JoyTag, or both."""
    dl_wd14   = bool(body.get("wd14", False))
    dl_joytag = bool(body.get("joytag", False))
    if not dl_wd14 and not dl_joytag:
        raise HTTPException(400, "Specify at least one of: wd14, joytag")
    models = " + ".join(filter(None, ["WD14" if dl_wd14 else None, "JoyTag" if dl_joytag else None]))
    task_queue.submit(
        'model_download', f'Download AI models ({models})',
        start_fn=lambda: _launch_in_thread(ai_tagger.download_models_task, dl_wd14, dl_joytag),
        poll_fn=ai_tagger.get_tagger_state,
        cancel_fn=ai_tagger.cancel_tagger,
    )
    return {"message": "Queued", "queued": True}


@router.post("/ai-tag", response_model=TaggerStatus)
def start_ai_tag(req: TaggerStartRequest):
    """Start a bulk AI tagging run."""
    if not ai_tagger.wd14_is_ready() and not ai_tagger.joytag_is_ready():
        raise HTTPException(400, "No tagger models downloaded. Download WD14 or JoyTag first.")

    if req.scope == "folder":
        if not req.folder_path:
            raise HTTPException(400, "folder_path required when scope=folder")
        if not os.path.exists(req.folder_path):
            raise HTTPException(400, f"Path does not exist: {req.folder_path}")
    elif req.scope == "creator":
        if not req.creator_id:
            raise HTTPException(400, "creator_id required when scope=creator")

    scope_label = req.scope
    if req.scope == "folder" and req.folder_path:
        scope_label = f"folder: {os.path.basename(req.folder_path)}"
    elif req.scope == "creator" and req.creator_id:
        scope_label = f"creator {req.creator_id}"

    task_queue.submit(
        'ai_tag', f'AI tagging ({scope_label})',
        start_fn=lambda: _launch_in_thread(
            ai_tagger.bulk_tag_images,
            SessionLocal(), req.scope, req.folder_path, req.threshold,
            req.retag, req.model_override, req.creator_id,
        ),
        poll_fn=ai_tagger.get_tagger_state,
        cancel_fn=ai_tagger.cancel_tagger,
    )
    return ai_tagger.get_tagger_state()


@router.get("/ai-tag-status", response_model=TaggerStatus)
def ai_tag_status():
    state = ai_tagger.get_tagger_state()
    try:
        import onnxruntime as ort
        providers = ort.get_available_providers()
        state["cuda_available"] = "CUDAExecutionProvider" in providers
    except Exception:
        state["cuda_available"] = False
    return state


@router.post("/ai-tag-cancel")
def ai_tag_cancel():
    state = ai_tagger.get_tagger_state()
    if not state["running"]:
        return {"message": "No tagging job running"}
    ai_tagger.cancel_tagger()
    return {"message": "Cancel requested"}


# ── GPU DLL on-demand download ────────────────────────────────────────────────

@router.get("/gpu-status")
def gpu_status():
    """Return GPU availability and DLL download state."""
    state = gpu_setup.get_state()

    # dlls_present: True if DLLs are available from ANY source —
    # on-demand download cache (DATA_DIR/gpu_dlls/) OR pip-installed nvidia packages in venv.
    state["dlls_present"] = gpu_setup.dlls_accessible()

    # Ground truth: did the tagger actually load a model on GPU?
    # This is set by _make_session() after a real session is created.
    tagger_device = ai_tagger.get_tagger_state().get("device")  # "gpu" | "cpu" | None
    state["tagger_device"] = tagger_device

    # cuda_available: hierarchy of confidence
    # 1. tagger_device == "gpu"  → confirmed by an actual inference session (best)
    # 2. ctypes probe for cudnn64_9.dll — reliable; get_available_providers() is NOT usable
    #    because onnxruntime-gpu builds always list CUDAExecutionProvider regardless of whether
    #    cudnn is loadable, producing a false positive when the DLLs are missing.
    state["cuda_available"] = tagger_device == "gpu"
    if not state["cuda_available"]:
        try:
            import ctypes
            ctypes.cdll.LoadLibrary("cudnn64_9.dll")
            state["cuda_available"] = True
        except Exception:
            pass

    # has_nvidia_gpu: used to decide whether to offer the DLL download to new users
    state["has_nvidia_gpu"] = state["cuda_available"] or gpu_setup.has_nvidia_gpu()
    return state


@router.post("/gpu-download")
def gpu_download_start():
    """Start the background GPU DLL download from PyPI. No-op if already running or done."""
    if not gpu_setup.has_nvidia_gpu():
        raise HTTPException(400, "No NVIDIA GPU detected on this machine")
    if gpu_setup.dlls_present():
        return {"message": "GPU DLLs already present"}
    gpu_setup.start_download()
    return {"message": "Download started"}


@router.get("/browse-folder")
def browse_folder():
    """Open a native OS folder picker and return the selected path."""
    import subprocess, sys

    try:
        if sys.platform == "win32":
            # PowerShell script that opens a modern Windows FolderBrowserDialog.
            # -STA is required so the dialog doesn't deadlock when called from a
            # background thread (e.g. uvicorn worker or frozen PyInstaller exe).
            ps_script = (
                "Add-Type -AssemblyName System.Windows.Forms;"
                "$f = New-Object System.Windows.Forms.FolderBrowserDialog;"
                "$f.Description = 'Select library folder';"
                "$f.ShowNewFolderButton = $true;"
                "$w = New-Object System.Windows.Forms.Form;"
                "$w.TopMost = $true;"
                "$r = $f.ShowDialog($w);"
                "if ($r -eq 'OK') { $f.SelectedPath } else { '' }"
            )
            result = subprocess.run(
                ["powershell", "-STA", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps_script],
                capture_output=True, text=True, timeout=120,
                creationflags=0x08000000,  # CREATE_NO_WINDOW — suppress console flash
            )
            folder = result.stdout.strip()
        else:
            # Linux/Mac: use zenity (GTK) if available, fall back to kdialog (KDE)
            for cmd in [["zenity", "--file-selection", "--directory", "--title=Select library folder"],
                        ["kdialog", "--getexistingdirectory", "/"]]:
                try:
                    result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
                    folder = result.stdout.strip()
                    break
                except FileNotFoundError:
                    folder = ""
        return {"path": folder}
    except subprocess.TimeoutExpired:
        raise HTTPException(500, "Folder picker timed out")
    except Exception as e:
        raise HTTPException(500, f"Could not open folder dialog: {str(e)}")
