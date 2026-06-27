from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime
from models import CreatorType, QuestType, QuestStatus


# ── Tag ────────────────────────────────────────────────────────────────────────
class TagBase(BaseModel):
    name: str
    category: str = "general"
    color: Optional[str] = None

class TagCreate(TagBase):
    pass

class TagUpdate(BaseModel):
    name: Optional[str] = None
    category: Optional[str] = None

class TagMerge(BaseModel):
    source_id: int   # tag to absorb (will be deleted)
    target_id: int   # tag to keep

class TagStats(BaseModel):
    total_tags: int
    total_tagged_images: int
    by_category: dict

class TagOut(TagBase):
    id: int
    source: str
    use_count: int
    class Config:
        from_attributes = True

class ImageTagOut(TagBase):
    id: int
    source: str
    use_count: int
    confidence: Optional[float] = None
    tagger_model: Optional[str] = None
    class Config:
        from_attributes = True


# ── Creator ────────────────────────────────────────────────────────────────────
class CreatorBase(BaseModel):
    name: str
    title: Optional[str] = None
    creator_type: CreatorType = CreatorType.cosplayer
    custom_type: Optional[str] = None
    description: Optional[str] = ""
    lore: Optional[str] = ""
    wiki_url: Optional[str] = None
    origin: Optional[str] = None
    series: Optional[str] = None
    developer: Optional[str] = None
    release_year: Optional[int] = None
    character_type: Optional[str] = None
    voice_actor: Optional[str] = None
    country: Optional[str] = None
    real_name: Optional[str] = None
    gender: Optional[str] = None
    eye_color: Optional[str] = None
    fake_boobs: Optional[bool] = None
    fake_ass: Optional[bool] = None
    date_of_birth: Optional[str] = None
    height: Optional[int] = None
    body_measurements: Optional[str] = None
    platform_links:  Optional[str] = "{}"
    aliases:         Optional[str] = "[]"
    is_favorite:     bool = False
    rating:          Optional[float] = 0.0
    banner_image_id: Optional[int] = None
    banner_y:        Optional[float] = 20.0
    banner_zoom:     Optional[float] = 1.0
    patreon_price:   Optional[float] = 0.0
    status:          Optional[str] = "Active"
    retirement_year: Optional[int] = None
    source_folder:   Optional[str] = None

class CreatorCreate(CreatorBase):
    pass

class CreatorUpdate(CreatorBase):
    name: Optional[str] = None

class CreatorOut(CreatorBase):
    id: int
    card_rarity: str
    card_level: int
    avatar_path: Optional[str] = None
    banner_path: Optional[str] = None
    wiki_synced: Optional[datetime]
    created_at: datetime
    gallery_count: Optional[int] = 0
    image_count: Optional[int] = 0
    video_count: Optional[int] = 0
    cum_count: Optional[int] = 0
    total_size_gb: Optional[float] = 0.0
    session_count: Optional[int] = 0
    total_view_seconds: Optional[int] = 0
    collection_value: Optional[float] = 0.0
    sub_value: Optional[float] = 0.0
    one_time_value: Optional[float] = 0.0
    unique_months_total: Optional[int] = 0
    months_covered_recent: Optional[int] = 0
    total_months_expected: Optional[int] = 0
    completion_pct: Optional[float] = 0.0
    bond_level: Optional[int] = 0
    bond_score: Optional[float] = 0.0
    bond_excluded: Optional[bool] = False
    bond_gifts: int = 0
    personality_type: Optional[str] = None
    companion_bond_xp: Optional[int] = 0
    class Config:
        from_attributes = True


# ── Creator (minimal embed) ────────────────────────────────────────────────────
class CreatorMini(BaseModel):
    id: int
    name: str
    creator_type: CreatorType
    card_rarity: str
    class Config:
        from_attributes = True


# ── Gallery ────────────────────────────────────────────────────────────────────
class GalleryBase(BaseModel):
    name: str
    description: Optional[str] = ""
    creator_id: Optional[int] = None

class GalleryCreate(GalleryBase):
    folder_path: Optional[str] = None

class GalleryUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    creator_id: Optional[int] = None
    is_favorite: Optional[bool] = None
    rating: Optional[float] = None
    linked_character_id: Optional[int] = None
    period_month: Optional[int] = None
    period_year: Optional[int] = None
    purchase_value: Optional[float] = None

class GalleryOut(GalleryBase):
    id: int
    folder_path: str
    cover_thumb: Optional[str]
    rating: float
    cum_count: int
    view_count: int
    image_count: int
    is_favorite: bool
    is_tagged: bool
    is_mix: bool = False
    period_month: Optional[int] = None
    period_year: Optional[int] = None
    purchase_value: Optional[float] = 0.0
    created_at: datetime
    updated_at: Optional[datetime] = None
    tags: List[TagOut] = []
    creator_name: Optional[str] = None
    creators: List[CreatorMini] = []
    linked_character_id: Optional[int] = None
    class Config:
        from_attributes = True


# ── Image ──────────────────────────────────────────────────────────────────────
class ImageOut(BaseModel):
    id: int
    filename: str
    file_path: str
    thumb_path: Optional[str]
    gallery_id: int
    width: Optional[int]
    height: Optional[int]
    file_size: Optional[int]
    is_video: bool
    duration: Optional[float]
    funscript_path: Optional[str]
    rating: float
    cum_count: int
    view_count: int
    is_favorite: bool
    ai_tagged: bool
    ai_tag_model: Optional[str] = None
    person_count: Optional[int] = None
    sort_order: int
    tags: List[ImageTagOut] = []
    creators: List[dict] = []
    has_image_creators: bool = False
    file_creator_ids: List[int] = []
    gallery_name: Optional[str] = None
    class Config:
        from_attributes = True

