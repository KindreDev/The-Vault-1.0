"""Persistence and transactional workflows for the optional Collection Room."""

from __future__ import annotations

from datetime import datetime, timedelta
import hashlib
import json
import math
import secrets

from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError

from models import (
    CardInventory, CraftingMaterials, TCGDisplayAssignment, TCGDisplayItemDefinition,
    TCGDisplayItemInstance, TCGOnlineOrder, TCGOnlineOrderLine, TCGOwnedDisplayItem,
    TCGChecklistEntry,
    TCGPackProduct, TCGPackToken, TCGParcel, TCGParcelPack, TCGPhysicalCardCopy, TCGRoomLayout,
    TCGRoomPlacement, TCGWorkshopUnlock, UserProfile,
    TCGRoomFurnitureMigration,
)
from services.cards import _card_to_dict
from services.physical_cards import ensure_reconciled, move_copy
from services.tcg_room_module import REQUIRED_ASSET_IDS
from services.room_geometry import (
    authored_room_bounds, floor_footprint_supported, infer_wall_yaw, wall_footprint_supported,
)


MAX_PLACEMENTS = 250
MAX_HISTORY = 50
DEFAULT_DELAY_SECONDS = 5
VISIBLE_PILE_LIMIT = 8
VISIBLE_PLACED_LIMIT = 64
VISIBLE_CARRIED_LIMIT = 4
FURNITURE_MIGRATION_VERSION = 6
ROOM_FLOOR_Y = .17
ROOM_HEIGHT = 3.0
PERMANENT_FIXTURES = (
    "room_floor", "room_ceiling", "wall_north", "wall_south_windowed", "wall_east",
    "wall_west_door", "window_double", "bedroom_door", "baseboard_trim",
    "kitchen_partition", "computer_desk", "pc_tower", "pc_monitor", "pc_keyboard",
    "pc_mouse", "kitchen_counter", "upper_kitchen_cabinet", "refrigerator", "microwave",
    "kitchen_sink", "dining_table", "ceiling_light", "door_mail_slot",
)
LIVE_SHOP_ASSETS = frozenset({
    "card_display_stand_white", "card_display_stand_black",
    "graded_card_stand_white", "graded_card_stand_black",
    "glass_display_case", "glass_display_cabinet", "floating_glass_cabinet", "poster_frame",
})
MANUAL_ASSET_IDS = LIVE_SHOP_ASSETS
SURFACE_HOST_ASSETS = frozenset({
    "glass_display_case", "glass_display_cabinet", "floating_glass_cabinet",
})
SHELF_ASSETS = SURFACE_HOST_ASSETS
WALL_BASE_ORIGIN_ASSETS = frozenset({"floating_glass_cabinet"})

# These are measured from the authored GLB origins.  A support item is placed
# on one of these shelf tops, inside the host's clear opening.  Keeping the
# authored slots in the catalog makes the same rule available to both the
# browser preview and the server-side layout validator.
SHELF_SUPPORT_SLOTS = {
    "glass_display_case": (
        {"y": .02, "width": .52, "depth": .52},
        {"y": .54, "width": .52, "depth": .52},
        {"y": 1.07, "width": .52, "depth": .52},
        {"y": 1.60, "width": .52, "depth": .52},
        {"y": 2.11, "width": .52, "depth": .52},
    ),
    "glass_display_cabinet": (
        {"y": .72, "width": .48, "depth": .30},
        {"y": 1.14, "width": .48, "depth": .30},
        {"y": 1.56, "width": .48, "depth": .30},
        {"y": 1.97, "width": .48, "depth": .30},
        {"y": 2.38, "width": .48, "depth": .30},
    ),
    "floating_glass_cabinet": (
        {"y": .04, "width": .62, "depth": .24},
        {"y": .47, "width": .62, "depth": .24},
        {"y": .91, "width": .62, "depth": .24},
        {"y": 1.35, "width": .62, "depth": .24},
        {"y": 1.78, "width": .62, "depth": .24},
    ),
}
AUTHORED_SURFACE_SLOTS = (
    {"min_x": -4.73, "max_x": -4.07, "min_z": -4.40, "max_z": -2.81, "top": .855},
    {"min_x": 2.63, "max_x": 3.42, "min_z": -1.77, "max_z": .18, "top": .932},
)


class RevisionConflict(ValueError):
    pass


def _load(raw, fallback):
    try:
        return json.loads(raw) if raw else fallback
    except (TypeError, ValueError):
        return fallback


def _dump(value):
    return json.dumps(value, separators=(",", ":"), sort_keys=True, default=str)


def _layout(db: Session) -> TCGRoomLayout:
    row = db.get(TCGRoomLayout, 1)
    if not row:
        row = TCGRoomLayout(id=1)
        db.add(row); db.flush()
    return row


def _placement_dict(row: TCGRoomPlacement) -> dict:
    return {
        "id": row.id, "instance_id": row.instance_id,
        "transform": _load(row.transform_json, {}), "snap_anchor": row.snap_anchor,
        "placement_state": row.placement_state,
    }


def _canonical_transform(raw: dict, definition: TCGDisplayItemDefinition) -> dict:
    if not isinstance(raw, dict):
        raise ValueError("Furniture transform must be an object")
    if "scale" in raw or any(str(key).lower().startswith("scale") for key in raw):
        raise ValueError("Furniture cannot be resized")
    # Import the one early-development flat-position shape, then persist only
    # the canonical shape. Scale remains forbidden in both forms.
    if set(raw).issubset({"x", "y", "z"}) and set(raw):
        raw = {"position": {"x": raw.get("x", 0), "y": raw.get("y", 0), "z": raw.get("z", 0)},
               "rotation": {"x": 0, "y": 0, "z": 0}}
    allowed = {
        "position", "rotation", "content",
        "support_host_instance_id", "support_slot", "support_offset_x", "support_offset_z",
        "support_local_rotation_y",
    }
    if not set(raw).issubset(allowed):
        raise ValueError("Furniture transform accepts only position, rotation, and content")
    position, rotation = raw.get("position"), raw.get("rotation")
    if not isinstance(position, dict) or not isinstance(rotation, dict):
        raise ValueError("Furniture transform requires position and rotation")
    if set(position) != {"x", "y", "z"} or set(rotation) != {"x", "y", "z"}:
        raise ValueError("Furniture position and rotation require x, y, and z")
    values = [position[k] for k in ("x", "y", "z")] + [rotation[k] for k in ("x", "y", "z")]
    if any(isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) for value in values):
        raise ValueError("Furniture transform values must be finite numbers")
    px, py, pz = (float(position[k]) for k in ("x", "y", "z"))
    normalized_rotation = {key: float(rotation[key]) for key in ("x", "y", "z")}
    if py < 0 or py > ROOM_HEIGHT:
        raise ValueError("Furniture must remain inside the room height")
    support = _load(definition.footprint_json, {}).get("support")
    if definition.placement_kind == "floor" and support == "surface":
        if py < ROOM_FLOOR_Y - .02 or py > 2.7:
            raise ValueError("This item must sit on a table, desk, stand, or counter — not the floor")
    elif definition.placement_kind == "floor" and (py < -.02 or py > .22):
        raise ValueError("Floor furniture must sit on the floor")
    support_metadata = (
        raw.get("support_host_instance_id"), raw.get("support_slot"),
        raw.get("support_offset_x"), raw.get("support_offset_z"),
        raw.get("support_local_rotation_y"),
    )
    if any(value is not None for value in support_metadata):
        host_instance_id, support_slot = support_metadata[:2]
        if (isinstance(host_instance_id, bool) or not isinstance(host_instance_id, int) or host_instance_id < 1 or
                isinstance(support_slot, bool) or not isinstance(support_slot, int) or support_slot < 0):
            raise ValueError("Nested furniture requires a valid support host and shelf slot")
        numeric_metadata = support_metadata[2:]
        if any(isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value)
               for value in numeric_metadata if value is not None):
            raise ValueError("Nested furniture support values must be finite numbers")
        result_metadata = {
            "support_host_instance_id": host_instance_id,
            "support_slot": support_slot,
            "support_offset_x": float(raw.get("support_offset_x", 0)),
            "support_offset_z": float(raw.get("support_offset_z", 0)),
            "support_local_rotation_y": float(raw.get("support_local_rotation_y", 0)),
        }
    else:
        result_metadata = {}
    content = raw.get("content") if isinstance(raw.get("content"), dict) else {}
    clean_content = {}
    if content.get("image_id") is not None:
        clean_content["image_id"] = int(content["image_id"])
    if "landscape" in content:
        clean_content["landscape"] = bool(content.get("landscape"))
    result = {"position": {"x": px, "y": py, "z": pz},
              "rotation": normalized_rotation}
    result.update(result_metadata)
    if clean_content:
        result["content"] = clean_content
    return result


