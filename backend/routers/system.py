import os
import sys
import json
import shutil
import sqlite3
import subprocess
import tempfile
import threading
from datetime import datetime

_NO_WINDOW = subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0
from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from database import DB_PATH, CONFIG_FILE, CONFIG_DIR

router = APIRouter()

SQLITE_MAGIC = b"SQLite format 3\x00"

# ── Windows startup registry helpers ─────────────────────────────────────────
_STARTUP_REG_KEY   = r"Software\Microsoft\Windows\CurrentVersion\Run"
_STARTUP_REG_VALUE = "TheVault"

def _startup_available() -> bool:
    """Only meaningful when running as a frozen exe on Windows."""
    return sys.platform == "win32" and getattr(sys, "frozen", False)

def _get_startup_enabled() -> bool:
    if not sys.platform == "win32":
        return False
    try:
        import winreg
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, _STARTUP_REG_KEY) as key:
            winreg.QueryValueEx(key, _STARTUP_REG_VALUE)
            return True
    except (FileNotFoundError, OSError):
        return False

def _set_startup_enabled(enabled: bool):
    import winreg
    if enabled:
        exe_path = sys.executable  # path to vault.exe when frozen
        with winreg.OpenKey(
            winreg.HKEY_CURRENT_USER, _STARTUP_REG_KEY, 0, winreg.KEY_SET_VALUE
        ) as key:
            winreg.SetValueEx(key, _STARTUP_REG_VALUE, 0, winreg.REG_SZ, f'"{exe_path}"')
    else:
        try:
            with winreg.OpenKey(
                winreg.HKEY_CURRENT_USER, _STARTUP_REG_KEY, 0, winreg.KEY_SET_VALUE
            ) as key:
                winreg.DeleteValue(key, _STARTUP_REG_VALUE)
        except (FileNotFoundError, OSError):
            pass  # already not set — fine


@router.get("/health")
def health():
    """Simple liveness probe — frontend polls this after a restart."""
    return {"status": "ok"}


@router.get("/backup")
def backup_database():
    """
    Creates a consistent SQLite snapshot using the built-in backup API,
    then returns it as a browser download. Safe to run while the app is active.
    """
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"vault_backup_{stamp}.db"

    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".db")
    tmp.close()

    src = sqlite3.connect(DB_PATH)
    dst = sqlite3.connect(tmp.name)
    src.backup(dst)
    dst.close()
    src.close()

    return FileResponse(
        tmp.name,
        media_type="application/octet-stream",
        filename=filename,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/restore")
async def restore_database(file: UploadFile = File(...)):
    """
    Validates the uploaded file is a real SQLite database, auto-backs up the
    current vault.db alongside it, writes the new file, then restarts the server.
    The client should poll /health until it gets a 200 again.
    """
    content = await file.read()

    # --- Validate: check SQLite magic bytes ---
    if len(content) < 16 or content[:16] != SQLITE_MAGIC:
        raise HTTPException(status_code=400, detail="Not a valid SQLite database file.")

    # --- Validate: try opening it as a real database ---
    tmp_validate = tempfile.NamedTemporaryFile(delete=False, suffix=".db")
    tmp_validate.write(content)
    tmp_validate.close()
    try:
        conn = sqlite3.connect(tmp_validate.name)
        conn.execute("PRAGMA integrity_check")
        conn.close()
    except Exception:
        os.unlink(tmp_validate.name)
        raise HTTPException(status_code=400, detail="Database file failed integrity check.")
    finally:
        try:
            os.unlink(tmp_validate.name)
        except Exception:
            pass

    def _do_restore():
        import time, subprocess
        time.sleep(0.8)

        # Auto-backup current DB before overwriting — lives next to vault.db
        stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        pre_restore_path = DB_PATH + f".pre_restore_{stamp}"
        try:
            shutil.copy2(DB_PATH, pre_restore_path)
        except Exception:
            pass  # Don't block restore if backup fails

        # Close SQLAlchemy connections so Windows doesn't lock the file
        try:
            from database import engine
            engine.dispose()
        except Exception:
            pass

        # Write the uploaded database
        with open(DB_PATH, "wb") as f:
            f.write(content)

        # Restart so SQLAlchemy picks up the new file cleanly
        # Use subprocess.Popen + os._exit (same as /restart) — os.execv is unreliable on Windows
        script = os.path.abspath(sys.argv[0])
        subprocess.Popen([sys.executable, script] + sys.argv[1:], creationflags=_NO_WINDOW)
        os._exit(0)

    threading.Thread(target=_do_restore, daemon=False).start()
    return {"message": "Restoring and restarting…"}


def _read_config() -> dict:
    try:
        if os.path.isfile(CONFIG_FILE):
            with open(CONFIG_FILE, 'r', encoding='utf-8') as f:
                return json.load(f)
    except Exception:
        pass
    return {}


def _write_config(config: dict):
    tmp = CONFIG_FILE + ".tmp"
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(config, f, indent=2)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, CONFIG_FILE)


