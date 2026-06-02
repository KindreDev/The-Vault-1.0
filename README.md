# The Vault

A personal, local-first media gallery for collectors. Built for people who take their collection seriously.

The Vault combines a powerful media library with a full gamification engine, AI auto-tagging, and hardware device integration — all running locally on your machine, with no accounts, no cloud, no subscriptions.

---

## 📋 Table of Contents

- [This App Was Made For You](#this-app-was-made-for-you)
- [Why The Vault](#why-the-vault)
- [Installation](#installation)
- [Feature Guide](#feature-guide)
  - [Getting Started](#getting-started)
  - [Galleries](#galleries)
  - [Image Viewer](#image-viewer)
  - [Multi-Panel Viewer](#multi-panel-viewer)
  - [Creators](#creators)
  - [AI Auto-Tagging](#ai-auto-tagging)
  - [Deduplication](#deduplication)
  - [Gamification](#gamification)
  - [TCG Card System](#tcg-card-system)
  - [Sessions](#sessions)
  - [Random Mix and Galleries](#random-mix-and-galleries)
  - [Device Control](#device-control)
  - [Settings](#settings)
- [Data & Privacy](#data--privacy)


## This app was made for you

If you want to:

- Save and organize your favorite creator photos/videos
- Love building massive collections
- Enjoy gamification of common, every day tasks, progression and feel rewarded by your hobby
- Want a private, offline, beautiful way to manage everything in one place
- If you have folders with thousands of photos and videos,
- If you track your favorite models

Then this app, is built for you specifically.

## Why The Vault

Most media managers are just file browsers. And while there are some very good, high quality and free, open source photo collection services, i struggled to find one that I liked for my specific purposes. The Vault is built around the idea that if collecting is your hobby, every aspect of it should be fun and rewarding.

**Gamification** All your actions, — importing a gallery, rating an image, logging a session, tagging content — earns XP, advances quests, and unlocks achievements. There are 100 levels with unique titles, a streak system with multipliers up to 3×, a daily spin wheel, and a complete TCG card system where your own content becomes collectible cards with rarities, evolution mechanics, and a crafting economy. If I'm honest, I would struggle to really spend time curating my own collections out of lazyness, having a clean, beautiful UI to work with that rewards you for doing it with pretty cards to collect, has made it a far more rewarding activity for me.

**AI tagging that runs fully offline.** WD14 and JoyTag ONNX models run entirely on your machine. No need for API keys, no internet required for tagging.

**Intiface/Handy/Serial Device support** Device control lives inside The Vault. Supports Intiface Central (Buttplug.io, covers most hardware), The Handy (currently untested, as I dont have a Handy device) via REST API, and direct USB serial . Funscripts sync to video automatically, new funscripts can be added on demand. A full pattern engine handles freestyle mode: presets, custom patterns, stroke variance, ramp mode, edging assist, and a pattern scheduler with play-once and loop modes.

**Your content generates the cards.** The TCG is not generic — The TCG game is entirely unique to you. The cards are pulled from your actual images, galleries, and creators. You can see the actual calculations below. The collection and the game are the same thing. 

---

## Installation

### Windows (Recommended)

1. Download `VaultSetup.exe` from the latest release
2. Run the installer — no dependencies required, everything is bundled
3. Launch **The Vault** from the Start menu or desktop shortcut
4. The app opens in a standalone window.
5. It can also be accessed at `http://localhost:8000`

Data is stored in `%APPDATA%\TheVault\` by default. You can change this in Settings → Data Directory. Uninstalling the app does **not** delete your data — remove the data folder manually if needed.

### From Source (Dev / Non-Windows)

**Requirements:** Python 3.11+, Node.js 18+

```bash
# Clone the repo
git clone https://github.com/yourname/the-vault
cd the-vault

# Backend
cd backend
python -m venv venv
venv\Scripts\activate        # Windows
# source venv/bin/activate   # Linux/macOS
pip install -r requirements.txt
python main.py               # API at http://localhost:8000

# Frontend (separate terminal)
cd frontend
npm install
npm run dev                  # UI at http://localhost:5173
```

API docs: `http://localhost:8000/docs`

---

## Feature Guide

### Getting started

**Adding a library root**

<img width="992" height="832" alt="image" src="https://github.com/user-attachments/assets/7c0fa03d-1b74-4ad3-b2a0-bc19105acaae" />

Go to **Settings → Library**.  You can either paste the directory of your choice, or click "Browse", A folder picker opens. Select any top-level folder — The Vault scans it recursively and imports every image and video it finds. You can add a label to this directory, this label will get added as a tag for every image or video in said directory.

You can add multiple roots pointing to different drives or directories. All content is merged into one unified library.

**Scanning**

<img width="670" height="344" alt="image" src="https://github.com/user-attachments/assets/fbd843e1-8ebd-4bf2-a0f1-9ef13b5d5c21" />


Once you have the content you want to import, you can scan any time from Settings, you can either scan the entirery library (all your directories) or a single directory using the dropdown. Scanning is non-destructive — files already in the library are not re-imported or duplicated.

The scanner creates one **Gallery** per folder. If a folder contains images and subfolders, both the parent and each subfolder become separate galleries. The folder structure on disk remains untouched, unless you manually merge from the app in the gallery feature. 

You can see the progress or history of any scanning task from the task queue

<img width="1508" height="823" alt="image" src="https://github.com/user-attachments/assets/1e0b1181-ce7b-49ed-90a6-d99d18b4d282" />


**Funscript detection**

If a `.funscript` file shares a filename with a video (`video.mp4` → `video.funscript`), it is detected during scan and linked to that video automatically. The video also gets a "funscripted" tag, so it becomes easy to find later on.

---

### Galleries

<img width="1406" height="782" alt="image" src="https://github.com/user-attachments/assets/b277581b-23d1-42f0-871b-b8987cfaed85" />


Each folder maps to one gallery. The Galleries UI track:

- **Name** — Uses folder name. Can be renamed using the pen

  <img width="316" height="358" alt="image" src="https://github.com/user-attachments/assets/9f3298c1-0e2c-4da9-9b6d-6a41536cc4d7" />

- **Rating** — 1–5 stars
- **Cover photo** — any image in the gallery can be set as the cover
- **Tags** — manual or AI-generated
- **Creator** — 5 Different creator types, Can bulk assign multiple galleries
- **View count** and **cum counter** — Incremental tracking

The gallery list supports filtering by creator, tag, rating, and sorting by date, name, rating, view count, or cum count. Bulk operations let you assign a creator, add tags, or delete multiple galleries at once.

From the gallery view you can instantly use the AI tagging feature to automatically add relevant tags to any images within the gallery, this is useful if you are only interested in tagging a specific gallery instead of the entire collection

<img width="1878" height="916" alt="image" src="https://github.com/user-attachments/assets/245cad98-037f-4c3b-b3d1-bb51fab5a53d" />


---

### Image Viewer

Click any image to open the viewer.

- **Zoom and pan** — scroll to zoom, click-drag to pan
- **Filmstrip** — thumbnails at the bottom; click to jump, scroll to navigate
- **Fullscreen** — Use the button in  a browser or press F11 in standalone app; UI fades on idle
- **Keyboard navigation** — arrow keys to advance, Escape to close

**Video playback**

Videos open in an inline player with play/pause, ±3s skip, seek bar, volume control, loop toggle, and a funscript waveform overlay. When a device is connected and a funscript is loaded, a **Sync** button appears to lock the device to the video timeline.

---

### Multi-Panel Viewer

Run up to **six** independent slideshows side by side. Sizes can be adjusted at any time. Use the numbers to set the amount of panels to be active

<img width="718" height="581" alt="image" src="https://github.com/user-attachments/assets/f53573d4-d36c-4e71-bf65-79b2e09bd79b" />

The add media button will open all your galleries, photos or videos and allow you to select as many as you want. If you select more than 6 files, they will queue up automatically in a slideshow presentation.

<img width="1904" height="949" alt="image" src="https://github.com/user-attachments/assets/b957c024-7a27-4438-8330-5cc23b6dc6d9" />

Each panel is sourced independently from a gallery, playlist, creator library, or tag filter. Each has its own auto-advance timer (5 / 8 / 12 seconds, or manual). You can choose to shuffle all galleries randomly or keep each gallerie self contained and play its own slideshow in order, using the 3 dot button menu.

---

### Creators

Six creator types are supported:

| Type | Description |
|---|---|
| **Cosplayer** | Cosplayers, self explanatory |
| **E-thot** | OnlyFans / Fansly / Manyvids adult content creators who are not cosplayers; |
| **Artist** | 2D/3D digital artists; |
| **Character** | Game/anime/series characters; wiki import, series, developer, lore |
| **Actress** |Adult Professional performers; |
| **Model/Other** | Any creator that doesnt fit any of the above categories. |

**MyAnimeList Import** — You can search any anime character in the search bar, if its available, the vault will fill all the available data automatically. This is entirely dependant on the data available on MAL

<img width="884" height="829" alt="image" src="https://github.com/user-attachments/assets/8361e465-8126-438d-b3ea-10c0e8c5a880" />

**Linking Creator content** — Once you create their profile you can either manually assign each gallery that belongs to this creator using the gallery UI, or you can let the vault do it automatically, simply paste the directory where all their content lives on your drive, and if it matches the content already imported, you simply need to press "Assign Galleries".

<img width="1160" height="1092" alt="image" src="https://github.com/user-attachments/assets/a948d3a4-f783-44fd-815e-72c64845a69e" />

**Collection value** Every gallery automatically tries to find the date the content was released on by looking at the file creation date, or the name of the gallery itself. If it cant find anything, you can also manually set this value. By doing this, if you set a monthly price in the Creator Profile, it will calculate the amount of months you have been paying for any particular creator and add up the total collection value. (this might not be 100% precise for all types of creators, such as OF creators who mostly do PPV content, Its something to think about for future updates). Its blurred by default in case you really dont want to look at it 😅

**Creator Quality** — A smart system that tracks how invested you are in any creator, taking the amount of files + total view count + rating, and producing the following ratings:

Discovered → Familiar → Appreciated → Cherished → Obsessed → Legendary → My Queen (this final tier can also simply be manually added to your favorite creator, only one creator can be crowned, so choose carefully!) These tiers are purely cosmetic.

<img width="1023" height="731" alt="image" src="https://github.com/user-attachments/assets/4a9d7a31-3e58-406a-b116-15b39e72eb8a" />


---

### AI Auto-Tagging

**Setup:** Settings → AI Tagging → download models (~500 MB each).

Two models are available:

- **WD14** — trained on anime/illustration; excellent for art, character tags, and NSFW classification
- **JoyTag** — general-purpose; strong on photographic content

Both can be enabled simultaneously. Each image is tagged by whichever models are downloaded.

**GPU acceleration** — NVIDIA GPUs are auto-detected. If CUDA DLLs are missing, use the **Download GPU DLLs** button in the GPU status panel. CPU fallback works without any setup. (Significantly slower, dont recommend for large collections. Average speed on a ryzen 5 5600x is about 1 - 2 files per second)

**Running a job** — choose scope (all untagged, a specific folder, or a specific creator) and start. Progress is shown in the task queue with a cancel option.

<img width="563" height="531" alt="image" src="https://github.com/user-attachments/assets/e90b5528-d2b8-49cb-a735-3d09b4375348" />


**Tag display** — AI tags appear in **purple**, manual tags in **white**. Both are filterable in the gallery and image views.

**Tag Manager** The AI will make some mistakes, use the confidence threshold to make it more precise, with the tradeoff of getting less tag overall. If you want to double check the AI Work, you can use the tag manager to adjust them. The % is the confidence the AI has on being correct, if a tag is wrong, you can simply hit the X and remove it from the file.


<img width="1189" height="850" alt="image" src="https://github.com/user-attachments/assets/bad90e09-5abb-47f4-917a-5965c5d0eb2c" />

<img width="1695" height="926" alt="image" src="https://github.com/user-attachments/assets/59adca3e-c6f4-4021-8c8e-402d7a471852" />


--

### Deduplication

If you click Hash Index, the vault will index your entire collection and search for duplicates. 

The similarity slider controls how close the match must be for the vault to mark it as a duplicate

<img width="453" height="803" alt="image" src="https://github.com/user-attachments/assets/3cb7df44-c069-484c-ba42-c66956cba394" />


---





<img width="1716" height="958" alt="image" src="https://github.com/user-attachments/assets/6c245237-2bcb-4681-9ebc-1a842c983b4e" />

After it finds some duplicates, you will get a side by side comparison of the files,  as well as filters to locate duplicates by creator, gallery or file name. 

Select any file you want to keep, it will delete the other one.

IT will sometimes wrongly mark as duplicates photos that are too similar, have same composition or almost same pose. This can be adjusted with the similarity slider. 

<img width="1511" height="717" alt="image" src="https://github.com/user-attachments/assets/3f7353ee-bab4-4bc9-9765-5ec6bfa3079a" />

In order to perform a bulk operation, you can select all photos that you intend to keep and click the top right corner button. this will delete all the other unselected duplicates. **This will DELETE FILES FROM YOUR DRIVE**, so proceed with caution.

<img width="206" height="166" alt="image" src="https://github.com/user-attachments/assets/641bb494-e12b-45b8-a8ce-d543e630b9a6" />

The vault can also detect upscales of the same image and you can set those to ignore, if you wish.

---

-### **Gamification**

This is an entirely cosmetic and just fun side of the vault. If all you care is managing a collectiong and having clean, usable tags and media player, you can largely ignore the whole "Collect" Section. However, I do believe it adds value to the act of curating and spending time with your collection in a different way.


#### XP and Vault Credits

Almost every action earns both XP (levels you up) and Vault Credits (used to buy card packs):

| Action | XP | Credits |
|---|---|---|
| Log a session | 40 | 10 |
| Count an O | 50 | 20 |
| Import a gallery | 15 | 5 |
| Add a creator | 75 | 15 |
| Daily login | 20 | 10 |
| Wiki import | 25 | 5 |
| Add a tag | 5 | 1 |
| Rate an image | 2 | — |
| Rate a gallery | 5 | — |
| Open a pack | 10 | — |
| Dismantle a card | 30 | — |
| Complete tagging mission | 200 | 50 |
| Complete a quest | varies | 40 |
| Unlock an achievement | varies | 75 |

All XP is multiplied by your current streak multiplier before being applied.

#### Streak Multiplier

Log in daily to build your streak. The multiplier applies to **all XP earned that day**:

| Streak | Multiplier |
|---|---|
| Days 1–6 | ×1.0 |
| Day 7+ | ×1.5 |
| Day 14+ | ×2.0 |
| Day 30+ | ×3.0 |

**Grace token:** you earn one grace token per week. If you miss exactly one day, the token is spent automatically and your streak survives. Miss two consecutive days and the streak resets.

#### Levels

100 levels total. Your title updates every 5 levels:

| Levels | Title |
|---|---|
| 1–5 | The Lurker |
| 6–10 | Peeking Shadow |
| 11–15 | Desire Seeker |
| 16–20 | Vault Delver |
| 21–25 | Sin Collector |
| 26–30 | Acolyte of Lust |
| 31–35 | Devoted Stroker |
| 36–40 | Pleasure Archivist |
| 41–45 | Goon Disciple |
| 46–50 | Metadata Priest |
| 51–55 | High Priest of HD |
| 56–60 | Curator of Sin |
| 61–65 | The Degenerate |
| 66–70 | Elite Gooner |
| 71–75 | Vault Sovereign |
| 76–80 | Lord of Indulgence |
| 81–85 | Grand Archivist |
| 86–90 | Legendary Coomer |
| 91–95 | The Completionist |
| 96–100 | God Emperor of the Vault |

XP scales quadratically: each level costs 500 more XP than the previous one. Level 10 requires ~22,500 total XP. Level 50 requires ~612,500. Level 100 requires ~2,475,000.

#### Daily Login Bonus

20 XP + 10 credits, claimed automatically on first page load of the day.

#### Daily Spin

Once per day, spin the wheel for a random bonus of 10–100 XP. Available from the Dashboard.

#### Quests

| Type | Reset | Active | Completion Reward |
|---|---|---|---|
| Daily | Every day | 4 at once | 5 standard packs |
| Weekly | Every week | 3–4 at once | 5 premium packs |
| Boss | Never (until done) | Persistent | Large XP + credits |

Example dailies: rate 5 images, open a pack, log a session, tag 3 images.  
Example weeklies: open 5 packs, import 3 galleries, add 50 tags.  
Example bosses: log 50 sessions, count 100 Os, reach level 25.

#### Achievements

One-time unlocks for specific milestones. A selection:

| Achievement | Condition | XP |
|---|---|---|
| First Time | Log your first session | 100 |
| First Nut | Count your first O | 75 |
| Pack Rat | Open your first pack | 100 |
| Legend | Obtain a Legendary card | 400 |
| Ascended | Obtain a Celestial card | 2,000 |
| Dedicated Gooner | Log 50 sessions | 2,500 |
| Absolute Unit | Count 100 Os | 3,000 |
| Pack Addict | Open 50 packs | 1,200 |
| God Tier | Reach level 100 | 20,000 |

---

### TCG Card System
This is my favorite part of the vault and I hope people give it a chance to interact with it, give their feedback and help me improve it over time.
The card system turns your entire collection (for now, videos are not supported) into a living Trading Card Game. Cards are generated from your actual images, galleries, and creators — not generic art.

#### Card Types and Base Rarities

| Type | Base Rarity | How It's Generated |
|---|---|---|
| **Image** | Common | Any image in your library |
| **Gallery** | Uncommon | Any gallery |
| **Collab** | Rare | Special cards with more than 1 creator |
| **Creator** | Rare | Any creator you've added |
| **Goon** | Epic | Images with 20+ cum count |
| **Variant** | Legendary | Crafted via the Forge |

#### Rarity Tiers

Seven tiers from lowest to highest:

**Common → Uncommon → Rare → Epic → Legendary → Relic → Celestial**

Relic and Celestial cannot appear as base pulls — they can only be obtained through the upgrade lottery or by evolving a card (see CXP below).

#### Opening Packs

<img width="1149" height="827" alt="image" src="https://github.com/user-attachments/assets/c222292f-3838-4479-a2d7-a1c4969722fc" />


Packs cost Vault Credits from the Card Shop, you can get credits doing  wide variety of activities in your collection. The first time you import your collection, adding potentially hundreds or thousands of photos, you will get  large chunk of credits that will get you started right away without any waiting. **I do recommend setting up all your creators and assigning them to their respective galleries first, before opening packs. The system was designed with this in mind and it will work better**

| Pack | Cost | Cards per pack |
|---|---|---|
| Standard | 250 credits | 5 |
| Premium | 500 credits | 5 |

<img width="1448" height="686" alt="image" src="https://github.com/user-attachments/assets/937b27fe-0eac-4c44-ab87-d5c032be4c1f" />


Free packs are also awarded for completing all daily quests (5 standard) and all weekly quests (5 premium).

**Standard pack drop weights:**

| Card Type | Chance |
|---|---|
| Image | 66% |
| Gallery | 19% |
| Creator | 7% |
| Collab | 5% |
| Goon | 2% |
| Variant | 1% |

<img width="1403" height="757" alt="image" src="https://github.com/user-attachments/assets/6019efbc-ede5-4043-ab91-1011396fe51a" />


**Premium pack drop weights** (biased toward rarer types):

| Card Type | Chance |
|---|---|
| Image | 35% |
| Gallery | 27% |
| Creator | 15% |
| Goon | 10% |
| Variant | 7% |
| Collab | 6% |

**Upgrade lottery** — after every card pull, a separate roll can upgrade the card's rarity regardless of its type:

| Upgrade | Probability |
|---|---|
| Force Epic | 5% |
| Force Legendary | 1% |
| Force Relic | 0.5% |
| Force Celestial | 0.1% |

Every card pulled — even a Common image — has a 0.1% chance of becoming Celestial.


**
Cards Visual effects are turned off by default. You can turn them on using this toggle**

<img width="659" height="342" alt="image" src="https://github.com/user-attachments/assets/7b87db23-4c91-4824-bbec-38902b947c60" />

#### Dismantling

Dismantle unwanted cards for Shards and 30 XP:

| Rarity | Shards |
|---|---|
| Common | 5 |
| Uncommon | 10 |
| Rare | 25 |
| Epic | 75 |
| Legendary | 200 |
| Relic | 1,000 |
| Celestial | 5,000 |

#### Forge

**Catalyst Tokens** are crafted from shards at a rate of **150 shards = 1 Catalyst Token**. You also earn 1 token automatically per level-up.

**Forging a Variant card** crafts a Legendary card from a specific Creator × Character pairing. Cost:
- **500 Shards**
- **1 Catalyst Token**

Hard cap: a maximum of **3 Variant cards** can ever exist per Creator × Character pair. Once filled, that combination is permanently closed.

#### CXP — Card Experience and Evolution

Every card accumulates CXP over time:
- **+20 CXP** each time you log a session involving that card's creator or gallery
- **Feeding any other card** card grants CXP based on their rarity. A dupe of that card will grant bonus CXP.

When a card's CXP reaches the threshold, you can evolve it to the next rarity tier for **50 shards**:

<img width="958" height="943" alt="Screenshot 2026-05-31 022936" src="https://github.com/user-attachments/assets/af30fc80-aab8-4ab7-849f-e09448b2b4d3" />


| Current Rarity | CXP Required |
|---|---|
| Common | 100 |
| Uncommon | 300 |
| Rare | 800 |
| Epic | 2,000 |
| Legendary | 5,000 |
| Relic | 12,000 |
| Celestial | Max tier — cannot evolve |

Evolution is the primary path to Celestial without luck. A Common card can reach Celestial through six evolutions if you invest the sessions and shards. 

<img width="1037" height="903" alt="image" src="https://github.com/user-attachments/assets/4d1d785a-38bc-4763-91ff-579ff7fe0ff0" />

---

### Sessions

Log a session from the Dashboard, the multi-panel viewer bottom bar, or the image viewer. A session records the timestamp, which content was active, XP earned, and any cum count logged during it. Session history is available in the Sessions page.

---

### Random Mix and Galleries

<img width="1887" height="739" alt="image" src="https://github.com/user-attachments/assets/12664b8e-fc2a-4acb-860c-a20634b0000b" />

From the dashboard, you can randomly generate a temporary gallery with any criteria that you want

<img width="443" height="703" alt="image" src="https://github.com/user-attachments/assets/650532d3-b17e-4a55-a858-578f5192dee0" />

If you dont select any criteria, it will be completely random. If you like  random gallery you can choose to preserve it.


---

### Device Control

Access from **Device Control** in the sidebar. 

#### Providers

**Intiface Central** — install Intiface Central separately, enable WebSocket Server (default port 12345). Covers the widest range of hardware via Buttplug.io protocol.

**The Handy** — no Intiface required. Enter your Connection Key (found in The Handy app under Settings → Connection Key). Connects directly via REST API. Device must already be paired in The Handy app via Bluetooth or WiFi.

**Serial (T-Code)** — connect via USB. Click Connect and select the COM port from the browser dialog. 

#### Funscript Sync

Funscripted videos have a uniqe tag and icon.

<img width="324" height="328" alt="image" src="https://github.com/user-attachments/assets/28d3ddd7-bb02-4657-b323-9583aea3fc12" />


When a video with a linked funscript is playing and a device is connected, a **Sync** button appears in the video player controls. Tap to lock device movement to the funscript timeline

<img width="195" height="112" alt="image" src="https://github.com/user-attachments/assets/1d43fe16-3096-4da4-bba0-e99c96bb1281" />

Additional device controls will appear on the right side, and you can also load any script to play with any video.

#### Freestyle Mode

Toggle **Freestyle / Gooning Mode** to run the device continuously while browsing. The device strokes according to the active pattern.

<img width="623" height="898" alt="image" src="https://github.com/user-attachments/assets/99c87493-1b44-43f5-b771-324fea2a0613" />


**Built-in patterns:**

| Pattern | Stroke Range | Speed |
|---|---|---|
| Tease | 40–80% | 15 spm |
| Edge | 60–100% | 25 spm |
| Build | 20–100% | 35 spm |
| Pound | 0–100% | 50 spm |
| Cum | 70–100% | 65 spm |

You can also build and save custom patterns with configurable stroke min, stroke max, and SPM.

**Intensity** — speed multiplier from 10% to 500%.

**Glans Focus** — shifts the stroke window upward for more tip stimulation.

**Stroke Variance** — randomises stroke endpoints within the set range. At 0%, every stroke hits the exact min/max. Higher values make each stroke land anywhere within the range, so the motion feels organic rather than mechanical.

**Stroke Range Limiter** — global floor and ceiling applied to all device movement across every mode.

#### Ramp Mode

Smoothly interpolates between two patterns over a configured time window. Pattern parameters shift continuously every 2 seconds. Mutually exclusive with the Pattern Scheduler loop.

#### Pattern Scheduler

Build a queue of pattern steps, each with a duration in minutes.

- **Loop with Freestyle** — cycles through the queue automatically while Freestyle mode is on
- **Play Queue** — plays the queue once from start to finish then stops the device; the active step is highlighted live

Mutually exclusive with Ramp Mode.

#### Edging Assist

Automates the peak → drop → rebuild cycle:

1. Device runs at your active pattern for the configured **Peak Duration**
2. Switches to the **Drop Pattern**
3. After **Build-Back Duration**, restores the peak pattern and repeats indefinitely

---

### Settings

| Setting | Description |
|---|---|
| **Theme accent** | Six colour palettes; updates instantly |
| **Data directory** | Move vault.db and thumbnails to another location; app restarts automatically |
| **Backup** | Download a copy of vault.db |
| **Restore** | Replace the current database with a backup file |
| **Factory reset** | Wipe the database entirely (confirmation required); data folder files are not touched |
| **Restart server** | Restart the backend without closing the browser tab |
| **AI Tagging** | Download/manage WD14 and JoyTag models; GPU status and DLL download |
| **Library roots** | Add, view, and remove scan roots |

---

## Data & Privacy

Everything runs locally. No telemetry, no accounts, no outbound network traffic except:

- Wiki/MAL imports (you initiate these manually)
- The Handy REST API (only when using The Handy provider)
- AI model downloads (one-time, from Hugging Face)

Your database is a single SQLite file at `%APPDATA%\TheVault\vault.db`. Back it up however you like — the Backup button in Settings makes it straightforward.