def _dimensions(definition: TCGDisplayItemDefinition) -> tuple[float, float, float]:
    value = _load(definition.footprint_json, {})
    return (max(.05, float(value.get("width", .5))), max(.05, float(value.get("depth", .5))),
            max(.05, float(value.get("height", .5))))


def _rotated_footprint(width: float, depth: float, yaw: float) -> tuple[float, float]:
    cosine, sine = abs(math.cos(yaw)), abs(math.sin(yaw))
    return cosine * width + sine * depth, sine * width + cosine * depth


def _support_slots(definition: TCGDisplayItemDefinition) -> tuple[dict, ...]:
    value = _load(definition.footprint_json, {})
    slots = value.get("support_slots")
    if isinstance(slots, list) and slots:
        return tuple(slot for slot in slots if isinstance(slot, dict))
    return tuple(SHELF_SUPPORT_SLOTS.get(definition.asset_id, ()))


def _shelf_slot_boxes(definition: TCGDisplayItemDefinition, transform: dict,
                      host_instance_id: int | None = None) -> list[dict]:
    position = transform["position"]
    rotation = transform["rotation"]
    footprint = _load(definition.footprint_json, {})
    default_width = float(footprint.get("width", .5))
    default_depth = float(footprint.get("depth", .5))
    boxes = []
    yaw = float(rotation["y"])
    cosine, sine = math.cos(yaw), math.sin(yaw)
    for slot_index, slot in enumerate(_support_slots(definition)):
        width = max(.05, float(slot.get("width", default_width)))
        depth = max(.05, float(slot.get("depth", default_depth)))
        extent_x, extent_z = _rotated_footprint(width, depth, yaw)
        local_x, local_z = float(slot.get("x", 0)), float(slot.get("z", 0))
        center_x = position["x"] + cosine * local_x - sine * local_z
        center_z = position["z"] + sine * local_x + cosine * local_z
        boxes.append({
            "min_x": center_x - extent_x / 2,
            "max_x": center_x + extent_x / 2,
            "min_z": center_z - extent_z / 2,
            "max_z": center_z + extent_z / 2,
            "top": position["y"] + float(slot.get("y", 0)),
            "host_instance_id": host_instance_id,
            "slot_index": slot_index,
        })
    return boxes


def _surface_host_for(definition: TCGDisplayItemDefinition, transform: dict,
                      hosts: list[dict]) -> dict | None:
    width, depth, _ = _dimensions(definition)
    extent_x, extent_z = _rotated_footprint(width, depth, transform["rotation"]["y"])
    position = transform["position"]
    min_x, max_x = position["x"] - extent_x / 2, position["x"] + extent_x / 2
    min_z, max_z = position["z"] - extent_z / 2, position["z"] + extent_z / 2
    for host in hosts:
        if abs(position["y"] - host["top"]) > .10:
            continue
        if min_x >= host["min_x"] and max_x <= host["max_x"] and min_z >= host["min_z"] and max_z <= host["max_z"]:
            return host
    return None


def _support_slot(definition: TCGDisplayItemDefinition, slot_index: int) -> dict:
    slots = _support_slots(definition)
    if isinstance(slot_index, bool) or not isinstance(slot_index, int) or not 0 <= slot_index < len(slots):
        raise ValueError("Nested furniture references an unavailable shelf slot")
    return slots[slot_index]


def _nested_transform(child_transform: dict, host_transform: dict,
                      host_definition: TCGDisplayItemDefinition, host_instance_id: int,
                      slot_index: int, *, infer_offset: bool = False) -> dict:
    slot = _support_slot(host_definition, slot_index)
    host_position = host_transform["position"]
    host_rotation_y = float(host_transform["rotation"]["y"])
    cosine, sine = math.cos(host_rotation_y), math.sin(host_rotation_y)
    child_position = child_transform["position"]
    child_rotation = child_transform["rotation"]
    if infer_offset:
        delta_x = child_position["x"] - host_position["x"]
        delta_z = child_position["z"] - host_position["z"]
        offset_x = cosine * delta_x + sine * delta_z
        offset_z = -sine * delta_x + cosine * delta_z
        local_rotation_y = float(child_rotation["y"]) - host_rotation_y
    else:
        offset_x = float(child_transform.get("support_offset_x", 0))
        offset_z = float(child_transform.get("support_offset_z", 0))
        local_rotation_y = float(child_transform.get("support_local_rotation_y", 0))
    world_x = host_position["x"] + cosine * offset_x - sine * offset_z
    world_z = host_position["z"] + sine * offset_x + cosine * offset_z
    result = {
        "position": {
            "x": world_x,
            "y": host_position["y"] + float(slot.get("y", 0)),
            "z": world_z,
        },
        "rotation": {
            "x": float(child_rotation["x"]),
            "y": host_rotation_y + local_rotation_y,
            "z": float(child_rotation["z"]),
        },
        "support_host_instance_id": int(host_instance_id),
        "support_slot": int(slot_index),
        "support_offset_x": offset_x,
        "support_offset_z": offset_z,
        "support_local_rotation_y": local_rotation_y,
    }
    if child_transform.get("content"):
        result["content"] = child_transform["content"]
    return result


def _overlap_box(left: dict, right: dict) -> bool:
    return (left["min_x"] < right["max_x"] and left["max_x"] > right["min_x"] and
            left["min_z"] < right["max_z"] and left["max_z"] > right["min_z"])


def _is_manual_furniture(definition: TCGDisplayItemDefinition | None) -> bool:
    return bool(definition and definition.active and definition.placeable and
                not definition.permanent_fixture and definition.asset_id in MANUAL_ASSET_IDS)


def _wall_box(definition: TCGDisplayItemDefinition, transform: dict) -> dict:
    width, _depth, height = _dimensions(definition)
    yaw = float(transform["rotation"]["y"])
    normal_x, normal_z = math.sin(yaw), math.cos(yaw)
    if abs(normal_x) >= abs(normal_z):
        axis, coordinate, tangent_size = "x", transform["position"]["x"], width
        normal_sign = 1 if normal_x >= 0 else -1
        tangent = transform["position"]["z"]
    else:
        axis, coordinate, tangent_size = "z", transform["position"]["z"], width
        normal_sign = 1 if normal_z >= 0 else -1
        tangent = transform["position"]["x"]
    base_origin = definition.asset_id in WALL_BASE_ORIGIN_ASSETS
    position_y = float(transform["position"]["y"])
    return {
        "axis": axis,
        "coordinate": float(coordinate),
        "normal_sign": normal_sign,
        "tangent_min": tangent - tangent_size / 2,
        "tangent_max": tangent + tangent_size / 2,
        "vertical_min": position_y if base_origin else position_y - height / 2,
        "vertical_max": position_y + height if base_origin else position_y + height / 2,
    }


def _same_wall_surface(left: dict, right: dict) -> bool:
    return (left["axis"] == right["axis"] and left["normal_sign"] == right["normal_sign"] and
            abs(left["coordinate"] - right["coordinate"]) <= .16)


