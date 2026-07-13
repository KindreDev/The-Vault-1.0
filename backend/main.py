# Natural filename sort added to gallery_images + list_images (galleries.py, images.py)
from fastapi import FastAPI, Request, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.base import BaseHTTPMiddleware
import uvicorn
import os
import sys
import logging
import threading
import asyncio
import datetime
import collections
import io


def _register_nvidia_dll_dirs():
    """Windows: inject pip-installed nvidia DLL directories into PATH and os.add_dll_directory.

    onnxruntime's C++ LoadLibrary calls use the process PATH — os.add_dll_directory alone
    is not sufficient. We prepend every nvidia/*/bin directory to PATH so Windows finds
    cudnn64_9.dll, cudnn_ops64_9.dll, cublas64_12.dll, etc. before anything else."""
    if sys.platform != "win32":
        return

    NVIDIA_PKGS = [
        "cudnn", "cublas", "cuda_runtime", "cuda_nvrtc",
        "cufft", "curand", "cusolver", "cusparse",
    ]

    # Build candidate roots — PyInstaller bundle first, then venv, then system
    roots = []

    # 1. PyInstaller bundle (_internal/nvidia/*/bin — added by vault.spec binaries)
    meipass = getattr(sys, "_MEIPASS", None)
    if meipass:
        roots.append(meipass)

    # 2. Venv site-packages (dev mode via start.bat)
    venv_sp = os.path.join(os.path.dirname(os.path.abspath(__file__)), "venv", "Lib", "site-packages")
    if os.path.isdir(venv_sp):
        roots.append(venv_sp)

    # 3. System Python site-packages fallback
    try:
        import site
        try:
            roots += [p for p in site.getsitepackages() if p not in roots]
        except Exception:
            pass
        try:
            usr = site.getusersitepackages()
            if usr not in roots:
                roots.append(usr)
        except Exception:
            pass
    except Exception:
        pass

    # 4. On-demand download cache (DATA_DIR/gpu_dlls — set by gpu_setup.py)
    try:
        from database import DATA_DIR as _DATA_DIR
        gpu_dlls = os.path.join(_DATA_DIR, "gpu_dlls")
        if os.path.isdir(gpu_dlls) and gpu_dlls not in roots:
            roots.append(gpu_dlls)
    except Exception:
        pass

    found = []
    for sp in roots:
        for pkg in NVIDIA_PKGS:
            bin_dir = os.path.join(sp, "nvidia", pkg, "bin")
            if os.path.isdir(bin_dir) and bin_dir not in found:
                found.append(bin_dir)

    if found:
        # Prepend ALL found dirs to PATH — this is what onnxruntime's C++ LoadLibrary uses
        extra = os.pathsep.join(found)
        os.environ["PATH"] = extra + os.pathsep + os.environ.get("PATH", "")
        # Also register via os.add_dll_directory for Python's own import machinery
        for d in found:
            try:
                os.add_dll_directory(d)
            except Exception:
                pass
        print(f"[GPU] Injected {len(found)} nvidia DLL dir(s) into PATH:")
        for d in found:
            print(f"  {d}")
    else:
        print("[GPU] No nvidia DLL dirs found in any of these roots:")
        for r in roots:
            print(f"  {r}  (exists={os.path.isdir(r)})")
        # Suppress onnxruntime's CUDA provider DLL loading error (cudnn64_9.dll missing).
        # ORT_LOGGING_LEVEL=4 (FATAL) is read by the C++ logger at ort import time —
        # before any Python try/except can intercept it. Without this the console
        # shows a scary [E:onnxruntime] error on every startup for non-GPU users.
        # When DLLs ARE present (found is non-empty) the PATH injection above is enough.
        os.environ.setdefault("ORT_LOGGING_LEVEL", "4")

_register_nvidia_dll_dirs()

# ── In-process log capture ────────────────────────────────────────────────────
# All Python logging output is captured here so the Console page can stream it.
# _LOG_ENTRIES is a bounded deque (max 3 000 lines); SSE clients get the last
# 100 lines on connect, then live-streamed updates every 250 ms.

_MAX_LOG = 3000
_LOG_ENTRIES: collections.deque = collections.deque(maxlen=_MAX_LOG)
_LOG_SEQ   = 0
_LOG_LOCK  = threading.Lock()


class _VaultLogHandler(logging.Handler):
    """Append every log record to the in-memory deque."""

    # Patterns that produce walls of noise and carry no actionable information.
    # ConnectionResetError / WinError 10054 fires every time the browser
    # aborts a video range-request (completely normal on rapid video navigation).
    _NOISE = (
        'ConnectionResetError',
        'WinError 10054',
        '_call_connection_lost',
        '_ProactorBasePipeTransport',
    )

    def emit(self, record: logging.LogRecord):
        global _LOG_SEQ
        try:
            msg = self.format(record)
            # Suppress known-benign Windows asyncio noise from aborted streams
            if any(p in msg for p in self._NOISE):
                return
            ts = datetime.datetime.fromtimestamp(record.created).strftime('%H:%M:%S')
            with _LOG_LOCK:
                _LOG_ENTRIES.append({
                    "seq":   _LOG_SEQ,
                    "level": record.levelname,
                    "ts":    ts,
                    "msg":   msg,
                })
                _LOG_SEQ += 1
        except Exception:
            pass


