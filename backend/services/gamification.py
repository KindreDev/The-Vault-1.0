from sqlalchemy.orm import Session
from sqlalchemy.sql import func
from datetime import datetime, timedelta
from typing import Optional
import json
import random

from models import UserProfile, Quest, Achievement, XPEvent, QuestStatus, QuestType
from schemas import XPEventOut

# ── Level titles (1–100, every 5 levels) ─────────────────────────────────────
LEVEL_TITLES = [
    (1,   "Lurker"),               (6,   "Wanderer"),
    (11,  "Seeker"),               (16,  "Delver"),
    (21,  "Collector"),            (26,  "Acolyte"),
    (31,  "Devotee"),              (36,  "Archivist"),
    (41,  "Disciple"),             (46,  "Connoisseur"),
    (51,  "Curator"),              (56,  "Zealot"),
    (61,  "Degenerate"),           (66,  "Gooner"),
    (71,  "Sovereign"),            (76,  "Corruptor"),
    (81,  "Obsessed"),             (86,  "Legendary Collector"),
    (91,  "Transcendent Hoarder"), (96,  "God Emperor Of The Vault"),
]

def _xp_for_level(lvl: int) -> int:
    if lvl <= 1: return 0
    return sum(500 * i for i in range(1, lvl))

LEVELS = [(lvl, _xp_for_level(lvl), None) for lvl in range(1, 201)]
MAX_LEVEL = 100

def _get_title(level: int) -> str:
    title = LEVEL_TITLES[0][1]
    for threshold, t in LEVEL_TITLES:
        if level >= threshold:
            title = t
    return title


# ── XP reward table ───────────────────────────────────────────────────────────
XP_REWARDS = {
    "session_logged":      40,
    "image_rated":          3,
    "gallery_rated":        5,
    "creator_added":       75,
    "gallery_imported":    15,
    "tag_added":            5,
    "daily_login":         20,
    "quest_complete":       0,   # uses quest.xp_reward
    "achievement_unlock":   0,   # uses achievement.xp_reward
    "daily_spin":          25,
    "cum_logged":          10,
    # PLACEHOLDER RATE — pending the XP/credit economy rework. Awarded once per
    # edge event, not per image credited, so a 4-panel wall can't farm it.
    "edge_logged":          3,
    "tagging_mission":    300,
    "pack_opened":          5,
    "card_dismantled":     15,
    "gallery_assigned":     0,   # override_amount = image count; base unused
}


# ── Daily quest POOL (10 quests — 4 randomly selected each day) ───────────────
ALL_DAILY_QUESTS = [
    {"key": "open_the_vault",  "title": "Open the Vault",    "description": "Log in today",                      "xp_reward": 30,  "credit_reward": 10,  "target": 1,  "icon": "ti-box"},
    {"key": "log_session",     "title": "Goon session",       "description": "Log a gooning session",             "xp_reward": 80,  "credit_reward": 30,  "target": 1,  "icon": "ti-heart"},
    {"key": "rate_images",     "title": "Rate 5 images",      "description": "Give any image a rating",           "xp_reward": 55,  "credit_reward": 15,  "target": 5,  "icon": "ti-star"},
    {"key": "tag_images",      "title": "Tag 3 images",       "description": "Add tags to images",                "xp_reward": 45,  "credit_reward": 15,  "target": 3,  "icon": "ti-tag"},
    {"key": "open_pack",       "title": "Open a pack",        "description": "Open any card pack",                "xp_reward": 60,  "credit_reward": 20,  "target": 1,  "icon": "ti-cards"},
    {"key": "drain_tank",      "title": "Drain the tank",     "description": "Count an O today",                  "xp_reward": 50,  "credit_reward": 20,  "target": 1,  "icon": "ti-droplet"},
    {"key": "rate_galleries",  "title": "Gallery judge",      "description": "Rate 3 galleries",                  "xp_reward": 50,  "credit_reward": 15,  "target": 3,  "icon": "ti-photo"},
    {"key": "tag_spree",       "title": "Tag spree",          "description": "Add 10 tags in one day",            "xp_reward": 95,  "credit_reward": 35,  "target": 10, "icon": "ti-tags"},
    {"key": "rate_spree",      "title": "Rating spree",       "description": "Rate 10 images today",              "xp_reward": 75,  "credit_reward": 25,  "target": 10, "icon": "ti-star-filled"},
    {"key": "double_goon",     "title": "Double tap",         "description": "Count 2 Os today",                  "xp_reward": 95,  "credit_reward": 35,  "target": 2,  "icon": "ti-droplet-filled"},
]
DAILY_POOL_SIZE = 4


# ── Weekly quest POOL (8 quests — 4 randomly selected each week) ─────────────
ALL_WEEKLY_QUESTS = [
    {"key": "add_creator",      "title": "Add a creator",       "description": "Add any creator this week",         "xp_reward": 200,  "credit_reward": 75,  "target": 1,  "icon": "ti-user-plus"},
    {"key": "import_gallery",   "title": "Import a gallery",    "description": "Scan a new gallery folder",         "xp_reward": 250,  "credit_reward": 100, "target": 1,  "icon": "ti-photo"},
    {"key": "session_streak",   "title": "Session marathon",    "description": "Log 3 sessions this week",          "xp_reward": 400,  "credit_reward": 150, "target": 3,  "icon": "ti-flame"},
    {"key": "session_binge",    "title": "Session binge",       "description": "Log 5 sessions this week",           "xp_reward": 175,  "credit_reward": 60,  "target": 5,  "icon": "ti-heart"},
    {"key": "gallery_marathon", "title": "Gallery marathon",    "description": "Import 3 galleries this week",      "xp_reward": 550,  "credit_reward": 200, "target": 3,  "icon": "ti-folders"},
    {"key": "pack_spree",       "title": "Pack addict",         "description": "Open 5 packs this week",            "xp_reward": 350,  "credit_reward": 125, "target": 5,  "icon": "ti-cards"},
    {"key": "tag_master_week",  "title": "Weekly tagger",       "description": "Add 50 tags this week",             "xp_reward": 400,  "credit_reward": 150, "target": 50, "icon": "ti-tags"},
    {"key": "forge_week",       "title": "The Recycler",        "description": "Dismantle 10 cards this week",      "xp_reward": 400,  "credit_reward": 150, "target": 10, "icon": "ti-hammer"},
]
WEEKLY_POOL_SIZE = 4