def _validate_placements(db: Session, placements: list[dict]) -> list[dict]:
    instance_ids = [int(item["instance_id"]) for item in placements]
    if len(instance_ids) != len(set(instance_ids)):
        raise ValueError("An item instance can only be placed once")
    instances = {row.id: row for row in db.query(TCGDisplayItemInstance).filter(TCGDisplayItemInstance.id.in_(instance_ids)).all()} if instance_ids else {}
    definitions = {row.id: row for row in db.query(TCGDisplayItemDefinition).filter(
        TCGDisplayItemDefinition.id.in_({row.definition_id for row in instances.values()})
    ).all()} if instances else {}
    if set(instance_ids) != set(instances):
        raise ValueError("Every placement must reference an owned item instance")
    prepared = {}
    for item in placements:
        instance = instances[int(item["instance_id"])]
        definition = definitions.get(instance.definition_id)
        if _is_manual_furniture(definition):
            prepared[instance.id] = (instance, definition, _canonical_transform(item.get("transform"), definition))

    shelf_boxes = {}
    surface_hosts = list(AUTHORED_SURFACE_SLOTS)
    for instance, definition, transform in prepared.values():
        if definition.asset_id not in SHELF_ASSETS:
            continue
        width, depth, _ = _dimensions(definition)
        extent_x, extent_z = _rotated_footprint(width, depth, transform["rotation"]["y"])
        position = transform["position"]
        shelf_boxes[instance.id] = {
            "min_x": position["x"] - extent_x / 2, "max_x": position["x"] + extent_x / 2,
            "min_z": position["z"] - extent_z / 2, "max_z": position["z"] + extent_z / 2,
        }
        surface_hosts.extend(_shelf_slot_boxes(definition, transform, instance.id))

    # Surface items are persisted in world space for rendering, but their
    # support relationship is persisted as well so a moving/rotating cabinet
    # can carry its contents with it. Infer the relationship for older rows
    # and newly placed items that arrive without the metadata.
    for instance, definition, transform in list(prepared.values()):
        if _load(definition.footprint_json, {}).get("support") != "surface":
            continue
        host_id = transform.get("support_host_instance_id")
        slot_index = transform.get("support_slot")
        if host_id is not None or slot_index is not None:
            host_item = prepared.get(int(host_id)) if host_id is not None else None
            if not host_item or host_item[1].asset_id not in SHELF_ASSETS:
                raise ValueError("Nested display stand host is unavailable")
            transform = _nested_transform(
                transform, host_item[2], host_item[1], int(host_id), int(slot_index),
            )
        else:
            host = _surface_host_for(definition, transform, surface_hosts)
            if host and host.get("host_instance_id") is not None:
                host_id = int(host["host_instance_id"])
                host_item = prepared.get(host_id)
                if not host_item:
                    raise ValueError("Nested display stand host is unavailable")
                transform = _nested_transform(
                    transform, host_item[2], host_item[1], host_id, int(host["slot_index"]),
                    infer_offset=True,
                )
        prepared[instance.id] = (instance, definition, transform)

    normalized = []
    floor_boxes = []
    wall_boxes = []
    for item in placements:
        prepared_item = prepared.get(int(item["instance_id"]))
        if not prepared_item:
            continue
        instance, definition, transform = prepared_item
        px, pz = transform["position"]["x"], transform["position"]["z"]
        width, depth, height = _dimensions(definition)
        extent_x, extent_z = _rotated_footprint(width, depth, transform["rotation"]["y"])
        box = {
            "min_x": px - extent_x / 2, "max_x": px + extent_x / 2,
            "min_z": pz - extent_z / 2, "max_z": pz + extent_z / 2,
        }
        if definition.placement_kind == "floor":
            min_x, max_x = box["min_x"], box["max_x"]
            min_z, max_z = box["min_z"], box["max_z"]
            support = _load(definition.footprint_json, {}).get("support")
            if support == "surface":
                if not _surface_host_for(definition, transform, surface_hosts):
                    raise ValueError("This item must sit on a shelf, table, desk, stand, or counter — not the floor")
            else:
                if not floor_footprint_supported(transform["position"], transform["rotation"]["y"], width, depth):
                    raise ValueError("Furniture footprint must remain on the authored room floor")
                if any(other_id != instance.id and _overlap_box(box, other_box)
                       for other_id, other_box in shelf_boxes.items()):
                    raise ValueError("Furniture cannot overlap another shelf")
                for other_min_x, other_max_x, other_min_z, other_max_z in floor_boxes:
                    if min_x < other_max_x and max_x > other_min_x and min_z < other_max_z and max_z > other_min_z:
                        raise ValueError("Furniture cannot overlap another placed item")
                floor_boxes.append((min_x, max_x, min_z, max_z))
        else:
            base_origin = definition.asset_id in WALL_BASE_ORIGIN_ASSETS
            if not wall_footprint_supported(
                    transform["position"], transform["rotation"]["y"], width, depth, height,
                    base_origin=base_origin):
                raise ValueError("Wall furniture must be attached to an authored wall surface")
            current_wall = _wall_box(definition, transform)
            if definition.asset_id in SHELF_ASSETS and any(
                other_id != instance.id and _overlap_box(box, other_box)
                for other_id, other_box in shelf_boxes.items()
            ):
                raise ValueError("Wall furniture cannot overlap another shelf")
            for other_wall in wall_boxes:
                if (_same_wall_surface(current_wall, other_wall) and
                        current_wall["tangent_min"] < other_wall["tangent_max"] and
                        current_wall["tangent_max"] > other_wall["tangent_min"] and
                        current_wall["vertical_min"] < other_wall["vertical_max"] and
                        current_wall["vertical_max"] > other_wall["vertical_min"]):
                    raise ValueError("Wall furniture cannot overlap another wall item")
            wall_boxes.append(current_wall)
        normalized.append({"instance_id": instance.id, "transform": transform,
                           "snap_anchor": item.get("snap_anchor"), "placement_state": "placed"})
    return normalized


def _snapshot(db: Session, layout: TCGRoomLayout) -> dict:
    placements = db.query(TCGRoomPlacement).filter_by(layout_id=layout.id).order_by(TCGRoomPlacement.id).limit(MAX_PLACEMENTS + 1).all()
    if len(placements) > MAX_PLACEMENTS:
        raise ValueError(f"Room layouts are limited to {MAX_PLACEMENTS} placeable instances")
    return {
        "environment_key": layout.environment_key,
        "lighting": _load(layout.lighting_json, {}),
        "placements": [_placement_dict(row) for row in placements],
    }


def _apply_snapshot(db: Session, layout: TCGRoomLayout, state: dict) -> None:
    placements = state.get("placements") or []
    if len(placements) > MAX_PLACEMENTS:
        raise ValueError(f"Room layouts are limited to {MAX_PLACEMENTS} placeable instances")
    placements = _validate_placements(db, placements)
    db.query(TCGRoomPlacement).filter_by(layout_id=layout.id).delete(synchronize_session=False)
    for item in placements:
        db.add(TCGRoomPlacement(
            layout_id=layout.id, instance_id=int(item["instance_id"]),
            transform_json=_dump(item.get("transform") or {}),
            snap_anchor=item.get("snap_anchor"),
            placement_state=str(item.get("placement_state") or "placed"),
        ))
    layout.environment_key = str(state.get("environment_key") or "starter_room")
    layout.lighting_json = _dump(state.get("lighting") or {})
    db.flush()


def room_state(db: Session) -> dict:
    layout = db.get(TCGRoomLayout, 1)
    if not layout:
        layout = _layout(db)
    reconcile_sparse_furniture(db)
    db.commit()
    layout = db.get(TCGRoomLayout, 1)
    state = _snapshot(db, layout)
    return {"layout_id": layout.id, "revision": layout.revision, **state}


def save_room(db: Session, values: dict) -> dict:
    reconcile_sparse_furniture(db)
    layout = _layout(db)
    expected = int(values.get("expected_revision", -1))
    current = _snapshot(db, layout)
    undo = _load(layout.undo_json, [])
    # Validate before claiming the revision so a rejected transform cannot
    # consume a revision inside callers that use the service directly.
    values = {**values, "placements": _validate_placements(db, values.get("placements") or [])}
    claimed = db.query(TCGRoomLayout).filter(
        TCGRoomLayout.id == layout.id, TCGRoomLayout.revision == expected,
    ).update({TCGRoomLayout.revision: expected + 1}, synchronize_session=False)
    if claimed != 1:
        db.rollback()
        current_revision = db.query(TCGRoomLayout.revision).filter_by(id=layout.id).scalar()
        raise RevisionConflict(f"Room revision changed; expected {expected}, current {current_revision}")
    db.expire(layout)
    undo.append(current)
    layout.undo_json = _dump(undo[-MAX_HISTORY:])
    layout.redo_json = "[]"
    _apply_snapshot(db, layout, values)
    db.commit()
    return room_state(db)


