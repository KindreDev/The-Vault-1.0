import os
import io
import csv
import threading
import logging
import time
from concurrent.futures import ThreadPoolExecutor
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
    # WD14 selected_tags.csv uses these unprefixed names for category 9.
    "general":             ("safe", "rating"),
    "sensitive":           ("suggestive", "rating"),
    "questionable":        ("suggestive", "rating"),
    "explicit":            ("explicit", "rating"),
    # Keep the older prefixed aliases accepted by imported vocabularies.
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
    "loli":                 ("loli", "subject"),
    "furry":                ("furry", "subject"),
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
    # Explicit exposure. Any of these makes the file explicit, whatever else
    # she is wearing (see EXPLICIT_BODY_TAGS).
    "nipple_slip":          ("nipple slip", "body_part"),
    "areola_slip":          ("areola slip", "body_part"),
    "pussy_peek":           ("pussy peek", "body_part"),
    "spread_pussy":         ("spread pussy", "body_part"),
    "pussy_juice":          ("pussy juice", "body_part"),
    "clitoris":             ("clitoris", "body_part"),
    "pubic_hair":           ("pubic hair", "body_part"),
    "female_pubic_hair":    ("pubic hair", "body_part"),
    "male_pubic_hair":      ("pubic hair", "body_part"),
    "anus":                 ("anus", "body_part"),
    "anus_peek":            ("anus peek", "body_part"),
    "spread_anus":          ("spread anus", "body_part"),
    "erection":             ("erection", "body_part"),
    "testicles":            ("testicles", "body_part"),
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
    "completely_nude":      ("nude", "nudity_level"),
    "topless":              ("topless", "nudity_level"),
    "bottomless":           ("bottomless", "nudity_level"),
    "clothed":              ("clothed", "nudity_level"),
    "fully_clothed":        ("fully clothed", "nudity_level"),
    "partially_clothed":    ("partially clothed", "nudity_level"),
    "see-through":          ("see-through", "nudity_level"),
    "see_through":          ("see-through", "nudity_level"),
    "wet":                  ("wet", "nudity_level"),
    "covered_nipples":      ("covered nipples", "nudity_level"),
    "covering_breasts":     ("covering breasts", "nudity_level"),
    "pasties":              ("pasties", "nudity_level"),
    "nipple_covers":        ("pasties", "nudity_level"),
    "implied_nude":         ("implied nudity", "nudity_level"),
    "implied_nudity":       ("implied nudity", "nudity_level"),
    "censored":             ("censored", "nudity_level"),
    "convenient_censoring": ("convenient censoring", "nudity_level"),
    "strategic_clothing":   ("convenient censoring", "nudity_level"),
    # Clothing
    "shirt":               ("shirt", "clothing"),
    "white_shirt":         ("shirt", "clothing"),
    "collared_shirt":      ("shirt", "clothing"),
    "t-shirt":             ("shirt", "clothing"),
    "tshirt":              ("shirt", "clothing"),
    "polo_shirt":          ("shirt", "clothing"),
    "bikini":               ("bikini", "clothing"),
    "swimsuit":             ("swimsuit", "clothing"),
    "one-piece_swimsuit":   ("one-piece swimsuit", "clothing"),
    "lingerie":             ("lingerie", "clothing"),
    "underwear":            ("underwear", "clothing"),
    "bra":                  ("bra", "clothing"),
    "panties":              ("panties", "clothing"),
    "thong":                ("thong", "clothing"),
    # Clothing pulled aside. Suggestive alone, explicit once something shows.
    "clothing_aside":       ("clothing aside", "clothing"),
    "panties_aside":        ("panties aside", "clothing"),
    "thong_aside":          ("panties aside", "clothing"),
    "swimsuit_aside":       ("swimsuit aside", "clothing"),
    "bikini_aside":         ("swimsuit aside", "clothing"),
    "leotard_aside":        ("leotard aside", "clothing"),
    "skirt_lift":           ("skirt lift", "clothing"),
    "garter_straps":        ("garter straps", "clothing"),
    "garter_belt":          ("garter belt", "clothing"),
    "highleg":              ("highleg", "clothing"),
    "highleg_leotard":      ("highleg leotard", "clothing"),
    "shirt_lift":           ("shirt lift", "clothing"),
    # Skintight / latex. Latex is suggestive on its own (nobody wears a shiny
    # second skin except to show off); skin tight only counts when it's shiny.
    "latex":                ("latex", "clothing"),
    "latex_bodysuit":       ("latex", "clothing"),
    "shiny_clothes":        ("shiny clothes", "clothing"),
    "skin_tight":           ("skin tight", "clothing"),
    "bodysuit":             ("bodysuit", "clothing"),
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
    "all_fours":            ("on all fours", "pose"),   # WD14's real name; on_all_fours never matched
    "arched_back":          ("arched back", "pose"),
    "presenting":           ("presenting", "pose"),
    "top-down_bottom-up":   ("top-down bottom-up", "pose"),
    "jack-o'_challenge":    ("jack-o' pose", "pose"),
    "ass_focus":            ("ass focus", "pose"),
    "breast_focus":         ("breast focus", "pose"),
    "pantyshot":            ("pantyshot", "pose"),
    "upskirt":              ("upskirt", "pose"),
    "downblouse":           ("downblouse", "pose"),
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
    "cum_in_pussy":         ("creampie", "sex_act"),
    "cum_on_breasts":       ("cum on body", "sex_act"),
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
    "object_insertion":     ("object insertion", "sex_act"),
    "vaginal_object_insertion": ("object insertion", "sex_act"),
    "anal_object_insertion": ("object insertion", "sex_act"),
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
    "furry":                ("furry", "subject"),
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

JOYTAG_PERSON_COUNT: dict[str, int] = {
    "solo": 1, "1 person": 1,
    "2 people": 2, "duo": 2,
    "3 people": 3,
    "4 people": 4,
    "5+ people": 5,
    "group": 4, "multiple people": 4,
}

# A person-count guess below this is ignored.
PERSON_COUNT_MIN = 0.20

# WD counts each gender on its own: one girl with two men is "1girl" +
# "2boys", not one person. These groups are added together for the head count;
# a second group only counts when the model is fairly sure of it.
WD14_COUNT_GROUPS: dict[str, dict[str, int]] = {
    "girls": {"1girl": 1, "2girls": 2, "3girls": 3, "4girls": 4, "5girls": 5, "6+girls": 6, "multiple_girls": 3},
    "boys": {"1boy": 1, "2boys": 2, "3boys": 3, "4boys": 4, "5boys": 5, "6+boys": 6, "multiple_boys": 3},
    "others": {"1other": 1, "2others": 2, "multiple_others": 3},
}
WD14_COUNT_TAGS = {raw: (group, n) for group, tags in WD14_COUNT_GROUPS.items() for raw, n in tags.items()}
PERSON_GROUP_MIN = 0.35
# Head count tags. Exactly one is stored per file.
PEOPLE_TAGS = ("solo", "duo", "group")


def people_tag(count: int) -> str:
    return "solo" if count <= 1 else "duo" if count == 2 else "group"


def _sum_head_count(best_count: dict[str, tuple[int, float]]) -> tuple[Optional[int], float]:
    """Add up the gender groups: the likeliest group always counts, the
    others only when fairly sure. Returns (count, confidence of the weakest
    group used)."""
    if not best_count:
        return None, 0.0
    ranked = sorted(best_count.values(), key=lambda item: item[1], reverse=True)
    used = [ranked[0]] + [item for item in ranked[1:] if item[1] >= PERSON_GROUP_MIN]
    return sum(n for n, _ in used), min(conf for _, conf in used)

# Creator types → tagger model routing
JOYTAG_CREATOR_TYPES = {"cosplayer", "ethot", "actress", "custom"}
WD14_CREATOR_TYPES   = {"artist", "character"}

# Built-in per-tag threshold overrides — these tags use a lower confidence bar
# than the global threshold. User-configured TagVocabEntry overrides take
# precedence over these defaults.
# Keys are the NORMALISED tag names (as they appear in WD14_TAG_MAP values /
# after the raw→normalised mapping step).
TAG_THRESHOLD_OVERRIDES: dict[str, float] = {
    "underboob": 0.05,
    "sideboob":  0.05,
    "backboob":  0.05,
    "cleavage":  0.15,
    # Camera angle, focus and cut are a blind spot on real photos.
    "from behind": 0.15,
    "ass focus": 0.10,
    "highleg": 0.30,
    "highleg leotard": 0.30,
}

# Color tags need a higher default floor because the models often emit several
# plausible colors at once (especially with warm lighting and colored
# backgrounds). A collab can legitimately contain more than one color, so the
# post-processing pass uses the detected person count instead of forcing one
# winner for the entire file.
COLOR_TAG_MIN_CONFIDENCE = 0.70
COLOR_MAX_SUBJECTS = 5
HAIR_COLOR_TAGS = frozenset({
    "blonde hair", "black hair", "brown hair", "red hair", "white hair",
    "silver hair", "pink hair", "blue hair", "green hair", "purple hair",
    "orange hair", "multicolor hair",
})
EYE_COLOR_TAGS = frozenset({
    "blue eyes", "green eyes", "brown eyes", "red eyes", "purple eyes",
    "yellow eyes", "pink eyes", "aqua eyes", "orange eyes",
})
COLOR_TAGS = HAIR_COLOR_TAGS | EYE_COLOR_TAGS


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
    "status":         "idle",
    "paused":         False,
    "job_id":         None,
    "eta_seconds":    None,
    "items_per_second": None,
}
_control = "run"  # run | pause | cancel

def get_tagger_state() -> dict:
    with _lock:
        return dict(_state)

def _set(**kwargs):
    with _lock:
        _state.update(kwargs)

def cancel_tagger():
    global _control
    with _lock:
        _control = "cancel"
        _state["cancelled"] = True

def pause_tagger():
    global _control
    with _lock:
        _control = "pause"
        _state["message"] = "Pausing after the current batch…"

def _is_cancelled() -> bool:
    with _lock:
        return _state["cancelled"]

def _control_action() -> str:
    with _lock:
        return _control


