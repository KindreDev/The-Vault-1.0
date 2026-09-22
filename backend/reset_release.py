"""Recoverably replace one published monthly TCG V2 release."""

from __future__ import annotations

import argparse
import json
import os
from datetime import datetime
from pathlib import Path
import sqlite3
import sys


def create_backup(db_path: Path) -> Path:
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    backup_path = Path(f"{db_path}.backup-{stamp}")
    source = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    destination = sqlite3.connect(str(backup_path))
    try:
        source.backup(destination, pages=4096, sleep=0.05)
        destination.commit()
        integrity = destination.execute("PRAGMA integrity_check").fetchone()[0]
    finally:
        destination.close()
        source.close()
    if integrity != "ok":
        backup_path.unlink(missing_ok=True)
        raise RuntimeError(f"Backup integrity check failed: {integrity}")
    return backup_path


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", required=True, help="Path to the live Vault SQLite database")
    parser.add_argument("--year", type=int, required=True)
    parser.add_argument("--month", type=int, required=True)
    args = parser.parse_args()

    db_path = Path(args.db).resolve()
    if not db_path.is_file():
        raise SystemExit(f"Database not found: {db_path}")
    code = f"REL-{args.year:04d}-{args.month:02d}"
    backup_path = create_backup(db_path)

    os.environ["VAULT_DB"] = str(db_path)
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from database import SessionLocal
    from services.tcg_v2 import draft_release, publish_release, reset_published_release

    with SessionLocal() as db:
        deletion = reset_published_release(db, code)
        rebuilt = draft_release(db, year=args.year, month=args.month, regenerate=False)
        if rebuilt.get("status") != "published":
            rebuilt = publish_release(db, rebuilt["id"])

    print(json.dumps({
        "code": code,
        "backup_path": str(backup_path),
        "deletion": deletion,
        "rebuilt": {
            "id": rebuilt.get("id"),
            "code": rebuilt.get("code"),
            "status": rebuilt.get("status"),
            "algorithm_version": rebuilt.get("algorithm_version"),
            "rarity_distribution": rebuilt.get("rarity_distribution"),
            "completion": rebuilt.get("completion"),
        },
    }, indent=2, default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
