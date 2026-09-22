"""Credit-economy calculations and deterministic persona simulations.

This module deliberately models credits only. XP progression and its streak
multiplier remain in ``services.gamification`` and are not converted into
monthly pack budgets here.
"""

from __future__ import annotations

from copy import deepcopy

from config import (
    CREDIT_ACTION_REWARDS,
    CREDIT_DAILY_SPIN_EXPECTED,
    CREDIT_ECONOMY_VERSION,
    CREDIT_QUEST_REWARDS,
)


PERSONA_PROFILES = {
    "heavy_organizer": {
        "label": "Heavy organizer / collector",
        "actions": {
            "daily_login": 30, "session_logged": 24, "cum_logged": 36,
            "image_rated": 360, "gallery_rated": 36, "tag_added": 480,
            "gallery_curated": 60, "image_curated": 240,
            "gallery_imported": 4, "creator_added": 2, "wiki_import": 2,
            "daily_spin": 30,
        },
        "daily_quests": {
            "open_the_vault": 30, "log_session": 8, "rate_images": 6,
            "tag_images": 6, "drain_tank": 8,
        },
        "weekly_quests": {
            "session_streak": 4, "tag_master_week": 2,
            "curate_week": 1, "pack_spree": 1,
        },
        "one_time_credits": 1000,
    },
    "moderate_user": {
        "label": "Moderate user",
        "actions": {
            "daily_login": 20, "session_logged": 12, "cum_logged": 18,
            "image_rated": 180, "gallery_rated": 18, "tag_added": 240,
            "gallery_curated": 30, "image_curated": 120,
            "gallery_imported": 2, "creator_added": 1, "wiki_import": 1,
            "daily_spin": 20,
        },
        "daily_quests": {
            "open_the_vault": 20, "log_session": 4, "rate_images": 3,
            "tag_images": 3, "drain_tank": 4,
        },
        "weekly_quests": {
            "session_streak": 2, "tag_master_week": 1, "pack_spree": 1,
        },
        "one_time_credits": 500,
    },
    "sparse_organizer": {
        "label": "Sparse organizer",
        "actions": {
            "daily_login": 12, "session_logged": 4, "cum_logged": 4,
            "image_rated": 40, "gallery_rated": 6, "tag_added": 60,
            "gallery_curated": 20, "image_curated": 40,
            "gallery_imported": 1, "daily_spin": 12,
        },
        "daily_quests": {
            "open_the_vault": 8, "rate_images": 1, "tag_images": 1,
        },
        "weekly_quests": {},
        "one_time_credits": 100,
    },
}


def _action_credits(actions: dict[str, int]) -> tuple[int, dict[str, int]]:
    breakdown = {}
    total = 0
    for action, count in actions.items():
        if action == "daily_spin":
            amount = int(count) * CREDIT_DAILY_SPIN_EXPECTED
        else:
            amount = int(count) * CREDIT_ACTION_REWARDS.get(action, 0)
        breakdown[action] = amount
        total += amount
    return total, breakdown


def _quest_credits(counts: dict[str, int]) -> tuple[int, dict[str, int]]:
    breakdown = {}
    total = 0
    for key, count in counts.items():
        amount = int(count) * CREDIT_QUEST_REWARDS.get(key, 0)
        breakdown[key] = amount
        total += amount
    return total, breakdown


def simulate_credit_economy(
    *,
    standard_price: int = 550,
    premium_price: int = 1000,
    include_one_time: bool = True,
) -> dict:
    """Return a deterministic 30-day credit budget for three user personas.

    The activity counts are deliberately explicit and reviewable. One-time
    milestones are reported separately so they cannot disguise recurring income
    or become a reason to rebalance the monthly economy upward.
    """
    results = {}
    for key, definition in PERSONA_PROFILES.items():
        actions = deepcopy(definition["actions"])
        daily_total, action_breakdown = _action_credits(actions)
        daily_quest_total, daily_quest_breakdown = _quest_credits(definition["daily_quests"])
        weekly_quest_total, weekly_quest_breakdown = _quest_credits(definition["weekly_quests"])
        recurring = daily_total + daily_quest_total + weekly_quest_total
        one_time = int(definition["one_time_credits"] if include_one_time else 0)
        total = recurring + one_time
        standard_packs = recurring // max(1, int(standard_price))
        premium_packs = recurring // max(1, int(premium_price))
        results[key] = {
            "label": definition["label"],
            "period_days": 30,
            "recurring_credits": recurring,
            "one_time_credits": one_time,
            "total_credits": total,
            "standard_price": int(standard_price),
            "premium_price": int(premium_price),
            "standard_equivalent_packs": standard_packs,
            "premium_packs": premium_packs,
            "premium_aspirational": premium_packs < standard_packs,
            "action_breakdown": action_breakdown,
            "daily_quest_breakdown": daily_quest_breakdown,
            "weekly_quest_breakdown": weekly_quest_breakdown,
        }
    return {
        "economy_version": CREDIT_ECONOMY_VERSION,
        "standard_price": int(standard_price),
        "premium_price": int(premium_price),
        "one_time_rewards_separate": True,
        "personas": results,
    }