def _history_move(db: Session, expected_revision: int, *, undoing: bool) -> dict:
    reconcile_sparse_furniture(db)
    layout = _layout(db)
    source = _load(layout.undo_json if undoing else layout.redo_json, [])
    target = _load(layout.redo_json if undoing else layout.undo_json, [])
    current = _snapshot(db, layout)
    claimed = db.query(TCGRoomLayout).filter(
        TCGRoomLayout.id == layout.id, TCGRoomLayout.revision == expected_revision,
    ).update({TCGRoomLayout.revision: expected_revision + 1}, synchronize_session=False)
    if claimed != 1:
        db.rollback()
        current_revision = db.query(TCGRoomLayout.revision).filter_by(id=layout.id).scalar()
        raise RevisionConflict(f"Room revision changed; expected {expected_revision}, current {current_revision}")
    if not source:
        db.rollback()
        raise ValueError("Nothing to undo" if undoing else "Nothing to redo")
    db.expire(layout)
    target.append(current)
    state = source.pop()
    _apply_snapshot(db, layout, state)
    if undoing:
        layout.undo_json, layout.redo_json = _dump(source), _dump(target[-MAX_HISTORY:])
    else:
        layout.redo_json, layout.undo_json = _dump(source), _dump(target[-MAX_HISTORY:])
    db.commit()
    return room_state(db)


def undo_room(db: Session, expected_revision: int) -> dict:
    return _history_move(db, expected_revision, undoing=True)


def redo_room(db: Session, expected_revision: int) -> dict:
    return _history_move(db, expected_revision, undoing=False)


def seed_display_catalog(db: Session) -> None:
    defaults = (
        ("room-card-stand-white", "White card stand", "display_stand", "card_display_stand_white", "credits", 180, ["white"], "floor", .10, .06, .13),
        ("room-card-stand-black", "Black card stand", "display_stand", "card_display_stand_black", "credits", 180, ["black"], "floor", .10, .06, .13),
        ("room-graded-stand-white", "White graded stand", "display_stand", "graded_card_stand_white", "credits", 360, ["white"], "floor", .28, .17, .38),
        ("room-graded-stand-black", "Black graded stand", "display_stand", "graded_card_stand_black", "credits", 360, ["black"], "floor", .28, .17, .38),
        ("room-glass-case", "Glass display case", "cabinet_slot", "glass_display_case", "credits", 950, ["clear"], "floor", .66, .66, 2.12),
        ("room-glass-cabinet", "Glass display cabinet", "cabinet_slot", "glass_display_cabinet", "credits", 1400, ["mahogany"], "floor", .6, .46, 2.41),
        ("room-floating-cabinet", "Floating glass cabinet", "cabinet_slot", "floating_glass_cabinet", "credits", 720, ["clear"], "wall", .77, .38, 1.83),
        ("room-poster-frame", "Vault poster", "display_stand", "poster_frame", "shards", 45, ["black"], "wall", .8, .08, 1.1),
    )
    for values in defaults:
        code, name, kind, asset_id, currency, cost, variants, placement_kind, width, depth, *height_values = values
        height = height_values[0] if height_values else .5
        footprint = {"width": width, "depth": depth, "height": height}
        if asset_id.startswith("card_display_stand") or asset_id.startswith("graded_card_stand"):
            footprint["support"] = "surface"
            footprint["slots"] = 9 if asset_id.startswith("graded_card_stand") else 1
        if asset_id in SHELF_SUPPORT_SLOTS:
            footprint["support_slots"] = list(SHELF_SUPPORT_SLOTS[asset_id])
        definition = db.query(TCGDisplayItemDefinition).filter_by(code=code).first()
        if not definition:
            db.add(TCGDisplayItemDefinition(
                code=code, name=name, item_type=kind, currency=currency,
                asset_id=asset_id, unit_cost=cost, variants_json=_dump(variants),
                placement_kind=placement_kind, footprint_json=_dump(footprint),
            ))
        else:
            definition.name = name
            definition.item_type = kind
            definition.asset_id = asset_id
            definition.currency = currency
            definition.unit_cost = cost
            definition.variants_json = _dump(variants)
            definition.placement_kind = placement_kind
            definition.footprint_json = _dump(footprint)
            definition.permanent_fixture = False
            definition.active = True
            definition.placeable = True
    # Compatibility bridge: renderable Workshop unlocks map to real module
    # meshes. Non-renderable cosmetics keep their ownership records but stay
    # out of the manual furniture surface.
    legacy_types = {"case": "acrylic_case", "stand": "display_stand", "wall_frame": "display_stand"}
    legacy_assets = {
        "CASE-ACRYLIC": ("acrylic_card_case", "floor", .3, .18, .4),
        "STAND-BLACK": ("display_stand_single", "floor", .45, .35, .5),
        "FRAME-WALL": ("wall_frame_portrait", "wall", .8, .08, 1.1),
        "LIGHT-ROSE": ("led_strip", "wall", 1.2, .08, .12),
    }
    for legacy in db.query(TCGWorkshopUnlock).all():
        code = f"workshop-{legacy.item_code}"
        definition = db.query(TCGDisplayItemDefinition).filter_by(code=code).first()
        mapped = legacy_assets.get(legacy.item_code)
        if not definition:
            definition = TCGDisplayItemDefinition(
                code=code, name=legacy.name, item_type=legacy_types.get(legacy.item_type, legacy.item_type),
                currency="shards", unit_cost=max(0, legacy.shard_cost or 0),
                asset_id=mapped[0] if mapped else None,
                placement_kind=mapped[1] if mapped else ("wall" if legacy.item_type == "wall_frame" else "floor"),
                footprint_json=_dump({"width": mapped[2] if mapped else .5, "depth": mapped[3] if mapped else .3,
                                      "height": mapped[4] if mapped else .5}),
            )
            db.add(definition); db.flush()
        elif mapped:
            definition.asset_id = mapped[0]
            definition.placement_kind = mapped[1]
            definition.footprint_json = _dump({"width": mapped[2], "depth": mapped[3], "height": mapped[4]})
        if legacy.owned and not db.query(TCGOwnedDisplayItem.id).filter_by(definition_id=definition.id, variant_key="default").first():
            db.add(TCGOwnedDisplayItem(definition_id=definition.id, variant_key="default", quantity=1))
            db.add(TCGDisplayItemInstance(definition_id=definition.id, variant_key="default", source_type="legacy_workshop", source_id=str(legacy.id)))
    aliases = {
        "card_display_stand": "card_display_stand_white",
        "graded_card_stand": "graded_card_stand_black",
    }
    for row in db.query(TCGDisplayItemDefinition).all():
        if row.asset_id in aliases:
            row.asset_id = aliases[row.asset_id]
        live = row.asset_id in LIVE_SHOP_ASSETS
        row.active = live
        row.placeable = live
    db.flush()


