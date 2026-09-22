from sqlalchemy import (
    Column, Integer, String, Float, Boolean, DateTime, Text,
    ForeignKey, Table, Enum, UniqueConstraint, CheckConstraint, Index, text
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
    vulgarity          = Column(Integer, nullable=True)   # baseline dirty-mouth 0-100 (how much she swears by default)
    showcase_mastery_at = Column(DateTime, nullable=True) # when her 5-slot card Showcase was first completed

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


# ── Intake: staging area between a downloads folder and the vault ─────────────
class IntakeRoot(Base):
    """A folder that is scanned for *candidate* files (e.g. Downloads). Kept
    strictly separate from LibraryRoot — the library scanner never walks these,
    so nothing here becomes a gallery until it is committed (moved into place)."""
    __tablename__ = "intake_roots"

    id         = Column(Integer, primary_key=True, index=True)
    path       = Column(String, nullable=False, unique=True)
    label      = Column(String, nullable=True)
    enabled    = Column(Boolean, default=True)
    created_at = Column(DateTime, default=func.now())
    last_scan  = Column(DateTime, nullable=True)


class IntakeFolder(Base):
    """A top-level directory discovered inside an intake root.

    It moves as one filesystem unit so the normal scanner preserves the
    folder=gallery contract, including nested galleries and sidecars.
    """
    __tablename__ = "intake_folders"

    id            = Column(Integer, primary_key=True, index=True)
    root_id       = Column(Integer, ForeignKey("intake_roots.id", ondelete="SET NULL"), nullable=True, index=True)
    source_path   = Column(String, nullable=False, unique=True)
    name          = Column(String, nullable=False)
    file_count    = Column(Integer, default=0)
    video_count   = Column(Integer, default=0)
    total_size    = Column(Integer, default=0)
    source_mtime  = Column(Float, nullable=True)
    thumb_path    = Column(String, nullable=True)
    status        = Column(String, default="pending", index=True)
    error         = Column(Text, nullable=True)
    discovered_at = Column(DateTime, default=func.now())


class IntakeItem(Base):
    """A single candidate file discovered in an intake root. DB-only until
    committed — no Gallery/Image rows exist for it yet. Committing physically
    moves the file into the vault and lets the normal scanner register it."""
    __tablename__ = "intake_items"

    id            = Column(Integer, primary_key=True, index=True)
    root_id       = Column(Integer, ForeignKey("intake_roots.id", ondelete="SET NULL"), nullable=True, index=True)
    folder_id     = Column(Integer, ForeignKey("intake_folders.id", ondelete="SET NULL"), nullable=True, index=True)
    source_path   = Column(String, nullable=False, unique=True)   # where the file lives right now
    filename      = Column(String, nullable=False)
    file_size     = Column(Integer, nullable=True)                 # bytes
    source_mtime  = Column(Float, nullable=True)
    width         = Column(Integer, nullable=True)
    height        = Column(Integer, nullable=True)
    duration      = Column(Float, nullable=True)
    is_video      = Column(Boolean, default=False)
    is_archive    = Column(Boolean, default=False)                 # .zip/.rar/.7z — extracted into destination on commit
    has_funscript = Column(Boolean, default=False)                 # sidecar detected alongside
    thumb_path    = Column(String, nullable=True)                  # triage-grid preview
    phash         = Column(String, nullable=True)                  # pHash hex ("" = hash failed, don't retry)
    content_hash  = Column(String, nullable=True)
    duplicate_of  = Column(Integer, nullable=True)                 # images.id of a likely vault duplicate
    duplicate_kind = Column(String, nullable=True)
    duplicate_distance = Column(Integer, nullable=True)
    status        = Column(String, default="pending", index=True)  # pending | hidden | ignored | committed | error
    error         = Column(Text, nullable=True)                    # last commit error message
    discovered_at = Column(DateTime, default=func.now())


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
    edge_count    = Column(Integer, default=0)   # lifetime, never resets
    view_count    = Column(Integer, default=0)
    image_count   = Column(Integer, default=0)

    is_favorite   = Column(Boolean, default=False)
    is_tagged     = Column(Boolean, default=False)
    is_missing    = Column(Boolean, default=False, index=True)
    missing_since = Column(DateTime, nullable=True)
    linked_character_id = Column(Integer, ForeignKey("creators.id"), nullable=True)

    # Subscription period this gallery belongs to (month/year only)
    period_month  = Column(Integer, nullable=True)   # 1-12
    period_year   = Column(Integer, nullable=True)
    # One-time purchase value (PPV, Gumroad set, etc.)
    purchase_value = Column(Float, default=0.0)

    created_at    = Column(DateTime, default=func.now())
    updated_at    = Column(DateTime, default=func.now(), onupdate=func.now())
    scanned_at    = Column(DateTime, nullable=True)

    # Collection Curating — when this gallery was last curated (90-day cooldown) and,
    # separately, a short "not now" snooze so a skip doesn't cost a full quarter.
    curated_at           = Column(DateTime, nullable=True, index=True)
    curate_snooze_until  = Column(DateTime, nullable=True, index=True)

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
    notes         = Column(Text, default="")
    cum_count     = Column(Integer, default=0)
    edge_count    = Column(Integer, default=0)   # lifetime, never resets
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
    content_hash     = Column(String, nullable=True, index=True)

    # Subject/background mask, for the card foil effects. Packed RGBA PNG:
    # R = subject alpha, G = edge band, B = reserved. `mask_quality` is
    # the pipeline's own confidence — below the bar the card falls back to a
    # whole-card holo rather than showing a bad cutout.
    mask_path        = Column(String, nullable=True)
    mask_quality     = Column(Float, nullable=True)
    mask_status      = Column(String, nullable=True)  # usable | fallback | pending_retry
    mask_failure_reason = Column(String, nullable=True)
    mask_pipeline_version = Column(String, nullable=True)
    mask_visual_mode = Column(String, nullable=True)  # layered | flat

    last_viewed_at   = Column(DateTime, nullable=True)
    # Collection Curating — file-level cooldown for dump-style libraries where
    # one folder contains many unrelated files.
    curated_at           = Column(DateTime, nullable=True, index=True)
    curate_snooze_until  = Column(DateTime, nullable=True, index=True)
    # Two different real-world dates, and the distinction matters for the almanac:
    #   file_modified_at = when the content was authored/published — its vintage
    #   file_created_at  = when it landed on your drive — when YOU acquired it
    # The gap between them is your acquisition lag.
    file_modified_at = Column(DateTime, nullable=True)   # on-disk mtime, populated by scanner
    file_created_at  = Column(DateTime, nullable=True)   # on-disk ctime/birthtime
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
    is_favorite = Column(Boolean, default=False, nullable=False)

    images     = relationship("Image",   secondary=image_tags,   back_populates="tags")
    galleries  = relationship("Gallery", secondary=gallery_tags, back_populates="tags")


# ── AI tag vocabulary allowlist ─────────────────────────────────────────────────
class TagVocabEntry(Base):
    __tablename__ = "tag_vocab_entries"

    id                  = Column(Integer, primary_key=True, index=True)
    model               = Column(String, nullable=False)   # "wd14" | "joytag"
    raw_tag             = Column(String, nullable=False)   # raw model vocab key (lowercase, as shipped)
    normalized_name     = Column(String, nullable=False)   # output Tag.name when enabled
    category            = Column(String, default="general")
    enabled             = Column(Boolean, default=False)
    is_builtin_default  = Column(Boolean, default=False)   # shipped in WD14_TAG_MAP/JOYTAG_TAG_MAP
    # Optional per-raw-tag confidence floor. NULL means use the run's global
    # threshold (and the tagger's safety floor for color tags).
    confidence_threshold = Column(Float, nullable=True)

    __table_args__ = (UniqueConstraint("model", "raw_tag", name="uq_tag_vocab_model_raw"),)


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


# ── First-class funscripts ────────────────────────────────────────────────────
#
# These records are an index/cache over files on disk.  The file remains the
# source of truth; deleting or moving a media item must not implicitly delete a
# script record.  A script may be referenced by more than one video, therefore
# source_image_id is only optional context and the path is the identity.
funscript_tags = Table(
    "funscript_tags", Base.metadata,
    Column("funscript_id", Integer, ForeignKey("funscripts.id", ondelete="CASCADE"), primary_key=True),
    Column("tag_id", Integer, ForeignKey("tags.id", ondelete="CASCADE"), primary_key=True),
    Column("source", String, default="manual", nullable=False),
)


class Funscript(Base):
    __tablename__ = "funscripts"

    id                 = Column(Integer, primary_key=True, index=True)
    path               = Column(String, nullable=False, unique=True, index=True)
    name               = Column(String, nullable=False)
    title              = Column(String, nullable=True)
    source_image_id    = Column(Integer, ForeignKey("images.id", ondelete="SET NULL"), nullable=True, index=True)

    # Persisted analysis/cache fields.  Values are deliberately nullable so a
    # malformed or missing file can still be surfaced and repaired by reindex.
    duration           = Column(Float, nullable=True)
    action_count       = Column(Integer, default=0)
    actions_per_min    = Column(Float, default=0.0)
    avg_speed          = Column(Float, default=0.0)
    p95_speed          = Column(Float, default=0.0)
    max_speed          = Column(Float, default=0.0)
    avg_movement_distance = Column(Float, default=0.0)
    movement_range     = Column(Float, default=0.0)
    avg_position       = Column(Float, default=0.0)
    active_ratio       = Column(Float, default=0.0)
    pause_count        = Column(Integer, default=0)
    longest_pause      = Column(Float, default=0.0)
    high_focus         = Column(Float, default=0.0)
    low_focus          = Column(Float, default=0.0)
    intensity          = Column(Float, default=0.0)
    axes_json          = Column(Text, default="[]")
    waveform_json      = Column(Text, default="[]")
    axis_count         = Column(Integer, default=0)
    health_status      = Column(String, default="unknown", index=True)  # healthy | missing | invalid
    parse_status       = Column(String, default="unanalysed")           # parsed | invalid | missing
    content_hash       = Column(String, nullable=True, index=True)
    file_mtime         = Column(Float, nullable=True)
    analysis_version   = Column(String, default="1")
    analysis_error     = Column(Text, nullable=True)

    is_favorite        = Column(Boolean, default=False, nullable=False, index=True)
    rating             = Column(Float, default=0.0)
    notes              = Column(Text, default="")
    last_played_at     = Column(DateTime, nullable=True)
    created_at         = Column(DateTime, default=func.now())
    updated_at         = Column(DateTime, default=func.now(), onupdate=func.now())

    source_image       = relationship("Image", foreign_keys=[source_image_id])
    tags               = relationship("Tag", secondary=funscript_tags)


class FunscriptPlaylist(Base):
    __tablename__ = "funscript_playlists"

    id          = Column(Integer, primary_key=True, index=True)
    name        = Column(String, nullable=False)
    description = Column(Text, default="")
    created_at  = Column(DateTime, default=func.now())
    updated_at  = Column(DateTime, default=func.now(), onupdate=func.now())

    entries = relationship(
        "FunscriptPlaylistEntry",
        back_populates="playlist",
        cascade="all, delete-orphan",
        order_by="FunscriptPlaylistEntry.sort_order",
    )


class FunscriptPlaylistEntry(Base):
    __tablename__ = "funscript_playlist_entries"

    id            = Column(Integer, primary_key=True, index=True)
    playlist_id   = Column(Integer, ForeignKey("funscript_playlists.id", ondelete="CASCADE"), nullable=False, index=True)
    funscript_id  = Column(Integer, ForeignKey("funscripts.id", ondelete="CASCADE"), nullable=False, index=True)
    sort_order    = Column(Integer, default=0, nullable=False)

    playlist = relationship("FunscriptPlaylist", back_populates="entries")
    funscript = relationship("Funscript")


# ── Panel playlists (multi-panel viewer) ───────────────────────────────────────
#
# Deliberately separate from `playlists` above, which belongs to the mobile app:
# a panel playlist is an ordered mix of whole galleries AND individual files, and
# it also remembers the viewer setup (panel count + playback mode) so loading one
# restores the whole rig, not just the media.
#
# Entries are real rows with their own PK rather than a composite-key join table,
# so ordering is explicit and the same gallery could appear more than once
# without the schema fighting it.
class PanelPlaylist(Base):
    __tablename__ = "panel_playlists"

    id           = Column(Integer, primary_key=True, index=True)
    name         = Column(String, nullable=False)
    # Marks the rolling auto-saved queue so the UI can present it separately and
    # overwrite it in place instead of piling up duplicates.
    is_autosave  = Column(Boolean, default=False)
    layout_idx   = Column(Integer, default=2)          # index into the LAYOUTS list
    gallery_mode = Column(String, default="grouped")   # 'grouped' | 'shuffled'
    created_at   = Column(DateTime, default=func.now())
    updated_at   = Column(DateTime, default=func.now(), onupdate=func.now())

    entries = relationship(
        "PanelPlaylistEntry",
        back_populates="playlist",
        cascade="all, delete-orphan",
        order_by="PanelPlaylistEntry.sort_order",
    )


class PanelPlaylistEntry(Base):
    __tablename__ = "panel_playlist_entries"

    id          = Column(Integer, primary_key=True, index=True)
    playlist_id = Column(Integer, ForeignKey("panel_playlists.id"), nullable=False, index=True)
    entry_type  = Column(String, nullable=False)   # 'gallery' | 'image'
    ref_id      = Column(Integer, nullable=False)  # gallery id or image id
    sort_order  = Column(Integer, default=0)
    # Which panel this entry belongs to in per-panel mode. NULL means "not
    # pinned" — the shared-queue modes distribute those across panels as before,
    # so playlists saved before this existed keep working untouched.
    panel_idx   = Column(Integer, nullable=True)

    playlist = relationship("PanelPlaylist", back_populates="entries")


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
    total_edge_count   = Column(Integer, default=0)   # all-time edges (Edge Mode)
    daily_edge_count   = Column(Integer, default=0)   # resets each day
    last_edge_date     = Column(DateTime, nullable=True)
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

    # ── Collection Curating ───────────────────────────────────────────────────────────
    # Pinned gallery: set when a run is closed mid-edit, so reopening lands you
    # back on the gallery you walked away from instead of a fresh random one.
    curate_pinned_gallery_id = Column(Integer, nullable=True)
    # Focus mode: locks the beloved lane to one favourite creator.
    curate_focus_creator_id  = Column(Integer, nullable=True)
    curate_streak_days       = Column(Integer, default=0)
    last_curate_date         = Column(DateTime, nullable=True)
    total_galleries_curated  = Column(Integer, default=0)
    total_images_curated     = Column(Integer, default=0)


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
    bond    = "bond"      # image with authenticated 5/15/25 engagement milestones
    variant = "variant"   # creator × character intersection
    collab  = "collab"    # 2+ cosplayers in same gallery (image, gallery, or variant sub-type)
    hof     = "hof"       # minted Hall of Fame memento — permanent, even if she drops out

class CardRarity(str, enum.Enum):
    # Live tiers (2026-07 rework): 4 tiers, fixed at birth.
    common    = "common"
    epic      = "epic"
    legendary = "legendary"
    celestial = "celestial"
    # Legacy tiers — kept so pre-rework rows load; migrated on startup, never created.
    uncommon  = "uncommon"
    rare      = "rare"
    relic     = "relic"


# ── TCG: Card (master record) ─────────────────────────────────────────────────
class Card(Base):
    __tablename__ = "cards"

    id                 = Column(Integer, primary_key=True, index=True)
    card_type          = Column(Enum(CardType), nullable=False)
    rarity             = Column(Enum(CardRarity), default=CardRarity.common)
    foil               = Column(Boolean, default=False)   # premium holo variant (the chase)
    is_relic           = Column(Boolean, default=False)   # legacy pre-rework flag — mirrors foil
    is_unique          = Column(Boolean, default=False)   # unique vs infinite

    # Source asset links (only the relevant one is set per card_type)
    source_image_id    = Column(Integer, ForeignKey("images.id"),   nullable=True)
    source_gallery_id  = Column(Integer, ForeignKey("galleries.id"), nullable=True)
    source_creator_id  = Column(Integer, ForeignKey("creators.id"), nullable=True)
    # For variant cards: both creator + character are set
    linked_character_id = Column(Integer, ForeignKey("creators.id"), nullable=True)

    # Card XP (organic grind via sessions)
    cxp               = Column(Integer, default=0)

    # Collection Rarity Score — scarcity-aware ranking (services/rarity.py).
    # crs layers per-collection scarcity on top of the tier; rarity_class is its
    # percentile bucket: R < SR < SSR < UR.
    crs               = Column(Float, default=0.0)
    rarity_class      = Column(String, default="R")

    # Collab metadata (JSON for multi-creator/character collabs)
    collab_data       = Column(Text, nullable=True)

    # Immutable TCG V2 render contract. The source choice, text snapshot,
    # palette and extraction decision are frozen when a card is prepared so a
    # later metadata edit or masking-model update cannot silently reprint it.
    visual_recipe     = Column(Text, nullable=True)
    mint_audit_json   = Column(Text, nullable=True)

    # Published TCG V2 printing identity.  Legacy cards leave these null.  A
    # catalogue card is created once, can be pulled more than once, and keeps
    # the same frozen rarity and collector number forever.
    catalog_code       = Column(String, nullable=True, index=True)
    collector_number   = Column(Integer, nullable=True)
    print_rarity       = Column(String, nullable=True, index=True)  # C/R/SR/UR/SPR
    parallel_of_id     = Column(Integer, ForeignKey("cards.id"), nullable=True)

    # Cards already owned when TCG V2 is enabled are preserved as Legacy.
    # New mints default to False and therefore enter the current collection.
    is_legacy         = Column(Boolean, default=False, nullable=False, index=True)

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


PHYSICAL_CARD_LOCATIONS = (
    "unorganized_pile", "carried", "binder_slot", "cabinet_slot", "display_stand",
    "acrylic_case", "toploader", "set_box", "trader_reserved", "traded_away",
)


class TCGPhysicalCardCopy(Base):
    """One durable identity for each owned physical copy of a printing."""
    __tablename__ = "tcg_physical_card_copies"

    id             = Column(Integer, primary_key=True, index=True)
    card_id        = Column(Integer, ForeignKey("cards.id"), nullable=False, index=True)
    copy_ordinal   = Column(Integer, nullable=False)
    acquisition_id = Column(Integer, ForeignKey("card_acquisitions.id"), nullable=True, index=True)
    acquired_at    = Column(DateTime, nullable=True, index=True)
    location_kind  = Column(String, default="unorganized_pile", nullable=False, index=True)
    location_ref   = Column(String, nullable=True, index=True)
    location_slot  = Column(Integer, nullable=True)
    trade_locked   = Column(Boolean, default=False, nullable=False, index=True)
    created_at     = Column(DateTime, default=func.now(), nullable=False)
    updated_at     = Column(DateTime, default=func.now(), onupdate=func.now(), nullable=False)

    card = relationship("Card")

    __table_args__ = (
        UniqueConstraint("card_id", "copy_ordinal", name="uq_tcg_physical_card_copy_ordinal"),
        CheckConstraint(
            "location_kind IN ('unorganized_pile','carried','binder_slot','cabinet_slot',"
            "'display_stand','acrylic_case','toploader','set_box','trader_reserved','traded_away')",
            name="ck_tcg_physical_card_location",
        ),
        CheckConstraint(
            "(location_kind IN ('unorganized_pile','carried','traded_away') AND location_ref IS NULL) OR "
            "(location_kind IN ('binder_slot','cabinet_slot','display_stand','acrylic_case','toploader',"
            "'set_box','trader_reserved') AND location_ref IS NOT NULL)",
            name="ck_tcg_physical_card_location_ref",
        ),
        Index("ix_tcg_physical_card_location", "location_kind", "location_ref"),
    )


class TCGPhysicalCopyMigration(Base):
    __tablename__ = "tcg_physical_copy_migrations"

    id           = Column(Integer, primary_key=True, default=1)
    version      = Column(Integer, default=1, nullable=False)
    completed_at = Column(DateTime, default=func.now(), nullable=False)
    report_json  = Column(Text, default="{}", nullable=False)


class TCGRoomLayout(Base):
    __tablename__ = "tcg_room_layouts"

    id               = Column(Integer, primary_key=True, default=1)
    environment_key  = Column(String, default="starter_room", nullable=False)
    lighting_json    = Column(Text, default="{}", nullable=False)
    revision         = Column(Integer, default=0, nullable=False)
    undo_json        = Column(Text, default="[]", nullable=False)
    redo_json        = Column(Text, default="[]", nullable=False)
    created_at       = Column(DateTime, default=func.now(), nullable=False)
    updated_at       = Column(DateTime, default=func.now(), onupdate=func.now(), nullable=False)


class TCGDisplayItemDefinition(Base):
    __tablename__ = "tcg_display_item_definitions"

    id                = Column(Integer, primary_key=True, index=True)
    code              = Column(String, nullable=False, unique=True, index=True)
    name              = Column(String, nullable=False)
    item_type         = Column(String, nullable=False, index=True)
    asset_id          = Column(String, nullable=True)
    currency          = Column(String, default="shards", nullable=False)
    unit_cost         = Column(Integer, default=0, nullable=False)
    variants_json     = Column(Text, default="[]", nullable=False)
    active            = Column(Boolean, default=True, nullable=False, index=True)
    placeable         = Column(Boolean, default=True, nullable=False)
    placement_kind    = Column(String, default="floor", nullable=False)
    footprint_json    = Column(Text, default="{}", nullable=False)
    permanent_fixture = Column(Boolean, default=False, nullable=False, index=True)

    __table_args__ = (
        CheckConstraint("currency IN ('credits','shards','earned')", name="ck_tcg_display_item_currency"),
        CheckConstraint("unit_cost >= 0", name="ck_tcg_display_item_cost"),
        CheckConstraint("placement_kind IN ('floor','wall')", name="ck_tcg_display_item_placement_kind"),
    )


class TCGOwnedDisplayItem(Base):
    __tablename__ = "tcg_owned_display_items"

    id             = Column(Integer, primary_key=True, index=True)
    definition_id  = Column(Integer, ForeignKey("tcg_display_item_definitions.id"), nullable=False, index=True)
    variant_key    = Column(String, default="default", nullable=False)
    quantity       = Column(Integer, default=0, nullable=False)
    acquired_at    = Column(DateTime, default=func.now(), nullable=False)

    __table_args__ = (
        UniqueConstraint("definition_id", "variant_key", name="uq_tcg_owned_display_item_variant"),
        CheckConstraint("quantity >= 0", name="ck_tcg_owned_display_item_quantity"),
    )


class TCGDisplayItemInstance(Base):
    __tablename__ = "tcg_display_item_instances"

    id             = Column(Integer, primary_key=True, index=True)
    definition_id  = Column(Integer, ForeignKey("tcg_display_item_definitions.id"), nullable=False, index=True)
    variant_key    = Column(String, default="default", nullable=False)
    source_type    = Column(String, nullable=False, index=True)
    source_id      = Column(String, nullable=True)
    acquired_at    = Column(DateTime, default=func.now(), nullable=False)

    __table_args__ = (
        Index("uq_tcg_furniture_purchase_request", "source_id", unique=True,
              sqlite_where=text("source_type = 'furniture_purchase'")),
    )


class TCGRoomFurnitureMigration(Base):
    __tablename__ = "tcg_room_furniture_migrations"

    id           = Column(Integer, primary_key=True, default=1)
    version      = Column(Integer, default=1, nullable=False)
    completed_at = Column(DateTime, default=func.now(), nullable=False)
    report_json  = Column(Text, default="{}", nullable=False)


class TCGRoomPlacement(Base):
    __tablename__ = "tcg_room_placements"

    id               = Column(Integer, primary_key=True, index=True)
    layout_id        = Column(Integer, ForeignKey("tcg_room_layouts.id"), nullable=False, index=True)
    instance_id      = Column(Integer, ForeignKey("tcg_display_item_instances.id"), nullable=False, unique=True, index=True)
    transform_json   = Column(Text, default="{}", nullable=False)
    snap_anchor      = Column(String, nullable=True)
    placement_state  = Column(String, default="placed", nullable=False)


class TCGDisplayAssignment(Base):
    __tablename__ = "tcg_display_assignments"

    id                   = Column(Integer, primary_key=True, index=True)
    display_instance_id  = Column(Integer, ForeignKey("tcg_display_item_instances.id"), nullable=False, index=True)
    physical_copy_id     = Column(Integer, ForeignKey("tcg_physical_card_copies.id"), nullable=False, unique=True, index=True)
    slot_key             = Column(String, default="primary", nullable=False)

    __table_args__ = (
        UniqueConstraint("display_instance_id", "slot_key", name="uq_tcg_display_assignment_slot"),
    )


class TCGOnlineOrder(Base):
    __tablename__ = "tcg_online_orders"

    id                 = Column(Integer, primary_key=True, index=True)
    status             = Column(String, default="mailed", nullable=False, index=True)
    total_price        = Column(Integer, nullable=False)
    contents_json      = Column(Text, default="[]", nullable=False)
    order_seed         = Column(String, nullable=False, unique=True, index=True)
    ordered_at         = Column(DateTime, default=func.now(), nullable=False)
    ready_at           = Column(DateTime, nullable=False, index=True)
    delivery_delay_seconds = Column(Integer, nullable=False)
    collected_at       = Column(DateTime, nullable=True)
    opened_at          = Column(DateTime, nullable=True)

    __table_args__ = (
        CheckConstraint("total_price >= 0", name="ck_tcg_online_order_price"),
        CheckConstraint("status IN ('mailed','ready','collected','placed','opened')", name="ck_tcg_online_order_status"),
        CheckConstraint("delivery_delay_seconds BETWEEN 3 AND 8", name="ck_tcg_online_order_delay"),
    )


class TCGOnlineOrderLine(Base):
    __tablename__ = "tcg_online_order_lines"

    id                   = Column(Integer, primary_key=True, index=True)
    order_id             = Column(Integer, ForeignKey("tcg_online_orders.id"), nullable=False, index=True)
    product_id           = Column(Integer, ForeignKey("tcg_pack_products.id"), nullable=False, index=True)
    selected_release_id  = Column(Integer, ForeignKey("tcg_releases.id"), nullable=True)
    quantity             = Column(Integer, nullable=False)
    unit_price           = Column(Integer, nullable=False)
    product_snapshot_json = Column(Text, default="{}", nullable=False)

    __table_args__ = (
        CheckConstraint("quantity > 0", name="ck_tcg_online_order_line_quantity"),
        CheckConstraint("unit_price >= 0", name="ck_tcg_online_order_line_price"),
    )


class TCGParcel(Base):
    __tablename__ = "tcg_parcels"

    id            = Column(Integer, primary_key=True, index=True)
    order_id      = Column(Integer, ForeignKey("tcg_online_orders.id"), nullable=False, unique=True, index=True)
    status        = Column(String, default="mailed", nullable=False, index=True)
    ready_at      = Column(DateTime, nullable=False, index=True)
    collected_at  = Column(DateTime, nullable=True)
    opened_at     = Column(DateTime, nullable=True)
    result_json   = Column(Text, default="[]", nullable=False)
    placement_json = Column(Text, default="{}", nullable=False)

    __table_args__ = (
        CheckConstraint("status IN ('mailed','ready','collected','placed','opened')", name="ck_tcg_parcel_status"),
    )


class TCGParcelPack(Base):
    __tablename__ = "tcg_parcel_packs"

    id             = Column(Integer, primary_key=True, index=True)
    parcel_id      = Column(Integer, ForeignKey("tcg_parcels.id"), nullable=False, index=True)
    line_id        = Column(Integer, ForeignKey("tcg_online_order_lines.id"), nullable=False, index=True)
    pack_index     = Column(Integer, nullable=False)
    contents_seed  = Column(String, nullable=False, unique=True, index=True)
    opening_id     = Column(Integer, ForeignKey("tcg_pack_openings.id"), nullable=True, unique=True)

    __table_args__ = (
        UniqueConstraint("parcel_id", "line_id", "pack_index", name="uq_tcg_parcel_pack_index"),
    )


class TCGTraderDefinition(Base):
    __tablename__ = "tcg_trader_definitions"
    id = Column(Integer, primary_key=True, index=True)
    code = Column(String, nullable=False, unique=True, index=True)
    name = Column(String, nullable=False)
    age = Column(Integer, nullable=False)
    biography = Column(Text, nullable=False)
    body_style_json = Column(Text, default="{}", nullable=False)
    personality = Column(Text, nullable=False)
    preferences_json = Column(Text, default="[]", nullable=False)
    dislikes_json = Column(Text, default="[]", nullable=False)
    quirks_json = Column(Text, default="[]", nullable=False)
    visual_manifest_json = Column(Text, default="{}", nullable=False)
    dialogue_manifest_json = Column(Text, default="{}", nullable=False)
    greed = Column(Float, nullable=False)
    competence = Column(Float, nullable=False)
    risk_tolerance = Column(Float, nullable=False)
    request_limit = Column(Integer, nullable=False)
    schedule_weight = Column(Float, default=1.0, nullable=False)
    enabled = Column(Boolean, default=True, nullable=False, index=True)
    __table_args__ = (
        CheckConstraint("age >= 21", name="ck_tcg_trader_adult"),
        CheckConstraint("greed BETWEEN 0 AND 1 AND competence BETWEEN 0 AND 1 AND risk_tolerance BETWEEN 0 AND 1", name="ck_tcg_trader_traits"),
        CheckConstraint("request_limit BETWEEN 1 AND 4", name="ck_tcg_trader_request_limit"),
    )


class TCGTraderVisit(Base):
    __tablename__ = "tcg_trader_visits"
    id = Column(Integer, primary_key=True, index=True)
    week_key = Column(String, nullable=False, unique=True, index=True)
    trader_id = Column(Integer, ForeignKey("tcg_trader_definitions.id"), nullable=False, index=True)
    visit_seed = Column(String, nullable=False, unique=True)
    arrives_at = Column(DateTime, nullable=False)
    departs_at = Column(DateTime, nullable=False)
    inventory_frozen_json = Column(Text, default="[]", nullable=False)
    request_allowance = Column(Integer, nullable=False)
    requests_used = Column(Integer, default=0, nullable=False)
    conversation_json = Column(Text, default="[]", nullable=False)
    offer_state_json = Column(Text, default="{}", nullable=False)
    status = Column(String, default="active", nullable=False)


class TCGTraderInventory(Base):
    __tablename__ = "tcg_trader_inventory"
    id = Column(Integer, primary_key=True, index=True)
    visit_id = Column(Integer, ForeignKey("tcg_trader_visits.id"), nullable=False, index=True)
    card_id = Column(Integer, ForeignKey("cards.id"), nullable=False, index=True)
    quantity = Column(Integer, default=1, nullable=False)
    reserved_quantity = Column(Integer, default=0, nullable=False)
    valuation_json = Column(Text, nullable=False)
    unit_credits = Column(Integer, nullable=False)
    unit_shards = Column(Integer, nullable=False)
    __table_args__ = (UniqueConstraint("visit_id", "card_id", name="uq_tcg_trader_visit_card"),)


class TCGTraderRequest(Base):
    __tablename__ = "tcg_trader_requests"
    id = Column(Integer, primary_key=True, index=True)
    visit_id = Column(Integer, ForeignKey("tcg_trader_visits.id"), nullable=False, index=True)
    card_id = Column(Integer, ForeignKey("cards.id"), nullable=False, index=True)
    request_index = Column(Integer, nullable=False)
    seed = Column(String, nullable=False, unique=True)
    status = Column(String, nullable=False)
    result_json = Column(Text, nullable=False)
    created_at = Column(DateTime, default=func.now(), nullable=False)
    __table_args__ = (
        UniqueConstraint("visit_id", "request_index", name="uq_tcg_trader_request_index"),
        UniqueConstraint("visit_id", "card_id", name="uq_tcg_trader_request_card"),
    )


class TCGTraderOffer(Base):
    __tablename__ = "tcg_trader_offers"
    id = Column(Integer, primary_key=True, index=True)
    visit_id = Column(Integer, ForeignKey("tcg_trader_visits.id"), nullable=False, index=True)
    request_id = Column(Integer, ForeignKey("tcg_trader_requests.id"), nullable=True, unique=True)
    offer_seed = Column(String, nullable=False, unique=True)
    offer_kind = Column(String, nullable=False, index=True)
    status = Column(String, default="open", nullable=False, index=True)
    user_copy_ids_json = Column(Text, default="[]", nullable=False)
    trader_inventory_id = Column(Integer, ForeignKey("tcg_trader_inventory.id"), nullable=True)
    target_card_id = Column(Integer, ForeignKey("cards.id"), nullable=True)
    credits_delta = Column(Integer, default=0, nullable=False)
    shards_delta = Column(Integer, default=0, nullable=False)
    valuation_json = Column(Text, nullable=False)
    created_at = Column(DateTime, default=func.now(), nullable=False)
    resolved_at = Column(DateTime, nullable=True)


class TCGTraderReservation(Base):
    __tablename__ = "tcg_trader_reservations"
    id = Column(Integer, primary_key=True, index=True)
    offer_id = Column(Integer, ForeignKey("tcg_trader_offers.id"), nullable=False, index=True)
    # Historical reservations retain the consumed copy id after the copy leaves
    # ownership, so this ledger pointer intentionally is not a live foreign key.
    physical_copy_id = Column(Integer, nullable=True, index=True)
    inventory_id = Column(Integer, ForeignKey("tcg_trader_inventory.id"), nullable=True, index=True)
    status = Column(String, default="active", nullable=False, index=True)
    previous_location_json = Column(Text, default="{}", nullable=False)
    created_at = Column(DateTime, default=func.now(), nullable=False)
    __table_args__ = (CheckConstraint("(physical_copy_id IS NULL) != (inventory_id IS NULL)", name="ck_tcg_trader_reservation_side"),)


class TCGTraderTransaction(Base):
    __tablename__ = "tcg_trader_transactions"
    id = Column(Integer, primary_key=True, index=True)
    visit_id = Column(Integer, ForeignKey("tcg_trader_visits.id"), nullable=False, index=True)
    offer_id = Column(Integer, ForeignKey("tcg_trader_offers.id"), nullable=False, unique=True)
    transaction_kind = Column(String, nullable=False, index=True)
    credits_delta = Column(Integer, default=0, nullable=False)
    shards_delta = Column(Integer, default=0, nullable=False)
    valuation_json = Column(Text, nullable=False)
    completed_at = Column(DateTime, default=func.now(), nullable=False)


class TCGTraderTransactionLine(Base):
    __tablename__ = "tcg_trader_transaction_lines"
    id = Column(Integer, primary_key=True, index=True)
    transaction_id = Column(Integer, ForeignKey("tcg_trader_transactions.id"), nullable=False, index=True)
    direction = Column(String, nullable=False)
    card_id = Column(Integer, ForeignKey("cards.id"), nullable=False, index=True)
    physical_copy_id = Column(Integer, nullable=True)
    quantity = Column(Integer, default=1, nullable=False)
    snapshot_json = Column(Text, nullable=False)


class TCGTraderSimulationReport(Base):
    __tablename__ = "tcg_trader_simulation_reports"
    id = Column(Integer, primary_key=True, index=True)
    version = Column(String, nullable=False, unique=True)
    weeks_simulated = Column(Integer, nullable=False)
    seed = Column(String, nullable=False)
    report_json = Column(Text, nullable=False)
    approved = Column(Boolean, default=False, nullable=False, index=True)
    approved_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=func.now(), nullable=False)