class _StdCapture:
    """Redirect stdout / stderr into the log capture when running as a frozen EXE.

    The Windows console window is hidden (console=False in vault.spec) so all
    print() / uvicorn stdout goes here instead of disappearing.
    """
    def __init__(self, level: str = "INFO"):
        self._level   = level
        self._logger  = logging.getLogger("vault.stdout")
        self._buf: list = []

    def write(self, data: str):
        self._buf.append(data)
        if "\n" in data:
            line = "".join(self._buf).rstrip("\n")
            self._buf.clear()
            if line.strip():
                getattr(self._logger, self._level.lower())(line)

    def flush(self):
        if self._buf:
            line = "".join(self._buf).rstrip("\n")
            self._buf.clear()
            if line.strip():
                getattr(self._logger, self._level.lower())(line)

    def fileno(self):
        raise io.UnsupportedOperation("fileno")


# Install the handler on the root logger so every library's output is captured.
_vault_handler = _VaultLogHandler()
_vault_handler.setFormatter(logging.Formatter("%(name)s — %(message)s"))
logging.getLogger().addHandler(_vault_handler)
logging.getLogger().setLevel(logging.DEBUG)

# When running as a frozen EXE the console is hidden; redirect stdout/stderr
# into the log capture so print() statements are visible in the Console page.
if getattr(sys, 'frozen', False):
    sys.stdout = _StdCapture("INFO")
    sys.stderr = _StdCapture("ERROR")


from sqlalchemy.orm import Session
from database import engine, Base, SessionLocal, get_db, DATA_DIR
from routers import galleries, creators, images, tags, sessions, gamification, scanner, playlists, dedup, tasks
from routers.cards import router as cards_router, economy_router
from routers.system import router as system_router
from routers.companion import router as companion_router

Base.metadata.create_all(bind=engine)

