"""Preview or explicitly apply the pre-release TCG catalogue reset.

Examples (from ``backend``):
    python scripts/rebuild_tcg_prelaunch.py --db "A:\\Vault Data\\staging\\vault.db"
    python scripts/rebuild_tcg_prelaunch.py --db "A:\\Vault Data\\staging\\vault.db" --apply --backup "A:\\Vault Data\\backups\\vault.db"

Dry-run is the default. Applying requires both ``--apply`` and an existing
backup path distinct from the target database.
"""
from __future__ import annotations

import argparse
import atexit
from contextlib import closing
import json
import os
from pathlib import Path
import sqlite3
import shutil
import sys
import tempfile


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", required=True, help="SQLite database path to inspect or reset")
    parser.add_argument("--apply", action="store_true", help="Apply the reset; omitted means dry-run")
    parser.add_argument("--backup", help="Existing full database backup path, required with --apply")
    return parser.parse_args()


def main() -> int:
    args = _parse_args()
    target = Path(args.db).expanduser().resolve()
    if not target.is_file():
        print(f"Target database does not exist: {target}", file=sys.stderr)
        return 2

    if args.apply:
        if not args.backup:
            print("--apply requires --backup pointing to an existing full database backup.", file=sys.stderr)
            return 2
        backup = Path(args.backup).expanduser().resolve()
        if not backup.is_file():
            print(f"Backup does not exist: {backup}", file=sys.stderr)
            return 2
        if target == backup or (target.exists() and backup.exists() and os.path.samefile(target, backup)):
            print("The backup path resolves to the target database; refusing to apply.", file=sys.stderr)
            return 2

    # database.py builds its engine on import, so set the selected DB first.
    # Apply uses a same-directory SQLite backup copy and only replaces --db
    # after reset, both releases, earned-card relinking, and integrity checks pass.
    stage_path = None
    active_db_path = target
    def cleanup_stage():
        if stage_path:
            for path in (stage_path, Path(str(stage_path) + "-wal"), Path(str(stage_path) + "-shm")):
                path.unlink(missing_ok=True)

    if args.apply:
        sidecars = [Path(str(target) + suffix) for suffix in ("-wal", "-shm")]
        present_sidecars = [str(path) for path in sidecars if path.exists()]
        if present_sidecars:
            print("Target has SQLite sidecar files (" + ", ".join(present_sidecars) + "); close Vault and checkpoint the database before applying.", file=sys.stderr)
            return 2
        handle, stage_name = tempfile.mkstemp(prefix=target.stem + ".tcg-rebuild-", suffix=".db", dir=target.parent)
        os.close(handle)
        stage_path = Path(stage_name)
        atexit.register(cleanup_stage)
        stage_path.unlink(missing_ok=True)
        with closing(sqlite3.connect(str(target))) as source_conn:
            with closing(sqlite3.connect(str(stage_path))) as stage_conn:
                source_conn.backup(stage_conn)
        shutil.copystat(target, stage_path)
        active_db_path = stage_path
    os.environ["VAULT_DB"] = str(active_db_path)
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    from database import SessionLocal
    from database import engine
    from services.tcg_prelaunch_rebuild import preview_prelaunch_rebuild, rebuild_prelaunch_catalogues
    from services.tcg_schema_migrations import migrate_bond_milestone_card_link_nullable

    db = SessionLocal()
    try:
        try:
            if args.apply:
                migrate_bond_milestone_card_link_nullable(engine)
                report = rebuild_prelaunch_catalogues(db, confirmed=True)
            else:
                report = preview_prelaunch_rebuild(db)
        finally:
            db.close()
            engine.dispose()
    except Exception:
        if stage_path:
            for path in (stage_path, Path(str(stage_path) + "-wal"), Path(str(stage_path) + "-shm")):
                path.unlink(missing_ok=True)
        raise
    if args.apply:
        try:
            sidecars = [Path(str(target) + suffix) for suffix in ("-wal", "-shm")]
            if any(path.exists() for path in sidecars):
                raise RuntimeError("Target SQLite sidecars appeared during rebuild; refusing to replace the database file.")
            # Verify that no active transaction currently holds the database.
            # The app must remain closed while the file is replaced.
            with closing(sqlite3.connect(str(target), timeout=1)) as lock_conn:
                lock_conn.execute("BEGIN EXCLUSIVE")
                lock_conn.rollback()
            with closing(sqlite3.connect(str(stage_path))) as verify_conn:
                integrity = verify_conn.execute("PRAGMA integrity_check").fetchone()
            if not integrity or integrity[0] != "ok":
                raise RuntimeError(f"Staging database integrity check failed: {integrity!r}")
            stage_sidecars = [Path(str(stage_path) + suffix) for suffix in ("-wal", "-shm")]
            if any(path.exists() for path in stage_sidecars):
                raise RuntimeError("Staging SQLite sidecars remain open; refusing to replace the target database.")
            os.replace(stage_path, target)
        except Exception:
            for path in (stage_path, Path(str(stage_path) + "-wal"), Path(str(stage_path) + "-shm")):
                path.unlink(missing_ok=True)
            raise
        report["committed_to_db"] = str(target)
        report["backup_used"] = str(Path(args.backup).expanduser().resolve())
    print(json.dumps(report, indent=2, sort_keys=True, default=str))
    if not report.get("safe_to_apply", True):
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
