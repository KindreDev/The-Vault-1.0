# Changelog

All notable changes to The Vault are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/).
Add a one-line entry under **[Unreleased]** the moment a change is made — don't wait for release.
At release time, rename `[Unreleased]` to the new version + date and start a fresh Unreleased block.

Categories: **Added** (new features) · **Changed** (behaviour/UI changes) · **Fixed** (bug fixes) · **Removed**.

---

## [Unreleased]

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

> Note: the Added/Changed items above reflect in-progress uncommitted work in the tree as of 2026-06-25; refine wording when committed.

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
