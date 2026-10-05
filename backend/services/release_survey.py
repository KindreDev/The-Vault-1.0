"""Optional release survey configuration; never submits responses or usage data."""

import json
import threading
import time
from pathlib import Path
from urllib.parse import urlsplit

import httpx

from app_version import APP_VERSION
from services.app_updates import UPDATE_MANIFEST_URL

_lock = threading.Lock()
_cached = None
_expires = 0


def validate_survey(manifest):
    if not isinstance(manifest, dict) or manifest.get("version") != APP_VERSION:
        return {"enabled": False}
    survey = manifest.get("survey")
    if not isinstance(survey, dict):
        return {"enabled": False}
    url = survey.get("url", "")
    if not isinstance(url, str):
        return {"enabled": False}
    try:
        parsed = urlsplit(url)
    except ValueError:
        return {"enabled": False}
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
        return {"enabled": False}
    return {"enabled": survey.get("enabled") is True, "url": url, "id": APP_VERSION}


def get_survey(manifest_path):
    """Refresh at most hourly, with bundled configuration as an offline fallback."""
    global _cached, _expires
    with _lock:
        if _cached is not None and time.monotonic() < _expires:
            return dict(_cached)
        try:
            local = json.loads(Path(manifest_path).read_text(encoding="utf-8"))
        except (OSError, ValueError):
            local = {}
        config = validate_survey(local)
        try:
            response = httpx.get(UPDATE_MANIFEST_URL, timeout=5,
                                 headers={"Cache-Control": "no-cache"})
            response.raise_for_status()
            remote = response.json()
            if isinstance(remote, dict) and remote.get("version") == APP_VERSION and "survey" in remote:
                config = validate_survey(remote)
        except (httpx.HTTPError, ValueError):
            pass
        _cached, _expires = config, time.monotonic() + 3600
        return dict(config)