class BondMilestone(Base):
    """Authenticated progression for one earned Bond card.

    Crossing dates remain nullable because lifetime counters imported before
    event tracking cannot truthfully tell us when an older threshold happened.
    """
    __tablename__ = "bond_milestones"

    id             = Column(Integer, primary_key=True, index=True)
    card_id        = Column(Integer, ForeignKey("cards.id"), nullable=False, index=True)
    image_id       = Column(Integer, ForeignKey("images.id"), nullable=False, index=True)
    threshold      = Column(Integer, nullable=False)
    recorded_count = Column(Integer, nullable=False)
    crossed_at     = Column(DateTime, nullable=True)

    card = relationship("Card")

    __table_args__ = (
        UniqueConstraint("card_id", "threshold", name="uq_bond_card_milestone"),
    )


# ── TCG: Pack opening log ─────────────────────────────────────────────────────
class CardPack(Base):
    __tablename__ = "card_packs"

    id            = Column(Integer, primary_key=True, index=True)
    cost_credits  = Column(Integer, default=250)
    opened_at     = Column(DateTime, default=func.now())
    cards_awarded = Column(Text, default="[]")  # JSON list of card IDs


class TCGSetupState(Base):
    """Single-row state for the opt-in TCG V2 transition."""
    __tablename__ = "tcg_setup_state"

    id                = Column(Integer, primary_key=True, default=1)
    v2_enabled        = Column(Boolean, default=False, nullable=False)
    enabled_at        = Column(DateTime, nullable=True)
    legacy_card_count = Column(Integer, default=0, nullable=False)
    foundation_status = Column(String, default="pending", nullable=False)
    foundation_total  = Column(Integer, default=0, nullable=False)
    foundation_target = Column(Integer, default=0, nullable=False)


