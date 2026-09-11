# Scene template — floral outline v2

This directory contains the decomposed TCG V2 Scene template. The accepted reference is `../../references/accepted/Scene.png`; it is a design reference, not a runtime frame.

## Runtime composition

1. Clip the frozen source media with `art-mask.png`.
2. Apply any persisted, non-destructive artwork grading.
3. Require a passing human-specific portrait matte, remove detached false positives, derive the separator, two-color matching outline, and bloom from that matte, then composite the extracted subject above the original photograph.
4. Composite `frame-over.png` above all photographic layers.
5. Render the immutable mint-time text snapshot, the type-specific rarity asset, and a Vault-authored signature only for SPR.
6. Use `finish-frame.png` as an eligibility mask for later CSS or coded foil effects.
7. Apply `card-clip-mask.png` to the final visual stack.

`frame-over.png` intentionally contains no photograph, subject, text, rarity, metadata, card ID, or signature. Source art, packed subject mask, frame, text, rarity, signature, and foil mask remain separate assets or layers.

The matching outline is mandatory. Generic foreground removal is insufficient because it may classify an airplane, chair, or set piece as the subject. Scene uses a local portrait matte and rejects silhouettes that are too small, dominate the frame, are clipped through the top or either side, collide with either text zone, or contain a known person count other than one. Only bottom-edge cropping is accepted. A failed candidate is skipped rather than silently rendered off-design.

The two outline colors are chosen deterministically from saturated subject colors, converted to bright print ink, and persisted in the card recipe. A pale separator guarantees contrast when an accent resembles the background.

Creator name, creator type, Scene name, period, and card ID are live SVG text from a frozen mint snapshot. They are not baked into the frame. The bundled Barlow Condensed files make the accepted typography reproducible, and all readable text is at least 25 px on the 1024×1536 master.

`frontend/src/components/tcg-v2/SceneCard.jsx` is the layered browser composer. `backend/services/scene_cards.py` owns deterministic cleanup, eligibility, and strict recipe construction. `scripts/generate_scene_portrait_test_masks.py` and `scripts/render_scene_card_proof.py` are the executable visual proof tools.