def reconcile_sparse_furniture(db: Session) -> dict:
    existing = db.get(TCGRoomFurnitureMigration, 1)
    if existing and existing.version >= FURNITURE_MIGRATION_VERSION:
        return _load(existing.report_json, {})
    seed_display_catalog(db)
    placements = db.query(TCGRoomPlacement).order_by(TCGRoomPlacement.id).all()
    moved_ids = []
    repaired_wall_ids = []
    nested_support_ids = []
    for placement in placements:
        instance = db.get(TCGDisplayItemInstance, placement.instance_id)
        definition = db.get(TCGDisplayItemDefinition, instance.definition_id) if instance else None
        # The version-1 migration used `permanent_fixture` to discard old
        # aggregate-only room placements.  Do not repeat that cleanup when a
        # later migration is repairing real, user-owned furniture instances.
        if not definition or (existing is None and not definition.permanent_fixture):
            moved_ids.append(placement.instance_id)
            db.delete(placement)
            continue
        if definition.placement_kind != "wall":
            continue
        raw_transform = _load(placement.transform_json, {})
        try:
            canonical = _canonical_transform(raw_transform, definition)
            width, depth, height = _dimensions(definition)
            base_origin = definition.asset_id in WALL_BASE_ORIGIN_ASSETS
            if not wall_footprint_supported(
                    canonical["position"], canonical["rotation"]["y"], width, depth, height,
                    base_origin=base_origin):
                repaired_yaw = infer_wall_yaw(canonical["position"], width, depth, height, base_origin=base_origin)
                if repaired_yaw is None:
                    raise ValueError("Wall placement is not on an authored wall surface")
                canonical["rotation"]["y"] = repaired_yaw
                if not wall_footprint_supported(
                        canonical["position"], repaired_yaw, width, depth, height, base_origin=base_origin):
                    raise ValueError("Wall placement is not on an authored wall surface")
            if canonical != raw_transform:
                placement.transform_json = _dump(canonical)
                placement.snap_anchor = "wall"
                repaired_wall_ids.append(placement.instance_id)
        except ValueError:
            # A malformed legacy wall item cannot be placed safely. Keep the
            # owned instance, but return it to inventory so it no longer
            # blocks every later layout save.
            moved_ids.append(placement.instance_id)
            db.delete(placement)
    # SessionLocal deliberately disables autoflush.  Flush the removals before
    # validating the surviving layout, otherwise deleted legacy wall rows are
    # still returned by this query and can make migration fail in a loop.
    db.flush()
    remaining = db.query(TCGRoomPlacement).filter_by(layout_id=1).order_by(TCGRoomPlacement.id).all()
    if remaining:
        normalized = _validate_placements(db, [_placement_dict(row) for row in remaining])
        normalized_by_id = {int(item["instance_id"]): item["transform"] for item in normalized}
        for placement in remaining:
            transform = normalized_by_id.get(placement.instance_id)
            if not transform or not transform.get("support_host_instance_id"):
                continue
            old_transform = _load(placement.transform_json, {})
            if old_transform.get("support_host_instance_id") == transform["support_host_instance_id"] and \
                    old_transform.get("support_slot") == transform.get("support_slot"):
                continue
            placement.transform_json = _dump(transform)
            nested_support_ids.append(placement.instance_id)
    counts = {}
    for instance in db.query(TCGDisplayItemInstance).all():
        key = (instance.definition_id, instance.variant_key)
        counts[key] = counts.get(key, 0) + 1
    # Older aggregate ownership can predate individual identities. Materialize
    # one stable instance for every paid-for unit before retiring the aggregate
    # as an authority.
    for owned in db.query(TCGOwnedDisplayItem).order_by(TCGOwnedDisplayItem.id).all():
        key = (owned.definition_id, owned.variant_key)
        missing = max(0, int(owned.quantity or 0) - counts.get(key, 0))
        for ordinal in range(missing):
            db.add(TCGDisplayItemInstance(
                definition_id=owned.definition_id, variant_key=owned.variant_key,
                source_type="legacy_inventory", source_id=f"{owned.id}:{counts.get(key, 0) + ordinal + 1}",
            ))
        counts[key] = counts.get(key, 0) + missing
    for (definition_id, variant_key), quantity in counts.items():
        owned = db.query(TCGOwnedDisplayItem).filter_by(
            definition_id=definition_id, variant_key=variant_key,
        ).first()
        if not owned:
            owned = TCGOwnedDisplayItem(definition_id=definition_id, variant_key=variant_key, quantity=quantity)
            db.add(owned)
        else:
            owned.quantity = max(owned.quantity, quantity)
    layout = _layout(db)
    layout.undo_json = "[]"
    layout.redo_json = "[]"
    if moved_ids or repaired_wall_ids or nested_support_ids:
        layout.revision += 1
    report = {"version": FURNITURE_MIGRATION_VERSION, "moved_to_inventory": sorted(set(moved_ids)),
              "repaired_wall_placements": sorted(set(repaired_wall_ids)),
              "nested_support_placements": sorted(set(nested_support_ids)),
              "preserved_instances": len(set(moved_ids))}
    db.merge(TCGRoomFurnitureMigration(id=1, version=FURNITURE_MIGRATION_VERSION, report_json=_dump(report)))
    db.flush()
    return report


def sync_legacy_workshop_item(db: Session, legacy: TCGWorkshopUnlock) -> None:
    seed_display_catalog(db)
    definition = db.query(TCGDisplayItemDefinition).filter_by(code=f"workshop-{legacy.item_code}").one()
    owned = db.query(TCGOwnedDisplayItem).filter_by(definition_id=definition.id, variant_key="default").first()
    if not owned:
        owned = TCGOwnedDisplayItem(definition_id=definition.id, variant_key="default", quantity=0)
        db.add(owned)
    if owned.quantity < 1:
        owned.quantity = 1
        db.add(TCGDisplayItemInstance(
            definition_id=definition.id, variant_key="default",
            source_type="legacy_workshop", source_id=str(legacy.id),
        ))
    db.flush()


def buy_display_item(db: Session, definition_id: int, variant_key: str = "default", request_key: str | None = None) -> dict:
    seed_display_catalog(db)
    definition = db.get(TCGDisplayItemDefinition, definition_id)
    variants = _load(definition.variants_json, []) if definition else []
    if not _is_manual_furniture(definition):
        raise ValueError("Display item is unavailable")
    if variants and variant_key not in variants:
        raise ValueError("Unknown display item variant")
    if request_key:
        request_key = str(request_key).strip()
        if not request_key or len(request_key) > 96:
            raise ValueError("Invalid furniture purchase request key")
        existing = db.query(TCGDisplayItemInstance).filter_by(
            source_type="furniture_purchase", source_id=request_key,
        ).first()
        if existing:
            if existing.definition_id != definition.id or existing.variant_key != variant_key:
                raise ValueError("Furniture purchase request key was already used")
            return {"instance_id": existing.id, "definition_id": definition.id, "variant_key": variant_key,
                    "status": "inventory", "currency": definition.currency, "charged": 0, "idempotent": True}
    if definition.currency == "credits":
        wallet = db.query(UserProfile).first()
        if not wallet or (wallet.vault_credits or 0) < definition.unit_cost:
            raise ValueError(f"Need {definition.unit_cost} Vault Credits")
        wallet.vault_credits -= definition.unit_cost
    elif definition.currency == "shards":
        wallet = db.query(CraftingMaterials).first()
        if not wallet or (wallet.shards or 0) < definition.unit_cost:
            raise ValueError(f"Need {definition.unit_cost} Shards")
        wallet.shards -= definition.unit_cost
    owned = db.query(TCGOwnedDisplayItem).filter_by(definition_id=definition.id, variant_key=variant_key).first()
    if not owned:
        owned = TCGOwnedDisplayItem(definition_id=definition.id, variant_key=variant_key, quantity=0)
        db.add(owned)
    owned.quantity += 1
    instance = TCGDisplayItemInstance(
        definition_id=definition.id, variant_key=variant_key,
        source_type="furniture_purchase" if request_key else "purchase",
        source_id=request_key or definition.code,
    )
    db.add(instance); db.flush()
    result = {"instance_id": instance.id, "definition_id": definition.id, "variant_key": variant_key,
              "status": "inventory", "currency": definition.currency, "charged": definition.unit_cost,
              "idempotent": False}
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        if not request_key:
            raise
        existing = db.query(TCGDisplayItemInstance).filter_by(
            source_type="furniture_purchase", source_id=request_key,
        ).one_or_none()
        if not existing or existing.definition_id != definition.id or existing.variant_key != variant_key:
            raise ValueError("Furniture purchase request key was already used")
        return {"instance_id": existing.id, "definition_id": definition.id, "variant_key": variant_key,
                "status": "inventory", "currency": definition.currency, "charged": 0, "idempotent": True}
    return result


def furniture_inventory(db: Session) -> dict:
    seed_display_catalog(db)
    migration = reconcile_sparse_furniture(db)
    db.commit()
    placements = {row.instance_id: row for row in db.query(TCGRoomPlacement).filter_by(layout_id=1).all()}
    definitions = db.query(TCGDisplayItemDefinition).filter_by(
        active=True, placeable=True, permanent_fixture=False,
    ).filter(TCGDisplayItemDefinition.asset_id.in_(MANUAL_ASSET_IDS)).order_by(
        TCGDisplayItemDefinition.id,
    ).limit(100).all()
    definition_ids = {row.id for row in definitions}
    instances = db.query(TCGDisplayItemInstance).filter(
        TCGDisplayItemInstance.definition_id.in_(definition_ids)
    ).order_by(TCGDisplayItemInstance.id).all() if definition_ids else []
    return {
        "revision": db.get(TCGRoomLayout, 1).revision,
        "room_bounds": authored_room_bounds(),
        "permanent_fixtures": list(PERMANENT_FIXTURES),
        "catalog": [_definition_dict(row) for row in definitions],
        "owned_instances": [_instance_dict(row, placements.get(row.id)) for row in instances],
        "migration": migration,
    }