# ── TCG: Crafting materials (shards & catalyst tokens) ────────────────────────
class CraftingMaterials(Base):
    __tablename__ = "crafting_materials"

    id            = Column(Integer, primary_key=True, default=1)
    shards        = Column(Integer, default=0)
    catalyst_tokens = Column(Integer, default=0)


# -- TCG V2 collection domain -------------------------------------------------
# These records are additive so an existing Vault can migrate without losing
# the retired progression data stored on legacy cards.
class TCGSettings(Base):
    __tablename__ = "tcg_v2_settings"

    id                        = Column(Integer, primary_key=True, default=1)
    advanced_mode             = Column(Boolean, default=False, nullable=False)
    release_generation_mode   = Column(String, default="automatic", nullable=False)
    ai_confidence_threshold   = Column(Float, default=0.72, nullable=False)
    enabled_theme_sources     = Column(Text, default="[]", nullable=False)
    policy_version            = Column(String, default="classification-v1", nullable=False)
    updated_at                = Column(DateTime, default=func.now(), onupdate=func.now())


class CardContentClassification(Base):
    __tablename__ = "card_content_classifications"

    id                    = Column(Integer, primary_key=True, index=True)
    card_id               = Column(Integer, ForeignKey("cards.id"), nullable=False, unique=True, index=True)
    exposure_manual       = Column(String, nullable=True)
    intensity_manual      = Column(String, nullable=True)
    exposure_ai           = Column(String, nullable=True)
    intensity_ai          = Column(String, nullable=True)
    exposure_confidence   = Column(Float, nullable=True)
    intensity_confidence  = Column(Float, nullable=True)
    exposure_resolved     = Column(String, default="Unknown", nullable=False, index=True)
    intensity_resolved    = Column(String, default="Unknown", nullable=False, index=True)
    metadata_source       = Column(String, default="unknown", nullable=False)
    ai_model              = Column(String, nullable=True)
    policy_version        = Column(String, default="classification-v1", nullable=False)
    evidence_json         = Column(Text, default="{}", nullable=False)
    gallery_distribution  = Column(Text, default="{}", nullable=False)
    updated_at            = Column(DateTime, default=func.now(), onupdate=func.now())

    card = relationship("Card")