def restore_interrupted_jobs():
    """Turn process-interrupted jobs into safe resumable checkpoints."""
    from database import SessionLocal
    from models import AITagJob
    db = SessionLocal()
    try:
        interrupted = db.query(AITagJob).filter(AITagJob.status.in_(["running", "queued"])).all()
        for job in interrupted:
            job.status = "paused"
            job.message = "Paused after The Vault restarted — ready to resume."
        if interrupted:
            db.commit()
        job = (db.query(AITagJob).filter(AITagJob.status == "paused")
               .order_by(AITagJob.updated_at.desc(), AITagJob.id.desc()).first())
        if job:
            _set(running=False, status="paused", paused=True, cancelled=False,
                 job_id=job.id, progress=job.progress, total=job.total,
                 tagged=job.tagged, skipped=job.skipped, errors=job.errors,
                 message=job.message, current_path=None, active_model=None)
    finally:
        db.close()


# ── Model paths ───────────────────────────────────────────────────────────────
def _models_dir() -> str:
    from database import DATA_DIR
    d = os.path.join(DATA_DIR, "models")
    os.makedirs(d, exist_ok=True)
    return d


# Every local model the tagger can use. "tagger" models write tags on their
# own and one is picked per file; "detector" models are optional extras that
# run alongside the tagger and add their findings to the same file.
TAGGER_MODELS: dict[str, dict] = {
    "wd14": {
        "label": "WD14 SwinV2", "kind": "tagger", "model_name": "wd14-swinv2-v3",
        "desc": "Anime, art and characters. Fast.", "approx_mb": 446,
        "repo": "SmilingWolf/wd-swinv2-tagger-v3", "folder": "wd14",
        "files": ("model.onnx", "selected_tags.csv"),
    },
    "wd14-eva02": {
        "label": "WD EVA02 Large", "kind": "tagger", "model_name": "wd14-eva02-v3",
        "desc": "Same tags as WD14, more accurate. About 3× the GPU work.", "approx_mb": 1260,
        "repo": "SmilingWolf/wd-eva02-large-tagger-v3", "folder": "wd14-eva02",
        "files": ("model.onnx", "selected_tags.csv"),
    },
    "joytag": {
        "label": "JoyTag", "kind": "tagger", "model_name": "joytag",
        "desc": "Cosplay and real photos.", "approx_mb": 349,
        "repo": "fancyfeast/joytag", "folder": "joytag",
        "files": ("model.onnx", "top_tags.txt"),
    },
    "nudenet": {
        "label": "NudeNet", "kind": "detector", "model_name": "nudenet-640m",
        "desc": "Finds exposed body parts in real photos. Sharpens explicit ratings.",
        "approx_mb": 100, "folder": "nudenet", "files": ("640m.onnx",),
        # GitHub's API asset URL works without a login (the plain release
        # link now redirects to sign-in); the checksum pins the v3.4 file.
        "url": "https://api.github.com/repos/notAI-tech/NudeNet/releases/assets/176832019",
        "sha256": "04fe3d77980780c1f8297dc6d7f942fd5b3abe6942a188f742a85241e4f634eb",
    },
}
TAGGER_MODELS["vibe"] = {
    "label": "Spice vibe check", "kind": "detector", "model_name": "spice-vibe-siglip2",
    "desc": "Moves real photos that are sexy but fully covered from Safe to Suggestive.",
    "approx_mb": 343, "folder": "vibe", "files": ("model.onnx", "labels.json"),
    # ONNX export of prithivMLmods/siglip2-x256-explicit-content (Apache-2.0,
    # PyTorch only upstream), published by the Vault's author. Checksum pins it.
    "urls": {
        "model.onnx": ("https://huggingface.co/kindredsp/siglip2-explicit-content-onnx/resolve/main/model.onnx",
                       "aa2cb667ddefd74888efe410170d22a27fdfdc2d45dcb4ab65469ebc4f7d931f"),
        "labels.json": ("https://huggingface.co/kindredsp/siglip2-explicit-content-onnx/resolve/main/labels.json", None),
    },
}
TAGGER_KEYS = tuple(k for k, m in TAGGER_MODELS.items() if m["kind"] == "tagger")
DETECTOR_KEYS = tuple(k for k, m in TAGGER_MODELS.items() if m["kind"] == "detector")


def model_dir(key: str) -> str:
    d = os.path.join(_models_dir(), TAGGER_MODELS[key]["folder"])
    os.makedirs(d, exist_ok=True)
    return d

def model_is_ready(key: str) -> bool:
    d = model_dir(key)
    return all(os.path.exists(os.path.join(d, f)) for f in TAGGER_MODELS[key]["files"])

def any_tagger_ready() -> bool:
    return any(model_is_ready(k) for k in TAGGER_KEYS)

def _wd14_dir() -> str:
    return model_dir("wd14")

def _joytag_dir() -> str:
    return model_dir("joytag")

def wd14_is_ready() -> bool:
    return model_is_ready("wd14")

def joytag_is_ready() -> bool:
    return model_is_ready("joytag")

def _dir_size_mb(path: str) -> Optional[float]:
    total = 0
    for root, _, files in os.walk(path):
        for f in files:
            try:
                total += os.path.getsize(os.path.join(root, f))
            except OSError:
                pass
    return round(total / 1_048_576, 1) if total else None

def model_statuses() -> list[dict]:
    out = []
    for key, meta in TAGGER_MODELS.items():
        ready = model_is_ready(key)
        out.append({
            "key": key, "label": meta["label"], "kind": meta["kind"], "desc": meta["desc"],
            "approx_mb": meta["approx_mb"], "ready": ready,
            "size_mb": _dir_size_mb(model_dir(key)) if ready else None,
            "downloadable": any(k in meta for k in ("url", "urls", "repo")),
        })
    return out


# ── Model download ────────────────────────────────────────────────────────────
def _download_url(url: str, dest: str, sha256: Optional[str] = None):
    """Stream a file to dest via a .part file, so a broken or tampered
    download never looks like a finished model."""
    import hashlib
    import urllib.request
    part = dest + ".part"
    digest = hashlib.sha256()
    request = urllib.request.Request(url, headers={"Accept": "application/octet-stream",
                                                   "User-Agent": "TheVault"})
    with urllib.request.urlopen(request, timeout=60) as resp, open(part, "wb") as out:
        total = int(resp.headers.get("Content-Length") or 0)
        done = 0
        while True:
            block = resp.read(1 << 20)
            if not block:
                break
            out.write(block)
            digest.update(block)
            done += len(block)
            if total:
                _set(message=f"Downloading… {done * 100 // total}%")
    if sha256 and digest.hexdigest() != sha256:
        os.remove(part)
        raise RuntimeError("Downloaded model failed its checksum; nothing was installed.")
    os.replace(part, dest)

def download_model(key: str):
    meta = TAGGER_MODELS[key]
    if not any(k in meta for k in ("url", "urls", "repo")):
        raise RuntimeError(f"{meta['label']} can't be downloaded; it is installed by hand.")
    d = model_dir(key)
    _set(message=f"Downloading {meta['label']} (~{meta['approx_mb']} MB)…")
    if "urls" in meta:
        for name, (url, sha256) in meta["urls"].items():
            _download_url(url, os.path.join(d, name), sha256)
    elif "url" in meta:
        _download_url(meta["url"], os.path.join(d, meta["files"][0]), meta.get("sha256"))
    else:
        from huggingface_hub import hf_hub_download
        for name in meta["files"]:
            hf_hub_download(meta["repo"], name, local_dir=d)
    _set(message=f"{meta['label']} download complete.")

def download_wd14():
    download_model("wd14")

def download_joytag():
    download_model("joytag")


# ── Tag vocabulary allowlist (DB-backed, user-editable) ────────────────────────
# WD14_TAG_MAP / JOYTAG_TAG_MAP above remain the source of *defaults* for seeding
# and "reset to defaults" — at tag time, the allowlist is read from TagVocabEntry
# via the in-memory cache below, not from these dicts directly.

_tag_vocab_cache: dict[str, dict[str, tuple[str, str]]] = {}
_tag_threshold_cache: dict[str, dict[str, Optional[float]]] = {}
_tag_vocab_lock = threading.Lock()

def invalidate_tag_vocab_cache(model: Optional[str] = None):
    """Call after any TagVocabEntry mutation so the next tag() call reloads it."""
    global _tag_vocab_cache
    with _tag_vocab_lock:
        if model is None:
            _tag_vocab_cache = {}
            _tag_threshold_cache.clear()
        else:
            _tag_vocab_cache.pop(model, None)
            _tag_threshold_cache.pop(model, None)

def _get_tag_vocab(model: str) -> dict[str, tuple[str, str]]:
    """Lazily-loaded, cached {raw_tag: (normalized_name, category)} for enabled
    entries of the given model. Mirrors the _get_wd14/_get_joytag lazy-singleton
    pattern so the hot per-image tagging loop never hits the DB directly."""
    with _tag_vocab_lock:
        cached = _tag_vocab_cache.get(model)
    if cached is not None:
        return cached

    from database import SessionLocal
    from models import TagVocabEntry
    db = SessionLocal()
    try:
        rows = (
            db.query(TagVocabEntry.raw_tag, TagVocabEntry.normalized_name, TagVocabEntry.category)
              .filter(TagVocabEntry.model == model, TagVocabEntry.enabled == True)  # noqa: E712
              .all()
        )
    finally:
        db.close()

    mapping = {raw: (norm, cat) for raw, norm, cat in rows}
    with _tag_vocab_lock:
        _tag_vocab_cache[model] = mapping
    return mapping


def _get_tag_thresholds(model: str) -> dict[str, Optional[float]]:
    """Return enabled raw-tag confidence overrides for a model.

    The value is nullable on purpose: a row with NULL is the explicit UI state
    meaning "use the global threshold". Keeping this separate from the
    existing two-item vocabulary map avoids changing callers that only need
    name/category resolution.
    """
    with _tag_vocab_lock:
        cached = _tag_threshold_cache.get(model)
    if cached is not None:
        return cached

    from database import SessionLocal
    from models import TagVocabEntry
    db = SessionLocal()
    try:
        rows = (
            db.query(TagVocabEntry.raw_tag, TagVocabEntry.confidence_threshold)
              .filter(TagVocabEntry.model == model, TagVocabEntry.enabled == True)  # noqa: E712
              .all()
        )
    finally:
        db.close()

    thresholds = {raw: value for raw, value in rows}
    with _tag_vocab_lock:
        _tag_threshold_cache[model] = thresholds
    return thresholds


