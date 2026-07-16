"""Feed — simulated social-media posts generated from the user's own collection.

Posts are generated lazily (first feed visit of the day), persisted forever in
`feed_posts`, and never regenerated — so the feed accumulates history over time
like a real timeline. Captions are template-based; dates are only claimed when
gallery period metadata actually exists.
"""
import json
import os
import random
import re
from datetime import date, datetime, time, timedelta

from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from models import (
    Creator, FeedComment, FeedPost, FeedStory, Gallery, Image, Tag,
    gallery_creators, image_tags,
)

# ── Tuning ────────────────────────────────────────────────────────────────────
MAX_POSTS_PER_DAY   = 12   # global cap across all creators
MIN_THEME_IMAGES    = 3    # creator needs this many tagged images to join a theme day
IMAGES_PER_POST     = (3, 6)
STORY_CREATORS_PER_DAY = 8
STORIES_PER_CREATOR    = (3, 5)

# Candidate theme-day tags — matched (case-insensitive) against tags in the DB
THEME_CANDIDATES = [
    "lingerie", "bikini", "swimsuit", "maid", "nurse", "schoolgirl",
    "stockings", "thighhighs", "underboob", "sideboob", "cleavage",
    "ass", "feet", "cosplay", "topless", "bunny girl", "catgirl",
    "gym", "skirt", "dress", "pantyhose", "bodysuit",
]

CAPTIONS = {
    "on_this_day": [
        "remembering {gallery} from {when} 💕 time flies…",
        "on this day: {gallery} ({when}) 🥹 one of my favorites",
        "throwing it back to {when} — {gallery} ✨",
        "{when} was a good month… {gallery} 💜",
    ],
    "throwback": [
        "found these in my archive 🥰 {gallery}",
        "little throwback to {gallery} 💜",
        "still love this set… {gallery} ✨",
        "from the archives: {gallery} 😊",
        "do you remember this one? {gallery} 💕",
    ],
    "theme_day": [
        "apparently it's {tag} day 😏 here's my contribution",
        "heard it was {tag} day… say less 😘",
        "{tag} day!! picked some favorites for you 💜",
        "joining the {tag} day trend 🙈",
    ],
    "fresh_drop": [
        "new set just dropped: {gallery} 🔥",
        "fresh content!! {gallery} 💜 hope you like it",
        "just posted {gallery} 😘 enjoy~",
    ],
    "daily": [
        "outfit of the day 😘",
        "cosplay of the day ✨ thoughts?",
        "felt cute in this one 🙈",
        "today's look 💜 rate it",
        "lazy day but make it cute 🥱💕",
        "new fit check!! 🔥",
        "getting ready took forever… worth it? 😏",
        "just me today 💜",
        "photo dump from today 🥰",
    ],
}

MONTHS = ["January", "February", "March", "April", "May", "June",
          "July", "August", "September", "October", "November", "December"]

# Comment pools — picked by the commenter's gender + the poster's creator type
COMMENT_LINES_FEM = [
    "first 😍",
    "QUEEN 👑",
    "stoppp you're too perfect 😭",
    "need this set immediately",
    "she never misses 🔥",
    "the prettiest 💜",
    "ok but the last pic??? 🥵",
    "teach me your ways 🙏",
    "my wife fr",
    "obsessed with this look",
    "ate and left no crumbs 😌",
    "pls drop the lingerie link 🙏",
    "gorgeousss 😍😍",
]

COMMENT_LINES_MASC = [
    "insane work 🔥",
    "goes hard.",
    "W post",
    "unreal quality man",
    "the GOAT 🐐",
    "how long did this take??",
    "instant save",
    "ridiculous detail as always",
    "masterpiece fr",
    "clean. 🔥",
    # unmoderated social media — the reply guys are down catastrophically bad
    "mommy? sorry. mommy?",
    "down catastrophically bad rn",
    "I can fix her. actually no, she can ruin me",
    "the things I would do… 😩",
    "step on me please",
    "bro I'm NOT okay after this one",
    "she knows EXACTLY what she's doing 😩",
    "marry me. I have a stable job and a truck",
    "my last brain cell just left my body",
    "delete this before I do something stupid",
    "officer, this post right here",
    "gooning material no I will not elaborate",
    "actual goddess wtf",
    "I'd let her end my bloodline fr",
]

COMMENT_LINES_NEUTRAL = [
    "🔥🔥🔥",
    "unreal.",
    "how are you real",
    "saving this to my moodboard",
    "no way this is free to look at",
    "best on the timeline today",
]

# When the POSTER is a 2D/3D artist — technique talk
COMMENT_LINES_ART = [
    "the lighting here is unreal",
    "render quality is insane 😭",
    "what software?? this is so clean",
    "this composition >>>",
    "teach me your workflow 🙏",
    "the shading on this one… 🤌",
    "pose reference goals",
]