class TCGRelease(Base):
    __tablename__ = "tcg_releases"

    id                    = Column(Integer, primary_key=True, index=True)
    code                  = Column(String, nullable=False, unique=True, index=True)
    name                  = Column(String, nullable=False)
    description           = Column(Text, default="")
    status                = Column(String, default="draft", nullable=False, index=True)
    release_kind          = Column(String, default="monthly", nullable=False)
    generation_mode       = Column(String, default="automatic", nullable=False)
    generation_seed       = Column(String, nullable=False)
    algorithm_version     = Column(String, default="release-v1", nullable=False)
    drafted_at            = Column(DateTime, default=func.now())
    published_at          = Column(DateTime, nullable=True, index=True)
    available_from        = Column(DateTime, nullable=True)
    frozen_at             = Column(DateTime, nullable=True)
    cover_path            = Column(String, nullable=True)
    manifest_json         = Column(Text, default="{}", nullable=False)
    rarity_distribution   = Column(Text, default="{}", nullable=False)
    validation_report     = Column(Text, default="{}", nullable=False)
    generation_report     = Column(Text, default="{}", nullable=False)


class TCGSet(Base):
    __tablename__ = "tcg_sets"

    id                    = Column(Integer, primary_key=True, index=True)
    release_id            = Column(Integer, ForeignKey("tcg_releases.id"), nullable=False, index=True)
    code                  = Column(String, nullable=False, unique=True, index=True)
    name                  = Column(String, nullable=False)
    description           = Column(Text, default="")
    theme_key             = Column(String, nullable=True, index=True)
    theme_source          = Column(String, nullable=True)
    cover_path            = Column(String, nullable=True)
    position              = Column(Integer, default=0, nullable=False)
    frozen_at             = Column(DateTime, nullable=True)
    manifest_json         = Column(Text, default="{}", nullable=False)

    release = relationship("TCGRelease")


