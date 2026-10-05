# The Vault

The Vault is a local-first Windows media collection application with a React frontend, a Python/FastAPI backend, SQLite storage, gamification, TCG V2, and an optional 3D Collection Room.

## Development requirements

- Python 3.11 or newer
- Node.js and npm
- FFmpeg for video thumbnails and media processing
- Inno Setup 6 for compiling the Windows installer

## Run locally

Use `start.bat` for the Windows development launcher, or start the backend and frontend separately.

`start.bat` opens the desktop window with VLC playback. The development browser
UI remains available at `http://localhost:5173` with browser-compatible playback.

Backend:

```powershell
cd backend
python -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt
python main.py
```

Frontend, in a second terminal:

```powershell
cd frontend
npm ci
npm run dev
```

| Service | Address |
| --- | --- |
| Development UI | `http://localhost:5173` |
| Backend | `http://localhost:8000` |
| Interactive API docs | `http://localhost:8000/docs` |

Vite proxies API and thumbnail requests to the backend. Packaged builds serve the frontend and API together on port 8000.

## Repository layout

| Path | Responsibility |
| --- | --- |
| `backend/main.py` | Application startup, routes, static files, background services |
| `backend/database.py` | Database connection and effective data paths |
| `backend/models.py` | SQLAlchemy models |
| `backend/schemas.py` | Request and response validation |
| `backend/routers/` | API endpoints |
| `backend/services/` | Collection, scanning, tagging, gamification, cards, and device-related business logic |
| `TEST STUFF CAN DELETE/` | Archived tests, diagnostics, scratch helpers, and build intermediates; not required to run or package the app |
| `frontend/src/pages/` | Desktop screens |
| `frontend/src/components/` | Shared components, viewers, TCG, and Collection Room |
| `frontend/src/lib/api.js` | Desktop API client |
| `frontend/src/store/vault.js` | Global desktop state |
| `frontend-mobile/` | Mobile web frontend and Capacitor Android project |
| `scripts/` | Release preparation and asset tooling |
| `vault.spec` | PyInstaller packaging recipe |
| `installer.iss` | Windows installer definition |

## Architecture

The backend uses FastAPI, SQLAlchemy, Pydantic v2, Pillow, FFmpeg, and local ONNX tagging. The desktop frontend uses React, Vite, Tailwind, TanStack Query, Zustand, Framer Motion, and Lucide. The Collection Room uses React Three Fiber and drei.

The application is single-user and uses SQLite. A disk folder corresponds to a Gallery record. The content hierarchy is Creator/Character → Gallery → Image/Video; galleries support a primary creator and additional creator links.

Keep API routers thin and business logic in services. Frontend requests go through the API client; React Query owns server state, while Zustand holds global interface state. Optional personal modules must remain optional in public checkouts.

Stored activity timestamps use UTC. Hall of Fame periods follow local calendar boundaries. Card print provenance and physical-copy ownership are distinct from editable presentation. Purchase and delivery retries must preserve transaction idempotency.

## Data configuration

| Item | Installed Windows app |
| --- | --- |
| Configuration | `%APPDATA%\TheVault\vault_config.json` |
| Default data directory | `%APPDATA%\TheVault\` |
| Database | `vault.db` in the configured data directory |
| Thumbnails | `thumbs/` in the configured data directory |

Development uses the backend configuration location. Inspect `backend/database.py` and the effective configuration before choosing an isolated development database. `VAULT_DB` overrides the database path only; original media and other configured resources have separate paths.

The Windows desktop viewer uses bundled libVLC to decode original local videos,
with frames shared in memory with the existing viewer. Browser and mobile clients
retain browser-compatible playback. `get_vlc.ps1` prepares the verified official
Windows runtime for packaging; the desktop build requires it. For native desktop
development, start the normal backend and Vite servers, then run
`backend\venv\Scripts\python.exe scripts\run_desktop.py`. Development can use an
installed VLC runtime if `tools/vlc` has not been prepared.

Changing the data directory through Settings writes configuration and restarts the application. Database backups do not include original media. Copies of the installed executable under the same Windows account share the installed configuration unless explicitly isolated.

## Frontend builds and mobile

Desktop production build:

```powershell
cd frontend
npm ci
npm run build
```

Mobile web build, served under `/m/`:

```powershell
cd frontend-mobile
npm ci
npm run build:pwa
```

The mobile client connects to the desktop backend over the local network. Android packaging uses the Capacitor project in `frontend-mobile/android/`; `npm run cap:sync` synchronizes the web build, and `npm run cap:open` opens the Android project.

## Validation

Project tests and temporary validation files have been moved into `TEST STUFF CAN DELETE/` at the user's request. The cleanup batch preserves their original relative paths and records each move in `MOVE-MANIFEST.json`. Restore the relevant files to those original paths before running archived tests; the archive may be deleted without affecting app operation or packaging. Build the affected frontend when changing application code, and verify interactive changes in the browser.

Use isolated data for migration, transaction, deletion, and installation checks. Preserve unrelated working-tree changes and avoid leaving temporary test artifacts in the repository.

## Windows packaging and releases

Run `build.bat` from the repository root. It checks version consistency, builds the desktop and mobile web apps, packages the backend and media tools, compiles the installer when Inno Setup is available, and stages release files.

`backend/app_version.py` defines the application version. Keep desktop/mobile package and lock files, Android display version, installer version, update template, and Windows executable metadata aligned. Android's numeric version code advances independently.

Check version consistency:

```powershell
backend\venv\Scripts\python.exe scripts\prepare_release.py --check
```

After manually compiling the installer, stage its download and integrity manifest:

```powershell
backend\venv\Scripts\python.exe scripts\prepare_release.py
```

Outputs:

- `dist\VaultSetup.exe`: Windows installer.
- `dist\cloudflare\VaultSetup.exe`: public download using the established installer filename.
- `dist\cloudflare\version.json`: update manifest containing the compiled installer's SHA-256 and size.

The root `version.json` is the source template; publish the generated staged manifest. Rebuild the packaged executable before compiling the installer. Preserve the installer AppId and data paths across upgrades.

Verify fresh installation, upgrade with copied data, and the update/relaunch flow. Upload `VaultSetup.exe` to the existing download URL first and verify its public size and hash. Publish the manifest last with `Cache-Control: no-cache, max-age=0, must-revalidate` and clear the installer and manifest caches. Keep the installer filename and download URL unchanged across releases; advance the application version for subsequent releases.

## Project conventions

Read [AGENTS.md](AGENTS.md) for architecture, visual rules, TCG contracts, asset tooling, and collaboration conventions. [CLAUDE.md](CLAUDE.md) points to the same shared instructions. Record user-facing changes in [CHANGELOG.md](CHANGELOG.md), and preserve [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and asset licenses.

### Release survey link

Edit `survey.url` in the published `version.json` to change the optional 2.0 survey destination without rebuilding the app. Keep the rest of the published manifest, including its installer checksum and size, unchanged. Set `survey.enabled` to `false` to disable the invitation. The app checks this configuration after 15 minutes of active use and uses its bundled link if the server is unavailable; configuration is cached for up to one hour. This request retrieves the link only and does not submit usage or survey responses. Opening the form or choosing Don’t ask again suppresses further invitations locally; Later defers it for 24 hours. A new installer must include this feature before users can receive the invitation.
