"""Check release versions, then stage a hashed installer and Cloudflare manifest.

Run with --check before building, and without arguments after compiling the ISS.
Nothing is uploaded by this script.
"""

import argparse
import ctypes
from ctypes import wintypes
import hashlib
import json
from pathlib import Path
import re
import runpy
import shutil
import sys

ROOT = Path(__file__).resolve().parents[1]


def check_versions(root=ROOT):
    version = runpy.run_path(str(root / "backend/app_version.py"))["APP_VERSION"]
    if not re.fullmatch(r"\d+\.\d+\.\d+", version):
        raise ValueError("Release version must have three numeric parts.")
    for folder in ("frontend", "frontend-mobile"):
        for filename in ("package.json", "package-lock.json"):
            data = json.loads((root / folder / filename).read_text(encoding="utf-8"))
            if data["version"] != version:
                raise ValueError(f"Version mismatch in {folder}/{filename}")
            if filename == "package-lock.json" and data["packages"][""]["version"] != version:
                raise ValueError(f"Root lockfile version mismatch in {folder}")
    iss = (root / "installer.iss").read_text(encoding="utf-8")
    if re.search(r'#define\s+AppVersion\s+"([^"]+)"', iss)[1] != version:
        raise ValueError("Installer version mismatch")
    gradle = (root / "frontend-mobile/android/app/build.gradle").read_text(encoding="utf-8")
    if re.search(r'versionName\s+"([^"]+)"', gradle)[1] != version:
        raise ValueError("Android version mismatch")
    manifest = json.loads((root / "version.json").read_text(encoding="utf-8"))
    if manifest["version"] != version:
        raise ValueError("Manifest version mismatch")
    expected_url = f"https://downloads.vault-app.site/VaultSetup-{version}.exe"
    if manifest["download_url"] != expected_url:
        raise ValueError("Manifest must point to the versioned Cloudflare installer")
    return version, manifest


def windows_product_version(path):
    """Read Windows VERSIONINFO without executing the installer."""
    if sys.platform != "win32":
        raise ValueError("Installer metadata verification requires Windows.")
    api = ctypes.windll.version
    size = api.GetFileVersionInfoSizeW(str(path), None)
    if not size:
        raise ValueError("Installer has no Windows version metadata")
    buffer = ctypes.create_string_buffer(size)
    if not api.GetFileVersionInfoW(str(path), 0, size, buffer):
        raise ValueError("Cannot read installer version metadata")
    address = ctypes.c_void_p()
    length = wintypes.UINT()
    if not api.VerQueryValueW(buffer, "\\", ctypes.byref(address), ctypes.byref(length)):
        raise ValueError("Cannot read installer product version")
    values = ctypes.cast(address, ctypes.POINTER(wintypes.DWORD))
    if length.value < 52 or values[0] != 0xFEEF04BD:
        raise ValueError("Invalid installer version metadata")
    return f"{values[4] >> 16}.{values[4] & 0xFFFF}.{values[5] >> 16}"


def prepare_release(root=ROOT):
    version, manifest = check_versions(root)
    installer = root / "dist/VaultSetup.exe"
    bundled_manifest = root / "dist/vault/_internal/version.json"
    if not installer.is_file() or not bundled_manifest.is_file():
        raise ValueError("Build the app and compile installer.iss first; dist/VaultSetup.exe and its bundled manifest are required.")
    if json.loads(bundled_manifest.read_text(encoding="utf-8"))["version"] != version:
        raise ValueError("The packaged app is stale. Rebuild it before compiling the installer.")
    if windows_product_version(installer) != version:
        raise ValueError("The installer is stale. Recompile installer.iss for this release.")
    if installer.stat().st_mtime < bundled_manifest.stat().st_mtime:
        raise ValueError("The installer predates the packaged app. Recompile installer.iss.")
    destination = root / "dist/cloudflare"
    destination.mkdir(parents=True, exist_ok=True)
    target = destination / f"VaultSetup-{version}.exe"
    shutil.copy2(installer, target)
    with target.open("rb") as source:
        digest = hashlib.file_digest(source, "sha256").hexdigest()
    manifest = {**manifest, "sha256": digest, "size_bytes": target.stat().st_size}
    (destination / "version.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Prepared {target.name} and version.json in {destination}")
    print("Upload the EXE first; verify it is accessible, then publish version.json LAST.")
    return manifest


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Check source versions without requiring an installer")
    args = parser.parse_args()
    try:
        if args.check:
            version, _ = check_versions()
            print(f"All release versions agree: {version}")
        else:
            prepare_release()
    except (ValueError, OSError, KeyError) as exc:
        parser.exit(1, f"Release preparation failed: {exc}\n")
