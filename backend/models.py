from sqlalchemy import (
    Column, Integer, String, Float, Boolean, DateTime, Text,
    ForeignKey, Table, Enum
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
import enum
from database import Base


# ── Many-to-many: images <-> tags ─────────────────────────────────────────────
image_tags = Table(
    "image_tags", Base.metadata,
    Column("image_id",     Integer, ForeignKey("images.id"), primary_key=True),
    Column("tag_id",       Integer, ForeignKey("tags.id"),   primary_key=True),
    Column("confidence",   Float,   nullable=True),   # AI tagger confidence 0–1
    Column("tagger_model", String,  nullable=True),   # e.g. "wd14-swinv2-v3"
)

# ── Many-to-many: images <-> creators (file-level override) ───────────────────
image_creators = Table(
    "image_creators", Base.metadata,
    Column("image_id",   Integer, ForeignKey("images.id"),   primary_key=True),
    Column("creator_id", Integer, ForeignKey("creators.id"), primary_key=True),
)

gallery_tags = Table(
    "gallery_tags", Base.metadata,
    Column("gallery_id", Integer, ForeignKey("galleries.id"), primary_key=True),
    Column("tag_id",     Integer, ForeignKey("tags.id"),      primary_key=True),
)

# ── Many-to-many: galleries <-> creators ──────────────────────────────────────
gallery_creators = Table(
    "gallery_creators", Base.metadata,
    Column("gallery_id", Integer, ForeignKey("galleries.id"), primary_key=True),
    Column("creator_id", Integer, ForeignKey("creators.id"), primary_key=True),
)


# ── Enums ──────────────────────────────────────────────────────────────────────
class CreatorType(str, enum.Enum):
    cosplayer  = "cosplayer"
    ethot      = "ethot"
    artist     = "artist"
    character  = "character"
    actress    = "actress"
    custom     = "custom"

class TagSource(str, enum.Enum):
    manual = "manual"
    ai     = "ai"

class QuestType(str, enum.Enum):
    daily   = "daily"
    weekly  = "weekly"
    boss    = "boss"

class QuestStatus(str, enum.Enum):
    active    = "active"
    completed = "completed"
    expired   = "expired"


# ── Creator / Character ────────────────────────────────────────────────────────
class Creator(Base):
    __tablename__ = "creators"

    id            = Column(Integer, primary_key=True, index=True)
    name          = Column(String, nullable=False)
    title         = Column(String)          # user-assigned title shown after "—" in header
    aliases       = Column(Text, default="")          # JSON array string
    creator_type  = Column(Enum(CreatorType), default=CreatorType.cosplayer)
    custom_type   = Column(String, nullable=True)     # if type == custom

    # Bio & lore
    description   = Column(Text, default="")
    lore          = Column(Text, default="")          # wiki-imported lore

    # Wiki
    wiki_url      = Column(String, nullable=True)
    wiki_source   = Column(String, nullable=True)     # fandom, wikipedia, etc.
    wiki_synced   = Column(DateTime, nullable=True)

    # Character-specific
    origin        = Column(String, nullable=True)     # "Lands Between", country
    series        = Column(String, nullable=True)     # "Elden Ring"
    developer     = Column(String, nullable=True)
    release_year  = Column(Integer, nullable=True)
    character_type = Column(String, nullable=True)    # "Deity / Boss"
    voice_actor   = Column(String, nullable=True)

    # Real person
    real_name     = Column(String, nullable=True)
    gender        = Column(String, nullable=True)
    eye_color     = Column(String, nullable=True)
    fake_boobs    = Column(Boolean, nullable=True)
    fake_ass      = Column(Boolean, nullable=True)
    date_of_birth = Column(String, nullable=True)
    height        = Column(Integer, nullable=True)
    body_measurements = Column(String, nullable=True)
    country       = Column(String, nullable=True)
    platform_links = Column(Text, default="")         # JSON
    patreon_price  = Column(Float, default=0.0)       # collection value estimate
    status         = Column(String, default="Active")
    retirement_year = Column(Integer, nullable=True)

    # Meta
    avatar_path      = Column(String, nullable=True)
    banner_path      = Column(String, nullable=True)
    banner_image_id  = Column(Integer, nullable=True)   # image ID used as banner
    banner_y         = Column(Float, default=20.0)      # vertical position 0-100
    banner_zoom      = Column(Float, default=1.0)       # zoom multiplier 1.0-2.0
    rating        = Column(Float, default=0.0)         # user rating 0-10
    is_favorite   = Column(Boolean, default=False)
    card_rarity   = Column(String, default="common")
    card_level    = Column(Integer, default=1)
    bond_gifts    = Column(Integer, default=0)         # hearts gifted by user → boosts bond score

    # AI companion
    companion_prompt    = Column(Text, nullable=True)      # custom persona system prompt
    personality_type    = Column(String, default='bold')   # shy | bold | dominant | playful | cold
    companion_bond_xp   = Column(Integer, default=0)
    companion_bond_level = Column(Integer, default=0)
    avatar_desc        = Column(Text, nullable=True)      # cached vision description of her PFP (so she knows her own look)
    avatar_desc_src    = Column(String, nullable=True)    # the avatar_path the desc was generated from (invalidates on change)
    personality_assigned = Column(Boolean, default=False) # True once a personality has been chosen (auto-random or by user)

    # 100% collection completion reward tracking — reset to None when completion drops
    completion_rewarded_at = Column(DateTime, nullable=True)

    # Auto-assign all galleries found under this directory path to this creator
    source_folder  = Column(String, nullable=True)

    created_at    = Column(DateTime, default=func.now())
    updated_at    = Column(DateTime, default=func.now(), onupdate=func.now())

    galleries        = relationship(
        "Gallery",
        back_populates="creator",
        cascade="all, delete",
        foreign_keys="[Gallery.creator_id]",
    )
    linked_galleries = relationship(
        "Gallery",
        secondary="gallery_creators",
        back_populates="creators",
    )


# ── Library Root ───────────────────────────────────────────────────────────────
class LibraryRoot(Base):
    __tablename__ = "library_roots"

    id         = Column(Integer, primary_key=True, index=True)
    path       = Column(String, nullable=False, unique=True)
    label      = Column(String, nullable=True)
    enabled    = Column(Boolean, default=True)
    created_at = Column(DateTime, default=func.now())
    last_scan  = Column(DateTime, nullable=True)

    galleries  = relationship("Gallery", back_populates="library_root")


# ── Many-to-many: mix galleries <-> images ────────────────────────────────────
mix_images = Table(
    "mix_images", Base.metadata,
    Column("gallery_id", Integer, ForeignKey("galleries.id"), primary_key=True),
    Column("image_id",   Integer, ForeignKey("images.id"),    primary_key=True),
    Column("sort_order", Integer, default=0),
)


# ── Gallery ────────────────────────────────────────────────────────────────────
class Gallery(Base):
    __tablename__ = "galleries"

    id            = Column(Integer, primary_key=True, index=True)
    name          = Column(String, nullable=False)
    folder_path   = Column(String, nullable=False, unique=True)
    is_mix        = Column(Boolean, default=False)
    cover_path    = Column(String, nullable=True)
    cover_thumb   = Column(String, nullable=True)

    creator_id    = Column(Integer, ForeignKey("creators.id"), nullable=True)
    library_root_id = Column(Integer, ForeignKey("library_roots.id"), nullable=True)

    description   = Column(Text, default="")
    rating        = Column(Float, default=0.0)
    cum_count     = Column(Integer, default=0)
    view_count    = Column(Integer, default=0)
    image_count   = Column(Integer, default=0)

    is_favorite   = Column(Boolean, default=False)
    is_tagged     = Column(Boolean, default=False)
    linked_character_id = Column(Integer, ForeignKey("creators.id"), nullable=True)

    # Subscription period this gallery belongs to (month/year only)
    period_month  = Column(Integer, nullable=True)   # 1-12
    period_year   = Column(Integer, nullable=True)
    # One-time purchase value (PPV, Gumroad set, etc.)
    purchase_value = Column(Float, default=0.0)

    created_at    = Column(DateTime, default=func.now())
    updated_at    = Column(DateTime, default=func.now(), onupdate=func.now())
    scanned_at    = Column(DateTime, nullable=True)

    creator           = relationship(
        "Creator",
        back_populates="galleries",
        foreign_keys=[creator_id],
    )
    linked_character  = relationship(
        "Creator",
        foreign_keys=[linked_character_id],
    )
    creators      = relationship("Creator", secondary="gallery_creators", back_populates="linked_galleries")
    library_root  = relationship("LibraryRoot", back_populates="galleries")
    images        = relationship("Image", back_populates="gallery", cascade="all, delete")
    mix_image_list = relationship("Image", secondary="mix_images")
    tags          = relationship("Tag", secondary=gallery_tags, back_populates="galleries")


# ── Image ──────────────────────────────────────────────────────────────────────
class Image(Base):
    __tablename__ = "images"

    id            = Column(Integer, primary_key=True, index=True)
    filename      = Column(String, nullable=False)
    file_path     = Column(String, nullable=False, unique=True)
    thumb_path    = Column(String, nullable=True)

    gallery_id    = Column(Integer, ForeignKey("galleries.id"), nullable=False)

    width         = Column(Integer, nullable=True)
    height        = Column(Integer, nullable=True)
    file_size     = Column(Integer, nullable=True)     # bytes
    mime_type     = Column(String, nullable=True)

    # Video fields
    is_video      = Column(Boolean, default=False)
    duration      = Column(Float, nullable=True)       # seconds
    funscript_path = Column(String, nullable=True)
    preview_path  = Column(String, nullable=True)      # animated preview

    rating        = Column(Float, default=0.0)
    cum_count     = Column(Integer, default=0)
    view_count    = Column(Integer, default=0)
    view_seconds  = Column(Integer, default=0)   # lifetime seconds spent viewing
    is_favorite   = Column(Boolean, default=False)
    sort_order    = Column(Integer, default=0)

    ai_tagged     = Column(Boolean, default=False)
    ai_tag_model  = Column(String, nullable=True)
    person_count  = Column(Integer, nullable=True)   # populated by AI tagger

    # Focal point for card display (0.0–1.0); default = top-center (matches prior behaviour)
    focal_x          = Column(Float, default=0.5)
    focal_y          = Column(Float, default=0.0)

    # Perceptual hash for deduplication (pHash hex string, 64-bit)
    perceptual_hash  = Column(String, nullable=True, index=True)

    last_viewed_at   = Column(DateTime, nullable=True)
    file_modified_at = Column(DateTime, nullable=True)   # on-disk mtime, populated by scanner
    created_at       = Column(DateTime, default=func.now())

    gallery          = relationship("Gallery", back_populates="images")
    tags             = relationship("Tag", secondary=image_tags, back_populates="images")
    image_creators   = relationship("Creator", secondary="image_creators")


# ── Tag ────────────────────────────────────────────────────────────────────────
class Tag(Base):
    __tablename__ = "tags"

    id         = Column(Integer, primary_key=True, index=True)
    name       = Column(String, nullable=False, unique=True)
    category   = Column(String, default="general")    # pose, clothing, focus, content, etc.
    color      = Column(String, nullable=True)
    source     = Column(Enum(TagSource), default=TagSource.manual)
    use_count  = Column(Integer, default=0)

    images     = relationship("Image",   secondary=image_tags,   back_populates="tags")
    galleries  = relationship("Gallery", secondary=gallery_tags, back_populates="tags")


# ── Session Log ────────────────────────────────────────────────────────────────
class SessionLog(Base):
    __tablename__ = "session_logs"

    id           = Column(Integer, primary_key=True, index=True)
    logged_at    = Column(DateTime, default=func.now())
    duration_sec = Column(Integer, nullable=True)

    image_id     = Column(Integer, ForeignKey("images.id"),   nullable=True)
    gallery_id   = Column(Integer, ForeignKey("galleries.id"), nullable=True)
    creator_id   = Column(Integer, ForeignKey("creators.id"), nullable=True)

    notes        = Column(Text, nullable=True)
    xp_earned    = Column(Integer, default=25)


# ── Playlist ───────────────────────────────────────────────────────────────────
playlist_images = Table(
    "playlist_images", Base.metadata,
    Column("playlist_id", Integer, ForeignKey("playlists.id"), primary_key=True),
    Column("image_id",    Integer, ForeignKey("images.id"),    primary_key=True),
    Column("sort_order",  Integer, default=0),
)

class Playlist(Base):
    __tablename__ = "playlists"

    id          = Column(Integer, primary_key=True, index=True)
    name        = Column(String, nullable=False)
    description = Column(Text, default="")
    cover_thumb = Column(String, nullable=True)
    created_at  = Column(DateTime, default=func.now())

    images      = relationship("Image", secondary=playlist_images)


# ── Gamification ───────────────────────────────────────────────────────────────
class UserProfile(Base):
    __tablename__ = "user_profile"

    id             = Column(Integer, primary_key=True, default=1)
    username       = Column(String, default="Vault Master")
    total_xp       = Column(Integer, default=0)
    level          = Column(Integer, default=1)
    level_title    = Column(String, default="Lurker")
    streak_days    = Column(Integer, default=0)
    streak_best    = Column(Integer, default=0)
    last_login     = Column(DateTime, nullable=True)
    grace_tokens   = Column(Integer, default=1)
    last_spin      = Column(DateTime, nullable=True)
    theme_accent   = Column(String, default="#7F77DD")
    vault_credits  = Column(Integer, default=0)    # TCG spendable currency
    hearts         = Column(Integer, default=0)    # giftable hearts earned from dismantling rare+ cards
    avatar_path    = Column(String, nullable=True)
    avatar_focal_x = Column(Float, default=0.5)
    avatar_focal_y = Column(Float, default=0.5)
    selected_title = Column(String, nullable=True)
    created_at     = Column(DateTime, default=func.now())

    # ── Achievement tracking counters ──────────────────────────────────────────
    total_cum_count    = Column(Integer, default=0)   # all-time Os
    daily_cum_count    = Column(Integer, default=0)   # resets each day
    last_cum_date      = Column(DateTime, nullable=True)
    total_images_rated = Column(Integer, default=0)
    total_tags_added   = Column(Integer, default=0)
    tags_added_today   = Column(Integer, default=0)
    last_tag_date      = Column(DateTime, nullable=True)
    wiki_import_count  = Column(Integer, default=0)
    total_sessions_logged  = Column(Integer, default=0)
    total_packs_opened     = Column(Integer, default=0)
    daily_bonus_date       = Column(DateTime, nullable=True)
    weekly_bonus_week      = Column(Integer, nullable=True)
    standard_packs         = Column(Integer, default=0)   # unspent quest-awarded standard packs
    premium_packs          = Column(Integer, default=0)   # unspent quest-awarded premium packs
    daily_bonus_claimable  = Column(Boolean, default=False)   # True = all dailies done, packs not yet claimed
    weekly_bonus_claimable = Column(Boolean, default=False)   # True = all weeklies done, packs not yet claimed
    total_cards_dismantled = Column(Integer, default=0)


class Quest(Base):
    __tablename__ = "quests"

    id           = Column(Integer, primary_key=True, index=True)
    key          = Column(String, nullable=False)           # e.g. "daily_login"
    title        = Column(String, nullable=False)
    description  = Column(Text, default="")
    quest_type   = Column(Enum(QuestType), default=QuestType.daily)
    xp_reward    = Column(Integer, default=50)
    target       = Column(Integer, default=1)               # target count
    progress     = Column(Integer, default=0)
    status       = Column(Enum(QuestStatus), default=QuestStatus.active)
    expires_at   = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)
    icon         = Column(String, default="ti-target")
    credit_reward = Column(Integer, default=0)


