"""
TCG Economy Configuration
All rates and values are here — change one number to rebalance everything.
"""

# ── Pack shop ──────────────────────────────────────────────────────────────────
# 2026-07 economy rework: prices raised (credits were inflated by bulk file
# imports), and the two packs now have distinct identities instead of a strict
# better/worse tier:
#   Booster  — "your history": engagement-biased pulls + DOUBLE foil odds.
#   Premium  — "the high table": guaranteed Epic+, heavy goon/HOF/collab rates.
PACK_COST         = 400   # Vault Credits per booster pack
PREMIUM_PACK_COST = 800   # Vault Credits per premium pack
PACK_SIZE         = 5     # Cards drawn per pack open

# ── Forge ──────────────────────────────────────────────────────────────────────
CATALYST_SHARD_COST = 400  # Shards needed to craft one Catalyst Token (kept scarce)

# ── Rarity tier ordering (low→high) ───────────────────────────────────────────
# 2026-07 rework: 4 tiers, fixed at birth — rarity NEVER changes after creation.
# Progression lives on two other axes: LEVEL (grown via CXP, 1-10) and FOIL
# (a premium visual variant rolled in packs or crafted with a catalyst).
RARITY_ORDER = ["common", "epic", "legendary", "celestial"]

# Legacy tier names (pre-rework) → new tier. Used to normalise any stray rows.
LEGACY_RARITY_MAP = {
    "uncommon": "common",
    "rare":     "epic",
    "relic":    "legendary",
}

# ── Baseline rarity per card type ─────────────────────────────────────────────
# Birth bonuses applied in the generator: 10★ galleries → epic; the single most
# gooned image → celestial; My Queen-tier creators → celestial; top-3 HOF → celestial.
BASELINE_RARITY = {
    "image":   "common",
    "gallery": "common",
    "creator": "epic",
    "goon":    "legendary",  # images with cum_count >= GOON_THRESHOLD — badges of honour
    "variant": "legendary",
    "collab":  "epic",       # default; overridden per subtype in _pick_collab_card
    "hof":     "legendary",  # minted Hall of Fame mementos (top-3 minted celestial)
}

# Gallery rating (0-10 stars) at or above which a gallery card is born epic
GALLERY_EPIC_RATING = 9.0

# ── Drop pool weights (must sum to 1.0) ───────────────────────────────────────
DROP_WEIGHTS = {
    "image":   0.58,
    "gallery": 0.17,
    "creator": 0.07,
    "goon":    0.05,
    "variant": 0.01,
    "collab":  0.05,
    "hof":     0.07,   # minted HOF mementos — deliberately generous pull odds
}

# ── Foil lottery (replaces the old tier-upgrade lottery) ──────────────────────
# A foil is the SAME card at the SAME rarity with a premium holo treatment and
# triple shard yield — the chase within every tier.
FOIL_CHANCE          = 0.10   # booster pack, per card — the booster is the foil hunter's pack
FOIL_CHANCE_PREMIUM  = 0.05   # premium pack, per card — premium chases rarity, not foils
FOIL_SHARD_MULT      = 3      # dismantle multiplier for foils

# ── Goon card threshold ───────────────────────────────────────────────────────
GOON_THRESHOLD = 10  # cum_count required on an image to qualify as goon card

# ── Variant cap ───────────────────────────────────────────────────────────────
VARIANT_CAP = 3  # hard maximum variants per creator×character pair

# ── Forge: variant crafting costs ─────────────────────────────────────────────
FORGE_VARIANT_SHARD_COST    = 500   # shards required to craft one variant card
FORGE_VARIANT_CATALYST_COST = 1     # catalyst tokens required

# ── Shard yield per rarity on dismantle (foils pay FOIL_SHARD_MULT×) ──────────
SHARD_YIELD = {
    "common":     10,
    "epic":       75,
    "legendary": 300,
    "celestial": 2500,
}

# ── Hearts earned per dismantle (epic and above only) ─────────────────────────
HEART_YIELD = {
    "common":    0,
    "epic":      2,
    "legendary": 3,
    "celestial": 5,
}

# ── Bond score boost per gifted heart ────────────────────────────────────────
HEART_BOND_BOOST = 500   # one heart = +500 bond score

# ── XP per dismantle (flat, regardless of rarity) ────────────────────────────
DISMANTLE_XP = 30

# ── CXP → Level economy ───────────────────────────────────────────────────────
# Rarity never changes; CXP grows a card's LEVEL (1-10) within its tier.
# level = 1 + cxp // LEVEL_CXP_STEP[rarity], capped at 10 (max at 9 × step).
# Visual breakpoints (frontend): frame at 3, holo boost at 5, full-art at 8,
# animated/prismatic at 10.
LEVEL_CXP_STEP = {
    "common":     100,
    "epic":       400,
    "legendary": 1_200,
    "celestial": 3_000,
}
MAX_CARD_LEVEL = 10

# CXP awarded when a session involving that card's creator/gallery is logged
CXP_PER_SESSION = 20

# CXP awarded when a duplicate of the same card is fed to it
CXP_FEED_YIELD = {
    "common":      40,
    "epic":       250,
    "legendary":  800,
    "celestial": 2_500,
}

# ── Rarity score ──────────────────────────────────────────────────────────────
# Composite score for ranking cards ("rarest in the game") and for gates like
# the Showcase wildcard slot: tier base × foil × level bonus. Tier gaps are wide
# enough that levels/foil matter without letting a common outrank a bare epic.
RARITY_SCORE_BASE = {
    "common":     10,
    "epic":       40,
    "legendary": 120,
    "celestial": 400,
}
RARITY_SCORE_FOIL_MULT   = 1.5
RARITY_SCORE_LEVEL_BONUS = 0.06   # ×(1 + bonus×(level-1)) → +54% at level 10

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
    # Credits removed from file imports (2026-07): bulk-importing a library is a
    # one-time setup event, not gameplay — 400k files once printed ~90k credits.
    # XP stays; credits must come from sessions, quests, and play.
    "file_added":         (5,    0),
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
PREMIUM_RARITY_FLOOR = "epic"