def _effective_tag_threshold(normalized_name: Optional[str], global_threshold: float,
                             tag_override: Optional[float] = None) -> float:
    """Resolve one tag threshold, with explicit UI overrides winning."""
    if tag_override is not None:
        return float(tag_override)
    effective = TAG_THRESHOLD_OVERRIDES.get(normalized_name, global_threshold) if normalized_name else global_threshold
    if normalized_name in COLOR_TAGS:
        effective = max(effective, COLOR_TAG_MIN_CONFIDENCE)
    return effective

def seed_tag_vocab(db, model: str):
    """One-time (idempotent) seed of the full raw model vocabulary into
    TagVocabEntry. Tags already present in WD14_TAG_MAP/JOYTAG_TAG_MAP are
    pre-enabled — this is what keeps existing installs' tagging behavior
    unchanged after upgrading to this feature. No-ops if already seeded for
    this model, or if the model's raw vocab file isn't on disk yet."""
    from models import TagVocabEntry

    already_seeded = db.query(TagVocabEntry).filter(TagVocabEntry.model == model).first()
    if already_seeded is not None:
        changed = backfill_builtin_tag_vocab(db, model)
        if changed:
            invalidate_tag_vocab_cache(model)
        return

    if model == "wd14":
        if not wd14_is_ready():
            return
        tag_csv = os.path.join(_wd14_dir(), "selected_tags.csv")
        raw_tags: list[str] = []
        with open(tag_csv, newline="", encoding="utf-8") as f:
            for row in csv.DictReader(f):
                raw_tags.append(row["name"])
    elif model == "joytag":
        if not joytag_is_ready():
            return
        tag_file = os.path.join(_joytag_dir(), "top_tags.txt")
        with open(tag_file, encoding="utf-8") as f:
            raw_tags = [line.strip() for line in f if line.strip()]
    else:
        return

    seen: set[str] = set()
    entries: list["TagVocabEntry"] = []
    for raw in raw_tags:
        if model == "wd14":
            # Matches WD14Tagger.tag()'s raw_lower lookup key exactly.
            raw_key = raw.lower()
            mapped = WD14_TAG_MAP.get(raw_key)
        else:
            # top_tags.txt ships danbooru underscore format; JOYTAG_TAG_MAP keys
            # are natural-English (spaces), with a cross-fallback to WD14_TAG_MAP's
            # underscore keys — mirrors JoyTagTagger.tag()'s raw_lower/raw_under
            # dual lookup exactly, so seeding preserves current behavior 1:1.
            raw_key = raw.lower().replace("_", " ")
            mapped = JOYTAG_TAG_MAP.get(raw_key) or WD14_TAG_MAP.get(raw.lower())

        if raw_key in seen:
            continue
        seen.add(raw_key)

        if mapped:
            norm_name, category = mapped
            enabled, is_default = True, True
        else:
            norm_name, category = raw_key, "general"
            enabled, is_default = False, False
        entries.append(TagVocabEntry(
            model=model, raw_tag=raw_key, normalized_name=norm_name,
            category=category, enabled=enabled, is_builtin_default=is_default,
        ))

    db.bulk_save_objects(entries)
    db.commit()
    invalidate_tag_vocab_cache(model)
    logger.info("Seeded %d tag_vocab_entries for model=%s (%d enabled by default)",
                len(entries), model, sum(1 for e in entries if e.enabled))


def backfill_builtin_tag_vocab(db, model: str) -> int:
    """Enable newly recognized built-in rows on existing installations.

    Older seeds stored unmapped model tags as disabled ``raw/general`` rows.
    Only those untouched rows are upgraded.  Rows whose normalized name or
    category was edited are treated as user vocabulary and are never changed.
    """
    from models import TagVocabEntry

    tag_map = WD14_TAG_MAP if model == "wd14" else JOYTAG_TAG_MAP if model == "joytag" else {}
    changed = 0
    rows = db.query(TagVocabEntry).filter(TagVocabEntry.model == model).all()
    for entry in rows:
        mapped = tag_map.get((entry.raw_tag or "").lower())
        if not mapped or entry.is_builtin_default:
            continue
        if entry.normalized_name != entry.raw_tag or entry.category != "general":
            continue
        entry.normalized_name, entry.category = mapped
        entry.enabled = True
        entry.is_builtin_default = True
        changed += 1
    if changed:
        db.commit()
        logger.info("Backfilled %d newly recognized built-in tag vocab entries for model=%s", changed, model)
    return changed


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
AI_BATCH_SIZE = 8
PREPROCESS_WORKERS = 4
VIDEO_WORKERS = 2
_preprocess_pool = ThreadPoolExecutor(max_workers=PREPROCESS_WORKERS, thread_name_prefix="vault-tag-decode")
_video_pool = ThreadPoolExecutor(max_workers=VIDEO_WORKERS, thread_name_prefix="vault-tag-video")
# One file read at a time. A spinning drive reads files back to back far
# faster than when several threads make its head jump between them; the
# decoding itself still runs in parallel once the bytes are in memory.
_disk_lock = threading.Lock()


def _flatten_rgb(img: PILImage.Image) -> PILImage.Image:
    """RGB copy of any image, with transparency composited on white."""
    if img.mode in ("RGBA", "LA", "P"):
        canvas = PILImage.new("RGBA", img.size, (255, 255, 255, 255))
        canvas.alpha_composite(img.convert("RGBA"))
        return canvas.convert("RGB")
    return img.convert("RGB")


def _load_for_tagging(image_path: str, max_side: int = TARGET_SIZE,
                      lock_disk: bool = True) -> Optional[PILImage.Image]:
    """Read and decode one file, shrunk so its longest side is max_side.

    Shrinking before any padding keeps huge PNGs cheap (padding a 4000px
    image first costs more than decoding it). JPEG draft mode goes further and
    downsamples inside the decoder. Always the original file, never the
    Vault's small thumbnail.
    """
    try:
        if lock_disk:
            with _disk_lock:
                with open(image_path, "rb") as f:
                    data = f.read()
        else:
            with open(image_path, "rb") as f:
                data = f.read()
        with PILImage.open(io.BytesIO(data)) as img:
            if (img.format or "").upper() in {"JPEG", "MPO"}:
                img.draft("RGB", (max_side, max_side))
            out = _flatten_rgb(img)
        out.thumbnail((max_side, max_side), PILImage.BICUBIC, reducing_gap=2.0)
        return out
    except Exception as exc:
        logger.debug("AI preprocess failed for %s: %s", image_path, exc)
        return None


