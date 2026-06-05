import os
import csv
import threading
import logging
from typing import Optional

import numpy as np
from PIL import Image as PILImage

logger = logging.getLogger(__name__)


class _ScanLogHandler(logging.Handler):
    """Forwards AI tagger log records (INFO+) to the scanner's scan-log ring buffer."""
    def emit(self, record: logging.LogRecord):
        try:
            from services.scanner import _log as _scan_log_append
            prefix = "[AI Tagger] "
            _scan_log_append(prefix + self.format(record))
        except Exception:
            pass

# ── Taxonomy tag map: raw model tag → (normalized_name, category) ─────────────
# Categories: body_part | nudity_level | clothing | pose | rating | subject |
#             character | style | general

WD14_TAG_MAP: dict[str, tuple[str, str]] = {
    # Ratings
    "rating:general":       ("safe", "rating"),
    "rating:sensitive":     ("suggestive", "rating"),
    "rating:questionable":  ("suggestive", "rating"),
    "rating:explicit":      ("explicit", "rating"),
    # Person / subject count → also drives person_count integer
    "solo":                 ("solo", "subject"),
    "1girl":                ("solo", "subject"),
    "1boy":                 ("solo", "subject"),
    "1other":               ("solo", "subject"),
    "2girls":               ("duo", "subject"),
    "2boys":                ("duo", "subject"),
    "1boy1girl":            ("duo", "subject"),
    "1girl1boy":            ("duo", "subject"),
    "2others":              ("duo", "subject"),
    "3girls":               ("group", "subject"),
    "3boys":                ("group", "subject"),
    "4girls":               ("group", "subject"),
    "4boys":                ("group", "subject"),
    "5girls":               ("group", "subject"),
    "5boys":                ("group", "subject"),
    "6+girls":              ("group", "subject"),
    "6+boys":               ("group", "subject"),
    "multiple_girls":       ("group", "subject"),
    "multiple_boys":        ("group", "subject"),
    "multiple_others":      ("group", "subject"),
    # Body parts
    "breasts":              ("breasts", "body_part"),
    "large_breasts":        ("large breasts", "body_part"),
    "huge_breasts":         ("huge breasts", "body_part"),
    "medium_breasts":       ("medium breasts", "body_part"),
    "small_breasts":        ("small breasts", "body_part"),
    "flat_chest":           ("flat chest", "body_part"),
    "cleavage":             ("cleavage", "body_part"),
    "underboob":            ("underboob", "body_part"),
    "sideboob":             ("sideboob", "body_part"),
    "ass":                  ("ass", "body_part"),
    "huge_ass":             ("huge ass", "body_part"),
    "large_ass":            ("large ass", "body_part"),
    "nipples":              ("nipples", "body_part"),
    "pussy":                ("pussy", "body_part"),
    "penis":                ("penis", "body_part"),
    "abs":                  ("abs", "body_part"),
    "thighs":               ("thighs", "body_part"),
    "thick_thighs":         ("thick thighs", "body_part"),
    "feet":                 ("feet", "body_part"),
    "legs":                 ("legs", "body_part"),
    "navel":                ("navel", "body_part"),
    "armpits":              ("armpits", "body_part"),
    "cameltoe":             ("cameltoe", "body_part"),
    # Nudity level
    "nude":                 ("nude", "nudity_level"),
    "naked":                ("nude", "nudity_level"),
    "topless":              ("topless", "nudity_level"),
    "bottomless":           ("bottomless", "nudity_level"),
    "clothed":              ("clothed", "nudity_level"),
    "fully_clothed":        ("fully clothed", "nudity_level"),
    "partially_clothed":    ("partially clothed", "nudity_level"),
    "see-through":          ("see-through", "nudity_level"),
    "see_through":          ("see-through", "nudity_level"),
    "wet":                  ("wet", "nudity_level"),
    "covered_nipples":      ("covered nipples", "nudity_level"),
    "pasties":              ("pasties", "nudity_level"),
    "nipple_covers":        ("pasties", "nudity_level"),
    "implied_nude":         ("implied nudity", "nudity_level"),
    "implied_nudity":       ("implied nudity", "nudity_level"),
    "censored":             ("censored", "nudity_level"),
    "convenient_censoring": ("convenient censoring", "nudity_level"),
    "strategic_clothing":   ("convenient censoring", "nudity_level"),
    # Clothing
    "bikini":               ("bikini", "clothing"),
    "swimsuit":             ("swimsuit", "clothing"),
    "one-piece_swimsuit":   ("one-piece swimsuit", "clothing"),
    "lingerie":             ("lingerie", "clothing"),
    "underwear":            ("underwear", "clothing"),
    "bra":                  ("bra", "clothing"),
    "panties":              ("panties", "clothing"),
    "thong":                ("thong", "clothing"),
    "school_uniform":       ("school uniform", "clothing"),
    "maid":                 ("maid outfit", "clothing"),
    "leotard":              ("leotard", "clothing"),
    "stockings":            ("stockings", "clothing"),
    "thighhighs":           ("thigh-highs", "clothing"),
    "fishnets":             ("fishnets", "clothing"),
    "corset":               ("corset", "clothing"),
    "collar":               ("collar", "clothing"),
    "cheerleader":          ("cheerleader", "clothing"),
    "nurse":                ("nurse outfit", "clothing"),
    "bunny_suit":           ("bunny suit", "clothing"),
    "gym_uniform":          ("gym outfit", "clothing"),
    "office_lady":          ("office outfit", "clothing"),
    "dress":                ("dress", "clothing"),
    "miniskirt":            ("miniskirt", "clothing"),
    "skirt":                ("skirt", "clothing"),
    "shorts":               ("shorts", "clothing"),
    "gloves":               ("gloves", "clothing"),
    "elbow_gloves":         ("gloves", "clothing"),
    "earrings":             ("earrings", "clothing"),
    "high_heels":           ("high heels", "clothing"),
    "stiletto_heels":       ("high heels", "clothing"),
    "platform_heels":       ("high heels", "clothing"),
    "heels":                ("high heels", "clothing"),
    # Pose
    "standing":             ("standing", "pose"),
    "sitting":              ("sitting", "pose"),
    "lying":                ("lying down", "pose"),
    "kneeling":             ("kneeling", "pose"),
    "squatting":            ("squatting", "pose"),
    "bent_over":            ("bent over", "pose"),
    "on_all_fours":         ("on all fours", "pose"),
    "from_behind":          ("from behind", "pose"),
    "close-up":             ("close-up", "pose"),
    "full_body":            ("full body", "pose"),
    "upper_body":           ("upper body", "pose"),
    "spread_legs":          ("spread legs", "pose"),
    "arm_up":               ("arm up", "pose"),
    "arms_up":              ("arms up", "pose"),
    "on_back":              ("on back", "pose"),
    "on_stomach":           ("on stomach", "pose"),
    # Style
    "realistic":            ("photorealistic", "style"),
    "3d":                   ("3d render", "style"),
    "photorealistic":       ("photorealistic", "style"),
    "sketch":               ("sketch", "style"),
    "comic":                ("comic", "style"),
    # Physical features — hair color
    "blonde_hair":          ("blonde hair", "physical_feature"),
    "black_hair":           ("black hair", "physical_feature"),
    "brown_hair":           ("brown hair", "physical_feature"),
    "red_hair":             ("red hair", "physical_feature"),
    "white_hair":           ("white hair", "physical_feature"),
    "silver_hair":          ("silver hair", "physical_feature"),
    "pink_hair":            ("pink hair", "physical_feature"),
    "blue_hair":            ("blue hair", "physical_feature"),
    "green_hair":           ("green hair", "physical_feature"),
    "purple_hair":          ("purple hair", "physical_feature"),
    "orange_hair":          ("orange hair", "physical_feature"),
    "multicolored_hair":    ("multicolor hair", "physical_feature"),
    "gradient_hair":        ("multicolor hair", "physical_feature"),
    "streaked_hair":        ("multicolor hair", "physical_feature"),
    # Physical features — hair length & style
    "short_hair":           ("short hair", "physical_feature"),
    "medium_hair":          ("medium hair", "physical_feature"),
    "long_hair":            ("long hair", "physical_feature"),
    "very_long_hair":       ("very long hair", "physical_feature"),
    "twintails":            ("twin tails", "physical_feature"),
    "twin_tails":           ("twin tails", "physical_feature"),
    "ponytail":             ("ponytail", "physical_feature"),
    "braid":                ("braided hair", "physical_feature"),
    "braided_hair":         ("braided hair", "physical_feature"),
    "ahoge":                ("ahoge", "physical_feature"),
    "hair_bun":             ("hair bun", "physical_feature"),
    "wavy_hair":            ("wavy hair", "physical_feature"),
    "curly_hair":           ("curly hair", "physical_feature"),
    "straight_hair":        ("straight hair", "physical_feature"),
    "bob_cut":              ("bob cut", "physical_feature"),
    "pigtails":             ("pigtails", "physical_feature"),
    # Physical features — eye color
    "blue_eyes":            ("blue eyes", "physical_feature"),
    "green_eyes":           ("green eyes", "physical_feature"),
    "brown_eyes":           ("brown eyes", "physical_feature"),
    "red_eyes":             ("red eyes", "physical_feature"),
    "purple_eyes":          ("purple eyes", "physical_feature"),
    "yellow_eyes":          ("yellow eyes", "physical_feature"),
    "pink_eyes":            ("pink eyes", "physical_feature"),
    "aqua_eyes":            ("aqua eyes", "physical_feature"),
    "orange_eyes":          ("orange eyes", "physical_feature"),
    "heterochromia":        ("heterochromia", "physical_feature"),
    # Physical features — skin & body type
    "pale_skin":            ("pale skin", "physical_feature"),
    "dark_skin":            ("dark skin", "physical_feature"),
    "tan":                  ("tan skin", "physical_feature"),
    "tan_skin":             ("tan skin", "physical_feature"),
    "light_skin":           ("light skin", "physical_feature"),
    "petite":               ("petite", "physical_feature"),
    "curvy":                ("curvy", "physical_feature"),
    "toned":                ("toned", "physical_feature"),
    "athletic":             ("athletic", "physical_feature"),
    "muscular":             ("muscular", "physical_feature"),
    "chubby":               ("chubby", "physical_feature"),
    "plump":                ("chubby", "physical_feature"),
    "slender":              ("slender", "physical_feature"),
    "wide_hips":            ("wide hips", "physical_feature"),
    # Sex acts — penetration
    "sex":                  ("sex", "sex_act"),
    "vaginal":              ("vaginal sex", "sex_act"),
    "penis_in_vagina":      ("vaginal sex", "sex_act"),
    "anal":                 ("anal sex", "sex_act"),
    "anal_sex":             ("anal sex", "sex_act"),
    "double_penetration":   ("double penetration", "sex_act"),
    "triple_penetration":   ("triple penetration", "sex_act"),
    "multiple_penetration": ("multiple penetration", "sex_act"),
    "gangbang":             ("gangbang", "sex_act"),
    "group_sex":            ("orgy", "sex_act"),
    "orgy":                 ("orgy", "sex_act"),
    # Sex acts — oral
    "fellatio":             ("blowjob", "sex_act"),
    "oral":                 ("oral sex", "sex_act"),
    "blowjob":              ("blowjob", "sex_act"),
    "cunnilingus":          ("cunnilingus", "sex_act"),
    "deepthroat":           ("deepthroat", "sex_act"),
    "irrumatio":            ("deepthroat", "sex_act"),
    # Sex acts — manual / other
    "handjob":              ("handjob", "sex_act"),
    "paizuri":              ("titjob", "sex_act"),
    "breast_sex":           ("titjob", "sex_act"),
    "footjob":              ("footjob", "sex_act"),
    "fingering":            ("fingering", "sex_act"),
    "fisting":              ("fisting", "sex_act"),
    "masturbation":         ("masturbation", "sex_act"),
    "female_masturbation":  ("masturbation", "sex_act"),
    # Sex acts — cum / finish
    "ejaculation":          ("cumshot", "sex_act"),
    "cum":                  ("cumshot", "sex_act"),
    "facial":               ("facial", "sex_act"),
    "cum_on_face":          ("facial", "sex_act"),
    "creampie":             ("creampie", "sex_act"),
    "internal_cumshot":     ("creampie", "sex_act"),
    "vaginal_ejaculation":  ("creampie", "sex_act"),
    "anal_ejaculation":     ("anal creampie", "sex_act"),
    "cum_in_ass":           ("anal creampie", "sex_act"),
    "cum_on_body":          ("cum on body", "sex_act"),
    "multiple_creampie":    ("multiple creampie", "sex_act"),
    # Sex acts — state / aftermath
    "gaping":               ("gaping", "sex_act"),
    "ahegao":               ("ahegao", "sex_act"),
    "squirting":            ("squirting", "sex_act"),
    "orgasm":               ("orgasm", "sex_act"),
    "condom":               ("condom", "sex_act"),
    "used_condom":          ("condom", "sex_act"),
    # Sex acts — toys
    "sex_toy":              ("sex toy", "sex_act"),
    "vibrator":             ("vibrator", "sex_act"),
    "dildo":                ("dildo", "sex_act"),
    "strap-on":             ("strap-on", "sex_act"),
    # Sex acts — hentai-specific
    "tentacles":            ("tentacle sex", "sex_act"),
    "tentacle_sex":         ("tentacle sex", "sex_act"),
    "futanari":             ("futanari", "sex_act"),
    "futa":                 ("futanari", "sex_act"),
    # Position (sex positions — distinct from pose)
    "missionary":           ("missionary", "position"),
    "missionary_position":  ("missionary", "position"),
    "doggystyle":           ("doggy style", "position"),
    "doggy_style":          ("doggy style", "position"),
    "cowgirl_position":     ("cowgirl", "position"),
    "reverse_cowgirl_position": ("reverse cowgirl", "position"),
    "standing_sex":         ("standing sex", "position"),
    "spitroast":            ("spitroast", "position"),
    "mating_press":         ("mating press", "position"),
    "lotus_position":       ("lotus position", "position"),
    "69":                   ("69 position", "position"),
}

