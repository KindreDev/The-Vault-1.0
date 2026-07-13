# Changelog

All notable changes to The Vault are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/).
Add a one-line entry under **[Unreleased]** the moment a change is made — don't wait for release.
At release time, rename `[Unreleased]` to the new version + date and start a fresh Unreleased block.

Categories: **Added** (new features) · **Changed** (behaviour/UI changes) · **Fixed** (bug fixes) · **Removed**.

---

## [Unreleased]

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
