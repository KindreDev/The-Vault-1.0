"""NudeNet body-part detector, used as an optional extra during AI tagging.

The WD and JoyTag taggers are trained mostly on anime and often miss exposed
parts in real photos. NudeNet (MIT, notAI-tech) is a YOLOv8 detector trained
on real photos. We only need to know *whether* each part shows, not where, so
the boxes are reduced to one best score per class.
"""
import os
import threading
from typing import Optional

import numpy as np
from PIL import Image as PILImage

INPUT_SIZE = 640
MODEL_FILE = "640m.onnx"
MODEL_NAME = "nudenet-640m"

# Output class order of the v3.4 detector.
LABELS = (
    "FEMALE_GENITALIA_COVERED", "FACE_FEMALE", "BUTTOCKS_EXPOSED", "FEMALE_BREAST_EXPOSED",
    "FEMALE_GENITALIA_EXPOSED", "MALE_BREAST_EXPOSED", "ANUS_EXPOSED", "FEET_EXPOSED",
    "BELLY_COVERED", "FEET_COVERED", "ARMPITS_COVERED", "ARMPITS_EXPOSED", "FACE_MALE",
    "BELLY_EXPOSED", "MALE_GENITALIA_EXPOSED", "ANUS_COVERED", "FEMALE_BREAST_COVERED",
    "BUTTOCKS_COVERED",
)

# Detector class → (Vault tag, category, minimum score). Only the classes the
# rating rule cares about become tags; covered parts and faces are ignored.
# Thresholds measured on the library: "breast exposed" means bare breast skin,
# and fires 0.65-0.75 on hand bras and implied nudity, ~0.85 when topless.
CLASS_TAGS: dict[str, tuple[str, str, float]] = {
    "FEMALE_BREAST_EXPOSED":    ("nipples", "body_part", 0.80),
    # Skin-coloured panties and leggings read as exposed genitals at 0.45-0.65.
    "FEMALE_GENITALIA_EXPOSED": ("pussy",   "body_part", 0.70),
    "MALE_GENITALIA_EXPOSED":   ("penis",   "body_part", 0.75),
    "ANUS_EXPOSED":             ("anus",    "body_part", 0.45),
}
_CLASS_INDEX = {name: i for i, name in enumerate(LABELS)}

# When the tagger saw something covering a part, its call wins: NudeNet reads
# heart pasties as bare breasts.
COVERED_BY = {
    "nipples": {"pasties", "covered nipples", "convenient censoring", "covering breasts"},
    "pussy": {"convenient censoring"},
}
# "Exposed" only counts when it beats the detector's own "covered" score.
COVERED_CLASS = {
    "FEMALE_BREAST_EXPOSED": "FEMALE_BREAST_COVERED",
    "FEMALE_GENITALIA_EXPOSED": "FEMALE_GENITALIA_COVERED",
    "ANUS_EXPOSED": "ANUS_COVERED",
}


def drop_covered(detected: list, tagger_tags: set) -> list:
    """Remove detections the tagger already saw covered."""
    return [t for t in detected if not (COVERED_BY.get(t[0], set()) & tagger_tags)]


def preprocess(img: PILImage.Image) -> np.ndarray:
    """Match NudeNet's own loader: pad right/bottom with black to a square,
    resize to 640, RGB scaled to 0-1, NCHW."""
    img = img.convert("RGB")
    w, h = img.size
    side = max(w, h)
    canvas = PILImage.new("RGB", (side, side), (0, 0, 0))
    canvas.paste(img, (0, 0))
    if side != INPUT_SIZE:
        canvas = canvas.resize((INPUT_SIZE, INPUT_SIZE), PILImage.BILINEAR)
    arr = np.asarray(canvas, dtype=np.float32) / 255.0
    return arr.transpose(2, 0, 1)[np.newaxis, :]


class NudeNetDetector:
    MODEL_NAME = MODEL_NAME

    def __init__(self, model_path: str):
        from services.ai_tagger import _make_session
        self._session = _make_session(model_path)
        self._input_name = self._session.get_inputs()[0].name

    def preprocess(self, img: PILImage.Image) -> np.ndarray:
        return preprocess(img)

    def class_scores(self, arrays: list[np.ndarray]) -> np.ndarray:
        """Best score per class for each image: shape (n, len(LABELS))."""
        if not arrays:
            return np.zeros((0, len(LABELS)), dtype=np.float32)
        out = self._session.run(None, {self._input_name: np.concatenate(arrays, axis=0)})[0]
        # out: (n, 4 box coords + classes, anchors)
        return out[:, 4:4 + len(LABELS), :].max(axis=2)

    def infer(self, arrays: list[np.ndarray], threshold: float = 0.0):
        """Same answer shape as the taggers: [(tags, person_count)] per image.
        The tagger threshold doesn't apply; each class has its own minimum."""
        return [(tags_from_scores(scores), None) for scores in self.class_scores(arrays)]


def tags_from_scores(scores) -> list:
    """Vault tags from one image's per-class best scores."""
    tags = []
    for label, (tag, category, minimum) in CLASS_TAGS.items():
        score = float(scores[_CLASS_INDEX[label]])
        covered = COVERED_CLASS.get(label)
        if score < minimum or (covered and float(scores[_CLASS_INDEX[covered]]) >= score):
            continue
        tags.append((tag, category, score))
    return tags


_detector: Optional[NudeNetDetector] = None
_lock = threading.Lock()


def get_detector(model_dir: str) -> Optional[NudeNetDetector]:
    global _detector
    path = os.path.join(model_dir, MODEL_FILE)
    with _lock:
        if _detector is None and os.path.exists(path):
            _detector = NudeNetDetector(path)
        return _detector


def reset():
    global _detector
    with _lock:
        _detector = None
