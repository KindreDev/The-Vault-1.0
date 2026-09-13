"""No-key video-game character search backed by Wikimedia APIs."""

import asyncio
import re
from typing import Any
from urllib.parse import quote

import httpx


SEARCH_URL = "https://en.wikipedia.org/w/rest.php/v1/search/page"
SUMMARY_URL = "https://en.wikipedia.org/api/rest_v1/page/summary"
HEADERS = {"User-Agent": "TheVault/1.8 (local character metadata import)"}


class GameCharacterError(RuntimeError):
    pass


def _plain(value: str | None) -> str:
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", value or "")).strip()


def _looks_like_character(item: dict[str, Any]) -> bool:
    title = item.get("title") or ""
    if re.match(r"^(list of|characters of|category:)", title, re.I):
        return False
    text = f"{item.get('description', '')} {item.get('extract', '')[:500]}".lower()
    return any(phrase in text for phrase in (
        "fictional character", "video game character", "character in ",
        "character from ", "character introduced", "protagonist", "antagonist",
        "player character",
    ))


def _series(title: str, description: str, extract: str) -> str:
    parenthetical = re.search(r"\(([^()]*(?:game|blade|resident evil|nier|final fantasy)[^()]*)\)$", title, re.I)
    if parenthetical:
        return parenthetical.group(1).strip()

    text = f"{description}. {extract[:600]}"
    patterns = (
        r"character (?:in|from|of) (?:the )?(.+?)(?: video game)?(?: series| franchise|,|\.)",
        r"(?:protagonist|antagonist) of (?:the )?(?:\d{4} )?(?:[\w-]+ )*video game ([^.,]+)",
        r"from (?:the )?(?:\d{4} )?(?:[\w-]+ )*video game ([^.,]+)",
    )
    for pattern in patterns:
        match = re.search(pattern, text, re.I)
        if match:
            return match.group(1).strip(" '“”")[:120]
    return ""


def _normalise(item: dict[str, Any]) -> dict[str, Any]:
    title = _plain(item.get("title"))
    description = _plain(item.get("description"))
    about = _plain(item.get("extract"))
    display_name = re.sub(r"\s*\([^()]+\)$", "", title).strip() or title
    image_data = item.get("originalimage") or item.get("thumbnail") or {}
    image = image_data.get("source") or image_data.get("url")
    if image and image.startswith("//"):
        image = f"https:{image}"
    page_url = ((item.get("content_urls") or {}).get("desktop") or {}).get("page")
    if not page_url:
        page_url = f"https://en.wikipedia.org/wiki/{quote((item.get('key') or title).replace(' ', '_'))}"
    series = _series(title, description, about)
    result = {
        "provider": "game_wiki",
        "source_label": "Games / Wikipedia",
        "external_id": title,
        "name": display_name,
        "about": about[:1000],
        "image_url": image,
        "series": [series] if series else [],
        "url": page_url or "",
        "favorites": 0,
    }
    pronouns = about[:400].lower()
    if len(re.findall(r"\b(she|her)\b", pronouns)) >= 2:
        result["gender"] = "Female"
    elif len(re.findall(r"\b(he|him|his)\b", pronouns)) >= 2:
        result["gender"] = "Male"
    return result


async def _summary(client: httpx.AsyncClient, title: str) -> dict[str, Any] | None:
    try:
        response = await client.get(f"{SUMMARY_URL}/{quote(title.replace(' ', '_'), safe='')}")
        response.raise_for_status()
        payload = response.json()
        return payload if isinstance(payload, dict) else None
    except (httpx.HTTPError, ValueError):
        return None


async def search_characters(query: str, limit: int = 8) -> list[dict[str, Any]]:
    limit = max(1, min(limit, 12))
    try:
        async with httpx.AsyncClient(timeout=12.0, headers=HEADERS, follow_redirects=True) as client:
            response = await client.get(SEARCH_URL, params={
                "q": f"{query.strip()} video game character",
                "limit": min(20, limit * 2),
            })
            response.raise_for_status()
            pages = response.json().get("pages") or []
            candidates = [page for page in pages if _looks_like_character(page)][:limit]
            summaries = await asyncio.gather(*(_summary(client, page["title"]) for page in candidates))
    except (httpx.HTTPError, ValueError) as exc:
        raise GameCharacterError("Game character search failed") from exc

    matches = [
        _normalise(summary if summary and _looks_like_character(summary) else candidate)
        for candidate, summary in zip(candidates, summaries)
    ]
    needle = query.strip().casefold()
    matches.sort(key=lambda item: (
        0 if item["name"].casefold() == needle else 1,
        0 if item["name"].casefold().startswith(needle) else 1,
    ))
    return matches[:limit]


async def character_detail(title: str) -> dict[str, Any]:
    async with httpx.AsyncClient(timeout=12.0, headers=HEADERS, follow_redirects=True) as client:
        item = await _summary(client, title)
    if not item or not _looks_like_character(item):
        raise GameCharacterError("Game character was not found")
    return _normalise(item)