class TCGChecklistEntry(Base):
    __tablename__ = "tcg_checklist_entries"

    id                    = Column(Integer, primary_key=True, index=True)
    release_id            = Column(Integer, ForeignKey("tcg_releases.id"), nullable=False, index=True)
    set_id                = Column(Integer, ForeignKey("tcg_sets.id"), nullable=True, index=True)
    card_id               = Column(Integer, ForeignKey("cards.id"), nullable=False, index=True)
    collector_position    = Column(Integer, nullable=False)
    collector_suffix      = Column(String, default="", nullable=False)
    lane                  = Column(String, nullable=True)
    is_base_printing      = Column(Boolean, default=True, nullable=False)
    required_for_complete = Column(Boolean, default=True, nullable=False)
    published_rarity      = Column(String, nullable=False, index=True)
    selection_reason      = Column(Text, default="")

    card = relationship("Card")
    release = relationship("TCGRelease")
    set = relationship("TCGSet")

    __table_args__ = (
        UniqueConstraint("release_id", "collector_position", "collector_suffix", name="uq_tcg_release_number"),
        UniqueConstraint("release_id", "card_id", name="uq_tcg_release_card"),
    )


class CardAcquisition(Base):
    __tablename__ = "card_acquisitions"

    id            = Column(Integer, primary_key=True, index=True)
    card_id       = Column(Integer, ForeignKey("cards.id"), nullable=False, index=True)
    quantity      = Column(Integer, default=1, nullable=False)
    acquired_at   = Column(DateTime, nullable=True, index=True)
    source_type   = Column(String, nullable=False, index=True)
    source_id     = Column(String, nullable=True)
    pack_opening_id = Column(Integer, ForeignKey("tcg_pack_openings.id"), nullable=True, index=True)
    notes         = Column(Text, default="")

    card = relationship("Card")