JOYTAG_TAG_MAP: dict[str, tuple[str, str]] = {
    # Person / subject count
    "solo":                 ("solo", "subject"),
    "1 person":             ("solo", "subject"),
    "2 people":             ("duo", "subject"),
    "duo":                  ("duo", "subject"),
    "3 people":             ("group", "subject"),
    "4 people":             ("group", "subject"),
    "5+ people":            ("group", "subject"),
    "group":                ("group", "subject"),
    "multiple people":      ("group", "subject"),
    # Body parts
    "breasts":              ("breasts", "body_part"),
    "large breasts":        ("large breasts", "body_part"),
    "huge breasts":         ("huge breasts", "body_part"),
    "small breasts":        ("small breasts", "body_part"),
    "cleavage":             ("cleavage", "body_part"),
    "ass":                  ("ass", "body_part"),
    "large ass":            ("large ass", "body_part"),
    "nipples":              ("nipples", "body_part"),
    "vagina":               ("pussy", "body_part"),
    "penis":                ("penis", "body_part"),
    "abs":                  ("abs", "body_part"),
    "thighs":               ("thighs", "body_part"),
    "thick thighs":         ("thick thighs", "body_part"),
    "feet":                 ("feet", "body_part"),
    "legs":                 ("legs", "body_part"),
    "navel":                ("navel", "body_part"),
    "armpits":              ("armpits", "body_part"),
    "cameltoe":             ("cameltoe", "body_part"),
    # Nudity level
    "nude":                 ("nude", "nudity_level"),
    "naked":                ("nude", "nudity_level"),
    "topless":              ("topless", "nudity_level"),
    "bottomless":           ("bottomless", "nudity_level"),
    "clothed":              ("clothed", "nudity_level"),
    "fully clothed":        ("fully clothed", "nudity_level"),
    "partially clothed":    ("partially clothed", "nudity_level"),
    "see-through":          ("see-through", "nudity_level"),
    "implied nudity":       ("implied nudity", "nudity_level"),
    "pasties":              ("pasties", "nudity_level"),
    "covered nipples":      ("covered nipples", "nudity_level"),
    # Clothing
    "bikini":               ("bikini", "clothing"),
    "swimsuit":             ("swimsuit", "clothing"),
    "lingerie":             ("lingerie", "clothing"),
    "underwear":            ("underwear", "clothing"),
    "bra":                  ("bra", "clothing"),
    "panties":              ("panties", "clothing"),
    "thong":                ("thong", "clothing"),
    "school uniform":       ("school uniform", "clothing"),
    "maid outfit":          ("maid outfit", "clothing"),
    "maid":                 ("maid outfit", "clothing"),
    "leotard":              ("leotard", "clothing"),
    "stockings":            ("stockings", "clothing"),
    "thigh-highs":          ("thigh-highs", "clothing"),
    "thigh highs":          ("thigh-highs", "clothing"),
    "fishnets":             ("fishnets", "clothing"),
    "corset":               ("corset", "clothing"),
    "collar":               ("collar", "clothing"),
    "cheerleader":          ("cheerleader", "clothing"),
    "bunny suit":           ("bunny suit", "clothing"),
    "nurse outfit":         ("nurse outfit", "clothing"),
    "nurse":                ("nurse outfit", "clothing"),
    "dress":                ("dress", "clothing"),
    "miniskirt":            ("miniskirt", "clothing"),
    "skirt":                ("skirt", "clothing"),
    "shorts":               ("shorts", "clothing"),
    "gloves":               ("gloves", "clothing"),
    "earrings":             ("earrings", "clothing"),
    "high heels":           ("high heels", "clothing"),
    "heels":                ("high heels", "clothing"),
    "stilettos":            ("high heels", "clothing"),
    "platform heels":       ("high heels", "clothing"),
    "platform shoes":       ("high heels", "clothing"),
    # Pose
    "standing":             ("standing", "pose"),
    "sitting":              ("sitting", "pose"),
    "lying down":           ("lying down", "pose"),
    "kneeling":             ("kneeling", "pose"),
    "squatting":            ("squatting", "pose"),
    "bent over":            ("bent over", "pose"),
    "on all fours":         ("on all fours", "pose"),
    "from behind":          ("from behind", "pose"),
    "close-up":             ("close-up", "pose"),
    "full body":            ("full body", "pose"),
    "upper body":           ("upper body", "pose"),
    "spread legs":          ("spread legs", "pose"),
    # Content rating
    "safe":                 ("safe", "rating"),
    "suggestive":           ("suggestive", "rating"),
    "explicit":             ("explicit", "rating"),
    # Physical features — hair color
    "blonde hair":          ("blonde hair", "physical_feature"),
    "black hair":           ("black hair", "physical_feature"),
    "brown hair":           ("brown hair", "physical_feature"),
    "red hair":             ("red hair", "physical_feature"),
    "white hair":           ("white hair", "physical_feature"),
    "silver hair":          ("silver hair", "physical_feature"),
    "pink hair":            ("pink hair", "physical_feature"),
    "blue hair":            ("blue hair", "physical_feature"),
    "green hair":           ("green hair", "physical_feature"),
    "purple hair":          ("purple hair", "physical_feature"),
    "orange hair":          ("orange hair", "physical_feature"),
    "multicolor hair":      ("multicolor hair", "physical_feature"),
    "dyed hair":            ("multicolor hair", "physical_feature"),
    # Physical features — hair length & style
    "short hair":           ("short hair", "physical_feature"),
    "medium hair":          ("medium hair", "physical_feature"),
    "long hair":            ("long hair", "physical_feature"),
    "very long hair":       ("very long hair", "physical_feature"),
    "twin tails":           ("twin tails", "physical_feature"),
    "twintails":            ("twin tails", "physical_feature"),
    "ponytail":             ("ponytail", "physical_feature"),
    "braids":               ("braided hair", "physical_feature"),
    "braided hair":         ("braided hair", "physical_feature"),
    "wavy hair":            ("wavy hair", "physical_feature"),
    "curly hair":           ("curly hair", "physical_feature"),
    "pigtails":             ("pigtails", "physical_feature"),
    # Physical features — eye color
    "blue eyes":            ("blue eyes", "physical_feature"),
    "green eyes":           ("green eyes", "physical_feature"),
    "brown eyes":           ("brown eyes", "physical_feature"),
    "red eyes":             ("red eyes", "physical_feature"),
    "purple eyes":          ("purple eyes", "physical_feature"),
    "yellow eyes":          ("yellow eyes", "physical_feature"),
    "heterochromia":        ("heterochromia", "physical_feature"),
    # Physical features — skin & body type
    "pale skin":            ("pale skin", "physical_feature"),
    "dark skin":            ("dark skin", "physical_feature"),
    "tan skin":             ("tan skin", "physical_feature"),
    "tanned":               ("tan skin", "physical_feature"),
    "petite":               ("petite", "physical_feature"),
    "curvy":                ("curvy", "physical_feature"),
    "toned":                ("toned", "physical_feature"),
    "athletic":             ("athletic", "physical_feature"),
    "muscular":             ("muscular", "physical_feature"),
    "chubby":               ("chubby", "physical_feature"),
    "wide hips":            ("wide hips", "physical_feature"),
    # Sex acts — penetration
    "sex":                  ("sex", "sex_act"),
    "vaginal sex":          ("vaginal sex", "sex_act"),
    "penetration":          ("vaginal sex", "sex_act"),
    "anal sex":             ("anal sex", "sex_act"),
    "anal penetration":     ("anal sex", "sex_act"),
    "double penetration":   ("double penetration", "sex_act"),
    "triple penetration":   ("triple penetration", "sex_act"),
    "gangbang":             ("gangbang", "sex_act"),
    "group sex":            ("orgy", "sex_act"),
    "orgy":                 ("orgy", "sex_act"),
    # Sex acts — oral
    "blowjob":              ("blowjob", "sex_act"),
    "oral sex":             ("oral sex", "sex_act"),
    "fellatio":             ("blowjob", "sex_act"),
    "cunnilingus":          ("cunnilingus", "sex_act"),
    "deepthroat":           ("deepthroat", "sex_act"),
    # Sex acts — manual / other
    "handjob":              ("handjob", "sex_act"),
    "titjob":               ("titjob", "sex_act"),
    "paizuri":              ("titjob", "sex_act"),
    "footjob":              ("footjob", "sex_act"),
    "fingering":            ("fingering", "sex_act"),
    "fisting":              ("fisting", "sex_act"),
    "masturbation":         ("masturbation", "sex_act"),
    "self pleasure":        ("masturbation", "sex_act"),
    # Sex acts — cum / finish
    "cumshot":              ("cumshot", "sex_act"),
    "facial":               ("facial", "sex_act"),
    "creampie":             ("creampie", "sex_act"),
    "anal creampie":        ("anal creampie", "sex_act"),
    "cum on body":          ("cum on body", "sex_act"),
    # Sex acts — state / aftermath
    "gaping":               ("gaping", "sex_act"),
    "ahegao":               ("ahegao", "sex_act"),
    "squirting":            ("squirting", "sex_act"),
    "orgasm":               ("orgasm", "sex_act"),
    "condom":               ("condom", "sex_act"),
    # Sex acts — toys
    "sex toy":              ("sex toy", "sex_act"),
    "vibrator":             ("vibrator", "sex_act"),
    "dildo":                ("dildo", "sex_act"),
    "strap-on":             ("strap-on", "sex_act"),
    # Sex acts — hentai-specific
    "tentacle sex":         ("tentacle sex", "sex_act"),
    "futanari":             ("futanari", "sex_act"),
    # Position
    "missionary":           ("missionary", "position"),
    "missionary position":  ("missionary", "position"),
    "doggy style":          ("doggy style", "position"),
    "doggystyle":           ("doggy style", "position"),
    "cowgirl":              ("cowgirl", "position"),
    "cowgirl position":     ("cowgirl", "position"),
    "reverse cowgirl":      ("reverse cowgirl", "position"),
    "standing sex":         ("standing sex", "position"),
    "spitroast":            ("spitroast", "position"),
    "mating press":         ("mating press", "position"),
    "69 position":          ("69 position", "position"),
    "69":                   ("69 position", "position"),
}