def _definition_dict(row: TCGDisplayItemDefinition) -> dict:
    return {"id": row.id, "code": row.code, "name": row.name, "type": row.item_type,
            "asset_id": row.asset_id, "currency": row.currency, "unit_cost": row.unit_cost,
            "variants": _load(row.variants_json, []), "placement_kind": row.placement_kind,
            "footprint": _load(row.footprint_json, {}), "placeable": row.placeable}


def _instance_dict(row: TCGDisplayItemInstance, placement: TCGRoomPlacement | None) -> dict:
    return {"id": row.id, "definition_id": row.definition_id, "variant_key": row.variant_key,
            "source_type": row.source_type, "source_id": row.source_id,
            "status": "placed" if placement else "inventory",
            "placement": _placement_dict(placement) if placement else None}


def _mutate_furniture(db: Session, instance_id: int, expected_revision: int, action: str,
                      transform: dict | None = None, snap_anchor: str | None = None) -> dict:
    reconcile_sparse_furniture(db)
    layout = _layout(db)
    state = _snapshot(db, layout)
    index = next((i for i, item in enumerate(state["placements"])
                  if int(item["instance_id"]) == int(instance_id)), None)
    instance = db.get(TCGDisplayItemInstance, instance_id)
    definition = db.get(TCGDisplayItemDefinition, instance.definition_id) if instance else None
    if not instance or not _is_manual_furniture(definition):
        raise ValueError("Furniture instance is unavailable")
    if action == "place":
        if index is not None:
            raise ValueError("Furniture is already placed")
        state["placements"].append({"instance_id": instance.id, "transform": transform,
                                    "snap_anchor": snap_anchor, "placement_state": "placed"})
    elif action in {"move", "rotate"}:
        if index is None:
            raise ValueError("Furniture must be placed first")
        current = state["placements"][index]
        if action == "move":
            incoming = dict(transform or {})
            if "content" not in incoming:
                old = current.get("transform") or {}
                if isinstance(old, dict) and old.get("content"):
                    incoming["content"] = old["content"]
            current["transform"] = incoming
            current["snap_anchor"] = snap_anchor
        else:
            if not isinstance(transform, dict) or set(transform) != {"x", "y", "z"}:
                raise ValueError("Rotation requires x, y, and z")
            current_transform = current.get("transform") or {}
            current_transform["rotation"] = transform
            current["transform"] = current_transform
    elif action == "return":
        if index is None:
            raise ValueError("Furniture is already in inventory")
        state["placements"].pop(index)
        # A shelf cannot leave its nested display stands behind in world
        # space. Return those child furniture instances to inventory with it.
        state["placements"] = [
            item for item in state["placements"]
            if (item.get("transform") or {}).get("support_host_instance_id") != instance.id
        ]
    else:
        raise ValueError("Unknown furniture placement action")
    result = save_room(db, {"expected_revision": expected_revision, **state})
    current_placement = next((row for row in result["placements"] if row["instance_id"] == instance.id), None)
    return {"revision": result["revision"], "instance": _instance_dict(instance,
            db.query(TCGRoomPlacement).filter_by(layout_id=layout.id, instance_id=instance.id).first()),
            "placement": current_placement}


def place_furniture(db: Session, instance_id: int, expected_revision: int, transform: dict, snap_anchor: str | None = None) -> dict:
    return _mutate_furniture(db, instance_id, expected_revision, "place", transform, snap_anchor)


def move_furniture(db: Session, instance_id: int, expected_revision: int, transform: dict, snap_anchor: str | None = None) -> dict:
    return _mutate_furniture(db, instance_id, expected_revision, "move", transform, snap_anchor)


def rotate_furniture(db: Session, instance_id: int, expected_revision: int, rotation: dict) -> dict:
    return _mutate_furniture(db, instance_id, expected_revision, "rotate", rotation)


def return_furniture(db: Session, instance_id: int, expected_revision: int) -> dict:
    return _mutate_furniture(db, instance_id, expected_revision, "return")


def assign_display_copy(db: Session, instance_id: int, copy_id: int | None, slot_key: str = "primary") -> dict:
    instance = db.get(TCGDisplayItemInstance, instance_id)
    definition = db.get(TCGDisplayItemDefinition, instance.definition_id) if instance else None
    if not instance or not definition or definition.item_type != "display_stand" or definition.asset_id == "poster_frame":
        raise ValueError("Only card stands can hold cards")
    assignment = db.query(TCGDisplayAssignment).filter_by(display_instance_id=instance_id, slot_key=slot_key).first()
    if assignment:
        old = db.get(TCGPhysicalCardCopy, assignment.physical_copy_id)
        if old:
            move_copy(db, old.id, "unorganized_pile")
        db.delete(assignment); db.flush()
    if copy_id is not None:
        move_copy(db, copy_id, definition.item_type, location_ref=str(instance_id))
        assignment = TCGDisplayAssignment(display_instance_id=instance_id, physical_copy_id=copy_id, slot_key=slot_key)
        db.add(assignment)
    db.commit()
    return {"instance_id": instance_id, "copy_id": copy_id, "slot_key": slot_key}


def _product_snapshot(db: Session, product: TCGPackProduct) -> dict:
    from services.tcg_v2 import pack_dict
    from models import TCGRelease
    return pack_dict(product, db.get(TCGRelease, product.release_id) if product.release_id else None)


def _pack_contents_seed(order_seed: str, line_index: int, pack_index: int) -> str:
    return hashlib.sha256(f"{order_seed}:{line_index}:{pack_index}".encode("utf-8")).hexdigest()


def place_order(db: Session, lines: list[dict], *, delivery_delay_seconds: int = DEFAULT_DELAY_SECONDS) -> dict:
    from services.tcg_v2 import _eligible_pack_entries, seed_pack_products
    seed_pack_products(db)
    delay = int(delivery_delay_seconds)
    if delay < 3 or delay > 8:
        raise ValueError("Booster pack delivery delay must be between 3 and 8 seconds")
    if not lines or len(lines) > 10:
        raise ValueError("An order requires 1 to 10 product lines")
    snapshots, total = [], 0
    for values in lines:
        product = db.get(TCGPackProduct, int(values["product_id"]))
        quantity = int(values.get("quantity", 1))
        if not product or not product.active or not product.purchasable or quantity < 1 or quantity > 10:
            raise ValueError("Pack product is unavailable or quantity is invalid")
        simulation = _load(product.simulation_report, {})
        if not simulation.get("approved"):
            raise ValueError("This pack has not passed odds simulation")
        snapshot = _product_snapshot(db, product)
        eligible = _eligible_pack_entries(db, product, values.get("selected_release_id"))
        if not eligible:
            raise ValueError("The pack's persisted eligible pool is empty")
        # Freeze a representative face image with the purchase.  The release
        # artwork can be a dynamic collage, but the sealed physical pack needs
        # one durable, real Vault image to carry into the room.
        # Freeze a stable, product-specific set of real source images.  A
        # single representative image made every physical pack in an order
        # look identical; retaining the eligible pool's distinct source art
        # lets each sealed pack carry its own deterministic face.
        preview_ids = []
        for entry in eligible:
            image_id = getattr(entry.card, "source_image_id", None)
            if image_id and image_id not in preview_ids:
                preview_ids.append(int(image_id))
        preview_image_id = preview_ids[0] if preview_ids else None
        if preview_image_id:
            snapshot["snapshot_art_url"] = f"/api/images/{int(preview_image_id)}/file"
            snapshot["snapshot_art_image_id"] = int(preview_image_id)
            snapshot["snapshot_art_urls"] = [f"/api/images/{image_id}/file" for image_id in preview_ids]
            snapshot["snapshot_art_image_ids"] = preview_ids
        snapshot["eligible_entry_ids"] = [entry.id for entry in eligible]
        snapshot["owned_card_ids"] = [row[0] for row in db.query(CardInventory.card_id).filter(CardInventory.quantity > 0).order_by(CardInventory.card_id).all()]
        unit_price = int(snapshot.get("price") or 0)
        total += unit_price * quantity
        snapshots.append((product, quantity, values.get("selected_release_id"), unit_price, snapshot))
    profile = db.query(UserProfile).first()
    if not profile or total < 0 or (profile.vault_credits or 0) < total:
        raise ValueError(f"Need {total} Vault Credits")
    now, ready = datetime.utcnow(), datetime.utcnow() + timedelta(seconds=delay)
    order_seed = secrets.token_hex(32)
    profile.vault_credits -= total
    order = TCGOnlineOrder(status="mailed", total_price=total, delivery_delay_seconds=delay, order_seed=order_seed, contents_json=_dump([
        {"product_id": p.id, "quantity": q, "selected_release_id": release_id,
         "unit_price": price, "product": snapshot}
        for p, q, release_id, price, snapshot in snapshots
    ]), ordered_at=now, ready_at=ready)
    db.add(order); db.flush()
    parcel = TCGParcel(order_id=order.id, status="mailed", ready_at=ready)
    db.add(parcel); db.flush()
    for line_index, (product, quantity, release_id, price, snapshot) in enumerate(snapshots):
        line = TCGOnlineOrderLine(
            order_id=order.id, product_id=product.id, selected_release_id=release_id,
            quantity=quantity, unit_price=price, product_snapshot_json=_dump(snapshot),
        )
        db.add(line); db.flush()
        for index in range(quantity):
            db.add(TCGParcelPack(
                parcel_id=parcel.id, line_id=line.id, pack_index=index,
                contents_seed=_pack_contents_seed(order_seed, line_index, index),
            ))
    db.commit()
    return parcel_status(db, parcel.id)


