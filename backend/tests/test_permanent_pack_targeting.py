"""Permanent Booster card-type targeting guarantees and exclusions."""
import json

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from models import (
    Base, Card, CardRarity, CardType, Creator, Gallery, Image, TCGChecklistEntry,
    TCGPackProduct, TCGRelease, UserProfile,
)
from services import tcg_room, tcg_v2


@pytest.fixture
def db(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'targeted-pack.sqlite'}")
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine, expire_on_commit=False)()
    try:
        yield session
    finally:
        session.close()
        engine.dispose()


def _pool(db, types, *, card_count=10):
    creator = Creator(name="Target fixture", creator_type="character")
    db.add(creator); db.flush()
    gallery = Gallery(name="Target fixture", folder_path="target-fixture", creator_id=creator.id, period_year=2026)
    db.add(gallery); db.flush()
    image = Image(gallery_id=gallery.id, filename="target.png", file_path="/target.png", width=640, height=640, is_video=False)
    db.add(image); db.flush()
    db.add(UserProfile(id=1, vault_credits=100_000))
    release = TCGRelease(code="FND-CORE", name="Foundation", release_kind="foundation", status="published", generation_seed="test")
    product = TCGPackProduct(
        code="VAULT-PERMANENT", name="Permanent Vault Booster", product_kind="permanent",
        card_count=card_count, active=True, purchasable=True, regular_price=400,
        odds_json=json.dumps({"weighted_slots": {"C": 1}}), guaranteed_slots="[]",
        simulation_report=json.dumps({"approved": True}),
    )
    db.add_all([release, product]); db.flush()
    cards = []
    for index, card_type in enumerate(types):
        card = Card(
            card_type=card_type, rarity=CardRarity.common, print_rarity="C", catalog_code=f"FND-{index:03d}",
            source_image_id=image.id if card_type == CardType.image else None,
            source_gallery_id=gallery.id if card_type == CardType.gallery else None,
            source_creator_id=creator.id if card_type == CardType.creator else None,
        )
        cards.append(card)
    db.add_all([card for card, card_type in zip(cards, types) if card_type != CardType.hof]); db.flush()
    for position, (card, card_type) in enumerate(zip(cards, types), 1):
        if card_type == CardType.hof:
            db.add(card); db.flush()
            continue
        db.add(TCGChecklistEntry(release_id=release.id, card_id=card.id, collector_position=position, published_rarity="C"))
    db.commit()
    return product, cards


def _skip_visual_work(monkeypatch):
    monkeypatch.setattr("services.tcg_v2.seed_pack_products", lambda _db: None)
    monkeypatch.setattr(tcg_v2, "prepare_card_face_for_reveal", lambda _db, card: (card, {}))
    monkeypatch.setattr(tcg_v2, "_card_to_dict", lambda _db, card: {"id": card.id, "card_type": card.card_type.value})
    monkeypatch.setattr("services.physical_cards.grant_card_copy", lambda *_args, **_kwargs: None)


@pytest.mark.parametrize("target", ["image", "gallery"])
def test_photo_and_gallery_target_guarantees_at_least_half_without_changing_rarity_slots(db, monkeypatch, target):
    _skip_visual_work(monkeypatch)
    product, _cards = _pool(db, [CardType.image] * 6 + [CardType.gallery] * 6 + [CardType.creator] * 4)
    result = tcg_v2.open_pack_product(db, product.id, target_card_type=target, seed_override=f"target-{target}")
    assert sum(card["card_type"] == target for card in result["cards"]) >= 5
    opening = db.get(tcg_v2.TCGPackOpening, result["opening_id"])
    integrity = json.loads(opening.integrity_json)
    assert integrity["target_card_type"] == target
    assert integrity["target_guarantee_count"] == 5
    assert len(integrity["slot_rarities"]) == 10


def test_other_targets_guarantee_one_and_hof_remains_in_random_pool(db, monkeypatch):
    _skip_visual_work(monkeypatch)
    product, cards = _pool(db, [CardType.creator, CardType.hof], card_count=2)
    result = tcg_v2.open_pack_product(db, product.id, target_card_type="creator", seed_override="target-creator")
    assert [card["card_type"] for card in result["cards"]].count("creator") >= 1
    assert "hof" in [card["card_type"] for card in result["cards"]]
    integrity = json.loads(db.get(tcg_v2.TCGPackOpening, result["opening_id"]).integrity_json)
    assert integrity["target_card_type"] == "creator"
    assert integrity["target_guarantee_count"] == 1
    assert cards[1].id in integrity["dynamic_earned_card_ids"]


@pytest.mark.parametrize("target", ["hof", "Hall of Fame", "unknown"])
def test_hof_and_unknown_targets_are_rejected(db, target):
    product, _cards = _pool(db, [CardType.creator])
    with pytest.raises(ValueError, match="Hall of Fame cannot be targeted"):
        tcg_v2._validated_permanent_target(product, target)


def test_targeting_is_rejected_for_founder_release_products(db):
    product = TCGPackProduct(code="FND-STD", name="Founder Standard", product_kind="release_standard", card_count=6)
    db.add(product); db.commit()
    with pytest.raises(ValueError, match="only available for the Permanent"):
        tcg_v2._validated_permanent_target(product, "creator")


def test_sealed_order_snapshot_persists_the_target_type(db):
    product, _cards = _pool(db, [CardType.gallery])
    snapshot = tcg_room._frozen_order_snapshot(db, product, None, "gallery")
    assert snapshot["target_card_type"] == "gallery"
    assert snapshot["card_count"] == 10
