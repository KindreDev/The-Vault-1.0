# Changelog

All notable changes to The Vault are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/).
Add a one-line entry under **[Unreleased]** the moment a change is made — don't wait for release.
At release time, rename `[Unreleased]` to the new version + date and start a fresh Unreleased block.

Categories: **Added** (new features) · **Changed** (behaviour/UI changes) · **Fixed** (bug fixes) · **Removed**.

**Only log fixes for bugs that reached a release.** If a bug was introduced by a feature that is still in `[Unreleased]` and fixed before that feature ships, it never existed for any user — don't add a **Fixed** entry for it. The changelog records what changed for the person using the app, not the development history of getting there. A bug counts as user-facing if it exists in a released version (i.e. under a `[x.y.z]` heading), even if that release was recent.

---

## [Unreleased]

### Added
- Added separate permanent Creator, Media, and Gallery Hall of Fame cards for each category and period win.
- Added a conditional Legacy cards toggle to the card collection for databases that contain legacy records.
- Added a one-time local HOF media ladder fixture with image and video cards at every HOF print rarity for renderer testing.
- Added plain-language Hall of Fame award provenance and rarity-matched Metal Signature highlights to HOF image cards, video cards, and GIFs.

### Changed
- Made Collection card tiles transparent behind the card faces and metadata.
- Folder browsing now remembers the last location, supports typed addresses and back/forward navigation, and is used throughout Settings, Loading Bay, creator folder assignment, relocation, relinking, and ZIP export.
- Deferred Collection card-face rendering until cards approach the viewport to reduce first-load and scroll work without changing card visuals.
- Reused deterministic booster validation results during Collection startup instead of repeating identical pack simulations for concurrent requests.
- Collection card faces now mount in smaller batches and keep their loading veil until the main artwork is decoded.
- Collection search now matches card IDs, printed codes and numbers, names, rarity, card type, and content classification.
- Video loop now stays on across videos, viewer screens, and app restarts until you turn it off.
- Changed HOF award wording to name the recipient and state the category and period in natural order.
- Extended HOF's pointer-reactive Metal Signature across every card's metallic frame, lettering, stars, and flowers.
- Increased Silver-and-higher HOF metallic highlights and restored the pointer-following light reflection on Common cards.
- Consolidated Collection Room booster packs and furniture in a responsive Shop with artwork-first product tiles and prices below each item.
- Changed Hall of Fame cards with video-winning sources to play the preserved video inside the HOF face while retaining the existing frame and effects.
- Changed HOF video cards to fill the complete card frame, use short low-resolution looping previews in grids and the Collection Room, and reserve full-video playback for opened card views.
- Changed full-video Hall of Fame foil to keep transparent star-only VFX with pointer-reactive per-speck highlights instead of a flat overlay.
- Unified the transparent, reactive foil composition across preview and opened views for video-backed Hall of Fame cards while preserving their separate media playback.
- Strengthened video-card star foil with clearly visible pointer-shifting rainbow color while keeping the video unobscured.
- Added an experimental rarity-matched Metal Signature treatment to video-backed Hall of Fame cards.
- Extended video HOF Metal Signature highlights to the four metal ribbons and masked rarity letter.
- Kept HOF video card names fixed to their face during Collection Room focus rotation without changing the metal finish.
- Fixed the HOF-061653 Collection Room poster's inherited letterbox bars and reduced full-view video foil to a sparse reactive star layer.
- Fixed the HOF-061653 full-view foil layer so its sparse reactive stars render when the card is picked up.
- Fixed HOF-061653's opened-card foil fallback to use its transparent star texture and kept the special treatment scoped to that card.

### Fixed
- Fixed hover video previews holding files and gallery folders open after the preview ends, so Relocate and folder renaming can proceed; move failures now show their specific errors.
- Fixed Gallery View merge search so it finds matching galleries across the full library.
- Fixed Relocate's Browse button by opening an in-app folder chooser instead of relying on a hidden Windows dialog.
- Fixed Loading Bay new-creator imports silently failing when no destination folder was set; the destination can now be chosen in-app and import errors are shown.
- Fixed the Collection Room rarity dropdown showing blank, unusable options in its native popup menu.
- Fixed Hall of Fame identity text being truncated by the artwork clip during steep Collection Room focus-view rotations.
- Fixed the HOF metal highlight lagging behind card rotation while dragging in the Collection Room focus viewer.
- Fixed pointer-reactive HOF metal highlights staying aligned with the creator name while rotating cards in the Collection Room focus viewer.
- Fixed weekly Hall of Fame cards so their SR print rarity persists through pack pulls and collection display.
- Fixed All-Time Hall of Fame cards to display as SPR while Monthly cards remain UR, with matching frozen recipes.
- Fixed full-video playback in the Collection Room card inspection view by using a reliable DOM video layer beneath the HOF frame effects.
- Added a visible loading and failure state for full-video HOF card views while the browser starts or rejects the source.
- Fixed Collection Room pack opening to consume serialized card payloads correctly, prevent legacy cards from entering pack pools, and suppress the subject outline only for Common cards.
- Fixed Chloe theme readability for low-opacity inline labels in Settings, Help, Stats, and Erika AI.
- Added: Theme packs can choose an Appearance preview image in the private editor, shown for inactive packs with aligned settings cards.
- Changed: Funscript filters stay on one horizontal strip with compact overflow-safe controls, and Device Control supports right-click quick reconnect/disconnect with a timed failure indicator.
- Changed: Chloe-compatible leather interaction states now cover Help, Settings, filter toolbars, and Funscripts controls where the pack texture is used.
- Changed: Chloe-compatible theme-pack buttons now use distinct leather-tinted hover, active, focus, and pressed states without adding new premium texture assets.
- Fixed: Collection Room navigation no longer crashes from a missing localized-text import.
- Changed: Selection highlights remain transparent over thumbnails in Gallery, Image, and Video lists when theme-pack textures are enabled.
- Changed: Funscript output now uses acknowledged device commands, latest-value coalescing, and MFP-matched curve samples for Intiface and The Handy, preventing stale backlogs and coarse fast sections.
- Changed: Funscript playback now uses shape-preserving interpolation on a regular provider-aware clock, keeping fast script sections smooth instead of jumping between raw keyframes.
- Changed: Dashboard duration labels now use the active locale safely without crashing when a time formatter is called without a translator.
- Changed: Video playback now initializes its translation helper before rendering localized player actions and errors.
- Changed: Video funscript stats, axis controls, and sync offset now share the bottom control band so the waveform and video retain more viewing space.

- Fixed: Erika AI chat keeps its header and input inside the viewport when message history or theme artwork changes.
- Changed: File curation now mirrors gallery curation with a reason row, matching run header, and full action footer.
- Changed: Collection Curating now treats automatic gallery covers as valid, keeps the Vault name tied to the folder name, removes gallery tags from curation debt labels, and lets file curation create missing creators while showing each file's disk directory.
- Added: Installed theme packs can bundle an optional local font that appears in Typography settings only while that pack is active.
- Changed: Simplified Chinese now covers the Vault frontend, including Help, gallery and creator workflows, collection, device control, funscripts, companion, and statistics screens.
- Added: Theme packs can set Vault-wide primary, secondary, and muted text colors in the private editor, with leather textures reaching Funscripts and Card Collection.
- Fixed: Chloe filter toolbars now use the private editor's readable warm text colors across Galleries, Photos, Videos, and Creators instead of low-contrast gray.
- Changed: Tiny 10px labels are now readable throughout the Vault, Device Control uses at least 16px text, and Card Collection opens with a more spacious header.

- Added: Delete script playlists directly from the Funscripts sidebar.
- Added: Import, update, select, and remove local character theme packs in Appearance, with responsive page and dialog artwork.
- Added: Installed theme packs can texture panels and controls across the Vault, plus the sidebar, with editable local images and edge color.
- Changed: The private theme editor previews local artwork and textures reliably, uses a native texture picker, and keeps its controls on screen when preview sizes change.
- Changed: Character theme packs now support shared sidebar and heading artwork, Dashboard tools art, and empty-state artwork across pages.
- Changed: The private theme editor can resize, mirror, and rotate each image.
- Changed: Dashboard tile artwork stays anchored while moving or resizing it in the private theme editor.
- Changed: Theme pack artwork supports precise position controls and Z depth in front of or behind Vault content, and Help heading artwork now uses the full top header.
- Removed: The bundled character artwork and palette; character themes are installed from private local packs.

- Fixed: Hall of Fame cards with missing crown artwork now use the winner's live profile avatar or a readable placeholder while retaining the original crown image record.

- Changed: MKV videos with browser-compatible streams now prepare quickly without full re-encoding and show a loading message while preparing.

- Changed: Foundation and September TCG releases now cover Scene, Gallery, Creator, Character, Cosplay, and Collab sources with canonical live-PFP identity cards and frozen portrait editions.
- Changed: Bond and Hall of Fame cards now use the same fixed rarity mapping in every pack path, with their explicit rarity preserved during prelaunch rebuilds.

- Changed: Rebalanced recurring Vault Credit income, quest rewards, and monthly release pack prices with deterministic persona simulation targets.
- Changed: Help & Reference now documents current navigation, Library and Loading Bay workflows, Collection Curating, Stats, TCG V2 releases and economy, Collection Room, settings, and current quest rewards.

### Fixed
- Opening a photo no longer crashes the viewer because of a missing translation helper in the creator panel.
- WD14 sexual classification now recognizes plain ratings and clearly clothed shirt evidence while preserving explicit/suggestive precedence.
- The Vault theme preview now keeps its own violet accent when other palettes are selected.
- Collection Room furniture now keeps all shelf and panel meshes visible from either side, with readable cabinet glass during placement.
- Collection Room placement hitboxes remain raycastable without writing invisible depth over furniture geometry while arranging.
- Collection Room placement wheel hover states now match each radial sector instead of applying one purple overlay across every action.
- Collection Room placement wheel sectors now keep their radial wedge shape on hover, with accurate selection instructions below.
- Collection Room placement wheel base sectors now use the same geometry as their hover states.
- Collection Room placement action labels now sit outside clipped hitboxes so Return and Rotate remain fully readable.
- Collection Room cards now open a clean dark focus stage with active idle foil VFX, unrestricted drag rotation, wide-range zoom, a clean two-sided card back, and Escape or X close while keeping the inventory selection intact without nested tilt clipping.
- Collection Room inventory headers no longer show the stray decorative star.
- Collection Room now labels black/white furniture variants explicitly and turns compact card stands to face the room in both placement and display rendering.
- Collection Room inventory now uses a narrower responsive card grid, a larger selected-card preview, and static non-selected inventory cards.
- Collection Room stand previews now face the room correctly, remain visible in the dark rail, and glass cabinets render without pane shadows or transparency depth artifacts.

