"""
TCG Economy Configuration
All rates and values are here — change one number to rebalance everything.
"""

# ── Pack shop ──────────────────────────────────────────────────────────────────
# 2026-07 economy rework: prices raised (credits were inflated by bulk file
# imports), and the two packs now have distinct identities instead of a strict
# better/worse tier:
#   Booster  — "your history": engagement-biased pulls + DOUBLE foil odds.
#   Premium  — "the high table": guaranteed Epic+, heavy Bond/HOF/collab rates.
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
    "bond":    "legendary",  # images with cum_count >= BOND_THRESHOLD — badges of devotion
    "variant": "legendary",
    "collab":  "epic",       # default; overridden per subtype in _pick_collab_card
    "hof":     "legendary",  # minted Hall of Fame mementos (top-3 minted celestial)
}

# Gallery rating (0-10 stars) at or above which a gallery card is born epic
GALLERY_EPIC_RATING = 9.0

# ── Drop pool weights (must sum to 1.0) ───────────────────────────────────────
DROP_WEIGHTS = {
    "image":   0.63,
    "gallery": 0.17,
    "creator": 0.07,
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

# ── Bond card thresholds ─────────────────────────────────────────────────────
BOND_MILESTONES = (5, 15, 25)
BOND_THRESHOLD = BOND_MILESTONES[0]

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
# Type multipliers applied on top of rarity base when a Bond or variant is sacrificed
FEED_CARD_TYPE_MULTIPLIERS = {
    "bond":    1.5,
    "variant": 2.0,
}

# Overflow CXP (above evolution threshold) converts to Vault Credits at this rate
# 1 credit per N overflow CXP, rounded down, minimum 1 credit per card with overflow
OVERFLOW_CXP_TO_CREDITS_RATE = 5

# ── Credit economy: the single source of truth for recurring income ───────────
# XP is intentionally kept separate. These values are tuned against the
# reference monthly release: an active collector can reach roughly 40 standard
# packs/month, while organizing remains worthwhile and file imports remain a
# zero-credit setup operation.
CREDIT_ECONOMY_VERSION = "credits-v2-fun-monthly-packs"
CREDIT_ACTION_REWARDS = {
    "session_logged": 40,
    "cum_logged": 25,
    "gallery_imported": 20,
    "gallery_added": 20,       # legacy alias
    "creator_added": 50,
    "daily_login": 25,
    "tag_added": 10,
    "image_rated": 8,
    "gallery_rated": 15,
    "wiki_import": 15,
    "gallery_curated": 25,
    "image_curated": 12,
    "pack_opened": 0,          # never refund the purchase through opening
    "card_dismantled": 0,      # shards/CXP are the dismantle rewards
    "file_added": 0,           # bulk import must never be an infinite faucet
}
CREDIT_ACTION_DAILY_CAPS = {"cum_logged": 10}
CREDIT_GALLERY_ASSIGN_DIVISOR = 10
CREDIT_GALLERY_ASSIGN_MAX = 40
CREDIT_DAILY_SPIN_EXPECTED = 19  # nearest integer to the 18.75-credit mean

# Quest credit rewards live here rather than being independently tuned in the
# gamification service. Existing active quest rows synchronize to these values
# without touching completed rows that have already paid out.
CREDIT_QUEST_REWARDS = {
    "open_the_vault": 20, "log_session": 80, "rate_images": 60,
    "tag_images": 60, "open_pack": 30, "drain_tank": 45,
    "rate_galleries": 50, "tag_spree": 120, "rate_spree": 100,
    "double_goon": 100, "curate_galleries": 100,
    "add_creator": 150, "import_gallery": 100, "session_streak": 350,
    "session_binge": 300, "gallery_marathon": 250, "pack_spree": 300,
    "tag_master_week": 600, "curate_week": 600,
    "century": 250, "five_hundred_imgs": 700, "millennium": 1500,
    "five_thousand_imgs": 4000, "ten_thousand_imgs": 10000,
    "five_creators": 150, "ten_creators": 350, "twenty_five_creators": 1000,
    "fifty_creators": 2500, "ten_sessions": 175, "fifty_sessions": 900,
    "hundred_sessions": 2500, "fifty_nuts": 350, "hundred_nuts": 1000,
    "five_hundred_nuts": 4000, "tag_master": 750, "tag_legend": 2500,
    "month_streak": 900, "two_month_streak": 2500, "fifty_cards": 350,
    "hundred_cards": 1000, "two_fifty_cards": 3000,
}

# Action → (XP reward, Vault Credits). XP remains the existing progression
# value; only the credit column is sourced from the table above.
ECONOMY = {
    "session_logged":     (25, CREDIT_ACTION_REWARDS["session_logged"]),
    "cum_logged":         (10, CREDIT_ACTION_REWARDS["cum_logged"]),
    "orgasm_logged":      (50, CREDIT_ACTION_REWARDS["cum_logged"]),
    "gallery_imported":   (15, CREDIT_ACTION_REWARDS["gallery_imported"]),
    "gallery_added":      (15, CREDIT_ACTION_REWARDS["gallery_added"]),
    "creator_added":      (50, CREDIT_ACTION_REWARDS["creator_added"]),
    "file_added":         (5,  CREDIT_ACTION_REWARDS["file_added"]),
    "daily_login":        (20, CREDIT_ACTION_REWARDS["daily_login"]),
    "quest_complete":     (0, 0),
    "achievement_unlock": (0, 0),
    "daily_spin":         (25, CREDIT_DAILY_SPIN_EXPECTED),
    "pack_opened":        (10, CREDIT_ACTION_REWARDS["pack_opened"]),
    "card_dismantled":    (DISMANTLE_XP, CREDIT_ACTION_REWARDS["card_dismantled"]),
    "tag_added":          (5, CREDIT_ACTION_REWARDS["tag_added"]),
    "image_rated":        (2, CREDIT_ACTION_REWARDS["image_rated"]),
    "gallery_rated":      (5, CREDIT_ACTION_REWARDS["gallery_rated"]),
    "gallery_curated":    (10, CREDIT_ACTION_REWARDS["gallery_curated"]),
    "image_curated":      (8, CREDIT_ACTION_REWARDS["image_curated"]),
    "wiki_import":        (15, CREDIT_ACTION_REWARDS["wiki_import"]),
}

# ── Pack types ────────────────────────────────────────────────────────────────
# Premium packs guarantee at least this rarity floor
PREMIUM_RARITY_FLOOR = "epic"
