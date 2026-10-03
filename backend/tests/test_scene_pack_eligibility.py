"""Unassigned Scene printings cannot enter either live or prepaid packs."""
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from models import Base, Card, CardType, CardRarity, Creator, Gallery, Image, TCGRelease, TCGChecklistEntry, TCGPackProduct, CardInventory
from services.scene_eligibility import scene_source_eligible, renderable_scene_card
from services.tcg_v2 import _eligible_pack_entries, _load_frozen_pack_entries


def test_incomplete_scenes_stay_owned_but_never_enter_live_or_prepaid_packs(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'eligibility.db'}")
    Base.metadata.create_all(engine)
    with sessionmaker(bind=engine)() as db:
        person = Creator(name="Verified character", creator_type="character")
        db.add(person); db.flush()
        galleries = [Gallery(name=name, folder_path=name, creator_id=person.id if name != "Mixed" else None, period_year=2026 if name != "Undated" else None) for name in ["Assigned", "Mixed", "Undated"]]
        db.add_all(galleries); db.flush()
        images = [Image(gallery_id=g.id, filename=f"{i}.png", file_path=f"/{i}.png", width=640, height=640, is_video=False) for i,g in enumerate(galleries)]
        db.add_all(images); db.flush()
        cards = [Card(card_type=CardType.image, rarity=CardRarity.common, source_image_id=im.id, print_rarity="C", catalog_code="FND-001") for im in images]
        direct = Card(card_type=CardType.image, rarity=CardRarity.common, source_image_id=images[1].id, source_creator_id=person.id, print_rarity="C", catalog_code="FND-001")
        other = Card(card_type=CardType.gallery, rarity=CardRarity.common, source_gallery_id=galleries[1].id, print_rarity="C", catalog_code="FND-001")
        cards.extend([direct, other]); db.add_all(cards); db.flush()
        release = TCGRelease(code="FND-001", name="Foundation", release_kind="foundation", status="published", generation_seed="check")
        product = TCGPackProduct(code="CHECK", name="Check", product_kind="permanent", card_count=10)
        db.add_all([release,product]); db.flush()
        entries = [TCGChecklistEntry(release_id=release.id, card_id=c.id, collector_position=i+1, published_rarity="C") for i,c in enumerate(cards)]
        db.add_all(entries); db.add(CardInventory(card_id=cards[1].id, quantity=1)); db.commit()
        expected = {cards[0].id, direct.id, other.id}
        assert {entry.card_id for entry in _eligible_pack_entries(db, product, None)} == expected
        assert {entry.card_id for entry in _load_frozen_pack_entries(db, [e.id for e in entries])} == expected
        assert {row.id for row in db.query(Image).filter(scene_source_eligible()).all()} == {images[0].id}
        assert db.query(CardInventory).filter_by(card_id=cards[1].id).one().quantity == 1
        assert db.query(Card).count() == 5
        galleries[1].creator_id = person.id; db.commit()
        assert db.query(Card).filter(Card.id == cards[1].id, renderable_scene_card()).count() == 1
        assert {row.id for row in db.query(Image).filter(scene_source_eligible()).all()} == {images[0].id, images[1].id}
    engine.dispose()