class TCGPackProduct(Base):
    __tablename__ = "tcg_pack_products"

    id                    = Column(Integer, primary_key=True, index=True)
    code                  = Column(String, nullable=False, unique=True, index=True)
    name                  = Column(String, nullable=False)
    product_kind          = Column(String, nullable=False, index=True)
    release_id            = Column(Integer, ForeignKey("tcg_releases.id"), nullable=True, index=True)
    card_count            = Column(Integer, nullable=False)
    rarity_floor          = Column(String, nullable=True)
    guaranteed_slots      = Column(Text, default="[]", nullable=False)
    odds_json             = Column(Text, default="{}", nullable=False)
    replacement_rules     = Column(Text, default="{}", nullable=False)
    duplicate_protection  = Column(Text, default="{}", nullable=False)
    eligible_pool_json    = Column(Text, default="{}", nullable=False)
    regular_price         = Column(Integer, default=0, nullable=False)
    launch_price          = Column(Integer, nullable=True)
    launch_days           = Column(Integer, default=7, nullable=False)
    available_from        = Column(DateTime, nullable=True)
    available_until       = Column(DateTime, nullable=True)
    purchase_limit        = Column(Integer, nullable=True)
    purchasable           = Column(Boolean, default=True, nullable=False)
    active                = Column(Boolean, default=False, nullable=False, index=True)
    simulation_report     = Column(Text, default="{}", nullable=False)


class TCGPackOpening(Base):
    __tablename__ = "tcg_pack_openings"

    id             = Column(Integer, primary_key=True, index=True)
    product_id     = Column(Integer, ForeignKey("tcg_pack_products.id"), nullable=False, index=True)
    opened_at      = Column(DateTime, default=func.now(), nullable=False, index=True)
    price_paid     = Column(Integer, default=0, nullable=False)
    opening_seed   = Column(String, nullable=False)
    selected_release_id = Column(Integer, ForeignKey("tcg_releases.id"), nullable=True)
    integrity_json = Column(Text, default="{}", nullable=False)


class TCGPackOpeningCard(Base):
    __tablename__ = "tcg_pack_opening_cards"

    id             = Column(Integer, primary_key=True, index=True)
    opening_id     = Column(Integer, ForeignKey("tcg_pack_openings.id"), nullable=False, index=True)
    card_id        = Column(Integer, ForeignKey("cards.id"), nullable=False, index=True)
    slot_index     = Column(Integer, nullable=False)
    slot_rule      = Column(String, nullable=True)
    was_owned      = Column(Boolean, default=False, nullable=False)

    __table_args__ = (
        UniqueConstraint("opening_id", "slot_index", name="uq_tcg_opening_slot"),
    )


