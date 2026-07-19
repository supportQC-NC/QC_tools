# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Internal multi-tenant B2B tool for a hardware-store group ("Quincaillerie") in New Caledonia. It reads a legacy DBF/ERP dataset per company and exposes search, inventory, ordering, reception, and reporting/analytics screens. The codebase, comments, and UI are in **French** — follow that convention when writing code and comments.

## Commands

Run from the repo root:

- `npm run dev` — run backend (nodemon) + frontend (CRA) together via concurrently
- `npm run server` — backend only, `nodemon backend/server.js` (port 5000)
- `npm run client` — frontend only, `npm start --prefix frontend` (port 3000, proxies `/api` → 5000)
- `npm start` — production backend, `node backend/server.js`
- `npm run data:import` — seed Mongo with users/permissions/entreprises from `backend/data/*.js`
- `npm run data:destroy` — wipe seeded data
- `cd frontend && npm run build` — production React build (served by Express when `NODE_ENV=production`)
- `cd frontend && npm test` — CRA/Jest tests (react-scripts). There are no backend tests.

Env is loaded by `backend/loadEnv.js`, which **must stay the first import in `server.js`** (some services read env at module-load time). Copy `exemple.env` to `.env`.

## Two data sources (this is the core architecture)

The app is **not** a normal Mongo CRUD app. It has two distinct backends:

1. **MongoDB (Mongoose)** — the app's own state: users, permissions, entreprises, inventory sessions/zones, bipages, report subscriptions, app releases. Models in `backend/models/`.
2. **Legacy DBF files** — the ERP's read-only source of truth: articles, clients, suppliers, orders, proformas, invoices. Read with the `dbffile` package. This data is **never written back**.

Everything DBF-backed is **scoped per company** by the `:nomDossierDBF` route param. An `Entreprise` document maps `nomDossierDBF` + `trigramme` → filesystem paths (`cheminBase`, `cheminExportInventaire`, `cheminRapportReception`, etc.). Reading raw DBF on every request is too slow (~90k+ articles), so several **cache services** (`articleService.js`/`*CacheService.js`) load a company's DBF into an in-memory `Map` with prebuilt indexes (by NART, GENCOD, GROUPE…) and a ~5-minute TTL. When touching DBF reads, prefer the cache service over opening `DBFFile` directly.

### Dev/prod path switching

Company paths are stored as Windows UNC (`\\server\Bases\...`) for local dev on Windows. In production (Ubuntu), env vars override/translate them without any DB migration:
- `DBF_BASE_PATH` overrides `Entreprise.cheminBase` (getter on the model).
- `RCOMMON_STOCK_ROOT` translates export/collect paths, keeping the last path segment (e.g. `collect_sec`) per company.
- `STOCK_SHARE_PATH` for `.dat`/fiche-contrôle shares.
See the header comments in `backend/models/EntrepriseModel.js` for the exact rules.

## Permissions & auth

Auth is a **JWT stored in an httpOnly cookie named `token`** (not a Bearer header); the frontend uses `credentials: "include"`. CORS is configured with `credentials: true`.

Access control is **two-dimensional** — a user needs both the right *module* and the right *company*:

- `protect` — requires a valid token (`backend/middleware/authMiddleware.js`).
- `admin` — requires `role === "admin"`.
- `checkModuleAccess(moduleKey, action)` — per-module `read`/`write`/`delete`. Admins bypass module checks; regular users need `permission.modules[key][action]` or `allModules` (`backend/middleware/checkEntrepriseAccess.js`).
- `checkEntrepriseAccess` — company scoping via `:entrepriseId` or `:nomDossierDBF`. **Applies to admins too** — an admin has all modules but only the companies explicitly granted.
- `superAdmin` / `getAccessibleEntreprises` / `checkAnalyseAccess` — a **super-admin** is an admin with `allEntreprises` (or a legacy admin with no `Permission` doc). Super-admin is required for user/company management and gates analysis screens (`backend/middleware/accessControl.js`).

The list of permission modules lives in **`backend/config/adminModules.js`** and is **mirrored in `frontend/src/config/adminModules.js`** (which also maps route paths → module keys for `<ModuleRoute>`). When adding a module, update **both** files and `backend/models/PermissionModel.js`.

## Request flow / conventions

Backend follows routes → controllers → services:
- `backend/routes/*Routes.js` wire middleware chains (nearly always `protect` first, then `checkEntrepriseAccess` / `checkModuleAccess`).
- `backend/controllers/*Controller.js` are thin, wrapped in `asyncHandler` (`backend/middleware/asyncHandler.js`); errors flow to `notFound`/`errorHandler` in `errorMiddleware.js`.
- `backend/services/*` hold the real logic: DBF caching, Excel/PDF generation (`exceljs`, `pdfkit`), report delivery, path building (`utils/*Paths.js`).
- New routers must be both imported and `app.use()`-mounted in `backend/server.js` (all API under `/api/...`).

Frontend is **React 19 (CRA) + Redux Toolkit + RTK Query**:
- One store (`frontend/src/store.js`); all HTTP goes through `apiSlice.js` (RTK Query, `injectEndpoints` per feature slice in `frontend/src/slices/*ApiSlice.js`). Add new cache tags to the `tagTypes` array in `apiSlice.js`.
- Non-API state slices: `authSlice`, `entrepriseGlobalSlice` (currently selected company), `inventaireSelectionSlice`.
- Routing is defined in `frontend/src/index.js`. Route guards: `<PrivateRoute>` (logged in) and `<ModuleRoute module="...">` (permission-gated). Screens live in `screens/user/` and `screens/admin/`.
- `BASE_URL` in `frontend/src/constants.js` is `""` — the app assumes same-origin (dev proxy, or Express serving the build in prod).

## Background jobs

- **Inventory watcher** (`services/inventaireWatchService.js`): started by `startInventaireWatcher()` in `server.js`. Polls the company `.dat` export share, parses fiche-contrôle files, generates a PDF, and silently prints it via `pdf-to-printer` (SumatraPDF). Note this depends on a Windows print setup.
- **Report scheduler** (`services/reportScheduler.js`): a `node-cron` job (timezone `Pacific/Noumea`) that emails Excel report subscriptions with an optimistic `nextRunAt` lock to prevent double-sends. It exposes `startReportScheduler()` but is **not** currently called from `server.js` — wire it there if scheduled emails are expected.

## Notes

- Backend is **ESM** (`"type": "module"`); use `import`/`export`, and note `__dirname` is derived via `path.resolve()`.
- `.dbf` files are git-ignored; the `backend/data/*.dbf` fixtures are local sample data.
- Email uses `nodemailer` via `backend/utils/sendEmail.js` (SMTP config in `.env`).