class Achievement(Base):
    __tablename__ = "achievements"

    id           = Column(Integer, primary_key=True, index=True)
    key          = Column(String, nullable=False, unique=True)
    title        = Column(String, nullable=False)
    description  = Column(Text, default="")
    icon         = Column(String, default="ti-award")
    xp_reward    = Column(Integer, default=100)
    credit_reward = Column(Integer, default=0)
    unlocked     = Column(Boolean, default=False)
    unlocked_at  = Column(DateTime, nullable=True)


class XPEvent(Base):
    __tablename__ = "xp_events"

    id         = Column(Integer, primary_key=True, index=True)
    reason     = Column(String, nullable=False)
    amount     = Column(Integer, nullable=False)
    multiplier = Column(Float, default=1.0)
    earned_at  = Column(DateTime, default=func.now())


# ── TCG: Card types & rarities ────────────────────────────────────────────────
class CardType(str, enum.Enum):
    image   = "image"
    gallery = "gallery"
    creator = "creator"
    goon    = "goon"      # image with cum_count >= threshold
    variant = "variant"   # creator × character intersection
    collab  = "collab"    # 2+ cosplayers in same gallery (image, gallery, or variant sub-type)

class CardRarity(str, enum.Enum):
    common    = "common"
    uncommon  = "uncommon"
    rare      = "rare"
    epic      = "epic"
    legendary = "legendary"
    relic     = "relic"
    celestial = "celestial"


