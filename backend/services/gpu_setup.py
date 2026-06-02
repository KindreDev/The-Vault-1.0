"""
gpu_setup.py — On-demand GPU DLL downloader for onnxruntime-gpu.

Downloads nvidia cuDNN / cuBLAS / CUDA runtime pip wheels from PyPI and
extracts the Windows DLLs into DATA_DIR/gpu_dlls/. These are then
registered by main._register_nvidia_dll_dirs() at next startup, or
immediately injected into PATH if onnxruntime has not yet been imported.

Download order matters — each package depends on the previous one.
"""

import os, sys, json, zipfile, io, threading, tempfile
import urllib.request
from typing import Optional, Callable

# Packages in dependency order (nvrtc → runtime → cublas → cudnn)
GPU_PACKAGES = [
    ("nvidia-cuda-nvrtc-cu12",   "~50 MB"),
    ("nvidia-cuda-runtime-cu12", "~30 MB"),
    ("nvidia-cublas-cu12",       "~500 MB"),
    ("nvidia-cudnn-cu12",        "~1 GB"),
]

_state: dict = {
    "running":         False,
    "phase":           "idle",   # idle|detecting|downloading|extracting|done|error
    "package":         None,     # current package name
    "package_index":   0,        # 1-based
    "package_total":   len(GPU_PACKAGES),
    "bytes_done":      0,
    "bytes_total":     0,
    "error":           None,
}
_lock = threading.Lock()


def get_state() -> dict:
    with _lock:
        return dict(_state)


def _set(**kwargs):
    with _lock:
        _state.update(kwargs)


# ── Paths ─────────────────────────────────────────────────────────────────────

def gpu_dlls_dir() -> str:
    """Persistent storage for downloaded GPU DLLs — survives reinstalls."""
    from database import DATA_DIR
    return os.path.join(DATA_DIR, "gpu_dlls")


def dlls_present() -> bool:
    """True if cuDNN DLLs have been downloaded to the on-demand cache (DATA_DIR/gpu_dlls/)."""
    marker = os.path.join(gpu_dlls_dir(), "nvidia", "cudnn", "bin", "cudnn64_9.dll")
    return os.path.isfile(marker)


def nvidia_packages_available() -> bool:
    """True if the nvidia Python packages (cudnn, cublas etc.) are installed in any
    site-packages directory — covers the pip-install dev setup where DLLs live in
    the venv rather than the on-demand download cache."""
    import site
    roots = []
    # Check the local venv first (dev mode)
    _here = os.path.dirname(os.path.abspath(__file__))
    venv_sp = os.path.normpath(os.path.join(_here, "..", "venv", "Lib", "site-packages"))
    if os.path.isdir(venv_sp):
        roots.append(venv_sp)
    # System / activated-venv site-packages
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
    for sp in roots:
        if os.path.isdir(os.path.join(sp, "nvidia", "cudnn", "bin")):
            return True
    return False


def dlls_accessible() -> bool:
    """True if GPU DLLs are available from ANY source (on-demand download OR pip install)."""
    return dlls_present() or nvidia_packages_available()


# ── GPU detection (no onnxruntime import) ─────────────────────────────────────

def has_nvidia_gpu() -> bool:
    """Detect an NVIDIA GPU on Windows without any subprocess calls.

    nvapi64.dll lives in System32 on every machine with NVIDIA drivers installed.
    This is a synchronous file-existence check — no process spawning, no timeouts.
    """
    if sys.platform != "win32":
        return False

    # nvapi64.dll is present on any Windows machine with NVIDIA GPU drivers
    if os.path.isfile(r"C:\Windows\System32\nvapi64.dll"):
        return True

    # 32-bit variant — older drivers or 32-bit OS
    if os.path.isfile(r"C:\Windows\SysWOW64\nvapi.dll"):
        return True

    # nvidia-smi in common install locations (present with Data Center drivers too)
    for p in [r"C:\Windows\System32\nvidia-smi.exe",
              r"C:\Program Files\NVIDIA Corporation\NVSMI\nvidia-smi.exe"]:
        if os.path.isfile(p):
            return True

    return False


# ── PyPI wheel fetcher ─────────────────────────────────────────────────────────

