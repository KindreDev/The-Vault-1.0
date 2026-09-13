# Modular card orb

The orb is a shared layered card asset rather than part of a card frame.

Runtime order:

1. Render `orb-housing-gold.png` at the template's orb-housing anchor.
2. Select one persisted icon from `icons/` and render it at the icon anchor. Icons are normalized to their visible alpha bounds; do not add another padded sprite-cell fit at runtime.
3. Apply rarity-dependent coded VFX later using the separate ring, glass, and icon-alpha finish masks.

The current icon library contains flame, heart, star, crown, crescent moon, cherry blossom, paw, musical note, and camera aperture. The accepted flame is the visual scale master: a symbol should occupy roughly 62% of the orb diameter. Icon selection must be stored in the published card recipe so it never changes between renders.

`orb-icon-preview.png` is a contact sheet for review only. It is not a runtime texture.

Run `scripts/build_tcg_orb_assets.py` from the repository root after changing a source icon. It removes chroma spill, trims every icon to its visible alpha bounds, preserves the accepted flame as the scale master, and rebuilds both review previews.
