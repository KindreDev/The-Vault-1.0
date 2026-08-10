"""
The Almanac — long-range analysis of a collecting life.

The existing Stats page answers "what is happening now": last 7 days, last 13
weeks, all-time totals. This answers "what has happened over the years", which
is a different question with a different data source.

Two eras, and they must never share an axis:

  COLLECTION history  — six years deep, reconstructed from gallery subscription
                        periods and real on-disk file dates. Genuine history.
  USAGE history       — only as old as the app itself (May 2026). Everything
                        before that was browsed in Explorer and left no trace.

Conflating the two produces exactly the wrong conclusions ("he's only ever
looked at 2% of his collection" — no, he's only looked at 2% of it *through the
app*), so every payload here is labelled with which era it belongs to.
"""
import math
from collections import defaultdict
from datetime import datetime

from sqlalchemy import func, case, select, union, text
from sqlalchemy.orm import Session

from models import (
    Gallery, Image, Creator, SessionLog, UserProfile, Tag,
    gallery_creators, image_creators, image_tags,
)

# Periods outside this window are typos or defaults, not real collecting years.
MIN_YEAR = 2014
MAX_YEAR = datetime.utcnow().year


def _pct(part, whole, digits=1):
    return round(100 * part / whole, digits) if whole else 0.0


def _creator_image_pairs():
    gallery_pairs = (
        select(gallery_creators.c.creator_id.label("creator_id"), Image.id.label("image_id"))
        .select_from(gallery_creators)
        .join(Image, Image.gallery_id == gallery_creators.c.gallery_id)
    )
    file_pairs = select(image_creators.c.creator_id.label("creator_id"),
                        image_creators.c.image_id.label("image_id"))
    return union(gallery_pairs, file_pairs).subquery()


# ── §1 The Long View ──────────────────────────────────────────────────────────

