"""Focused placement-boundary checks for authored Collection Room geometry."""

from types import SimpleNamespace

import pytest

from services import tcg_room


def _definition(kind):
    return SimpleNamespace(
        placement_kind=kind,
        footprint_json='{}',
    )


def _transform(x, y, z):
    return {
        "position": {"x": x, "y": y, "z": z},
        "rotation": {"x": 0, "y": 0, "z": 0},
    }


def test_wall_hit_on_pc_side_uses_authored_wall_envelope():
    result = tcg_room._canonical_transform(
        _transform(-5.02, 1.25, -3.58), _definition("wall")
    )

    assert result["position"] == {"x": -5.02, "y": 1.25, "z": -3.58}


def test_wall_item_still_requires_a_wall_attachment():
    with pytest.raises(ValueError, match="attached to a wall"):
        tcg_room._canonical_transform(_transform(0, 1.25, 0), _definition("wall"))


def test_floor_item_keeps_walkable_floor_boundary():
    with pytest.raises(ValueError, match="inside the room"):
        tcg_room._canonical_transform(_transform(-5.02, 0.17, -3.58), _definition("floor"))