@router.get("/config")
def get_config():
    """Return the current storage + hardware configuration."""
    config = _read_config()
    from database import DATA_DIR
    return {
        "data_dir":           config.get("data_dir", ""),
        "effective_data_dir": DATA_DIR,
        "config_dir":         CONFIG_DIR,
        "use_gpu":            config.get("use_gpu", True),  # GPU on by default
    }


@router.post("/config")
def set_config(body: dict):
    """Save a new data directory path. Restart required to take effect."""
    new_dir = body.get("data_dir", "").strip()
    if not new_dir:
        raise HTTPException(status_code=400, detail="data_dir cannot be empty.")

    try:
        os.makedirs(new_dir, exist_ok=True)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Cannot create directory: {e}")

    config = _read_config()
    config["data_dir"] = new_dir
    _write_config(config)

    return {"message": "Saved. Restart the server to apply.", "data_dir": new_dir}


@router.post("/config/gpu-mode")
def set_gpu_mode(body: dict):
    """Toggle GPU acceleration for AI tagging. Takes effect immediately — no restart needed."""
    use_gpu = bool(body.get("use_gpu", True))
    config = _read_config()
    config["use_gpu"] = use_gpu
    _write_config(config)
    # Reset tagger singletons so next tagging run picks up the new setting
    try:
        from services.ai_tagger import _reset_singletons
        _reset_singletons()
    except Exception:
        pass
    return {"use_gpu": use_gpu}


@router.get("/startup")
def get_startup():
    """Return whether run-on-startup is enabled and whether it can be toggled."""
    return {
        "enabled":   _get_startup_enabled(),
        "available": _startup_available(),
    }


@router.post("/startup")
def set_startup(body: dict):
    """Enable or disable run-on-startup via the Windows registry."""
    if not sys.platform == "win32":
        raise HTTPException(400, "Startup setting is only supported on Windows.")
    if not _startup_available():
        raise HTTPException(400, "Startup setting is only available in the installed version, not in dev mode.")
    try:
        _set_startup_enabled(bool(body.get("enabled", False)))
    except Exception as e:
        raise HTTPException(500, f"Failed to update startup registry entry: {e}")
    return {"enabled": _get_startup_enabled()}


@router.post("/restart")
def restart_server():
    """
    Schedules a server restart 800ms after the response is sent.
    Uses subprocess.Popen + os._exit so it works reliably on Windows.
    """
    def _do_restart():
        import time, subprocess
        time.sleep(0.8)
        script = os.path.abspath(sys.argv[0])
        subprocess.Popen([sys.executable, script] + sys.argv[1:], creationflags=_NO_WINDOW)
        os._exit(0)

    threading.Thread(target=_do_restart, daemon=False).start()
    return {"message": "Restarting…"}


@router.post("/reset")
def reset_collection():
    """
    Wipes all user-generated content from the database (galleries, images, creators,
    sessions, tags, cards, quests, achievements, XP events) and resets the user
    profile to zero. The DB schema is preserved. The server restarts so SQLAlchemy
    picks up the clean state.
    """
    import sqlite3, time, subprocess

    def _do_reset():
        time.sleep(0.4)
        conn = sqlite3.connect(DB_PATH)
        cur = conn.cursor()
        tables = [
            "card_inventory", "card_packs", "crafting_materials", "credit_events",
            "cards", "playlist_images", "playlists", "image_tags", "gallery_tags",
            "gallery_creators", "session_logs", "xp_events", "quests", "achievements",
            "images", "galleries", "creators", "tags", "library_roots",
        ]
        for t in tables:
            try:
                cur.execute(f"DELETE FROM {t}")
            except Exception:
                pass
        # Reset user profile to zero rather than deleting it
        cur.execute("""
            UPDATE user_profile SET
                total_xp=0, level=1, streak_days=0, grace_tokens=1,
                last_login=NULL, last_spin=NULL, total_cum_count=0,
                total_packs_opened=0, vault_credits=0
        """)
        conn.commit()
        conn.close()
        script = os.path.abspath(sys.argv[0])
        subprocess.Popen([sys.executable, script] + sys.argv[1:], creationflags=_NO_WINDOW)
        os._exit(0)

    threading.Thread(target=_do_reset, daemon=False).start()
    return {"message": "Resetting and restarting…"}