# When the POSTER is a cosplayer — craft talk
COMMENT_LINES_COSPLAY = [
    "the craftsmanship omg",
    "this wig is PERFECT??",
    "costume accuracy 100/100",
    "the set design!! 😍",
    "you ARE the character",
    "sewing skills off the charts",
    "the styling on this shoot 🤌",
]

# First-texts a girl might send you out of the blue
# Organic openers — she noticed your engagement and reaches out casually/friendly.
DM_OPENERS_ORGANIC = [
    "hey 😊 noticed you've been on my page a lot lately… what's the draw?",
    "you've been liking a lot of my stuff 👀 bold. I'm into it though",
    "ok I had to reach out — you clearly have good taste 😌 what got you hooked?",
    "you keep coming back 🙈 figured I'd finally say hi",
    "not gonna lie, seeing you like everything kinda made my day. hi 💜",
    "we've got a whole thing going on, you and my content 😆 what's your favorite so far?",
    "someone's been busy on my profile 😏 hi, I'm {name}",
]
# Tag-aware openers ({tag} = her most-engaged tag) — feels like she clocked your type
DM_OPENERS_TAG = [
    "you really seem to like my {tag} sets 😏 good eye. want more?",
    "noticed you're a {tag} kind of guy 👀 I can work with that",
    "my {tag} stuff is clearly doing something for you 🙈 hi btw",
]
# The old needy vibe — kept but rare (fires ~15% of the time) so it's occasional flavor
DM_OPENERS_NEEDY = [
    "can't sleep… keep me company? 🥺",
    "bored. entertain me 😌",
    "you crossed my mind today. that's all. ok bye 🙈",
]

# The companion lurks in the comments too (name comes from CompanionConfig)
ERIKA_LINES = [
    "he's been staring at this one for a while now 😏",
    "good choice today~ 💜",
    "I see why you like her 😌",
    "don't drool on the keyboard, love",
    "she's cute… not cuter than me though 😤",
    "adding this to his favorites before he does 💜",
    "caught you scrolling again~",
]


def handle_for(name: str) -> str:
    """Instagram-style handle derived from the creator name."""
    h = re.sub(r"[^a-z0-9_]", "", (name or "").lower().replace(" ", "_"))
    return h or "creator"


def _creator_gallery_q(db: Session, creator_id: int):
    return (
        db.query(Gallery)
          .join(gallery_creators, gallery_creators.c.gallery_id == Gallery.id)
          .filter(gallery_creators.c.creator_id == creator_id)
    )


def _pick_images(db: Session, rng: random.Random, gallery_id: int = None,
                 creator_id: int = None, tag_id: int = None, n: int = 4) -> list[int]:
    """Pick up to n image ids — photos preferred, videos allowed as spice."""
    q = db.query(Image.id, Image.is_video)
    if gallery_id is not None:
        q = q.filter(Image.gallery_id == gallery_id)
    elif creator_id is not None:
        q = (q.join(Gallery, Gallery.id == Image.gallery_id)
              .join(gallery_creators, gallery_creators.c.gallery_id == Gallery.id)
              .filter(gallery_creators.c.creator_id == creator_id))
    if tag_id is not None:
        q = q.join(image_tags, image_tags.c.image_id == Image.id) \
             .filter(image_tags.c.tag_id == tag_id)
    rows = q.filter(Image.thumb_path.isnot(None)).order_by(func.random()).limit(n * 3).all()
    photos = [r[0] for r in rows if not r[1]]
    videos = [r[0] for r in rows if r[1]]
    picked = photos[:n]
    if len(picked) < n:                     # pad with videos if short on photos
        picked += videos[: n - len(picked)]
    rng.shuffle(picked)
    return picked


def _theme_tag_of_day(db: Session, rng: random.Random) -> Tag | None:
    """Pick today's theme tag from candidates that actually exist in the vault."""
    names = [c.lower() for c in THEME_CANDIDATES]
    tags = (db.query(Tag)
              .filter(func.lower(Tag.name).in_(names))
              .filter(Tag.use_count >= MIN_THEME_IMAGES)
              .all())
    return rng.choice(tags) if tags else None


def _creator_has_tag(db: Session, creator_id: int, tag_id: int) -> bool:
    n = (db.query(func.count(Image.id))
           .join(Gallery, Gallery.id == Image.gallery_id)
           .join(gallery_creators, gallery_creators.c.gallery_id == Gallery.id)
           .join(image_tags, image_tags.c.image_id == Image.id)
           .filter(gallery_creators.c.creator_id == creator_id)
           .filter(image_tags.c.tag_id == tag_id)
           .scalar()) or 0
    return n >= MIN_THEME_IMAGES