def _get_win_wheel_info(package: str) -> tuple[str, str, int]:
    """Return (download_url, version, size_bytes) for the latest Windows AMD64 wheel."""
    api_url = f"https://pypi.org/pypi/{package}/json"
    req = urllib.request.Request(api_url, headers={"User-Agent": "TheVault/1.0"})
    with urllib.request.urlopen(req, timeout=15) as r:
        data = json.loads(r.read())

    version = data["info"]["version"]
    files = data["releases"].get(version, [])

    # Prefer win_amd64; nvidia packages are also published as none-win_amd64
    for tag in ["win_amd64", "none-win_amd64", "none-any"]:
        for f in files:
            if tag in f["filename"] and f["filename"].endswith(".whl"):
                return f["url"], version, f.get("size", 0)

    raise RuntimeError(f"No Windows wheel found for {package} {version}")


def _stream_download(url: str, dest_path: str, progress_cb: Optional[Callable] = None):
    """Stream-download url to dest_path, calling progress_cb(done_bytes, total_bytes)."""
    req = urllib.request.Request(url, headers={"User-Agent": "TheVault/1.0"})
    with urllib.request.urlopen(req, timeout=60) as r:
        total = int(r.headers.get("Content-Length", 0))
        _set(bytes_total=total, bytes_done=0)
        downloaded = 0
        chunk = 512 * 1024  # 512 KB
        with open(dest_path, "wb") as f:
            while True:
                block = r.read(chunk)
                if not block:
                    break
                f.write(block)
                downloaded += len(block)
                _set(bytes_done=downloaded)
                if progress_cb:
                    progress_cb(downloaded, total)


def _extract_dlls(wheel_path: str, dest_root: str):
    """Extract every .dll from a wheel (zip) into dest_root preserving nvidia/*/bin layout."""
    with zipfile.ZipFile(wheel_path, "r") as zf:
        for name in zf.namelist():
            if name.endswith(".dll"):
                out = os.path.join(dest_root, name.replace("/", os.sep))
                os.makedirs(os.path.dirname(out), exist_ok=True)
                with zf.open(name) as src, open(out, "wb") as dst:
                    dst.write(src.read())


# ── Background download worker ─────────────────────────────────────────────────

def start_download():
    """Start the background GPU DLL download. No-op if already running or done."""
    with _lock:
        if _state["running"] or _state["phase"] == "done":
            return
        _state.update(running=True, phase="detecting", error=None,
                      package_index=0, bytes_done=0, bytes_total=0)
    t = threading.Thread(target=_worker, daemon=True)
    t.start()


def _worker():
    dest = gpu_dlls_dir()
    tmp_dir = tempfile.mkdtemp(prefix="vault_gpu_")
    try:
        os.makedirs(dest, exist_ok=True)

        for i, (pkg, _) in enumerate(GPU_PACKAGES):
            _set(phase="downloading", package=pkg, package_index=i + 1,
                 bytes_done=0, bytes_total=0)

            url, version, size = _get_win_wheel_info(pkg)
            _set(bytes_total=size)

            tmp_whl = os.path.join(tmp_dir, f"{pkg}.whl")
            _stream_download(url, tmp_whl)

            _set(phase="extracting", package=pkg)
            _extract_dlls(tmp_whl, dest)

            os.remove(tmp_whl)   # free space immediately after extraction

        # Inject into PATH right now — works if onnxruntime not yet imported
        inject_gpu_dlls_into_path()

        _set(running=False, phase="done", package=None, error=None)

    except Exception as exc:
        _set(running=False, phase="error", error=str(exc))
    finally:
        try:
            import shutil
            shutil.rmtree(tmp_dir, ignore_errors=True)
        except Exception:
            pass


# ── Runtime DLL injection ─────────────────────────────────────────────────────

def inject_gpu_dlls_into_path():
    """Add gpu_dlls_dir/nvidia/*/bin to PATH + os.add_dll_directory.
    Call this at startup (after download) so onnxruntime finds the DLLs."""
    if sys.platform != "win32":
        return
    import glob
    added = []
    for bin_dir in glob.glob(os.path.join(gpu_dlls_dir(), "nvidia", "*", "bin")):
        if os.path.isdir(bin_dir) and bin_dir not in os.environ.get("PATH", ""):
            os.environ["PATH"] = bin_dir + os.pathsep + os.environ.get("PATH", "")
            try:
                os.add_dll_directory(bin_dir)
            except Exception:
                pass
            added.append(bin_dir)
    return added
