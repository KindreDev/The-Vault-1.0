"""Focused persistence checks for the TCG room inventory lifecycle.

These tests deliberately use a temporary SQLite database.  The room inventory
is an optional feature, so its tests should never import or mutate the live
Vault database.
"""

from datetime import datetime, timedelta
import json

import pytest
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker

from models import (
    Base,
    Card,
    CardRarity,
    CardType,
    TCGDisplayItemInstance,
    TCGDisplayItemDefinition,
    TCGChecklistEntry,
    TCGOnlineOrder,
    TCGOnlineOrderLine,
    TCGPackOpening,
    TCGPackProduct,
    TCGParcel,
    TCGParcelPack,
    TCGRelease,
    TCGRoomLayout,
    TCGRoomFurnitureMigration,
    TCGRoomPlacement,
    UserProfile,
)
from services import tcg_room


@pytest.fixture
def db(tmp_path):
    """Yield a session backed by an isolated temporary SQLite file."""

    engine = create_engine(
        f"sqlite:///{tmp_path / 'room-inventory.sqlite'}",
        connect_args={"check_same_thread": False},
    )

    @event.listens_for(engine, "connect")
    def _enable_foreign_keys(connection, _record):
        connection.execute("PRAGMA foreign_keys=ON")

    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine, expire_on_commit=False)()
    try:
        yield session
    finally:
        session.close()
        engine.dispose()


def _parcel_fixture(db, *, status="placed", with_opening=False):
    product = TCGPackProduct(
        code="TEST-ROOM-PACK",
        name="Room test pack",
        product_kind="permanent",
        card_count=1,
        active=True,
        purchasable=False,
        regular_price=500,
        simulation_report=json.dumps({"approved": True}),
    )
    db.add(product)
    db.flush()

    order = TCGOnlineOrder(
        status=status,
        total_price=500,
        contents_json=json.dumps([{"product_id": product.id, "quantity": 1}]),
        order_seed="test-room-order-seed",
        ready_at=datetime.utcnow() - timedelta(seconds=1),
        delivery_delay_seconds=5,
    )
    db.add(order)
    db.flush()

    line = TCGOnlineOrderLine(
        order_id=order.id,
        product_id=product.id,
        quantity=1,
        unit_price=500,
        product_snapshot_json=json.dumps({"card_count": 1}),
    )
    db.add(line)
    db.flush()

    parcel = TCGParcel(
        order_id=order.id,
        status=status,
        ready_at=order.ready_at,
        placement_json=json.dumps({"position": {"x": 1, "y": 0, "z": 2}}),
    )
    db.add(parcel)
    db.flush()

    opening = None
    if with_opening:
        opening = TCGPackOpening(
            product_id=product.id,
            price_paid=500,
            opening_seed="already-owned-opening-seed",
        )
        db.add(opening)
        db.flush()

    pack = TCGParcelPack(
        parcel_id=parcel.id,
        line_id=line.id,
        pack_index=0,
        contents_seed="sealed-room-pack-seed",
        opening_id=opening.id if opening else None,
    )
    db.add(pack)
    db.commit()
    return order, line, parcel, pack, product, opening


def test_room_inventory_preserves_exact_instance_identity_and_status(db):
    tcg_room.seed_display_catalog(db)
    db.flush()
    definition = db.query(TCGDisplayItemDefinition).filter_by(code="room-nightstand").one()
    db.add_all([
        TCGRoomFurnitureMigration(id=1, version=1, report_json=json.dumps({"version": 1})),
        TCGDisplayItemInstance(
            definition_id=definition.id,
            variant_key="light",
            source_type="test",
            source_id="instance-inventory",
        ),
        TCGDisplayItemInstance(
            definition_id=definition.id,
            variant_key="dark",
            source_type="test",
            source_id="instance-placed",
        ),
        TCGRoomLayout(id=1),
    ])
    db.flush()
    instances = db.query(TCGDisplayItemInstance).order_by(TCGDisplayItemInstance.id).all()
    db.add(TCGRoomPlacement(
        layout_id=1,
        instance_id=instances[1].id,
        transform_json=json.dumps({
            "position": {"x": 0.0, "y": 0.0, "z": 0.0},
            "rotation": {"x": 0.0, "y": 0.0, "z": 0.0},
        }),
        placement_state="placed",
    ))
    db.commit()

    result = tcg_room.room_inventory(db)
    rows = {row["instance_id"]: row for row in result["furniture"]}

    assert rows[instances[0].id]["definition_id"] == definition.id
    assert rows[instances[0].id]["variant_key"] == "light"
    assert rows[instances[0].id]["status"] == "inventory"
    assert rows[instances[0].id]["transform"] is None
    assert rows[instances[1].id]["variant_key"] == "dark"
    assert rows[instances[1].id]["status"] == "placed"
    assert rows[instances[1].id]["transform"]["position"]["z"] == 0.0


