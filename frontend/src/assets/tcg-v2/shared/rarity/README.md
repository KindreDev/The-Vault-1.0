# Rarity assets by card type

Rarity and card type are independent data. A Scene, Gallery, Character, or any other supported type may be C, R, SR, UR, or SPR.

The accepted card designs deliberately use eight different rarity treatments. Runtime code therefore selects a transparent asset using both values:

`types/{card-type}/{rarity}.png`

The eight treatments are Character's delicate serif, Scene's rounded dimensional rainbow lettering, Cosplay's banner-integrated glitter serif, Creator's editorial spine plaque, Collab's glowing gold serif, Gallery's double-outlined serif, Bond Card's icy capsule, and Hall of Fame's regal serif. Scene uses the bundled Fredoka Bold variable font under the SIL Open Font License so its accepted typography is reproducible rather than dependent on a developer's installed fonts.

Every label also has a matching alpha-only file under `type-glyph-masks/` for coded foil and glow effects. SPR signatures remain a separate Vault-authored layer and are never baked into the rarity label.

`bounds.json` records the exact non-transparent bounds of every label. The runtime composer uses those bounds to crop the intentionally padded source assets before placing them, so each accepted rarity style lands at its template-specific anchor without distortion.

`materials/` and `source/` are build ingredients rather than runtime labels. Run `python scripts/build_tcg_rarity_assets.py` from the repository root to rebuild all forty transparent assets and their preview.