def _to_rgb_square(img: PILImage.Image) -> PILImage.Image:
    """White-padded RGB TARGET_SIZE square, the input every tagger expects."""
    img = _flatten_rgb(img)
    w, h = img.size
    max_side = max(w, h)
    padded = PILImage.new("RGB", (max_side, max_side), (255, 255, 255))
    padded.paste(img, ((max_side - w) // 2, (max_side - h) // 2))
    if max_side == TARGET_SIZE:
        return padded
    return padded.resize((TARGET_SIZE, TARGET_SIZE), PILImage.BICUBIC)

def _preprocess_wd14(img: PILImage.Image) -> np.ndarray:
    """WD v3 (SwinV2 / EVA02): BGR, 0-255 float32, NHWC.

    SmilingWolf's reference code flips PIL's RGB to BGR. Feeding RGB swaps red
    and blue, which visibly hurt hair/eye colour and clothing colour tags.
    """
    img = _to_rgb_square(img)
    arr = np.asarray(img, dtype=np.float32)[:, :, ::-1]   # RGB → BGR
    return np.ascontiguousarray(arr)[np.newaxis, :]        # (1, 448, 448, 3)

def _preprocess_joytag(img: PILImage.Image) -> np.ndarray:
    """JoyTag: RGB, ImageNet-normalised, NCHW."""
    img = _to_rgb_square(img)
    arr = np.asarray(img, dtype=np.float32) / 255.0
    mean = np.array([0.485, 0.456, 0.406], dtype=np.float32)
    std  = np.array([0.229, 0.224, 0.225], dtype=np.float32)
    arr  = (arr - mean) / std
    arr  = arr.transpose(2, 0, 1)              # HWC → CHW
    return arr[np.newaxis, :]                  # (1, 3, 448, 448)


def _preprocess_path(image_path: str, preprocess_fn) -> Optional[np.ndarray]:
    img = _load_for_tagging(image_path)
    return None if img is None else preprocess_fn(img)


class _OnnxTagger:
    """Shared batching for the multi-label taggers. Subclasses set
    MODEL_NAME, _preprocess and _parse_probs."""

    def preprocess(self, img: PILImage.Image) -> np.ndarray:
        return self._preprocess(img)

    def infer(self, arrays: list[np.ndarray], threshold: float):
        """Run already-preprocessed images; returns one answer per array."""
        if not arrays:
            return []
        probs_batch = self._session.run(
            [self._output_name], {self._input_name: np.concatenate(arrays, axis=0)}
        )[0]
        return [self._parse_probs(probs, threshold) for probs in probs_batch]

    def tag_batch(self, image_paths: list[str], threshold: float):
        decoded = list(_preprocess_pool.map(
            lambda path: _preprocess_path(path, self._preprocess), image_paths
        ))
        valid = [(idx, arr) for idx, arr in enumerate(decoded) if arr is not None]
        answers = [([], None) for _ in image_paths]
        for (idx, _), answer in zip(valid, self.infer([arr for _, arr in valid], threshold)):
            answers[idx] = answer
        return answers

    def tag(self, image_path: str, threshold: float) -> tuple[list[tuple[str, str, float]], Optional[int]]:
        """Returns list of (normalized_name, category, confidence) and person_count."""
        return self.tag_batch([image_path], threshold)[0]


# ── WD14 runner ───────────────────────────────────────────────────────────────
class WD14Tagger(_OnnxTagger):
    """WD v3 tagger. SwinV2 and EVA02 share one tag CSV, so both read the
    "wd14" vocabulary and threshold rows."""
    _preprocess = staticmethod(_preprocess_wd14)

    def __init__(self, key: str = "wd14"):
        self.MODEL_NAME = TAGGER_MODELS[key]["model_name"]
        d = model_dir(key)
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

    def _parse_probs(self, probs, threshold: float) -> tuple[list[tuple[str, str, float]], Optional[int]]:
        vocab = _get_tag_vocab("wd14")   # user-editable allowlist, DB-backed & cached
        thresholds = _get_tag_thresholds("wd14")
        results: list[tuple[str, str, float]] = []
        # Most likely count per gender group: {group: (count, conf)}.
        best_count: dict[str, tuple[int, float]] = {}

        for i, (raw_name, wd14_cat) in enumerate(self._tags):
            conf = float(probs[i])
            raw_lower = raw_name.lower()

            # Per-tag threshold overrides (e.g. underboob, sideboob score lower on
            # real-photo / 3D content but are still meaningful at reduced confidence).
            mapped_norm = vocab.get(raw_lower, (None,))[0]
            effective_threshold = _effective_tag_threshold(mapped_norm, threshold, thresholds.get(raw_lower))

            # Head count is read before the confidence filter (it guides the
            # colour and photo rules even below the tag threshold). Each gender
            # keeps its most likely count, not the largest one listed: taking
            # the largest gave every file "6+ people" off near-zero guesses.
            if raw_lower in WD14_COUNT_TAGS:
                group, n = WD14_COUNT_TAGS[raw_lower]
                if conf >= PERSON_COUNT_MIN and conf > best_count.get(group, (0, 0.0))[1]:
                    best_count[group] = (n, conf)
                continue   # the one head-count tag is added after the loop
            if mapped_norm in PEOPLE_TAGS:
                continue   # "solo" etc. as raw tags: the gender counts decide

            # The model's own rating scores are kept raw (general / sensitive /
            # questionable / explicit) for _apply_rating_heuristic, which
            # replaces them with one derived rating before anything is stored.
            if wd14_cat == 9:
                results.append((MODEL_RATING_PREFIX + raw_lower.removeprefix("rating:"), "rating", conf))
                continue
            if conf < effective_threshold:
                continue

            if raw_lower in WD14_SKIP_TAGS:
                continue   # noise / meta tag — never pass through
            elif raw_lower in vocab:
                norm_name, norm_cat = vocab[raw_lower]
                results.append((norm_name, norm_cat, conf))
            # Anything not enabled in the allowlist is dropped, character names
            # included: WD guesses characters from colours and hairstyles, which
            # on real cosplay photos was wrong almost every time (22k files
            # tagged Widowmaker). Characters come from the Vault's own
            # Character records instead.

        person_count, count_conf = _sum_head_count(best_count)
        if person_count:
            name = people_tag(person_count)
            if count_conf >= _effective_tag_threshold(name, threshold, None):
                results.append((name, "subject", count_conf))
        return results, person_count


# ── JoyTag runner ─────────────────────────────────────────────────────────────
class JoyTagTagger(_OnnxTagger):
    MODEL_NAME = "joytag"
    _preprocess = staticmethod(_preprocess_joytag)

    def __init__(self):
        d = _joytag_dir()
        self._session     = _make_session(os.path.join(d, "model.onnx"))
        self._input_name  = self._session.get_inputs()[0].name
        self._output_name = self._session.get_outputs()[0].name

        tag_file = os.path.join(d, "top_tags.txt")
        with open(tag_file, encoding="utf-8") as f:
            self._tags: list[str] = [line.strip() for line in f if line.strip()]

    def _parse_probs(self, probs, threshold: float) -> tuple[list[tuple[str, str, float]], Optional[int]]:
        jt_vocab = _get_tag_vocab("joytag")   # keyed by space form, matches raw_lower below
        wd_vocab = _get_tag_vocab("wd14")     # keyed by underscore form, matches raw_under below
        jt_thresholds = _get_tag_thresholds("joytag")
        wd_thresholds = _get_tag_thresholds("wd14")
        results: list[tuple[str, str, float]] = []
        person_count: Optional[int] = None
        pc_conf = 0.0

        for i, raw_name in enumerate(self._tags):
            if i >= len(probs):
                break
            conf = float(probs[i])

            # Resolve normalised name early so we can apply per-tag overrides.
            raw_lower_pre = raw_name.lower().replace("_", " ")
            raw_under_pre = raw_name.lower()
            _jt_norm  = jt_vocab.get(raw_lower_pre, (None,))[0]
            _wd_norm  = wd_vocab.get(raw_under_pre, (None,))[0] if _jt_norm is None else None
            _norm_key = _jt_norm or _wd_norm
            raw_override = jt_thresholds.get(raw_lower_pre) if _jt_norm is not None else wd_thresholds.get(raw_under_pre)
            effective_threshold = _effective_tag_threshold(_norm_key, threshold, raw_override)

            # As with WD14: the most likely person count, read before the
            # confidence filter.
            pc_key = raw_lower_pre if raw_lower_pre in JOYTAG_PERSON_COUNT else raw_under_pre
            if pc_key in JOYTAG_PERSON_COUNT and conf >= PERSON_COUNT_MIN and conf > pc_conf:
                person_count, pc_conf = JOYTAG_PERSON_COUNT[pc_key], conf

            if conf < effective_threshold:
                continue

            # fancyfeast/joytag top_tags.txt uses danbooru underscore format.
            # Normalise to spaces so our maps (built with spaces) match correctly.
            raw_lower  = raw_name.lower().replace("_", " ")
            raw_under  = raw_name.lower()   # original underscore form for WD14 fallback

            if raw_lower in WD14_SKIP_TAGS or raw_under in WD14_SKIP_TAGS:
                continue   # skip noise tags shared with WD14

            if raw_lower in jt_vocab:
                # JoyTag-specific entry (natural-English key)
                norm_name, norm_cat = jt_vocab[raw_lower]
                results.append((norm_name, norm_cat, conf))
            elif raw_under in wd_vocab:
                # Overlapping danbooru tag — use WD14 normalisation
                norm_name, norm_cat = wd_vocab[raw_under]
                results.append((norm_name, norm_cat, conf))
            # Anything still unmapped/disabled is dropped — no raw general passthrough

        return results, person_count


# ── Lazy-loaded singletons ────────────────────────────────────────────────────
_taggers: dict[str, object] = {}
_taggers_lock = threading.Lock()

def _get_tagger(key: str):
    """Loaded tagger for a TAGGER_MODELS key, or None if it isn't downloaded."""
    with _taggers_lock:
        tagger = _taggers.get(key)
        if tagger is None and model_is_ready(key):
            tagger = JoyTagTagger() if key == "joytag" else WD14Tagger(key)
            _taggers[key] = tagger
        return tagger

def _get_wd14() -> Optional["WD14Tagger"]:
    return _get_tagger("wd14")

def _get_joytag() -> Optional["JoyTagTagger"]:
    return _get_tagger("joytag")

def _get_nudenet():
    from services import nudenet
    return nudenet.get_detector(model_dir("nudenet")) if model_is_ready("nudenet") else None

def _get_vibe():
    from services import vibe
    return vibe.get_classifier(model_dir("vibe")) if model_is_ready("vibe") else None

def _get_detectors(extra_models: Optional[str]) -> list:
    """Loaded detector add-ons a job asked for (comma list of keys)."""
    wanted = [k for k in (extra_models or "").split(",") if k in DETECTOR_KEYS]
    loaders = {"nudenet": _get_nudenet, "vibe": _get_vibe}
    return [d for d in (loaders[k]() for k in wanted) if d is not None]

def _reset_singletons():
    """Call after downloading models so they're reloaded on next use."""
    from services import nudenet, vibe
    with _taggers_lock:
        _taggers.clear()
    nudenet.reset()
    vibe.reset()


# ── DB helpers ────────────────────────────────────────────────────────────────
def _get_or_create_tag(db, name: str, category: str, cache: Optional[dict] = None) -> "Tag":
    from models import Tag, TagSource
    if cache is not None and name in cache:
        return cache[name]
    tag = db.query(Tag).filter(Tag.name == name).first()
    if not tag:
        tag = Tag(name=name, category=category, source=TagSource.ai)
        db.add(tag)
        db.flush()
    if cache is not None:
        cache[name] = tag
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
    if model_override == "wd14-eva02":
        return _get_tagger("wd14-eva02") or _get_wd14()
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
    no_win = 0x00000008 if sys.platform == "win32" else 0  # DETACHED_PROCESS — no conhost.exe
    try:
        r = subprocess.run(
            [exe, "-v", "error", "-show_entries", "format=duration",
             "-of", "default=noprint_wrappers=1:nokey=1", video_path],
            stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=15, creationflags=no_win,
        )
        return float(r.stdout.strip())
    except Exception:
        return None


def _extract_video_frames(video_path: str, count: int = VIDEO_FRAME_COUNT,
                          duration: Optional[float] = None) -> tuple[list[str], str]:
    """Extract `count` evenly-spaced frames from a video to temp PNG files.
    Returns (frame_paths, tmpdir). Caller must shutil.rmtree(tmpdir).

    Pass the duration the scanner already stored to skip an ffprobe launch.
    Frames are the nearest keyframes: decoding only keyframes is several
    times cheaper than decoding up to the exact timestamp, and a frame a
    second or two off makes no difference to the tags."""
    import subprocess, sys, tempfile
    ffmpeg = _get_ffmpeg_exe()
    no_win = 0x00000008 if sys.platform == "win32" else 0  # DETACHED_PROCESS — no conhost.exe
    tmpdir = tempfile.mkdtemp(prefix="vault_vtag_")
    frames: list[str] = []

    if not duration or duration <= 0:
        duration = _video_duration(video_path)
    if duration and duration > 0:
        timestamps = [duration * (i + 1) / (count + 1) for i in range(count)]
    else:
        # Fixed fallback offsets — degrade gracefully for very short clips
        timestamps = [5.0, 15.0, 30.0, 90.0][:count]

    # One FFmpeg process with independently seeked inputs avoids four process
    # launches while retaining fast keyframe seeks for long videos.
    outputs = [os.path.join(tmpdir, f"frame_{i:02d}.png") for i in range(len(timestamps))]
    try:
        cmd = [ffmpeg, "-y"]
        for timestamp in timestamps:
            cmd += ["-skip_frame", "nokey", "-noaccurate_seek", "-ss", f"{timestamp:.2f}", "-i", video_path]
        filters = ";".join(
            f"[{i}:v]scale=448:448:force_original_aspect_ratio=decrease[v{i}]"
            for i in range(len(timestamps))
        )
        cmd += ["-filter_complex", filters]
        for i, out in enumerate(outputs):
            cmd += ["-map", f"[v{i}]", "-frames:v", "1", "-compression_level", "1", out]
        r = subprocess.run(
            cmd, stdin=subprocess.DEVNULL, capture_output=True,
            timeout=60, creationflags=no_win,
        )
        if r.returncode == 0:
            frames = [out for out in outputs if os.path.exists(out)]
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
                stdin=subprocess.DEVNULL, capture_output=True, timeout=30, creationflags=no_win,
            )
            if r.returncode == 0 and os.path.exists(out0):
                frames.append(out0)
        except Exception:
            pass

    return frames, tmpdir


def _load_video_frames(video_path: str, duration: Optional[float] = None,
                       max_side: int = TARGET_SIZE) -> list[PILImage.Image]:
    """Sampled frames of a video as decoded images (temp files cleaned up)."""
    import shutil
    frames, tmpdir = _extract_video_frames(video_path, duration=duration)
    try:
        # Frames sit on the system temp drive, not the library drive.
        loaded = [_load_for_tagging(f, max_side, lock_disk=False) for f in frames]
        return [img for img in loaded if img is not None]
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)


