"""Small, idempotent schema migrations shared by startup and maintenance tools."""

import sqlalchemy


def migrate_bond_milestone_card_link_nullable(engine) -> bool:
    """Make the optional Bond card link nullable without changing event rows.

    Returns True when a migration ran. SQLite requires a table rebuild to drop
    NOT NULL; the replacement keeps the event fields, foreign keys, uniqueness,
    and lookup indexes intact. No collection reset runs at startup.
    """
    inspector = sqlalchemy.inspect(engine)
    if not inspector.has_table("bond_milestones"):
        return False
    card_id = next((c for c in inspector.get_columns("bond_milestones") if c["name"] == "card_id"), None)
    if not card_id or card_id.get("nullable"):
        return False
    if engine.dialect.name != "sqlite":
        with engine.begin() as conn:
            conn.execute(sqlalchemy.text("ALTER TABLE bond_milestones ALTER COLUMN card_id DROP NOT NULL"))
        return True

    with engine.connect() as raw_conn:
        conn = raw_conn.execution_options(isolation_level="AUTOCOMMIT")
        conn.exec_driver_sql("PRAGMA foreign_keys=OFF")
        conn.exec_driver_sql("BEGIN IMMEDIATE")
        try:
            baseline_violations = set(conn.exec_driver_sql("PRAGMA foreign_key_check").fetchall())
            conn.exec_driver_sql("ALTER TABLE bond_milestones RENAME TO bond_milestones_pre_nullable")
            conn.exec_driver_sql(
                "CREATE TABLE bond_milestones ("
                "id INTEGER NOT NULL PRIMARY KEY, "
                "card_id INTEGER, "
                "image_id INTEGER NOT NULL, "
                "threshold INTEGER NOT NULL, "
                "recorded_count INTEGER NOT NULL, "
                "crossed_at DATETIME, "
                "FOREIGN KEY(card_id) REFERENCES cards (id), "
                "FOREIGN KEY(image_id) REFERENCES images (id), "
                "CONSTRAINT uq_bond_card_milestone UNIQUE (card_id, threshold)"
                ")"
            )
            conn.exec_driver_sql(
                "INSERT INTO bond_milestones (id, card_id, image_id, threshold, recorded_count, crossed_at) "
                "SELECT id, card_id, image_id, threshold, recorded_count, crossed_at "
                "FROM bond_milestones_pre_nullable"
            )
            conn.exec_driver_sql("DROP TABLE bond_milestones_pre_nullable")
            conn.exec_driver_sql("CREATE INDEX ix_bond_milestones_id ON bond_milestones (id)")
            conn.exec_driver_sql("CREATE INDEX ix_bond_milestones_card_id ON bond_milestones (card_id)")
            conn.exec_driver_sql("CREATE INDEX ix_bond_milestones_image_id ON bond_milestones (image_id)")
            violations = set(conn.exec_driver_sql("PRAGMA foreign_key_check").fetchall()) - baseline_violations
            if violations:
                raise RuntimeError(f"Bond milestone migration introduced foreign-key violations: {list(violations)[:5]}")
            conn.exec_driver_sql("COMMIT")
        except Exception:
            conn.exec_driver_sql("ROLLBACK")
            raise
        finally:
            conn.exec_driver_sql("PRAGMA foreign_keys=ON")
    return True