# ── TCG: Card (master record) ─────────────────────────────────────────────────
class Card(Base):
    __tablename__ = "cards"

    id                 = Column(Integer, primary_key=True, index=True)
    card_type          = Column(Enum(CardType), nullable=False)
    rarity             = Column(Enum(CardRarity), default=CardRarity.common)
    is_relic           = Column(Boolean, default=False)   # apex relic flag
    is_unique          = Column(Boolean, default=False)   # unique vs infinite

    # Source asset links (only the relevant one is set per card_type)
    source_image_id    = Column(Integer, ForeignKey("images.id"),   nullable=True)
    source_gallery_id  = Column(Integer, ForeignKey("galleries.id"), nullable=True)
    source_creator_id  = Column(Integer, ForeignKey("creators.id"), nullable=True)
    # For variant cards: both creator + character are set
    linked_character_id = Column(Integer, ForeignKey("creators.id"), nullable=True)

    # Card XP (organic grind via sessions)
    cxp               = Column(Integer, default=0)

    # Collab metadata (JSON for multi-creator/character collabs)
    collab_data       = Column(Text, nullable=True)

    # Tracking
    generated_at      = Column(DateTime, default=func.now())
    last_viewed_at    = Column(DateTime, nullable=True)

    # Relationships
    source_image   = relationship("Image",   foreign_keys=[source_image_id])
    source_gallery = relationship("Gallery", foreign_keys=[source_gallery_id])
    source_creator = relationship("Creator", foreign_keys=[source_creator_id])
    linked_character = relationship("Creator", foreign_keys=[linked_character_id])


