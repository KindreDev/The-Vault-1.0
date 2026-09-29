"""Shared rarity resolution for personally earned cards entering pack pools."""

PACK_RARITIES = ("C", "R", "SR", "UR", "SPR")
_PACK_RARITY_SET = frozenset(PACK_RARITIES)
_LEGACY_RARITY_TO_PACK = {
    "common": "C",
    "uncommon": "R",
    "epic": "R",
    "rare": "SR",
    "legendary": "SR",
    "relic": "UR",
    "celestial": "UR",
}


def earned_card_pack_rarity(card) -> str | None:
    """Resolve explicit print rarity, then legacy tier, then rarity class."""
    printed = str(card.print_rarity or "").strip().upper()
    if printed in _PACK_RARITY_SET:
        return printed
    if printed == "SSR":
        return "UR"

    legacy_rarity = card.rarity.value if hasattr(card.rarity, "value") else card.rarity
    mapped = _LEGACY_RARITY_TO_PACK.get(str(legacy_rarity or "").strip().lower())
    if mapped:
        return mapped

    rarity_class = str(card.rarity_class or "").strip().upper()
    if rarity_class in _PACK_RARITY_SET:
        return rarity_class
    if rarity_class == "SSR":
        return "UR"
    return None
