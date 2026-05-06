# APS — Automotive Platform System

VIN-centric automotive service marketplace connecting customers with mechanics for repairs, diagnostics, maintenance, and detailing. Every vehicle is permanently identified by VIN; service history persists across ownership changes.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run API server (port 8080, path `/api`)
- `pnpm --filter @workspace/mobile run dev` — run Expo mobile app (port 18115)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks + Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only; may prompt interactively)
- For non-interactive DB migrations, run SQL directly via: `cd lib/db && node -e "require('pg')..."`

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
  users.ts                         — users (referralCode, mechanicTier, certifications, loyaltyPoints)
  vehicles.ts                      — vehicles (plateNumber added)
  loyalty.ts                       — loyalty_points table
  referrals.ts                     — referrals table
lib/api-client-react/src/generated — generated React Query hooks + Zod schemas
artifacts/api-server/src/routes/   — Express route handlers
  auth.ts                          — register (referral code gen + referredBy), login, me
  vehicles.ts                      — CRUD + DELETE (closes ownership) + plateNumber
  jobs.ts                          — tier-filtered available jobs (detailers → detailing only)
  payments.ts                      — release + loyalty points award
  loyalty.ts                       — GET /loyalty + awardLoyaltyPoints()
  referrals.ts                     — GET /referral stats
  users.ts                         — PATCH accepts mechanicTier + certifications
artifacts/mobile/app/              — Expo screens (expo-router file-based)
  (customer)/index.tsx             — dashboard with Detailing + Rewards quick actions
  (customer)/vehicles.tsx          — plateNumber field + remove vehicle button
  (customer)/profile.tsx           — loyalty points card + referral link
  (mechanic)/profile.tsx           — tier badge, certification list, sign out
  (mechanic)/_layout.tsx           — 5 tabs: Dashboard/Available/Active/History/Profile
  (admin)/index.tsx                — admin dashboard with sign out button
  (admin)/users.tsx                — user management + mechanic tier promotion
  referral.tsx                     — referral code + loyalty tier + stats
  detailing.tsx                    — 4-package detailing booking flow
artifacts/mobile/context/AuthContext.tsx — auth state + token persistence
artifacts/mobile/data/obd2Codes.ts — comprehensive OBD2 P/B/C/U code database
artifacts/mobile/constants/colors.ts    — design tokens (light + dark)
artifacts/mobile/hooks/            — usePushNotifications, useColors
artifacts/mobile/utils/confirm.ts  — cross-platform confirm() / alertMessage() (web → window.confirm/alert; native → Alert.alert)
```

## Architecture decisions

- **VIN permanence:** Service history (`work_logs`) written immutably; persists across ownership transfers.
- **Role-based navigation:** Root layout redirects to `/(customer)`, `/(mechanic)`, or `/(admin)` based on `user.role`.
- **Payment escrow:** Work log submission creates `payments` record with `status = "held"`; admin releases it.
- **Auth token flow:** JWT stored in AsyncStorage; `setAuthTokenGetter` injects into all API requests.
- **setBaseUrl at top level:** Called outside React in `_layout.tsx` using `EXPO_PUBLIC_DOMAIN`.
- **Mechanic tiers:** detailer → technician → senior → master. Detailers see only detailing jobs. Admin promotes. Stored as `mechanic_tier` on users table.
- **Loyalty points:** 100 pts per completed job (customer), 500 pts referrer bonus, 200 pts welcome for joining via referral. `awardLoyaltyPoints()` in `loyalty.ts`.
- **Referral codes:** 8-char alphanumeric, auto-generated on registration. Stored as `users.referral_code` (unique, nullable).
- **Vehicle plate numbers:** Added to vehicles table. Required in UI when adding a new vehicle.
- **Certifications:** Stored as JSON string (`[]`) on users table. Mechanics self-add; displayed on profile.
- **Push notifications:** Expo Push API (no third-party). Mechanics notified on new jobs; customers on accept + completion.
- **Live location:** Mechanic GPS sent via `PUT /api/jobs/:jobId/mechanic-location` every 15s; customer polls every 10s.

## Product

- **Customer:** Register/login, add vehicles by VIN + plate, request services, book detailing (4 packages), track jobs live, view loyalty points + referral program, share referral code, rate mechanics
- **Mechanic:** Register/login (pending approval → detailer tier), browse/accept jobs (tier-filtered), update status, share GPS, submit work logs, add certifications, view profile with tier progression, access OBD2 + parts catalog
- **Admin:** Manage users, promote mechanic tiers, release payments, view platform dashboard, sign out

## User preferences

_None recorded yet._

## Gotchas

- Do NOT run `pnpm dev` at workspace root — use restart_workflow instead.
- `orval.config.ts` has `indexFiles: false` for zod output to avoid regeneration conflicts.
- `lib/db` must be rebuilt (`pnpm run typecheck:libs`) before API server typechecks pick up new schema exports.
- Mechanic registration sets `status = "pending"` and `mechanicTier = "detailer"` — admin must activate before they can work.
- `drizzle-kit push` may prompt interactively for unique constraints on existing tables — use direct SQL node script instead.
- `expo-location` requires foreground permission before GPS watch starts; the tracker screen handles this gracefully.
- PATCH `/api/users/:userId` accepts `mechanicTier` (admin only), `certifications` (self or admin), `status`/`name`/`phone`.
- **`<Link href asChild>` around a `<Pressable>` with `position: "absolute"` + `shadow*` styles crashes on web** with `Failed to set an indexed property [0] on 'CSSStyleDeclaration'`. Use `<Pressable onPress={() => router.push(...)} style={...}>` for FABs / floating buttons instead. Plain text-only Pressables wrapped in Link asChild are fine.
- **`Alert.alert` is a no-op on web** — buttons never fire `onPress`. Always use `confirm()` / `alertMessage()` from `@/utils/confirm` instead. (Web `window.confirm/alert` button text is not customizable, but the helper accepts `confirmText`/`cancelText` for native.)
- **Web tab bar overlap:** the bottom tab bar is `position: absolute, height: 84` on web. Tabbed `ScrollView`s need `paddingBottom` ≥ 100 (or `insets.bottom + 120` if also accommodating a safe-area inset).

## Pointers

- Expo skill: `.local/skills/expo/SKILL.md`
- pnpm workspace skill: `.local/skills/pnpm-workspace/SKILL.md`
- DB migrations: `.local/skills/pnpm-workspace/references/db.md`
- OpenAPI codegen: `.local/skills/pnpm-workspace/references/openapi.md`