- Collection Room inventory now shows loading state/count placeholders instead of a false zero-card flash, and furniture previews use transparent cleaned assets plus real framed Vault-photo poster previews.
- Collection Room inventory now opens sealed booster packs with large frozen card pools without exceeding SQLite query limits.
- Collection Room placement rail now uses larger physical-item previews, supports mouse-wheel horizontal scrolling, and keeps the rail centered instead of expanding off-screen.
- Collection Room Controls is now a readable key/action list, and parcel booster reveals return resolved card payloads directly so opening does not fail during a second detail lookup.
- Collection Room poster previews now retain their assigned Vault image while moving, and placement-wheel hover feedback stays contained inside its action button.
- Fixed Scene card masking so subject and background foil effects stay separated instead of applying an unmasked effect across the whole card.
- Fixed R-card masked foil surfaces by applying each channel mask directly to its foreignObject surface.
- Collection Room placement thumbnails no longer expand over the interface and block clicks, and their rail cards now keep readable names and proportions.
- Collection Room card displays nested inside cabinets now follow their parent shelf when it moves or rotates, while remaining blocked from floor placement.
- Collection Room wall posters now face into the room correctly on every wall instead of rendering edge-on at side-wall corners.
- Collection Room placement now targets the full walkable floor, repairs stale pre-category wall placements, and no longer rejects new furniture because of legacy center-of-room wall items.
- Collection Room placement now validates furniture against the authored apartment’s real wall faces and floor surfaces instead of rectangular room bounds.
- Collection Room placement now clears stale movement input, keeps previews fully visible while intersecting room geometry, and reserves right-click for deselecting instead of selecting furniture.
- Fixed library scans failing on moved or deleted media that still had Vault history or other database references.
- Fixed file-level Collection Curating repeatedly reloading its queue instead of opening a file, and made large dump queues avoid an expensive random database sort.
- Fixed the Glass theme showing its selected background image immediately and across every page.
- Fixed quest completion rewards so the Quests page describes the real V2 booster products and Collection Room can open weekly protection tokens after choosing a published release.
- Fixed WMV and other VLC/FFmpeg-compatible videos not playing in Chromium by adding cached browser-compatible playback.
- Fixed booster pack reveals so mouse and touch swipes reliably advance the top card and expose the card underneath.
- Fixed the Photos/Videos viewer overlay appearing beneath the library filter toolbar.
- Fixed the legacy video-length repair control so it disappears after every video has a known duration.
- Fixed Settings restoring the configured funscript library path and waiting for the replacement backend before reporting a restart complete.
- Fixed the Videos sort menu so Length remains reachable in its own contained scroll area instead of being clipped or scrolling the whole page.
- Fixed video cards so scanned durations are visible in a themed top-right badge, including an honest unavailable marker when a duration is missing.
- Fixed Stats styling so accent surfaces, progress colors, and rarity/type accents follow the active Vault theme.
- Fixed session statistics to use the browser's local timezone for date/hour buckets and to count multi-creator rows as one elapsed session.
- Fixed Session History creator attribution so the "more" link opens the complete creator list and sessions can add or remove credited creators.
- Fixed Session History edits after removing creators so only surviving session rows are updated.
- Fixed the Session History "+N more" creator list so it opens inline instead of being clipped as a tooltip.
- Fixed expanded Session History creator details so the list grows the row and keeps the date and Edit/Delete actions visible.
- Fixed gallery multi-selection actions so context-menu operations apply to every selected file instead of only the right-clicked file.

### Removed

- Removed obsolete card-dismantling achievements and weekly quest, plus the dead tag-challenge spin reward.

### Changed

- Collection Room placement now uses a world-attached contextual action wheel tied to the live furniture preview, with working Place, Return, Rotate, and Deselect actions.
- Collection Room placement now shows transparent furniture thumbnails in the item rail and separates selecting, locking, and committing an item into three explicit stages; Tab opens the mode without selecting anything.
- Monthly TCG V2 releases now scale their base-card target from the published Foundation size, freeze the formula and economy modifier in each manifest, and show the calculation during release review.
- Collection Room furniture now keeps floor-standing shelves free-placeable, wall shelves and posters wall-only, and card stands placeable inside authored shelf levels.
- Card Collection now keeps Legacy cards outside current rarity/type categories and shows a Legacy scope only when legacy cards are owned.
- Reconciled quest and achievement checks with current curation actions, local-time session behavior, and TCG V2 SR/UR/SPR card rarities.
- TCG V2 releases now enforce scaled C/R/SR/UR targets and mint deterministic linked SPR parallels without making SPRs required for base completion.
- TCG V2 release generation now swaps same-rarity candidates to satisfy the creator-diversity guard before publication.
- Foundation now scales C/R/SR/UR and additive SPR supply from the approved release economy, ranks SPRs by personal engagement and resolved creator context, and appends linked SPRs at the six-cum milestone without replacing owned base cards.
- Gallery View now remembers the last selected media sort when navigating between galleries.
- Large gallery views now mount thumbnail tiles in incremental browse batches while preserving full-list search, selection, and viewer navigation.
- Image viewers now remember the filmstrip visibility choice and resize the photo area around a separate thumbnail row.
- Queue strips now stay expanded after hover and drag/drop until manually collapsed with the themed chevron control, while preserving horizontal scroll position.

### Added
- Gallery image context menus now offer Extract to gallery for single files and multi-selections.
- Gallery view now supports sorting media by date modified.
- Dashboard Collection Curating now offers a file-level mode for large mixed dump folders.
- Script-first Funscripts collection with independent script playlists, metrics, compatibility filters, and manual tags.
- Videos now have their own page module and can be sorted by length, with unknown durations kept at the end.
- Session History now lets manual session entries credit selected creators, with searchable creator selection shared by add and edit flows.
- Gallery detail now searches filenames in place, and image/video viewers persist readable per-file notes alongside ten cumulative-hover rating stars.
- Help now documents a temporary `ollama pull --insecure` workaround for Hugging Face redirect errors while keeping the normal model download command as the recommended path.
- ComfyUI images are now identified from embedded workflow metadata during import and automatically receive an `AI generated` provenance tag without running an AI tagger.
- Character creation now searches both AniList and a no-key game-character catalogue, including titles such as Stellar Blade and Resident Evil.
- Creators without a profile picture now automatically choose an existing portrait from their linked Vault media without background folder scanning.
- Missing folders now has a one-click Resolve all action that scans online roots, relinks confidently moved folders, removes genuinely stale records, and protects offline libraries.
- Collection Room now has a persistent I-key/HUD inventory for placing exact owned furniture instances and opening collected parcels or earned booster tokens through the authoritative pack reveal.
- Analytics trend graphics now fill their allocated compact chart space without changing the surrounding layout.
- Analytics now has a page-wide range control with in-place loading, undistorted labeled charts, clear new-versus-rewatched history, distinct personal bests, a balanced timing-and-edges row, and all session summary metrics removed from Overview.
- Long AI-tagging runs can now be paused, survive a Vault restart, and resume from their last committed checkpoint.
- Settings now identifies unavailable gallery folders with safe Relink and Remove controls while protecting offline library roots.
- Collection Room furniture is now purchased into a persistent inventory and manually placed, moved, rotated, returned, undone, and redone without resizing.
- The Collection Room door now opens a persistent weekly visitor scene with authored dialogue, protected card deals, requests, and immutable deal history behind the economy approval gate.
- Visible Collection Room cards now use their authoritative faces, separated masks, rarity-specific WebGL foil, angle-reactive Gallery artwork, and independent protective layers without flat premium fallbacks.
- The optional Collection Room now provides a first-person 3D home for persisted pack ordering, parcel opening, copy placement, binders, cabinets, posters, and display layouts.
- The optional Collection Room asset module now ships a verified 57-asset Blender environment with detailed technology, mailed parcels, lighting, and bedroom decor.
- Weekly trader visits now persist deterministic adult visitors, frozen gated stock and requests, shared valuation audits, reservations, and atomic buy, sell, barter, and transaction ledgers behind simulation approval.
- Collection Room state now persists revision-safe layouts, owned display-item instances, and delayed mailed pack parcels whose cards are granted only after collection, placement, and atomic opening.
- TCG cards now have durable physical-copy identities, normalized binder locations, atomic legacy reconciliation, and explicit ledger audit and repair controls.
- Collection Room now has an optional versioned module manager with resumable downloads, integrity verification, repair, updates, cancellation, and collection-safe uninstall.
- Collection filters now include searchable creator, character, and binder-assignment selectors with inherited source relationships.
- HOF and Bond card records now expose their earned-event ownership policy and canonical event detail in the collection API.
- Binder shelves now paginate after nine binders, and cover customization offers a searchable Vault-photo chooser with direct drag-and-drop replacement.
- All-Time Hall of Fame now records durable champion reigns and mints a distinct SR-or-higher card for each lead transition.
- Favorite tags can now be curated in Tag Manager and contribute a deterministic R or SR floor to half of matching future printings.
- New TCG printings now freeze an auditable personal-value score built from viewing time, duration-normalized video replays, sexual engagement, ratings, favorites, favorite creators, and favorite tags.
- Card Collection now includes a physical binder cabinet with purchasable material covers, custom Vault-photo crops, animated page spreads, card pockets, range selection, and bulk binder placement.
- The Founder's Catalogue now contains twenty compact, memorable sets built from galleries, years, card formats, rarity finishes, and erotic collection themes.
- TCG V2 now has a release-aware collection workspace with frozen Sets, truthful missing slots, full card records, independent Exposure and Sexual Intensity classification, acquisition history, source provenance, Binders, Boosters, Workshop customization, and Advanced Mode controls.
- Release products now use metallic collage booster envelopes that cycle real eligible artwork, disclose guarantees and pool integrity, and support persisted pack openings and targeted weekly protection rewards.
- Missed monthly releases now resume sequentially in the background from oldest to newest, stopping safely on failed validation or Manual Review.
- Hioshi and Narga UR Scene cards now test source-aligned foil surface maps generated from image detail and the existing packed subject masks.
- TCG V2 now publishes a finite 60,000-card Foundation catalogue with stable collector numbers and persisted C/R/SR/UR rarity, scarce qualifying SPR parallels, a real ten-card Permanent Vault Booster, approved V2 faces throughout pack reveals and the collection, and visible placeholders for upcoming release, limited, and weekly-protection packs.
- Starting TCG V2 now safely preserves every previously owned card as an internally marked Legacy card, hides Legacy cards by default behind a conditional collection toggle, and uses neutral placeholder booster artwork until the final pack designs are ready.
- TCG V2 now has one safe card-face adapter that routes real persisted Scene, Character, Cosplay, Collab, Creator, Gallery, Bond, and Hall of Fame contracts into their approved renderers without inventing missing art, metadata, or signatures.
- Every TCG V2 card type now shares one packed-mask contract with independent subject, background, and edge effect surfaces for future rarity-specific foil, while failed masks retain a seamless whole-card fallback; Hall of Fame mementos now use their approved regal-gold frozen renderer on the same system.
- Bond cards are now earned at five real cum logs and evolve through authenticated 15 and 25 milestones, using the accepted pearlescent-hearts design with aligned face-safe corner medallions and independent art, mask, frame, heart, text, signature, count, and future foil layers while leaving unknown legacy crossing dates honestly blank.
- Gallery cards now have a frozen scrapbook-Polaroid renderer that preserves the real gallery, optional assigned creator and period, source photo, palette, rarity, and mint ID as independently effectable layers.
- Gallery cards now fan up to three additional frozen photographs behind the hero print, using only real images from that gallery to make each card read as a complete photoset.
- Creator cards now have a frozen editorial portrait renderer with a vertical archival rail, prominent creator subtype and card ID, eligibility limited to cosplayers, e-thots, artists, actresses, and Model/Other entities, optional real provenance fields, type-specific rarity, serial, and separate future foil/signature layers.
- Collab cards now have a layered physical gold gift-frame renderer and frozen multi-creator recipe that preserves verified participant, gallery, period, source, palette, rarity, and signature data.
- Cosplay cards now have an accepted-style comic-print renderer with frozen creator, character, gallery, period, palette, source, and modular hero-motif data for real creator×character cards.
- Character cards now have a deterministic mint-preparation bridge that prefers explicitly linked full-resolution collection images, safely falls back to the character avatar, and freezes the source, palette, text, and extraction decision into the card record.
- The TCG V2 asset system now includes forty transparent rarity labels: C, R, SR, UR, and SPR rendered in the distinct accepted style of each of the eight card types, with matching masks for coded foil effects.
- Galleries, Photos, and Videos now have a compact tag-filter popover with separate include/exclude groups, All/Any matching, category-aware autocomplete, stable shareable filters, and theme-independent semantic colors.
- Viewer hotkeys can now open the slideshow Keep Going menu, hide Erika's bubble, or enable and disable Erika entirely.
- Loading Bay can now import complete gallery folders into a creator without flattening them, preserving nested folders, sidecars, and the folder-as-gallery structure.
- Loading Bay now has permanent ignore, temporary hide-until-next-scan, explicit permanent deletion, playable video previews, duplicate-only filters, exact/visual match explanations, and bulk duplicate actions.
- Loading Bay duplicate comparisons now show resolution and file size on both sides, plus duration for videos; archive inspection has a visible elapsed-time progress bar.
- Loading Bay gallery cards now open into a paginated file inspector, cycle available covers on hover, and explain when video poster generation failed.
- Loading Bay can now import files and complete galleries without a creator into a configurable Unsorted folder for later in-app relocation.