class ImageUpdate(BaseModel):
    rating: Optional[float] = None
    is_favorite: Optional[bool] = None
    gallery_id: Optional[int] = None

class CumCountUpdate(BaseModel):
    gallery_id: Optional[int] = None
    creator_id: Optional[int] = None


# ── Session ────────────────────────────────────────────────────────────────────
class SessionCreate(BaseModel):
    image_id: Optional[int] = None
    gallery_id: Optional[int] = None
    creator_id: Optional[int] = None
    duration_sec: Optional[int] = None
    notes: Optional[str] = None
    skip_xp: bool = False  # True for secondary sessions (multi-panel multi-creator)

class SessionOut(BaseModel):
    id: int
    logged_at: datetime
    duration_sec: Optional[int]
    image_id: Optional[int]
    gallery_id: Optional[int]
    creator_id: Optional[int]
    xp_earned: int
    class Config:
        from_attributes = True


# ── Playlist ───────────────────────────────────────────────────────────────────
class PlaylistCreate(BaseModel):
    name: str
    description: Optional[str] = ""

class PlaylistOut(BaseModel):
    id: int
    name: str
    description: str
    cover_thumb: Optional[str]
    created_at: datetime
    image_count: Optional[int] = 0
    class Config:
        from_attributes = True


# ── Gamification ───────────────────────────────────────────────────────────────
class UserProfileOut(BaseModel):
    id: int
    username: str
    total_xp: int
    level: int
    level_title: str
    streak_days: int
    streak_best: int
    last_login: Optional[datetime]
    grace_tokens: int
    last_spin: Optional[datetime]
    theme_accent: str
    xp_to_next: int
    standard_packs: int = 0
    premium_packs: int = 0
    hearts: int = 0
    class Config:
        from_attributes = True

class QuestOut(BaseModel):
    id: int
    key: str
    title: str
    description: str
    quest_type: QuestType
    xp_reward: int
    target: int
    progress: int
    status: QuestStatus
    expires_at: Optional[datetime]
    completed_at: Optional[datetime]
    icon: str
    class Config:
        from_attributes = True

class AchievementOut(BaseModel):
    id: int
    key: str
    title: str
    description: str
    icon: str
    xp_reward: int
    unlocked: bool
    unlocked_at: Optional[datetime]
    class Config:
        from_attributes = True

class XPEventOut(BaseModel):
    reason: str
    amount: int
    multiplier: float
    total_xp: int
    level: int
    level_up: bool
    title: str = ""
    credits_earned: int = 0
    packs_awarded: Optional[dict] = None  # {"type": "standard"|"premium", "quantity": int}


# ── Scanner ────────────────────────────────────────────────────────────────────
class LibraryRootCreate(BaseModel):
    path: str
    label: Optional[str] = None

class LibraryRootOut(BaseModel):
    id: int
    path: str
    label: Optional[str]
    enabled: bool
    last_scan: Optional[datetime]
    created_at: datetime
    class Config:
        from_attributes = True

class ScanStatus(BaseModel):
    running: bool
    progress: int
    total: int
    current_path: Optional[str]
    new_galleries: int
    new_images: int
    message: str


# ── AI Tagger ──────────────────────────────────────────────────────────────────
class TaggerStatus(BaseModel):
    running: bool
    progress: int
    total: int
    tagged: int
    skipped: int
    errors: int
    message: str
    current_path: Optional[str] = None
    cancelled: bool = False
    active_model: Optional[str] = None   # "WD14" | "JoyTag" | "Auto" | None
    device: Optional[str] = None         # "gpu" | "cpu" | None
    cuda_available: bool = False

class TaggerStartRequest(BaseModel):
    scope: str = "library"               # "library" | "folder" | "creator"
    folder_path: Optional[str] = None
    creator_id: Optional[int] = None
    threshold: float = 0.35
    retag: bool = False                  # re-tag already-tagged images
    model_override: Optional[str] = None # "wd14" | "joytag" | None (auto)

class ModelStatus(BaseModel):
    wd14_downloaded: bool
    joytag_downloaded: bool
    wd14_size_mb: Optional[float] = None
    joytag_size_mb: Optional[float] = None


# ── Companion ─────────────────────────────────────────────────────────────────
class CompanionConfigOut(BaseModel):
    id: int
    enabled: bool
    name: str
    avatar_path: Optional[str] = None
    personality_base: str
    active_persona_id: Optional[int] = None
    bond_xp: int
    bond_level: int
    is_visible: bool
    ollama_url: str
    ollama_model: str
    saved_models: str
    keep_alive: str = "10m"
    num_ctx: int = 16384
    companion_prompt: Optional[str] = None
    class Config:
        from_attributes = True

class CompanionConfigUpdate(BaseModel):
    enabled: Optional[bool] = None
    name: Optional[str] = None
    personality_base: Optional[str] = None
    active_persona_id: Optional[int] = None
    is_visible: Optional[bool] = None
    ollama_url: Optional[str] = None
    ollama_model: Optional[str] = None
    saved_models: Optional[str] = None
    keep_alive: Optional[str] = None
    num_ctx: Optional[int] = None
    companion_prompt: Optional[str] = None

class CompanionMessageOut(BaseModel):
    id: int
    role: str
    content: str
    persona_id: Optional[int] = None
    bond_level: Optional[int] = None
    image_data_url: Optional[str] = None
    created_at: datetime
    class Config:
        from_attributes = True


# ── Stats ──────────────────────────────────────────────────────────────────────
class VaultStats(BaseModel):
    total_images: int
    total_galleries: int
    total_creators: int
    total_sessions: int
    total_cum_count: int
    untagged_galleries: int
    recent_galleries: List[GalleryOut] = []