# ── Boss quests (permanent, no expiry) ────────────────────────────────────────
BOSS_QUESTS = [
    # Image vault milestones
    {"key": "century",            "title": "Century",                "description": "Reach 100 images in the vault",        "xp_reward": 750,   "credit_reward": 250,   "target": 100,   "icon": "ti-photo"},
    {"key": "five_hundred_imgs",  "title": "The Hoarder",            "description": "Reach 500 images",                     "xp_reward": 2000,  "credit_reward": 700,   "target": 500,   "icon": "ti-stack"},
    {"key": "millennium",         "title": "The Archivist",          "description": "Reach 1,000 images",                   "xp_reward": 4000,  "credit_reward": 1500,  "target": 1000,  "icon": "ti-archive"},
    {"key": "five_thousand_imgs", "title": "Vault Lord",             "description": "Reach 5,000 images",                   "xp_reward": 10000, "credit_reward": 4000,  "target": 5000,  "icon": "ti-vault"},
    {"key": "ten_thousand_imgs",  "title": "God Emperor's Archive",  "description": "Reach 10,000 images",                  "xp_reward": 25000, "credit_reward": 10000, "target": 10000, "icon": "ti-crown"},
    # Creator milestones
    {"key": "five_creators",      "title": "Starting Roster",        "description": "Add 5 creators",                       "xp_reward": 500,   "credit_reward": 150,   "target": 5,     "icon": "ti-users"},
    {"key": "ten_creators",       "title": "The Collector",          "description": "Add 10 creators",                      "xp_reward": 1000,  "credit_reward": 350,   "target": 10,    "icon": "ti-users"},
    {"key": "twenty_five_creators","title": "Devoted Fan",           "description": "Add 25 creators",                      "xp_reward": 3000,  "credit_reward": 1000,  "target": 25,    "icon": "ti-heart"},
    {"key": "fifty_creators",     "title": "Roster Legend",          "description": "Add 50 creators",                      "xp_reward": 7000,  "credit_reward": 2500,  "target": 50,    "icon": "ti-trophy"},
    # Gooning milestones
    {"key": "ten_sessions",       "title": "Getting Hooked",         "description": "Log 10 goon sessions",                 "xp_reward": 500,   "credit_reward": 175,   "target": 10,    "icon": "ti-heart"},
    {"key": "fifty_sessions",     "title": "Dedicated Gooner",       "description": "Log 50 goon sessions",                 "xp_reward": 2500,  "credit_reward": 900,   "target": 50,    "icon": "ti-flame"},
    {"key": "hundred_sessions",   "title": "Century Gooner",         "description": "Log 100 goon sessions",                "xp_reward": 6000,  "credit_reward": 2500,  "target": 100,   "icon": "ti-flame"},
    {"key": "fifty_nuts",         "title": "Prolific Drainer",       "description": "Count 50 Os total",                    "xp_reward": 1000,  "credit_reward": 350,   "target": 50,    "icon": "ti-droplet"},
    {"key": "hundred_nuts",       "title": "Absolute Unit",          "description": "Count 100 Os total",                   "xp_reward": 3000,  "credit_reward": 1000,  "target": 100,   "icon": "ti-droplet-filled"},
    {"key": "five_hundred_nuts",  "title": "Legendary Drainer",      "description": "Count 500 Os total",                   "xp_reward": 10000, "credit_reward": 4000,  "target": 500,   "icon": "ti-flame"},
    # Tagging & metadata
    {"key": "tag_master",         "title": "Completionist",          "description": "Add 500 tags",                         "xp_reward": 2000,  "credit_reward": 750,   "target": 500,   "icon": "ti-tags"},
    {"key": "tag_legend",         "title": "Tag Legend",             "description": "Add 2,000 tags",                       "xp_reward": 7000,  "credit_reward": 2500,  "target": 2000,  "icon": "ti-tags"},
    # Streak milestones
    {"key": "month_streak",       "title": "Month Devotee",          "description": "Log in 30 days straight",              "xp_reward": 2500,  "credit_reward": 900,   "target": 30,    "icon": "ti-calendar"},
    {"key": "two_month_streak",   "title": "Obsessed",               "description": "Log in 60 days straight",              "xp_reward": 7000,  "credit_reward": 2500,  "target": 60,    "icon": "ti-calendar"},
    # Card milestones
    {"key": "fifty_cards",        "title": "Card Hoarder",           "description": "Own 50 cards",                         "xp_reward": 1000,  "credit_reward": 350,   "target": 50,    "icon": "ti-cards"},
    {"key": "hundred_cards",      "title": "Deck Lord",              "description": "Own 100 cards",                        "xp_reward": 3000,  "credit_reward": 1000,  "target": 100,   "icon": "ti-cards"},
    {"key": "two_fifty_cards",    "title": "Card Sovereign",         "description": "Own 250 cards",                        "xp_reward": 8000,  "credit_reward": 3000,  "target": 250,   "icon": "ti-crown"},
]


