# Cosplay template

`cosplay-comic-print-v1` reproduces the accepted energetic physical-card composition without baking in a photograph, rarity, name, date, signature, or serial.

The full-resolution photograph, comic frame, halftone title banner, creator identity, rarity label, modular motifs, optional SPR signature, and future finish effects remain independent runtime layers. The title is composed only from the real linked character and gallery names.

The card identifies the cosplay itself, not a generic creator role: the top reads `[FRANCHISE] COSPLAY` (or simply `COSPLAY` when no franchise is stored) and the banner reads `[CREATOR] AS [CHARACTER]`. Each identity appears once. The hero motif supports blossom, star, heart, flame, moon, crown, musical note, paw, and aperture forms. Its selection is deterministically seeded from the real character and series identity and then frozen in `cards.visual_recipe`; it is decoration, not an inferred franchise claim.

Legacy creator×character `variant` records bridge to this visual type. Standalone fictional characters continue to use the Character template.