class TCGPackToken(Base):
    __tablename__ = "tcg_pack_tokens"

    id             = Column(Integer, primary_key=True, index=True)
    product_id     = Column(Integer, ForeignKey("tcg_pack_products.id"), nullable=False, index=True)
    quantity       = Column(Integer, default=1, nullable=False)
    source_type    = Column(String, nullable=False, index=True)
    source_id      = Column(String, nullable=True)
    cycle_key      = Column(String, nullable=True, index=True)
    earned_at      = Column(DateTime, default=func.now(), nullable=False)
    consumed_at    = Column(DateTime, nullable=True, index=True)

    __table_args__ = (
        UniqueConstraint("product_id", "source_type", "cycle_key", name="uq_tcg_pack_token_cycle"),
    )


class CardPresentationOverride(Base):
    __tablename__ = "card_presentation_overrides"

    id                  = Column(Integer, primary_key=True, index=True)
    card_id             = Column(Integer, ForeignKey("cards.id"), nullable=False, unique=True, index=True)
    signature_x         = Column(Float, nullable=True)
    signature_y         = Column(Float, nullable=True)
    signature_scale     = Column(Float, nullable=True)
    signature_rotation  = Column(Float, nullable=True)
    artwork_x           = Column(Float, nullable=True)
    artwork_y           = Column(Float, nullable=True)
    artwork_scale       = Column(Float, nullable=True)
    mask_override_json  = Column(Text, default="{}", nullable=False)
    revision            = Column(Integer, default=1, nullable=False)
    updated_at          = Column(DateTime, default=func.now(), onupdate=func.now())


class TCGBinder(Base):
    __tablename__ = "tcg_binders"

    id          = Column(Integer, primary_key=True, index=True)
    name        = Column(String, nullable=False)
    description = Column(Text, default="")
    cover_style = Column(String, default="obsidian")
    spine_style = Column(String, default="standard")
    page_style  = Column(String, default="nine-pocket")
    cover_image_id = Column(Integer, ForeignKey("images.id"), nullable=True)
    cover_x     = Column(Float, default=0.5, nullable=False)
    cover_y     = Column(Float, default=0.5, nullable=False)
    cover_scale = Column(Float, default=1.0, nullable=False)
    purchase_price = Column(Integer, default=0, nullable=False)
    position    = Column(Integer, default=0, nullable=False)
    created_at  = Column(DateTime, default=func.now())
    updated_at  = Column(DateTime, default=func.now(), onupdate=func.now())


class TCGBinderSection(Base):
    __tablename__ = "tcg_binder_sections"

    id         = Column(Integer, primary_key=True, index=True)
    binder_id  = Column(Integer, ForeignKey("tcg_binders.id"), nullable=False, index=True)
    name       = Column(String, default="Main", nullable=False)
    position   = Column(Integer, default=0, nullable=False)
    created_at = Column(DateTime, default=func.now(), nullable=False)

    __table_args__ = (
        UniqueConstraint("binder_id", "name", name="uq_tcg_binder_section_name"),
        UniqueConstraint("binder_id", "position", name="uq_tcg_binder_section_position"),
    )


class TCGBinderSlot(Base):
    __tablename__ = "tcg_binder_slots"

    id           = Column(Integer, primary_key=True, index=True)
    binder_id    = Column(Integer, ForeignKey("tcg_binders.id"), nullable=False, index=True)
    section_id   = Column(Integer, ForeignKey("tcg_binder_sections.id"), nullable=True, index=True)
    section_name = Column(String, default="Main", nullable=False)
    page_number  = Column(Integer, nullable=False)
    slot_number  = Column(Integer, nullable=False)
    card_id      = Column(Integer, ForeignKey("cards.id"), nullable=True, index=True)
    physical_copy_id = Column(Integer, ForeignKey("tcg_physical_card_copies.id"), nullable=True, unique=True, index=True)
    sleeve_style = Column(String, nullable=True)
    case_style   = Column(String, nullable=True)

    __table_args__ = (
        UniqueConstraint("binder_id", "section_name", "page_number", "slot_number", name="uq_tcg_binder_slot"),
    )


class TCGWorkshopUnlock(Base):
    __tablename__ = "tcg_workshop_unlocks"

    id          = Column(Integer, primary_key=True, index=True)
    item_code   = Column(String, nullable=False, unique=True, index=True)
    item_type   = Column(String, nullable=False, index=True)
    name        = Column(String, nullable=False)
    shard_cost  = Column(Integer, nullable=False)
    owned       = Column(Boolean, default=False, nullable=False)
    unlocked_at = Column(DateTime, nullable=True)


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
    # ── Simulation ("Drama") Mode ─────────────────────────────────────────────
    simulation_enabled   = Column(Boolean, default=False)  # master toggle for the living social world
    simulation_intensity = Column(Integer, default=60)     # drama dial 0-100 (wholesome → unhinged)
    simulation_daily_cap = Column(Integer, default=150)    # hard safety ceiling on interactions/day (0 = unlimited)
    simulation_generated_today = Column(Integer, default=0)  # interactions generated today (reset daily)
    simulation_last_run  = Column(DateTime, nullable=True) # last time the background engine ticked
    simulation_time_budget_sec = Column(Integer, default=1800)  # primary throttle: seconds of active generation/day
    simulation_time_used_sec   = Column(Integer, default=0)     # seconds used today (reset daily)
    simulation_boost_until = Column(DateTime, nullable=True)  # "run longer" — ignore the budget until this time
    simulation_budget_date = Column(String, nullable=True)   # YYYY-MM-DD the daily counters belong to
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


# ── Simulation ("Drama") Mode: evolving relationships between creators (and you) ─
class SimRelationship(Base):
    """How one creator currently feels about another creator — or about YOU.
    Starts neutral and evolves organically as they interact in the feed. Persistent
    (grudges stick); `heat` is the transient recent intensity that decays over time."""
    __tablename__ = "sim_relationships"

    id          = Column(Integer, primary_key=True, index=True)
    subject_id  = Column(Integer, ForeignKey("creators.id"), index=True, nullable=False)  # who feels it
    target_user = Column(Boolean, default=False)                       # target is the user (you)
    target_id   = Column(Integer, ForeignKey("creators.id"), nullable=True, index=True)  # or another creator
    sentiment   = Column(Float, default=0.0)      # -100 (hatred) … 0 (neutral) … +100 (adores) — persistent
    status      = Column(String, default='neutral')  # neutral|friend|rival|feud|crush|jealous
    heat        = Column(Float, default=0.0)      # recent flare-up intensity 0-100, decays toward 0
    last_reason = Column(Text, nullable=True)     # short note on why it last shifted
    interactions = Column(Integer, default=0)     # how many times they've clashed/interacted
    updated_at  = Column(DateTime, default=func.now(), onupdate=func.now())


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
    reply_to_name = Column(String, nullable=True)  # @mention this comment answers (drama threading)
    sim         = Column(Boolean, default=False)   # generated by the simulation engine
    is_user     = Column(Boolean, default=False)   # posted by YOU (the vault owner)
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
    group_id   = Column(Integer, nullable=True)   # set → "she added you to a group" ping
    created_at = Column(DateTime, default=func.now())

    creator    = relationship("Creator")


