"""Cloudflare release checks and verified Windows installer handoff."""

import hashlib
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import threading
import time
from urllib.parse import urlsplit

import httpx

from app_version import APP_VERSION

UPDATE_MANIFEST_URL = "https://downloads.vault-app.site/version.json"
_lock = threading.Lock()
_state = {"status": "idle", "progress": 0, "error": None}


def version_tuple(value):
    if not isinstance(value, str) or not re.fullmatch(r"\d+\.\d+(?:\.\d+)?", value):
        raise ValueError("The update server returned an invalid release version.")
    parts = tuple(map(int, value.split(".")))
    return parts + (0,) * (3 - len(parts))


def validate_manifest(manifest):
    if not isinstance(manifest, dict):
        raise ValueError("The update server returned an invalid manifest.")
    remote = version_tuple(manifest.get("version"))
    url = manifest.get("download_url")
    if not isinstance(url, str):
        raise ValueError("The update download URL is missing.")
    parsed = urlsplit(url)
    if (parsed.scheme != "https" or parsed.netloc != "downloads.vault-app.site"
            or not parsed.path.lower().endswith(".exe") or parsed.fragment):
        raise ValueError("The installer must come from the Vault download server over HTTPS.")
    # Older published releases did not include integrity metadata. They can
    # still be checked, but a newer release must provide it before installation.
    if remote > version_tuple(APP_VERSION):
        if not isinstance(manifest.get("sha256"), str) or not re.fullmatch(r"[a-fA-F0-9]{64}", manifest["sha256"]):
            raise ValueError("The update is missing its installer checksum. Try again after the release is fully uploaded.")
        size = manifest.get("size_bytes")
        if isinstance(size, bool) or not isinstance(size, int) or size <= 0:
            raise ValueError("The update is missing its installer size.")
    return manifest


def fetch_manifest():
    response = httpx.get(UPDATE_MANIFEST_URL, timeout=15,
                         params={"t": time.time_ns()}, headers={"Cache-Control": "no-cache"})
    response.raise_for_status()
    return validate_manifest(response.json())


def check_for_updates():
    manifest = fetch_manifest()
    return {
        "current_version": APP_VERSION,
        "latest_version": manifest["version"],
        "update_available": version_tuple(manifest["version"]) > version_tuple(APP_VERSION),
        "download_url": manifest["download_url"],
        "changelog": str(manifest.get("changelog") or ""),
    }


def update_status():
    return dict(_state)


def _set_state(status, progress=0, error=None):
    global _state
    _state = {"status": status, "progress": progress, "error": error}


def download_installer(manifest, destination):
    digest = hashlib.sha256()
    downloaded = 0
    expected = manifest["size_bytes"]
    with httpx.stream("GET", manifest["download_url"], timeout=300,
                      headers={"Accept-Encoding": "identity"}) as response:
        response.raise_for_status()
        with open(destination, "wb") as output:
            for chunk in response.iter_bytes(chunk_size=1024 * 1024):
                downloaded += len(chunk)
                if downloaded > expected:
                    raise ValueError("The installer size does not match this release.")
                output.write(chunk)
                digest.update(chunk)
                _set_state("downloading", min(99, downloaded * 100 // expected))
    if downloaded != expected or digest.hexdigest() != manifest["sha256"].lower():
        raise ValueError("Installer verification failed. The download may be incomplete or stale; please retry.")
    with open(destination, "rb") as downloaded_file:
        if downloaded_file.read(2) != b"MZ":
            raise ValueError("The downloaded file is not a Windows installer.")


def installer_command(path, executable=None):
    install_dir = str(Path(executable or sys.executable).resolve().parent)
    return [str(path), "/SILENT", "/SP-", "/NORESTART", "/CLOSEAPPLICATIONS",
            "/LOG", f"/DIR={install_dir}"]


def _install(manifest):
    path = None
    launched = False
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=".exe", prefix="VaultUpdate_") as tmp:
            path = tmp.name
        download_installer(manifest, path)
        process = subprocess.Popen(installer_command(path), creationflags=(
            subprocess.DETACHED_PROCESS | subprocess.CREATE_NO_WINDOW))
        launched = True
        _set_state("installing", 100)
        time.sleep(1)
        if process.poll() is not None:
            raise ValueError("The installer closed before the update started. Download the installer from the Vault website and run it manually.")
        # The installer explicitly relaunches the app after replacing its files.
        os._exit(0)
    except Exception as exc:
        _set_state("error", error=str(exc))
    finally:
        try:
            if path and not launched:
                Path(path).unlink(missing_ok=True)
        except OSError:
            pass  # A temporary antivirus/file lock must not block future retries.
        finally:
            _lock.release()


def start_update(requested_url):
    if not getattr(sys, "frozen", False) or sys.platform != "win32":
        raise ValueError("Auto-update is only available in the installed Windows version.")
    if not _lock.acquire(blocking=False):
        raise ValueError("An update is already in progress.")
    try:
        # Re-fetch authoritative metadata; the browser never chooses which
        # executable to run or supplies the checksum to trust.
        manifest = fetch_manifest()
        if version_tuple(manifest["version"]) <= version_tuple(APP_VERSION):
            raise ValueError("There is no newer release to install.")
        if requested_url != manifest["download_url"]:
            raise ValueError("The release changed since your last check. Check for updates again.")
        _set_state("downloading")
        threading.Thread(target=_install, args=(manifest,), daemon=False).start()
    except Exception:
        _lock.release()
        raise
    return {"status": "started", "version": manifest["version"]}