### Changed
- Sidebar navigation now uses animated collapsible Goon, Social, Collect, and Tools groups; Social sits under Goon and the standalone Device Off/On control is replaced by a live green check indicator on Device Control.
- Funscripts now use EroScripts-style Max Speed/Avg Speed metrics, inline animated tag and playlist controls, tag search/autocomplete, ratings, a reorderable queue, sticky collection columns, and a collapsible edge-tab player.
- Funscript filters and sorting now use animated Vault-native dropdowns with rating sorting, and the queue is wider with readable multi-line titles; misleading universal vibrator badges are removed.
- Funscripts now follow the active Vault theme, support native drag-and-drop queue ordering, use a searchable scrollable playlist picker, and match EroScripts' peak/action speed statistics.
- Funscript accents now follow the selected Vault palette, and every collection metric header plus the sort control supports reversible ascending/descending sorting.
- GalleryView now keeps rapid viewer arrow navigation from triggering image zoom and adds a one-click Reshuffle control for Random sorting.
- Library scans and Loading Bay now ignore hidden/system files and metadata folders by default, with an explicit Scanner setting to include them.
- File-level creator assignment now stays attached to the selected image or video, refreshes GalleryView coverage immediately, and keeps many-creator summaries contained in a scrollable card grid.
- Viewer creator controls now use compact theme-aware labels: `+file` is removed, the action reads `Assign creator`, and clearing uses a compact `Clear` control.
- AI hair and eye colors now require stronger confidence, preserve multiple strong colors for detected collabs, and support per-tag confidence overrides in Tag Manager with the global threshold as fallback.
- Single-creator GalleryView cards now grow to show the creator name before falling back to constrained truncation when space is genuinely limited.
- Dashboard Random Mix, Stats, and Daily Spin overlays now lock the underlying viewport; Daily Spin appears under Tools and becomes unavailable after that day's spin is consumed.
- GalleryView creator summaries now use visual creator cards with real file-coverage counts and percentages, without tag chips or overflow menus.
- Image and video viewers now use 16px minimum readable controls, with existing 16px viewer text promoted to 18px.
- Gallery editing now uses the real folder rename flow, keeps media handles from blocking Windows renames, and updates image and funscript paths immediately.
- GalleryView toolbar controls now share the Filename control's 16px baseline, replaces the gallery cum control with a Send to Playlists action, and keeps folder metadata synchronized after renames.
- The former multi-panel wording is now presented as Playlists throughout the Vault while retaining the legacy route for existing links.
- Gallery selection mode can now add gallery-level tags to every selected gallery.
- Creator edit dialogs now render in a viewport-level portal so the profile page cannot scroll underneath or carry the dialog away during page transitions.
- Gallery, image, and video selection menus now stay above the bulk-action bar, remove the redundant gallery context-menu selection entry, and preserve Shift-click range selection when bulk mode starts from a context menu.
- Gallery, image, video, and creator filter toolbars now use consistent 16px text and rounded controls, including search fields.
- Collection Room now offers explicit High, Medium, and Low graphics budgets for card texture resolution, anisotropy, shadows, and render resolution.
- Collection Room card snapshots now use quality-tier resolutions and release distant foil masks to reduce GPU memory and upload work.
- Purchased booster packs now retain a deterministic set of product-specific artwork snapshots so separate packs do not all display the same face.
- Collection Room now shows every active booster delivery and includes mailed or ready packs in the unopened-pack summary.
- Collection Room poster prints now fill the measured 0.66 × 0.96 m inner frame aperture, preserving source aspect ratio with only the required pure-black matte.
- Collection Room compact stands now render card artwork on the correct display face while preserving the holder's established lean and placement.
- Collection Room crouch control now uses the C key.
- Collection Room compact-stand card artwork now flips on its local horizontal axis while preserving its established placement.
- Collection Room booster piles now use thin flat wrapper geometry resting inside the blue box, with later packs stacked at varied angles.
- Collection Room posters now remove the authored glass pane, preserve source colour, and use matte-black aspect-ratio fill only where needed inside the frame.
- Collection Room booster packs now preserve a purchased artwork snapshot on the physical sealed pack.
- Collection Room compact stands now render the card face reliably in the authored holder.
- Collection Room targeting now uses the visible mesh reticle, with recessed posters, correctly positioned card stands, and reliable card interaction prompts.
- Collection Room booster deliveries now display the real Vault wrapper artwork in the blue box and use booster-pack language throughout the player-facing UI.
- Collection Room card inventory details now expose richer card metadata and inspection information.
- Collection Room movement now supports vertical lift and crouch controls, with card inspection locking movement while allowing hover-effect rotation.
- Collection Room card stands now keep card bottoms visible and correctly face their displayed cards, while posters stay inside their frames with preserved aspect ratios and premium black letterboxing.
- Collection Room deliveries and the blue box are now booster-pack-only; furniture purchases go directly to Furniture Inventory for placement.
- Collection Room inventory and furniture shop cleanup removes the summary tagline, collapses duplicate furniture products, and gives furniture previews more room.
- Collection Room furniture previews now use a seamless dark studio background with subtle grounding shadows and accessible loading failures.
- Collection Room Booster Packs now show each delivered product's real wrapper artwork and remove the furniture strip from the pack browser.
- Collection Room display previews now keep cards framed cleanly on their authored stands.
- Collection Room inventory now uses a consistent dark-glass cards, packs, and furniture workspace with clearer owned-item previews and inspection actions.
- Creator, gallery, photo, video, and gallery-detail toolbars now keep controls in the same row at a consistent height.
- Booster reveals now advance only by physically dragging the top card left or right, with no substitute direction buttons.
- Help now documents the current C/R/SR/UR/SPR card system, expanded Hall of Fame, Recap, Stats and Analytics views, and the Playlists experience, with a proper trading-cards icon for Cards.
- Collection Room computer hardware now rests on the authored desk surface, shows a lightweight Vault OS screen, and keeps physical cards stable while room state refreshes.
- Collection Room computer tabs now share a persisted dark/light theme, and the furniture shop presents a distinct recognizable preview for every real catalogue asset.
- Collection Room furniture shop controls now keep wallet, filters, summaries, and finish selection aligned and readable across desktop and narrow layouts.
- Analytics chart axis titles now stay clear of the vertical tick labels, including longer metric names.
- Analytics compact trend charts are now taller so percentage axis labels have comfortable separation.
- AI tagging now streams media in bounded chunks, prefetches original-file decoding, batches GPU inference, and extracts video samples in one FFmpeg process.
- The Collection Room is now a bright 12-by-12-metre home with a sparse permanent layout, aligned windows, a usable kitchen, clear routes, distinct materials, corrected computer and store surfaces, crisp binders, safe menu exits, and inspection-only live foil.
- Binder-assignment filtering now supports an explicit Unassigned option alongside current binders.
- Binder cover selection now searches and paginates through the entire owned-card collection instead of stopping after the first 250 cards.
- Release and set browsers now use player-facing publication wording with taller set previews and larger multi-photo release detail previews.
- Binder customization now lives on each owned binder, while new binders are purchased from Shop with Vault Credits and displayed directly inside the physical shelf bays.
- Card Collection now opens to All Cards and uses rounded Vault-native navigation, identifiable missing slots, animated card inspection, physical page-turning binders, streamlined floating booster products, and viewport-locked pack reveals.
- Published release boosters now identify their release pools clearly and become purchasable after automatic validation instead of exposing simulation approval jargon.
- Booster openings now use a correctly sized split wrapper, full-size rapid card extraction, click-to-turn face-up pile, persistent-stack swipe reveals, rarity-ordered pulls, skip-to-grid, and multi-pack progression.
- Strong personal engagement now protects future printings from Common and can force SR or UR rarity, while exceptional eligible sources can receive linked SPR signature printings without changing pack odds.
- Card Collection now follows the active Vault appearance, uses a compact Vault-native navigation bar, folds creator, character, Hall of Fame, Bond, missing, and duplicate browsing into All Cards, and presents releases and boosters as large visual products.
- Booster pack availability now distinguishes unscheduled limited products and weekly quest rewards, while drag-to-tear controls remain interactive during opening.
- Monthly release generation now batches evidence across large catalogs and deterministically satisfies the 50 UR / 120 SR release floors without changing any card's published rarity.
- TCG V2 published rarity is immutable: legacy card leveling, rarity evolution, Prestige, and card crafting are retired in favor of duplicate-derived Shards and physical collection customization.
- R, SR, SPR, and UR rarity artwork now behaves as escalating emissive material with breathing inner cores, expanding bloom, luminance pulses, and restrained white shimmer instead of passive hue-cycling gradients.
- Gallery SR and SPR cards now reveal alternate photos by viewing angle; R uses the separated Cosmos textures without tinting the source photo, SR backgrounds layer fixed Cosmos and Glitter over a densely repeating tilt-reactive metal surface without touching subjects, and animated GIF sources remain unmasked.
- R, SPR, and UR rarity artwork now cycles through independent side-to-side color and brightness sweeps; Gallery UR photographs retain only the clean rainbow finish while SPR frame assets gain a separate light-reactive paper grain.
- The revised source-aligned UR finish now applies automatically to every reliably masked non-Gallery UR; Gallery URs remain reserved for their separate multi-photo treatment.
- SPR backgrounds now follow the complete VMAX interference stack, staying restrained at rest and blooming through both texture passes as the card tilts.
- UR Full-Art cards retain their exclusion shimmer without the former rectangular boundary, and R-or-higher rarity letters keep a permanent animated rainbow finish.
- UR radial lighting now remains full-card sized while tracking the cursor, eliminating its translated tile edge without dropping any foil pass; rarity-letter rainbows are clearer at rest.
- UR Full-Art gradients now move on bounded, non-tiling surfaces, deliver stronger chroma through a clearer overlay, use seamless card-spanning light falloff, and reveal a finely repeated, light-reactive physical texture behind the subject.
- R, SR, SPR, and UR rarity letters now carry an always-moving, tilt-reactive alpha-clipped rainbow shine across every card type; UR Gallery cards reveal two additional real photos by viewing angle, and Scene signatures sit in the open lower-art area.
- SPR signatures are larger and their finer repeating texture is slightly softer; UR backgrounds now use the reference Full-Art gradient hierarchy with the dedicated metal texture and improved art visibility.
- All-Time Hall of Fame finishes now preserve the source photo's original contrast and color while retaining their opaline material treatment.
- TCG V2 cards now use cursor-reactive physical finishes: reference-tuned Cosmos R with a maskless fallback, tilt-weighted layer-separated SR with base-light-only subjects, balanced masked SPR texture, slower translucent UR foil, independently reactive full-alpha frame and rarity artwork, source-matched Scene outlines, mandatory handwritten neon SPR signatures on existing cards, and a smaller Gallery hero print that reveals its photo stack.
- Legacy Standard and Premium generators can no longer service the TCG V2 shop; earned old pack tokens convert to Permanent Vault Boosters while unpublished release packs remain unavailable instead of minting old cards.
- The former Goon card domain is now Bond everywhere—storage type, recipes, milestones, IDs, filters, showcase slots, UI, tests, and documentation—with existing owned cards migrated automatically without losing progress.
- Hall of Fame cards now preserve one approved layout while their real winning period determines the physical honor treatment: one-star bronze Daily, two-star silver Weekly, three-star gold Monthly, and four-star opaline All-Time.
- Hall of Fame cards now feature a dedicated honor plaque and larger, clearer period and card-code lettering.
- Collab cards now reserve their lowered top heading for verified assigned characters, omit it when none exist, and keep gallery names out of that field.
- Cosplay cards now identify the cosplay itself: the franchise owns the top label and the banner names the creator-character pairing once, without the redundant generic creator role.
- Character cards now reserve the pop-art cutout for stable, compact, well-framed subjects and preserve small, hazy, irregular, or unstable silhouettes with the full-bleed fallback.
- Character cards now use a palette-matched pop-art cutout when extraction is reliable and the approved full-bleed layout when it is not, with independent future foil hooks for the background, subject, frame, rarity, signature, and orb.
- Scene cards now have a production-ready composer with readable live mint data, accepted type-specific rarity typography, separate foil/signature layers, hybrid subject extraction for reliable two-color outlines, and an automatic full-card fallback that keeps failed masks mintable.
- The new TCG character template now uses a properly scaled modular orb whose housing, icon, glass, and foil surfaces remain independent, with nine consistently sized icon choices.
- Slideshow and multi-panel fullscreen controls now hide while idle and return on mouse movement, with a larger video-labelled funscript sync control.
- Dashboard favorites, discovery, and recently added rows now fill their available width with as many cards as fit without crossing into the sidebar.
- **Card classes are now C / R / SR / SPR / UR** — five bands instead of four. SSR is renamed **SPR**, and a new **C** band sits below R, so the bottom of a tier reads as common rather than every card being at least Rare. Classes are still ranked within each tier, so a Core-UR remains its own chase. Existing cards are re-scored automatically.
- Loading Bay now fully follows appearance palettes, including dedicated frosted shells, cards, backdrops, and comparison modals for the Glass theme.
- Loading Bay duplicate previews use a clearly labelled, full-size side-by-side comparison again, and video previews now stay contained below the modal header.
- Loading Bay results are now filtered, sorted, and paginated by the server with infinite scrolling, so every pending file and gallery remains reachable instead of stopping at 500.

