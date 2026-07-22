from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from database import get_db
import services.feed as feed_svc
import services.explore as explore_svc

router = APIRouter()


@router.get("/explore")
def explore(seed_image: int = None, limit: int = 15, db: Session = Depends(get_db)):
    """Algorithmic explore wall — endless; each call returns a fresh ranked batch."""
    return explore_svc.explore_feed(db, seed_image_id=seed_image, limit=min(limit, 40))


@router.get("/search")
def feed_search(q: str = "", seed: int = None, skip: int = 0, limit: int = 30, db: Session = Depends(get_db)):
    """Smart Explore search: matching creators + a seed-shuffled, capped wall of
    images for a matching tag. Tag posts are ephemeral until saved."""
    return feed_svc.search(db, q, seed=seed, skip=skip, limit=min(limit, 60))


@router.post("/search/save")
def feed_search_save(data: dict, db: Session = Depends(get_db)):
    """Like/unlike a transient search post → persist/remove it as a real feed post."""
    image_id = data.get("image_id")
    if not image_id:
        raise HTTPException(400, "image_id required")
    res = feed_svc.toggle_search_save(db, int(image_id), data.get("tag"))
    if "error" in res:
        raise HTTPException(404, "Image not found")
    return res


@router.post("/explore/interact")
def explore_interact(data: dict, db: Session = Depends(get_db)):
    """Record that the user engaged with an image, to learn their taste.
    Likes send strength 2 so they weigh double a mere open."""
    image_id = data.get("image_id")
    if not image_id:
        raise HTTPException(400, "image_id required")
    try:
        strength = min(3.0, max(0.5, float(data.get("strength", 1))))
    except (TypeError, ValueError):
        strength = 1.0
    return explore_svc.record_interaction(db, int(image_id), strength)


@router.get("/")
def list_feed(creator_id: int = None, skip: int = 0, limit: int = 10, seed: int = None,
              db: Session = Depends(get_db)):
    """Feed timeline. Chronological by default; pass a seed for a shuffled 'algorithm' order."""
    return feed_svc.feed_page(db, creator_id=creator_id, skip=skip, limit=min(limit, 50), seed=seed)


@router.post("/generate")
def generate_today(db: Session = Depends(get_db)):
    """Generate today's posts if this is the first visit of the day (idempotent)."""
    return {"generated": feed_svc.ensure_posts_for_today(db)}


@router.get("/dm")
def list_dm_pings(db: Session = Depends(get_db)):
    """Unread 'she texted you first' pings."""
    return feed_svc.dm_pings(db)


@router.post("/dm/{ping_id}/read")
def dm_read(ping_id: int, db: Session = Depends(get_db)):
    result = feed_svc.mark_dm_read(db, ping_id)
    if "error" in result:
        raise HTTPException(404, "Ping not found")
    return result


@router.get("/stories")
def list_stories(db: Session = Depends(get_db)):
    """Active stories (last 24h) grouped per creator, unviewed first."""
    return feed_svc.stories_feed(db)


@router.post("/stories/{story_id}/seen")
def story_seen(story_id: int, db: Session = Depends(get_db)):
    result = feed_svc.mark_story_seen(db, story_id)
    if "error" in result:
        raise HTTPException(404, "Story not found")
    return result


@router.post("/{post_id}/like")
def like_post(post_id: int, db: Session = Depends(get_db)):
    result = feed_svc.toggle_like(db, post_id)
    if "error" in result:
        raise HTTPException(404, "Post not found")
    # Your public attention on her post — a bonded girl may notice and get jealous.
    try:
        from services.simulation import on_user_engagement
        if result.get("liked") and result.get("creator_id"):
            on_user_engagement(db, result["creator_id"], "like")
    except Exception:
        pass
    return result


@router.post("/{post_id}/comment")
def comment_post(post_id: int, data: dict, db: Session = Depends(get_db)):
    text = (data.get("text") or "").strip()
    if not text:
        raise HTTPException(400, "Empty comment")
    result = feed_svc.add_user_comment(db, post_id, text)
    if "error" in result:
        raise HTTPException(404, "Post not found")
    try:
        from services.simulation import on_user_engagement
        if result.get("creator_id"):
            on_user_engagement(db, result["creator_id"], "comment")
    except Exception:
        pass
    return result


@router.get("/profile/{creator_id}")
def sim_profile(creator_id: int, db: Session = Depends(get_db)):
    """Social-media style profile data for a creator."""
    profile = feed_svc.sim_profile(db, creator_id)
    if not profile:
        raise HTTPException(404, "Creator not found")
    return profile