def _migrate_add_columns():
    """Add columns introduced after initial schema creation.
    Uses ALTER TABLE … ADD COLUMN; skips columns that already exist instead of
    blindly swallowing every exception, so real schema errors surface.
    """
    import sqlalchemy
    from sqlalchemy.exc import OperationalError
    migrations = [
        # creators — columns added post-launch
        "ALTER TABLE creators ADD COLUMN rating FLOAT DEFAULT 0.0",
        "ALTER TABLE creators ADD COLUMN banner_path VARCHAR",
        "ALTER TABLE creators ADD COLUMN card_level INTEGER DEFAULT 1",
        # images — Phase 2 columns added to the ORM model but missing from older DBs
        "ALTER TABLE images ADD COLUMN sort_order INTEGER DEFAULT 0",
        "ALTER TABLE images ADD COLUMN preview_path VARCHAR",
        "ALTER TABLE images ADD COLUMN ai_tagged BOOLEAN DEFAULT 0",
        "ALTER TABLE images ADD COLUMN ai_tag_model VARCHAR",
        "ALTER TABLE images ADD COLUMN mime_type VARCHAR",
        "ALTER TABLE images ADD COLUMN duration FLOAT",
        "ALTER TABLE images ADD COLUMN funscript_path VARCHAR",
        # creators — banner persistence columns
        "ALTER TABLE creators ADD COLUMN banner_image_id INTEGER",
        "ALTER TABLE creators ADD COLUMN banner_y FLOAT DEFAULT 20.0",
        "ALTER TABLE creators ADD COLUMN banner_zoom FLOAT DEFAULT 1.0",
        # TCG: vault credits on user profile
        "ALTER TABLE user_profile ADD COLUMN vault_credits INTEGER DEFAULT 0",
        # sessions — duration tracking
        "ALTER TABLE session_logs ADD COLUMN duration_sec INTEGER",
        # Phase 9: character link on galleries
        "ALTER TABLE galleries ADD COLUMN linked_character_id INTEGER REFERENCES creators(id)",
        # Achievement tracking counters
        "ALTER TABLE user_profile ADD COLUMN total_cum_count INTEGER DEFAULT 0",
        "ALTER TABLE user_profile ADD COLUMN daily_cum_count INTEGER DEFAULT 0",
        "ALTER TABLE user_profile ADD COLUMN last_cum_date DATETIME",
        "ALTER TABLE user_profile ADD COLUMN total_images_rated INTEGER DEFAULT 0",
        "ALTER TABLE user_profile ADD COLUMN total_tags_added INTEGER DEFAULT 0",
        "ALTER TABLE user_profile ADD COLUMN tags_added_today INTEGER DEFAULT 0",
        "ALTER TABLE user_profile ADD COLUMN last_tag_date DATETIME",
        "ALTER TABLE user_profile ADD COLUMN wiki_import_count INTEGER DEFAULT 0",
        # Collection value & period tracking
        "ALTER TABLE galleries ADD COLUMN period_month INTEGER",
        "ALTER TABLE galleries ADD COLUMN period_year INTEGER",
        "ALTER TABLE galleries ADD COLUMN purchase_value FLOAT DEFAULT 0.0",
        "ALTER TABLE creators ADD COLUMN completion_rewarded_at DATETIME",
        # TCG: collab card metadata
        "ALTER TABLE cards ADD COLUMN collab_data TEXT",
        # Image focal point for card display
        "ALTER TABLE images ADD COLUMN focal_x FLOAT DEFAULT 0.5",
        "ALTER TABLE images ADD COLUMN focal_y FLOAT DEFAULT 0.0",
        # User profile: avatar + custom title selection
        "ALTER TABLE user_profile ADD COLUMN avatar_path VARCHAR",
        "ALTER TABLE user_profile ADD COLUMN avatar_focal_x FLOAT DEFAULT 0.5",
        "ALTER TABLE user_profile ADD COLUMN avatar_focal_y FLOAT DEFAULT 0.5",
        "ALTER TABLE user_profile ADD COLUMN selected_title VARCHAR",
        "ALTER TABLE quests ADD COLUMN credit_reward INTEGER DEFAULT 0",
        "ALTER TABLE achievements ADD COLUMN credit_reward INTEGER DEFAULT 0",
        "ALTER TABLE user_profile ADD COLUMN total_sessions_logged INTEGER DEFAULT 0",
        "ALTER TABLE user_profile ADD COLUMN total_packs_opened INTEGER DEFAULT 0",
        "ALTER TABLE user_profile ADD COLUMN daily_bonus_date DATETIME",
        "ALTER TABLE user_profile ADD COLUMN weekly_bonus_week INTEGER",
        # Pack inventory — quest-awarded packs held until manually opened
        "ALTER TABLE user_profile ADD COLUMN standard_packs INTEGER DEFAULT 0",
        "ALTER TABLE user_profile ADD COLUMN premium_packs INTEGER DEFAULT 0",
        # View time tracking — Phase 2 feature
        "ALTER TABLE images ADD COLUMN view_seconds INTEGER DEFAULT 0",
        # AI tagging — person count per image
        "ALTER TABLE images ADD COLUMN person_count INTEGER",
        # AI tagging — confidence + model on the image_tags junction
        "ALTER TABLE image_tags ADD COLUMN confidence FLOAT",
        "ALTER TABLE image_tags ADD COLUMN tagger_model VARCHAR",
        # Creator status & retirement year
        "ALTER TABLE creators ADD COLUMN status VARCHAR DEFAULT 'Active'",
        "ALTER TABLE creators ADD COLUMN retirement_year INTEGER",
        # Deduplication — perceptual hash
        "ALTER TABLE images ADD COLUMN perceptual_hash VARCHAR",
        # Creator source folder — auto-assign galleries by directory
        "ALTER TABLE creators ADD COLUMN source_folder VARCHAR",
        "ALTER TABLE images ADD COLUMN last_viewed_at DATETIME",
        # Mix galleries — virtual gallery from random mix
        "ALTER TABLE galleries ADD COLUMN is_mix BOOLEAN DEFAULT 0",
        # Completion rewards — claimable flags (packs are awarded on explicit claim, not auto)
        "ALTER TABLE user_profile ADD COLUMN daily_bonus_claimable INTEGER DEFAULT 0",
        "ALTER TABLE user_profile ADD COLUMN weekly_bonus_claimable INTEGER DEFAULT 0",
        # Creator title (replaces display_name; shown as "Name — Title" in header)
        "ALTER TABLE creators ADD COLUMN title VARCHAR",
        # Bond system — organic accumulation; bond_gifts boosted by gifting hearts
        "ALTER TABLE creators ADD COLUMN bond_override INTEGER",   # kept for safe migration; no longer used
        "ALTER TABLE creators ADD COLUMN bond_gifts INTEGER DEFAULT 0",
        # Hearts — earned by dismantling rare+ cards; gifted to creators to boost bond
        "ALTER TABLE user_profile ADD COLUMN hearts INTEGER DEFAULT 0",
        # Companion (Erika AI) — tables created via Base.metadata.create_all; no ALTER needed
        # (companion_config and companion_messages are new tables, not column additions)
        # Companion persona fields on Creator
        "ALTER TABLE creators ADD COLUMN companion_prompt TEXT",
        "ALTER TABLE creators ADD COLUMN personality_type VARCHAR DEFAULT 'bold'",
        "ALTER TABLE creators ADD COLUMN companion_bond_xp INTEGER DEFAULT 0",
        "ALTER TABLE creators ADD COLUMN companion_bond_level INTEGER DEFAULT 0",
        "ALTER TABLE companion_config ADD COLUMN saved_models TEXT DEFAULT '[]'",
        "ALTER TABLE companion_config ADD COLUMN keep_alive VARCHAR DEFAULT '10m'",
        "ALTER TABLE companion_config ADD COLUMN companion_prompt TEXT",
        "ALTER TABLE companion_messages ADD COLUMN image_data_url TEXT",
        "ALTER TABLE companion_config ADD COLUMN num_ctx INTEGER DEFAULT 16384",
        # Image file mtime — on-disk last-modified date, for sort by date_modified
        "ALTER TABLE images ADD COLUMN file_modified_at DATETIME",
        # Gamification — dismantle achievement counter
        "ALTER TABLE user_profile ADD COLUMN total_cards_dismantled INTEGER DEFAULT 0",
    ]
    with engine.connect() as conn:
        for sql in migrations:
            try:
                conn.execute(sqlalchemy.text(sql))
                conn.commit()
            except OperationalError as e:
                # "duplicate column name: X" is expected on subsequent boots
                if "duplicate column" not in str(e).lower():
                    print(f"[migration] unexpected error running `{sql}`: {e}")

