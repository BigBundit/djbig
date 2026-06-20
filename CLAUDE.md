# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

DJBIG is a rhythm game (similar to Guitar Hero / DJMAX) built with React + Vite for the frontend, Electron for the desktop shell, and a Node.js/Express backend. Version 2.0.0 adds a freemium model: the game is free but uploading custom mp3/mp4 requires a Premium account (one-time ฿199 via Stripe).

## Development Commands

Always run both processes simultaneously in separate terminals:

```bash
# Terminal 1 — backend server (Express + Vite dev middleware + WebSocket)
npm run dev

# Terminal 2 — Electron desktop app (requires Terminal 1 to be running first)
npm run electron:dev
```

### Build for distribution
```bash
npm run build             # Vite production build only
npm run electron:build    # Full production build → release/ folder
```

Local Windows build output goes to `D:\djbig-release\` (configured to avoid `release/` being locked by Electron).

## Architecture

### Dual-process dev setup
`server.ts` runs Express + Vite middleware + WebSocket all on port 3000. In dev mode, Electron loads `http://localhost:3000`. In production, Electron loads from the built `dist/` via a custom `app://` protocol registered in `electron/main.cjs`.

The `ELECTRON_DEV=1` env var (set by `npm run electron:dev` via cross-env) is what switches Electron between dev URL and production file loading.

### Frontend (React SPA)
All game logic lives in a single large component: **`App.tsx`**. Game state machine uses `GameStatus` enum from `types.ts`. Key subsystems:

- **Note generation**: `utils/audioAnalyzer.ts` — analyzes AudioBuffer, detects energy peaks, outputs `Note[]` with timing, lane, hold duration
- **Song storage**: `utils/songStorage.ts` — IndexedDB persistence for loaded songs
- **AI chart generation**: `services/geminiService.ts` — Gemini API for AI-assisted beatmap creation
- **Multiplayer**: WebSocket client in `App.tsx` communicating with the WS server in `server.ts`

Layout adapts across three modes detected at runtime: mobile (`isMobile`), desktop browser, and Electron (`isElectron = !!window.electronAPI`).

Electron-specific UI (title bar, window controls, opacity slider, resize presets S/M/L) only renders when `isElectron && !isElectronFullscreen`.

### Backend (`server/`)
| File | Purpose |
|---|---|
| `db.ts` | Turso (libSQL) client + `initDb()` — creates `users` table |
| `middleware.ts` | `requireAuth` — validates JWT Bearer token, attaches `userId`/`userEmail` to request |
| `authRoutes.ts` | `POST /api/auth/register`, `POST /api/auth/login` |
| `userRoutes.ts` | `GET /api/user/me`, `GET /api/user/plan` (auto-downgrades expired premium) |
| `paymentRoutes.ts` | Stripe Checkout: `POST /api/payment/create-checkout`, `POST /api/payment/webhook`, `GET /payment/success` |

The `/payment/success` route verifies the Stripe session directly and updates the DB — no Stripe CLI needed for local testing.

### Electron bridge (`electron/`)
- `main.cjs` — BrowserWindow, IPC handlers, custom `app://` protocol for production
- `preload.cjs` — exposes `window.electronAPI` to renderer via contextBridge

Available `window.electronAPI` methods: `resizeWindow`, `setOpacity`, `toggleAlwaysOnTop`, `minimizeWindow`, `closeWindow`, `setFullscreen`, `onFullscreenChange`, `openExternal`

### Auth & Freemium
- JWT (HS256, 30-day expiry), payload: `{ userId, email }` — plan is **never** stored in JWT
- Plan is always fetched from DB at runtime via `GET /api/user/plan`
- Upload buttons check `userPlan` state; free users see 🔒 and get shown the Upgrade Modal
- Token/user saved to `localStorage` under keys `authToken` and `authUser`; validated against server on Electron startup

## Environment Variables

Copy `.env.example` to `.env` — never commit `.env`:

```
TURSO_URL=libsql://...
TURSO_TOKEN=...
JWT_SECRET=...          # min 64 chars
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...   # optional for local dev
APP_URL=http://localhost:3000
```

Frontend uses `VITE_AUTH_API` to override the API base URL (defaults to `http://localhost:3000`).

## Key Constants (`constants.ts`)

| Constant | Value | Meaning |
|---|---|---|
| `BASE_FALL_SPEED_MS` | 2500 | ms for note to fall full lane height |
| `HIT_WINDOW_PERFECT` | ±45ms | Perfect timing window |
| `HIT_WINDOW_GOOD` | ±90ms | Good timing window |
| `HIT_WINDOW_MISS` | ±130ms | Miss cutoff |

## CI/CD

GitHub Actions (`.github/workflows/build.yml`) builds on push to `main` or `claude/*` branches:
- **macOS**: runs `sips -z 512 512 public/logodjbig.png` before electron-builder (icon size requirement)
- **Windows**: NSIS installer, no code signing (`WIN_CSC_LINK=""`)
- Both jobs use `--publish never` to prevent auto-release

## Multiplayer (WebSocket)

Rooms are in-memory `Map` on the server. Flow: `CREATE_ROOM` → `JOIN_ROOM` → `START_GAME` → `UPDATE_SCORE` (broadcast to opponent) → `GAME_FINISHED`. Room is deleted on disconnect. WebRTC signaling is also relayed through the same WS server via `SIGNAL` messages.
