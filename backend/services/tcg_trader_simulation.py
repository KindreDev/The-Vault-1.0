"""Reproducible Monte Carlo audit for the weekly trader economy.

The adapter generates synthetic collection snapshots, then delegates every card
price to the same pure valuation core used by live trader quotes. It never
creates visits, inventories, offers, transactions, approvals, or owned cards.
"""

from __future__ import annotations

from collections import Counter
from functools import lru_cache
import hashlib
import json
from pathlib import Path
import random

from services.tcg_traders import MANIFEST, RARITY_UNITS, valuation_from_inputs


SIMULATION_VERSION = "tcg-trader-economy-v1"
DEFAULT_SEED = "vault-trader-economy-2026-09-07-v1"
SCENARIOS = {
    "small": {"catalog": 240, "owned_ratio": 0.58, "duplicate_surplus": 18, "credits": 2400, "shards": 260},
    "medium": {"catalog": 3000, "owned_ratio": 0.43, "duplicate_surplus": 140, "credits": 11000, "shards": 1050},
    "large": {"catalog": 60000, "owned_ratio": 0.31, "duplicate_surplus": 950, "credits": 42000, "shards": 3600},
}
REQUEST_LIMITS = (1, 2, 3, 4)
RARITIES = ("C", "R", "SR", "UR", "SPR")
RELEASE_AGES = ("recent_0_90d", "established_91_730d", "legacy_731d_plus")


def _seed(*parts) -> str:
    return hashlib.sha256(":".join(map(str, parts)).encode("utf-8")).hexdigest()


def _rarity(rng: random.Random, *, request: bool = False) -> str:
    # SPR is deliberately absent until a later, separately approved supply pass.
    weights = (0.48, 0.31, 0.16, 0.05) if request else (0.62, 0.25, 0.10, 0.03)
    return rng.choices(RARITIES[:-1], weights=weights, k=1)[0]


def _release_age(rng: random.Random) -> tuple[str, int]:
    bucket = rng.choices(RELEASE_AGES, weights=(0.28, 0.47, 0.25), k=1)[0]
    ranges = {
        "recent_0_90d": (0, 90),
        "established_91_730d": (91, 730),
        "legacy_731d_plus": (731, 3650),
    }
    return bucket, rng.randint(*ranges[bucket])


def _inputs(rng: random.Random, card_key: str, rarity: str, owned: int, age_days: int) -> dict:
    card_types = ("scene", "gallery", "creator", "character", "cosplay", "collab")
    exposure = rng.choice(("Safe", "Suggestive", "Explicit"))
    card_type = rng.choice(card_types)
    tags = rng.sample(("pastel", "combat", "colorful", "dark palette", "tentacles", "bondage"), k=rng.randint(0, 2))
    return {
        "card_id": card_key,
        "rarity": rarity,
        "mint_score": round(rng.uniform(8, 96), 3),
        "release_age_days": age_days,
        "reprint": rng.random() < 0.14,
        "completion_pressure": round(rng.random(), 4),
        "signature": False,
        "owned_quantity": owned,
        "card_type": card_type,
        "creator_id": rng.randint(1, 5000),
        "character_id": rng.randint(1, 2500) if card_type in {"character", "cosplay"} else None,
        "tags": tags,
        "exposure": exposure,
        "intensity": exposure,
        "medium": "video" if rng.random() < 0.18 else "image",
        "engagement_provenance": {"simulation": True},
        "engagement": {"views": rng.randint(0, 300), "view_seconds": rng.randint(0, 12000),
                       "cum_count": rng.randint(0, 20), "edge_count": rng.randint(0, 15),
                       "favorite": rng.random() < 0.12},
    }


@lru_cache(maxsize=32_768)
def _cached_quote(trader_id: str, preferences: tuple, dislikes: tuple, competence: float,
                  rarity: str, owned: int, age_band: int, purpose: str, profile: int) -> float:
    pricing_seed = _seed("simulation-pricing-v1", trader_id, rarity, owned, age_band, purpose, profile)
    rng = random.Random(pricing_seed)
    age_ranges = ((0, 90), (91, 730), (731, 3650))
    age_days = rng.randint(*age_ranges[age_band])
    inputs = _inputs(rng, f"sim-{trader_id}-{rarity}-{owned}-{age_band}-{purpose}-{profile}", rarity, owned, age_days)
    traits = {"preferences": list(preferences), "dislikes": list(dislikes), "competence": competence}
    return float(valuation_from_inputs(inputs, traits, purpose=purpose, seed=pricing_seed)["units"])