def test_placed_to_collected_reconciliation_is_idempotent_and_preserves_sealed_pack_ownership(db):
    _, _, parcel, pack, _, opening = _parcel_fixture(db, with_opening=True)
    original_seed = pack.contents_seed
    original_opening_id = opening.id

    first = tcg_room.reconcile_parcel_inventory(db)
    db.refresh(parcel)
    db.refresh(pack)
    assert first == {"migrated_parcel_ids": [parcel.id]}
    assert parcel.status == "collected"
    assert parcel.placement_json == "{}"
    assert pack.contents_seed == original_seed
    assert pack.opening_id == original_opening_id

    second = tcg_room.reconcile_parcel_inventory(db)
    db.refresh(parcel)
    db.refresh(pack)
    assert second == {"migrated_parcel_ids": []}
    assert parcel.status == "collected"
    assert pack.contents_seed == original_seed
    assert pack.opening_id == original_opening_id


def test_collected_parcel_opens_once_and_repeated_open_does_not_grant_again(db, monkeypatch):
    _, _, parcel, pack, product, _ = _parcel_fixture(db, status="collected")
    profile = UserProfile(vault_credits=9_999)
    db.add(profile)
    db.commit()
    calls = []

    def fake_open_pack_product(session, product_id, **kwargs):
        calls.append((product_id, kwargs.copy()))
        opening = TCGPackOpening(
            product_id=product_id,
            price_paid=kwargs["prepaid_price"],
            opening_seed=kwargs["seed_override"],
        )
        session.add(opening)
        session.flush()
        return {"opening_id": opening.id, "cards": [{"id": 1234}]}

    monkeypatch.setattr("services.tcg_v2.open_pack_product", fake_open_pack_product)

    first = tcg_room.open_parcel(db, parcel.id)
    db.refresh(parcel)
    db.refresh(pack)
    assert first["status"] == "opened"
    assert parcel.status == "opened"
    assert pack.opening_id is not None
    assert len(db.query(TCGPackOpening).all()) == 1
    assert len(calls) == 1
    assert calls[0][0] == product.id

    with pytest.raises(ValueError, match="must be collected"):
        tcg_room.open_parcel(db, parcel.id)

    db.refresh(parcel)
    db.refresh(pack)
    assert parcel.status == "opened"
    assert pack.opening_id is not None
    assert len(db.query(TCGPackOpening).all()) == 1
    assert len(calls) == 1


def test_prepaid_inventory_opening_does_not_debit_currency(db, monkeypatch):
    _, _, parcel, _, product, _ = _parcel_fixture(db, status="collected")
    release = TCGRelease(
        code="FND-CORE",
        name="Foundation",
        status="published",
        generation_seed="test-foundation-seed",
    )
    card = Card(
        card_type=CardType.image,
        rarity=CardRarity.common,
        print_rarity="C",
        rarity_class="R",
    )
    db.add_all([release, card])
    db.flush()
    db.add(TCGChecklistEntry(
        release_id=release.id,
        card_id=card.id,
        collector_position=1,
        published_rarity="C",
    ))
    profile = UserProfile(vault_credits=4_321)
    db.add(profile)
    db.commit()
    before = profile.vault_credits
    monkeypatch.setattr(
        "services.tcg_v2.prepare_card_face_for_reveal",
        lambda session, selected_card: (selected_card, {}),
    )
    tcg_room.open_parcel(db, parcel.id)

    db.refresh(profile)
    opening = db.query(TCGPackOpening).one()
    assert opening.price_paid == 500
    assert profile.vault_credits == before