# ── TCG: Card Inventory (user's owned copies) ─────────────────────────────────
class CardInventory(Base):
    __tablename__ = "card_inventory"

    id       = Column(Integer, primary_key=True, index=True)
    card_id  = Column(Integer, ForeignKey("cards.id"), nullable=False)
    quantity = Column(Integer, default=1)

    card     = relationship("Card")


# ── TCG: Pack opening log ─────────────────────────────────────────────────────
class CardPack(Base):
    __tablename__ = "card_packs"

    id            = Column(Integer, primary_key=True, index=True)
    cost_credits  = Column(Integer, default=250)
    opened_at     = Column(DateTime, default=func.now())
    cards_awarded = Column(Text, default="[]")  # JSON list of card IDs


# ── TCG: Crafting materials (shards & catalyst tokens) ────────────────────────
class CraftingMaterials(Base):
    __tablename__ = "crafting_materials"

    id            = Column(Integer, primary_key=True, default=1)
    shards        = Column(Integer, default=0)
    catalyst_tokens = Column(Integer, default=0)


# ── Companion (Erika AI) ──────────────────────────────────────────────────────
class CompanionConfig(Base):
    __tablename__ = "companion_config"

    id                = Column(Integer, primary_key=True, default=1)
    enabled           = Column(Boolean, default=False)
    name              = Column(String, default='Erika')
    avatar_path       = Column(String, nullable=True)
    personality_base  = Column(String, default='warm')   # warm | teasing | dominant | shy
    active_persona_id = Column(Integer, ForeignKey("creators.id"), nullable=True)
    bond_xp           = Column(Integer, default=0)
    bond_level        = Column(Integer, default=0)
    is_visible        = Column(Boolean, default=True)
    ollama_url        = Column(String, default='http://localhost:11434')
    ollama_model      = Column(String, default='hf.co/HauhauCS/Qwen3.6-27B-Uncensored-HauhauCS-Balanced:IQ4_XS')
    saved_models      = Column(Text, default='[]')   # JSON array of model name strings
    keep_alive        = Column(String, default='10m') # Ollama keep_alive: "5m", "30m", "-1" (forever), "0" (immediate)
    num_ctx           = Column(Integer, default=16384) # Ollama context window size (tokens)
    vision_enabled    = Column(Boolean, default=True)  # feed persona avatar / linked vault photos to a vision model
    companion_prompt  = Column(Text, nullable=True)  # custom system prompt for Erika; null = auto-generate
    created_at        = Column(DateTime, default=func.now())

    active_persona = relationship("Creator", foreign_keys=[active_persona_id])