def _apply_color_heuristic(best: dict[str, tuple[str, float]],
                           person_count: Optional[int] = None) -> dict[str, tuple[str, float]]:
    """Keep strong colors per visible subject, while supporting collabs.

    WD14/JoyTag scores are independent sigmoid predictions, not a single
    color choice. For a solo image we retain only the strongest color in each
    family, which prevents warm lighting from creating contradictory labels.
    When the model identifies multiple people, we retain up to one strong
    candidate per detected subject so two different hair/eye colors in a
    collab survive normalization.
    """
    try:
        subject_limit = max(1, min(int(person_count or 1), COLOR_MAX_SUBJECTS))
    except (TypeError, ValueError):
        subject_limit = 1
    for family in (HAIR_COLOR_TAGS, EYE_COLOR_TAGS):
        candidates = [(name, value) for name, value in best.items() if name in family]
        if len(candidates) <= subject_limit:
            continue
        keep = {
            name for name, (_, confidence) in sorted(
                candidates, key=lambda item: item[1][1], reverse=True
            )[:subject_limit]
            if confidence >= COLOR_TAG_MIN_CONFIDENCE
        }
        for name, _ in candidates:
            if name not in keep:
                best.pop(name, None)
    return best


# Ratings, lowest to highest. One per file, derived from its tags.
#   safe        nothing is played up (a sexy costume is fine if the photo is about the costume)
#   suggestive  built to be sexy, everything covered: outfit, pose or focus
#   explicit    nipples / pussy / anus / penis visible
#   hardcore    a sex act
RATING_TAGS = ("safe", "suggestive", "explicit", "hardcore")
# The tagger's raw rating scores travel under this prefix until the rating
# heuristic consumes them. They are never stored as tags.
MODEL_RATING_PREFIX = "_model_rating:"

# Exposed parts that make a file explicit on their own, no matter what
# clothing tags also fired (a bikini with the thong pulled aside and her pussy
# showing is explicit). Normalised names.
EXPLICIT_BODY_TAGS = frozenset({
    "nipples", "nipple slip", "areola slip",
    "pussy", "vagina", "pussy peek", "spread pussy", "pussy juice", "clitoris", "pubic hair",
    "anus", "anus peek", "spread anus",
    "penis", "erection", "testicles",
})
# sex_act / position tags are hardcore (partner acts always, solo acts below
# only with exposure), except these, which can appear in a
# clothed photo (a toy on the bed, an ahegao face) and only count as suggestive.
SUGGESTIVE_SEX_ACTS = frozenset({
    "sex toy", "vibrator", "dildo", "strap-on", "condom", "ahegao", "orgasm", "object insertion",
})
# Solo acts are hardcore only when something is exposed. Through clothes
# they're a tease, and "cum" on a solo shoot is usually milk or lotion.
TOY_TAGS = frozenset({"sex toy", "vibrator", "dildo", "strap-on", "object insertion"})
SOLO_SEX_ACTS = frozenset({
    "masturbation", "fingering", "cumshot", "cum on body", "facial", "squirting",
})
HARDCORE_CATEGORIES = frozenset({"sex_act", "position"})
# Suggestive on their own: what she wears, or what the photo is built around.
SUGGESTIVE_RATING_TAGS = frozenset({
    # outfit
    "implied nudity", "topless", "bottomless", "see-through", "covered nipples",
    "pasties", "convenient censoring", "censored",
    "bikini", "swimsuit", "one-piece swimsuit", "lingerie", "underwear", "bra",
    "panties", "thong", "latex", "covering breasts", "leotard", "yuri",
    "garter straps", "garter belt", "highleg", "highleg leotard",
    "clothing aside", "panties aside", "swimsuit aside", "leotard aside",
    "skirt lift", "shirt lift",
    # body on show
    "cleavage", "underboob", "sideboob", "backboob", "cameltoe",
    # pose / focus
    "ass focus", "breast focus", "presenting", "top-down bottom-up", "jack-o' pose",
    "pantyshot", "upskirt", "downblouse",
}) | SUGGESTIVE_SEX_ACTS | SOLO_SEX_ACTS
# Suggestive only in combination: each entry is (any of these) + (any of those).
# Squatting alone is safe; squatting with her legs spread at the camera isn't.
SUGGESTIVE_COMBOS = (
    ({"spread legs"}, {"squatting", "sitting", "lying down", "on back", "kneeling"}),
    ({"bent over", "on all fours", "arched back"}, {"ass", "large ass", "huge ass", "from behind"}),
    ({"skin tight"}, {"shiny clothes"}),   # shiny skintight = latex-like
    # Body type matters: the same pose reads very differently on a big butt.
    ({"huge ass", "large ass", "thick thighs"},
     {"from behind", "ass focus", "bent over", "on all fours", "leotard", "highleg leotard"}),
)
# A tag the model is less than this sure of can still be shown, but it can't
# raise a file's Spice (a 7% sideboob guess must not decide anything).
SPICE_MIN_CONFIDENCE = 0.20
# Tags with a low display bar need more to decide Spice: any neckline reads as
# cleavage at 15%, which made most selfies in a top "suggestive".
SPICE_TAG_MIN = {"cleavage": 0.60, "sideboob": 0.30, "underboob": 0.30, "backboob": 0.30}
# A model score (vibe check or WD's own rating) can only lift Safe to
# Suggestive when the file has at least one of these, at any confidence.
MODEL_LIFT_HINTS = frozenset({
    "thighs", "thick thighs", "ass", "large ass", "huge ass", "wide hips", "curvy",
    "cleavage", "sideboob", "underboob", "backboob", "navel",
    "thigh-highs", "stockings", "fishnets", "panties", "underwear", "bra", "thong",
    "skin tight", "shiny clothes", "bodysuit", "leotard", "miniskirt", "shorts",
    "spread legs", "from behind", "ass focus", "bent over", "on all fours", "squatting",
    "lying down", "on back", "on stomach", "arched back", "kneeling",
})
# Spice vibe check (services/vibe.py): raises a real photo from Safe to
# Suggestive when this sure it looks sexual. It never lowers or goes higher.
VIBE_SCORE_KEY = "vibe_enticing"
VIBE_SUGGESTIVE_MIN = 0.70
# Model fallback for files no tag settles. "sensitive" is ignored: WD14 gives
# it to any cute cosplay (thigh-highs, frilly skirt). Only a clear
# questionable/explicit score can lift a file to suggestive, never higher.
MODEL_SUGGESTIVE_MIN = 0.5


def derive_rating(tags: dict[str, str], model_scores: Optional[dict[str, float]] = None,
                  hint_tags: Optional[set] = None) -> tuple[str, bool]:
    """Pick exactly one rating from the file's tags.

    tags: {normalised_name: category}. model_scores: the tagger's raw rating
    scores ({"general"|"sensitive"|"questionable"|"explicit": confidence}),
    if it gave any. hint_tags: every tag on the file, however weak; a model
    score may only lift a file to Suggestive when one of them hints at skin
    or pose (a nail-art close-up never qualifies). Returns (rating, decided_by_tags).

    Only tags can make a file explicit or hardcore. The model's whole-image
    explicit score fires on covered nudity and lots of skin, so it can at
    most lift an otherwise untagged file to suggestive.
    """
    names = set(tags)
    exposed = "nude" in names or bool(names & EXPLICIT_BODY_TAGS)
    for name, category in tags.items():
        if (category in HARDCORE_CATEGORIES and name not in SUGGESTIVE_SEX_ACTS
                and name not in SOLO_SEX_ACTS):
            return "hardcore", True
    if exposed and names & (TOY_TAGS | SOLO_SEX_ACTS):
        return "hardcore", True
    if exposed:
        return "explicit", True
    if names & SUGGESTIVE_RATING_TAGS:
        return "suggestive", True
    if any(names & first and names & second for first, second in SUGGESTIVE_COMBOS):
        return "suggestive", True
    hinted = bool((names if hint_tags is None else set(hint_tags)) & MODEL_LIFT_HINTS)
    if not hinted:
        return "safe", True
    if (model_scores or {}).get(VIBE_SCORE_KEY, 0.0) >= VIBE_SUGGESTIVE_MIN:
        return "suggestive", False
    if model_scores:
        racy = max(model_scores.get("questionable", 0.0), model_scores.get("explicit", 0.0))
        if racy >= MODEL_SUGGESTIVE_MIN and racy > model_scores.get("general", 0.0):
            return "suggestive", False
    return "safe", True