def _refresh_ready(db: Session, parcel: TCGParcel) -> None:
    if parcel.status == "mailed" and datetime.utcnow() >= parcel.ready_at:
        parcel.status = "ready"
        order = db.get(TCGOnlineOrder, parcel.order_id)
        if order:
            order.status = "ready"


def parcel_status(db: Session, parcel_id: int) -> dict:
    parcel = db.get(TCGParcel, parcel_id)
    if not parcel:
        raise ValueError("Booster pack delivery not found")
    _refresh_ready(db, parcel)
    db.commit()
    order = db.get(TCGOnlineOrder, parcel.order_id)
    contents = _load(order.contents_json, [])
    # Older pending orders predate the per-product snapshot list.  Backfill
    # their response from the frozen eligible entry ids (without changing the
    # order row) so each product still gets real, stable face art.
    lines = db.query(TCGOnlineOrderLine).filter_by(order_id=order.id).all()
    line_by_product = {line.product_id: line for line in lines}
    for item in contents:
        product = item.get("product") or {}
        if product.get("snapshot_art_urls"):
            continue
        line = line_by_product.get(item.get("product_id"))
        if not line:
            continue
        # Use only the immutable entry ids captured at purchase time.  Do not
        # rebuild the current eligible pool here: bootstrap may call this for
        # many historical deliveries and must remain cheap and deterministic.
        frozen_ids = product.get("eligible_entry_ids") or []
        if not frozen_ids:
            continue
        try:
            frozen_ids = [int(value) for value in frozen_ids[:256]]
        except (TypeError, ValueError):
            continue
        entries = db.query(TCGChecklistEntry).filter(TCGChecklistEntry.id.in_(frozen_ids)).all()
        image_ids = []
        for entry in entries:
            image_id = getattr(entry.card, "source_image_id", None)
            if image_id and image_id not in image_ids:
                image_ids.append(int(image_id))
        if image_ids:
            product["snapshot_art_urls"] = [f"/api/images/{image_id}/file" for image_id in image_ids]
            product["snapshot_art_image_ids"] = image_ids
            product["snapshot_art_url"] = product["snapshot_art_urls"][0]
        item["product"] = product
    return {
        "id": parcel.id, "order_id": parcel.order_id, "status": parcel.status,
        "ready_at": parcel.ready_at, "collected_at": parcel.collected_at,
        "opened_at": parcel.opened_at, "total_price": order.total_price,
        "delivery_delay_seconds": order.delivery_delay_seconds,
        "placement": _load(parcel.placement_json, {}),
        "contents": contents, "results": _load(parcel.result_json, []),
    }


def reconcile_parcel_inventory(db: Session) -> dict:
    """Move the retired placed-parcel state into the persistent room inventory.

    Sealed pack rows and their frozen seeds belong to the parcel, so changing the
    parcel's location state cannot alter or reroll its contents.
    """
    migrated = []
    rows = db.query(TCGParcel).filter_by(status="placed").order_by(TCGParcel.id).all()
    for parcel in rows:
        parcel.status = "collected"
        parcel.placement_json = "{}"
        order = db.get(TCGOnlineOrder, parcel.order_id)
        if order and order.status == "placed":
            order.status = "collected"
        migrated.append(parcel.id)
    if migrated:
        db.commit()
    return {"migrated_parcel_ids": migrated}


def room_inventory(db: Session) -> dict:
    """Return the room's owned, actionable inventory without granting anything."""
    from services.tcg_v2 import list_packs

    parcel_migration = reconcile_parcel_inventory(db)
    furniture = furniture_inventory(db)
    parcels = db.query(TCGParcel).filter_by(status="collected").order_by(TCGParcel.id.desc()).all()
    token_products = [row for row in list_packs(db) if int(row.get("tokens") or 0) > 0]
    furniture_rows = []
    definitions = {row["id"]: row for row in furniture["catalog"]}
    for instance in furniture["owned_instances"]:
        definition = definitions.get(instance["definition_id"])
        if not definition:
            continue
        furniture_rows.append({
            "instance_id": instance["id"], "definition_id": instance["definition_id"],
            "name": definition["name"], "asset_id": definition["asset_id"],
            "placement_kind": definition["placement_kind"], "footprint": definition["footprint"],
            "variant_key": instance["variant_key"], "status": instance["status"],
            "transform": (instance.get("placement") or {}).get("transform"),
        })
    parcel_rows = []
    for parcel in parcels:
        payload = parcel_status(db, parcel.id)
        pack_count = sum(int(line.get("quantity") or 0) for line in payload["contents"])
        parcel_rows.append({
            "parcel_id": parcel.id, "status": "collected", "pack_count": pack_count,
            "contents": payload["contents"], "collected_at": parcel.collected_at,
        })
    return {
        "furniture": furniture_rows,
        "parcels": parcel_rows,
        "pack_tokens": [{"product_id": row["id"], "token_count": row["tokens"], "product": row}
                        for row in token_products],
        "counts": {
            "furniture": len(furniture_rows), "parcels": len(parcel_rows),
            "pack_tokens": sum(int(row["tokens"]) for row in token_products),
        },
        "migration": parcel_migration,
    }


def collect_parcel(db: Session, parcel_id: int) -> dict:
    parcel = db.get(TCGParcel, parcel_id)
    if not parcel:
        raise ValueError("Booster pack delivery not found")
    _refresh_ready(db, parcel)
    if parcel.status != "ready":
        raise ValueError("Booster packs have not arrived yet")
    now = datetime.utcnow()
    parcel.status, parcel.collected_at = "collected", now
    order = db.get(TCGOnlineOrder, parcel.order_id)
    order.status, order.collected_at = "collected", now
    db.commit()
    return parcel_status(db, parcel.id)


def place_parcel(db: Session, parcel_id: int, placement: dict) -> dict:
    parcel = db.get(TCGParcel, parcel_id)
    if not parcel or parcel.status not in {"collected", "placed"}:
        raise ValueError("Booster packs must be collected before they can be placed")
    parcel.status = "placed"
    parcel.placement_json = _dump(placement or {})
    order = db.get(TCGOnlineOrder, parcel.order_id)
    order.status = "placed"
    db.commit()
    return parcel_status(db, parcel.id)