# WD14 cat-4 tags that are NOT real character names — suppress passthrough
WD14_SKIP_TAGS: set[str] = {
    # WD14 meta / noise
    "cosplay_photo", "photo_(medium)", "hair_ornament", "hair_ornaments",
    "jewelry", "simple_background", "white_background", "gradient_background",
    "watermark", "text_focus", "english_text", "signature", "artist_name",
    "web_address", "patreon_username", "twitter_username", "logo",
    "copyright_name", "tag_group_(content_advisory)",
    # General noise shared by WD14 + JoyTag (underscore form)
    "indoors", "outdoors", "looking_at_viewer", "looking_away", "looking_back",
    "looking_to_the_side", "open_mouth", "closed_mouth", "blush", "sweat",
    "smile", "expressionless", "angry", "surprised", "embarrassed",
    "light_smile", "parted_lips", "teeth", "tongue", "tongue_out",
    "background", "bokeh", "depth_of_field", "lens_flare", "film_grain",
    "scenery", "sky", "day", "night", "sunlight", "shadow",
    "multiple_views", "reference_sheet", "character_sheet", "official_art",
}

# person_count integer extracted from subject tags
WD14_PERSON_COUNT: dict[str, int] = {
    "solo": 1, "1girl": 1, "1boy": 1, "1other": 1,
    "2girls": 2, "2boys": 2, "1boy1girl": 2, "1girl1boy": 2, "2others": 2,
    "3girls": 3, "3boys": 3,
    "4girls": 4, "4boys": 4,
    "5girls": 5, "5boys": 5,
    "6+girls": 6, "6+boys": 6,
    "multiple_girls": 3, "multiple_boys": 3, "multiple_others": 3,
    "group": 4,
}