# ── Achievements ──────────────────────────────────────────────────────────────
ACHIEVEMENTS = [
    # ── First-time milestones ──────────────────────────────────────────────────
    {"key": "first_login",       "title": "Welcome to the Vault",   "description": "First time opening the app",            "icon": "ti-box",            "xp_reward": 75,   "credit_reward": 25},
    {"key": "first_session",     "title": "First Time",             "description": "Log your first session",                 "icon": "ti-heart",          "xp_reward": 100,  "credit_reward": 35},
    {"key": "first_creator",     "title": "First Favorite",         "description": "Add your first creator",                 "icon": "ti-user",           "xp_reward": 75,   "credit_reward": 25},
    {"key": "first_cum",         "title": "First Nut",              "description": "Count your first O",                    "icon": "ti-droplet",        "xp_reward": 75,   "credit_reward": 25},
    {"key": "first_pack",        "title": "Pack Rat",               "description": "Open your first card pack",              "icon": "ti-cards",          "xp_reward": 100,  "credit_reward": 35},
    {"key": "first_tag",         "title": "First Tag",              "description": "Add your first tag",                     "icon": "ti-tag",            "xp_reward": 50,   "credit_reward": 15},
    {"key": "first_rating",      "title": "First Impression",       "description": "Rate your first image",                  "icon": "ti-star",           "xp_reward": 50,   "credit_reward": 15},
    {"key": "first_dismantle",   "title": "The Recycler",           "description": "Dismantle your first card",              "icon": "ti-hammer",         "xp_reward": 75,   "credit_reward": 25},
    # ── Gooning milestones ────────────────────────────────────────────────────
    {"key": "dedicated",         "title": "Dedicated",              "description": "Count 10 Os",                           "icon": "ti-droplet",        "xp_reward": 150,  "credit_reward": 50},
    {"key": "gooner",            "title": "Gooner",                 "description": "Count 50 Os",                           "icon": "ti-droplet-filled", "xp_reward": 500,  "credit_reward": 175},
    {"key": "degenerate",        "title": "True Degenerate",        "description": "Count 200 Os",                          "icon": "ti-flame",          "xp_reward": 1500, "credit_reward": 500},
    {"key": "cum_500",           "title": "Absolute Unit",          "description": "Count 500 Os total",                    "icon": "ti-flame",          "xp_reward": 4000, "credit_reward": 1500},
    {"key": "session_10",        "title": "Getting Addicted",       "description": "Log 10 sessions",                       "icon": "ti-heart",          "xp_reward": 200,  "credit_reward": 75},
    {"key": "session_50",        "title": "Regular",                "description": "Log 50 sessions",                       "icon": "ti-heart-filled",   "xp_reward": 750,  "credit_reward": 250},
    {"key": "session_100",       "title": "Century Gooner",         "description": "Log 100 sessions",                      "icon": "ti-flame",          "xp_reward": 2000, "credit_reward": 750},
    {"key": "marathon_session",  "title": "Endurance Gooner",       "description": "Log a session over 60 minutes",         "icon": "ti-clock",          "xp_reward": 300,  "credit_reward": 100},
    # ── Login streaks ─────────────────────────────────────────────────────────
    {"key": "streak_3",          "title": "Back Again",             "description": "3 day login streak",                    "icon": "ti-flame",          "xp_reward": 75,   "credit_reward": 25},
    {"key": "streak_7",          "title": "Week Streak",            "description": "Log in 7 days in a row",                "icon": "ti-flame",          "xp_reward": 200,  "credit_reward": 75},
    {"key": "streak_14",         "title": "Fortnight",              "description": "Log in 14 days in a row",               "icon": "ti-flame",          "xp_reward": 400,  "credit_reward": 150},
    {"key": "streak_30",         "title": "Month Devotee",          "description": "Log in 30 days in a row",               "icon": "ti-calendar",       "xp_reward": 1000, "credit_reward": 400},
    {"key": "streak_60",         "title": "Two Month Obsession",    "description": "Log in 60 days straight",               "icon": "ti-calendar",       "xp_reward": 2500, "credit_reward": 1000},
    {"key": "streak_100",        "title": "True Devotee",           "description": "Log in 100 days straight",              "icon": "ti-crown",          "xp_reward": 6000, "credit_reward": 2500},
    # ── Time-based ────────────────────────────────────────────────────────────
    {"key": "night_owl",         "title": "Night Owl",              "description": "Use the vault after midnight",           "icon": "ti-moon",           "xp_reward": 100,  "credit_reward": 35},
    {"key": "early_bird",        "title": "Early Bird",             "description": "Use the vault before 8 AM",             "icon": "ti-sun",            "xp_reward": 100,  "credit_reward": 35},
    # ── Collection milestones ─────────────────────────────────────────────────
    {"key": "dismantle_25",      "title": "Card Shredder",          "description": "Dismantle 25 cards",                     "icon": "ti-hammer",         "xp_reward": 250,  "credit_reward": 100},
    {"key": "dismantle_100",     "title": "Forge Adept",            "description": "Dismantle 100 cards",                    "icon": "ti-hammer",         "xp_reward": 600,  "credit_reward": 200},
    {"key": "true_fan",          "title": "True Fan",               "description": "Rate a gallery 10/10",                   "icon": "ti-heart-filled",   "xp_reward": 300,  "credit_reward": 100},
    {"key": "hundred_images",    "title": "Centurion",              "description": "Reach 100 images in the vault",          "icon": "ti-photo",          "xp_reward": 300,  "credit_reward": 100},
    {"key": "images_500",        "title": "Mid-Tier Vault",         "description": "Reach 500 images",                       "icon": "ti-stack",          "xp_reward": 750,  "credit_reward": 250},
    {"key": "images_1000",       "title": "Serious Archive",        "description": "Reach 1,000 images",                     "icon": "ti-archive",        "xp_reward": 1500, "credit_reward": 500},
    {"key": "images_5000",       "title": "Elite Archive",          "description": "Reach 5,000 images",                     "icon": "ti-vault",          "xp_reward": 4000, "credit_reward": 1500},
    {"key": "five_creators",     "title": "Growing Roster",         "description": "Add 5 creators",                         "icon": "ti-users",          "xp_reward": 150,  "credit_reward": 50},
    {"key": "ten_creators",      "title": "The Collector",          "description": "Add 10 creators",                        "icon": "ti-users",          "xp_reward": 400,  "credit_reward": 150},
    {"key": "creators_25",       "title": "Dedicated Fan",          "description": "Add 25 creators",                        "icon": "ti-heart",          "xp_reward": 1000, "credit_reward": 400},
    {"key": "gallery_10",        "title": "Growing Collection",     "description": "Have 10 galleries",                      "icon": "ti-folder",         "xp_reward": 200,  "credit_reward": 75},
    {"key": "gallery_50",        "title": "Serious Collector",      "description": "Have 50 galleries",                      "icon": "ti-folders",        "xp_reward": 750,  "credit_reward": 250},
    {"key": "gallery_100",       "title": "Archive Lord",           "description": "Have 100 galleries",                     "icon": "ti-archive",        "xp_reward": 2000, "credit_reward": 750},
    # ── Tagging ───────────────────────────────────────────────────────────────
    {"key": "speed_tagger",      "title": "Speed Tagger",           "description": "Tag 50 images in one day",               "icon": "ti-tag",            "xp_reward": 250,  "credit_reward": 100},
    {"key": "tag_master",        "title": "Tag Master",             "description": "Add 500 tags total",                     "icon": "ti-tags",           "xp_reward": 750,  "credit_reward": 250},
    {"key": "tag_obsessed",      "title": "Tag Obsessed",           "description": "Add 2,000 tags total",                   "icon": "ti-tags",           "xp_reward": 2000, "credit_reward": 750},
    # ── Rating ────────────────────────────────────────────────────────────────
    {"key": "top_rated",         "title": "Connoisseur",            "description": "Rate 100 images",                        "icon": "ti-star",           "xp_reward": 200,  "credit_reward": 75},
    {"key": "harsh_critic",      "title": "Harsh Critic",           "description": "Rate 500 images",                        "icon": "ti-star-filled",    "xp_reward": 600,  "credit_reward": 200},
    {"key": "rated_1000",        "title": "Prolific Critic",        "description": "Rate 1,000 images",                      "icon": "ti-star-filled",    "xp_reward": 1500, "credit_reward": 500},
    # ── Cards ─────────────────────────────────────────────────────────────────
    {"key": "card_collector",    "title": "Card Collector",         "description": "Own 25 cards",                           "icon": "ti-cards",          "xp_reward": 300,  "credit_reward": 100},
    {"key": "card_50",           "title": "Card Hoarder",           "description": "Own 50 cards",                           "icon": "ti-cards",          "xp_reward": 600,  "credit_reward": 200},
    {"key": "card_100",          "title": "Deck Lord",              "description": "Own 100 cards",                          "icon": "ti-cards",          "xp_reward": 1500, "credit_reward": 500},
    {"key": "relic_hunter",      "title": "Relic Hunter",           "description": "Obtain a Relic or higher card",          "icon": "ti-diamond",        "xp_reward": 750,  "credit_reward": 300},
    {"key": "first_legendary",   "title": "Legend",                 "description": "Obtain a Legendary card",                "icon": "ti-sparkles",       "xp_reward": 400,  "credit_reward": 150},
    {"key": "first_celestial",   "title": "Ascended",               "description": "Obtain a Celestial card",                "icon": "ti-crown",          "xp_reward": 2000, "credit_reward": 750},
    {"key": "open_10_packs",     "title": "Pack Junkie",            "description": "Open 10 card packs",                     "icon": "ti-cards",          "xp_reward": 400,  "credit_reward": 150},
    {"key": "open_50_packs",     "title": "Pack Addict",            "description": "Open 50 card packs",                     "icon": "ti-cards",          "xp_reward": 1200, "credit_reward": 400},
    # ── Level milestones ──────────────────────────────────────────────────────
    {"key": "reach_level_5",     "title": "Apprentice",             "description": "Reach level 5",                          "icon": "ti-trending-up",    "xp_reward": 250,  "credit_reward": 100},
    {"key": "reach_level_10",    "title": "Adept",                  "description": "Reach level 10",                         "icon": "ti-trending-up",    "xp_reward": 500,  "credit_reward": 200},
    {"key": "reach_level_25",    "title": "Veteran",                "description": "Reach level 25",                         "icon": "ti-award",          "xp_reward": 1500, "credit_reward": 600},
    {"key": "reach_level_50",    "title": "Elite",                  "description": "Reach level 50",                         "icon": "ti-crown",          "xp_reward": 5000, "credit_reward": 2000},
    {"key": "reach_level_100",   "title": "God Tier",               "description": "Reach max level 100",                    "icon": "ti-crown",          "xp_reward": 20000,"credit_reward": 10000},
]