_migrate_add_columns()


def _migrate_add_indexes():
    """Add performance indexes. Uses CREATE INDEX IF NOT EXISTS — safe to run on every restart.

    Without these indexes SQLite does full table scans. On a collection with thousands
    of images the difference is milliseconds vs hundreds of milliseconds per query.

    Teaching note: to verify indexes on an existing DB, open vault.db in DB Browser for
    SQLite → Database Structure tab → you should see these idx_* entries listed.
    Alternatively run: SELECT name FROM sqlite_master WHERE type='index' ORDER BY name;
    """
    import sqlalchemy
    indexes = [
        # images — gallery_id is the hottest FK (get all images in a gallery)
        "CREATE INDEX IF NOT EXISTS idx_images_gallery_id    ON images(gallery_id)",
        "CREATE INDEX IF NOT EXISTS idx_images_is_video      ON images(is_video)",
        "CREATE INDEX IF NOT EXISTS idx_images_rating        ON images(rating)",
        "CREATE INDEX IF NOT EXISTS idx_images_is_favorite   ON images(is_favorite)",
        "CREATE INDEX IF NOT EXISTS idx_images_ai_tagged     ON images(ai_tagged)",
        "CREATE INDEX IF NOT EXISTS idx_images_last_viewed   ON images(last_viewed_at)",
        # galleries — creator_id FK + common filter columns
        "CREATE INDEX IF NOT EXISTS idx_galleries_creator_id   ON galleries(creator_id)",
        "CREATE INDEX IF NOT EXISTS idx_galleries_library_root ON galleries(library_root_id)",
        "CREATE INDEX IF NOT EXISTS idx_galleries_rating        ON galleries(rating)",
        "CREATE INDEX IF NOT EXISTS idx_galleries_is_favorite   ON galleries(is_favorite)",
        "CREATE INDEX IF NOT EXISTS idx_galleries_updated_at    ON galleries(updated_at)",
        # session_logs — FK columns + time ordering (history / stats queries)
        "CREATE INDEX IF NOT EXISTS idx_sessions_gallery_id  ON session_logs(gallery_id)",
        "CREATE INDEX IF NOT EXISTS idx_sessions_creator_id  ON session_logs(creator_id)",
        "CREATE INDEX IF NOT EXISTS idx_sessions_image_id    ON session_logs(image_id)",
        "CREATE INDEX IF NOT EXISTS idx_sessions_logged_at   ON session_logs(logged_at)",
        # xp_events — time ordering for the XP history page
        "CREATE INDEX IF NOT EXISTS idx_xp_events_earned_at  ON xp_events(earned_at)",
        # join tables — second column needs its own index for reverse lookups
        # (primary key covers the first column automatically)
        "CREATE INDEX IF NOT EXISTS idx_image_tags_tag_id         ON image_tags(tag_id)",
        "CREATE INDEX IF NOT EXISTS idx_gallery_tags_tag_id        ON gallery_tags(tag_id)",
        "CREATE INDEX IF NOT EXISTS idx_gallery_creators_creator   ON gallery_creators(creator_id)",
        "CREATE INDEX IF NOT EXISTS idx_playlist_images_image_id   ON playlist_images(image_id)",
        # cards — FK lookups when enriching card data
        "CREATE INDEX IF NOT EXISTS idx_cards_source_image   ON cards(source_image_id)",
        "CREATE INDEX IF NOT EXISTS idx_cards_source_gallery ON cards(source_gallery_id)",
        "CREATE INDEX IF NOT EXISTS idx_cards_source_creator ON cards(source_creator_id)",
        # card_inventory — FK lookup when checking what a user owns
        "CREATE INDEX IF NOT EXISTS idx_card_inv_card_id     ON card_inventory(card_id)",
    ]
    with engine.connect() as conn:
        for sql in indexes:
            try:
                conn.execute(sqlalchemy.text(sql))
                conn.commit()
            except Exception as e:
                print(f"[index migration] unexpected error: {e}")

