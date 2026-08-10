"""Personal-mode gate — hides Simulation/Drama Mode and Group Chat behind a
password unlock so a casual look at the running app doesn't surface them.
Flag lives in vault_config.json (same file as data_dir/use_gpu) so a factory
reset of the collection can't accidentally re-lock it.
"""
import hashlib
import hmac
import os
import json
import time

from database import CONFIG_FILE

# Salted, iterated hash — not the plaintext password. The salt doesn't need to
# be secret, it just kills precomputed rainbow tables; the iteration count is
# what makes brute-forcing this slow instead of instant.
_PASSWORD_SALT = b"thevault-access-v1"

# The hash itself is deliberately NOT in this file. It lives in vault_config.json
# under "personal_mode_hash", next to data_dir — that file never leaves the
# machine, so the repo carries the gate without carrying anything crackable.
# A fresh clone has no hash configured, so unlock always fails and personal mode
# just stays off. To set one: python -m services.access <your-password>
_HASH_KEY = "personal_mode_hash"


def _hash_password(password: str) -> str:
    return hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), _PASSWORD_SALT, 200_000).hex()

# Simple in-memory throttle: after MAX_ATTEMPTS wrong guesses, block further
# attempts for LOCKOUT_SEC. Resets on process restart — fine for a local app.
MAX_ATTEMPTS = 5
LOCKOUT_SEC = 60
_attempts = 0
_locked_until = 0.0


def _read_config() -> dict:
    try:
        if os.path.isfile(CONFIG_FILE):
            with open(CONFIG_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
    except Exception:
        pass
    return {}


def _write_config(config: dict):
    tmp = CONFIG_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(config, f, indent=2)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, CONFIG_FILE)


def is_personal_mode() -> bool:
    return bool(_read_config().get("personal_mode", False))


def unlock(password: str) -> bool:
    """Returns True and persists the flag if the password matches. Throttled
    against repeated guessing; always takes the same code path either way so
    a timing/response difference can't be used to enumerate the mechanism."""
    global _attempts, _locked_until

    if time.monotonic() < _locked_until:
        return False

    config = _read_config()
    expected = config.get(_HASH_KEY) or ""

    # Hash unconditionally, even with no password configured, so the "personal
    # mode was never set up here" case is indistinguishable from a wrong guess.
    candidate = _hash_password(password or "")
    ok = bool(expected) and hmac.compare_digest(candidate, expected)

    if not ok:
        _attempts += 1
        if _attempts >= MAX_ATTEMPTS:
            _locked_until = time.monotonic() + LOCKOUT_SEC
            _attempts = 0
        return False

    _attempts = 0
    config["personal_mode"] = True
    _write_config(config)
    return True


def set_password(password: str):
    """Writes the hash of `password` into vault_config.json. Run once per
    machine to arm the gate — the plaintext is never stored."""
    config = _read_config()
    config[_HASH_KEY] = _hash_password(password)
    _write_config(config)


def lock():
    config = _read_config()
    config["personal_mode"] = False
    _write_config(config)


if __name__ == "__main__":
    # python -m services.access <password>   (run from backend/)
    import sys
    if len(sys.argv) != 2:
        print("usage: python -m services.access <password>")
        raise SystemExit(1)
    set_password(sys.argv[1])
    print(f"Personal-mode password set in {CONFIG_FILE}")