### Fixed
- Creator profile avatar lightboxes now portal to the viewport and keep the underlying page locked while open.
- Factory reset now removes the complete collection database and thumbnail cache, waits for the old process to release the server port, and reconnects only after a genuinely new backend instance is online.
- Gallery title renaming no longer fires a false failure after a successful Enter-and-blur submission.
- Gallery merges now reconcile files already present in the target folder, retire the stale source gallery, and report the reconciliation instead of leaving the database incomplete.
- Gallery merges now move each file exactly once, retire replaced database rows, preserve video funscript links, and keep skipped or missing files in their source gallery instead of creating filesystem/database mismatches.
- Collection Room wall-mounted posters and furniture now accept ray hits on the authored interior wall envelope, including the PC area, while retaining wall-attachment and footprint checks.
- Booster Packs inventory previews now honor each sealed pack's frozen purchase-time artwork instead of reusing one shared collage.
- The gallery zip-export (and Relocate custom-destination) folder picker now opens on top of other windows instead of appearing behind them.
- Disk-backed gallery and media deletion now handles transient file locks, clears every dependent history/card/playlist link, and processes bulk video removal as one visible operation instead of silently failing.
- Bulk tag dropdowns now layer above gallery and media cards, so suggestions remain usable at the edges of dense grids.
- Gallery, photo, video, and creator sorting now matches the surrounding toolbar controls and follows the active Vault theme.
- Character import now uses the reliable public AniList character catalogue instead of the repeatedly unavailable Jikan/MAL path.
- Creator body measurements now use the simple `91-61-91` example without extra explanatory wording.
- Country flags now cover every selectable country, including Latvia.
- Creator and other modal overlays now lock background scrolling and restore it cleanly when they close; card inspectors now cover the full viewport.
- Emergency Stop now halts each Intiface device's outputs without dropping its connection, so playback can restart immediately.
- Deleted folders no longer leave browsable broken galleries, while manually renamed folders are relinked without losing gallery or image metadata.
- Collection Room now opens with clean interior framing, safe streamed-asset disposal across quality changes, authoritative physical-copy binder filing, PC-only purchases, and visible carried and placed parcel states.
- HOF and Bond cards are excluded from every release and booster eligibility pool, including weekly protection, and cannot be dismantled through any card endpoint.
- Daily and weekly quest completion now awards current V2 pack tokens without changing legacy standard or premium pack counters.
- Booster reveals now prepare one mask-ready face synchronously across release and Permanent products, retry failed inference on a clean CPU session, and expose readiness errors instead of publishing silent flat static foils.
- Binder customization now opens independently from the binder cover instead of opening the binder.
- Binder and release browsing now keep page navigation stable, align binders to cabinet bays, and remove redundant preview labels.
- Booster reveals now prepare source-aligned foil maps for usable non-gallery UR cards while preserving Gallery UR texture behavior.

- Booster purchases now show themed indeterminate preparation feedback while foil masks are built, and pack wrappers use transparent cutouts without opaque canvas residue.
- Booster pack products and the opening reveal are now larger and card-proportioned, with a smooth wrapper fade after extraction.
- Booster reveals now prepare and serialize subject masks before displaying foil cards, pack probabilities use a readable disclosure instead of raw JSON, and card audits provide a direct return to card details.

- R cards now preserve the source photo's color and contrast under a localized neutral plastic reflection instead of flooding the full card with tinted glare.
- UR foil-map prototypes now keep subjects clear with only a faint physical response, a subtle foreground lift, and softened moving gradient boundaries.
- UR card foil now preserves the direct Pokemon V Full-Art behavior while compositing it translucently over the source image and using its texture as a cursor-lit physical specular map.
- SR, SPR, and UR rarity badges now retain their original full-color artwork under a clearly reactive alpha-clipped foil sweep instead of bleaching most letters white.
- Generated SPR signatures now use the locally bundled Mr De Haviland script with their existing palette-matched neon foil treatment.
- Restored mask-separated UR and SPR card finishes and made cached mask files read-only during card viewing, preventing dev and installed builds from silently rewriting shared masks.
- Prevented legacy rarity maintenance from scanning the full media library and stalling application startup.
- The development launcher now waits for the backend health check before starting Vite, preventing slow database startup from becoming a wall of misleading proxy errors and stopping cleanly when the backend genuinely fails.
- Video volume now stays at the last chosen level across every video player until it is changed again.
- Video period choices now respect the Funscript-only filter instead of counting unscripted videos.
- Pack opening now covers the whole screen instead of being trapped inside the page area, so cards are no longer cut off with the shop showing through underneath.
- Loading Bay keeps files visible and reports the exact error when permanent deletion fails instead of silently dropping the entry.
- Loading Bay now repairs legacy duplicate evidence instead of showing `None/64`, always loads the original Vault thumbnail in comparisons, keeps the matched original visible in regular previews, and gives video previews an explicit Back to Loading Bay control.

### Removed
- The redundant display-name rename action was removed; gallery renaming now consistently means renaming the folder on disk.
- Obsolete Legacy cards and their owned copies were removed while current Vault TCG cards remain intact.

## [1.8.0] - 2026-08-13