def long_view(db: Session) -> dict:
    """Six years of collecting, from gallery periods and real file dates."""

    # Galleries + files per collecting year
    rows = db.execute(text("""
        SELECT g.period_year AS y,
               COUNT(DISTINCT g.id) AS galleries,
               COUNT(i.id)          AS files
          FROM galleries g
          LEFT JOIN images i ON i.gallery_id = g.id
         WHERE g.period_year BETWEEN :lo AND :hi
      GROUP BY g.period_year
      ORDER BY g.period_year
    """), {"lo": MIN_YEAR, "hi": MAX_YEAR}).fetchall()

    years = [{
        "year": r[0],
        "galleries": int(r[1] or 0),
        "files": int(r[2] or 0),
        # The breadth-to-depth signal: fewer sets, bigger sets.
        "files_per_gallery": round((r[2] or 0) / r[1], 1) if r[1] else 0,
    } for r in rows]

    # Distinct creators followed per year — roster size over time
    crows = db.execute(text("""
        SELECT g.period_year AS y, COUNT(DISTINCT gc.creator_id) AS n
          FROM galleries g
          JOIN gallery_creators gc ON gc.gallery_id = g.id
         WHERE g.period_year BETWEEN :lo AND :hi
      GROUP BY g.period_year
    """), {"lo": MIN_YEAR, "hi": MAX_YEAR}).fetchall()
    creators_by_year = {int(r[0]): int(r[1] or 0) for r in crows}
    for y in years:
        y["creators"] = creators_by_year.get(y["year"], 0)

    # Roster churn: who was new that year vs carried over
    first_seen = {}
    for cid, yr in db.execute(text("""
        SELECT gc.creator_id, MIN(g.period_year)
          FROM galleries g JOIN gallery_creators gc ON gc.gallery_id = g.id
         WHERE g.period_year BETWEEN :lo AND :hi
      GROUP BY gc.creator_id
    """), {"lo": MIN_YEAR, "hi": MAX_YEAR}).fetchall():
        first_seen[int(cid)] = int(yr)
    new_by_year = defaultdict(int)
    for yr in first_seen.values():
        new_by_year[yr] += 1
    for y in years:
        y["new_creators"] = new_by_year.get(y["year"], 0)
        y["returning_creators"] = max(0, y["creators"] - y["new_creators"])

    total_g = sum(y["galleries"] for y in years) or 1
    peak = max(years, key=lambda y: y["galleries"]) if years else None

    out = {
        "era": "collection",
        "years": years,
        "total_galleries_dated": total_g,
        "peak_year": peak["year"] if peak else None,
        "peak_year_share": _pct(peak["galleries"], total_g) if peak else 0,
        "first_year": years[0]["year"] if years else None,
    }

    # ── Content vintage, from file mtime ──────────────────────────────────────
    # mtime survives being copied between drives, so it genuinely reflects when
    # the content was authored.
    #
    # Its sibling — file ctime — does NOT. Windows resets creation time whenever
    # a file is copied to a new volume, so on any library that has ever been
    # migrated, ctime records the migration rather than the acquisition. It is
    # deliberately not reported as an acquisition date here; doing so would have
    # claimed 164k files were "acquired in 2023" when the periods say 78k.
    vintage = db.execute(text("""
        SELECT strftime('%Y', file_modified_at) AS y, COUNT(*)
          FROM images
         WHERE file_modified_at IS NOT NULL
      GROUP BY y ORDER BY y
    """)).fetchall()
    out["vintage_by_year"] = [
        {"year": int(r[0]), "files": int(r[1])}
        for r in vintage if r[0] and MIN_YEAR <= int(r[0]) <= MAX_YEAR
    ]

    # Cross-check: gallery periods and file mtimes are entirely independent
    # records. Where they agree, the shape of the curve is real rather than an
    # artifact of how one of them was recorded.
    by_period = {y["year"]: y["files"] for y in years}
    checks, agree = [], 0
    for v in out["vintage_by_year"]:
        p = by_period.get(v["year"])
        if not p or p < 500:
            continue
        delta = _pct(abs(v["files"] - p), p)
        ok = delta <= 15
        agree += 1 if ok else 0
        checks.append({"year": v["year"], "by_period": p,
                       "by_file_date": v["files"], "delta_pct": delta, "agrees": ok})
    out["cross_check"] = checks
    out["cross_check_agreement"] = _pct(agree, len(checks)) if checks else 0

    out["eras"] = _detect_eras(years)
    return out


def _detect_eras(years: list) -> list:
    """Name the phases of a collecting life from the shape of the curve.

    Deliberately simple and explainable — a peak year, a growth run into it, and
    a taper after it. Nothing is inferred that a person couldn't read off the
    chart themselves.
    """
    if len(years) < 3:
        return []
    peak = max(years, key=lambda y: y["galleries"])
    eras = []
    early = [y for y in years if y["year"] < peak["year"]]
    if early:
        eras.append({
            "name": "Discovery",
            "from": early[0]["year"], "to": early[-1]["year"],
            "note": f"{sum(y['galleries'] for y in early):,} galleries while the habit formed",
        })
    eras.append({
        "name": "The Explosion",
        "from": peak["year"], "to": peak["year"],
        "note": f"{peak['galleries']:,} galleries in a single year",
    })
    after = [y for y in years if y["year"] > peak["year"]]
    if after:
        # Depth rising while gallery count falls is the consolidation signature.
        rising_depth = (after[-1]["files_per_gallery"] > after[0]["files_per_gallery"])
        eras.append({
            "name": "Consolidation" if rising_depth else "The Taper",
            "from": after[0]["year"], "to": after[-1]["year"],
            "note": (f"fewer sets ({peak['galleries']:,} → {after[-1]['galleries']:,}) "
                     f"but {after[-1]['files_per_gallery']:.0f} files each, up from "
                     f"{peak['files_per_gallery']:.0f}")
                    if rising_depth else "volume easing off",
        })
    return eras


# ── §2 Habits ─────────────────────────────────────────────────────────────────

