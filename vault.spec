# -*- mode: python ; coding: utf-8 -*-
# PyInstaller spec for The Vault
# Run with:  pyinstaller vault.spec --noconfirm
# (Or just double-click build.bat)

import os

block_cipher = None

# SPECPATH is the directory containing this spec file (the project root)
ROOT          = os.path.abspath(SPECPATH)
BACKEND_DIR   = os.path.join(ROOT, 'backend')
FRONTEND_DIST = os.path.join(ROOT, 'frontend', 'dist')
MOBILE_PWA_DIST = os.path.join(ROOT, 'frontend-mobile', 'dist-pwa')
FFMPEG_EXE    = os.path.join(ROOT, 'tools', 'ffmpeg.exe')

# Build the datas list — always include the frontend, bundle ffmpeg if present
_datas = [(FRONTEND_DIST, 'frontend/dist')]

# Mobile PWA (served at /m for phones on the LAN). Built via build:pwa; skipped
# gracefully if it hasn't been built yet.
if os.path.isdir(MOBILE_PWA_DIST):
    _datas.append((MOBILE_PWA_DIST, 'frontend-mobile/dist-pwa'))
    print("[vault.spec] Bundling mobile PWA (frontend-mobile/dist-pwa)")
else:
    print("[vault.spec] WARNING: frontend-mobile/dist-pwa not found — phones won't get the /m app. Run: npm run build:pwa")
if os.path.isfile(FFMPEG_EXE):
    _datas.append((FFMPEG_EXE, '.'))   # extracted to sys._MEIPASS/ffmpeg.exe at runtime
    print(f"[vault.spec] Bundling ffmpeg.exe ({os.path.getsize(FFMPEG_EXE)//1024//1024} MB)")
else:
    print("[vault.spec] WARNING: tools/ffmpeg.exe not found — video thumbnails won't work in the bundle")

# GPU DLLs (cuDNN / cuBLAS / CUDA runtime) are NOT bundled in the installer.
# They are ~1.6 GB and only needed by users with NVIDIA GPUs.
# On first use of AI Tagging, the app detects the GPU and offers a one-time
# download via the GPU support panel in Settings → AI Tagging.
# DLLs are saved to %APPDATA%\TheVault\gpu_dlls\ and survive reinstalls.
_binaries = []

a = Analysis(
    [os.path.join(BACKEND_DIR, 'main.py')],
    pathex=[ROOT, BACKEND_DIR],
    binaries=[],
    datas=_datas,
    hiddenimports=[
        # ── Uvicorn ──────────────────────────────────────────────────────────
        # Uvicorn loads these dynamically; PyInstaller misses them by default.
        'uvicorn.logging',
        'uvicorn.loops',
        'uvicorn.loops.auto',
        'uvicorn.loops.asyncio',
        'uvicorn.protocols',
        'uvicorn.protocols.http',
        'uvicorn.protocols.http.auto',
        'uvicorn.protocols.http.h11_impl',
        'uvicorn.protocols.websockets',
        'uvicorn.protocols.websockets.auto',
        'uvicorn.protocols.websockets.websockets_impl',
        'uvicorn.protocols.websockets.wsproto_impl',
        'uvicorn.lifespan',
        'uvicorn.lifespan.off',
        'uvicorn.lifespan.on',
        # ── SQLAlchemy ───────────────────────────────────────────────────────
        'sqlalchemy.dialects.sqlite',
        'sqlalchemy.dialects.sqlite.pysqlite',
        'sqlalchemy.sql.default_comparator',
        'sqlalchemy.ext.declarative',
        # ── FastAPI / Starlette ──────────────────────────────────────────────
        'starlette.middleware.base',
        'starlette.staticfiles',
        'starlette.responses',
        # ── Pydantic v2 ──────────────────────────────────────────────────────
        'pydantic',
        'pydantic.deprecated.class_validators',
        'pydantic.deprecated.config',
        'pydantic.deprecated.tools',
        # ── Pillow (image processing — used in scanner, creators, gamification) ─
        'PIL',
        'PIL.Image',
        'PIL.ImageOps',
        'PIL.ImageFile',
        # ── numpy (AI tagging dependency — must NOT be excluded) ─────────────
        'numpy',
        'numpy.core',
        'numpy.core._multiarray_umath',
        # ── onnxruntime (AI tagger inference engine) ─────────────────────────
        # onnxruntime uses ctypes to load provider DLLs at runtime; most of its
        # internals are C extensions that PyInstaller won't find via static analysis.
        'onnxruntime',
        'onnxruntime.capi',
        'onnxruntime.capi.onnxruntime_inference_collection',
        'onnxruntime.capi._pybind_state',
        # ── huggingface_hub (model downloader for AI tagger) ─────────────────
        # hf_hub uses importlib to load backends; list the ones we actually use.
        'huggingface_hub',
        'huggingface_hub.file_download',
        'huggingface_hub.utils',
        # ── imagehash (perceptual hashing for dedup) ─────────────────────────
        # Imported lazily inside _hash_file() — PyInstaller misses it without this.
        # imagehash.phash() imports scipy.fftpack at the module level, so scipy
        # MUST be bundled or every hash silently fails and returns None.
        'imagehash',
        'scipy',
        'scipy.fftpack',
        # ── py7zr (7z archive inspection + extraction in Loading Bay) ─────────
        # Imported lazily in services/intake.py; its codec backends are pulled
        # in dynamically, so declare the package explicitly.
        'py7zr',
        # ── Other ────────────────────────────────────────────────────────────
        'multipart',
        'aiofiles',
        'h11',
        'anyio',
        'anyio._backends._asyncio',
        'httpx',
        'email.mime.multipart',
        'email.mime.text',
        # ── PyWebView (standalone window) ─────────────────────────────────────
        # pywebview dynamically loads its platform backend. On Windows it uses
        # the winforms (WebView2 / EdgeChromium) backend via pythonnet (clr).
        'webview',
        'webview.platforms',
        'webview.platforms.winforms',
        'clr',
        'clr_loader',
        'System',
        'System.Windows.Forms',
        'System.Drawing',
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        # Trim things we definitely don't use
        # NOTE: numpy is intentionally NOT here — it's required by onnxruntime / AI tagger
        'tkinter',
        'matplotlib',
        'pandas',
        'IPython',
        'jupyter',
        'notebook',
        'pytest',
    ],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='vault',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=False,  # Hidden — logs are captured to the in-app Console page instead
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=os.path.join(ROOT, 'frontend', 'public', 'favicon.ico') if os.path.isfile(os.path.join(ROOT, 'frontend', 'public', 'favicon.ico')) else None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name='vault',
)