JOYTAG_PERSON_COUNT: dict[str, int] = {
    "solo": 1, "1 person": 1,
    "2 people": 2, "duo": 2,
    "3 people": 3,
    "4 people": 4,
    "5+ people": 5,
    "group": 4, "multiple people": 4,
}

# Creator types → tagger model routing
JOYTAG_CREATOR_TYPES = {"cosplayer", "ethot", "actress", "custom"}
WD14_CREATOR_TYPES   = {"artist", "character"}


# ── Tagger state (mirrors scanner._state pattern) ─────────────────────────────
_lock = threading.Lock()
_state: dict = {
    "running":        False,
    "progress":       0,
    "total":          0,
    "tagged":         0,
    "skipped":        0,
    "errors":         0,
    "message":        "Idle",
    "current_path":   None,
    "cancelled":      False,
    "active_model":   None,   # "wd14-swinv2-v3" | "joytag" | None
    "device":         None,   # "gpu" | "cpu" | None (set when first model loads)
}

def get_tagger_state() -> dict:
    with _lock:
        return dict(_state)

def _set(**kwargs):
    with _lock:
        _state.update(kwargs)

def cancel_tagger():
    _set(cancelled=True)

def _is_cancelled() -> bool:
    with _lock:
        return _state["cancelled"]