_migrate_add_indexes()


def _migrate_creator_id_to_m2m():
    """One-time migration: seed gallery_creators from legacy creator_id FK."""
    from models import Gallery, Creator, gallery_creators
    from sqlalchemy import select
    db = SessionLocal()
    try:
        for g in db.query(Gallery).filter(Gallery.creator_id.isnot(None)).all():
            exists = db.execute(
                select(gallery_creators).where(
                    gallery_creators.c.gallery_id == g.id,
                    gallery_creators.c.creator_id == g.creator_id,
                )
            ).first()
            if not exists:
                c = db.query(Creator).filter(Creator.id == g.creator_id).first()
                if c and c not in g.creators:
                    g.creators.append(c)
                    g.is_tagged = True
        db.commit()
    finally:
        db.close()

_migrate_creator_id_to_m2m()


def _migrate_creator_rarity():
    """Rename legacy tier values to match the canonical system."""
    import sqlalchemy
    db = SessionLocal()
    try:
        db.execute(sqlalchemy.text("UPDATE creators SET card_rarity='legendary' WHERE card_rarity='mythic'"))
        # celestial (My Queen) retired — merge into Grand Collection tier
        db.execute(sqlalchemy.text("UPDATE creators SET card_rarity='legendary' WHERE card_rarity='celestial'"))
        # relic tier retired — merge into Grand Collection (legendary)
        db.execute(sqlalchemy.text("UPDATE creators SET card_rarity='legendary' WHERE card_rarity='relic'"))
        # Copy display_name → title for existing records (column may not exist on fresh DBs)
        try:
            db.execute(sqlalchemy.text(
                "UPDATE creators SET title = display_name WHERE title IS NULL AND display_name IS NOT NULL"
            ))
        except Exception:
            pass
        db.commit()
    finally:
        db.close()

_migrate_creator_rarity()

app = FastAPI(title="The Vault", version="1.2.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"],
    # Mobile: Capacitor APK WebView origins + any private-LAN address (phone on same WiFi).
    # The iOS PWA is same-origin (served from :8000) so it needs no CORS entry.
    allow_origin_regex=(
        r"^(https?://localhost(:\d+)?"
        r"|capacitor://localhost|ionic://localhost"
        r"|https?://(192\.168|10|172\.(1[6-9]|2\d|3[01]))\.[0-9.]+(:\d+)?)$"
    ),
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization"],
    expose_headers=["X-Total-Count"],
)


# Cache thumbnails aggressively — they're content-addressed by md5 hash
class ThumbsCacheMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        if request.url.path.startswith("/thumbs/"):
            response.headers["Cache-Control"] = "public, max-age=604800, immutable"
        return response

app.add_middleware(ThumbsCacheMiddleware)
app.add_middleware(GZipMiddleware, minimum_size=500)


# ── HTTP request logger ───────────────────────────────────────────────────────
# Pure ASGI middleware — writes directly to _LOG_ENTRIES, bypassing the Python
# logging chain entirely so no handler misconfiguration can silence it.

def _log_direct(level: str, msg: str):
    """Thread-safe direct write to the in-memory log deque."""
    global _LOG_SEQ
    with _LOG_LOCK:
        _LOG_ENTRIES.append({
            "seq":   _LOG_SEQ,
            "level": level,
            "ts":    datetime.datetime.now().strftime('%H:%M:%S'),
            "msg":   msg,
        })
        _LOG_SEQ += 1

class _RequestLogMiddleware:
    """Thin ASGI wrapper — logs every /api/ request directly to _LOG_ENTRIES."""
    def __init__(self, app):
        self._app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self._app(scope, receive, send)
            return
        path   = scope.get("path", "")
        method = scope.get("method", "")
        # Only log /api/ calls; skip the SSE stream itself and static assets
        if not path.startswith("/api/") or path == "/api/system/console/stream":
            await self._app(scope, receive, send)
            return
        # Skip video/file range requests — 206 Partial Content fires on every
        # seek and navigation, producing hundreds of identical log lines.
        is_file_request = path.endswith("/file") or "/file?" in path
        status_code = 0
        async def _send(message):
            nonlocal status_code
            if message["type"] == "http.response.start":
                status_code = message.get("status", 0)
            await send(message)
        await self._app(scope, receive, _send)
        # Suppress 206 Partial Content for file routes — these fire on every
        # video seek/navigation and create walls of identical log lines.
        if is_file_request and status_code == 206:
            return
        _log_direct("INFO", f"{method} {path} → {status_code}")

