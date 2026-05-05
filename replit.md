# APS — Automotive Platform System

VIN-centric automotive service marketplace connecting customers with mechanics for repairs, diagnostics, maintenance, and detailing. Every vehicle is permanently identified by VIN; service history persists across ownership changes.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run API server (port 8080, path `/api`)
- `pnpm --filter @workspace/mobile run dev` — run Expo mobile app (port 18115)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks + Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)

**Required env vars:** `SESSION_SECRET` (JWT signing), `DATABASE_URL` (PostgreSQL)

## Stack

- **Monorepo:** pnpm workspaces, TypeScript 5.9, Node.js 24
- **API:** Express 5, esbuild (CJS bundle)
- **DB:** PostgreSQL + Drizzle ORM (`lib/db`)
- **Validation:** Zod (`zod/v4`), `drizzle-zod`
- **API codegen:** Orval from OpenAPI spec (`lib/api-spec`)
- **Mobile:** Expo (expo-router), React Native, React Query
- **Auth:** bcryptjs + jsonwebtoken (30-day JWT)

## Where things live

```
lib/api-spec/openapi.yaml          — full OpenAPI spec (source of truth)
lib/api-spec/orval.config.ts       — codegen config
lib/db/src/schema/                 — Drizzle table definitions
lib/api-client-react/src/generated — generated React Query hooks + Zod schemas
artifacts/api-server/src/routes/   — Express route handlers (auth, vehicles, jobs, worklogs, payments, dashboard)
artifacts/api-server/src/lib/      — auth.ts, notifications.ts
artifacts/api-server/src/middlewares/authenticate.ts — JWT auth middleware
artifacts/mobile/app/              — Expo screens (expo-router file-based)
artifacts/mobile/app/tracker/      — job status + live mechanic location tracker
artifacts/mobile/app/obd2/         — VIN-based OBD2 code lookup with repair instructions
artifacts/mobile/app/parts/        — VIN parts catalog + NHTSA recalls
artifacts/mobile/context/AuthContext.tsx — auth state + token persistence
artifacts/mobile/data/obd2Codes.ts — comprehensive OBD2 P/B/C/U code database
artifacts/mobile/constants/colors.ts    — design tokens (light + dark)
artifacts/mobile/hooks/            — usePushNotifications, useColors
```

## Architecture decisions

- **VIN permanence:** Service history (`work_logs`) is written immutably with `immutable_flag = true`. History persists across ownership transfers because records link to `vin`, not `user_id`.
- **Role-based navigation:** After login, Expo root layout redirects to `/(customer)` or `/(mechanic)` tabs based on `user.role`.
- **Payment escrow:** When a mechanic submits a work log, a `payments` record is created with `status = "held"`. Admin releases it, setting `status = "released"` and marking the job `PAID`.
- **Auth token flow:** JWT is stored in AsyncStorage; `setAuthTokenGetter` from `@workspace/api-client-react` injects it into all API requests automatically.
- **setBaseUrl at top level:** Called outside any React component in `_layout.tsx` using `EXPO_PUBLIC_DOMAIN` env var so it runs synchronously before any hook fires.
- **Push notifications:** Expo Push API (no third-party). `push_token` stored on `users` table. Mechanics notified on new jobs; customers notified on job accept + completion. Best-effort, fire-and-forget.
- **Live location:** Mechanic GPS (expo-location) sent via `PUT /api/jobs/:jobId/mechanic-location` every 15s; stored as `mechanic_lat/lng` on jobs table; customer polls every 10s via React Query refetch.
- **OBD2 database:** Local static file (`data/obd2Codes.ts`) with 40+ P/B/C/U codes, each with severity, driveability, causes, numbered repair steps, cost range, and affected systems. No API key needed.

## Product

- **Customer:** Register/login, add vehicles by VIN, request services, track job status in real time via live tracker, see mechanic GPS when en route, view per-VIN service history, transfer vehicle ownership, rate mechanics
- **Mechanic:** Register/login (pending approval), browse/accept jobs, update status, share live GPS location, submit work logs with parts + costs + photos, access parts catalog + OBD2 code lookup per vehicle, view earnings
- **Admin:** Manage users, release payments, view platform-wide dashboard

## User preferences

_None recorded yet._

## Gotchas

- Do NOT run `pnpm dev` at workspace root — use restart_workflow instead.
- `orval.config.ts` has `indexFiles: false` for zod output to avoid regeneration conflicts.
- `lib/db` must be rebuilt (`pnpm run typecheck:libs`) before API server typechecks pick up new schema exports.
- Mechanic registration sets `status = "pending"` — admin must activate before they can work.
- Job accept is limited to `REQUESTED` or `OFFERED` status; `CANCELLED` jobs cannot transition.
- `expo-location` requires foreground permission before GPS watch starts; the tracker screen handles this gracefully.

## Pointers

- Expo skill: `.local/skills/expo/SKILL.md`
- pnpm workspace skill: `.local/skills/pnpm-workspace/SKILL.md`
- DB migrations: `.local/skills/pnpm-workspace/references/db.md`
- OpenAPI codegen: `.local/skills/pnpm-workspace/references/openapi.md`
