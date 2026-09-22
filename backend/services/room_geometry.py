"""Authored Collection Room placement geometry.

The room is an apartment shell, not a rectangular box.  This module reads the
same base-room GLB the browser renders and exposes the real vertical wall
triangles and floor triangles to the placement validator.
"""

from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
import json
import math
from pathlib import Path
import struct
import sys


_GLB_JSON = 0x4E4F534A
_GLB_BIN = 0x004E4942
_COMPONENT_SIZE = {5121: 1, 5123: 2, 5125: 4, 5126: 4}
_COMPONENT_FORMAT = {5121: "B", 5123: "H", 5125: "I", 5126: "f"}
_TYPE_COMPONENTS = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}
_WALL_NORMAL_TOLERANCE = .94
_WALL_PLANE_TOLERANCE = .12
_POINT_TOLERANCE = .012


@dataclass(frozen=True)
class Triangle:
    a: tuple[float, float, float]
    b: tuple[float, float, float]
    c: tuple[float, float, float]
    normal: tuple[float, float, float]


@dataclass(frozen=True)
class RoomGeometry:
    walls: tuple[Triangle, ...]
    floors: tuple[Triangle, ...]


def _asset_path() -> Path:
    candidates = []
    bundle_root = getattr(sys, "_MEIPASS", None)
    if bundle_root:
        candidates.append(Path(bundle_root) / "frontend" / "dist" / "tcg-room" / "base_room.glb")
    repo_root = Path(__file__).resolve().parents[2]
    candidates.extend((
        repo_root / "frontend" / "public" / "tcg-room" / "base_room.glb",
        repo_root / "frontend" / "dist" / "tcg-room" / "base_room.glb",
    ))
    for candidate in candidates:
        if candidate.is_file():
            return candidate
    raise FileNotFoundError("The authored Collection Room base_room.glb is unavailable")


def _read_glb(path: Path) -> tuple[dict, bytes]:
    data = path.read_bytes()
    if len(data) < 20 or data[:4] != b"glTF":
        raise ValueError("The authored Collection Room asset is not a GLB")
    offset = 12
    document = None
    binary = None
    while offset + 8 <= len(data):
        length, chunk_type = struct.unpack_from("<II", data, offset)
        start = offset + 8
        chunk = data[start:start + length]
        if chunk_type == _GLB_JSON:
            document = json.loads(chunk.decode("utf-8"))
        elif chunk_type == _GLB_BIN:
            binary = bytes(chunk)
        offset = start + length
    if not document or binary is None:
        raise ValueError("The authored Collection Room GLB is missing JSON or binary data")
    return document, binary


def _matrix_multiply(left: tuple[float, ...], right: tuple[float, ...]) -> tuple[float, ...]:
    # glTF matrices are column-major, matching Three.js Matrix4.
    return tuple(
        sum(left[k * 4 + row] * right[column * 4 + k] for k in range(4))
        for column in range(4)
        for row in range(4)
    )


def _node_matrix(node: dict) -> tuple[float, ...]:
    if node.get("matrix"):
        return tuple(float(value) for value in node["matrix"])
    tx, ty, tz = (float(value) for value in node.get("translation", (0, 0, 0)))
    sx, sy, sz = (float(value) for value in node.get("scale", (1, 1, 1)))
    x, y, z, w = (float(value) for value in node.get("rotation", (0, 0, 0, 1)))
    x2, y2, z2 = x + x, y + y, z + z
    xx, xy, xz = x * x2, x * y2, x * z2
    yy, yz, zz = y * y2, y * z2, z * z2
    wx, wy, wz = w * x2, w * y2, w * z2
    return (
        (1 - (yy + zz)) * sx, (xy + wz) * sx, (xz - wy) * sx, 0,
        (xy - wz) * sy, (1 - (xx + zz)) * sy, (yz + wx) * sy, 0,
        (xz + wy) * sz, (yz - wx) * sz, (1 - (xx + yy)) * sz, 0,
        tx, ty, tz, 1,
    )


def _transform_point(matrix: tuple[float, ...], point: tuple[float, float, float]) -> tuple[float, float, float]:
    x, y, z = point
    return (
        matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12],
        matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13],
        matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14],
    )


def _read_accessor(document: dict, binary: bytes, accessor_index: int) -> list[tuple[float, ...]]:
    accessor = document["accessors"][accessor_index]
    view = document["bufferViews"][accessor["bufferView"]]
    component_size = _COMPONENT_SIZE[accessor["componentType"]]
    component_format = _COMPONENT_FORMAT[accessor["componentType"]]
    component_count = _TYPE_COMPONENTS[accessor["type"]]
    stride = int(view.get("byteStride") or component_size * component_count)
    start = int(view.get("byteOffset", 0)) + int(accessor.get("byteOffset", 0))
    values = []
    for index in range(int(accessor["count"])):
        row = []
        row_start = start + index * stride
        for component in range(component_count):
            offset = row_start + component * component_size
            row.append(struct.unpack_from("<" + component_format, binary, offset)[0])
        values.append(tuple(float(value) for value in row))
    return values