# ── Model paths ───────────────────────────────────────────────────────────────
def _models_dir() -> str:
    from database import DATA_DIR
    d = os.path.join(DATA_DIR, "models")
    os.makedirs(d, exist_ok=True)
    return d

def _wd14_dir() -> str:
    d = os.path.join(_models_dir(), "wd14")
    os.makedirs(d, exist_ok=True)
    return d

def _joytag_dir() -> str:
    d = os.path.join(_models_dir(), "joytag")
    os.makedirs(d, exist_ok=True)
    return d

def wd14_is_ready() -> bool:
    d = _wd14_dir()
    return (
        os.path.exists(os.path.join(d, "model.onnx")) and
        os.path.exists(os.path.join(d, "selected_tags.csv"))
    )

def joytag_is_ready() -> bool:
    d = _joytag_dir()
    return (
        os.path.exists(os.path.join(d, "model.onnx")) and
        os.path.exists(os.path.join(d, "top_tags.txt"))
    )

def _dir_size_mb(path: str) -> Optional[float]:
    total = 0
    for root, _, files in os.walk(path):
        for f in files:
            try:
                total += os.path.getsize(os.path.join(root, f))
            except OSError:
                pass
    return round(total / 1_048_576, 1) if total else None


# ── Model download ────────────────────────────────────────────────────────────
def download_wd14():
    from huggingface_hub import hf_hub_download
    d = _wd14_dir()
    _set(message="Downloading WD14 model (model.onnx ~200 MB)…")
    hf_hub_download("SmilingWolf/wd-swinv2-tagger-v3", "model.onnx",        local_dir=d)
    _set(message="Downloading WD14 tag list…")
    hf_hub_download("SmilingWolf/wd-swinv2-tagger-v3", "selected_tags.csv", local_dir=d)
    _set(message="WD14 download complete.")

def download_joytag():
    from huggingface_hub import hf_hub_download
    d = _joytag_dir()
    _set(message="Downloading JoyTag model (model.onnx ~366 MB)…")
    hf_hub_download("fancyfeast/joytag", "model.onnx",  local_dir=d)
    _set(message="Downloading JoyTag tag list…")
    hf_hub_download("fancyfeast/joytag", "top_tags.txt", local_dir=d)
    _set(message="JoyTag download complete.")


# ── ONNX session helper ───────────────────────────────────────────────────────
def _gpu_enabled() -> bool:
    """Read the use_gpu flag from vault_config.json. Defaults to True."""
    try:
        from database import CONFIG_FILE
        import json
        if os.path.isfile(CONFIG_FILE):
            with open(CONFIG_FILE, 'r', encoding='utf-8') as f:
                return bool(json.load(f).get("use_gpu", True))
    except Exception:
        pass
    return True


def _make_session(model_path: str):
    import onnxruntime as ort
    available = ort.get_available_providers()
    logger.info("AI tagger: ORT providers available: %s", available)
    if _gpu_enabled() and "CUDAExecutionProvider" in available:
        try:
            # log_severity_level=3 suppresses the benign "Memcpy nodes added" warning
            # that fires when a few ops fall back to CPU — GPU still runs the model bulk.
            sess_opts = ort.SessionOptions()
            sess_opts.log_severity_level = 3
            session = ort.InferenceSession(
                model_path,
                sess_options=sess_opts,
                providers=["CUDAExecutionProvider", "CPUExecutionProvider"]
            )
            logger.info("AI tagger: using CUDA (GPU) for %s", model_path)
            _set(device="gpu")
            return session
        except Exception as e:
            logger.warning("AI tagger: CUDA init failed (%s) — falling back to CPU", e)
    else:
        if not _gpu_enabled():
            logger.info("AI tagger: GPU disabled in settings — using CPU")
        else:
            logger.warning("AI tagger: CUDAExecutionProvider not in available providers — using CPU. "
                           "Check that nvidia DLL dirs are in PATH at startup.")
    logger.info("AI tagger: using CPU for %s", model_path)
    _set(device="cpu")
    return ort.InferenceSession(model_path, providers=["CPUExecutionProvider"])


# ── Image preprocessing ───────────────────────────────────────────────────────
TARGET_SIZE = 448

