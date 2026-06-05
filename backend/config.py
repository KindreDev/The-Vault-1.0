"""
TCG Economy Configuration
All rates and values are here — change one number to rebalance everything.
"""

# ── Pack shop ──────────────────────────────────────────────────────────────────
PACK_COST    = 250   # Vault Credits per pack
PACK_SIZE    = 5     # Cards drawn per pack open

# ── Forge ──────────────────────────────────────────────────────────────────────
CATALYST_SHARD_COST = 150  # Shards needed to craft one Catalyst Token

# ── Rarity tier ordering (low→high) ───────────────────────────────────────────
RARITY_ORDER = ["common", "uncommon", "rare", "epic", "legendary", "relic", "celestial"]

# ── Baseline rarity per card type ─────────────────────────────────────────────
BASELINE_RARITY = {
    "image":   "common",
    "gallery": "uncommon",
    "creator": "rare",
    "goon":    "epic",      # images with cum_count >= GOON_THRESHOLD
    "variant": "legendary",
    "collab":  "rare",      # default; overridden per subtype in _pick_collab_card
}

# ── Drop pool weights (must sum to 1.0) ───────────────────────────────────────
DROP_WEIGHTS = {
    "image":   0.67,
    "gallery": 0.19,
    "creator": 0.07,
    "goon":    0.01,
    "variant": 0.01,
    "collab":  0.05,
}

# ── Upgrade lottery probabilities (applied per card after base pull) ──────────
UPGRADE_EPIC_CHANCE       = 0.03    # force +1 tier (capped at epic)
UPGRADE_LEGENDARY_CHANCE  = 0.01    # force legendary
UPGRADE_RELIC_CHANCE      = 0.005   # force relic (0.5%)
UPGRADE_CELESTIAL_CHANCE  = 0.001   # force celestial (0.1%) — rarest possible

# ── Goon card threshold ───────────────────────────────────────────────────────
GOON_THRESHOLD = 20  # cum_count required on an image to qualify as goon card

# ── Variant cap ───────────────────────────────────────────────────────────────
VARIANT_CAP = 3  # hard maximum variants per creator×character pair

# ── Forge: variant crafting costs ─────────────────────────────────────────────
FORGE_VARIANT_SHARD_COST    = 500   # shards required to craft one variant card
FORGE_VARIANT_CATALYST_COST = 1     # catalyst tokens required

# ── Shard yield per rarity on dismantle ───────────────────────────────────────
SHARD_YIELD = {
    "common":    5,
    "uncommon": 10,
    "rare":     25,
    "epic":     75,
    "legendary": 200,
    "relic":    1000,
    "celestial": 5000,
}

# ── Hearts earned per dismantle (rare and above only) ────────────────────────
HEART_YIELD = {
    "common":    0,
    "uncommon":  0,
    "rare":      1,
    "epic":      2,
    "legendary": 3,
    "relic":     5,
    "celestial": 5,
}

# ── Bond score boost per gifted heart ────────────────────────────────────────
HEART_BOND_BOOST = 500   # one heart = +500 bond score

# ── XP per dismantle (flat, regardless of rarity) ────────────────────────────
DISMANTLE_XP = 30

# ── CXP Economy ───────────────────────────────────────────────────────────────
# Cumulative CXP required to be eligible for shard-based evolution.
# Lower rarities are quick; celestial grind is real but not brutal.
CXP_EVOLVE_SHARD_COST = 50

CXP_THRESHOLDS = {
    "common":    100,
    "uncommon":  300,
    "rare":      800,
    "epic":      2_000,
    "legendary": 5_000,
    "relic":     12_000,
    "celestial": None,   # max tier, cannot evolve
}

# CXP awarded when a session involving that card's creator/gallery is logged
CXP_PER_SESSION = 20

# CXP awarded when a duplicate of the same card is fed to it
CXP_FEED_YIELD = {
    "common":     30,
    "uncommon":   75,
    "rare":       200,
    "epic":       500,
    "legendary":  1_200,
    "relic":      3_000,
    "celestial":  8_000,
}

# ── CXP: universal card feeding ───────────────────────────────────────────────
# Type multipliers applied on top of rarity base when a goon or variant is sacrificed
FEED_CARD_TYPE_MULTIPLIERS = {
    "goon":    1.5,
    "variant": 2.0,
}

# Overflow CXP (above evolution threshold) converts to Vault Credits at this rate
# 1 credit per N overflow CXP, rounded down, minimum 1 credit per card with overflow
OVERFLOW_CXP_TO_CREDITS_RATE = 5

# ── Economy: action → (xp_reward, vault_credits) ─────────────────────────────
ECONOMY = {
    "session_logged":     (25,  10),
    "orgasm_logged":      (50,  20),
    "gallery_added":      (15,   5),
    "creator_added":      (50,  15),
    "file_added":         (5,    2),
    "daily_login":        (20,  10),
    "quest_complete":     (0,   40),   # XP comes from quest itself
    "achievement_unlock": (0,   75),   # XP comes from achievement itself
    "pack_opened":        (10,   0),
    "card_dismantled":    (DISMANTLE_XP, 0),
    "tag_added":          (5,    1),
    "image_rated":        (2,    0),
    "wiki_import":        (15,   5),
    "tagging_mission":    (200, 50),
}

# ── Pack types ────────────────────────────────────────────────────────────────
# Premium packs guarantee at least this rarity floor
PREMIUM_RARITY_FLOOR = "rare"