# ── Hall of Fame crowns ───────────────────────────────────────────────────────
class HofCrown(Base):
    """One creator winning one Hall of Fame period. The permanent record.

    Identity is (period_type, period_key) — 'day'/'2026-08-10' happens exactly
    once in history, so a crown can never be re-won or duplicated, and the card
    minted from it is unrepeatable by construction rather than by a uniqueness
    flag we have to defend.

    The winning numbers are snapshotted onto the row rather than recomputed on
    read: reassigning a gallery months later would otherwise silently rewrite
    who won last August. A result is a result.

    field_size — how many creators had any score that period. A Tuesday won
    over thirty is genuinely scarcer than one won over two, and this is what
    lets scarcity reflect that.
    """
    __tablename__ = "hof_crowns"

    id           = Column(Integer, primary_key=True, index=True)
    period_type  = Column(String, index=True)    # day | week | month
    period_key   = Column(String, index=True)    # 2026-08-10 | 2026-W33 | 2026-08
    creator_id   = Column(Integer, ForeignKey("creators.id"), index=True)

    won_at       = Column(DateTime, default=func.now())
    score        = Column(Integer, default=0)
    field_size   = Column(Integer, default=0)

    # The winning line, frozen.
    sessions     = Column(Integer, default=0)
    cum          = Column(Integer, default=0)
    view_seconds = Column(Integer, default=0)

    # The file she won on — the card's art, and a time capsule of that period.
    image_id     = Column(Integer, ForeignKey("images.id"), nullable=True)
    card_id      = Column(Integer, ForeignKey("cards.id"), nullable=True)

    creator      = relationship("Creator")

    __table_args__ = (
        UniqueConstraint("period_type", "period_key", name="uq_crown_period"),
    )


# ── Engagement event log ──────────────────────────────────────────────────────
class ActivityEvent(Base):
    """One row per engagement action, with the timestamp the counters throw away.

    view_count / cum_count / edge_count / view_seconds on Image and Gallery are
    lifetime scalars. They can answer "who is my top creator" but never "who was
    my top creator this week" — and not just retroactively: without this table
    that question stays unanswerable no matter how long the app runs. This is
    what makes the periodic Hall of Fame possible. Written everywhere those
    counters are incremented; the counters stay the source of truth for all-time
    so six years of history keeps working.

    Creators are deliberately NOT denormalised onto these rows. A file's
    creators are resolved at read time through the same gallery_creators /
    image_creators union the all-time ranking uses, so assigning a gallery to a
    creator later retroactively corrects her past periods, and the periodic and
    all-time rankings can never drift apart the way the two scoring copies did
    before services/ranking.py existed.

    kind is split by entity because the weights differ: a gallery view is worth
    5 and a photo view 1, and a cum tap counts once per gallery and once per
    file on screen.
    """
    __tablename__ = "activity_events"

    id         = Column(Integer, primary_key=True, index=True)
    # view | seconds | cum | edge  (image-level)
    # gallery_view | gallery_cum | gallery_edge  (gallery-level)
    kind       = Column(String, index=True)
    image_id   = Column(Integer, ForeignKey("images.id"),    nullable=True, index=True)
    gallery_id = Column(Integer, ForeignKey("galleries.id"), nullable=True, index=True)
    amount     = Column(Integer, default=1)   # seconds when kind='seconds', else a count
    logged_at  = Column(DateTime, default=func.now(), index=True)


# ── Creator Showcase: 5 card display slots on a creator's profile ─────────────
# ── Daily activity rollup ─────────────────────────────────────────────────────
class DailyActivity(Base):
    """One row per day of usage.

    Exists because images.view_count / view_seconds are lifetime scalars with no
    time dimension — without this table "watch time per month" is impossible not
    just retroactively but forever, no matter how long the app runs. Written
    incrementally as things happen; cheap to keep, impossible to reconstruct.
    """
    __tablename__ = "daily_activity"

    id            = Column(Integer, primary_key=True, index=True)
    day           = Column(String, index=True)      # YYYY-MM-DD, local date
    views         = Column(Integer, default=0)
    view_seconds  = Column(Integer, default=0)
    cum_count     = Column(Integer, default=0)
    edge_count    = Column(Integer, default=0)
    sessions      = Column(Integer, default=0)
    session_seconds = Column(Integer, default=0)
    xp_earned     = Column(Integer, default=0)
    files_added   = Column(Integer, default=0)
    updated_at    = Column(DateTime, default=func.now(), onupdate=func.now())


# ── Hall of Fame rank movement ────────────────────────────────────────────────
class HofRank(Base):
    """Last known Hall of Fame rank per entity, so the UI can show how many
    places something has climbed or dropped. prev_rank only changes when the
    rank actually moves, which keeps an arrow on screen until the next
    movement rather than clearing it on the next page load."""
    __tablename__ = "hof_ranks"

    id          = Column(Integer, primary_key=True, index=True)
    entity_type = Column(String, index=True)   # creator | gallery | image
    entity_id   = Column(Integer, index=True)
    rank        = Column(Integer, nullable=False)
    prev_rank   = Column(Integer, nullable=True)
    updated_at  = Column(DateTime, default=func.now(), onupdate=func.now())


class CreatorShowcase(Base):
    """One row per filled slot. Slots: creator | gallery | bond | photo | wildcard.
    A card (inventory entry) can sit in only one showcase at a time. Filling all
    5 = Mastery (one-time bond reward; creators.showcase_mastery_at records it)."""
    __tablename__ = "creator_showcase"

    id           = Column(Integer, primary_key=True, index=True)
    creator_id   = Column(Integer, ForeignKey("creators.id", ondelete="CASCADE"), index=True)
    slot         = Column(String, nullable=False)
    inventory_id = Column(Integer, ForeignKey("card_inventory.id", ondelete="CASCADE"))

    inventory    = relationship("CardInventory")


# ── Companion group chats: several creator-personas + you in one thread ───────
class GroupChat(Base):
    __tablename__ = "group_chats"

    id          = Column(Integer, primary_key=True, index=True)
    title       = Column(String, default="")        # e.g. "Saya, CandyBall & you"
    origin      = Column(String, default="user")    # 'user' | 'drama' (how it was created)
    created_at  = Column(DateTime, default=func.now())
    last_active = Column(DateTime, default=func.now())
    last_opened = Column(DateTime, nullable=True)   # for unread counts


class GroupMember(Base):
    __tablename__ = "group_members"

    id         = Column(Integer, primary_key=True, index=True)
    group_id   = Column(Integer, ForeignKey("group_chats.id", ondelete="CASCADE"), index=True)
    creator_id = Column(Integer, ForeignKey("creators.id"), index=True)

    creator    = relationship("Creator")


class GroupMessage(Base):
    __tablename__ = "group_messages"

    id          = Column(Integer, primary_key=True, index=True)
    group_id    = Column(Integer, ForeignKey("group_chats.id", ondelete="CASCADE"), index=True)
    speaker_id  = Column(Integer, nullable=True)   # creator id; NULL = the user
    is_user     = Column(Boolean, default=False)
    author_name = Column(String, default="")       # denormalized for display
    content     = Column(Text, default="")
    created_at  = Column(DateTime, default=func.now())


# ── Durable AI tagging jobs ───────────────────────────────────────────────────
class AITagJob(Base):
    """Persisted checkpoint for long-running AI tagging work.

    The worker itself is deliberately not persisted.  A running job becomes
    paused after an app restart and can be explicitly resumed from its last
    committed image id.
    """
    __tablename__ = "ai_tag_jobs"

    id             = Column(Integer, primary_key=True, index=True)
    status         = Column(String, default="queued", index=True)  # queued|running|paused|done|cancelled|failed
    scope          = Column(String, default="library")
    folder_path    = Column(String, nullable=True)
    creator_id     = Column(Integer, nullable=True)
    threshold      = Column(Float, default=0.35)
    retag          = Column(Boolean, default=False)
    model_override = Column(String, nullable=True)
    total          = Column(Integer, default=0)
    progress       = Column(Integer, default=0)
    tagged         = Column(Integer, default=0)
    skipped        = Column(Integer, default=0)
    errors         = Column(Integer, default=0)
    last_image_id  = Column(Integer, default=0)
    message        = Column(String, default="Queued")
    created_at     = Column(DateTime, default=func.now())
    updated_at     = Column(DateTime, default=func.now(), onupdate=func.now())