def _build_post(db: Session, rng: random.Random, creator: Creator,
                today: date, theme: Tag | None) -> FeedPost | None:
    """Choose the best post type for this creator today and assemble the post."""
    galleries = _creator_gallery_q(db, creator.id)
    n_images = rng.randint(*IMAGES_PER_POST)

    # Anniversary — a gallery from this month in a past year
    anniversary = (galleries
                   .filter(Gallery.period_month == today.month)
                   .filter(Gallery.period_year.isnot(None))
                   .filter(Gallery.period_year < today.year)
                   .order_by(func.random()).first())
    # Fresh — imported in the last 4 days
    fresh = (galleries
             .filter(Gallery.created_at >= datetime.now() - timedelta(days=4))
             .order_by(func.random()).first())

    # Weighted type pool — variety instead of anniversary always winning
    pool = ["daily"] * 3 + ["throwback"] * 3
    if anniversary:
        pool += ["on_this_day"] * 4
    if fresh:
        pool += ["fresh_drop"] * 6
    if theme and _creator_has_tag(db, creator.id, theme.id):
        pool += ["theme_day"] * 3
    choice = rng.choice(pool)

    if choice == "on_this_day":
        when = f"{MONTHS[today.month - 1]} {anniversary.period_year}"
        images = _pick_images(db, rng, gallery_id=anniversary.id, n=n_images)
        if images:
            return FeedPost(
                creator_id=creator.id, post_type="on_this_day", gallery_id=anniversary.id,
                image_ids=json.dumps(images),
                caption=rng.choice(CAPTIONS["on_this_day"]).format(gallery=anniversary.name, when=when),
            )

    if choice == "fresh_drop":
        images = _pick_images(db, rng, gallery_id=fresh.id, n=n_images)
        if images:
            return FeedPost(
                creator_id=creator.id, post_type="fresh_drop", gallery_id=fresh.id,
                image_ids=json.dumps(images),
                caption=rng.choice(CAPTIONS["fresh_drop"]).format(gallery=fresh.name),
            )

    if choice == "theme_day":
        images = _pick_images(db, rng, creator_id=creator.id, tag_id=theme.id, n=n_images)
        if images:
            return FeedPost(
                creator_id=creator.id, post_type="theme_day", theme_tag=theme.name,
                image_ids=json.dumps(images),
                caption=rng.choice(CAPTIONS["theme_day"]).format(tag=theme.name),
            )

    # daily / throwback (and fallback when a pick above found no images)
    gallery = galleries.order_by(func.random()).first()
    if not gallery:
        return None
    images = _pick_images(db, rng, gallery_id=gallery.id, n=n_images)
    if not images:
        return None
    if choice == "daily":
        return FeedPost(
            creator_id=creator.id, post_type="daily", gallery_id=gallery.id,
            image_ids=json.dumps(images),
            caption=rng.choice(CAPTIONS["daily"]),
        )
    return FeedPost(
        creator_id=creator.id, post_type="throwback", gallery_id=gallery.id,
        image_ids=json.dumps(images),
        caption=rng.choice(CAPTIONS["throwback"]).format(gallery=gallery.name),
    )