class CompanionMessage(Base):
    __tablename__ = "companion_messages"

    id             = Column(Integer, primary_key=True, index=True)
    role           = Column(String, nullable=False)    # 'user' | 'assistant'
    content        = Column(Text, nullable=False)
    persona_id     = Column(Integer, nullable=True)
    bond_level     = Column(Integer, nullable=True)
    image_data_url = Column(Text, nullable=True)      # full data:image/...;base64,... for display
    created_at     = Column(DateTime, default=func.now())


# ── TCG: Credit event audit log ───────────────────────────────────────────────
class CreditEvent(Base):
    __tablename__ = "credit_events"

    id         = Column(Integer, primary_key=True, index=True)
    source     = Column(String, nullable=False)   # e.g. "session_logged"
    amount     = Column(Integer, nullable=False)
    logged_at  = Column(DateTime, default=func.now())



# ── Feed: simulated social-media posts generated from the collection ──────────
class FeedPost(Base):
    __tablename__ = "feed_posts"

    id         = Column(Integer, primary_key=True, index=True)
    creator_id = Column(Integer, ForeignKey("creators.id", ondelete="CASCADE"), index=True)
    post_type  = Column(String, default="throwback")   # on_this_day | throwback | theme_day | fresh_drop
    gallery_id = Column(Integer, nullable=True)
    image_ids  = Column(Text, default="[]")            # JSON array of image ids, display order
    caption    = Column(Text, default="")
    theme_tag  = Column(String, nullable=True)         # set for theme_day posts
    liked      = Column(Boolean, default=False)
    posted_at  = Column(DateTime, index=True)

    creator    = relationship("Creator")