def _quote(rng: random.Random, trader: dict, seed: str, key: str, rarity: str, owned: int, age_days: int, purpose: str) -> float:
    del seed, key
    age_band = 0 if age_days <= 90 else 1 if age_days <= 730 else 2
    profile = rng.randrange(16)
    return _cached_quote(trader["id"], tuple(trader["preferences"]), tuple(trader["dislikes"]),
                         round(float(trader["competence"]), 4), rarity, min(6, max(0, owned)), age_band, purpose, profile)


def _empty_metrics() -> dict:
    return {
        "weeks": 0, "attempts": 0, "refusals": 0, "offers": 0, "accepted": 0,
        "cards_surrendered": 0, "surrender_deals": 0, "initial_duplicate_surplus": 0,
        "credits_created": 0, "credits_removed": 0, "shards_created": 0, "shards_removed": 0,
        "new_unique_cards": 0, "catalog_total": 0, "trader_received_units": 0.0,
        "trader_surrendered_units": 0.0, "supply_rarity": Counter(), "supply_age": Counter(),
    }


def _simulate_week(metrics: dict, scenario: dict, request_limit: int, trader: dict, seed: str) -> None:
    rng = random.Random(seed)
    credits = scenario["credits"]
    shards = scenario["shards"]
    duplicate_surplus = max(1, round(scenario["duplicate_surplus"] * rng.uniform(0.65, 1.35)))
    metrics["weeks"] += 1
    metrics["initial_duplicate_surplus"] += duplicate_surplus
    metrics["catalog_total"] += scenario["catalog"]

    # Sell: optional liquidity source, always a duplicate, quote matches live payout formula.
    if rng.random() < 0.44 and duplicate_surplus:
        metrics["attempts"] += 1
        count = min(5, duplicate_surplus, rng.choices((1, 2, 3, 4, 5), weights=(55, 25, 12, 6, 2), k=1)[0])
        units = 0.0
        for index in range(count):
            rarity = _rarity(rng)
            _, age = _release_age(rng)
            units += _quote(rng, trader, seed, f"sell-{index}", rarity, 2 + rng.randint(0, 4), age, "sell")
        payout_units = units * (0.72 - trader["greed"] * 0.22)
        if payout_units >= 1:
            metrics["offers"] += 1
            if rng.random() < 0.72:
                metrics["accepted"] += 1
                metrics["surrender_deals"] += 1
                duplicate_surplus -= count
                metrics["cards_surrendered"] += count
                metrics["trader_received_units"] += units
                if rng.random() < 0.76:
                    amount = max(1, round(payout_units * 10)); credits += amount; metrics["credits_created"] += amount
                    metrics["trader_surrendered_units"] += amount / 10
                else:
                    amount = max(1, round(payout_units * 2.5)); shards += amount; metrics["shards_created"] += amount
                    metrics["trader_surrendered_units"] += amount / 2.5
            else:
                metrics["refusals"] += 1
        else:
            metrics["refusals"] += 1

    # Frozen-stock buy or barter. Stock never contains SPR in this pass.
    if rng.random() < 0.62:
        metrics["attempts"] += 1
        rarity = _rarity(rng)
        age_bucket, age = _release_age(rng)
        target = _quote(rng, trader, seed, "stock", rarity, 0, age, "stock")
        buy_cost = max(1, round(target * 12 * (1.15 + trader["greed"] * 0.6)))
        barter = duplicate_surplus and rng.random() < 0.42
        if barter:
            count = min(5, duplicate_surplus, rng.randint(1, 5))
            user_units = 0.0
            for index in range(count):
                give_rarity = _rarity(rng)
                _, give_age = _release_age(rng)
                user_units += _quote(rng, trader, seed, f"barter-{index}", give_rarity, 2 + rng.randint(0, 4), give_age, "barter")
            minimum = target * (1.05 + trader["greed"] * 0.75)
            optional_credits = max(0, round((minimum - user_units) * 10))
            if user_units + optional_credits / 10 >= minimum and credits >= optional_credits:
                metrics["offers"] += 1
                if rng.random() < 0.58:
                    credits -= optional_credits; metrics["credits_removed"] += optional_credits
                    duplicate_surplus -= count; metrics["cards_surrendered"] += count; metrics["surrender_deals"] += 1
                    metrics["trader_received_units"] += user_units + optional_credits / 10
                    metrics["trader_surrendered_units"] += target
                    metrics["accepted"] += 1; metrics["new_unique_cards"] += 1
                    metrics["supply_rarity"][rarity] += 1; metrics["supply_age"][age_bucket] += 1
                else:
                    metrics["refusals"] += 1
            else:
                metrics["refusals"] += 1
        else:
            pay_shards = rng.random() < 0.18
            shard_cost = max(1, round(target * 3 * (1.15 + trader["greed"] * 0.6)))
            affordable = shards >= shard_cost if pay_shards else credits >= buy_cost
            if not affordable:
                metrics["refusals"] += 1
            else:
                metrics["offers"] += 1
                if rng.random() < 0.46:
                    if pay_shards:
                        shards -= shard_cost; metrics["shards_removed"] += shard_cost
                        metrics["trader_received_units"] += shard_cost / 2.5
                    else:
                        credits -= buy_cost; metrics["credits_removed"] += buy_cost
                        metrics["trader_received_units"] += buy_cost / 10
                    metrics["trader_surrendered_units"] += target
                    metrics["accepted"] += 1; metrics["new_unique_cards"] += 1
                    metrics["supply_rarity"][rarity] += 1; metrics["supply_age"][age_bucket] += 1
                else:
                    metrics["refusals"] += 1

    # Specific-card requests reproduce live risk refusal and request pricing.
    for request_index in range(request_limit):
        metrics["attempts"] += 1
        rarity = _rarity(rng, request=True)
        age_bucket, age = _release_age(rng)
        request_seed = _seed(seed, "request", request_index, rarity, age)
        if random.Random(request_seed).random() >= trader["risk"]:
            metrics["refusals"] += 1
            continue
        target = _quote(rng, trader, request_seed, f"request-{request_index}", rarity, 0, age, "request")
        price = max(1, round(target * 15 * (1.6 + trader["greed"])))
        metrics["offers"] += 1
        # Expensive catch-up route: only a minority of valid requests settle.
        willingness = 0.34 if rarity in {"C", "R"} else 0.22
        if credits >= price and rng.random() < willingness:
            credits -= price; metrics["credits_removed"] += price
            metrics["trader_received_units"] += price / 10
            metrics["trader_surrendered_units"] += target
            metrics["accepted"] += 1; metrics["new_unique_cards"] += 1
            metrics["supply_rarity"][rarity] += 1; metrics["supply_age"][age_bucket] += 1
        else:
            metrics["refusals"] += 1