def _apply_rating_heuristic(best: dict[str, tuple[str, float]]) -> dict[str, tuple[str, float]]:
    """Post-process: replace the model's rating scores with one derived rating.

    Run after the nudity heuristic, so a covered 'nude' has already become
    'implied nudity' and can't push the file to explicit. Any rating-category
    entry is dropped here (raw model scores, or a vocab row mapped to a rating
    name), so only the derived rating is ever stored.
    """
    model_scores: dict[str, float] = {}
    for name in [n for n, (cat, _) in best.items() if cat == "rating" or n in RATING_TAGS]:
        _, conf = best.pop(name)
        if name.startswith(MODEL_RATING_PREFIX):
            model_scores[name[len(MODEL_RATING_PREFIX):]] = conf
    rating, by_tags = derive_rating(
        {name: cat for name, (cat, conf) in best.items()
         if conf >= max(SPICE_MIN_CONFIDENCE, SPICE_TAG_MIN.get(name, 0.0))},
        model_scores, hint_tags=set(best))
    if by_tags:
        confidence = 1.0
    else:
        confidence = max(model_scores.get("questionable", 0.0), model_scores.get("explicit", 0.0),
                         model_scores.get(VIBE_SCORE_KEY, 0.0))
    best[rating] = ("rating", confidence)
    return best


# Real photos. WD was trained on anime and over-calls explicit details on
# photos: skin-coloured panties read as pussy, a thong as anus, a hand bra as
# nipples. Measured on a creator who never shows anything (1 real explicit in
# ~1,900 photos, 67 flagged) against one who often does.
PHOTO_MIN_CONFIDENCE = {
    "nipples": 0.70,
    "pussy": 0.75, "vagina": 0.75, "pussy peek": 0.75, "spread pussy": 0.75,
    "nipple slip": 0.75, "areola slip": 0.75,
    "penis": 0.75, "erection": 0.75, "testicles": 0.75,
}
# On a photo these only count next to another explicit sign: alone they were
# wrong nearly every time (thongs, panties, tail plugs).
PHOTO_NEEDS_SUPPORT = frozenset({"anus", "anus peek", "spread anus", "pussy juice", "clitoris", "pubic hair"})
# Partner acts on a solo photo need this much confidence (a tail plug is not
# anal sex) unless a second person or a penis is visible.
PHOTO_SOLO_ACT_MIN = 0.75
REAL_PERSON_TYPES = JOYTAG_CREATOR_TYPES


def is_photo(img, wd_raw) -> bool:
    """Real photo (strict explicit rules) or art (WD's home ground)?"""
    creators = getattr(getattr(img, "gallery", None), "creators", None) or []
    if creators:
        return bool({str(c.creator_type).split(".")[-1].lower() for c in creators} & REAL_PERSON_TYPES)
    return any(name == "photorealistic" for name, _, _ in wd_raw)


def _apply_photo_rules(best: dict[str, tuple[str, float]], person_count: Optional[int]) -> dict:
    explicit_support = [n for n in best if (n in EXPLICIT_BODY_TAGS or n == "nude") and n not in PHOTO_NEEDS_SUPPORT]
    if not explicit_support:
        for name in [n for n in best if n in PHOTO_NEEDS_SUPPORT]:
            best.pop(name)
    partner = (person_count or 1) >= 2 or "penis" in best
    if not partner:
        for name in [n for n, (cat, conf) in best.items()
                     if cat in HARDCORE_CATEGORIES and n not in SUGGESTIVE_SEX_ACTS
                     and n not in SOLO_SEX_ACTS and conf < PHOTO_SOLO_ACT_MIN]:
            best.pop(name)
    return best


def finalize_tags(wd_raw: list, extra_raw: list, person_count: Optional[int], photo: bool) -> dict:
    """Merge one file's model outputs into the tags that get stored, Spice
    included. Shared by every tagging path (and the rule tests)."""
    from services import nudenet
    if photo:
        wd_raw = [t for t in wd_raw if t[2] >= PHOTO_MIN_CONFIDENCE.get(t[0], 0.0)]
    else:
        # The vibe check was only validated on real photos.
        extra_raw = [t for t in (extra_raw or []) if t[0] != MODEL_RATING_PREFIX + VIBE_SCORE_KEY]
    best: dict[str, tuple[str, float]] = {}
    for name, cat, conf in wd_raw:
        if name not in best or conf > best[name][1]:
            best[name] = (cat, conf)
    for name, cat, conf in nudenet.drop_covered(extra_raw or [], set(best)):
        if name not in best or conf > best[name][1]:
            best[name] = (cat, conf)
    # One head-count tag per file: the largest wins (JoyTag can list several).
    people = [name for name in PEOPLE_TAGS if name in best]
    for name in people[:-1]:
        best.pop(name)
    best = _apply_color_heuristic(best, person_count)
    if photo:
        best = _apply_photo_rules(best, person_count)
    best = _apply_nudity_heuristic(best)
    return _apply_rating_heuristic(best)


def _apply_nudity_heuristic(best: dict[str, tuple[str, float]]) -> dict[str, tuple[str, float]]:
    """Post-process: if 'nude' fires but explicit body parts don't, downgrade to 'implied nudity'."""
    if "nude" in best and not any(k in best for k in EXPLICIT_BODY_TAGS):
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


def repair_existing_color_tags(db, min_confidence: float = COLOR_TAG_MIN_CONFIDENCE) -> dict:
    """Normalize existing AI color links without touching manual links.

    This is a one-time data repair for libraries tagged before the color
    safeguards existed.  Manual color links are treated as authoritative; for
    AI-only images, links below the color floor are removed and up to one
    color per detected subject is retained in each family. Existing links that
    were removed by an older one-winner repair cannot be reconstructed here;
    those files need a retag run to recover their second subject's color.
    """
    from sqlalchemy import text

    names = sorted(COLOR_TAGS)
    binds = {f"name_{i}": name for i, name in enumerate(names)}
    placeholders = ", ".join(f":name_{i}" for i in range(len(names)))
    rows = db.execute(text(f"""
        SELECT it.image_id, i.person_count, it.tag_id, t.name, it.confidence, it.tagger_model
        FROM image_tags it
        JOIN tags t ON t.id = it.tag_id
        JOIN images i ON i.id = it.image_id
        WHERE lower(t.name) IN ({placeholders})
    """), binds).mappings().all()

    grouped: dict[tuple[int, str], list[dict]] = {}
    tag_ids: set[int] = set()
    manual_families: set[tuple[int, str]] = set()
    for row in rows:
        name = row["name"].lower()
        family = "hair" if name in HAIR_COLOR_TAGS else "eyes"
        key = (row["image_id"], family)
        grouped.setdefault(key, []).append(row)
        tag_ids.add(row["tag_id"])
        if row["tagger_model"] is None:
            manual_families.add(key)

    winners: list[dict] = []
    for key, candidates in grouped.items():
        if key in manual_families:
            continue
        eligible = [
            row for row in candidates
            if row["tagger_model"] is not None
            and float(row["confidence"] or 0.0) >= min_confidence
        ]
        if eligible:
            try:
                subject_limit = max(1, min(int(candidates[0]["person_count"] or 1), COLOR_MAX_SUBJECTS))
            except (TypeError, ValueError):
                subject_limit = 1
            for winner in sorted(
                eligible, key=lambda row: float(row["confidence"] or 0.0), reverse=True
            )[:subject_limit]:
                winners.append({
                    "image_id": winner["image_id"],
                    "tag_id": winner["tag_id"],
                    "confidence": winner["confidence"],
                    "tagger_model": winner["tagger_model"],
                })

    ai_color_ids = [
        row["tag_id"] for row in rows if row["tagger_model"] is not None
    ]
    if ai_color_ids:
        db.execute(text(f"""
            DELETE FROM image_tags
            WHERE tagger_model IS NOT NULL
              AND tag_id IN ({", ".join(str(tag_id) for tag_id in sorted(set(ai_color_ids)))})
        """))
        if winners:
            db.execute(text("""
                INSERT INTO image_tags (image_id, tag_id, confidence, tagger_model)
                VALUES (:image_id, :tag_id, :confidence, :tagger_model)
            """), winners)

    if tag_ids:
        db.execute(text(f"""
            UPDATE tags
            SET use_count = (
                SELECT COUNT(*) FROM image_tags WHERE image_tags.tag_id = tags.id
            )
            WHERE id IN ({", ".join(str(tag_id) for tag_id in sorted(tag_ids))})
        """))

    removed = len(ai_color_ids) - len(winners)
    return {
        "examined": len(rows),
        "removed": removed,
        "kept": len(winners),
        "manual_families": len(manual_families),
    }


# Tags whose built-in name changed after people already had links to them.
RENAMED_BUILTIN_TAGS = {"panties_aside": ("panties aside", "clothing")}


def _rename_builtin_tags(db) -> int:
    """Move links from an old raw tag name to its new built-in name."""
    from sqlalchemy import text
    moved = 0
    for old_name, (new_name, category) in RENAMED_BUILTIN_TAGS.items():
        old = db.execute(text("SELECT id FROM tags WHERE name = :n"), {"n": old_name}).scalar()
        if old is None:
            continue
        new = db.execute(text("SELECT id FROM tags WHERE name = :n"), {"n": new_name}).scalar()
        if new is None:
            db.execute(text("UPDATE tags SET name = :n, category = :c WHERE id = :id"),
                       {"n": new_name, "c": category, "id": old})
            moved += db.execute(text("SELECT COUNT(*) FROM image_tags WHERE tag_id = :id"), {"id": old}).scalar()
            continue
        # Both exist: keep the new tag, move links that aren't already there.
        moved += db.execute(text("""
            UPDATE image_tags SET tag_id = :new WHERE tag_id = :old
              AND image_id NOT IN (SELECT image_id FROM image_tags WHERE tag_id = :new)
        """), {"new": new, "old": old}).rowcount
        db.execute(text("DELETE FROM image_tags WHERE tag_id = :old"), {"old": old})
        db.execute(text("UPDATE tags SET use_count = (SELECT COUNT(*) FROM image_tags WHERE tag_id = :new) WHERE id = :new"),
                   {"new": new})
        db.execute(text("DELETE FROM tags WHERE id = :old"), {"old": old})
    return moved