app.add_middleware(_RequestLogMiddleware)


# ── Console log endpoints ─────────────────────────────────────────────────────

@app.get("/api/system/console")
def get_console_log(last: int = 200):
    """Return the last `last` captured log lines as JSON."""
    with _LOG_LOCK:
        entries = list(_LOG_ENTRIES)[-last:]
    return {"entries": entries, "total": len(_LOG_ENTRIES)}


@app.get("/api/system/console/stream")
async def stream_console_log(request: Request):
    """Server-Sent Events stream of log lines.

    On connect: directly injects a 'connected' marker into _LOG_ENTRIES (no
    Python logging chain involved), sends the last 200 buffered lines, then
    polls every 250 ms for new lines.
    Client receives JSON: {seq, level, ts, msg}.
    """
    from fastapi.responses import StreamingResponse
    import json

    # Direct write — guaranteed to appear even if the logging chain is broken
    _log_direct("INFO", f"Console connected — {len(_LOG_ENTRIES)} entries in buffer")

    async def _generate():
        # Seed: last 200 lines including the connected-marker above
        with _LOG_LOCK:
            seed = list(_LOG_ENTRIES)[-200:]

        last_seq = -1
        for entry in seed:
            yield f"data: {json.dumps(entry)}\n\n"
            last_seq = entry["seq"]

        # Live stream — poll every 250 ms, send keepalive comment every ~15 s
        ticks = 0
        while True:
            if await request.is_disconnected():
                break
            with _LOG_LOCK:
                new_entries = [e for e in _LOG_ENTRIES if e["seq"] > last_seq]
            for entry in new_entries:
                yield f"data: {json.dumps(entry)}\n\n"
                last_seq = entry["seq"]
            ticks += 1
            if ticks % 60 == 0:          # every 60 × 250 ms = 15 s
                yield ": keepalive\n\n"  # SSE comment — keeps connection alive
            await asyncio.sleep(0.25)

    return StreamingResponse(
        _generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control":    "no-cache",
            "X-Accel-Buffering": "no",
            "Connection":       "keep-alive",
        },
    )


@app.on_event("startup")
async def _on_startup():
    """Write a startup banner directly to the log buffer."""
    import platform
    _log_direct("INFO",
        f"The Vault started — Python {platform.python_version()} · {platform.system()}"
    )

app.include_router(galleries.router,     prefix="/api/galleries",     tags=["galleries"])
app.include_router(creators.router,      prefix="/api/creators",      tags=["creators"])
app.include_router(images.router,        prefix="/api/images",        tags=["images"])
app.include_router(tags.router,          prefix="/api/tags",          tags=["tags"])
app.include_router(sessions.router,      prefix="/api/sessions",      tags=["sessions"])
app.include_router(gamification.router,  prefix="/api/gamification",  tags=["gamification"])
app.include_router(scanner.router,       prefix="/api/scanner",       tags=["scanner"])
app.include_router(playlists.router,     prefix="/api/playlists",     tags=["playlists"])
app.include_router(cards_router)
app.include_router(economy_router)
app.include_router(system_router,            prefix="/api/system",        tags=["system"])
app.include_router(dedup.router,             prefix="/api/dedup",          tags=["dedup"])
app.include_router(tasks.router,             prefix="/api/tasks",          tags=["tasks"])
app.include_router(companion_router,         prefix="/api/companion",      tags=["companion"])

THUMBS_DIR = os.path.join(DATA_DIR, "thumbs")
os.makedirs(THUMBS_DIR, exist_ok=True)
app.mount("/thumbs", StaticFiles(directory=THUMBS_DIR), name="thumbs")

@app.get("/api/health")
def health():
    return {"status": "ok", "app": "The Vault"}


@app.post("/api/debug/seed-credits")
def seed_credits(amount: int = 10000, db: Session = Depends(get_db)):
    """Dev-only: add credits directly to the profile."""
    from services.gamification import get_or_create_profile
    profile = get_or_create_profile(db)
    profile.vault_credits = (profile.vault_credits or 0) + amount
    db.commit()
    return {"vault_credits": profile.vault_credits}


@app.post("/api/debug/level-up")
def debug_level_up(db: Session = Depends(get_db)):
    """Dev-only: set XP to one below the next level threshold.
    The overlay fires when you earn any XP next (spin wheel, rate anything).
    """
    from services.gamification import get_or_create_profile, _compute_level, _xp_for_level
    profile = get_or_create_profile(db)
    next_level = min(profile.level + 1, 100)
    # One XP below the threshold — the very next frontend action crosses it
    profile.total_xp = max(0, _xp_for_level(next_level) - 1)
    new_level, new_title, _ = _compute_level(profile.total_xp)
    profile.level = new_level
    profile.level_title = new_title
    db.commit()
    return {"level": new_level, "title": new_title, "xp_to_next": 1, "total_xp": profile.total_xp}