# ── Quest trigger map (action → list of quest keys that advance) ──────────────
QUEST_TRIGGER_MAP = {
    "session_logged":   ["log_session", "session_streak", "session_binge", "ten_sessions", "fifty_sessions", "hundred_sessions"],
    "image_rated":      ["rate_images", "rate_spree"],
    "tag_added":        ["tag_images", "tag_spree", "tag_master_week", "tag_master", "tag_legend"],
    "creator_added":    ["add_creator", "five_creators", "ten_creators", "twenty_five_creators", "fifty_creators"],
    # image-count boss quests (century, five_hundred_imgs, etc.) are synced by absolute value
    # in notify_action → gallery_imported, NOT via +1 increments here
    "gallery_imported": ["import_gallery", "gallery_marathon"],
    "cum_logged":       ["drain_tank", "double_goon", "fifty_nuts", "hundred_nuts", "five_hundred_nuts"],
    "gallery_rated":    ["rate_galleries"],
    # card-count boss quests (fifty_cards, etc.) are synced by absolute value in pack_opened handler
    "pack_opened":      ["open_pack", "pack_spree"],
    "card_dismantled":  ["forge_week"],
    "daily_login":      ["open_the_vault", "month_streak", "two_month_streak"],
}


def get_or_create_profile(db: Session) -> UserProfile:
    profile = db.query(UserProfile).first()
    if not profile:
        profile = UserProfile()
        db.add(profile)
        db.flush()
        _seed_quests(db)
        _seed_achievements(db)
    else:
        _ensure_quests_present(db)
        _ensure_achievements_present(db)
    return profile


def _compute_level(xp: int) -> tuple[int, str, int]:
    current_level = 1
    for lvl, threshold, _ in LEVELS:
        if xp >= threshold:
            current_level = lvl
        else:
            xp_to_next = threshold - xp
            return current_level, _get_title(current_level), xp_to_next
    return current_level, _get_title(current_level), 0


def _streak_multiplier(streak: int) -> float:
    if streak >= 30: return 3.0
    if streak >= 14: return 2.0
    if streak >= 7:  return 1.5
    return 1.0


def _award_credits_direct(db: Session, amount: int, source: str = "quest"):
    """Directly award credits to the user's profile."""
    from models import CreditEvent
    profile = db.query(UserProfile).first()
    if profile:
        profile.vault_credits = (profile.vault_credits or 0) + amount
        db.add(CreditEvent(source=source, amount=amount))


