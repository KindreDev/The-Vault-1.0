"""Spice vibe check: a whole-photo classifier used as a detector add-on.

SigLIP 2 fine-tuned by prithivMLmods (siglip2-x256-explicit-content,
Apache-2.0) into Normal / Enticing or Sensual / Pornography / Anime / Hentai,
converted to ONNX and published at kindredsp/siglip2-explicit-content-onnx. Tested on the library it is a poor explicit judge (cosplay
reads as anime or hentai, real nudes as hentai), but it reliably spots photos
that are built to be sexy while everything stays covered: pose, angle, a tight
dress on a big butt. So it only ever raises a real photo from Safe to
Suggestive (see ai_tagger.derive_rating); it never lowers or decides Explicit.
"""
import json
import os
import threading
from typing import Optional

import numpy as np
from PIL import Image as PILImage

INPUT_SIZE = 256
MODEL_NAME = "spice-vibe-siglip2"
# Classes that mean "this photo isn't sexual". Everything else (Enticing,
# Pornography, Hentai) counts: on real cosplay the model often says "Hentai"
# for a sexy 2B shot, and since the score can only lift Safe to Suggestive,
# any sexual class is enough.
NON_SEXUAL_LABELS = ("Normal", "Anime Picture")
# Carried to the Spice step under the model-rating prefix, never stored.
SCORE_KEY = "vibe_enticing"


def preprocess(img: PILImage.Image) -> np.ndarray:
    """SiglipImageProcessor: squash to 256x256, scale to -1..1, NCHW."""
    img = img.convert("RGB").resize((INPUT_SIZE, INPUT_SIZE), PILImage.BILINEAR)
    arr = (np.asarray(img, dtype=np.float32) / 255.0 - 0.5) / 0.5
    return arr.transpose(2, 0, 1)[np.newaxis, :]


class VibeClassifier:
    MODEL_NAME = MODEL_NAME

    def __init__(self, model_dir: str):
        from services.ai_tagger import _make_session
        self._session = _make_session(os.path.join(model_dir, "model.onnx"))
        self._input_name = self._session.get_inputs()[0].name
        with open(os.path.join(model_dir, "labels.json"), encoding="utf-8") as f:
            labels = {int(k): v for k, v in json.load(f).items()}
        self._plain = [i for i, name in labels.items() if name in NON_SEXUAL_LABELS]

    def preprocess(self, img: PILImage.Image) -> np.ndarray:
        return preprocess(img)

    def infer(self, arrays: list[np.ndarray], threshold: float = 0.0):
        """[(tags, person_count)] per image, like the taggers. The only "tag"
        is how sexual the photo looks (1 - Normal - Anime), under the
        model-rating prefix."""
        from services.ai_tagger import MODEL_RATING_PREFIX
        if not arrays:
            return []
        logits = self._session.run(None, {self._input_name: np.concatenate(arrays, axis=0)})[0]
        probs = np.exp(logits - logits.max(axis=1, keepdims=True))
        probs /= probs.sum(axis=1, keepdims=True)
        return [([(MODEL_RATING_PREFIX + SCORE_KEY, "rating", float(1.0 - p[self._plain].sum()))], None) for p in probs]


_model: Optional[VibeClassifier] = None
_lock = threading.Lock()


def get_classifier(model_dir: str) -> Optional[VibeClassifier]:
    global _model
    with _lock:
        if _model is None and os.path.exists(os.path.join(model_dir, "model.onnx")):
            _model = VibeClassifier(model_dir)
        return _model


def reset():
    global _model
    with _lock:
        _model = None