def _to_rgb_square(img: PILImage.Image) -> PILImage.Image:
    """Convert any image to a white-backgrounded RGB 448×448 square."""
    # Handle transparency — composite on white before converting
    if img.mode in ("RGBA", "LA", "P"):
        canvas = PILImage.new("RGBA", img.size, (255, 255, 255, 255))
        canvas.alpha_composite(img.convert("RGBA"))
        img = canvas.convert("RGB")
    else:
        img = img.convert("RGB")
    # Pad to square on the longest edge, then resize
    w, h = img.size
    max_side = max(w, h)
    padded = PILImage.new("RGB", (max_side, max_side), (255, 255, 255))
    padded.paste(img, ((max_side - w) // 2, (max_side - h) // 2))
    return padded.resize((TARGET_SIZE, TARGET_SIZE), PILImage.BICUBIC)

def _preprocess_wd14(img: PILImage.Image) -> np.ndarray:
    """WD14 SwinV2 v3: RGB, 0-255 float32, NHWC — NO channel reversal."""
    img = _to_rgb_square(img)
    arr = np.asarray(img, dtype=np.float32)   # shape (448, 448, 3) — RGB
    return arr[np.newaxis, :]                  # (1, 448, 448, 3)

def _preprocess_joytag(img: PILImage.Image) -> np.ndarray:
    """JoyTag: RGB, ImageNet-normalised, NCHW."""
    img = _to_rgb_square(img)
    arr = np.asarray(img, dtype=np.float32) / 255.0
    mean = np.array([0.485, 0.456, 0.406], dtype=np.float32)
    std  = np.array([0.229, 0.224, 0.225], dtype=np.float32)
    arr  = (arr - mean) / std
    arr  = arr.transpose(2, 0, 1)              # HWC → CHW
    return arr[np.newaxis, :]                  # (1, 3, 448, 448)


# ── WD14 runner ───────────────────────────────────────────────────────────────
class WD14Tagger:
    MODEL_NAME = "wd14-swinv2-v3"

    def __init__(self):
        d = _wd14_dir()
        self._session     = _make_session(os.path.join(d, "model.onnx"))
        self._input_name  = self._session.get_inputs()[0].name
        self._output_name = self._session.get_outputs()[0].name

        # CSV columns: tag_id, name, category, count
        # WD14 category codes: 9=rating, 0=general, 4=character, 3=copyright, 5=artist
        self._tags: list[tuple[str, int]] = []
        tag_csv = os.path.join(d, "selected_tags.csv")
        with open(tag_csv, newline="", encoding="utf-8") as f:
            for row in csv.DictReader(f):
                self._tags.append((row["name"], int(row["category"])))

    def tag(self, image_path: str, threshold: float) -> tuple[list[tuple[str, str, float]], Optional[int]]:
        """Returns list of (normalized_name, category, confidence) and person_count."""
        try:
            img = PILImage.open(image_path)
            inp = _preprocess_wd14(img)
        except Exception as e:
            logger.debug("WD14 preprocess failed for %s: %s", image_path, e)
            return [], None

        probs = self._session.run([self._output_name], {self._input_name: inp})[0][0]

        results: list[tuple[str, str, float]] = []
        person_count: Optional[int] = None

        for i, (raw_name, wd14_cat) in enumerate(self._tags):
            conf = float(probs[i])
            # Always evaluate rating tags; others need to clear threshold
            if conf < threshold and wd14_cat != 9:
                continue

            raw_lower = raw_name.lower()

            # Derive person_count from subject-count tags
            if raw_lower in WD14_PERSON_COUNT:
                pc = WD14_PERSON_COUNT[raw_lower]
                if person_count is None or pc > person_count:
                    person_count = pc

            if raw_lower in WD14_SKIP_TAGS:
                continue   # noise / meta tag — never pass through
            elif raw_lower in WD14_TAG_MAP:
                norm_name, norm_cat = WD14_TAG_MAP[raw_lower]
                results.append((norm_name, norm_cat, conf))
            elif wd14_cat == 4:
                # True character name — pass through with underscores replaced
                results.append((raw_name.replace("_", " "), "character", conf))
            # General / copyright / artist tags not in our map are dropped

        return results, person_count


# ── JoyTag runner ─────────────────────────────────────────────────────────────
class JoyTagTagger:
    MODEL_NAME = "joytag"

    def __init__(self):
        d = _joytag_dir()
        self._session     = _make_session(os.path.join(d, "model.onnx"))
        self._input_name  = self._session.get_inputs()[0].name
        self._output_name = self._session.get_outputs()[0].name

        tag_file = os.path.join(d, "top_tags.txt")
        with open(tag_file, encoding="utf-8") as f:
            self._tags: list[str] = [line.strip() for line in f if line.strip()]

    def tag(self, image_path: str, threshold: float) -> tuple[list[tuple[str, str, float]], Optional[int]]:
        """Returns list of (normalized_name, category, confidence) and person_count."""
        try:
            img = PILImage.open(image_path)
            inp = _preprocess_joytag(img)
        except Exception as e:
            logger.debug("JoyTag preprocess failed for %s: %s", image_path, e)
            return [], None

        probs = self._session.run([self._output_name], {self._input_name: inp})[0][0]

        results: list[tuple[str, str, float]] = []
        person_count: Optional[int] = None

        for i, raw_name in enumerate(self._tags):
            if i >= len(probs):
                break
            conf = float(probs[i])
            if conf < threshold:
                continue

            # fancyfeast/joytag top_tags.txt uses danbooru underscore format.
            # Normalise to spaces so our maps (built with spaces) match correctly.
            raw_lower  = raw_name.lower().replace("_", " ")
            raw_under  = raw_name.lower()   # original underscore form for WD14 fallback

            # Person count (check both forms)
            if raw_lower in JOYTAG_PERSON_COUNT:
                pc = JOYTAG_PERSON_COUNT[raw_lower]
                if person_count is None or pc > person_count:
                    person_count = pc
            elif raw_under in JOYTAG_PERSON_COUNT:
                pc = JOYTAG_PERSON_COUNT[raw_under]
                if person_count is None or pc > person_count:
                    person_count = pc

            if raw_lower in WD14_SKIP_TAGS or raw_under in WD14_SKIP_TAGS:
                continue   # skip noise tags shared with WD14

            if raw_lower in JOYTAG_TAG_MAP:
                # JoyTag-specific entry (natural-English key)
                norm_name, norm_cat = JOYTAG_TAG_MAP[raw_lower]
                results.append((norm_name, norm_cat, conf))
            elif raw_under in WD14_TAG_MAP:
                # Overlapping danbooru tag — use WD14 normalisation
                norm_name, norm_cat = WD14_TAG_MAP[raw_under]
                results.append((norm_name, norm_cat, conf))
            # Anything still unmapped is dropped — no raw general passthrough

        return results, person_count


# ── Lazy-loaded singletons ────────────────────────────────────────────────────
_wd14:   Optional["WD14Tagger"]    = None
_joytag: Optional["JoyTagTagger"]  = None

def _get_wd14() -> Optional["WD14Tagger"]:
    global _wd14
    if _wd14 is None and wd14_is_ready():
        _wd14 = WD14Tagger()
    return _wd14

def _get_joytag() -> Optional["JoyTagTagger"]:
    global _joytag
    if _joytag is None and joytag_is_ready():
        _joytag = JoyTagTagger()
    return _joytag

def _reset_singletons():
    """Call after downloading models so they're reloaded on next use."""
    global _wd14, _joytag
    _wd14 = None
    _joytag = None


# ── DB helpers ────────────────────────────────────────────────────────────────
def _get_or_create_tag(db, name: str, category: str) -> "Tag":
    from models import Tag, TagSource
    tag = db.query(Tag).filter(Tag.name == name).first()
    if not tag:
        tag = Tag(name=name, category=category, source=TagSource.ai)
        db.add(tag)
        db.flush()
    return tag

def _upsert_image_tag(db, image_id: int, tag_id: int, confidence: float, model_name: str):
    from sqlalchemy.dialects.sqlite import insert as sqlite_insert
    from models import image_tags
    stmt = (
        sqlite_insert(image_tags)
        .values(image_id=image_id, tag_id=tag_id, confidence=confidence, tagger_model=model_name)
        .on_conflict_do_update(
            index_elements=["image_id", "tag_id"],
            set_={"confidence": confidence, "tagger_model": model_name},
        )
    )
    db.execute(stmt)


# ── Per-image tagging ─────────────────────────────────────────────────────────
def _tagger_for_image(img, model_override: Optional[str] = None) -> Optional[object]:
    """Select WD14 or JoyTag.
    model_override: 'wd14' | 'joytag' | None (auto from creator type)

    Auto-selection priority when a gallery has multiple creators of mixed types:
      any real-person type (cosplayer/ethot/actress/custom) → JoyTag
      artist/character only                                  → WD14
      no creator assigned                                    → JoyTag (safe default)
    """
    if model_override == "wd14":
        return _get_wd14()
    if model_override == "joytag":
        tagger = _get_joytag()
        if tagger is None:
            tagger = _get_wd14()
        return tagger

    # Auto: check ALL assigned creators — real-person types always win
    if img.gallery and img.gallery.creators:
        creator_types = {str(c.creator_type).lower() for c in img.gallery.creators}
        if creator_types & JOYTAG_CREATOR_TYPES:
            tagger = _get_joytag()
            if tagger is None:
                tagger = _get_wd14()
            return tagger
        if creator_types & WD14_CREATOR_TYPES:
            return _get_wd14()

    # No creator assigned or unrecognised type → JoyTag, fallback WD14
    tagger = _get_joytag()
    if tagger is None:
        tagger = _get_wd14()
    return tagger


# ── Video frame extraction ────────────────────────────────────────────────────
VIDEO_FRAME_COUNT = 4   # evenly-spaced frames sampled per video


def _get_ffmpeg_exe() -> str:
    import sys
    exe = "ffmpeg.exe" if sys.platform == "win32" else "ffmpeg"
    if getattr(sys, "frozen", False):
        bundled = os.path.join(sys._MEIPASS, exe)
        if os.path.isfile(bundled):
            return bundled
    return exe


def _video_duration(video_path: str) -> Optional[float]:
    """Return video duration in seconds via ffprobe, or None on failure."""
    import subprocess, sys
    exe = _get_ffmpeg_exe().replace("ffmpeg", "ffprobe")
    no_win = subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0
    try:
        r = subprocess.run(
            [exe, "-v", "error", "-show_entries", "format=duration",
             "-of", "default=noprint_wrappers=1:nokey=1", video_path],
            capture_output=True, text=True, timeout=15, creationflags=no_win,
        )
        return float(r.stdout.strip())
    except Exception:
        return None


def _extract_video_frames(video_path: str, count: int = VIDEO_FRAME_COUNT) -> tuple[list[str], str]:
    """Extract `count` evenly-spaced frames from a video to temp PNG files.
    Returns (frame_paths, tmpdir). Caller must shutil.rmtree(tmpdir)."""
    import subprocess, sys, tempfile
    ffmpeg = _get_ffmpeg_exe()
    no_win = subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0
    tmpdir = tempfile.mkdtemp(prefix="vault_vtag_")
    frames: list[str] = []

    duration = _video_duration(video_path)
    if duration and duration > 0:
        timestamps = [duration * (i + 1) / (count + 1) for i in range(count)]
    else:
        # Fixed fallback offsets — degrade gracefully for very short clips
        timestamps = [5.0, 15.0, 30.0, 90.0][:count]

    for i, t in enumerate(timestamps):
        out = os.path.join(tmpdir, f"frame_{i:02d}.png")
        try:
            r = subprocess.run(
                [ffmpeg, "-y", "-ss", str(t), "-i", video_path,
                 "-vframes", "1", "-vf", "scale=448:448:force_original_aspect_ratio=decrease",
                 "-q:v", "2", out],
                capture_output=True, timeout=30, creationflags=no_win,
            )
            if r.returncode == 0 and os.path.exists(out):
                frames.append(out)
        except Exception:
            pass

    # Last-resort: extract frame 0 if all seeks failed (very short or damaged video)
    if not frames:
        out0 = os.path.join(tmpdir, "frame_00.png")
        try:
            r = subprocess.run(
                [ffmpeg, "-y", "-i", video_path,
                 "-vframes", "1", "-vf", "scale=448:448:force_original_aspect_ratio=decrease",
                 "-q:v", "2", out0],
                capture_output=True, timeout=30, creationflags=no_win,
            )
            if r.returncode == 0 and os.path.exists(out0):
                frames.append(out0)
        except Exception:
            pass

    return frames, tmpdir


def _apply_nudity_heuristic(best: dict[str, tuple[str, float]]) -> dict[str, tuple[str, float]]:
    """Post-process: if 'nude' fires but explicit body parts don't, downgrade to 'implied nudity'."""
    EXPLICIT_BODY = {"nipples", "pussy", "penis", "vagina"}
    if "nude" in best and not any(k in best for k in EXPLICIT_BODY):
        cat, conf = best.pop("nude")
        # Only downgrade if implied nudity isn't already there with higher confidence
        existing = best.get("implied nudity")
        if existing is None or conf > existing[1]:
            best["implied nudity"] = ("nudity_level", conf)
    return best


def _clear_ai_tags(db, image_id: int):
    """Delete all AI-generated tags for an image, preserving manual ones.
    AI tags are identified by image_tags.tagger_model IS NOT NULL.
    Also decrements use_count on affected Tag rows.
    """
    from sqlalchemy import text
    # Find tag IDs that will be removed so we can decrement use_count
    rows = db.execute(
        text("SELECT tag_id FROM image_tags WHERE image_id = :id AND tagger_model IS NOT NULL"),
        {"id": image_id},
    ).fetchall()
    tag_ids = [r[0] for r in rows]

    if not tag_ids:
        return

    db.execute(
        text("DELETE FROM image_tags WHERE image_id = :id AND tagger_model IS NOT NULL"),
        {"id": image_id},
    )

    # Decrement use_count (floor at 0)
    from models import Tag
    for tid in tag_ids:
        tag = db.get(Tag, tid)
        if tag and tag.use_count and tag.use_count > 0:
            tag.use_count -= 1


def tag_single_image(
    img, db,
    threshold: float = 0.35,
    model_override: Optional[str] = None,
    clear_existing: bool = False,
) -> bool:
    """Tag one Image ORM object. Returns True on success, raises on hard error.

    clear_existing=True: removes all previous AI tags before writing new ones,
    so retag produces a clean slate (manual tags are always preserved).
    """
    tagger = _tagger_for_image(img, model_override)
    if tagger is None:
        raise RuntimeError("No tagger model is loaded — download WD14 or JoyTag first")

    raw_results, person_count = tagger.tag(img.file_path, threshold)

    # Clear stale AI tags before writing — do this regardless of results so a
    # retag with a higher threshold doesn't leave old low-confidence tags behind.
    if clear_existing:
        _clear_ai_tags(db, img.id)

    if not raw_results:
        return False   # model ran but produced nothing above threshold

    # Deduplicate by name (keep highest confidence per name)
    best: dict[str, tuple[str, float]] = {}
    for name, cat, conf in raw_results:
        if name not in best or conf > best[name][1]:
            best[name] = (cat, conf)

    # Post-processing heuristics
    best = _apply_nudity_heuristic(best)

    for name, (cat, conf) in best.items():
        tag = _get_or_create_tag(db, name, cat)
        _upsert_image_tag(db, img.id, tag.id, conf, tagger.MODEL_NAME)
        tag.use_count = (tag.use_count or 0) + 1

    img.ai_tagged    = True
    img.ai_tag_model = tagger.MODEL_NAME
    if person_count is not None:
        img.person_count = person_count

    return True


def tag_single_video(
    img,
    db,
    threshold: float = 0.35,
    model_override: Optional[str] = None,
    clear_existing: bool = False,
) -> bool:
    """Tag a video Image ORM object by sampling frames.
    Extracts VIDEO_FRAME_COUNT evenly-spaced frames, runs the appropriate tagger
    on each, and unions results keeping the highest confidence per tag name.
    Returns True if at least one tag was written."""
    import shutil

    tagger = _tagger_for_image(img, model_override)
    if tagger is None:
        raise RuntimeError("No tagger model is loaded — download WD14 or JoyTag first")

    frames, tmpdir = _extract_video_frames(img.file_path)
    if not frames:
        logger.debug("No frames extracted from %s", img.file_path)
        return False

    try:
        if clear_existing:
            _clear_ai_tags(db, img.id)

        # Aggregate across all frames — keep highest confidence per tag name
        best: dict[str, tuple[str, float]] = {}
        person_count: Optional[int] = None

        for frame_path in frames:
            raw_results, pc = tagger.tag(frame_path, threshold)
            if pc is not None and (person_count is None or pc > person_count):
                person_count = pc
            for name, cat, conf in raw_results:
                if name not in best or conf > best[name][1]:
                    best[name] = (cat, conf)

        if not best:
            return False

        best = _apply_nudity_heuristic(best)

        for name, (cat, conf) in best.items():
            tag = _get_or_create_tag(db, name, cat)
            _upsert_image_tag(db, img.id, tag.id, conf, tagger.MODEL_NAME)
            tag.use_count = (tag.use_count or 0) + 1

        img.ai_tagged    = True
        img.ai_tag_model = tagger.MODEL_NAME
        if person_count is not None:
            img.person_count = person_count

        return True
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)


# ── Bulk tagging worker (runs in background thread) ───────────────────────────
def bulk_tag_images(
    db,
    scope: str,
    folder_path: Optional[str],
    threshold: float,
    retag: bool,
    model_override: Optional[str] = None,   # 'wd14' | 'joytag' | None (auto)
    creator_id: Optional[int] = None,
):
    from models import Image, Gallery
    from sqlalchemy.orm import selectinload

    # Resolve the display name for the model indicator
    if model_override == "wd14":
        model_label = "WD14"
    elif model_override == "joytag":
        model_label = "JoyTag"
    else:
        model_label = "Auto"

    _set(running=True, progress=0, total=0, tagged=0, skipped=0, errors=0,
         message="Querying images…", current_path=None, cancelled=False,
         active_model=model_label)

    # Install scan-log bridge so tagger INFO+ messages appear in the Scan Log UI
    _scan_handler = _ScanLogHandler(logging.INFO)
    _scan_handler.setFormatter(logging.Formatter("%(levelname)s %(message)s"))
    logger.addHandler(_scan_handler)

    try:
        scope_desc = (f"folder={folder_path}" if scope == "folder" and folder_path
                      else f"creator_id={creator_id}" if scope == "creator" and creator_id
                      else "full library")
        logger.info("Starting AI tagging run — scope: %s, model: %s, retag: %s",
                    scope_desc, model_label, retag)

        q = db.query(Image).options(
            selectinload(Image.gallery).selectinload(Gallery.creators)
        )
        if scope == "folder" and folder_path:
            q = q.join(Gallery).filter(Gallery.folder_path.like(f"{folder_path}%"))
        elif scope == "creator" and creator_id:
            from models import gallery_creators
            q = (q.join(Gallery, Image.gallery_id == Gallery.id)
                   .join(gallery_creators, gallery_creators.c.gallery_id == Gallery.id)
                   .filter(gallery_creators.c.creator_id == creator_id))
        if not retag:
            q = q.filter(Image.ai_tagged == False)   # noqa: E712

        images = q.all()
        _set(total=len(images), message=f"Found {len(images)} to tag…")

        if not images:
            _set(message="No untagged images found.", running=False, active_model=None)
            return

        if not wd14_is_ready() and not joytag_is_ready():
            _set(message="No tagger models downloaded. Download WD14 or JoyTag first.",
                 running=False, active_model=None)
            return

        tagged = skipped = errors = 0
        COMMIT_EVERY = 50

        for idx, img in enumerate(images):
            if _is_cancelled():
                _set(message=f"Cancelled — {tagged} tagged, {skipped} skipped, {errors} errors.",
                     active_model=None)
                return

            _set(progress=idx + 1, current_path=img.file_path)

            if not img.file_path or not os.path.exists(img.file_path):
                logger.debug("Skipping missing file: %s", img.file_path)
                skipped += 1
                _set(skipped=skipped)
                continue

            try:
                fn = tag_single_video if img.is_video else tag_single_image
                ok = fn(img, db, threshold, model_override, clear_existing=retag)
                if ok:
                    tagged += 1
                else:
                    # Model ran but nothing above threshold — mark tagged so we skip next run
                    img.ai_tagged = True
                    skipped += 1
            except Exception as e:
                logger.warning("Error tagging %s: %s", img.file_path, e)
                errors += 1

            _set(tagged=tagged, skipped=skipped, errors=errors)

            if (idx + 1) % COMMIT_EVERY == 0:
                db.commit()

        db.commit()
        _set(message=f"Done — {tagged} tagged, {skipped} no-result, {errors} errors.",
             running=False, current_path=None, active_model=None)

    except Exception as e:
        logger.exception("Bulk tagging failed: %s", e)
        try:
            db.rollback()
        except Exception:
            pass
        _set(message=f"Fatal error: {e}", running=False, active_model=None)
    finally:
        _set(running=False)
        logger.removeHandler(_scan_handler)


# ── Model download worker (runs in background thread) ─────────────────────────
def download_models_task(download_wd14_flag: bool, download_joytag_flag: bool):
    _set(running=True, message="Starting model download…", cancelled=False)
    try:
        if download_wd14_flag and not wd14_is_ready():
            download_wd14()
        if download_joytag_flag and not joytag_is_ready():
            download_joytag()
        _reset_singletons()
        _set(message="Download complete.", running=False)
    except Exception as e:
        logger.exception("Model download failed: %s", e)
        _set(message=f"Download error: {e}", running=False)