def habits(db: Session) -> dict:
    """Everything about how the collection is actually used. Vault era only."""
    out = {"era": "usage", "since": None}

    first = db.query(func.min(SessionLog.logged_at)).scalar()
    out["since"] = first.isoformat() if first else None

    total_files = db.query(func.count(Image.id)).scalar() or 0
    touched = db.query(func.count(Image.id)).filter(Image.view_count > 0).scalar() or 0
    out["library_files"] = total_files
    out["files_touched"] = touched
    out["files_touched_pct"] = _pct(touched, total_files)

    gal_total = db.query(func.count(Gallery.id)).scalar() or 0
    gal_touched = db.query(func.count(func.distinct(Image.gallery_id))).filter(
        Image.view_count > 0).scalar() or 0
    out["galleries_total"] = gal_total
    out["galleries_touched"] = gal_touched
    out["galleries_touched_pct"] = _pct(gal_touched, gal_total)

    # Photo vs video attention — collecting and consuming are not the same thing
    split = db.query(
        func.sum(case((Image.is_video == False, Image.view_seconds), else_=0)),   # noqa: E712
        func.sum(case((Image.is_video == True, Image.view_seconds), else_=0)),    # noqa: E712
        func.sum(case((Image.is_video == True, func.coalesce(Image.duration, 0)), else_=0)),  # noqa: E712
    ).one()
    out["photo_seconds"] = int(split[0] or 0)
    out["video_seconds"] = int(split[1] or 0)
    out["video_runtime_owned"] = int(split[2] or 0)
    out["video_watched_pct"] = _pct(out["video_seconds"], out["video_runtime_owned"])

    # Session shape
    sessions = db.execute(text("""
        SELECT substr(logged_at, 1, 16) AS moment, MAX(duration_sec) AS dur
          FROM session_logs GROUP BY moment
    """)).fetchall()
    durs = sorted(int(s[1] or 0) for s in sessions)
    out["session_count"] = len(durs)
    out["session_avg_sec"] = int(sum(durs) / len(durs)) if durs else 0
    out["session_longest_sec"] = durs[-1] if durs else 0
    out["session_median_sec"] = durs[len(durs) // 2] if durs else 0
    buckets = [("<10m", 0, 600), ("10–30m", 600, 1800), ("30–60m", 1800, 3600),
               ("1–2h", 3600, 7200), ("2h+", 7200, 10**9)]
    out["session_buckets"] = [
        {"label": lbl, "count": sum(1 for d in durs if lo <= d < hi)}
        for lbl, lo, hi in buckets
    ]

    # Concentration — how much of your attention the top few hold
    pairs = _creator_image_pairs()
    crows = db.query(pairs.c.creator_id, func.sum(Image.view_seconds)) \
              .join(Image, Image.id == pairs.c.image_id) \
              .group_by(pairs.c.creator_id).all()
    secs = sorted((int(s or 0) for _, s in crows), reverse=True)
    total_secs = sum(secs) or 1
    out["creators_total"] = db.query(func.count(Creator.id)).scalar() or 0
    out["creators_watched"] = sum(1 for s in secs if s > 0)
    out["top5_share"] = _pct(sum(secs[:5]), total_secs)
    out["top10_share"] = _pct(sum(secs[:10]), total_secs)
    out["gini"] = round(_gini(secs), 3)

    # Dwell — attention per photo
    dw = db.query(func.sum(Image.view_seconds), func.sum(Image.view_count)) \
           .filter(Image.is_video == False).one()  # noqa: E712
    out["avg_dwell_seconds"] = round((dw[0] or 0) / dw[1], 1) if dw[1] else 0

    # Curation health
    out["rated_files"] = db.query(func.count(Image.id)).filter(Image.rating > 0).scalar() or 0
    out["favorite_files"] = db.query(func.count(Image.id)).filter(Image.is_favorite == True).scalar() or 0  # noqa: E712
    out["ai_tagged_files"] = db.query(func.count(Image.id)).filter(Image.ai_tagged == True).scalar() or 0  # noqa: E712
    out["rated_pct"] = _pct(out["rated_files"], total_files)
    out["tagged_pct"] = _pct(out["ai_tagged_files"], total_files)
    unassigned = db.execute(text("""
        SELECT COUNT(*) FROM galleries g
         WHERE NOT EXISTS (SELECT 1 FROM gallery_creators x WHERE x.gallery_id = g.id)
    """)).scalar() or 0
    out["galleries_unassigned"] = unassigned
    out["assigned_pct"] = _pct(gal_total - unassigned, gal_total)

    prof = db.query(UserProfile).first()
    if prof:
        out["total_cum"] = int(prof.total_cum_count or 0)
        out["total_edges"] = int(prof.total_edge_count or 0)
        out["streak_days"] = int(prof.streak_days or 0)
        out["streak_best"] = int(prof.streak_best or 0)
    return out


def _gini(values: list) -> float:
    """0 = attention spread evenly, 1 = it all goes to one creator."""
    vals = sorted(v for v in values if v > 0)
    n = len(vals)
    if n == 0:
        return 0.0
    total = sum(vals)
    if total == 0:
        return 0.0
    cum = sum((i + 1) * v for i, v in enumerate(vals))
    return (2 * cum) / (n * total) - (n + 1) / n


# ── §3 The Read ───────────────────────────────────────────────────────────────

def _pl(n, singular, plural=None):
    """'1 session' / '2 sessions' — a read that says '1 sessions' reads as a bug."""
    return f"{n:,} {singular if abs(n) == 1 else (plural or singular + 's')}"


def the_read(db: Session) -> dict:
    """The narrative, computed rather than written.

    Every line is guarded so it only appears when it is actually TRUE of this
    collector, and each observation has a counterpart for the opposite habit.
    Simulating other collectors showed how easily this becomes a horoscope:
    unguarded, "you collect widely and goon narrowly" fired for someone with two
    creators, and "you traded breadth for depth" fired on 6,000 -> 6,000. A line
    that fires for everyone says nothing about anyone.
    """
    lv = long_view(db)
    hb = habits(db)
    lines = []

    def add(title, body):
        lines.append({"title": title, "body": body})

    years = lv["years"]
    substantial = [y for y in years if y["galleries"] >= 5]

    # ── Shape of the collection ───────────────────────────────────────────────
    # A "peak year" only means something across several years, and only when it
    # genuinely dominates. One year at 100% is arithmetic, not insight — and if
    # the peak is the most recent year the collection hasn't peaked at all, it
    # is still climbing, which the accumulation line below says properly.
    still_climbing = bool(substantial) and lv["peak_year"] == substantial[-1]["year"]
    if len(substantial) >= 4 and lv["peak_year_share"] >= 18 and not still_climbing:
        add("Your collection has a peak year",
            f"{lv['peak_year']} accounts for {lv['peak_year_share']}% of every dated gallery "
            f"you own — the single year that defined the collection.")

    if len(substantial) >= 3:
        peak = max(substantial, key=lambda y: y["galleries"])
        last = substantial[-1]
        shrank = last["galleries"] <= peak["galleries"] * 0.75
        deeper = last["files_per_gallery"] >= peak["files_per_gallery"] * 1.25
        growing = last["galleries"] >= peak["galleries"] * 0.95 and last["year"] == peak["year"]

        if shrank and deeper:
            add("You traded breadth for depth",
                f"Sets per year fell from {peak['galleries']:,} at peak to {last['galleries']:,}, "
                f"but files per set climbed from {peak['files_per_gallery']:.0f} to "
                f"{last['files_per_gallery']:.0f}. Fewer sources, deeper hauls.")
        elif growing:
            add("You are still in the accumulation phase",
                f"{last['year']} is your biggest year yet at {last['galleries']:,} galleries. "
                f"The collection hasn't peaked — it is still being built.")
        elif shrank:
            add("The pace has eased off",
                f"From {peak['galleries']:,} galleries in {peak['year']} down to "
                f"{last['galleries']:,}, without the sets getting bigger. The hunt has quietened.")

    # ── The roster ────────────────────────────────────────────────────────────
    # Concentration is only interesting when there is something to concentrate
    # from — with five creators, "the top five hold 100%" is a tautology.
    total_c, watched_c = hb["creators_total"], hb["creators_watched"]
    if total_c >= 25 and hb["top5_share"] >= 35:
        never = total_c - watched_c
        body = (f"{total_c:,} creators in the vault, but the top five hold "
                f"{hb['top5_share']}% of your watch time and the top ten {hb['top10_share']}%.")
        if never >= 10:
            body += f" {_pl(never, 'has', 'have')} never been watched at all."
        add("You collect widely and goon narrowly", body)
    elif total_c >= 25 and hb["gini"] < 0.55:
        add("Your attention is unusually evenly spread",
            f"Across {total_c:,} creators the top five take only {hb['top5_share']}% of your "
            f"watch time. You graze rather than fixate.")
    elif 0 < total_c < 15:
        add("You keep a tight roster",
            f"Only {_pl(total_c, 'creator')} in the whole vault. Whatever else this is, "
            f"it isn't indiscriminate.")

    # ── Owning vs watching ────────────────────────────────────────────────────
    owned_h = hb["video_runtime_owned"] // 3600
    vid_h, pho_h = hb["video_seconds"] // 3600, hb["photo_seconds"] // 3600
    if owned_h >= 50 and hb["video_watched_pct"] < 15 and hb["photo_seconds"] > hb["video_seconds"]:
        add("You hoard video and watch photos",
            f"{owned_h:,} hours of video owned, {vid_h:,} watched "
            f"({hb['video_watched_pct']}%) — while photos take {pho_h:,} hours. "
            f"Video is acquisition; photos are use.")
    elif hb["video_seconds"] > hb["photo_seconds"] * 1.5 and vid_h >= 5:
        add("You are here for the video",
            f"{vid_h:,} hours on video against {pho_h:,} on photos. Most collections skew the "
            f"other way — stills are cheaper to browse than films are to sit through.")

    if hb["files_touched_pct"] >= 40 and hb["library_files"] >= 500:
        add("You actually watch what you own",
            f"{hb['files_touched_pct']}% of the library has been opened. Most collections are "
            f"mostly unvisited; yours is not.")

    # ── Curation ──────────────────────────────────────────────────────────────
    if hb["tagged_pct"] > 50 and hb["rated_pct"] < 5:
        add("You automate the curation you won't do by hand",
            f"{hb['tagged_pct']}% of the library is AI-tagged, but only {hb['rated_pct']}% is "
            f"rated. You don't want to curate — you want curation to have happened.")
    elif hb["rated_pct"] >= 20:
        add("You curate by hand",
            f"{hb['rated_pct']}% of the library carries a rating you gave it. That is a "
            f"vanishingly rare habit at any collection size.")
    elif hb["library_files"] >= 5000 and hb["tagged_pct"] < 10 and hb["rated_pct"] < 2:
        add("The archive is untended",
            f"{hb['library_files']:,} files, {hb['tagged_pct']}% tagged, {hb['rated_pct']}% "
            f"rated. Nothing is sorted — you rely on memory to find things.")

    # ── The ritual ────────────────────────────────────────────────────────────
    n = hb["session_count"]
    if n >= 5:
        med = hb["session_median_sec"] // 60
        shape = ("long, deliberate sittings" if med >= 45
                 else "quick visits" if med <= 12 else "a steady half-hour habit")
        add("The ritual",
            f"{_pl(n, 'session')}, {hb['session_avg_sec'] // 60} minutes on average, longest "
            f"{hb['session_longest_sec'] // 60}. Typically {shape}. Current streak "
            f"{_pl(hb.get('streak_days', 0), 'day')}, best {hb.get('streak_best', 0):,}.")
    elif n > 0:
        add("Barely any ritual yet",
            f"Only {_pl(n, 'session')} on record. The collection is far older than the habit "
            f"of tracking it.")

    if not lines:
        add("Not enough history yet",
            "Keep collecting and logging sessions — the read fills in as patterns appear.")

    return {"lines": lines, "long_view": lv, "habits": hb}