def remove_ai_character_tags(db) -> dict:
    """Delete character tags the AI guessed (manual links are kept), then
    drop character tags nothing uses any more. One-time cleanup for the WD
    character passthrough that no longer exists."""
    from sqlalchemy import text
    links = db.execute(text("""
        DELETE FROM image_tags
        WHERE tagger_model IS NOT NULL
          AND tag_id IN (SELECT id FROM tags WHERE category = 'character')
    """)).rowcount
    db.execute(text("""
        UPDATE tags SET use_count = (SELECT COUNT(*) FROM image_tags WHERE image_tags.tag_id = tags.id)
        WHERE category = 'character'
    """))
    tags = db.execute(text("""
        DELETE FROM tags
        WHERE category = 'character'
          AND NOT EXISTS (SELECT 1 FROM image_tags WHERE image_tags.tag_id = tags.id)
          AND NOT EXISTS (SELECT 1 FROM gallery_tags WHERE gallery_tags.tag_id = tags.id)
    """)).rowcount
    db.commit()
    return {"links_removed": links, "tags_removed": tags}


def repair_rating_tags(db, fill_missing: bool = False, dry_run: bool = False) -> dict:
    """Give every AI-rated file exactly one rating, derived from its tags.

    One-time data repair for files tagged while every rating was written at
    once, safe to re-run after the rules change. Files with a manual rating
    are left alone. With fill_missing, AI-tagged files that never got a rating
    receive one too. Uses tags only: stored rating scores can't be trusted as
    model scores (old runs merged sensitive and questionable into one).
    """
    from sqlalchemy import text

    _rename_builtin_tags(db)
    rating_ids = {
        name: tag_id for name, tag_id in db.execute(
            text(f"SELECT name, id FROM tags WHERE name IN ({', '.join(repr(n) for n in RATING_TAGS)})")
        ).fetchall()
    }
    db.execute(text("DROP TABLE IF EXISTS temp._rating_targets"))
    db.execute(text("CREATE TEMP TABLE _rating_targets (image_id INTEGER PRIMARY KEY)"))
    if rating_ids:
        db.execute(text(f"""
            INSERT OR IGNORE INTO _rating_targets
            SELECT DISTINCT image_id FROM image_tags
            WHERE tag_id IN ({", ".join(str(i) for i in rating_ids.values())})
        """))
    if fill_missing:
        db.execute(text("INSERT OR IGNORE INTO _rating_targets SELECT id FROM images WHERE ai_tagged = 1"))

    rows = db.execute(text("""
        SELECT it.image_id, t.name, t.category, it.confidence, it.tagger_model, i.ai_tag_model
        FROM _rating_targets r
        JOIN image_tags it ON it.image_id = r.image_id
        JOIN tags t ON t.id = it.tag_id
        JOIN images i ON i.id = r.image_id
    """)).fetchall()

    per_image: dict[int, dict] = {}
    for image_id, name, category, confidence, tagger_model, ai_model in rows:
        info = per_image.setdefault(image_id, {"tags": {}, "manual": False,
                                               "model": tagger_model or ai_model})
        lname = (name or "").lower()
        if lname in RATING_TAGS:
            if tagger_model is None:
                info["manual"] = True
            else:
                info["model"] = tagger_model
        else:
            info["tags"][lname] = category or "general"

    counts = {"examined": len(per_image), "manual_skipped": 0, **{name: 0 for name in RATING_TAGS}}
    inserts: list[dict] = []
    for image_id, info in per_image.items():
        if info["manual"]:
            counts["manual_skipped"] += 1
            continue
        rating, _ = derive_rating(info["tags"])
        counts[rating] += 1
        inserts.append({"image_id": image_id, "rating": rating, "confidence": 1.0,
                        "tagger_model": info["model"] or "repair"})

    if dry_run:
        db.rollback()
        return counts

    for name in RATING_TAGS:
        if name not in rating_ids:
            rating_ids[name] = _get_or_create_tag(db, name, "rating").id
    manual_ids = [i for i, info in per_image.items() if info["manual"]]
    db.execute(text(f"""
        DELETE FROM image_tags
        WHERE tagger_model IS NOT NULL
          AND tag_id IN ({", ".join(str(i) for i in rating_ids.values())})
          AND image_id IN (SELECT image_id FROM _rating_targets)
          {"AND image_id NOT IN (" + ", ".join(map(str, manual_ids)) + ")" if manual_ids else ""}
    """))
    if inserts:
        db.execute(text("""
            INSERT INTO image_tags (image_id, tag_id, confidence, tagger_model)
            VALUES (:image_id, :tag_id, :confidence, :tagger_model)
        """), [{"image_id": row["image_id"], "tag_id": rating_ids[row["rating"]],
                "confidence": row["confidence"], "tagger_model": row["tagger_model"]}
               for row in inserts])
    db.execute(text(f"""
        UPDATE tags SET use_count = (SELECT COUNT(*) FROM image_tags WHERE image_tags.tag_id = tags.id)
        WHERE id IN ({", ".join(str(i) for i in rating_ids.values())})
    """))
    db.execute(text("DROP TABLE IF EXISTS temp._rating_targets"))
    db.commit()
    return counts


def _apply_tag_results(img, db, raw_results, person_count, model_name: str,
                       clear_existing: bool = False, tag_cache: Optional[dict] = None,
                       extra_raw: Optional[list] = None) -> bool:
    """Apply already-inferred results to one image without another model call.
    raw_results come from the tagger, extra_raw from detector add-ons."""
    if clear_existing:
        _clear_ai_tags(db, img.id)
    if not raw_results and not extra_raw:
        img.ai_tagged = True
        img.ai_tag_model = model_name
        return False

    best = finalize_tags(raw_results, extra_raw or [], person_count, is_photo(img, raw_results))
    for name, (cat, conf) in best.items():
        tag = _get_or_create_tag(db, name, cat, tag_cache)
        _upsert_image_tag(db, img.id, tag.id, conf, model_name)
        tag.use_count = (tag.use_count or 0) + 1
    img.ai_tagged = True
    img.ai_tag_model = model_name
    if person_count is not None:
        img.person_count = person_count
    return True


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

    best = finalize_tags(raw_results, [], person_count, is_photo(img, raw_results))

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

    frames, tmpdir = _extract_video_frames(img.file_path, duration=img.duration)
    if not frames:
        logger.debug("No frames extracted from %s", img.file_path)
        return False

    try:
        if clear_existing:
            _clear_ai_tags(db, img.id)

        # Aggregate across all frames — keep highest confidence per tag name
        best: dict[str, tuple[str, float]] = {}
        person_count: Optional[int] = None

        # The four sampled frames share one inference call. Frame extraction is
        # still the expensive video-specific stage, but this keeps the GPU fed.
        for raw_results, pc in tagger.tag_batch(frames, threshold):
            if pc is not None and (person_count is None or pc > person_count):
                person_count = pc
            for name, cat, conf in raw_results:
                if name not in best or conf > best[name][1]:
                    best[name] = (cat, conf)

        if not best:
            return False

        merged = [(name, cat, conf) for name, (cat, conf) in best.items()]
        best = finalize_tags(merged, [], person_count, is_photo(img, merged))

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
def tag_job_state(job):
    return dict(running=job.status == 'running', status=job.status,
                paused=job.status == 'paused', cancelled=job.status == 'cancelled',
                job_id=job.id, progress=job.progress, total=job.total,
                tagged=job.tagged, skipped=job.skipped, errors=job.errors,
                message=job.message)


def _publish_queued_job(job):
    with _lock:
        if not _state.get('running'):
            _state.update(tag_job_state(job), current_path=None, active_model=None,
                          eta_seconds=None, items_per_second=None)


MEDIA_KINDS = ("all", "photos", "videos")


def _mark_card_classifications_stale(db):
    """Cards cache their Spice and Exposure from the source file's tags. After
    tags change, mark the cache stale; the TCG re-reads it on its next visit."""
    from sqlalchemy import text
    db.execute(text("UPDATE card_content_classifications SET policy_version = NULL"))
    db.execute(text("UPDATE cards SET face_traits = NULL WHERE face_traits IS NOT NULL"))


def create_tag_job(db, scope: str, folder_path: Optional[str], threshold: float,
                   retag: bool, model_override: Optional[str], creator_id: Optional[int],
                   image_id: Optional[int] = None, media: str = "all",
                   extra_models: Optional[list[str]] = None):
    from models import AITagJob
    extras = [k for k in (extra_models or []) if k in DETECTOR_KEYS]
    job = AITagJob(
        status="queued", scope=scope, folder_path=folder_path,
        creator_id=creator_id, image_id=image_id, threshold=threshold, retag=retag,
        model_override=model_override, message="Waiting in queue…",
        media=media if media in MEDIA_KINDS else "all",
        extra_models=",".join(extras) or None,
    )
    db.add(job)
    db.commit()
    db.refresh(job)
    _publish_queued_job(job)
    return job


def get_tag_job(db, job_id: Optional[int] = None, paused_only: bool = False):
    from models import AITagJob
    q = db.query(AITagJob)
    if job_id is not None:
        q = q.filter(AITagJob.id == job_id)
    if paused_only:
        q = q.filter(AITagJob.status == "paused")
    return q.order_by(AITagJob.updated_at.desc(), AITagJob.id.desc()).first()


def queue_resumed_job(db, job_id: Optional[int] = None):
    job = get_tag_job(db, job_id, paused_only=True)
    if not job:
        return None
    job.status = "queued"
    job.message = "Waiting to resume…"
    db.commit()
    _publish_queued_job(job)
    return job


def cancel_persisted_job(db, job_id: Optional[int] = None) -> bool:
    job = get_tag_job(db, job_id)
    if not job or job.status not in {"paused", "queued"}:
        return False
    job.status = "cancelled"
    job.message = f"Cancelled — {job.tagged} tagged, {job.skipped} skipped, {job.errors} errors."
    db.commit()
    _set(running=False, status="cancelled", paused=False, cancelled=True,
         job_id=job.id, message=job.message)
    return True


