# Changelog

All notable changes to The Vault are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/).
Add a one-line entry under **[Unreleased]** the moment a change is made — don't wait for release.
At release time, rename `[Unreleased]` to the new version + date and start a fresh Unreleased block.

Categories: **Added** (new features) · **Changed** (behaviour/UI changes) · **Fixed** (bug fixes) · **Removed**.

---

## [Unreleased]

## [1.6.0] - 2026-07-22

### Trading-Card System Rework
A ground-up rework of the trading-card system:
- **True Rarity** — every card now has a scarcity-aware Collection Rarity Score, **love-gated** by how much you actually engage with its creator (Os, watch time, ratings, sessions), plus a **per-tier R / SR / SSR / UR class** shown as a corner badge — every tier has its own UR. The "Rarity" sort ranks by this score, so a scarce Core card can outrank a generic higher tier.
- **Prestige** New Cards!—  **can be obtained via crafting**: spend duplicates (Core 6 / Epic 4 / Legendary 2 / Celestial 1) + 1,000 credits, or the rarer catalyst-token path (now 400 shards, and one token per 5 levels instead of per level). Its signature look is a breathing rainbow halo (now visible on all four sides) + a golden flower field + a PRESTIGE label beside the card type, on any tier.
- Cards: the base rarity tier is now called **Core** (was "Common") — same cards and odds, a name that reflects that these single-photo cards are the foundation the whole collection is built on.
- Dashboard: the Card Collection preview cards are now 2× larger and spill beyond their tile for a bolder, more eye-catching stack.
- **VFX model** — base cards keep their tier's ambient effect; **UR** cards (any tier) wear that tier's premium texture (Core starfield, Epic iris/glitter, Legendary hearts, Celestial cosmos); **Prestige** cards wear the celestial flower-field + prism + halo, golden and denser when the card is also a UR.
- **Video cards** — now **animate**: a looping preview stitched from ~2s clips near the start, middle, and end (animated WebP) instead of a dead still. Video thumbnails also auto-crop baked-in letterbox/pillarbox bars — fixing cards that opened to emptiness or showed black bars.
- **Optimization** — many optimization fixes, faster loading times, less lag, faster responsiveness. 
- **The Forge** — cards render **static** (colors only, no motion); **Craft Variant** was rebuilt as a paginated grid of large, readable boxes (creator × character, result, cost, Forge button)
- Variant (creator×character) cards can finally be minted. The generator only recognised a creator×character link via the unused legacy `linked_character_id` column, so it saw zero pairs and every variant pull silently became a creator card. It now reads the `gallery_creators` M2M — a gallery tagged with both a cosplayer and a character — unlocking variant cards in packs and the forge (230 pairs detected on the current collection).
- Creator cards are minted permanently now: each gets a fixed art image from her galleries at mint time (changing her profile picture no longer repaints your cards), and each creator can mint up to 5 distinct art versions before pulls become dupes. Existing avatar-tracking cards were pinned automatically.
- Each creator's FIRST card is her signature card and shows her profile photo; additional mints (up to 5) pin permanent gallery art.
- Card grids are fast again with zero visual downgrade: off-screen cards skip their holo/foil layers and layout entirely (they light up as they scroll into view), and the cursor-tracking shine now updates once per frame instead of on every raw mouse event.
- Pack economy rework: both packs now have distinct identities instead of premium being strictly better. Booster (now 400cr) is "your history" — pulls lean into what you've actually watched and rated, with DOUBLE foil odds (10%): the foil hunter's pack. Premium (now 800cr) is the tier hunter's pack — guaranteed Epic+, heavy goon/collab/HOF rates, but only 5% foils. Prices raised as an inflation sink.
- Adding files to the collection no longer prints credits (XP only) — bulk imports were minting fortunes; credits now come from sessions, quests, and play.
- Card rarity rework: 7 tiers trimmed to 4 (Common / Epic / Legendary / Celestial) and rarity is now FIXED at birth — cards never transmute tiers, so no tier is filler. Progression moved to two new axes: card LEVEL (1–10, grown by CXP from feeding and real sessions) and FOIL variants (premium holo versions rolled in packs or crafted with a catalyst — catalysts no longer bump rarity). Existing collections migrate automatically; anything that had been lottery-upgraded or relic-flagged becomes a foil so no card loses its shine.
- Goon cards now trigger at 10 cums on an image (was 20) and are born Legendary; the single most-gooned image in the vault is a Celestial artifact. 9★+ galleries are born Epic; My Queen-tier creators mint Celestial creator cards.
- Card visuals reworked for the 4 tiers using the hand-made borders: purple → orange → gold → celestial, each with its own holo treatment (glare / metal shimmer / gold cosmic dust / prismatic sunpillar).
- Creator Showcase: every creator profile now has 5 card display slots in the hero (her creator/HOF card, one of her 10 rarest gallery cards, a goon card of her content, one of her 10 rarest photos, and a wildcard for any Legendary-grade+ card). A card can only sit in one showcase at a time. Fill all 5 for MASTERY — a golden badge, a one-time bond surge… and she notices (check your DMs). The Edit/Feed/Talk/AI Tag/Favorite buttons moved to the bottom edge of the hero to make room.
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
