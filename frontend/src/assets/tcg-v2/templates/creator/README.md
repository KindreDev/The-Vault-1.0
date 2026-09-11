# Creator card template

The Creator card is an editorial full-bleed portrait with a pale archival rail. Photograph, editorial pattern, rail, rarity, text, serial, frame, and optional SPR signature remain separate runtime layers.

Only real creator categories are eligible: cosplayers, e-thots, artists, actresses, and Model/Other entities (persisted under the legacy `custom` database value). Character entities cannot mint this card type. The rail identifies the card as `CREATOR`, followed by its verified subtype and immutable card ID. Creator cards intentionally print no gallery period because they represent the creator rather than a dated appearance.

The vertical rail prints the verified creator name, creator type, optional source period, and card ID. Country/origin appears only when the creator record contains it; otherwise that field is omitted. Gallery name is frozen as source provenance but is not substituted for creator identity. No character or cosplay label is inferred from the photograph.