def award_xp(db: Session, reason: str, override_amount: Optional[int] = None) -> XPEventOut:
    profile = get_or_create_profile(db)
    base = override_amount if override_amount is not None else XP_REWARDS.get(reason, 10)
    mult = _streak_multiplier(profile.streak_days)
    earned = max(1, int(base * mult))

    # At max level XP gains become credits
    if profile.level >= MAX_LEVEL:
        credit_amount = max(1, earned // 5)
        profile.vault_credits = (profile.vault_credits or 0) + credit_amount
        from models import CreditEvent
        db.add(CreditEvent(source="max_level", amount=credit_amount))
        db.commit()
        return XPEventOut(reason=reason, amount=0, multiplier=mult,
                          total_xp=profile.total_xp, level=profile.level, level_up=False)

    old_level = profile.level
    profile.total_xp += earned
    new_level, new_title, xp_to_next = _compute_level(profile.total_xp)
    if new_level > MAX_LEVEL:
        new_level = MAX_LEVEL
        new_title = _get_title(MAX_LEVEL)
    profile.level = new_level
    profile.level_title = new_title

    event = XPEvent(reason=reason, amount=earned, multiplier=mult)
    db.add(event)
    db.commit()

    # Level-up rewards
    if new_level > old_level:
        try:
            from models import CraftingMaterials
            mats = db.query(CraftingMaterials).first()
            if not mats:
                mats = CraftingMaterials()
                db.add(mats)
            # Catalyst tokens are meant to be rare — grant 1 only every 5 levels
            # crossed, not one per level.
            mats.catalyst_tokens += (new_level // 5 - old_level // 5)
            db.commit()
        except Exception:
            pass
        # Level achievement checks
        level_achievements = {
            5: "reach_level_5", 10: "reach_level_10",
            25: "reach_level_25", 50: "reach_level_50", 100: "reach_level_100",
        }
        for lvl, key in level_achievements.items():
            if old_level < lvl <= new_level:
                unlock_achievement(db, key)

    return XPEventOut(reason=reason, amount=earned, multiplier=mult,
                      total_xp=profile.total_xp, level=new_level,
                      level_up=new_level > old_level, title=new_title)


def handle_login(db: Session) -> dict:
    profile = get_or_create_profile(db)
    now = datetime.utcnow()

    already_today = profile.last_login is not None and profile.last_login.date() == now.date()
    if already_today:
        return {
            "streak_days": profile.streak_days,
            "xp": None,
            "spin_available": profile.last_spin is None or profile.last_spin.date() < now.date(),
            "already_logged_in_today": True,
        }

    if profile.last_login:
        delta = (now.date() - profile.last_login.date()).days
        if delta == 1:
            profile.streak_days += 1
        elif delta > 1:
            if profile.grace_tokens > 0 and delta == 2:
                profile.grace_tokens -= 1
                profile.streak_days += 1
            else:
                profile.streak_days = 1
    else:
        profile.streak_days = 1

    if profile.streak_days > profile.streak_best:
        profile.streak_best = profile.streak_days

    profile.last_login = now
    db.commit()

    xp = award_xp(db, "daily_login")
    _reset_daily_quests(db)
    _reset_weekly_quests(db)
    # Advance daily login quest
    for qk in QUEST_TRIGGER_MAP.get("daily_login", []):
        _advance_quest(db, qk, 1)
    _check_streak_achievements(db, profile.streak_days)

    return {
        "streak_days": profile.streak_days,
        "xp": xp,
        "spin_available": profile.last_spin is None or profile.last_spin.date() < now.date(),
        "already_logged_in_today": False,
    }


def _reset_daily_quests(db: Session):
    now = datetime.utcnow()
    # Delete expired daily quests
    expired = db.query(Quest).filter(
        Quest.quest_type == QuestType.daily,
        Quest.expires_at < now
    ).all()
    for q in expired:
        db.delete(q)
    db.flush()

    # Check how many active daily quests exist
    active = db.query(Quest).filter(
        Quest.quest_type == QuestType.daily,
        Quest.status == QuestStatus.active
    ).all()
    if active:
        return  # Already have today's quests

    # An unclaimed bonus is NOT cleared here. It used to be, on the reasoning
    # that a new day means a fresh set of quests — but that quietly destroyed a
    # reward the user had already earned: finish your dailies in the evening,
    # don't click Claim before midnight, and the packs vanished. The board still
    # said "Ready!" from cached profile data, so claiming then failed outright.
    #
    # Carrying it over can't be farmed: the flag is a boolean, so at most one
    # daily bonus is ever pending, and _check_completion_bonus won't re-arm it
    # while it is still set. This also matches the rule that the system rewards
    # and never punishes.

    # Randomly pick DAILY_POOL_SIZE from the pool
    chosen = random.sample(ALL_DAILY_QUESTS, DAILY_POOL_SIZE)
    tomorrow = datetime(now.year, now.month, now.day) + timedelta(days=1)
    for qd in chosen:
        db.add(Quest(
            quest_type=QuestType.daily,
            expires_at=tomorrow,
            status=QuestStatus.active,
            progress=0,
            **qd
        ))
    db.commit()


def _next_monday_midnight(now: datetime) -> datetime:
    days_until = 7 - now.weekday()
    if days_until == 0:
        days_until = 7
    return datetime(now.year, now.month, now.day) + timedelta(days=days_until)


def _reset_weekly_quests(db: Session):
    now = datetime.utcnow()
    expired = db.query(Quest).filter(
        Quest.quest_type == QuestType.weekly,
        Quest.expires_at < now
    ).all()
    for q in expired:
        db.delete(q)
    # Purge any active quests whose keys were removed from the pool
    _REMOVED_QUEST_KEYS = {"wiki_hunter", "wiki_scholar", "rate_spree_week", "gallery_critic"}
    stale = db.query(Quest).filter(Quest.key.in_(_REMOVED_QUEST_KEYS)).all()
    for q in stale:
        db.delete(q)
    db.flush()

    active = db.query(Quest).filter(
        Quest.quest_type == QuestType.weekly,
        Quest.status == QuestStatus.active
    ).all()
    if active:
        return  # Already have this week's quests

    # Clear any stale claimable flag — a new week means a fresh set of quests
    profile = db.query(UserProfile).first()
    if profile and profile.weekly_bonus_claimable:
        profile.weekly_bonus_claimable = False

    # Randomly pick WEEKLY_POOL_SIZE from the pool
    chosen = random.sample(ALL_WEEKLY_QUESTS, WEEKLY_POOL_SIZE)
    expires_at = _next_monday_midnight(now)
    for qd in chosen:
        db.add(Quest(
            quest_type=QuestType.weekly,
            expires_at=expires_at,
            status=QuestStatus.active,
            progress=0,
            **qd
        ))
    db.commit()


def _ensure_quests_present(db: Session):
    """Ensure boss quests are present (daily/weekly are pooled and don't need top-up).
    Also back-fills credit_reward on any existing quest row that is missing it — handles
    DB rows seeded before the credit_reward column existed."""
    # Purge any quest rows whose keys were removed from all pools
    _REMOVED_QUEST_KEYS = {"wiki_hunter", "wiki_scholar", "rate_spree_week", "gallery_critic"}
    stale = db.query(Quest).filter(Quest.key.in_(_REMOVED_QUEST_KEYS)).all()
    if stale:
        for q in stale:
            db.delete(q)
        db.flush()

    # Add any missing boss quests
    existing_boss = {q.key for q in db.query(Quest).filter(
        Quest.quest_type == QuestType.boss
    ).all()}
    additions = []
    for qd in BOSS_QUESTS:
        if qd["key"] not in existing_boss:
            additions.append(Quest(quest_type=QuestType.boss, expires_at=None,
                                   status=QuestStatus.active, progress=0, **qd))
    if additions:
        db.add_all(additions)

    # Build a lookup of credit_reward by quest key across all pools
    credit_lookup = {
        q["key"]: q.get("credit_reward", 0)
        for q in BOSS_QUESTS + ALL_DAILY_QUESTS + ALL_WEEKLY_QUESTS
    }
    # Sync credit_reward on existing rows that are missing it
    all_existing = db.query(Quest).all()
    for q in all_existing:
        if q.key in credit_lookup and (q.credit_reward is None or q.credit_reward == 0):
            q.credit_reward = credit_lookup[q.key]

    db.commit()


def _ensure_achievements_present(db: Session):
    # Purge achievement rows whose keys were removed from the definitions
    _REMOVED_ACHIEVEMENT_KEYS = {"lore_nerd", "wiki_scholar_ach"}
    stale = db.query(Achievement).filter(Achievement.key.in_(_REMOVED_ACHIEVEMENT_KEYS)).all()
    for a in stale:
        db.delete(a)

    existing_map = {a.key: a for a in db.query(Achievement).all()}
    additions = []
    for a in ACHIEVEMENTS:
        if a["key"] not in existing_map:
            additions.append(Achievement(unlocked=False, **a))
        else:
            # Keep title/description in sync with code definitions
            row = existing_map[a["key"]]
            if row.title != a["title"] or row.description != a["description"]:
                row.title = a["title"]
                row.description = a["description"]
    if additions:
        db.add_all(additions)
    db.commit()


def _advance_quest(db: Session, key: str, amount: int = 1):
    quest = db.query(Quest).filter(
        Quest.key == key,
        Quest.status == QuestStatus.active
    ).first()
    if not quest:
        return
    quest.progress = min(quest.progress + amount, quest.target)
    if quest.progress >= quest.target:
        quest.status = QuestStatus.completed
        quest.completed_at = datetime.utcnow()
        # Award XP
        award_xp(db, "quest_complete", override_amount=quest.xp_reward)
        # Award credits directly from quest definition
        if quest.credit_reward and quest.credit_reward > 0:
            _award_credits_direct(db, quest.credit_reward, source=f"quest_{key}")
        db.commit()
        # Check if all quests of this type are now complete
        _check_completion_bonus(db, quest.quest_type)
    else:
        db.commit()


def _sync_quest_to_value(db: Session, key: str, value: int):
    """Set a quest's progress to an absolute value (used for count-based quests that need
    accurate syncing rather than +1 increments — e.g. image totals, card totals)."""
    quest = db.query(Quest).filter(
        Quest.key == key,
        Quest.status == QuestStatus.active
    ).first()
    if not quest:
        return
    quest.progress = min(value, quest.target)
    if quest.progress >= quest.target:
        quest.status = QuestStatus.completed
        quest.completed_at = datetime.utcnow()
        award_xp(db, "quest_complete", override_amount=quest.xp_reward)
        if quest.credit_reward and quest.credit_reward > 0:
            _award_credits_direct(db, quest.credit_reward, source=f"quest_{key}")
        db.commit()
        _check_completion_bonus(db, quest.quest_type)
    else:
        db.commit()


def _check_completion_bonus(db: Session, quest_type):
    """Mark the completion bonus as claimable when all quests of a type are done.
    Packs are NOT awarded here — the user must explicitly click Claim."""
    profile = db.query(UserProfile).first()
    if not profile:
        return
    now = datetime.utcnow()

    if quest_type == QuestType.daily:
        # Already claimed today or already flagged claimable — nothing to do
        if profile.daily_bonus_date and profile.daily_bonus_date.date() == now.date():
            return
        if profile.daily_bonus_claimable:
            return
        remaining = db.query(Quest).filter(
            Quest.quest_type == QuestType.daily,
            Quest.status == QuestStatus.active,
        ).count()
        if remaining == 0:
            profile.daily_bonus_claimable = True
            db.commit()

    elif quest_type == QuestType.weekly:
        iso_week = now.isocalendar()[1]
        # Already claimed this week or already flagged claimable — nothing to do
        if profile.weekly_bonus_week == iso_week:
            return
        if profile.weekly_bonus_claimable:
            return
        remaining = db.query(Quest).filter(
            Quest.quest_type == QuestType.weekly,
            Quest.status == QuestStatus.active,
        ).count()
        if remaining == 0:
            profile.weekly_bonus_claimable = True
            db.commit()


def credit_orgasm(db: Session, image_ids: list) -> dict:
    """Count one orgasm against whatever was on screen.

    Ending a session IS an orgasm — that is the whole point of the button — but
    for a long time logging a session and logging an O were separate code paths,
    so finishing a session anywhere except the 💦 button counted nothing.

    Mirrors log_edge: every image on screen is credited (in a multi-panel wall
    they genuinely were all being used), each gallery once, but the event counts
    once toward XP and the lifetime total so panel count can't inflate it.
    """
    from models import Image as _Image, Gallery as _Gallery

    unique_ids = list({int(i) for i in (image_ids or []) if i})
    images = db.query(_Image).filter(_Image.id.in_(unique_ids)).all() if unique_ids else []

    gallery_ids = set()
    for img in images:
        img.cum_count = (img.cum_count or 0) + 1
        if img.gallery_id:
            gallery_ids.add(img.gallery_id)

    if gallery_ids:
        for gal in db.query(_Gallery).filter(_Gallery.id.in_(gallery_ids)).all():
            gal.cum_count = (gal.cum_count or 0) + 1

    db.commit()

    # Profile totals, achievements and quest progress — once for the event.
    xp = notify_action(db, "cum_logged")

    return {
        "counts": {img.id: img.cum_count for img in images},
        "images_credited": len(images),
        "galleries_credited": len(gallery_ids),
        "xp": xp,
    }


def claim_completion_bonus(db: Session, quest_type: str) -> dict:
    """Explicitly claim the completion bonus packs. Returns what was awarded.
    All mutations are done in a single commit so there is no partial-state window."""
    profile = db.query(UserProfile).first()
    if not profile:
        return {"error": "No profile found"}
    now = datetime.utcnow()

    if quest_type == "daily":
        if not profile.daily_bonus_claimable:
            return {"error": "Daily bonus not available to claim"}
        profile.standard_packs = (profile.standard_packs or 0) + 5
        profile.daily_bonus_claimable = False
        profile.daily_bonus_date = now
        db.commit()
        return {"type": "standard", "quantity": 5, "claimed": True}

    elif quest_type == "weekly":
        if not profile.weekly_bonus_claimable:
            return {"error": "Weekly bonus not available to claim"}
        profile.premium_packs = (profile.premium_packs or 0) + 5
        profile.weekly_bonus_claimable = False
        profile.weekly_bonus_week = now.isocalendar()[1]
        db.commit()
        return {"type": "premium", "quantity": 5, "claimed": True}

    return {"error": "Invalid quest type"}


def _check_streak_achievements(db: Session, streak: int):
    if streak >= 3:   unlock_achievement(db, "streak_3")
    if streak >= 7:   unlock_achievement(db, "streak_7")
    if streak >= 14:  unlock_achievement(db, "streak_14")
    if streak >= 30:  unlock_achievement(db, "streak_30")
    if streak >= 60:  unlock_achievement(db, "streak_60")
    if streak >= 100: unlock_achievement(db, "streak_100")


def unlock_achievement(db: Session, key: str):
    ach = db.query(Achievement).filter(Achievement.key == key).first()
    if ach and not ach.unlocked:
        ach.unlocked = True
        ach.unlocked_at = datetime.utcnow()
        award_xp(db, "achievement_unlock", override_amount=ach.xp_reward)
        if ach.credit_reward and ach.credit_reward > 0:
            _award_credits_direct(db, ach.credit_reward, source=f"achievement_{key}")
        db.commit()


def do_daily_spin(db: Session) -> dict:
    profile = get_or_create_profile(db)
    now = datetime.utcnow()
    if profile.last_spin and profile.last_spin.date() >= now.date():
        return {"already_spun": True}

    rewards = [
        {"type": "xp",        "amount": 15,  "label": "+15 XP"},
        {"type": "xp",        "amount": 30,  "label": "+30 XP"},
        {"type": "xp",        "amount": 75,  "label": "+75 XP"},
        {"type": "xp",        "amount": 150, "label": "+150 XP — lucky!"},
        {"type": "credits",   "amount": 50,  "label": "+50 Credits!"},
        {"type": "credits",   "amount": 100, "label": "+100 Credits!"},
        {"type": "challenge", "amount": 0,   "label": "Tag challenge unlocked!"},
        {"type": "spotlight", "amount": 25,  "label": "Creator spotlight! +25 XP"},
    ]
    reward = random.choice(rewards)
    profile.last_spin = now

    xp_event = None
    if reward["type"] in ("xp", "spotlight"):
        xp_event = award_xp(db, "daily_spin", override_amount=reward["amount"])
    elif reward["type"] == "credits":
        _award_credits_direct(db, reward["amount"], source="daily_spin")
        db.commit()
    else:
        db.commit()

    return {"already_spun": False, "reward": reward, "xp_event": xp_event}


def notify_action(db: Session, action: str, count: int = 1, extra: dict = None, override_amount: Optional[int] = None):
    """Central hub: advance quests, award XP + credits, check achievements."""
    from models import Gallery as _Gallery
    extra = extra or {}
    now = datetime.utcnow()

    xp = award_xp(db, action, override_amount=override_amount)

    # Award Vault Credits via economy config and embed in the XP event so the
    # frontend interceptor can show a credits toast alongside the XP toast.
    try:
        from services.cards import award_credits_for_action
        credits = award_credits_for_action(db, action)
        if credits > 0:
            xp.credits_earned = credits
    except Exception:
        pass

    profile = get_or_create_profile(db)

    # ── Per-action achievement triggers ────────────────────────────────────────
    if action == "cum_logged":
        if profile.last_cum_date and profile.last_cum_date.date() < now.date():
            profile.daily_cum_count = 0
        profile.last_cum_date   = now
        profile.total_cum_count = (profile.total_cum_count or 0) + 1
        profile.daily_cum_count = (profile.daily_cum_count or 0) + 1
        db.commit()
        if profile.daily_cum_count <= 10:
            try:
                from services.cards import award_credits_for_action
                award_credits_for_action(db, "cum_logged")
            except Exception:
                pass
        unlock_achievement(db, "first_cum")
        if profile.total_cum_count >= 10:  unlock_achievement(db, "dedicated")
        if profile.total_cum_count >= 50:  unlock_achievement(db, "gooner")
        if profile.total_cum_count >= 200: unlock_achievement(db, "degenerate")
        if profile.total_cum_count >= 500: unlock_achievement(db, "cum_500")

    elif action == "edge_logged":
        if profile.last_edge_date and profile.last_edge_date.date() < now.date():
            profile.daily_edge_count = 0
        profile.last_edge_date   = now
        profile.total_edge_count = (profile.total_edge_count or 0) + 1
        profile.daily_edge_count = (profile.daily_edge_count or 0) + 1
        db.commit()

    elif action == "session_logged":
        profile.total_sessions_logged = (profile.total_sessions_logged or 0) + 1
        db.commit()
        unlock_achievement(db, "first_session")
        if profile.total_sessions_logged >= 10:  unlock_achievement(db, "session_10")
        if profile.total_sessions_logged >= 50:  unlock_achievement(db, "session_50")
        if profile.total_sessions_logged >= 100: unlock_achievement(db, "session_100")
        # Marathon session (60+ minutes)
        duration = extra.get("duration_sec", 0) or 0
        if duration >= 3600:
            unlock_achievement(db, "marathon_session")

    elif action == "image_rated":
        profile.total_images_rated = (profile.total_images_rated or 0) + 1
        db.commit()
        unlock_achievement(db, "first_rating")
        if profile.total_images_rated >= 50:   unlock_achievement(db, "lore_nerd")
        if profile.total_images_rated >= 100:  unlock_achievement(db, "top_rated")
        if profile.total_images_rated >= 200:  unlock_achievement(db, "wiki_scholar_ach")
        if profile.total_images_rated >= 500:  unlock_achievement(db, "harsh_critic")
        if profile.total_images_rated >= 1000: unlock_achievement(db, "rated_1000")
        # image max rating is 5 — true_fan triggers on perfect score
        if extra.get("rating", 0) >= 5:
            unlock_achievement(db, "true_fan")

    elif action == "gallery_rated":
        # gallery max rating is 5 — true_fan triggers on perfect score
        if extra.get("rating", 0) >= 5:
            unlock_achievement(db, "true_fan")

    elif action == "tag_added":
        if profile.last_tag_date and profile.last_tag_date.date() < now.date():
            profile.tags_added_today = 0
        profile.last_tag_date    = now
        profile.total_tags_added = (profile.total_tags_added or 0) + 1
        profile.tags_added_today = (profile.tags_added_today or 0) + 1
        db.commit()
        unlock_achievement(db, "first_tag")
        if profile.tags_added_today >= 50:  unlock_achievement(db, "speed_tagger")
        if profile.total_tags_added >= 500:  unlock_achievement(db, "tag_master")
        if profile.total_tags_added >= 2000: unlock_achievement(db, "tag_obsessed")

    elif action == "creator_added":
        from models import Creator as _Creator
        total = db.query(_Creator).count()
        unlock_achievement(db, "first_creator")
        if total >= 5:  unlock_achievement(db, "five_creators")
        if total >= 10: unlock_achievement(db, "ten_creators")
        if total >= 25: unlock_achievement(db, "creators_25")

    elif action == "gallery_imported":
        from models import Image as _Image, Gallery as _Gallery
        total_images = db.query(_Image).count()
        total_galleries = db.query(_Gallery).count()
        if total_images >= 100:   unlock_achievement(db, "hundred_images")
        if total_images >= 500:   unlock_achievement(db, "images_500")
        if total_images >= 1000:  unlock_achievement(db, "images_1000")
        if total_images >= 5000:  unlock_achievement(db, "images_5000")
        if total_galleries >= 10:  unlock_achievement(db, "gallery_10")
        if total_galleries >= 50:  unlock_achievement(db, "gallery_50")
        if total_galleries >= 100: unlock_achievement(db, "gallery_100")
        # Sync image-count boss quests to the real total (not +1 per gallery)
        for _img_key in ["century", "five_hundred_imgs", "millennium", "five_thousand_imgs", "ten_thousand_imgs"]:
            _sync_quest_to_value(db, _img_key, total_images)

    elif action == "pack_opened":
        profile.total_packs_opened = (profile.total_packs_opened or 0) + count
        db.commit()
        unlock_achievement(db, "first_pack")
        if profile.total_packs_opened >= 10: unlock_achievement(db, "open_10_packs")
        if profile.total_packs_opened >= 50: unlock_achievement(db, "open_50_packs")
        try:
            from models import CardInventory as _CI, Card as _Card
            # relic_hunter — fixed: filter on Card entity, not CardInventory
            has_relic = (db.query(_CI)
                           .join(_Card, _CI.card_id == _Card.id)
                           .filter(_Card.is_relic == True)
                           .first())
            if has_relic: unlock_achievement(db, "relic_hunter")
            # first legendary / first celestial
            has_legendary = (db.query(_CI)
                               .join(_Card, _CI.card_id == _Card.id)
                               .filter(_Card.rarity == "legendary")
                               .first())
            if has_legendary: unlock_achievement(db, "first_legendary")
            has_celestial = (db.query(_CI)
                               .join(_Card, _CI.card_id == _Card.id)
                               .filter(_Card.rarity == "celestial")
                               .first())
            if has_celestial: unlock_achievement(db, "first_celestial")
            total_cards = db.query(_CI).count()
            if total_cards >= 25:  unlock_achievement(db, "card_collector")
            if total_cards >= 50:  unlock_achievement(db, "card_50")
            if total_cards >= 100: unlock_achievement(db, "card_100")
            # Sync card-count boss quests to the real total (packs give multiple cards at once)
            for _card_key in ["fifty_cards", "hundred_cards", "two_fifty_cards"]:
                _sync_quest_to_value(db, _card_key, total_cards)
        except Exception:
            pass

    elif action == "card_dismantled":
        profile.total_cards_dismantled = (profile.total_cards_dismantled or 0) + count
        db.commit()
        unlock_achievement(db, "first_dismantle")
        if profile.total_cards_dismantled >= 25:  unlock_achievement(db, "dismantle_25")
        if profile.total_cards_dismantled >= 100: unlock_achievement(db, "dismantle_100")

    elif action == "gallery_assigned":
        # override_amount is the image count (minimum 1).
        # Award half that as credits, also floored to 1.
        image_count = override_amount or 1
        credit_amount = max(1, image_count // 2)
        _award_credits_direct(db, credit_amount, source="gallery_assigned")
        xp.credits_earned = credit_amount

    # Night owl / early bird based on current hour
    hour = now.hour
    if hour >= 0 and hour < 3:
        unlock_achievement(db, "night_owl")
    elif hour >= 5 and hour < 8:
        unlock_achievement(db, "early_bird")

    # ── Quest advancement ──────────────────────────────────────────────────────
    for quest_key in QUEST_TRIGGER_MAP.get(action, []):
        _advance_quest(db, quest_key, count)

    return xp


def _seed_quests(db: Session):
    now = datetime.utcnow()
    tomorrow = datetime(now.year, now.month, now.day) + timedelta(days=1)
    next_monday = _next_monday_midnight(now)

    chosen_daily  = random.sample(ALL_DAILY_QUESTS, DAILY_POOL_SIZE)
    chosen_weekly = random.sample(ALL_WEEKLY_QUESTS, WEEKLY_POOL_SIZE)

    for qd in chosen_daily:
        db.add(Quest(quest_type=QuestType.daily,  expires_at=tomorrow,    status=QuestStatus.active, progress=0, **qd))
    for qd in chosen_weekly:
        db.add(Quest(quest_type=QuestType.weekly, expires_at=next_monday, status=QuestStatus.active, progress=0, **qd))
    for qd in BOSS_QUESTS:
        db.add(Quest(quest_type=QuestType.boss,   expires_at=None,        status=QuestStatus.active, progress=0, **qd))
    db.flush()


def _seed_achievements(db: Session):
    for a in ACHIEVEMENTS:
        db.add(Achievement(unlocked=False, **a))
    db.flush()


# ── Collection Value & Completion ─────────────────────────────────────────────

def calc_creator_stats(db: Session, creator_id: int) -> dict:
    from models import Gallery, Creator, gallery_creators
    from datetime import date

    creator = db.query(Creator).filter(Creator.id == creator_id).first()
    if not creator:
        return {}

    m2m = (
        db.query(Gallery)
          .join(gallery_creators, gallery_creators.c.gallery_id == Gallery.id)
          .filter(gallery_creators.c.creator_id == creator_id)
          .all()
    )
    primary = db.query(Gallery).filter(Gallery.creator_id == creator_id).all()
    all_galleries = list({g.id: g for g in m2m + primary}.values())

    monthly_price = creator.patreon_price or 0.0
    unique_months: set = set()
    one_time_total = 0.0

    for g in all_galleries:
        if g.period_month and g.period_year:
            unique_months.add((g.period_year, g.period_month))
        if g.purchase_value:
            one_time_total += g.purchase_value

    sub_value = len(unique_months) * monthly_price
    total_value = sub_value + one_time_total

    # All-time completion: span every month from the earliest gallery month to today
    today = date.today()
    if unique_months:
        earliest = min(unique_months)  # (year, month) tuple
        # Build the full expected set from earliest month to current month (or retirement year limit)
        all_expected: set = set()
        y, m = earliest
        limit_year = today.year
        limit_month = today.month
        if getattr(creator, 'status', None) == 'Retired' and getattr(creator, 'retirement_year', None):
            if creator.retirement_year < today.year:
                limit_year = creator.retirement_year
                limit_month = 12
        while (y, m) <= (limit_year, limit_month):
            all_expected.add((y, m))
            m += 1
            if m > 12:
                m = 1
                y += 1
        total_expected = len(all_expected)
        covered = unique_months & all_expected
        completion_pct = round(len(covered) / total_expected * 100, 1) if total_expected else 0.0
        months_covered = len(covered)
    else:
        total_expected = 0
        months_covered = 0
        completion_pct = 0.0

    return {
        "total_value": round(total_value, 2),
        "sub_value": round(sub_value, 2),
        "one_time_value": round(one_time_total, 2),
        "unique_months_total": len(unique_months),
        "months_covered_recent": months_covered,
        "total_months_expected": total_expected,
        "completion_pct": completion_pct,
    }


def check_creator_completion(db: Session, creator_id: int) -> bool:
    from models import Creator
    stats = calc_creator_stats(db, creator_id)
    creator = db.query(Creator).filter(Creator.id == creator_id).first()
    if not creator:
        return False

    if stats.get("completion_pct", 0) < 100:
        if creator.completion_rewarded_at is not None:
            creator.completion_rewarded_at = None
            db.flush()
        return False

    if creator.completion_rewarded_at is not None:
        return False

    award_xp(db, "creator_completion", override_amount=500)

    try:
        from services.cards import _award_credits, _get_or_create_materials, _add_to_inventory
        from services.cards import _pick_image_card, _pick_gallery_card, _pick_creator_card
        from config import DROP_WEIGHTS, PACK_SIZE
        import random as _r

        _award_credits(db, "creator_completion_100pct", 500)
        mats = _get_or_create_materials(db)
        mats.catalyst_tokens += 1

        types   = list(DROP_WEIGHTS.keys())
        weights = list(DROP_WEIGHTS.values())
        selectors = {
            "image":   _pick_image_card,
            "gallery": _pick_gallery_card,
            "creator": _pick_creator_card,
        }
        for _ in range(PACK_SIZE * 5):
            chosen = _r.choices(types, weights=weights, k=1)[0]
            fn = selectors.get(chosen, _pick_image_card)
            card = fn(db)
            if card:
                _add_to_inventory(db, card)
    except Exception:
        pass

    creator.completion_rewarded_at = datetime.utcnow()
    db.flush()
    return True
