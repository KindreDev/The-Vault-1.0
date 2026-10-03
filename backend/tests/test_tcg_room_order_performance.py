"""Focused checkout snapshot regression on an isolated Foundation-sized pool."""

import json
import statistics
import time

from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker

from models import (
    Base,
    Card,
    CardInventory,
    CardRarity,
    CardType,
    Gallery,
    Creator,
    Image,
    TCGChecklistEntry,
    TCGOnlineOrderLine,
    TCGPackProduct,
    TCGRelease,
    TCGParcel,
    TCGParcelPack,
    UserProfile,
)
from services import tcg_room, tcg_v2


def test_checkout_freezes_foundation_pool_without_hydrating_every_card(tmp_path, monkeypatch):
    engine = create_engine(
        f"sqlite:///{tmp_path / 'order-performance.sqlite'}",
        connect_args={"check_same_thread": False},
    )
    Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine, expire_on_commit=False)()
    try:
        release = TCGRelease(
            code="FND-CORE", name="Foundation", status="published",
            generation_seed="order-performance-fixture",
        )
        db.add(release)
        db.flush()
        person = Creator(name="Pack fixture", creator_type="character")
        db.add(person); db.flush()
        gallery = Gallery(name="Pack art fixture", folder_path=str(tmp_path / "art"), creator_id=person.id, period_year=2026)
        db.add(gallery)
        db.flush()
        connection = db.connection()
        connection.execute(Image.__table__.insert(), [
            {
                "id": image_id,
                "filename": f"art-{image_id}.jpg",
                "file_path": str(tmp_path / f"art-{image_id}.jpg"),
                "gallery_id": gallery.id,
                "width": 640, "height": 640, "is_video": False,
            }
            for image_id in range(1, 513)
        ])
        product = TCGPackProduct(
            code="VAULT-PERMANENT",
            name="Permanent Vault Booster",
            product_kind="permanent",
            release_id=release.id,
            card_count=10,
            active=True,
            purchasable=True,
            regular_price=400,
            simulation_report=json.dumps({"approved": True}),
        )
        wallet = UserProfile(vault_credits=1000)
        db.add_all([product, wallet])
        db.flush()

        pool_ids = range(1, 60_001)
        connection.execute(Card.__table__.insert(), [
            {
                "id": card_id,
                "card_type": CardType.image,
                "rarity": CardRarity.common,
                "print_rarity": "C",
                "rarity_class": "R",
                "is_legacy": False,
                "source_image_id": ((card_id - 1) % 512) + 1,
            }
            for card_id in pool_ids
        ])
        connection.execute(TCGChecklistEntry.__table__.insert(), [
            {
                "id": card_id,
                "release_id": release.id,
                "card_id": card_id,
                "collector_position": card_id,
                "collector_suffix": "",
                "is_base_printing": True,
                "required_for_complete": True,
                "published_rarity": "C",
                "selection_reason": "",
            }
            for card_id in pool_ids
        ])
        connection.execute(CardInventory.__table__.insert(), [
            {"card_id": card_id, "quantity": 1} for card_id in (3, 100, 50_000)
        ])
        db.commit()

        # Compare equivalent snapshot-building scopes on the same pool. The
        # baseline reproduces the former ORM hydration plus full artwork walk;
        # the optimized side builds and JSON-encodes the complete frozen line
        # snapshot using scalar rows and bounded face art.
        baseline_times = []
        optimized_snapshot_times = []
        for _ in range(3):
            db.expunge_all()
            product = db.query(TCGPackProduct).filter_by(code="VAULT-PERMANENT").one()
            started = time.perf_counter()
            old_snapshot = tcg_v2.pack_dict(product, release)
            old_entries = tcg_v2._eligible_pack_entries(db, product, None)
            old_ids = [entry.id for entry in old_entries]
            old_art_ids = []
            for entry in old_entries:
                image_id = getattr(entry.card, "source_image_id", None)
                if image_id and image_id not in old_art_ids:
                    old_art_ids.append(int(image_id))
            if old_art_ids:
                old_snapshot.update(
                    snapshot_art_url=f"/api/images/{old_art_ids[0]}/file",
                    snapshot_art_image_id=old_art_ids[0],
                    snapshot_art_urls=[f"/api/images/{image_id}/file" for image_id in old_art_ids],
                    snapshot_art_image_ids=old_art_ids,
                )
            old_snapshot["eligible_entry_ids"] = old_ids
            old_snapshot["owned_card_ids"] = [
                row[0] for row in db.query(CardInventory.card_id).filter(
                    CardInventory.quantity > 0,
                ).order_by(CardInventory.card_id).all()
            ]
            json.dumps(old_snapshot)
            baseline_times.append(time.perf_counter() - started)

            started = time.perf_counter()
            optimized_snapshot = tcg_room._frozen_order_snapshot(db, product, None)
            json.dumps(optimized_snapshot)
            optimized_snapshot_times.append(time.perf_counter() - started)
        baseline_seconds = statistics.median(baseline_times)
        optimized_snapshot_seconds = statistics.median(optimized_snapshot_times)
        old_ids = list(range(1, 60_001))
        db.expunge_all()
        product = db.query(TCGPackProduct).filter_by(code="VAULT-PERMANENT").one()

        monkeypatch.setattr(tcg_v2, "seed_pack_products", lambda _db: None)
        hydrated_card_ids = []

        def record_card_load(card, _context):
            hydrated_card_ids.append(card.id)

        event.listen(Card, "load", record_card_load)
        try:
            optimized_start = time.perf_counter()
            parcel = tcg_room.place_order(db, [{"product_id": product.id, "quantity": 1}])
            optimized_seconds = time.perf_counter() - optimized_start
        finally:
            event.remove(Card, "load", record_card_load)

        line = db.query(TCGOnlineOrderLine).one()
        frozen = json.loads(line.product_snapshot_json)
        order_contents = parcel["contents"]
        saved_ids = frozen["eligible_entry_ids"]
        assert saved_ids == old_ids == list(pool_ids)
        assert frozen["owned_card_ids"] == [3, 100, 50_000]
        assert "eligible_entry_ids" not in order_contents[0]["product"]
        assert "owned_card_ids" not in order_contents[0]["product"]
        art_urls = order_contents[0]["product"].get("snapshot_art_urls", [])
        assert 1 <= len(art_urls) <= 256
        assert frozen["snapshot_art_urls"] == art_urls
        assert frozen["snapshot_art_urls"] == tcg_room._frozen_order_snapshot(
            db, product, None,
        )["snapshot_art_urls"]
        assert hydrated_card_ids == []
        pack = db.query(TCGParcelPack).one()
        assert pack.contents_seed == tcg_room._pack_contents_seed(
            db.query(tcg_room.TCGOnlineOrder).one().order_seed, 0, 0,
        )
        assert db.query(UserProfile).one().vault_credits == 600

        # The full frozen line snapshot, not the compact parent-order summary,
        # remains the input to opening even if the current catalog changes.
        monkeypatch.setattr(
            "services.tcg_v2.prepare_card_face_for_reveal",
            lambda session, selected_card: (selected_card, {}),
        )
        db.query(TCGRelease).one().status = "draft"
        db.query(TCGParcel).one().status = "collected"
        db.commit()
        opened = tcg_room.open_parcel(db, parcel["id"])
        assert opened["status"] == "opened"
        pulled_card_ids = [card["id"] for card in opened["results"][0]["cards"]]
        assert len(pulled_card_ids) == 10
        assert set(pulled_card_ids).issubset({card_id for card_id in saved_ids})
        reopened = tcg_room.open_parcel(db, parcel["id"])
        assert [card["id"] for card in reopened["results"][0]["cards"]] == pulled_card_ids
        assert reopened["contents"][0]["product"]["snapshot_art_urls"] == art_urls

        print(
            "Foundation-sized checkout benchmark (3-run medians): "
            f"old ORM snapshot={baseline_seconds:.3f}s, "
            f"optimized snapshot={optimized_snapshot_seconds:.3f}s, "
            f"snapshot speedup={baseline_seconds / max(optimized_snapshot_seconds, 0.000001):.1f}x, "
            f"full optimized order={optimized_seconds:.3f}s, "
            f"frozen IDs={len(saved_ids)}, art URLs={len(order_contents[0]['product'].get('snapshot_art_urls', []))}"
        )
    finally:
        db.close()
        engine.dispose()
