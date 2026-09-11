# Character templates

Character cards have two approved rendering paths:

- `pop-art-v1`: primary composition when local subject extraction passes quality checks.
- `full-bleed-v1`: designed fallback when the extracted matte is uncertain or fails.

The renderer selects the path before publication and persists the choice. A published card never changes layouts because a later extraction model behaves differently.

The pop-art background exposes separate palette masks so its yellow, teal, and coral roles can be recolored deterministically for contrast with the extracted character. The physical print texture and off-white separators remain intact.

The full-bleed fallback uses a 70%-transparent lower nameplate fill while keeping its gold rules and ornaments opaque. Its orb housing, selected icon, and future rarity VFX are separate shared layers.

## Mint preparation

`services.character_cards.select_character_source` chooses a deterministic full-resolution still from images explicitly linked to the character or from a character-linked gallery. Exact file-level links rank ahead of inherited gallery links; real favorites, rating, engagement, portrait fit, and resolution break ties. The character avatar is used only when no eligible collection image exists.

`prepare_character_visual` runs outside the pack-opening response, evaluates the cached matte, derives a real palette, and stores the complete immutable recipe in `cards.visual_recipe`. Collection serialization reads that snapshot without rerunning selection or inference. Creator×character intersections are not routed through this template; they belong to the Cosplay card type.