def _job_query(db, job, after_id: Optional[int] = None, light: bool = False):
    """Files a job still has to tag. light=True returns plain rows with only
    what the read-ahead needs, which never go stale across commits."""
    from models import Image, Gallery
    from sqlalchemy.orm import selectinload
    if light:
        q = db.query(Image.id, Image.file_path, Image.is_video, Image.duration)
    else:
        q = db.query(Image).options(
            selectinload(Image.gallery).selectinload(Gallery.creators)
        )
    if job.scope == "folder" and job.folder_path:
        q = q.join(Gallery, Image.gallery_id == Gallery.id).filter(Gallery.folder_path.like(f"{job.folder_path}%"))
    elif job.scope == "creator" and job.creator_id:
        from models import gallery_creators
        q = (q.join(Gallery, Image.gallery_id == Gallery.id)
               .join(gallery_creators, gallery_creators.c.gallery_id == Gallery.id)
               .filter(gallery_creators.c.creator_id == job.creator_id))
    elif job.scope == "image" and job.image_id:
        q = q.filter(Image.id == job.image_id)
    if job.media == "photos":
        q = q.filter(Image.is_video == False)  # noqa: E712
    elif job.media == "videos":
        q = q.filter(Image.is_video == True)  # noqa: E712
    if not job.retag:
        q = q.filter(Image.ai_tagged == False)  # noqa: E712
    if after_id is not None:
        q = q.filter(Image.id > after_id)
    return q


# A chunk holds at most this many videos: each costs about as much as a
# dozen photos, and Pause waits for the current chunk to finish.
VIDEO_CHUNK = 8


def job_model_label(job) -> str:
    base = TAGGER_MODELS[job.model_override]["label"] if job.model_override in TAGGER_MODELS else "Auto"
    extras = [TAGGER_MODELS[k]["label"] for k in (job.extra_models or "").split(",") if k in TAGGER_MODELS]
    return " + ".join([base, *extras])


def _trim_chunk(chunk: list) -> list:
    """Cut a chunk after its VIDEO_CHUNK-th video, keeping id order."""
    videos = 0
    for i, img in enumerate(chunk):
        if img.is_video:
            videos += 1
            if videos >= VIDEO_CHUNK:
                return chunk[:i + 1]
    return chunk


def _prefetch_media(prefetch: dict, images: list, max_side: int):
    """Start reading/decoding files in the background, keyed by image id."""
    for img in images:
        if img.id in prefetch or not img.file_path:
            continue
        if img.is_video:
            prefetch[img.id] = _video_pool.submit(_load_video_frames, img.file_path, img.duration, max_side)
        else:
            prefetch[img.id] = _preprocess_pool.submit(_load_for_tagging, img.file_path, max_side)


def _run_model(model, items: list, threshold: float, answers: dict, failed: set):
    """Run one model over (img, frame) pairs and merge its answers per image."""
    arrays = [model.preprocess(frame) for _, frame in items]
    for offset in range(0, len(items), AI_BATCH_SIZE):
        batch = items[offset:offset + AI_BATCH_SIZE]
        try:
            outs = model.infer(arrays[offset:offset + AI_BATCH_SIZE], threshold)
        except Exception as exc:
            logger.warning("%s failed on a batch: %s", model.MODEL_NAME, exc)
            failed.update(img.id for img, _ in batch)
            continue
        for (img, _), (raw, person_count) in zip(batch, outs):
            entry = answers.setdefault(img.id, {"raw": [], "person_count": None})
            entry["raw"].extend(raw)
            if person_count is not None and (entry["person_count"] is None
                                             or person_count > entry["person_count"]):
                entry["person_count"] = person_count


def _tag_chunk(db, job, chunk: list, prefetch: dict, detectors: list, tag_cache: dict):
    """Tag one chunk from its prefetched pixels: every chosen model looks at
    the same decoded frames, then the results are merged per file."""
    frames_by_id: dict[int, list] = {}
    tagger_by_id: dict[int, object] = {}
    for img in chunk:
        future = prefetch.pop(img.id, None)
        if not img.file_path or not os.path.exists(img.file_path):
            job.skipped += 1
            continue
        tagger = _tagger_for_image(img, job.model_override)
        if tagger is None:
            job.errors += 1
            continue
        result = future.result() if future is not None else None
        frames_by_id[img.id] = (result or []) if img.is_video else ([result] if result is not None else [])
        tagger_by_id[img.id] = tagger

    by_id = {img.id: img for img in chunk}
    answers: dict[int, dict] = {}
    failed: set[int] = set()
    groups: dict[object, list] = {}
    for image_id, frames in frames_by_id.items():
        groups.setdefault(tagger_by_id[image_id], []).extend((by_id[image_id], f) for f in frames)
    for tagger, items in groups.items():
        _run_model(tagger, items, job.threshold, answers, failed)
    found: dict[int, dict] = {}
    if detectors:
        items = [(by_id[i], f) for i, frames in frames_by_id.items() for f in frames]
        for detector in detectors:
            _run_model(detector, items, job.threshold, found, failed)

    for image_id, frames in frames_by_id.items():
        img = by_id[image_id]
        if image_id in failed:
            job.errors += 1
            continue
        if not frames:
            # Undecodable file or no video frames: don't retry it every run.
            img.ai_tagged = True
            img.ai_tag_model = tagger_by_id[image_id].MODEL_NAME
            job.skipped += 1
            continue
        entry = answers.get(image_id, {"raw": [], "person_count": None})
        ok = _apply_tag_results(img, db, entry["raw"], entry["person_count"],
                                tagger_by_id[image_id].MODEL_NAME,
                                clear_existing=job.retag, tag_cache=tag_cache,
                                extra_raw=found.get(image_id, {}).get("raw", []))
        if ok:
            job.tagged += 1
        else:
            job.skipped += 1


def run_tag_job(db, job_id: int):
    """Run or resume a durable job using bounded chunks and batched inference."""
    global _control
    from models import AITagJob, Tag, Image

    job = db.get(AITagJob, job_id)
    if not job:
        db.close()
        return
    model_label = job_model_label(job)
    detectors = _get_detectors(job.extra_models)
    # Decode big enough for the largest add-on input (NudeNet reads 640px).
    max_side = 640 if any(getattr(d, "MODEL_NAME", "").startswith("nudenet") for d in detectors) else TARGET_SIZE
    prefetch: dict[int, object] = {}
    with _lock:
        _control = "run"
    started_at = time.perf_counter()
    started_progress = job.progress or 0
    handler = _ScanLogHandler(logging.INFO)
    handler.setFormatter(logging.Formatter("%(levelname)s %(message)s"))
    logger.addHandler(handler)

    try:
        job.status = "running"
        job.message = "Preparing media…"
        _set(running=True, status="running", paused=False, cancelled=False,
             job_id=job.id, progress=job.progress, total=job.total,
             tagged=job.tagged, skipped=job.skipped, errors=job.errors,
             message=job.message, active_model=model_label, current_path=None,
             eta_seconds=None, items_per_second=None)
        tag_cache = {tag.name: tag for tag in db.query(Tag).all()}
        if not job.total:
            job.total = _job_query(db, job).order_by(None).count()
        db.commit()
        _set(running=True, status="running", paused=False, cancelled=False,
             job_id=job.id, progress=job.progress, total=job.total,
             tagged=job.tagged, skipped=job.skipped, errors=job.errors,
             message=job.message, active_model=model_label, current_path=None,
             eta_seconds=None, items_per_second=None)

        while True:
            action = _control_action()
            if action in {"pause", "cancel"}:
                _mark_card_classifications_stale(db)
                job.status = action + "d" if action == "pause" else "cancelled"
                job.message = ("Paused — progress safely saved." if action == "pause" else
                               f"Cancelled — {job.tagged} tagged, {job.skipped} skipped, {job.errors} errors.")
                db.commit()
                _set(running=False, status=job.status, paused=action == "pause",
                     cancelled=action == "cancel", message=job.message,
                     active_model=None, current_path=None)
                return

            chunk = (_job_query(db, job, job.last_image_id or 0)
                     .order_by(Image.id).limit(64).all())
            if not chunk:
                _mark_card_classifications_stale(db)
                job.status = "done"
                job.progress = job.total
                job.message = f"Done — {job.tagged} tagged, {job.skipped} no-result, {job.errors} errors."
                db.commit()
                _set(running=False, status="done", paused=False, cancelled=False,
                     progress=job.progress, tagged=job.tagged, skipped=job.skipped,
                     errors=job.errors, message=job.message, active_model=None,
                     current_path=None, eta_seconds=0)
                return

            chunk = _trim_chunk(chunk)
            _prefetch_media(prefetch, chunk, max_side)
            # Read one chunk ahead, so the disk keeps working while the GPU
            # and database handle this one.
            ahead = (_job_query(db, job, chunk[-1].id, light=True)
                     .order_by(Image.id).limit(64).all())
            _prefetch_media(prefetch, _trim_chunk(ahead), max_side)

            _tag_chunk(db, job, chunk, prefetch, detectors, tag_cache)

            job.last_image_id = max(img.id for img in chunk)
            job.progress = min(job.total, job.progress + len(chunk))
            job.message = f"Tagging {job.progress:,} / {job.total:,}…"
            db.commit()  # every checkpoint is resume-safe

            elapsed = max(0.001, time.perf_counter() - started_at)
            rate = max(0.0, (job.progress - started_progress) / elapsed)
            eta = int((job.total - job.progress) / rate) if rate > 0 else None
            _set(progress=job.progress, total=job.total, tagged=job.tagged,
                 skipped=job.skipped, errors=job.errors, message=job.message,
                 current_path=chunk[-1].file_path, items_per_second=round(rate, 2),
                 eta_seconds=eta)
    except Exception as exc:
        logger.exception("Durable AI tagging job failed: %s", exc)
        db.rollback()
        job = db.get(AITagJob, job_id)
        if job:
            job.status = "failed"
            job.message = f"Fatal error: {exc}"
            db.commit()
        _set(running=False, status="failed", paused=False,
             message=f"Fatal error: {exc}", active_model=None, current_path=None)
    finally:
        logger.removeHandler(handler)
        db.close()


def download_models_task(keys: list[str]):
    _set(running=True, status="running", paused=False, job_id=None,
         message="Starting model download…", cancelled=False)
    try:
        for key in keys:
            if not model_is_ready(key):
                download_model(key)
        _reset_singletons()

        from database import SessionLocal
        db = SessionLocal()
        try:
            if wd14_is_ready():
                seed_tag_vocab(db, "wd14")
            if joytag_is_ready():
                seed_tag_vocab(db, "joytag")
        finally:
            db.close()

        _set(message="Download complete.", running=False, status="done")
    except Exception as e:
        logger.exception("Model download failed: %s", e)
        _set(message=f"Download error: {e}", running=False, status="failed")