# ── Feed: 24h ephemeral stories ───────────────────────────────────────────────
class FeedStory(Base):
    __tablename__ = "feed_stories"

    id         = Column(Integer, primary_key=True, index=True)
    creator_id = Column(Integer, ForeignKey("creators.id", ondelete="CASCADE"), index=True)
    image_id   = Column(Integer, nullable=False)
    viewed     = Column(Boolean, default=False)
    posted_at  = Column(DateTime, index=True)

    creator    = relationship("Creator")


# ── Feed: fake engagement — comments from other creators & Erika ─────────────
class FeedComment(Base):
    __tablename__ = "feed_comments"

    id          = Column(Integer, primary_key=True, index=True)
    post_id     = Column(Integer, ForeignKey("feed_posts.id", ondelete="CASCADE"), index=True)
    creator_id  = Column(Integer, nullable=True)   # null → Erika
    author_name = Column(String, default="")
    text        = Column(Text, default="")
    created_at  = Column(DateTime, default=func.now())


# ── Explore: learned tag affinity powering the algorithmic wall ───────────────
class ExploreAffinity(Base):
    __tablename__ = "explore_affinity"

    tag_id = Column(Integer, primary_key=True)
    weight = Column(Float, default=0.0)


# ── Feed: a girl occasionally texts first — unread DM pings ──────────────────
class FeedDMPing(Base):
    __tablename__ = "feed_dm_pings"

    id         = Column(Integer, primary_key=True, index=True)
    creator_id = Column(Integer, ForeignKey("creators.id", ondelete="CASCADE"), index=True)
    message    = Column(Text, default="")
    read       = Column(Boolean, default=False)
    created_at = Column(DateTime, default=func.now())

    creator    = relationship("Creator")
