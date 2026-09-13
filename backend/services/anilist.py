"""Small client for AniList's public character GraphQL API.

AniList is used for character import because the old Jikan/MAL proxy is
frequently unavailable or rate limited.  Keeping the provider adapter here
means the creator router only has to validate the request and return the
normalised character shape used by the form.
"""

import re
from typing import Any

import httpx


ANILIST_GRAPHQL_URL = "https://graphql.anilist.co"

_SEARCH_QUERY = """
query ($search: String!, $perPage: Int!) {
  Page(perPage: $perPage) {
    characters(search: $search, sort: FAVOURITES_DESC) {
      id
      name { full native }
      image { large }
      description(asHtml: false)
      gender
      age
      favourites
      siteUrl
      media(sort: POPULARITY_DESC, perPage: 5) {
        nodes { title { romaji english native } }
      }
    }
  }
}
"""

_DETAIL_QUERY = """
query ($id: Int!) {
  Character(id: $id) {
    id
    name { full native }
    image { large }
    description(asHtml: false)
    gender
    age
    favourites
    siteUrl
    media(sort: POPULARITY_DESC, perPage: 8) {
      nodes { title { romaji english native } }
    }
  }
}
"""


class AniListError(RuntimeError):
    """An expected upstream failure that can be shown as a 503 to the UI."""


def _parse_physical(text: str) -> dict[str, Any]:
    """Extract the optional physical fields commonly present in bios."""
    if not text:
        return {}
    out: dict[str, Any] = {}
    height = re.search(r"(?:height[:\s]*)?(\d{2,3})\s*cm\b", text, re.I)
    if height and 100 <= int(height.group(1)) <= 250:
        out["height_cm"] = int(height.group(1))
    age = re.search(r"\bage[:\s]+(\d{1,3})\b", text, re.I)
    if not age:
        age = re.search(r"\b(\d{1,3})[\s-]+years?[\s-]+old\b", text, re.I)
    if age and 1 <= int(age.group(1)) <= 120:
        out["age"] = int(age.group(1))
    return out


def _plain_description(value: str | None) -> str:
    text = re.sub(r"<[^>]+>", " ", value or "")
    return re.sub(r"\s+", " ", text).strip()


def _title(node: dict[str, Any]) -> str:
    title = node.get("title") or {}
    return title.get("english") or title.get("romaji") or title.get("native") or ""


def _normalise(item: dict[str, Any]) -> dict[str, Any]:
    name = item.get("name") or {}
    about = _plain_description(item.get("description"))
    result = {
        "provider": "anilist",
        "source_label": "AniList",
        "external_id": item.get("id"),
        "anilist_id": item.get("id"),
        "name": name.get("full") or "",
        "name_native": name.get("native") or "",
        "about": about[:1000],
        "image_url": (item.get("image") or {}).get("large"),
        "series": [_title(media) for media in (item.get("media") or {}).get("nodes", []) if _title(media)][:5],
        "url": item.get("siteUrl") or "",
        "favorites": item.get("favourites") or 0,
    }
    if item.get("gender"):
        result["gender"] = item["gender"].capitalize()
    if item.get("age"):
        age = str(item["age"])
        match = re.search(r"\d{1,3}", age)
        if match and 1 <= int(match.group()) <= 120:
            result["age"] = int(match.group())
    result.update(_parse_physical(about))
    return result


async def _request(query: str, variables: dict[str, Any]) -> dict[str, Any]:
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.post(
                ANILIST_GRAPHQL_URL,
                json={"query": query, "variables": variables},
                headers={"Accept": "application/json", "Content-Type": "application/json"},
            )
            response.raise_for_status()
            payload = response.json()
    except httpx.HTTPStatusError as exc:
        raise AniListError(f"AniList returned HTTP {exc.response.status_code}") from exc
    except (httpx.HTTPError, ValueError) as exc:
        raise AniListError("AniList request failed") from exc
    if not isinstance(payload, dict) or payload.get("errors"):
        raise AniListError("AniList returned a GraphQL error")
    return payload.get("data") or {}


async def search_characters(query: str, limit: int = 8) -> list[dict[str, Any]]:
    data = await _request(_SEARCH_QUERY, {"search": query.strip(), "perPage": max(1, min(limit, 20))})
    return [_normalise(item) for item in ((data.get("Page") or {}).get("characters") or [])]


async def character_detail(anilist_id: int) -> dict[str, Any]:
    data = await _request(_DETAIL_QUERY, {"id": anilist_id})
    item = data.get("Character")
    if not item:
        raise AniListError("Character was not found on AniList")
    return _normalise(item)
