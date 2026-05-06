# APS — Automotive Platform System

A VIN-centric automotive service marketplace connecting customers with mechanics for repairs, diagnostics, maintenance, and detailing, preserving service history across ownership changes.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run API server
- `pnpm --filter @workspace/mobile run dev` — run Expo mobile app
- `pnpm run typecheck` — full typecheck
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks + Zod schemas
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- For non-interactive DB migrations, run SQL directly via: `cd lib/db && node -e "require('pg')..."`

**Required env vars:** `SESSION_SECRET`, `DATABASE_URL`

## Stack

- **Monorepo:** pnpm workspaces, TypeScript 5.9, Node.js 24
- **API:** Express 5, esbuild
- **DB:** PostgreSQL + Drizzle ORM
- **Validation:** Zod, `drizzle-zod`
- **API codegen:** Orval from OpenAPI spec
- **Mobile:** Expo (expo-router), React Native, React Query
- **Auth:** bcryptjs + jsonwebtoken

## Where things live

```
lib/api-spec/openapi.yaml          — full OpenAPI spec (source of truth)
lib/db/src/schema/                 — Drizzle table definitions
artifacts/api-server/src/routes/   — Express route handlers
artifacts/mobile/app/              — Expo screens
artifacts/mobile/context/AuthContext.tsx — auth state + token persistence
artifacts/mobile/data/obd2Codes.ts — comprehensive OBD2 code database
artifacts/mobile/constants/colors.ts    — design tokens
artifacts/mobile/components/AIAssistantWidget.tsx — draggable floating AI chat widget
artifacts/mobile/app/loyalty.tsx   — unified loyalty screen (branches by role)
artifacts/api-server/src/lib/loyaltyEngine.ts — dual-ledger points engine (single source of truth)
artifacts/api-server/src/lib/referralEngine.ts — standalone referral system (isolated from loyalty)
lib/db/src/schema/loyaltyV2.ts     — customer/mechanic ledger + redemption tables
lib/db/src/schema/referrals.ts     — referrals + referral_events tables
lib/integrations-anthropic-ai/    — Replit AI Integrations Anthropic client
```

## Architecture decisions

- **VIN permanence:** Service history (`work_logs`) is immutable and persists across ownership transfers.
- **Role-based navigation:** Root layout redirects based on `user.role` to `/(customer)`, `/(mechanic)`, or `/(admin)`.
- **Payment escrow:** `payments` records are `held` until admin releases them upon work log submission.
- **Auth token flow:** JWT stored in AsyncStorage and injected into all API requests.
- **Mechanic tiers:** Progressive tiers (detailer → technician → senior → master), impacting job visibility.
- **Dual loyalty system:** Two parallel ledgers (`customer_points_ledger`, `mechanic_points_ledger`) driven by a single engine. Idempotency via partial unique index `(user/mechanic, job_id, source_type) WHERE points>0 AND job_id IS NOT NULL` + `onConflictDoNothing`. Refund webhooks reverse both ledgers. Redemptions are atomic (`SELECT … FOR UPDATE` + in-tx balance check). Mechanic upsells only earn points when `customerApproved === true`.
- **Standalone referral system:** Isolated user-acquisition engine in `referralEngine.ts`. Writes ONLY `source_type="referral"` rows to the customer ledger via `awardCustomerPoints` — does not compute spending/review/survey/mechanic/tier points. Codes use `APS-XXXXXX` format. Conversion gates: referred user's FIRST captured payment + no refund. Atomic via `SELECT … FOR UPDATE` row lock; `pointsAwarded` is only stamped after the loyalty ledger insert succeeds (UI shows `pending` → `converted` → `rewarded`). `unique(referred_id)` enforces one referral per referred user. Refund path calls `revertReferralForJob` to un-convert + reverse points. Self-referral and same-address abuse heuristics block at signup.
- **User home address & Mechanic service radius:** Captured at registration and verified via Nominatim for location-based services.
- **AI Assistant:** Floating widget with ephemeral chat history, providing context-aware assistance via Anthropic.
- **Bidirectional reviews:** Customers and mechanics rate each other, with aggregate ratings and review lists.
- **Stripe payments:** PCI-compliant via Stripe Checkout with manual capture, 10% platform fee, and Connect Express onboarding for mechanics.

## Product

- **Customer:** Register, add vehicles, request/track services, book detailing, browse/select mechanics, rate/review/report mechanics, view loyalty points/referrals.
- **Mechanic:** Register (pending approval), browse/accept jobs (tier-filtered), update status, share GPS, submit work logs, add certifications, rate/review/report customers, view profile, access OBD2/parts catalog.
- **Admin:** Manage users, promote mechanic tiers, release payments, resolve user reports, view platform dashboard.

## User preferences

_None recorded yet._

## Gotchas

- Do NOT run `pnpm dev` at workspace root — use restart_workflow instead.
- `orval.config.ts` has `indexFiles: false` to avoid regeneration conflicts.
- `lib/db` must be rebuilt (`pnpm run typecheck:libs`) before API server typechecks pick up new schema exports.
- Mechanic registration sets `status = "pending"` and `mechanicTier = "detailer"` — admin must activate.
- `drizzle-kit push` may prompt interactively; use direct SQL node script for non-interactive migrations.
- `expo-location` requires foreground permission before GPS watch starts.
- `<Link href asChild>` around a `<Pressable>` with `position: "absolute"` + `shadow*` styles crashes on web. Use `<Pressable onPress={() => router.push(...)} style={...}>` instead.
- `Alert.alert` is a no-op on web; use `confirm()` / `alertMessage()` from `@/utils/confirm` instead.
- Stripe webhook MUST be mounted with `express.raw()` BEFORE `express.json()` in `app.ts` for signature verification.
- Legacy `loyalty_points` table is retained as historical data only — all NEW awards go through `loyaltyEngine.ts` and write to `customer_points_ledger` / `mechanic_points_ledger`. `users.loyalty_points` (customer) and `users.mechanic_points` (mechanic) are cached SUMs of the respective ledger and recomputed after every mutation.
- Web tab bar overlap: `ScrollView`s in tabbed layouts need `paddingBottom` ≥ 100 on web.

## Pointers

- Expo skill: `.local/skills/expo/SKILL.md`
- pnpm workspace skill: `.local/skills/pnpm-workspace/SKILL.md`
- DB migrations: `.local/skills/pnpm-workspace/references/db.md`
- OpenAPI codegen: `.local/skills/pnpm-workspace/references/openapi.md`