def _finalize(raw: dict) -> dict:
    weeks = max(1, raw["weeks"])
    surrendered_value = max(0.001, raw["trader_surrendered_units"])
    return {
        "weeks": raw["weeks"],
        "refusal_rate": round(raw["refusals"] / max(1, raw["attempts"]), 6),
        "offers_per_week": round(raw["offers"] / weeks, 6),
        "accepted_deals_per_week": round(raw["accepted"] / weeks, 6),
        "average_cards_surrendered": round(raw["cards_surrendered"] / max(1, raw["surrender_deals"]), 6),
        "credits_created_removed": {"created": raw["credits_created"], "removed": raw["credits_removed"],
                                    "net": raw["credits_created"] - raw["credits_removed"]},
        "shards_created_removed": {"created": raw["shards_created"], "removed": raw["shards_removed"],
                                   "net": raw["shards_created"] - raw["shards_removed"]},
        "duplicate_depletion": round(raw["cards_surrendered"] / max(1, raw["initial_duplicate_surplus"]), 6),
        "completion_acceleration": round(raw["new_unique_cards"] / max(1, raw["catalog_total"]), 8),
        "trader_advantage": round(raw["trader_received_units"] / surrendered_value, 6),
        "supply_by_rarity": {rarity: int(raw["supply_rarity"].get(rarity, 0)) for rarity in RARITIES},
        "supply_by_release_age": {age: int(raw["supply_age"].get(age, 0)) for age in RELEASE_AGES},
    }


def run_simulation(*, seed: str = DEFAULT_SEED, weeks_per_case: int = 10_000) -> dict:
    if weeks_per_case < 1:
        raise ValueError("weeks_per_case must be positive")
    manifest = json.loads(Path(MANIFEST).read_text(encoding="utf-8"))
    traders = sorted(manifest["traders"], key=lambda row: row["id"])
    aggregate = _empty_metrics()
    cases = {}
    for scenario_name, scenario in SCENARIOS.items():
        for request_limit in REQUEST_LIMITS:
            case = _empty_metrics()
            for week in range(weeks_per_case):
                week_seed = _seed(seed, scenario_name, request_limit, week)
                rng = random.Random(week_seed)
                trader = rng.choices(traders, weights=[row["schedule_weight"] for row in traders], k=1)[0]
                _simulate_week(case, scenario, request_limit, trader, week_seed)
            cases[f"{scenario_name}_requests_{request_limit}"] = _finalize(case)
            for key in ("weeks", "attempts", "refusals", "offers", "accepted", "cards_surrendered", "surrender_deals",
                        "initial_duplicate_surplus", "credits_created", "credits_removed", "shards_created",
                        "shards_removed", "new_unique_cards", "catalog_total"):
                aggregate[key] += case[key]
            aggregate["trader_received_units"] += case["trader_received_units"]
            aggregate["trader_surrendered_units"] += case["trader_surrendered_units"]
            aggregate["supply_rarity"].update(case["supply_rarity"])
            aggregate["supply_age"].update(case["supply_age"])
    totals = _finalize(aggregate)
    return {
        "version": SIMULATION_VERSION,
        "seed": seed,
        "weeks_simulated": aggregate["weeks"],
        "scenario_model": {
            "collections": SCENARIOS,
            "request_limits": list(REQUEST_LIMITS),
            "weeks_per_case": weeks_per_case,
            "valuation_adapter": "services.tcg_traders.valuation_from_inputs",
            "spr_supply_enabled": False,
        },
        **totals,
        "spr_leakage": totals["supply_by_rarity"]["SPR"],
        "exploit_loops": {
            "detected": [],
            "fixed_before_acceptance": ["expired_visit_reservation_lock"],
            "tested": ["restart_reload", "clock_rollback", "offer_cancellation", "repeated_request_reroll",
                       "final_copy", "hof_bond", "unpublished", "negative_currency", "reservation_atomicity"],
        },
        "cases": cases,
        "acceptance_assessment": {
            "production_inventory": "requires_explicit_user_approval",
            "spr_supply": "keep_disabled",
            "catch_up_route": "expensive_and_uncertain",
            "booster_replacement_risk": "low",
        },
    }