### Added
- **Collection Curating** — a new Curate button that resurfaces one gallery at a time and asks you to fix it. Rename the folder on disk, assign missing creators, tag it, rate it, set a cover, mark it a favourite, record its period and price, or delete it — then Save & next, forever. There is no session limit; a five-hour sitting is the point. Galleries you curate drop out of rotation for three months, and "Not now" snoozes one for a fortnight instead.
- The run doesn't pick at random — it ranks by how broken a gallery's curation actually is, so no creator, no tags, a scraper-hash folder name, never opened and unrated all float to the top, weighted by how long ago the gallery was imported. Every gallery tells you why it was pulled up.
- **Roughly four in ten galleries come from creators you love**, rotated so the one creator with a thousand messy galleries can't monopolise the run. "Beloved" is not just the favourite star — it blends how much you actually use her (the same engagement score the Hall of Fame ranks by), the rating you gave her, and the star, so the creators you clearly adore but never got round to starring are in the rotation too. Each shows her own curated/total progress bar and why she qualified, and one click puts the run in Focus on her until you clear it.
- Creators can be **created from inside the run** — search a name that doesn't exist, pick a type, and she's made and assigned without leaving the gallery.
- **Files that don't belong can be dealt with without leaving the run.** Ctrl-click (or the corner checkbox) selects files in the gallery you're curating, then move them into another gallery, split them off into a new gallery of their own, or delete them. Moving and splitting shift the files on disk, and a video's funscript travels with it. Galleries larger than 300 files load a first page for speed, with a **Load all** button so a misfiled file deep in a big set is still reachable.
- Preview cards in the run are large by default (about 440px, nine times the area of a gallery-grid tile), with S/M/L sizing that's remembered between runs.
- **Erika's chat bubble can be dragged anywhere on screen** and stays where you put it. It used to be pinned to the bottom-right corner, where it sat on top of whatever was underneath. The chat window opens from whichever corner she's parked nearest, so it never opens off-screen, and she's pulled back into view if the window shrinks.
- Deleting from the run is two-step: the first click names the gallery, its file count and its full path on disk, and only the second click destroys anything.
- Closing a run mid-edit asks whether to keep your changes, and either way pins that gallery — reopening Curate puts you straight back on it.
- Curation has its own streak, XP that scales with how much you actually fixed, and two new quests (Curator's eye, Deep clean). The dashboard shows how many galleries are still waiting.

- **Hall of Fame crowns.** Topping a day, week or month now permanently crowns that creator and mints her a card for it — epic for a day, legendary for a week, celestial for a month. A crown is tied to the date it was won, so it can never be re-won, duplicated or farmed, and the card carries the file she actually won on. Because one quiet day is enough to take one, creators who would never crack the all-time top five can finally earn a card: of the 53 crowns backfilled across your history, 14 went to creators outside it.
- Every creator's stats now open with an **Honours** board — every period she has topped, when, how large a field she beat, and the score that took it. Ranked lists carry a crown badge with her career total.
- **Relocate** — the single way to move anything. Right-click any gallery, photo or video and move it somewhere else on the drive. If a gallery is filed outside its main creator's folder the modal says so and offers to move it home; you can also pick any other creator's folder or browse to a custom path. Galleries move as whole folders and stay one gallery; loose files land inside a gallery you choose, and a video's funscript travels with it. Nothing moves until you check the destination first — the check reports the exact target path for every folder and flags names that already exist, and a clash has to be answered (keep both / merge / leave it) before the move unlocks.
- **Subgalleries** — a gallery that contains other galleries now shows them in a retractable Subgalleries section, collapsed by default. It expands one level at a time, so a deeply nested set opens as fast as a shallow one, and galleries with nothing inside don't show the section at all.
- **Scripted only** filter on the Videos tab — show just the videos that have a funscript.
- **Shuffle** in the video player: plays through the current view in random order, drawing only from what's actually on screen. Combined with the funscript filter it gives you a shuffled scripted-video session that never wanders outside the list.
- **Recap** — a new page that reads your own behaviour back to you as a paced, full-screen story rather than a dashboard. Pick any window (today, week, month, year, all time) and play it: what you actually did, the hour of the day you belong to, your week's rhythm and longest streak, a countdown of your top five with #1 crowned, how much of your attention went to just three of them, who was new, the single file that took the most punishment, and the type it all adds up to — one of sixteen, from four axes of how you use the place. Most numbers carry a comparison against the window before.
- **Hall of Fame now has Today / This week / This month / All time.** A slider in the page header switches the whole board — creators, photos and videos, and galleries all re-rank to the window you pick, and the page reopens on whichever one you last looked at. Each period crowns its own #1, and the collage behind the page changes with her, so this week's queen owns the page for the week.
- Engagement is now recorded with a timestamp as it happens — views, watch time, cum taps and edges. The lifetime counters only ever knew totals, so the periodic boards start from today and fill in as you use the app; a window that opened before tracking began says so rather than passing off part of a month as the whole month.
- **Stats → The Almanac** — a new tab alongside the existing Overview, covering the long view instead of the last few weeks. Your collecting years reconstructed from gallery periods (galleries per year, files per set, roster size, new vs returning creators), auto-detected phases of the collection, how you actually use it (photo vs video attention, dwell time, session length distribution, how concentrated your attention is), curation health, and a written read that is computed from your own numbers rather than hand-written, so it re-reads itself as your habits change.
- Every Almanac panel is labelled with which era it draws on — collection history goes back six years, usage history only as far as the app itself. Mixing the two is exactly how you end up believing you have only ever looked at 2% of your library.
- Real on-disk file dates are now recorded for every file (435,842 backfilled), giving an independent check on the collecting timeline.
- Stats: each "Top creators" chart now has a **See all creators** button opening the full ranked list — infinite scrolling, every creator's views, orgasms, edges, sessions, watch time and seconds-per-photo on one row, and clicking any of them opens her full stats.
- **Session History is now editable** — every entry has Edit and Delete. Correct a duration or a timestamp that came out wrong, or remove a session that shouldn't be there. Deleting takes the whole entry, including the extra rows a multi-panel session writes.
- **Add session** button in Session History, for sessions the app never saw — logged away from the computer, or the start button was never pressed. Manual entries earn no XP.
- **Assign creator** is now in the right-click menu on the Photos and Videos tabs, not just inside a gallery.
- **Card Collection: filter by scarcity class** — R, SR, SSR and UR, the badge on the card face. It sits alongside the existing tier filter and stacks with it, so "Core cards that are UR" is one selection. Like the other filters it lives in the URL, so a filtered view survives navigating away and back.
- **Card Collection: search** — find a card by creator, character or gallery name. Searching a creator's name returns everything of hers, including the gallery and photo cards that carry no direct link to her.
- **Card Collection: filter by creator** — lists only creators you actually own cards of, each with its card count, and is searchable for when that list is still long.
- **Card Collection: tier and class are now one-click chips** instead of dropdowns, so the current filter is visible without opening anything.
- **Settings → Session** — a new tab controlling what happens when a session ends. Ending one still counts a climax against everything on screen by default, but you can now have it ask each time, or never count one at all and mark them yourself. Asking lets you back out and keep the session running.
- **Log an edge by hand** — an Edge button in the viewer alongside the cum counter, and a "Log an edge" hotkey (Ctrl+Shift+E). Edges previously only came from Edge Mode cutting the device out, so without a device the edge counter could never move.
- **The arrow keys are now yours to set.** Settings → Hotkeys asks the question directly — should left/right scrub the video, or jump between files? — and swaps both pairs in one click, with the losing pair moving to Shift + arrows so nothing becomes unreachable. Ctrl + arrows are a longer jump, and how far a seek actually moves is a number you set (3s and 10s by default).
- **Rate anything with the number keys.** 1–9 for one to nine stars, 0 for ten, backtick to clear — in every viewer and on the panel wall, where it rates the pinned panel. Each key is individually rebindable.
- **Click a panel to pin it.** The pinned panel wears an accent ring and is what every viewer key acts on, so ratings, seeking and navigation land where you meant them to rather than wherever the mouse happens to be.
- **Whole-wall keys** for the multi-panel viewer: advance, rewind, shuffle or pause every panel at once, cycle the focus ring, hand the device to the next panel, and add or remove a panel — the entire screen turns over without touching the mouse.
- **Device control from the keyboard** — intensity up/down, shift the stroke window toward the tip or the base, cycle patterns, and toggle Ramp mode, all without leaving what you're watching. Previously only stop, Edge Mode, Goon Mode and Finisher had keys, so changing speed mid-session meant reaching for the mouse.
- **~30 new viewer shortcuts**: fullscreen, favourite, zoom in/out/reset, hide the info sidebar, jump somewhere random, slideshow faster/slower, and a full video transport — playback speed, restart, mute, loop, volume, and funscript sync. All rebindable, all working the same way in the gallery viewer, the Photos/Videos viewer, the playlist lightbox and the panel wall.
- **Log a session entry** and **log cum again on the last one** as hotkeys — the repeat key credits the file your last orgasm went to, even if the slideshow has already moved on.
- **Help → Hotkeys** — the full list with your current bindings, generated from the same registry Settings uses, so it can never fall out of date.

### Changed
- **Stats → The Almanac is now Stats → History**, and its written read uses plain headlines — "Most of your time goes to a few creators" rather than "You collect widely and goon narrowly". Every number, comparison and finding is unchanged.
- **Themes now apply everywhere.** Large parts of the app had the default violet baked in, so switching palette recoloured some things and left others behind — the Stats tab rendered as a violet button with a green outline. 1,833 hardcoded colours across 70 files now follow whichever palette you pick, on every page. Card rarity, tag category and device-status colours stay fixed on purpose: those tell you *what something is*, so they shouldn't shift with the theme.
- The multi-panel queue cap is now effectively gone (25,000, up from 999), so a whole collection can be sent to the viewer. Adding many galleries at once is also one request instead of one per gallery, so bulk-adding no longer crawls.
- The slideshow controls are now identical wherever they appear — the gallery view and the Photos/Videos tabs shared none of their code and had drifted apart.
- The slideshow interval picker hides itself while a video or GIF is playing, since the timer isn't what's driving playback then. It comes back for stills.
- Assigning a creator across a multi-file selection is now a single request instead of one per file, so a large selection applies immediately instead of hanging.
- Assigning a creator now updates the grid and viewer instantly instead of reloading the whole page of files behind it — the wait after picking a creator is gone.
- Deleting or editing a session never takes XP back — the XP it earned stays banked, and lifetime cum and edge counts are untouched.

### Fixed
- **"Move to gallery" was destroying files' history, and has been replaced by Relocate.** It only rewrote which gallery a file belonged to — the file itself never left its folder. On the next scan the mismatched row was pruned (the file disappeared from the app entirely) and the scan after that re-imported it into its *original* gallery as a brand-new file, with its rating, cum count, view count, favourite and every tag reset to zero. Every entry point for it is gone: the right-click item, the bulk-selection button, and the "Move to…" panel in the viewer, all of which now open Relocate, which moves the file for real and keeps its whole history. Copy to gallery is unaffected.

- **The Vault now runs from a fresh clone of the source.** Some local-only modules are deliberately kept out of the repo, but the rest of the app imported them directly, so cloning and running from source failed on missing modules until the references were removed by hand. Those imports are now optional — the app starts normally without them.
- **A session left running no longer swallows the time the app was closed.** Closing The Vault mid-session and reopening it days later counted the entire gap as one enormous session. The app now checks in while a session runs, and on launch offers to log the session with the time it actually ran, with the duration editable before you accept it — or discard it entirely.
- **Vibrators no longer keep going after you stop.** Stopping the device, leaving Freestyle, or pausing a funscripted video only stopped sending commands, which holds a stroker in position (correct) but leaves a vibrator buzzing at its last intensity indefinitely. Non-linear devices are now explicitly told to stop; strokers still hold position, and scrubbing a video doesn't interrupt playback.
- **Assigning a creator to an open file failed with "Failed: [object Object]"** from the Photos and Videos tabs — the request was sent without the file's ID and the creator was never assigned. Failures also report what actually went wrong instead of "[object Object]".
- Assigning a creator from the right-click menu showed a "Failed to assign creator" error even though it had worked, and the file kept showing its old creators until the page was refreshed. Both came from the same fault, which also meant the grid was never told to update.
- Gallery view: shift-click range selection didn't work after entering select mode by right-clicking a photo and choosing "Select" — that path selected the photo but never set the range anchor, so the next shift-click just toggled a single file (you had to shift-click once to "prime" it). The anchor is now seeded there, and shift-click also falls back to the nearest already-selected file, so a range works no matter how the selection started. Shift-clicking no longer drags a blue text selection across the grid either.
- Move/Copy to gallery: searching for a destination gallery only looked at the first 2,000 galleries. On a large library that window never even reached the letter "A", so searching "Vampirella" returned nothing useful (only "12 Vampire HQ…", which sorts under "1"). The search now runs server-side across every gallery.
- Slideshows no longer cut videos off partway. In the main viewer the slide timer ran on a fixed interval regardless of what was on screen, so a video was skipped after a few seconds instead of playing out; it now advances when the video actually ends.
- Animated GIFs are held for at least one full loop in slideshows, in both the main viewer and multi-panel, instead of being cut mid-animation.
- Large GIFs no longer sit as a blurred thumbnail for several seconds. The full image was hidden until the entire file had downloaded, which suppressed the progressive rendering browsers do for GIFs — they now draw as they load. Neighbouring images are also preloaded so stepping through is instant.

### Removed
- **Daily Tagging** — superseded by Collection Curating, which covers tagging alongside everything else a gallery needs in one pass.
- The **Random Gallery** tile on the dashboard, replaced in place by the Collection Curating tile. Random galleries are still one click away under Discover.

## [1.7.2] - 2026-08-03

### Added
- **Edge Mode** — replaces Edging Assist. Arm it and the device cuts out, or slows to a set percentage, at random or fixed intervals, holds for a random or fixed stretch, then eases back. Works in Freestyle and during funscript playback, including on The Handy.
- Edge Mode can be armed from the device panel in any viewer, with a live countdown to the next edge, or by hotkey.
- **Edge counter** — every edge adds +1 to each image on screen (all of them in the multi-panel viewer) plus its gallery, and earns XP. Lifetime counts, shown alongside the cum counter.
- **Hotkeys** — new Settings → Hotkeys section for rebinding global shortcuts: start/stop session, emergency stop device, toggle Edge Mode, toggle Goon Mode, trigger Finisher, and log cum on the current image.
- **End-of-slideshow screen** — instead of looping forever, a slideshow now lands on six big tiles: more from this creator, random gallery, more like this, your favourites, save as playlist, watch again. Each is selectable with number keys 1–6, with a countdown that picks for you so a session stays hands-free. Whatever you pick loads into the viewer you are already in and keeps playing.
- **"More like this"** matches on the tags that actually characterise what you watched — rare tags count for more than ubiquitous ones — and relaxes its requirements until it finds something, so it never dead-ends.
- **Hall of Fame is now a league table** — creators, galleries and photos show a green or red arrow with how many places they have moved. A movement stays visible until the next one.
- **"See all"** at the end of each Hall of Fame section opens the complete ranking as an infinite-scrolling list; clicking a creator opens her full stats.
- Stats page: lifetime edge total, edges per O, and a "Top creators · edges" chart.
- Creator stats: edge total, edges per hour, edges per O, share of all your edges, a "Most-edged shot" standout, seconds-per-photo, the attention multiplier applied to her ranking, her Hall of Fame score, and how many Os or hours it would take to reach #1.
- Creator stats: "Time on videos" — how long you have actually spent watching a creator's videos.
- Settings → Scanner: "Read video lengths" fills in the length of videos imported before The Vault started recording it. Runs in the background, cancellable and resumable.
- **Gallery stats and photo stats modals** — the same treatment creators got, one level down. Click any gallery or file in the Hall of Fame for its rank, Os per hour, seconds per photo, share of your total time and Os, standouts (most-gooned, most-edged, most-viewed, longest watched), curation and tag breakdown. A file also shows where it ranks in the whole vault *and* inside its own gallery, its share of that gallery's Os and time, os-per-view, and for videos how many times over you have watched its full length.
- Hall of Fame "see all" lists now show a square preview for every row — photo, gallery cover or creator avatar — so a filename like `04.jpg` is no longer the only thing to go on.
- **Clear all creators** in the Galleries and Photos selection toolbars — strips every creator from the selection in one go. Removing creators previously meant naming each one, or visiting each creator's page, which was unworkable when a batch had several different creators on it.

### Changed
- Creators, Card Collection: filters (search, type, rarity, sort, franchise, favorites) now live in the URL — shareable, bookmarkable, and preserved on back-navigation, matching Galleries/Photos. Added active-filter chips with one-click clear, a "Reset" button, a Favorites toggle on Creators, and real page-count pagination instead of guessing whether more pages exist.
- Hall of Fame: creator cards now show watch time alongside views/orgasms, since watch time and session count are the biggest (and previously invisible) factors in ranking — a creator ranking above others with far higher visible stats now makes sense at a glance. Updated the section description to describe the real ranking formula.
- Creator profile: added a "Views" stat to the main stat row — a true lifetime view count, not an average.
- Hall of Fame ranking now counts individual photo and video views, weighted at one fifth of a gallery open. They accumulate far faster, so a heavier weight would let idle scrolling outrank real attention.
- Hall of Fame ranking now also factors in attention per photo — how long you linger on one of a creator's photos relative to the library median. Everything else in the score measures volume and favours big collections; this asks whether you actually stop and look. Capped between ×0.75 and ×1.5, and creators with fewer than 20 photo views stay neutral so a small sample cannot fluke a high rank.
- Gallery and photo Hall of Fame now count edges — 60 points for a gallery (half an O, matching creator scoring) and 250 for a photo.
- The slideshow now crossfades between photos instead of cutting, and its button is labelled "Slideshow" rather than "Play".
- The Finisher hotkey moved from the Device Control page into Settings → Hotkeys with the rest of them; your existing binding carries over.

### Fixed
- Creators: sorting by "Most Photos" or "Most Cummed" was silently broken — it summed counts through a legacy per-gallery field most galleries no longer use, so results were effectively unsorted. Now sorts correctly by actual photo/cum totals.
- Card Collection: filtering by "Core" rarity always returned zero cards — the filter sent the display label instead of the real rarity value the database uses. Fixed; Core-tier cards now show up correctly.
- **Finishing a session now counts an orgasm, anywhere in the app.** Ending a session recorded a session log and XP but never incremented a single cum counter — that was never implemented on the server, so no page could ever have worked. The orgasm is now credited to whatever is on screen when you stop.
- On a multi-panel or playlist layout, an orgasm is credited to every open photo **and the previous shot on each panel** — the one before is usually what pushed you over, the one on screen just finished it. It still counts once toward your lifetime total and XP, so panel count can't inflate it.
- Playlists view had no session controls at all — starting or finishing a session there recorded nothing. It now has a Start/Stop Session button like every other viewer.
- The start/stop session hotkey ended the session locally without telling the server, so nothing was logged and no orgasm counted.
- Quests: completing all your dailies but not clicking Claim before the day rolled over silently destroyed the reward — the board kept showing "Ready!" and claiming then failed with "Could not claim reward". An earned bonus now waits until you actually claim it.
- Quests: a failed claim now says why, and refreshes the board instead of leaving a stale "Ready!" button.
- Hall of Fame: the view count on creator cards only counted gallery opens, ignoring every photo and video view — so a creator with thousands of image views showed a number in the dozens. It is now a true total of gallery opens plus all photo and video views (e.g. 160 → 3,447).
- Creator stats: "Total views" counted photo and video views only, silently excluding gallery opens, and so disagreed with the Hall of Fame figure for the same creator. Both now show the same true total, with a breakdown underneath. "Views / gallery" is derived from the corrected total.
- A creator could be #2 in the Hall of Fame but "#4 of 268" in her own stats — the stats endpoint carried a stale second copy of the ranking formula that never received recent changes. Both now use one shared scoring service.
- Creator stats: "Video runtime" showed a nonsense total (1 minute across 706 videos). Video length is only read when a file is first scanned, and that was added long after most libraries were imported, so almost no video had one — and a rescan could not fix it because known files are skipped. Runtime now shows "—" with a "length known for X/Y" note until the new backfill has run, instead of presenting a fraction as the total.
- Photo view time under 2 seconds was never recorded while the view itself counted from 1 second, so quick glances banked a view worth zero seconds and dragged every average-time figure down. Both thresholds now match.

## [1.7.0] - 2026-07-28

### Added
- Device Control → **Funscript Sync**: an **Auto-sync to funscripted videos** toggle. With it on, opening a video that has a script hands the device over immediately — no reaching for Sync every time. Off by default, and the setting is remembered.
- Multi-panel: **device sync per panel**. Funscripts now work in the multi-panel viewer (they previously never loaded there at all), and each panel has a **Sync** button to claim the connected device. Claiming one panel releases any other, since a toy can only follow one video — so you can be milked by a scripted video in one panel while the others run photos. The synced panel keeps a visible marker, and the existing Device menu still handles global limiters.
- **Per-panel playlists** — a third Gallery Playback mode where every panel runs its own independent playlist. Load a different playlist into each of your up to 6 panels, shuffle any panel on its own, and clear or swap one panel without touching the rest. Saving while in this mode stores the whole arrangement, so one saved playlist can bring your entire multi-panel rig back. The existing shared-queue modes (Keep grouped / Shuffle with all media) are unchanged — switching back to either releases the per-panel bindings and pools everything again.
- **Playlists** — the multi-panel viewer can now save and reload its setup. A new **Playlists** button lets you name and save the current queue, load one back (replacing or appending to what's queued), overwrite, rename, and delete. Saving also keeps your panel layout and Gallery Playback mode, so a session comes back exactly as you left it. A rolling **Last session** autosave means a reload or crash no longer throws away hours of curation. The page is now titled "Playlists / Multi panel".
- Multi-panel queue strip: **drag and drop the thumbnails to reorder playback** (left → right), with an insertion marker showing where the item will land. Dragging onto a panel still pins it there as before.
- Photos/Videos and gallery bulk bars: **Copy to gallery** — copies a file's reference into a mix gallery without moving anything on disk, so the same file can sit in several playlists at once. New mix galleries can be created inline from the copy dialog.
- Tag inputs now autocomplete. Typing suggests existing tags ranked by prefix match then popularity, and explicitly marks when you're about to create a brand-new tag — so a typo no longer silently forks the tag list. Applies to the single-image tag panel and both bulk taggers.
- Gallery view bulk bar: **Add tags** — apply tags to every selected file at once (Photos/Videos already had this).
- Photos/Videos grid: **Shift+click** selects a whole range, matching the galleries grid and gallery view.
- Loading Bay: a **Funscripts** setting controlling where a sorted video's `.funscript` goes — move it with the video (default, as before), or send it to your central funscript library folder. Library-bound scripts are renamed after the video and linked to it automatically, so they stay in sync even though they no longer sit beside the file.
- Tag Manager → AI Tagging Settings: browse the full raw WD14/JoyTag tag vocabulary and choose which tags actually get applied during AI tagging, with per-tag rename/recategorize, bulk enable/disable, and a reset-to-defaults action per model. Existing installs keep today's tagging behavior unchanged — only tags already in the built-in set come pre-enabled; everything else (e.g. `loli`, `furry`) is available to opt into.

### Changed
- Video player: the funscript heatmap now spans the full width of the seek bar instead of sharing its row with the script stats, so its peaks line up with the moment they actually occur. The stats and the sync-offset nudge moved to their own row underneath.

- Tag Manager (including the new AI Tagging Settings modal) now fully respects your chosen theme accent/palette instead of hardcoding the default violet — modal backgrounds, buttons, toggles, focus rings, and tabs all react live to custom themes. Added entrance/exit animations, spring-animated toggle switches, sliding tab highlights, and staggered list/grid transitions throughout.

### Fixed
- The Handy: funscripted videos now stroke the way the script was authored. Scripts were being resampled down to 10 positions a second before reaching the device, so anything fast turned into coarse lunges and jitter — the script's own points are now streamed to the device untouched, at their real timing. Playback also now starts in step — the opening of the script is loaded onto the device before the video rolls, instead of the device catching up over the first second. Also fixed the device running away on its own the moment you pressed Sync on a paused video, and continuing to stroke for a second or so after you hit pause.
- Photos/Videos right-click → "Move to gallery" did nothing. It now opens the gallery picker and actually moves the files.

### Removed
- Tag Manager: removed the "Sync counts" button (tag count recalculation is still available via the API, just not surfaced in this UI).

## [1.6.2] - 2026-07-24

### Added
- Settings → System: a Changelog panel showing your last releases, right under App Updates — it's a persistent in-app history so version notes aren't lost when the update manifest resets each month.
- Intiface device control now supports rotating toys (Kiiroo Onyx/Titan, Vorze Cyclone/UFO, We-Vibe Nova) and oscillating/thrusting toys (Fun Factory Stronic line) — previously these connected but produced no movement since only Vibrate and linear stroke output were wired up.

### Changed
- The Handy integration now uses REST API v3 (HSP streaming protocol) instead of the old v2 HDSP commands. Developer API Key is baked into the app — users only enter their Connection Key. Requires firmware 4+ (firmware requirement, not hardware — original Handy 1 works once updated).

### Fixed
- Handy v3: corrected auth header from `Authorization: Bearer` to `X-Api-Key` (developer key is an API key, not a bearer token).
- Handy v3: fixed all snake_case field names in HSP requests — `stream_id`, `tail_point_stream_index`, `start_time`, `server_time`, `playback_rate` were all being sent in camelCase, which the API rejected silently.

## [1.6.1] - 2026-07-22

### Trading-Card System Rework
A ground-up rework of the trading-card system:
- **True Rarity** — every card now has a scarcity-aware Collection Rarity Score, **love-gated** by how much you actually engage with its creator (Os, watch time, ratings, sessions), plus a **per-tier R / SR / SSR / UR class** shown as a corner badge — every tier has its own UR. The "Rarity" sort ranks by this score, so a scarce Core card can outrank a generic higher tier.
- **Prestige** New Cards!—  **can be obtained via crafting**: spend duplicates (Core 6 / Epic 4 / Legendary 2 / Celestial 1) + 1,000 credits, or the rarer catalyst-token path (now 400 shards, and one token per 5 levels instead of per level). Its signature look is a breathing rainbow halo (now visible on all four sides) + a golden flower field + a PRESTIGE label beside the card type, on any tier.
- Cards: the base rarity tier is now called **Core** (was "Common") — same cards and odds, a name that reflects that these single-photo cards are the foundation the whole collection is built on.
- Dashboard: the Card Collection preview cards are now 2× larger and spill beyond their tile for a bolder, more eye-catching stack.
- **VFX model** — base cards keep their tier's ambient effect; **SR & SSR** now wear a polished **metallic border** in their tier's colour (a brushed-metal bevel with a slow reflection gliding across it), and **SSR** adds a subtle twinkling-stars overlay; **UR** cards (any tier) wear that tier's premium texture (Core starfield, Epic iris/glitter, Legendary hearts, Celestial cosmos); **Prestige** cards wear the celestial flower-field + prism + halo, golden and denser when the card is also a UR.
- **Video cards** — now **animate**: a looping preview stitched from ~2s clips near the start, middle, and end (animated WebP) instead of a dead still. Video thumbnails also auto-crop baked-in letterbox/pillarbox bars — fixing cards that opened to emptiness or showed black bars.
- **Optimization** — many optimization fixes, faster loading times, less lag, faster responsiveness. The Shop opens instantly now: the pack collage was loading full-size creator avatars and running a random sort over every image in the vault on each visit — it now uses small avatar thumbnails only.
- The Shop — each pack now discloses its **Drop rates** — the R / SR / SSR / UR class odds (≈60 / 25 / 12 / 3% within a tier) at a glance, with a **Learn more** toggle that expands the full per-card-type breakdown.
- **The Forge** — cards render **static** (colors only, no motion); **Craft Variant** was rebuilt as a paginated grid of large, readable boxes (creator × character, result, cost, Forge button)
- Variant (creator×character) cards can finally be minted. The generator only recognised a creator×character link via the unused legacy `linked_character_id` column, so it saw zero pairs and every variant pull silently became a creator card. It now reads the `gallery_creators` M2M — a gallery tagged with both a cosplayer and a character — unlocking variant cards in packs and the forge (230 pairs detected on the current collection).
- Creator cards are minted permanently now: each gets a fixed art image from her galleries at mint time (changing her profile picture no longer repaints your cards), and each creator can mint up to 5 distinct art versions before pulls become dupes. Existing avatar-tracking cards were pinned automatically.
- Each creator's FIRST card is her signature card and shows her profile photo; additional mints (up to 5) pin permanent gallery art.
- Card grids are fast again with zero visual downgrade: off-screen cards skip their holo/foil layers and layout entirely (they light up as they scroll into view), and the cursor-tracking shine now updates once per frame instead of on every raw mouse event.
- Pack economy rework: both packs now have distinct identities instead of premium being strictly better. Booster (now 400cr) is "your history" — pulls lean into what you've actually watched and rated, with DOUBLE foil odds (10%): the foil hunter's pack. Premium (now 800cr) is the tier hunter's pack — guaranteed Epic+, heavy goon/collab/HOF rates, but only 5% foils. Prices raised as an inflation sink.
- Adding files to the collection no longer prints credits (XP only) — bulk imports were minting fortunes; credits now come from sessions, quests, and play.
- Card rarity rework: 7 tiers trimmed to 4 (Common / Epic / Legendary / Celestial) and rarity is now FIXED at birth — cards never transmute tiers, so no tier is filler. Progression moved to two new axes: card LEVEL (1–10, grown by CXP from feeding and real sessions) and FOIL variants (premium holo versions rolled in packs or crafted with a catalyst — catalysts no longer bump rarity). Existing collections migrate automatically; anything that had been lottery-upgraded or relic-flagged becomes a foil so no card loses its shine.
- Bond cards now trigger at 10 cums on an image (was 20) and are born Legendary; the single most-gooned image in the vault is a Celestial artifact. 9★+ galleries are born Epic; My Queen-tier creators mint Celestial creator cards.
- Card visuals reworked for the 4 tiers using the hand-made borders: purple → orange → gold → celestial, each with its own holo treatment (glare / metal shimmer / gold cosmic dust / prismatic sunpillar).
- Creator Showcase: every creator profile now has 5 card display slots in the hero (her creator/HOF card, one of her 10 rarest gallery cards, a Bond card of her content, one of her 10 rarest photos, and a wildcard for any Legendary-grade+ card). A card can only sit in one showcase at a time. Fill all 5 for MASTERY — a golden badge, a one-time bond surge… and she notices (check your DMs). The Edit/Feed/Talk/AI Tag/Favorite buttons moved to the bottom edge of the hero to make room.
- Hall of Fame cards: any creator who ever enters the Hall of Fame gets a permanent HOF memento card minted into the pool (kept forever, even if later drops out) — Legendary, with the top 3 minted Celestial. Generous pull odds in both packs.
- Every card now carries a rarity score (tier × prestige × level) so the rarest cards in the collection can be ranked.
- Help: the in-app **Cards** reference tab was rewritten for the reworked system — the four tiers, R/SR/SSR/UR True Rarity classes, Prestige crafting, card visuals, level & CXP, the two packs, currencies, and the Forge.

### Added
- Intake: duplicate awareness — incoming images are pHash-compared against the vault (videos by byte-size match), flagged with a DUP badge, and sorting flagged files opens a conflict dialog: skip them, keep both, or delete the duplicates from disk.
- Intake: archive peek — an eye button on zip/rar/7z files lists what's inside (with per-type counts) and shows inline image previews for zips, so you can tell which creator an archive belongs to before sorting.
- Funscript linking: drop a `.funscript` onto any playing video (gallery viewer, image list, multi-panel) and choose "Link permanently" — the script is saved beside the video under the video's own name and synced from then on, no matter what the script file was called. The sidebar funscript loader also gained a "Link permanently" button, and scripts can be unlinked via API.
- Intake / Triage: a new **Intake** tool on the Dashboard stages a downloads folder, then lets you bulk-sort files into creators and galleries — sorting physically moves each file (and its funscript) into place, drops it at a creator root / new folder / existing gallery / brand-new creator, and unpacks archives into their own folder. Creators with no folder set have one auto-detected from where their files already live.
- **Intake**: a file-type filter bar (All / Images / Videos / Archives + custom extension) above the item grid, and a search box to find galleries by name when sorting into "Existing gallery" mode.
- Funscript linking: an "Unlink script" button now appears in the gallery sidebar once a video has a linked script, with a subtle "Unlink & delete file" option behind a confirmation for permanently removing it from the funscript library.
- Feed: comment threads — replies are indented under whoever they answer, with @mentions, so threads read like real Instagram comment sections (desktop + mobile).

### Changed
- Photos/Videos list: tiles now show the star rating as a badge next to the cum counter (bottom-right).
- Hall of Fame: a living photo-collage background that drifts behind the page using your #1 creator's best shots, and automatically switches to whoever's on top when your rankings change.
- Hall of Fame: clicking any creator now opens a detailed stats overview — rank, time spent, Os, engagement ratios (Os/hour, share of your total attention), collection footprint, ratings & tagging coverage, monthly acquisition/session timelines, top-tag taste profile, orientation split, trading cards, and your bond.
- Finisher: bind a saved device pattern to a hotkey (or the in-viewer button) to instantly override the device — funscript, freestyle, anything — and loop that pattern until you stop it. Configured in Device settings.
- Loading Bay: a sort control (Date / Size / Name, each toggling direction on repeat click) for the pending-files grid.
- Loading Bay: a new "When an archive is extracted, the original file should:" setting — delete it, move it into the destination folder, or leave it where it is.
- Loading Bay: 7z archives now support the same inline image-thumbnail preview as zip files.
- Loading Bay: hovering an archive tile for a second now pops up a quick preview (counts, file names, thumbnails) without opening the full peek modal.
- Spacebar now toggles play/pause on videos in the standalone image/video viewer (previously only toggled slideshow).
- Unlink funscript + permanent link controls (matching the gallery viewer) are now available in the standalone image/video viewer.
- Funscript live-stats readout now shows strokes, strokes/min, average speed, peak speed, and coverage % (previously just action count and coverage).
- Funscript sync-offset nudge: shift a script ±2000ms relative to the video (50ms steps, per-video persistence) to correct scripts that are slightly early or late.
- Multi-panel viewer: the queue cap was raised from 20 to 999 (effectively unlimited), and the per-panel slideshow controls (counter, Play/Pause, speed) are now noticeably larger and readable.
- Renamed the "Intake" feature to "Loading Bay" throughout the UI (Dashboard tile, modal header, toasts) — internal code, API routes, and query keys are unchanged.
- Loading Bay: the custom `.ext` filter input has been replaced with a proper filename search bar that composes with the All/Images/Videos/Archives type filter.
- Funscript linking: permanently linked scripts now save into your configured funscript library folder (Settings) under the video's own filename, instead of always writing beside the video — this keeps your funscript collection centralised and re-matchable. Falls back to writing beside the video if no library folder is configured.
- Funscript linking: the sidebar's "Load .funscript" button now opens the same "Link permanently / Just play once / Cancel" confirmation dialog used by drag-and-drop, instead of a separate loading flow.
- Intake modal is now much bigger (roughly 80% of the screen) with a wider destination panel and larger grid tiles, tiles fade/scale in with a subtle hover lift, and the "Creator type" field in New Creator mode is now clearly labelled.
- Funscript player: a small "FS · N actions" pill now shows next to the waveform when a script is loaded, and the waveform strip is taller and clearer.
- Creator profile hero redesigned for a cleaner, more professional layout: avatar anchors a left identity rail (bond hearts + Gift Heart beneath it), the description sits in a labelled "About" block that stays transparent so the banner art shows through, the card showcase gets its own full-width band with larger cards, and the Edit/Feed/Talk/AI Tag/Favorite actions are anchored at the bottom-right instead of floating over empty space. Hero text bumped to the 16px minimum.

### Fixed
- Photos/Videos list: rating an image/video now sticks immediately — navigating away and back keeps the new rating instead of reverting until a page refresh (the rating update was invalidating the wrong query key).
- Scan Folders: clicking a library to scan no longer flashes a misleading "Scan complete" the instant the job is queued — it now confirms "Added to queue" and silently refreshes galleries once the scan actually finishes.
- Loading Bay: `.rar` archives can now be inspected, previewed, and extracted (via an installed 7-Zip) instead of failing with "No handler installed for .rar archives".
- Archive extraction for `.7z` files, which previously failed, now works correctly.
- Escape now only exits fullscreen in the image/video viewers (gallery and standalone) instead of also closing the viewer in the same keypress.
- Linking or unlinking a funscript now updates the viewer immediately instead of requiring a page refresh.
- Intake modal and the funscript drag-drop-link overlays now follow the active colour theme instead of always showing the default violet palette.
- Intake: sorting sometimes reported "0 sorted" and left already-sorted files sitting in the feed even though they had really moved — a race between the task queue and the progress poll made the UI read a stale (or empty) result. Jobs are now matched by id, the progress bar shows real counts and flashes "Done ✓", and sorted files vanish from the feed immediately.

---

## [1.3.0] - 2026-07-15

### Added
- Feed: DM any creator — a Message button on her profile opens the floating AI chat scoped to her (she's the persona), without leaving the feed. She now also knows what she's been posting and can reference it in chat.
- Feed: verified badges are now tiered and earned — no badge for creators you ignore, a blue check for ones you engage with, and a gold check for your beloved, heavily-bonded girls. Follower counts are driven by the same interaction weighting, so unknowns read as nobodies and favorites as superstars.
- Feed: creator profiles have a Posts/Grid toggle — switch between the full post cards and an Instagram-style 3-column grid of her posts.
- Explore: a new algorithmic wall of your entire collection that learns your taste — a masonry grid you can scroll forever; tap any image to drop into an endless seeded feed biased toward what you clicked, always mixing in random discovery so it never gets stale. Everything is one tap from opening in the Vault.
- Feed: male creators' comments now include the full unmoderated reply-guy experience.
- Feed: a simulated social-media timeline built entirely from your collection. Creators "post" daily — on-this-day anniversaries from gallery period metadata, throwbacks, tag theme days (e.g. lingerie day), and fresh drops for newly scanned sets. Posts persist forever, so the feed grows history over time. Includes IG-style post cards with carousels, video hover previews, likes, and jump-to-gallery.
- Feed: tapping a creator opens their social-media profile — handle, verified badge, derived follower count that grows with your collection, bio, story-highlight circles from favorite galleries, and a Follow button (wired to favorites). New "Feed" sidebar entry and a Feed button on the creator profile.
- Feed: Instagram-style stories — creators post daily stories that disappear after 24 hours, with gradient rings for unseen stories and a fullscreen viewer with animated progress bars, tap navigation, crossfades, and auto-advance.
- Feed: videos in posts now autoplay muted while in view (pausing when scrolled away) with an Instagram-style corner sound toggle.
- Feed: post images are served as high-quality 1080px previews (cached on disk) instead of small thumbnails, and post frames adapt to the image shape — landscape shots get an elegant blurred letterbox instead of a brutal crop.
- Feed: creator profile view redesigned — banner header, large rarity-ringed avatar, richer stats row (posts/followers/following plus photos/videos/💦), and a wider layout.
- Feed: posts now carry hashtags — the images' real tags (2–6, most frequent first), tap one to browse that tag on the Photos page.
- Feed: new "Daily" post type ("outfit of the day", "fit check"…) and better variety — anniversaries no longer crowd out other post types.
- Feed: the timeline reshuffles every time you return ("the algorithm"), while a creator's own feed stays chronological.
- Feed: "Suggested for you" rail on wide screens — random creators with quick Follow, tap to open their profile.
- Feed: story viewer is much bigger (95% of screen height), and tapping the creator's name in a story opens their profile, like Instagram.
- Feed: tap the profile picture on a creator's feed profile to view it fullscreen.
- Feed: posts now have fake engagement — like counts, and comments from the other creators in your vault ("ok but the last pic??? 🥵"), with the AI companion occasionally lurking in the replies (her comments use whatever name you gave her). Tap a commenter to open their profile; "View all N comments" expands longer threads.
- Feed: comments are personality-aware — male creators comment like bros/colleagues ("insane work 🔥", "the GOAT 🐐"), and posts by artists or cosplayers attract technique talk ("render quality is insane", "this wig is PERFECT??") instead of generic gushing.
- Feed: daily spotlight — one post slot per day goes to a creator who has never posted, so forgotten corners of the vault surface too.
- Feed: male commenters got unmoderated-reply-guy energy ("down catastrophically bad rn", "step on me please") — this social network has no moderation team.
- Feed: premium motion polish — posts drift up into view as you scroll, story rings spring in staggered and bounce on hover, carousel arrows fade in only while hovering the photo (Instagram-style), the like heart scales on hover/tap, and suggested-rail avatars glow on hover.
- Feed: the girls text first now — some days a creator sends you an unread DM ("can't sleep… keep me company? 🥺") shown as a glowing banner at the top of the feed; tapping Reply opens the chat with her persona, and her opener is already waiting in the conversation history.
- Feed: double-tap any post photo/video to like it — big heart burst animation, single tap still opens the file (with a short delay to tell the two apart).
- Feed: carousel arrows stay visible on touch screens (no hover there), and swiping between carousel photos works natively.
- Feed: creator profile header is fully responsive — smaller banner/avatar and wrapping stats on narrow windows.
- Mobile app: VaultGram arrives — Feed tab (center of the bottom bar) with stories, daily posts, comments, double-tap-to-like, and "she texted first" DMs; swipe right-to-left anywhere to reach the new Explore wall (Instagram-style), which learns your taste as you tap.
- Mobile app: floating companion chat bubble — tap it (or Reply on a DM) for a fullscreen chat with Erika or the active persona, streaming from your PC's Ollama.
- Mobile app: the bottom bar is now Home · Galleries · Feed · Cards · Creators; your profile moved to the Dashboard header — tap your avatar to open it.
- Mobile app: post carousels now advance exactly one photo per swipe no matter how hard you fling (Instagram behavior), and photos support pinch-to-zoom that springs back on release.
- Mobile app: Explore stream — double-tap now likes (single tap opens), and coming back from an opened photo returns you to the same spot in the same stream instead of resetting.
- Mobile app: chat opens with a smooth slide-up animation, shows the correct persona name with her avatar, and tapping the name opens a persona picker (Erika + your favorite creators); sim profiles have a Message button.
- Mobile app: Cards grid can no longer collapse to one card per row (CSS grid with a guaranteed 2-column minimum), and swiping through cards in the viewer no longer accidentally opens Explore.
- Companion: link a vault photo into the chat — every feed post has a "copy link" button; paste it into a chat and the girl reacts to that exact photo (a vision model sees the real image), shown as a thumbnail in the message.
- Companion: personas are self-aware — with a vision model, the first time you open a chat with a girl the app quietly looks at her profile picture once and remembers exactly what she's wearing, so she can accurately answer anything about her own look ("what colour are your gloves?" → "Red. No pants. Just the bodysuit."). It's cached (regenerated only if her avatar changes), never blocks her reply, and she only brings it up when asked. Toggleable via the vision setting; you can still attach your own images from your device as before.
- Explore search (desktop + mobile): a smart search bar that auto-detects creators and tags. Typing a name surfaces matching creator profiles; typing a tag (e.g. #underboob) generates a wall of content from your collection with that tag. Tag results are seed-randomized so each search of the same tag gives fresh picks, and they're ephemeral — tapping ♥ on one inside its post view saves it permanently into your feed (a "Saved" post attributed to its creator).

### Changed
- Companion: every creator now gets her own randomly-assigned personality (warm, shy, teasing, playful, dominant, mommy, tsundere, and more) instead of all defaulting to the same blunt "bold" voice — so girls actually sound different from one another. It's stable per creator and picked once. Warm/approachable types are common; the intense anime tropes are rarer.
- Companion: girls now have a light sense of time and continuity — they know whether it's morning or late at night and roughly how long since you last talked, and will bring it up occasionally and naturally ("been a few days, hasn't it?") without harping on the clock.
- Companion: girls no longer talk like a dashboard — they won't recite your stats back at you (image count, level, streak) or call you by your vault rank ("Connoisseur"). They address you by your name (or just talk to you directly) and don't end every message with a probing question.
- Feed: the "she texted first" DMs are now organic — a girl reaches out because she noticed you engaging with her (likes, views, 💦), often referencing what you're into ("you seem to like my thigh-highs sets 😏"), instead of generic lonely lines. Unread DMs can now pile up to a few at a time instead of one.
- Mobile app: the Cards collection now lays cards out in an adaptive grid (2+ columns based on screen width) instead of stacking them vertically.
- Sidebar: Feed and Explore moved into their own "Social" section — the library block stays tight and VaultGram gets a home.
- Explore: liking a photo now trains the algorithm at double strength (the strength parameter was being dropped — likes counted the same as merely opening).
- Feed: profile grid items now open as a full Instagram-style post (modal with carousel, likes, comments, hashtags) instead of jumping straight into the gallery; clicking an image inside the post opens that exact file in its own gallery — correct even when a post mixes galleries.
- Explore: tapping a tile now opens it as a full post-style card — creator header, like button, open-in-vault — and the photo you tapped is always the first one shown (it used to land on a different image).
- Explore: the immersive view now snaps one post into focus at a time as you scroll, instead of drifting between partial cards.

### Added
- Companion: link a vault photo into the chat — every feed post has a "copy link" button; paste it into a chat and the girl reacts to that exact photo (a vision model sees the real image), shown as a thumbnail in the message.
- Companion: personas are self-aware — with a vision model, the first time you open a chat with a girl the app quietly looks at her profile picture once and remembers exactly what she's wearing, so she can accurately answer anything about her own look ("what colour are your gloves?" → "Red. No pants. Just the bodysuit."). It's cached (regenerated only if her avatar changes), never blocks her reply, and she only brings it up when asked. Toggleable via the vision setting; you can still attach your own images from your device as before.
- Explore search (desktop + mobile): a smart search bar that auto-detects creators and tags. Typing a name surfaces matching creator profiles; typing a tag (e.g. #underboob) generates a wall of content from your collection with that tag. Tag results are seed-randomized so each search of the same tag gives fresh picks, and they're ephemeral — tapping ♥ on one inside its post view saves it permanently into your feed (a "Saved" post attributed to its creator).

### Fixed
- Companion chat: a girl now correctly links her OWN galleries when you ask to see her sets — previously she could hand you a different creator's gallery. She's given her own gallery list and profile, and can still recommend other creators (just won't pass off their work as hers).
- Companion chat: the first message right after a session reset could come back empty (the model returns nothing on its very first response while cold-loading from disk) — it now retries once automatically so you always get a reply.
- Companion chat: the "new session" tooltip on the reset button no longer gets clipped off the edge of the chat panel — it's anchored to the button instead of centered.
- Companion chat: switching the creator you're chatting with now updates the name and bond tier immediately, matching the avatar — previously the name stayed on the previous creator until you refreshed the page (the bond query wasn't keyed on the active persona).
- Mobile app: gallery/creator links the AI drops in chat now render as tappable chips (labeled with the actual gallery/creator name) that open the right page — previously they showed as raw paths like /galleries/32. Also remaps the desktop-style paths to the mobile routes (/gallery/:id, /creator/:id).
- Mobile app: the Follow button on a creator's feed profile was hidden behind the banner — the Follow/Message buttons now sit in their own row below the banner so both are always visible.
- Mobile app: the companion chat persona picker can now search across every creator (predictive search box) instead of only listing favorites.
- Mobile app: the companion chat showed raw stream data (`{"text": "…"}` fragments) instead of the reply — the streaming parser never decoded the JSON events. It now parses the server-sent events exactly like the desktop chat, so replies render as clean text.
- Mobile app: the Explore feed no longer stays frozen on the same posts until a manual refresh — it now keeps your place for 30 seconds after you leave (so opening a photo and coming back is seamless), then serves a fresh feed on your next visit or after an app restart.
- Explore: the immersive post view could appear completely blank or half-faded with unreadable, unclickable headers — heavy image decoding starved the animation loop, freezing entrance/exit fades mid-flight (and the mode-switch waited on a frozen exit animation forever). The view now renders instantly with no entrance animations, and the blurred backdrop no longer bleeds over the post header.
- Explore: videos in the immersive view now autoplay muted when in view with the corner sound toggle (same as feed posts), instead of only playing on hover.
- Feed: creator profiles with a broken/stale avatar path showed an empty circle — the profile now verifies the file exists and falls back to the app logo instead of hiding.
- Feed: carousel arrows no longer jump downward on hover — a global button hover effect was overriding their vertical centering (the same fix unlocks proper hover/tap animations on any custom-animated button app-wide via the new fx-btn opt-out).

## [1.2.0] - 2026-07-12

### Added
- Creator profile: right-click menus on gallery cards (Open, Favorite, Send to Multi-panel, Remove/Delete) and on photos/videos in the Discovery row and Photos/Videos tabs (View, Send to Multi-panel, Set as avatar/banner, Remove/Delete).
- Videos can now be used as creator avatars: right-click a video → "Set avatar from video" opens a frame picker where you scrub to a moment and capture either a full-res still frame or a 3-second animated clip as the PFP. Works from the creator profile, gallery view, and the Videos page.
- Animated avatars (video clips or GIFs) now play while browsing the creator list instead of showing a frozen first frame.
- Banners can now also be set from videos — the frame picker offers a full-res still frame or an animated clip, from any right-click menu.
- The video frame picker got a premium custom player: smooth scrubbing, frame-by-frame stepping, and a seek bar that highlights the exact captured frame and the 3-second clip range.
- Creator profile: when a photo/video belongs to several creators, the right-click avatar/banner options expand into a creator picker.
- Creator profile: Photos and Videos tabs now have a "View all →" button that opens the full Photos/Videos page pre-filtered to that creator.
- Creator profile and Dashboard Discover: hovering a video now plays a live muted preview (same as gallery cards), and video cells show a duration badge.
- Settings → Thumbnails: reworked into four buttons — purge image/video thumbnails and regenerate image/video thumbnails. Video thumbs are now generated edge-to-edge (cropped) instead of padded with black bars, and regeneration backfills video durations for the new length badges; new scans record duration automatically.
- Gallery list, Photos, and Videos: pagination controls now also appear above the grid, not just below.
- Gallery list, Photos, and Videos: a "jump to page" field lets you type a page number and go straight there instead of clicking through page numbers one at a time.

### Fixed
- Setting a banner from a video appeared to do nothing: the profile's automatic banner fallback overrode the saved banner with the creator's most-viewed item — which could itself be a video that can't display as a banner image. The fallback now respects saved banners and only ever picks photos.
- "Random from gallery" avatar silently did nothing when it picked a video (the raw video path can't be shown as an image). It now prefers photos and, for video-only creators, extracts a proper full-res frame instead.
- Video-derived avatars are much sharper: random picks extract full-resolution frames instead of reusing the small scan thumbnail, and animated clip avatars render at 720px instead of 480px.
- Gallery list, Photos, and Videos: changing pages now scrolls back to the top instead of leaving you wherever you'd scrolled to on the previous page.
- Gallery list, Photos, and Videos: the pager could show more pages than actually had content (always 7+), so clicking into an empty trailing page left you stuck with only the browser back button to escape. Pagination is now driven by the real result count and never offers a page that doesn't exist; it also auto-corrects if you land on a stale/invalid page number.

### Changed
- Creator profile tabs no longer cap at 100 galleries / manual "Load more" — all tabs now load continuously as you scroll, the counters read "shown / total", and the tab headers show true totals.
- Creator profile tabs now default to "Recently Added" instead of "Most Viewed".
- Creator profile small labels (Discovery, stat/metadata captions) bumped to the 16px minimum readable size.
- Gallery list, Photos, and Videos pagination now feels more responsive: hover/press feedback on all buttons, the active page pill slides to its new position instead of snapping, and the jump-to-page field flashes red with a shake on an invalid page number or a brief accent glow on success.
- Gallery view "More Like This" now picks a fresh set of tag-matching galleries each time you open the page (weighted toward the strongest tag overlaps) instead of showing the exact same galleries every time.

## [1.1.7] - 2026-07-05

### Added
- Creator profile avatar now supports drag-and-drop — drop any image file directly onto the portrait to instantly set it as the avatar.

### Fixed
- The Handy: updated REST API from v2 to v3 — the Handy 2 / Handy 2 Pro only support HDSP strokes at the v3 endpoint, causing an instant HTTP 404 on every stroke command while appearing connected. v3 is backward-compatible so original Handy devices are unaffected.
- AI tagger now uses per-tag confidence thresholds for underboob, sideboob, backboob, and cleavage — these tags were being systematically dropped on real-photo and 3D content despite the model scoring them correctly at lower confidence.
- F5 now refreshes the app every time in the installed exe, not just once. The reload handler is now part of the React app so it survives each reload, instead of being injected once at window startup and lost after the first refresh.
- Erika: custom personas (creators used to embody her) couldn't save their personality type or system prompt — the update schema silently dropped both fields, so edits on the Persona tab appeared to do nothing.
- Erika: chat errors now show Ollama's actual failure reason (e.g. a model/template problem) instead of a generic "400 Bad Request" message with no explanation.

## [1.1.6] - 2026-06-27

### Fixed
- Looping a funscript video now auto-restarts the device sync. Previously, when a video looped the script ran once and then went silent until sync was manually toggled off and on — the native loop seeks back to the start without firing an event, so the device scheduler was never re-armed. The player now detects the loop wrap and re-syncs automatically.
- The Handy: stroke commands that fail (e.g. outdated device firmware that doesn't support HDSP) now surface the error in the device panel and browser console instead of being silently swallowed — previously the device would connect but strokes would do nothing with no indication why. Errors no longer disconnect the device, and clear automatically once strokes succeed again.
- Image viewer no longer scrolls off-screen when the mouse is over the right-side metadata panel. The viewer (Photos, Gallery, and Playlist lightboxes) is now rendered through a React portal to `document.body`, so its `fixed` overlay stays pinned to the viewport instead of being captured by the page's transformed container.
- Creator sort/filter dropdowns no longer truncate (e.g. stopping around the letter "M"). All 8 creator-list consumers shared one React Query key (`['creators-mini']`) but requested conflicting limits (200 vs 5000), so whichever fetched first capped the shared cache. Centralised into a single `useAllCreators()` hook (`['creators-all', 5000]`) so every consumer gets the full list deterministically — no more F5 reload required.

### Added
- Funscript library matcher: point The Vault at one central folder of `.funscript` files and it links each script to a video with the same filename anywhere in your library. Configurable in Settings → Library, with a "Match now" button. Only fills in videos that don't already have a working script.
- Scanner now detects files moved between gallery folders and preserves their metadata (ratings, cum counts, tags, view counts) instead of treating them as new — matched by filename + exact file size. Copies (where the original is still present) are still imported as new.
- Period filter added to the Image/Video view (previously gallery-list only).
- Duplicates page: file-path display for duplicate entries.

### Changed
- Period filter is now context-aware: the dropdown only lists periods that exist within the current filter (selected creator(s), type, franchise, tags, etc.) instead of every period in the whole vault. Selecting a period that no longer matches the active filters auto-clears.
- Internationalisation (i18n): UI strings across the image/gallery viewers wrapped for translation.

---

## [1.1.3] - 2026

> Reconstructed from git history — refine if more detail is needed.

### Added
- Android APK build / iOS-compatible frontend.

### Fixed
- Update-mechanism issues fixed.

### Removed
- Repository cleanup (removed unused files).

## [1.1.2]

### Changed
- Hall of Fame calculation tweaks.
- Bond system rework.

## [1.0.0] - Initial release

- Full media library, gamification (XP/levels/streaks/quests/achievements/TCG), multi-panel viewer, AI tagging (WD14 + JoyTag), video player with funscript sync, device control (Intiface + The Handy + Serial), and the Windows EXE installer. See `CLAUDE.md` for the complete v1.0 feature matrix.