def _cross(left: tuple[float, float, float], right: tuple[float, float, float]) -> tuple[float, float, float]:
    return (
        left[1] * right[2] - left[2] * right[1],
        left[2] * right[0] - left[0] * right[2],
        left[0] * right[1] - left[1] * right[0],
    )


def _subtract(left: tuple[float, float, float], right: tuple[float, float, float]) -> tuple[float, float, float]:
    return tuple(left[index] - right[index] for index in range(3))


def _normalize(value: tuple[float, float, float]) -> tuple[float, float, float] | None:
    length = math.sqrt(sum(component * component for component in value))
    if length <= 1e-8:
        return None
    return tuple(component / length for component in value)


def _triangle_normal(a: tuple[float, float, float], b: tuple[float, float, float], c: tuple[float, float, float]):
    return _normalize(_cross(_subtract(b, a), _subtract(c, a)))


def _world_matrices(document: dict) -> list[tuple[float, ...]]:
    nodes = document.get("nodes", [])
    parents = {}
    for parent, node in enumerate(nodes):
        for child in node.get("children", []):
            parents[int(child)] = parent
    cache = {}

    def resolve(index: int) -> tuple[float, ...]:
        if index in cache:
            return cache[index]
        parent = parents.get(index)
        matrix = _node_matrix(nodes[index])
        if parent is not None:
            matrix = _matrix_multiply(resolve(parent), matrix)
        cache[index] = matrix
        return matrix

    return [resolve(index) for index in range(len(nodes))]


def _node_triangles(document: dict, binary: bytes, node_index: int, matrices: list[tuple[float, ...]]) -> list[Triangle]:
    node = document["nodes"][node_index]
    mesh = document.get("meshes", [])[node.get("mesh")] if node.get("mesh") is not None else None
    if not mesh:
        return []
    output = []
    matrix = matrices[node_index]
    for primitive in mesh.get("primitives", []):
        position_index = primitive.get("attributes", {}).get("POSITION")
        if position_index is None:
            continue
        positions = [_transform_point(matrix, point) for point in _read_accessor(document, binary, position_index)]
        if primitive.get("indices") is None:
            indices = list(range(len(positions)))
        else:
            indices = [int(row[0]) for row in _read_accessor(document, binary, primitive["indices"])]
        for offset in range(0, len(indices) - 2, 3):
            a, b, c = (positions[indices[offset + step]] for step in range(3))
            normal = _triangle_normal(a, b, c)
            if normal:
                output.append(Triangle(a, b, c, normal))
    return output


@lru_cache(maxsize=1)
def authored_room_geometry() -> RoomGeometry:
    document, binary = _read_glb(_asset_path())
    matrices = _world_matrices(document)
    walls, floors = [], []
    for index, node in enumerate(document.get("nodes", [])):
        name = str(node.get("name") or "")
        triangles = _node_triangles(document, binary, index, matrices)
        if name == "BAKE_Room":
            walls.extend(triangle for triangle in triangles if abs(triangle.normal[1]) < .5)
        elif name == "BAKE_Floor":
            floors.extend(triangle for triangle in triangles if triangle.normal[1] > .5)
    if not walls or not floors:
        raise ValueError("The authored Collection Room GLB has no usable wall or floor surfaces")
    return RoomGeometry(tuple(walls), tuple(floors))


def _dot(left: tuple[float, float, float], right: tuple[float, float, float]) -> float:
    return sum(left[index] * right[index] for index in range(3))


def _plane_distance(point: tuple[float, float, float], triangle: Triangle) -> float:
    return abs(_dot(triangle.normal, _subtract(point, triangle.a)))


def _project(point: tuple[float, float, float], normal: tuple[float, float, float]) -> tuple[float, float]:
    # Wall normals are horizontal. Drop the dominant horizontal coordinate.
    if abs(normal[0]) >= abs(normal[2]):
        return point[1], point[2]
    return point[0], point[1]


def _inside_triangle(point: tuple[float, float, float], triangle: Triangle) -> bool:
    p = _project(point, triangle.normal)
    a, b, c = (_project(vertex, triangle.normal) for vertex in (triangle.a, triangle.b, triangle.c))
    denominator = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
    if abs(denominator) <= 1e-9:
        return False
    alpha = ((b[1] - c[1]) * (p[0] - c[0]) + (c[0] - b[0]) * (p[1] - c[1])) / denominator
    beta = ((c[1] - a[1]) * (p[0] - c[0]) + (a[0] - c[0]) * (p[1] - c[1])) / denominator
    gamma = 1 - alpha - beta
    return min(alpha, beta, gamma) >= -_POINT_TOLERANCE