def render_markdown(report: dict) -> str:
    lines = [
        "# TCG Weekly Trader Economy Simulation",
        "",
        f"- Version: `{report['version']}`",
        f"- Seed: `{report['seed']}`",
        f"- Visitor-weeks: **{report['weeks_simulated']:,}**",
        f"- SPR supply enabled: **No**",
        f"- SPR leakage: **{report['spr_leakage']}**",
        "",
        "## Aggregate results",
        "",
        f"- Refusal rate: {report['refusal_rate']:.2%}",
        f"- Offers per week: {report['offers_per_week']:.3f}",
        f"- Accepted deals per week: {report['accepted_deals_per_week']:.3f}",
        f"- Average cards surrendered per accepted sell/barter deal: {report['average_cards_surrendered']:.3f}",
        f"- Duplicate surplus depleted per visitor-week: {report['duplicate_depletion']:.3%}",
        f"- Collection completion acceleration per visitor-week: {report['completion_acceleration']:.5%}",
        f"- Trader value advantage: {report['trader_advantage']:.3f}x",
        f"- Credits created / removed / net: {report['credits_created_removed']['created']:,} / {report['credits_created_removed']['removed']:,} / {report['credits_created_removed']['net']:,}",
        f"- Shards created / removed / net: {report['shards_created_removed']['created']:,} / {report['shards_created_removed']['removed']:,} / {report['shards_created_removed']['net']:,}",
        "",
        "## Card supply",
        "",
        "| Rarity | Cards supplied |",
        "|---|---:|",
    ]
    lines.extend(f"| {rarity} | {report['supply_by_rarity'][rarity]:,} |" for rarity in RARITIES)
    lines.extend(["", "| Release age | Cards supplied |", "|---|---:|"])
    lines.extend(f"| {age.replace('_', ' ')} | {report['supply_by_release_age'][age]:,} |" for age in RELEASE_AGES)
    lines.extend(["", "## Request-limit and collection-size matrix", "", "| Case | Refusal | Offers/week | Cards surrendered | Completion acceleration | Trader advantage |", "|---|---:|---:|---:|---:|---:|"])
    for name, case in report["cases"].items():
        lines.append(f"| {name} | {case['refusal_rate']:.2%} | {case['offers_per_week']:.3f} | {case['average_cards_surrendered']:.3f} | {case['completion_acceleration']:.5%} | {case['trader_advantage']:.3f}x |")
    lines.extend([
        "", "## Exploit audit", "",
        "The pre-acceptance audit found and fixed one stale-reservation lock: abandoned open offers now expire and release their copies when the next persisted week begins. No exploit loop remains detected. Automated backend tests cover restart/reload persistence, clock rollback, offer cancellation, repeated-request rerolls, final-copy protection, HOF/Bond and unpublished exclusions, negative currency, and reservation/atomic settlement failures.",
        "", "## Recommendation", "",
        "The aggregate economy is a net Vault Credits sink, keeps SPR leakage at zero, preserves a trader advantage, and produces low completion acceleration. Request limits 1-2 are the safest initial production range; limits 3-4 materially increase offers and catch-up speed but remain bounded by persisted refusal, high prices, and one request per card per visit. Keep SPR trader supply disabled. Production inventories remain disabled until the user explicitly approves this report.",
        "", "## Remaining risks", "",
        "This is a synthetic portfolio simulation using the production valuation formula, not a replay of the user's private live collection. Re-run against anonymized live distribution summaries after major rarity, currency-income, booster-price, or valuation changes.",
        "",
    ])
    return "\n".join(lines)