# ── Serve the mobile PWA (phones on the LAN) ─────────────────────────────────
# A phone on the same WiFi opens http://<pc-ip>:8000/m, taps "Add to Home
# Screen", and gets a fullscreen app that talks to this same server for data.
# It's a separate build (npm run build:pwa → dist-pwa, base '/m/') served under
# /m so it never collides with the desktop app mounted at the root.
# IMPORTANT: registered BEFORE the desktop catch-all below so /m wins.

def _get_mobile_dir():
    if getattr(sys, 'frozen', False):
        return os.path.join(sys._MEIPASS, 'frontend-mobile', 'dist-pwa')
    candidate = os.path.normpath(
        os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'frontend-mobile', 'dist-pwa')
    )
    return candidate if os.path.isdir(candidate) else None

_MOBILE_DIR = _get_mobile_dir()

if _MOBILE_DIR and os.path.isdir(_MOBILE_DIR):
    _m_assets = os.path.join(_MOBILE_DIR, 'assets')
    if os.path.isdir(_m_assets):
        app.mount("/m/assets", StaticFiles(directory=_m_assets), name="mobile-assets")

    # index.html is cached but always revalidated: "no-cache" lets the WebView
    # keep a copy and just ask "still current?" on each load. FileResponse sends
    # an ETag, so unchanged builds get a near-instant 304 (no re-download); only
    # when the build changes does the hashed-chunk index.html actually re-fetch.
    # It must not be cached *immutably* — its chunk names change every build.
    _MOBILE_NO_CACHE = {"Cache-Control": "no-cache"}

    # SPA fallback for everything under /m — serves real files (manifest, icons,
    # sw.js) when they exist, otherwise index.html so React Router takes over.
    @app.get("/m", include_in_schema=False)
    @app.get("/m/{full_path:path}", include_in_schema=False)
    async def _serve_mobile(full_path: str = ""):
        candidate = os.path.join(_MOBILE_DIR, full_path)
        if full_path and os.path.isfile(candidate) and os.path.basename(candidate) != "index.html":
            return FileResponse(candidate)
        return FileResponse(os.path.join(_MOBILE_DIR, "index.html"), headers=_MOBILE_NO_CACHE)


# ── Serve the pre-built React frontend ───────────────────────────────────────
# Active only when frontend/dist/ exists (production build or bundled exe).
# In dev mode the Vite dev-server on :5173 proxies to :8000 instead.

def _get_frontend_dir():
    if getattr(sys, 'frozen', False):
        # PyInstaller bundle — bundled data lives under sys._MEIPASS
        return os.path.join(sys._MEIPASS, 'frontend', 'dist')
    # Dev / CI — look for an already-built dist next to the backend
    candidate = os.path.normpath(
        os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'frontend', 'dist')
    )
    return candidate if os.path.isdir(candidate) else None

_FRONTEND_DIR = _get_frontend_dir()

if _FRONTEND_DIR and os.path.isdir(_FRONTEND_DIR):
    # /assets → Vite's hashed JS/CSS bundles (served efficiently by StaticFiles)
    _assets_dir = os.path.join(_FRONTEND_DIR, 'assets')
    if os.path.isdir(_assets_dir):
        app.mount("/assets", StaticFiles(directory=_assets_dir), name="frontend-assets")

    # index.html is cached but revalidated, never frozen. "no-cache" lets the
    # WebView store a copy and just ask the server "still current?" on each load;
    # FileResponse sends an ETag so an unchanged build answers 304 in well under
    # a millisecond (no re-download). Only when the build changes does it actually
    # re-fetch. It must NOT be cached immutably: its <script> tags point at hashed
    # chunk files (e.g. CreatorList-B2ZZZlqR.js) that change every build, so a
    # frozen index.html would request chunks that no longer exist → "Failed to
    # fetch dynamically imported module". The hashed /assets files themselves stay
    # cached forever (their name changes when their content does).
    _NO_CACHE = {"Cache-Control": "no-cache"}

    # Catch-all SPA route — must be registered LAST so API routes take priority.
    # Known static files (favicon, manifest, etc.) are served directly;
    # everything else returns index.html so React Router handles the path.
    @app.get("/{full_path:path}", include_in_schema=False)
    async def _serve_spa(full_path: str):
        candidate = os.path.join(_FRONTEND_DIR, full_path)
        if full_path and os.path.isfile(candidate) and os.path.basename(candidate) != "index.html":
            return FileResponse(candidate)
        return FileResponse(os.path.join(_FRONTEND_DIR, "index.html"), headers=_NO_CACHE)