def _grid_points(center: tuple[float, float, float], tangent: tuple[float, float, float], normal: tuple[float, float, float], width: float, height: float):
    for row in range(5):
        vertical = (row / 4 - .5) * height
        for column in range(5):
            along = (column / 4 - .5) * width
            yield tuple(center[index] + tangent[index] * along + (0, 1, 0)[index] * vertical for index in range(3))


def _wall_match(position: tuple[float, float, float], rotation_y: float, width: float,
                depth: float, height: float, geometry: RoomGeometry, *, base_origin: bool = False):
    inward = (math.sin(rotation_y), 0.0, math.cos(rotation_y))
    tangent = (math.cos(rotation_y), 0.0, -math.sin(rotation_y))
    center_y = position[1] + height / 2 if base_origin else position[1]
    face_center = (
        position[0] - inward[0] * depth / 2,
        center_y,
        position[2] - inward[2] * depth / 2,
    )
    candidates = [triangle for triangle in geometry.walls
                  if _dot(triangle.normal, inward) >= _WALL_NORMAL_TOLERANCE
                  and _plane_distance(face_center, triangle) <= _WALL_PLANE_TOLERANCE]
    if not candidates:
        return None
    points = tuple(_grid_points(face_center, tangent, inward, width, height))
    if all(any(_plane_distance(point, triangle) <= _WALL_PLANE_TOLERANCE and _inside_triangle(point, triangle)
               for triangle in candidates) for point in points):
        return {"normal": inward, "tangent": tangent, "face_center": face_center}
    return None


def wall_footprint_supported(position: dict, rotation_y: float, width: float,
                             depth: float, height: float, *, base_origin: bool = False) -> bool:
    point = (float(position["x"]), float(position["y"]), float(position["z"]))
    return _wall_match(
        point, float(rotation_y), width, depth, height, authored_room_geometry(), base_origin=base_origin,
    ) is not None


def infer_wall_yaw(position: dict, width: float, depth: float, height: float, *, base_origin: bool = False) -> float | None:
    """Find the authored wall face nearest an old transform and face into it."""
    point = (float(position["x"]), float(position["y"]), float(position["z"]))
    geometry = authored_room_geometry()
    candidates = []
    for triangle in geometry.walls:
        normal = triangle.normal
        if abs(normal[0]) < .5 and abs(normal[2]) < .5:
            continue
        yaw = math.atan2(normal[0], normal[2])
        match = _wall_match(point, yaw, width, depth, height, geometry, base_origin=base_origin)
        if match:
            candidates.append((_plane_distance(match["face_center"], triangle), yaw))
    return min(candidates, key=lambda item: item[0])[1] if candidates else None


def _inside_floor(point: tuple[float, float, float], geometry: RoomGeometry) -> bool:
    px, pz = point[0], point[2]
    for triangle in geometry.floors:
        ax, az = triangle.a[0], triangle.a[2]
        bx, bz = triangle.b[0], triangle.b[2]
        cx, cz = triangle.c[0], triangle.c[2]
        denominator = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz)
        if abs(denominator) <= 1e-9:
            continue
        alpha = ((bz - cz) * (px - cx) + (cx - bx) * (pz - cz)) / denominator
        beta = ((cz - az) * (px - cx) + (ax - cx) * (pz - cz)) / denominator
        gamma = 1 - alpha - beta
        if min(alpha, beta, gamma) >= -_POINT_TOLERANCE:
            return True
    return False


def floor_footprint_supported(position: dict, rotation_y: float, width: float, depth: float) -> bool:
    center = (float(position["x"]), 0.0, float(position["z"]))
    cosine, sine = math.cos(rotation_y), math.sin(rotation_y)
    local_x = (cosine, 0.0, -sine)
    local_z = (sine, 0.0, cosine)
    geometry = authored_room_geometry()
    for row in range(5):
        z_offset = (row / 4 - .5) * depth
        for column in range(5):
            x_offset = (column / 4 - .5) * width
            point = tuple(center[index] + local_x[index] * x_offset + local_z[index] * z_offset for index in range(3))
            if not _inside_floor(point, geometry):
                return False
    return True


@lru_cache(maxsize=1)
def authored_room_bounds() -> dict:
    geometry = authored_room_geometry()
    points = [vertex for triangle in geometry.floors for vertex in (triangle.a, triangle.b, triangle.c)]
    return {
        "min_x": min(point[0] for point in points),
        "max_x": max(point[0] for point in points),
        "min_z": min(point[2] for point in points),
        "max_z": max(point[2] for point in points),
        "max_y": max(vertex[1] for triangle in geometry.walls for vertex in (triangle.a, triangle.b, triangle.c)),
    }
