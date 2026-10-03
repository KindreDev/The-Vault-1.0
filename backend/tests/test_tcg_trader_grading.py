"""Focused tests for deterministic, card-level trader grading."""

from datetime import datetime, timedelta

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from models import Base, Card, CardInventory, CardRarity, CardType, TCGPhysicalCardCopy, TCGTraderVisit, UserProfile
from services import tcg_traders


def _db(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'grading.sqlite'}")
    Base.metadata.create_all(engine)
    return engine, sessionmaker(bind=engine, expire_on_commit=False)()


def test_objective_grade_is_rarity_based_and_independent_of_ids_and_traders():
    cases = [
        ("C", CardRarity.common, "D"), ("R", CardRarity.uncommon, "C"),
        ("SR", CardRarity.rare, "B"), ("UR", CardRarity.relic, "A"),
        ("SPR", CardRarity.celestial, "S"), (None, CardRarity.epic, "C"),
        (None, CardRarity.legendary, "B"),
    ]
    for rarity, legacy_rarity, grade in cases:
        first = Card(id=1, card_type=CardType.image, print_rarity=rarity, rarity=legacy_rarity, rarity_class="R")
        second = Card(id=987654, card_type=CardType.hof, print_rarity=rarity, rarity=legacy_rarity, rarity_class="UR")
        assert tcg_traders._objective_card_grade(first) == grade
        assert tcg_traders._objective_card_grade(second) == grade


def test_quote_and_purchase_keep_copies_consistent_and_preserve_fee_rules(tmp_path, monkeypatch):
    engine, db = _db(tmp_path)
    try:
        card = Card(card_type=CardType.image, rarity=CardRarity.epic, print_rarity="SR", rarity_class="R")
        db.add(card)
        db.flush()
        db.add(CardInventory(card_id=card.id, quantity=2))
        copies = [
            TCGPhysicalCardCopy(card_id=card.id, copy_ordinal=1, location_kind="carried", grade=None),
            TCGPhysicalCardCopy(card_id=card.id, copy_ordinal=2, location_kind="carried", grade="S"),
        ]
        db.add_all(copies)
        profile = UserProfile(id=1, vault_credits=1000)
        db.add(profile)
        db.flush()
        visit = TCGTraderVisit(id=44, week_key="test", trader_id=1, visit_seed="test",
                               arrives_at=datetime.now(), departs_at=datetime.now() + timedelta(days=1),
                               request_allowance=1, status="active")
        monkeypatch.setattr(tcg_traders, "_active_visit", lambda _db, _visit_id: visit)
        monkeypatch.setattr(tcg_traders, "_eligible_user_copies", lambda _db, ids: [db.get(TCGPhysicalCardCopy, i) for i in ids])
        monkeypatch.setattr(tcg_traders, "_card_display_metadata", lambda _db, _card: {
            "catalog_code": "TEST", "name": "Test", "display_name": "Test",
            "display_title": "Test", "rarity": "SR",
        })

        quote = tcg_traders.quote_grading(db, 44, [copies[0].id, copies[1].id])
        assert [item["grade"] for item in quote["items"]] == ["B", "B"]
        assert [item["fee_credits"] for item in quote["items"]] == [400, 0]
        assert quote["total_fee_credits"] == 400
        assert quote["can_afford"]

        purchased = tcg_traders.purchase_grading(db, 44, [copies[0].id, copies[1].id])
        assert [item["grade"] for item in purchased["items"]] == ["B", "B"]
        assert db.get(TCGPhysicalCardCopy, copies[0].id).grade == "B"
        assert db.get(TCGPhysicalCardCopy, copies[1].id).grade == "B"
        assert db.get(UserProfile, 1).vault_credits == 600

        # A card with two ungraded physical copies still charges the published
        # rarity fee per copy, and once saved the same grades remain stable.
        copies[0].grade = None
        copies[1].grade = None
        db.flush()
        two_ungraded = tcg_traders.quote_grading(db, 44, [copies[0].id, copies[1].id])
        assert two_ungraded["total_fee_credits"] == 800
        assert all(item["grade"] == "B" for item in two_ungraded["items"])
    finally:
        db.close()
        engine.dispose()