if __name__ == "__main__":
    import multiprocessing
    multiprocessing.freeze_support()   # required on Windows for frozen multiprocessing

    if getattr(sys, 'frozen', False):
        # ── Frozen EXE: PyWebView standalone window ───────────────────────────
        # Run uvicorn in a daemon thread, wait until it's ready, then open the
        # app in a native WebView2 (Chromium) window.  The console window is
        # hidden (console=False in vault.spec) so everything is self-contained.

        _server_started = threading.Event()

        def _run_server():
            # Signal readiness after the first successful health-check poll below.
            # Bind 0.0.0.0 so the mobile app (phone on the same WiFi) can reach the
            # desktop server over LAN. 127.0.0.1 connections (PyWebView) still work.
            uvicorn.run(app, host="0.0.0.0", port=8000, reload=False,
                        log_config=None)

        srv_thread = threading.Thread(target=_run_server, daemon=True, name="vault-server")
        srv_thread.start()

        # Poll the health endpoint until the server responds (max ~5 s).
        import time, urllib.request, urllib.error
        for _i in range(50):
            try:
                urllib.request.urlopen("http://127.0.0.1:8000/api/health", timeout=0.5)
                break
            except Exception:
                time.sleep(0.1)

        try:
            import webview  # pywebview — installed via requirements.txt

            class _VaultApi:
                """Methods callable from JS via window.pywebview.api.*"""
                _win = None

                def toggle_fullscreen(self):
                    """Toggle native OS fullscreen — hides taskbar & title bar."""
                    if self._win:
                        self._win.toggle_fullscreen()

            _api = _VaultApi()

            _wv_storage = os.path.join(DATA_DIR, "webview_data")
            os.makedirs(_wv_storage, exist_ok=True)

            # Cache-busting by URL — the reliable way to never see a stale UI after
            # an update without ever pressing F5.
            #
            # WebView2 keys its cache by the FULL url. If we always load the same
            # url ("http://127.0.0.1:8000") it re-paints the page it last cached
            # for that url on every launch — i.e. the OLD build — and only a manual
            # F5 forces a real re-fetch. So instead we tag the url with the current
            # frontend build id: "?b=<hash of index.html>".
            #   • New build  → new hash → a url WebView2 has never cached → it must
            #     fetch the fresh index.html (and thus the new chunk names). No F5.
            #   • Same build → same url → fully served from cache, so startup speed
            #     and the V8 Code Cache are completely preserved. No perf cost.
            # The "?b=" query is ignored by the SPA route and by React Router; it
            # only changes the cache key. Hashed /assets stay cached immutably.
            _build_id = "0"
            try:
                import hashlib as _hashlib
                _idx = os.path.join(_FRONTEND_DIR, "index.html") if _FRONTEND_DIR else None
                if _idx and os.path.isfile(_idx):
                    with open(_idx, "rb") as _f:
                        _build_id = _hashlib.md5(_f.read()).hexdigest()[:12]
            except Exception:
                pass  # best-effort; a fixed "0" just means no busting this launch

            _win = webview.create_window(
                "The Vault",
                f"http://127.0.0.1:8000/?b={_build_id}",
                width=1440,
                height=900,
                min_size=(1024, 700),
                background_color="#0e0e0e",
                text_select=True,
                js_api=_api,
            )
            _api._win = _win   # back-reference so the API can reach the window

            # F5 → reload is handled inside the React app (App.jsx) so the listener
            # is re-attached on every page load. Injecting it once here via
            # evaluate_js only worked until the first reload, which replaced the
            # document and discarded the listener.
            webview.start(debug=False, private_mode=False, storage_path=_wv_storage)
            # webview.start() blocks until the window is closed.
            # os._exit() is a hard exit — it kills all threads (including uvicorn's
            # asyncio ThreadPoolExecutor non-daemon threads) instead of waiting for
            # them like sys.exit() does, which left a ghost process in Task Manager.
            import os as _os
            _os._exit(0)

        except Exception as _wv_err:
            # PyWebView unavailable (missing WebView2 runtime, etc.) — fall back
            # to opening the default browser and keeping the server alive.
            logging.getLogger("vault").warning(
                f"PyWebView unavailable ({_wv_err}); falling back to browser."
            )
            import webbrowser
            webbrowser.open("http://127.0.0.1:8000")
            srv_thread.join()   # keep process alive while the server runs

    else:
        # Dev mode (start.bat / python main.py): Vite on :5173 proxies to :8000.
        # log_config=None prevents uvicorn from calling dictConfig, which would
        # set propagate=False on the uvicorn logger tree and block its logs from
        # reaching our _vault_handler.  With log_config=None, all loggers use
        # their default propagation (True) so everything flows to root → deque.
        logging.getLogger("vault").info("Server ready — Console connected")
        # Bind 0.0.0.0 so the mobile app can reach the dev server over LAN.
        uvicorn.run(app, host="0.0.0.0", port=8000, reload=False, log_config=None)
