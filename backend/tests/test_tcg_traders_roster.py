"""Trader roster contract without touching the live Vault database."""

from datetime import date

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from models import Base, TCGTraderDefinition
from services import tcg_traders


def test_roster_contains_only_the_three_finished_traders():
    roster = tcg_traders.public_trader_roster()

    assert [(trader["id"], trader["name"]) for trader in roster] == [
        ("yoruichi", "Yoru"),
        ("rika", "Rika"),
        ("lisa", "Lisa"),
    ]
    for trader in roster:
        assert trader["age"] >= 21
        assert trader["visual_manifest"]["outfits"]
        assert all(outfit["status"] == "available" for outfit in trader["visual_manifest"]["outfits"])


def test_weekly_visit_uses_only_the_three_active_traders(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'traders.sqlite'}")
    Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine, expire_on_commit=False)()
    try:
        first = tcg_traders.current_visit(db, day=date(2026, 9, 30))
        repeated = tcg_traders.current_visit(db, day=date(2026, 9, 30))

        assert first["trader"]["id"] in {"yoruichi", "rika", "lisa"}
        assert repeated["visit_id"] == first["visit_id"]
        assert repeated["trader"]["id"] == first["trader"]["id"]
        definitions = db.query(TCGTraderDefinition).all()
        assert {trader.code for trader in definitions} == {"yoruichi", "rika", "lisa"}
        assert all(trader.enabled for trader in definitions)
    finally:
        db.close()
        engine.dispose()