def _pick_creators(rng: random.Random, candidates: list, count: int) -> list:
    """Favorites fill up to 2/3 of the slots; the rest go to everyone else."""
    favorites = [c for c in candidates if c.is_favorite]
    others    = [c for c in candidates if not c.is_favorite]
    rng.shuffle(favorites)
    rng.shuffle(others)
    chosen = favorites[: (count * 2) // 3]
    chosen += others[: count - len(chosen)]
    return chosen


def _ensure_stories_for_today(db: Session, today: date, candidates: list) -> int:
    """Mint today's batch of 24h stories (independent of post generation)."""
    already = (db.query(FeedStory.id)
                 .filter(FeedStory.posted_at >= datetime.combine(today, time.min))
                 .first())
    if already:
        return 0

    rng = random.Random(today.toordinal() * 13)
    chosen = _pick_creators(rng, candidates, STORY_CREATORS_PER_DAY)
    created = 0
    for creator in chosen:
        images = _pick_images(db, rng, creator_id=creator.id, n=rng.randint(*STORIES_PER_CREATOR))
        if not images:
            continue
        base_hour = rng.randint(0, 20)
        for i, image_id in enumerate(images):
            posted = datetime.combine(today, time(
                hour=min(23, base_hour + (rng.randint(0, 2) if i else 0)),
                minute=rng.randint(0, 59),
            ))
            db.add(FeedStory(creator_id=creator.id, image_id=image_id,
                             posted_at=min(posted, datetime.now())))
            created += 1
    if created:
        db.commit()
    return created


def _companion_name(db: Session) -> str:
    """The AI companion's current name — user-configurable, defaults to Erika."""
    from models import CompanionConfig
    row = db.query(CompanionConfig).first()
    return (row.name or "Erika") if row else "Erika"


def _comment_pool(commenter: Creator, poster: Creator | None) -> list[str]:
    """Male commenters talk like bros/artists; the poster's type steers the topic."""
    is_male = (commenter.gender or "").strip().lower() == "male"
    pool = list(COMMENT_LINES_MASC if is_male else COMMENT_LINES_FEM)
    pool += COMMENT_LINES_NEUTRAL
    ptype = poster.creator_type.value if (poster and poster.creator_type) else ""
    if ptype == "artist":
        pool += COMMENT_LINES_ART * 2       # technique talk dominates on art posts
    elif ptype == "cosplayer":
        pool += COMMENT_LINES_COSPLAY * 2   # craft talk dominates on cosplay posts
    return pool


def _ensure_comments(db: Session, candidates: list) -> int:
    """Give recent posts without comments some fake engagement — other creators
    in the comments, and the companion occasionally lurking. Deterministic per
    post (seeded by post id) so refreshes never change what was said."""
    commented = {r[0] for r in db.query(FeedComment.post_id).distinct().all()}
    posts = (db.query(FeedPost)
               .order_by(FeedPost.id.desc())
               .limit(60).all())
    companion = _companion_name(db)
    created = 0
    for post in posts:
        if post.id in commented:
            continue
        rng = random.Random(post.id * 31 + 7)
        others = [c for c in candidates if c.id != post.creator_id]
        n = rng.choice([0, 1, 1, 2, 2, 3, 4])
        rng.shuffle(others)
        for c in others[:n]:
            db.add(FeedComment(
                post_id=post.id, creator_id=c.id, author_name=c.name,
                text=rng.choice(_comment_pool(c, post.creator)),
            ))
            created += 1
        if rng.random() < 0.25:
            db.add(FeedComment(
                post_id=post.id, creator_id=None, author_name=companion,
                text=rng.choice(ERIKA_LINES),
            ))
            created += 1
    if created:
        db.commit()
    return created


DM_UNREAD_CAP = 4   # unread DMs can pile up to here, then no new ones until you read some


def _engagement_map(db: Session) -> dict[int, float]:
    """Per-creator "how into her have you been" score (cheap, 2 grouped queries).
    Drives which girl reaches out — the more you engage, the more likely she notices."""
    scores: dict[int, float] = {}
    rows = (db.query(gallery_creators.c.creator_id,
                     func.coalesce(func.sum(Gallery.cum_count), 0),
                     func.coalesce(func.sum(Gallery.view_count), 0))
              .join(Gallery, Gallery.id == gallery_creators.c.gallery_id)
              .group_by(gallery_creators.c.creator_id).all())
    for cid, cum, views in rows:
        scores[cid] = (cum or 0) * 5.0 + (views or 0) * 0.3
    for cid, n in (db.query(FeedPost.creator_id, func.count(FeedPost.id))
                     .filter(FeedPost.liked == True)          # noqa: E712
                     .group_by(FeedPost.creator_id).all()):
        if cid:
            scores[cid] = scores.get(cid, 0) + n * 10.0
    return scores


def _weighted_pick(rng: random.Random, items: list, weights: list):
    total = sum(weights)
    if total <= 0:
        return rng.choice(items) if items else None
    r = rng.random() * total
    acc = 0.0
    for it, w in zip(items, weights):
        acc += w
        if r <= acc:
            return it
    return items[-1]


# Too generic to make a fun "you seem to like my {tag} sets" opener
_BORING_TAGS = {"video", "funscripted", "solo", "1girl", "breasts", "nipples",
                "nude", "looking at viewer", "long hair", "large breasts",
                "realistic", "photorealistic", "female", "woman", "smile"}

def _creator_top_tag(db: Session, creator_id: int) -> str | None:
    row = (db.query(Tag.name)
             .join(image_tags, image_tags.c.tag_id == Tag.id)
             .join(Image, Image.id == image_tags.c.image_id)
             .join(Gallery, Gallery.id == Image.gallery_id)
             .join(gallery_creators, gallery_creators.c.gallery_id == Gallery.id)
             .filter(gallery_creators.c.creator_id == creator_id)
             .filter(func.lower(Tag.name).notin_(_BORING_TAGS))
             .group_by(Tag.id).order_by(func.count(image_tags.c.image_id).desc())
             .first())
    return row[0] if row else None


def _ensure_dm_ping(db: Session, today: date, candidates: list) -> int:
    """A girl texts first when she's "noticed" your engagement. One roll per day
    (~60%), engagement-weighted pick, organic opener. Unread DMs accumulate up to
    DM_UNREAD_CAP so a few can be waiting, but never a flood."""
    from models import CompanionMessage, FeedDMPing
    # One roll per day
    if db.query(FeedDMPing.id).filter(FeedDMPing.created_at >= datetime.combine(today, time.min)).first():
        return 0
    # Respect the unread cap
    unread = db.query(func.count(FeedDMPing.id)).filter(FeedDMPing.read == False).scalar() or 0  # noqa: E712
    if unread >= DM_UNREAD_CAP:
        return 0
    rng = random.Random(today.toordinal() * 101)
    if rng.random() > 0.6:
        return 0

    # Don't let a girl who's already got an unread DM text again
    pinged = {r[0] for r in db.query(FeedDMPing.creator_id).filter(FeedDMPing.read == False).all()}
    pool = [c for c in candidates if c.id not in pinged]
    if not pool:
        return 0

    scores = _engagement_map(db)
    # engagement + a favorite nudge + a small base so anyone *can* reach out
    weights = [scores.get(c.id, 0) + (30 if c.is_favorite else 0) + 1 for c in pool]
    creator = _weighted_pick(rng, pool, weights)
    if not creator:
        return 0

    roll = rng.random()
    top_tag = _creator_top_tag(db, creator.id)
    if roll < 0.15:
        message = rng.choice(DM_OPENERS_NEEDY)
    elif top_tag and roll < 0.55:
        message = rng.choice(DM_OPENERS_TAG).format(tag=top_tag)
    else:
        message = rng.choice(DM_OPENERS_ORGANIC).format(name=creator.name)

    db.add(FeedDMPing(creator_id=creator.id, message=message))
    db.add(CompanionMessage(role="assistant", content=message, persona_id=creator.id))
    db.commit()
    return 1


def dm_pings(db: Session) -> list[dict]:
    """Unread 'she texted first' pings, newest first."""
    from models import FeedDMPing
    rows = (db.query(FeedDMPing)
              .filter(FeedDMPing.read == False)
              .order_by(FeedDMPing.id.desc())
              .limit(5).all())
    out = []
    for p in rows:
        c = p.creator
        if not c:
            continue
        out.append({
            "id": p.id,
            "message": p.message,
            "created_at": p.created_at.isoformat() if p.created_at else None,
            "creator": {
                "id": c.id, "name": c.name,
                "handle": handle_for(c.name),
                "has_avatar": bool(c.avatar_path),
            },
        })
    return out


def mark_dm_read(db: Session, ping_id: int) -> dict:
    from models import FeedDMPing
    ping = db.query(FeedDMPing).filter(FeedDMPing.id == ping_id).first()
    if not ping:
        return {"error": "not found"}
    ping.read = True
    db.commit()
    return {"read": True}


def ensure_posts_for_today(db: Session) -> int:
    """Generate today's posts + stories if this is the first feed visit of the day."""
    today = date.today()

    # Creators that actually have galleries
    candidates = (db.query(Creator)
                    .join(gallery_creators, gallery_creators.c.creator_id == Creator.id)
                    .group_by(Creator.id)
                    .all())
    if not candidates:
        return 0

    created = _ensure_stories_for_today(db, today, candidates)
    created += _ensure_dm_ping(db, today, candidates)

    already = (db.query(FeedPost.id)
                 .filter(FeedPost.posted_at >= datetime.combine(today, time.min))
                 .first())
    if already:
        # Posts already minted — still top up engagement on any that lack it
        return created + _ensure_comments(db, candidates)

    rng = random.Random(today.toordinal())   # stable within the day
    chosen = _pick_creators(rng, candidates, MAX_POSTS_PER_DAY)

    # Daily spotlight — one slot goes to a creator who has NEVER posted, so the
    # quieter corners of the vault get seen too
    posted_ever = {r[0] for r in db.query(FeedPost.creator_id).distinct().all()}
    chosen_ids = {c.id for c in chosen}
    unseen = [c for c in candidates if c.id not in posted_ever and c.id not in chosen_ids]
    if unseen and chosen:
        chosen[-1] = rng.choice(unseen)

    theme = _theme_tag_of_day(db, rng)
    for creator in chosen:
        post = _build_post(db, rng, creator, today, theme)
        if not post:
            continue
        # Spread posts across the day so the timeline has a rhythm
        posted = datetime.combine(today, time(hour=rng.randint(7, 23), minute=rng.randint(0, 59)))
        post.posted_at = min(posted, datetime.now())
        db.add(post)
        created += 1
    db.commit()
    created += _ensure_comments(db, candidates)
    return created


# ── Serialization ─────────────────────────────────────────────────────────────

# Auto/meta tags that make boring hashtags
_HASHTAG_EXCLUDE = {"video", "funscripted"}

def _post_hashtags(db: Session, image_ids: list[int], limit: int = 6) -> list[str]:
    """2-6 hashtags from the post's images — most frequent tags first."""
    if not image_ids:
        return []
    rows = (db.query(Tag.name, func.count(image_tags.c.image_id).label("n"))
              .join(image_tags, image_tags.c.tag_id == Tag.id)
              .filter(image_tags.c.image_id.in_(image_ids))
              .group_by(Tag.id)
              .order_by(func.count(image_tags.c.image_id).desc())
              .limit(limit + len(_HASHTAG_EXCLUDE))
              .all())
    names = [r[0] for r in rows if r[0].lower() not in _HASHTAG_EXCLUDE][:limit]
    return names if len(names) >= 2 else []


def _serialize_post(db: Session, post: FeedPost) -> dict:
    try:
        ids = json.loads(post.image_ids or "[]")
    except (ValueError, TypeError):
        ids = []
    rows = db.query(Image.id, Image.is_video, Image.duration, Image.gallery_id,
                    Image.width, Image.height) \
             .filter(Image.id.in_(ids)).all() if ids else []
    by_id = {r[0]: r for r in rows}
    images = [{"id": r[0], "is_video": bool(r[1]), "duration": r[2], "gallery_id": r[3],
               "width": r[4], "height": r[5]}
              for r in (by_id[i] for i in ids if i in by_id)]

    gallery_name = None
    if post.gallery_id:
        gallery_name = db.query(Gallery.name).filter(Gallery.id == post.gallery_id).scalar()

    c = post.creator
    return {
        "id": post.id,
        "post_type": post.post_type,
        "caption": post.caption,
        "theme_tag": post.theme_tag,
        "liked": bool(post.liked),
        "posted_at": post.posted_at.isoformat() if post.posted_at else None,
        "gallery_id": post.gallery_id,
        "gallery_name": gallery_name,
        "images": images,
        "hashtags": _post_hashtags(db, ids),
        "like_count": random.Random(post.id * 97).randint(180, 42000),
        "comments": [{
            "id": cm.id,
            "creator_id": cm.creator_id,
            "author": cm.author_name,
            "handle": handle_for(cm.author_name),   # companion rename flows through
            "is_erika": cm.creator_id is None,
            "text": cm.text,
        } for cm in db.query(FeedComment)
                      .filter(FeedComment.post_id == post.id)
                      .order_by(FeedComment.id.asc()).all()],
        "creator": {
            "id": c.id if c else None,
            "name": c.name if c else "Unknown",
            "handle": handle_for(c.name) if c else "unknown",
            "has_avatar": bool(c and c.avatar_path),
            "badge": _quick_badge(c) if c else "none",
        },
    }


def feed_page(db: Session, creator_id: int = None, skip: int = 0, limit: int = 10,
              seed: int = None) -> list[dict]:
    q = db.query(FeedPost)
    if creator_id:
        q = q.filter(FeedPost.creator_id == creator_id)
    if seed:
        # "The algorithm" — deterministic pseudo-shuffle keyed by the visit's seed,
        # so pagination stays stable within a visit but every return reshuffles.
        # Derive a large multiplier from the seed so id*m wraps the prime modulus
        # constantly — small multipliers would leave the order nearly untouched.
        m = (seed * 7919 + 104729) % 100003
        if m < 1000:
            m += 12345
        q = q.order_by(((FeedPost.id * m) % 100003).asc(), FeedPost.id.asc())
    else:
        q = q.order_by(FeedPost.posted_at.desc(), FeedPost.id.desc())
    posts = q.offset(skip).limit(limit).all()
    return [_serialize_post(db, p) for p in posts]


def stories_feed(db: Session) -> list[dict]:
    """Active (last 24h) stories grouped per creator — unviewed groups first."""
    cutoff = datetime.now() - timedelta(hours=24)
    rows = (db.query(FeedStory)
              .filter(FeedStory.posted_at >= cutoff)
              .order_by(FeedStory.posted_at.asc())
              .all())
    groups: dict[int, list[FeedStory]] = {}
    for s in rows:
        groups.setdefault(s.creator_id, []).append(s)

    out = []
    for creator_id, stories in groups.items():
        c = stories[0].creator
        if not c:
            continue
        img_rows = db.query(Image.id, Image.is_video, Image.duration, Image.gallery_id) \
                     .filter(Image.id.in_([s.image_id for s in stories])).all()
        by_id = {r[0]: r for r in img_rows}
        items = [{
            "id": s.id,
            "image_id": s.image_id,
            "is_video": bool(by_id[s.image_id][1]),
            "duration": by_id[s.image_id][2],
            "gallery_id": by_id[s.image_id][3],
            "posted_at": s.posted_at.isoformat() if s.posted_at else None,
            "viewed": bool(s.viewed),
        } for s in stories if s.image_id in by_id]
        if not items:
            continue
        out.append({
            "creator": {
                "id": c.id, "name": c.name,
                "handle": handle_for(c.name),
                "has_avatar": bool(c.avatar_path),
            },
            "stories": items,
            "all_viewed": all(i["viewed"] for i in items),
            "latest": max(i["posted_at"] or "" for i in items),
        })
    # Unviewed rings first, most recent activity first within each class
    out.sort(key=lambda g: g["latest"], reverse=True)
    out.sort(key=lambda g: g["all_viewed"])
    return out


def mark_story_seen(db: Session, story_id: int) -> dict:
    story = db.query(FeedStory).filter(FeedStory.id == story_id).first()
    if not story:
        return {"error": "not found"}
    if not story.viewed:
        story.viewed = True
        db.commit()
    return {"viewed": True}


def persona_feed_context(db: Session, creator_id: int) -> str:
    """A short natural-language summary of what this creator has posted lately,
    for injection into her AI chat prompt so she can reference her own feed."""
    posts = (db.query(FeedPost)
               .filter(FeedPost.creator_id == creator_id)
               .order_by(FeedPost.posted_at.desc(), FeedPost.id.desc())
               .limit(4).all())
    if not posts:
        return ""
    lines = []
    for p in posts:
        try:
            ids = json.loads(p.image_ids or "[]")
        except (ValueError, TypeError):
            ids = []
        tags = _post_hashtags(db, ids, limit=4)
        caption = (p.caption or "").strip()
        tag_str = f" [{', '.join(tags)}]" if tags else ""
        if caption:
            lines.append(f'- "{caption}"{tag_str}')
    if not lines:
        return ""
    return (
        "\n\nYour recent posts on the feed (you can reference these naturally if it "
        "comes up — he may have seen them):\n" + "\n".join(lines)
    )


def toggle_like(db: Session, post_id: int) -> dict:
    post = db.query(FeedPost).filter(FeedPost.id == post_id).first()
    if not post:
        return {"error": "not found"}
    post.liked = not bool(post.liked)
    db.commit()
    return {"liked": post.liked}


# ── Sim profile & social standing ─────────────────────────────────────────────

# Modest rarity nudge — collection prestige, but interaction dominates
RARITY_FOLLOWER_BONUS = {
    "common":    0,
    "uncommon":  4_000,
    "rare":      18_000,
    "epic":      55_000,
    "legendary": 140_000,
}


def _quick_badge(c) -> str:
    """Cheap badge from creator-row fields only (for post headers).
    Interaction-driven: being a favorite is worth a lot, bonding/rating push to gold."""
    score = (
        60 * (1 if c.is_favorite else 0)
        + 25 * (c.bond_gifts or 0)
        + 8 * (c.rating or 0)
        + 15 * (c.companion_bond_level or 0)
    )
    return "gold" if score >= 130 else "blue" if score >= 45 else "none"


def _creator_social(db, c, collection: int, cum: int) -> tuple[int, str]:
    """Returns (followers, badge). Interaction (favorite/rating/bond/likes/usage)
    dominates; raw collection size is a low-weight contributor. Unknown creators
    with no interaction end up with few followers and no verified badge."""
    likes = (db.query(func.count(FeedPost.id))
               .filter(FeedPost.creator_id == c.id, FeedPost.liked == True)
               .scalar()) or 0

    badge_score = (
        60 * (1 if c.is_favorite else 0)
        + 25 * (c.bond_gifts or 0)
        + 8 * (c.rating or 0)
        + 12 * likes
        + 0.4 * min(int(cum), 400)
        + 15 * (c.companion_bond_level or 0)
        + 0.02 * collection
    )
    badge = "gold" if badge_score >= 130 else "blue" if badge_score >= 45 else "none"

    rng = random.Random(c.id)
    followers = int(
        500
        + collection * 5
        + int(cum) * 60
        + (c.rating or 0) * 15_000
        + (c.bond_gifts or 0) * 40_000
        + (400_000 if c.is_favorite else 0)
        + likes * 8_000
        + (c.companion_bond_level or 0) * 30_000
        + RARITY_FOLLOWER_BONUS.get(c.card_rarity or "common", 0)
        + rng.randint(0, 3_000)
    )
    return followers, badge


def sim_profile(db: Session, creator_id: int) -> dict | None:
    c = db.query(Creator).filter(Creator.id == creator_id).first()
    if not c:
        return None

    image_count = (db.query(func.count(Image.id))
                     .join(Gallery, Gallery.id == Image.gallery_id)
                     .join(gallery_creators, gallery_creators.c.gallery_id == Gallery.id)
                     .filter(gallery_creators.c.creator_id == creator_id)
                     .scalar()) or 0
    cum = (db.query(func.coalesce(func.sum(Gallery.cum_count), 0))
             .join(gallery_creators, gallery_creators.c.gallery_id == Gallery.id)
             .filter(gallery_creators.c.creator_id == creator_id)
             .scalar()) or 0
    post_count = db.query(func.count(FeedPost.id)).filter(FeedPost.creator_id == creator_id).scalar() or 0

    # Interaction-weighted social standing — the more you love her, the bigger she is
    followers, badge = _creator_social(db, c, image_count, int(cum))
    following = random.Random(creator_id * 7).randint(48, 900)

    highlights = (db.query(Gallery.id, Gallery.name, Gallery.cover_thumb)
                    .join(gallery_creators, gallery_creators.c.gallery_id == Gallery.id)
                    .filter(gallery_creators.c.creator_id == creator_id)
                    .filter(Gallery.is_favorite == True)
                    .order_by(Gallery.view_count.desc())
                    .limit(8).all())

    video_count = (db.query(func.count(Image.id))
                     .join(Gallery, Gallery.id == Image.gallery_id)
                     .join(gallery_creators, gallery_creators.c.gallery_id == Gallery.id)
                     .filter(gallery_creators.c.creator_id == creator_id)
                     .filter(Image.is_video == True)
                     .scalar()) or 0

    return {
        "id": c.id,
        "name": c.name,
        "handle": handle_for(c.name),
        "bio": (c.description or c.lore or "")[:220],
        "creator_type": c.creator_type.value if c.creator_type else "custom",
        "card_rarity": c.card_rarity or "common",
        "badge": badge,
        # verify on disk — a stale avatar path would otherwise render an empty circle
        "has_avatar": bool(c.avatar_path and os.path.exists(c.avatar_path)),
        "has_banner": bool(c.banner_path or c.banner_image_id),
        "banner_image_id": c.banner_image_id,
        "is_favorite": bool(c.is_favorite),
        "post_count": post_count,
        "followers": followers,
        "following": following,
        "image_count": image_count - video_count,
        "video_count": video_count,
        "cum_count": int(cum),
        "highlights": [{"id": h[0], "name": h[1], "cover_thumb": h[2]} for h in highlights],
    }


# ── Search: creators + on-the-fly tag content (ephemeral until liked) ─────────

def _seed_mult(seed: int) -> int:
    """Large multiplier derived from a seed so id*m wraps the prime modulus often
    (small multipliers barely reorder). Mirrors feed_page's shuffle."""
    m = (int(seed) * 7919 + 104729) % 100003
    return m + 12345 if m < 1000 else m


def _serialize_search_images(db: Session, rows) -> list[dict]:
    """rows: (id, is_video, gallery_id, width, height) → post-ready dicts w/ creator."""
    gallery_ids = {r[2] for r in rows if r[2]}
    creator_by_gallery: dict[int, Creator] = {}
    if gallery_ids:
        crows = (db.query(gallery_creators.c.gallery_id, Creator)
                   .join(Creator, Creator.id == gallery_creators.c.creator_id)
                   .filter(gallery_creators.c.gallery_id.in_(gallery_ids)).all())
        for gid, c in crows:
            creator_by_gallery.setdefault(gid, c)
    out = []
    for r in rows:
        c = creator_by_gallery.get(r[2])
        out.append({
            "id": r[0], "is_video": bool(r[1]), "gallery_id": r[2],
            "width": r[3], "height": r[4],
            "creator": ({"id": c.id, "name": c.name, "handle": handle_for(c.name),
                         "has_avatar": bool(c.avatar_path)} if c else None),
        })
    return out


def search(db: Session, q: str, seed: int = None, skip: int = 0, limit: int = 30) -> dict:
    """Smart Explore search. Matches creators by name AND generates a capped,
    seed-shuffled wall of images for a matching tag. Tag results are transient —
    they only become permanent feed posts when the user likes/saves one."""
    clean = (q or "").strip().lstrip("#").strip()
    result = {"query": clean, "tag": None, "creators": [], "images": []}
    if not clean:
        return result

    # Creators by name — only on the first page
    if skip == 0:
        crs = (db.query(Creator)
                 .filter(Creator.name.ilike(f"%{clean}%"))
                 .order_by(Creator.is_favorite.desc(), Creator.name.asc())
                 .limit(8).all())
        result["creators"] = [{
            "id": c.id, "name": c.name, "handle": handle_for(c.name),
            "has_avatar": bool(c.avatar_path and os.path.exists(c.avatar_path)),
        } for c in crs]

    # Tag content — exact (case-insensitive) match preferred, else most-used ilike hit
    tag = (db.query(Tag).filter(func.lower(Tag.name) == clean.lower()).first()
           or db.query(Tag).filter(Tag.name.ilike(f"%{clean}%"))
                 .order_by(Tag.use_count.desc()).first())
    if tag:
        result["tag"] = {"id": tag.id, "name": tag.name, "count": tag.use_count}
        img_q = (db.query(Image.id, Image.is_video, Image.gallery_id, Image.width, Image.height)
                   .join(image_tags, image_tags.c.image_id == Image.id)
                   .filter(image_tags.c.tag_id == tag.id)
                   .filter(Image.thumb_path.isnot(None)))
        if seed:
            m = _seed_mult(seed)
            img_q = img_q.order_by(((Image.id * m) % 100003).asc(), Image.id.asc())
        else:
            img_q = img_q.order_by(func.random())
        rows = img_q.offset(skip).limit(limit).all()
        result["images"] = _serialize_search_images(db, rows)
    return result


def toggle_search_save(db: Session, image_id: int, tag: str = None) -> dict:
    """Like a transient search post → persist it as a real FeedPost so it joins the
    timeline. Liking again removes it. Deduped by the single image id."""
    img = db.query(Image).filter(Image.id == image_id).first()
    if not img:
        return {"error": "not found"}
    key = json.dumps([image_id])
    existing = (db.query(FeedPost)
                  .filter(FeedPost.post_type == "saved", FeedPost.image_ids == key)
                  .first())
    if existing:
        db.delete(existing)
        db.commit()
        return {"saved": False}
    creator_id = (db.query(gallery_creators.c.creator_id)
                    .filter(gallery_creators.c.gallery_id == img.gallery_id)
                    .limit(1).scalar())
    caption = f"saved from #{tag} 💜" if tag else "saved to my feed 💜"
    post = FeedPost(creator_id=creator_id, post_type="saved", gallery_id=img.gallery_id,
                    image_ids=key, caption=caption, liked=True, posted_at=datetime.now())
    db.add(post)
    db.commit()
    return {"saved": True, "post_id": post.id}