def open_parcel(db: Session, parcel_id: int) -> dict:
    from services.tcg_v2 import open_pack_product
    parcel = db.get(TCGParcel, parcel_id)
    if not parcel or parcel.status not in {"collected", "placed"}:
        raise ValueError("Booster packs must be collected before they can be opened")
    results = []
    persisted_results = []
    try:
        packs = db.query(TCGParcelPack).filter_by(parcel_id=parcel.id).order_by(TCGParcelPack.line_id, TCGParcelPack.pack_index).all()
        for pack in packs:
            if not pack.contents_seed:
                raise ValueError("Booster pack is missing its sealed contents seed")
            line = db.get(TCGOnlineOrderLine, pack.line_id)
            result = open_pack_product(
                db, line.product_id, selected_release_id=line.selected_release_id,
                prepaid=True, prepaid_price=line.unit_price, commit=False,
                product_snapshot=_load(line.product_snapshot_json, {}),
                seed_override=pack.contents_seed,
            )
            pack.opening_id = result["opening_id"]
            results.append({"opening_id": result["opening_id"], "product_id": line.product_id,
                            "cards": result["cards"]})
            persisted_results.append({"opening_id": result["opening_id"], "product_id": line.product_id,
                                      "cards": [card["id"] for card in result["cards"]]})
        now = datetime.utcnow()
        parcel.status, parcel.opened_at, parcel.result_json = "opened", now, _dump(persisted_results)
        order = db.get(TCGOnlineOrder, parcel.order_id)
        order.status, order.opened_at = "opened", now
        db.commit()
        if results:
            from services.gamification import notify_action
            notify_action(db, "pack_opened", count=len(results), override_amount=75 * len(results))
        payload = parcel_status(db, parcel.id)
        # Keep the database record compact, but return the already-resolved
        # card payload to the caller. The inventory UI can reveal immediately
        # without a second round trip for every card in the opened pack.
        payload["results"] = results
        return payload
    except Exception:
        db.rollback()
        raise


def room_bootstrap(db: Session) -> dict:
    seed_display_catalog(db)
    _layout(db)
    reconcile_sparse_furniture(db)
    reconcile_parcel_inventory(db)
    db.commit()
    definitions = db.query(TCGDisplayItemDefinition).filter_by(
        active=True, placeable=True, permanent_fixture=False,
    ).filter(TCGDisplayItemDefinition.asset_id.in_(MANUAL_ASSET_IDS)).order_by(
        TCGDisplayItemDefinition.id,
    ).limit(100).all()
    definition_ids = [row.id for row in definitions]
    instances = db.query(TCGDisplayItemInstance).filter(
        TCGDisplayItemInstance.definition_id.in_(definition_ids)
    ).order_by(TCGDisplayItemInstance.id).limit(MAX_PLACEMENTS).all() if definition_ids else []
    placements = {row.instance_id: row for row in db.query(TCGRoomPlacement).filter_by(layout_id=1).all()}
    instance_ids = [row.id for row in instances]
    assignments = db.query(TCGDisplayAssignment).filter(
        TCGDisplayAssignment.display_instance_id.in_(instance_ids)
    ).order_by(TCGDisplayAssignment.id).limit(MAX_PLACEMENTS).all() if instance_ids else []
    parcels = db.query(TCGParcel).filter(TCGParcel.status != "opened").order_by(TCGParcel.id.desc()).limit(20).all()
    return {
        "room": room_state(db),
        "catalog": [_definition_dict(row) for row in definitions],
        "owned_instances": [_instance_dict(row, placements.get(row.id)) for row in instances],
        "permanent_fixtures": list(PERMANENT_FIXTURES),
        "room_bounds": authored_room_bounds(),
        "assignments": [{"id": row.id, "display_instance_id": row.display_instance_id,
                         "physical_copy_id": row.physical_copy_id, "slot_key": row.slot_key} for row in assignments],
        "parcels": [parcel_status(db, row.id) for row in parcels],
        "limits": {"placements": MAX_PLACEMENTS, "catalog": 100, "parcels": 20},
    }


def _room_card_readiness(card: dict) -> tuple[bool, str | None]:
    """Enforce the room's stricter no-flat-premium-card contract."""
    rarity = str(card.get("rarity_class") or "C").upper()
    if rarity == "C":
        return bool(card.get("image_url")), None if card.get("image_url") else "Artwork is still preparing"
    visual_key = {
        "image": "scene_visual", "variant": "cosplay_visual",
        "hof": "hof_visual", "hall-of-fame": "hof_visual",
    }.get(str(card.get("card_type") or "").lower(), f"{str(card.get('card_type') or '').lower()}_visual")
    visual = card.get(visual_key) or {}
    if not card.get("mask_url") or (visual.get("visual_mode") or card.get("mask_visual_mode")) != "layered":
        return False, "Packed foil mask is still preparing"
    if rarity == "UR" and card.get("card_type") != "gallery" and not card.get("foil_map_url"):
        return False, "Foil surface map is still preparing"
    return True, None


def visible_room_cards(db: Session) -> dict:
    """Return only the bounded physical subset that the room is allowed to render."""
    ensure_reconciled(db)
    assignments = db.query(TCGDisplayAssignment).order_by(TCGDisplayAssignment.id).limit(VISIBLE_PLACED_LIMIT).all()
    assigned_ids = [row.physical_copy_id for row in assignments]
    assigned = {
        row.id: row for row in db.query(TCGPhysicalCardCopy).filter(
            TCGPhysicalCardCopy.id.in_(assigned_ids)
        ).all()
    } if assigned_ids else {}
    pile = db.query(TCGPhysicalCardCopy).filter_by(location_kind="unorganized_pile").order_by(
        TCGPhysicalCardCopy.updated_at.desc(), TCGPhysicalCardCopy.id.desc()
    ).limit(VISIBLE_PILE_LIMIT).all()
    carried = db.query(TCGPhysicalCardCopy).filter_by(location_kind="carried").order_by(
        TCGPhysicalCardCopy.updated_at.desc(), TCGPhysicalCardCopy.id.desc()
    ).limit(VISIBLE_CARRIED_LIMIT).all()
    selected: list[tuple[TCGPhysicalCardCopy, str, int | None, str | None]] = []
    selected.extend((copy, "pile", None, None) for copy in pile)
    selected.extend((copy, "carried", None, None) for copy in carried)
    stand_instance_ids = set()
    if assignments:
        stand_instances = db.query(TCGDisplayItemInstance).filter(
            TCGDisplayItemInstance.id.in_({row.display_instance_id for row in assignments})
        ).all()
        stand_defs = {row.id: row for row in db.query(TCGDisplayItemDefinition).filter(
            TCGDisplayItemDefinition.id.in_({item.definition_id for item in stand_instances})
        ).all()} if stand_instances else {}
        for item in stand_instances:
            asset_id = (stand_defs.get(item.definition_id).asset_id if stand_defs.get(item.definition_id) else "") or ""
            if asset_id.startswith("card_display_stand") or asset_id.startswith("graded_card_stand"):
                stand_instance_ids.add(item.id)
    selected.extend((assigned[row.physical_copy_id], "display", row.display_instance_id, row.slot_key)
                    for row in assignments
                    if row.physical_copy_id in assigned
                    and row.display_instance_id in stand_instance_ids
                    and assigned[row.physical_copy_id].location_kind == "display_stand"
                    and assigned[row.physical_copy_id].location_ref == str(row.display_instance_id))
    result = []
    seen = set()
    for copy, surface, instance_id, slot_key in selected:
        if copy.id in seen:
            continue
        seen.add(copy.id)
        card = _card_to_dict(db, copy.card)
        ready, reason = _room_card_readiness(card)
        result.append({
            "copy": {
                "id": copy.id, "card_id": copy.card_id, "copy_ordinal": copy.copy_ordinal,
                "location_kind": copy.location_kind, "location_ref": copy.location_ref,
                "location_slot": copy.location_slot, "trade_locked": copy.trade_locked,
            },
            "surface": surface, "display_instance_id": instance_id, "slot_key": slot_key,
            "material_ready": ready, "preparation_reason": reason,
            "card": card,
            "preview": {
                "card_id": card.get("id"), "rarity": card.get("rarity_class"),
                "card_type": card.get("card_type"), "title": card.get("display_name") or card.get("gallery_name") or card.get("creator_name"),
            },
        })
    return {
        "items": result,
        "limits": {"pile": VISIBLE_PILE_LIMIT, "placed": VISIBLE_PLACED_LIMIT, "carried": VISIBLE_CARRIED_LIMIT},
        "counts": {
            "rendered": sum(1 for item in result if item["material_ready"]),
            "preparing": sum(1 for item in result if not item["material_ready"]),
        },
    }
