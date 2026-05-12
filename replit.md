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
artifacts/mobile/utils/haptics.ts  — cross-platform haptic feedback wrapper (no-op on web, safe on native)
artifacts/mobile/STORE_RELEASE.md  — Apple App Store + Google Play Store release guide
artifacts/mobile/eas.json          — EAS Build/Submit profiles (development, preview, production)
artifacts/mobile/app/loyalty.tsx   — unified loyalty screen (branches by role)
artifacts/mobile/app/job/[id]/approve.tsx — 60s customer-approval screen
artifacts/mobile/app/review/[jobId].tsx   — categorized review submit screen
artifacts/api-server/src/routes/reviews.ts            — reviews API (submit, list, edit, moderate, /reputation, /badges/catalog, /admin/reviews/recent, /admin/trust/overview)
artifacts/api-server/src/routes/customerApprovals.ts  — /approvals/* endpoints (fires push to mechanic on approve/decline)
artifacts/mobile/app/profile/[id].tsx                 — public trust profile (any user, role-aware)
artifacts/mobile/app/(admin)/trust.tsx                — admin trust dashboard: leaderboard + moderation queue
artifacts/api-server/src/lib/reviewCategories.ts      — 8 categories per direction
artifacts/api-server/src/lib/reviewVisibility.ts      — 72h lock + reciprocation publish
artifacts/api-server/src/lib/reputationEngine.ts      — full per-user reputation recompute + trust score
artifacts/api-server/src/lib/badgeEngine.ts           — code-defined badge auto-award/revoke
artifacts/api-server/src/lib/customerApprovalEngine.ts — 60s approve/decline/auto-approve state machine
artifacts/api-server/src/lib/partsCompatibilityEngine.ts — PARTS_CATEGORIES + computeCompatibility() (high/medium/verify, prior-install promotion, override surfacing)
artifacts/api-server/src/routes/transport.ts        — vehicle-transport leg API (list + start + finish + GPS heartbeat)
artifacts/api-server/src/lib/transportKeywords.ts   — `requiresLiftFromDescription()` keyword detector (tires/exhaust/transmission/suspension)
artifacts/api-server/src/lib/payoutHoldEngine.ts     — 24h customer-confirmation escrow + atomic captureNow() (captureFired lock w/ release-on-block); reads ACTUAL parts cost from `parts_items` (fallback to estimate) and snapshots taxCents/stripeFeeCents/partsCostAppliedCents/laborRevenueCents/netProfitCents on payment row
artifacts/api-server/src/lib/financialEngine.ts      — canonical True Net Profit `computeBreakdown()` + customer-safe `customerInvoiceView()` (tier-aware, defaults to "detailer" when null)
artifacts/api-server/src/lib/fraudHeuristics.ts      — parts/labor anomaly heuristic (parts >> labor, missing receipts, etc.) — returns flag + reason
artifacts/api-server/src/routes/invoice.ts           — GET /jobs/:id/invoice — IDOR-gated (customer/mechanic/admin), NEVER includes commission/payout/internal numbers
artifacts/api-server/src/routes/adminFinance.ts      — admin-only /admin/finance/{global,jobs,jobs/:id,mechanics,flagged}
lib/db/src/schema/partsItems.ts                      — `parts_items` table (itemized receipt rows: name, brand, partNumber, supplier, qty, unitPriceCents)
artifacts/mobile/app/job/[id]/invoice.tsx            — customer invoice screen (no internal numbers)
artifacts/mobile/app/(admin)/finance.tsx             — admin financial dashboard (global / mechanics / flagged tabs)
artifacts/api-server/src/lib/disputeEngine.ts        — Stripe chargeback mirror + status mapping; freezes payment + admin/mechanic notify
artifacts/api-server/src/lib/tipEngine.ts            — separate tip Checkout, 100% to mechanic by default; pre-inserts tip row so PI metadata.tipId is the webhook fallback when PI succeeds before checkout.session.completed
artifacts/api-server/src/lib/payoutEventEngine.ts    — append-only payout_events timeline (transfer.*, payout.*, capture, retry, dispute)
artifacts/api-server/src/lib/payoutSchedulerInit.ts  — 60s tick: sweepExpiredConfirmations + sweepStaleHolds
artifacts/api-server/src/routes/workConfirmations.ts — /work-confirmations/{job/:jobId,:jobId/confirm,:jobId/dispute,sweep}
artifacts/api-server/src/routes/tips.ts              — /tips/jobs/:jobId, /tips, /tips/job/:jobId
artifacts/api-server/src/routes/disputes.ts          — /disputes, /disputes/:id, /admin/disputes/:id/resolve (auto-retries capture on resolved_mechanic)
artifacts/api-server/src/routes/payouts.ts           — /payouts/{summary,buckets,jobs,events,job/:id,:jobId/retry,tax-documents,connect/*,job/:jobId/destination,shop/onboarding,shop/status}
artifacts/mobile/app/job/[id]/confirm-work.tsx       — customer 24h "approve work or dispute" with live countdown
artifacts/mobile/app/job/[id]/tip.tsx                — separate tip Checkout (presets + custom)
artifacts/mobile/app/mechanic/payouts/index.tsx      — payout dashboard (window toggle, status buckets, recent jobs, event timeline, 1099 deep-link)
artifacts/mobile/app/mechanic/payouts/[jobId].tsx    — per-job payout detail w/ retry
artifacts/mobile/app/(admin)/disputes.tsx            — admin dispute queue + resolve modal (chargebacks restricted to under_review)
lib/db/src/schema/workConfirmations.ts               — work_confirmations (unique jobId) + captureFired text-flag claim lock
lib/db/src/schema/disputes.ts                        — disputes (kind: customer_filed | stripe_chargeback, unique providerDisputeId)
lib/db/src/schema/tips.ts                            — tips (separate PI, mechanicAmountCents)
lib/db/src/schema/payoutEvents.ts                    — payout_events append-only timeline
artifacts/mobile/app/transport/[jobId].tsx          — customer + mechanic transport screen (outbound + return legs, mileage prompts, live GPS, Android `MileagePromptHost` mounted in root layout)
lib/db/src/schema/transportLegs.ts                  — `vehicle_transport_legs` table
artifacts/api-server/src/routes/mechanicWorkspace.ts — ALL /mechanic/* endpoints (single chokepoint requireMechanicOrAdmin gates EVERY route)
lib/db/src/schema/mechanicWorkspace.ts — mechanic_vehicle_profiles, installed_parts (partial unique active rows), mechanic_vehicle_notes, vehicle_recommendations
artifacts/mobile/app/mechanic/vin.tsx — VIN entry/decoder screen
artifacts/mobile/app/mechanic/workspace/[vin].tsx — full Vehicle Intelligence Workspace (8 tabs)
artifacts/mobile/components/VehicleDiagram.tsx — clickable component diagram
lib/db/src/schema/reviews.ts          — reviews + review_audit_logs tables
lib/db/src/schema/customerApprovals.ts — customer_approvals table (unique per job)
lib/db/src/schema/badges.ts           — user_badges (partial unique on active rows)
lib/db/src/schema/userReputation.ts   — cached reputation aggregates per user
artifacts/api-server/src/lib/loyaltyEngine.ts — dual-ledger points engine (single source of truth)
artifacts/api-server/src/lib/referralEngine.ts — standalone referral system (isolated from loyalty)
lib/db/src/schema/loyaltyV2.ts     — customer/mechanic ledger + redemption tables
lib/db/src/schema/referrals.ts     — referrals + referral_events tables
lib/integrations-anthropic-ai/    — Replit AI Integrations Anthropic client
lib/tier-catalog/src/index.ts     — TIERS (5), full ~64-service JOB_CATALOG, COMMISSION rates, commissionForJob/splitCents/mechanicQualifiedFor/isWorkingDown helpers (single source of truth shared by api-server + mobile)
artifacts/api-server/src/routes/tierCatalog.ts — public GET /tier-catalog (tiers + services + commission)
artifacts/mobile/app/mechanic/earnings.tsx     — "How Much Can You Earn?" page (rate cards + live calculator + tier ladder + service catalog)
```

## Auth & access control

- **JWT + bcrypt**, 7-day token TTL. `SESSION_SECRET` is required and must be ≥32 chars in production (`lib/auth.ts` throws on startup otherwise); a dev-only fallback applies when `NODE_ENV !== "production"`.
- **`authenticate` middleware** (`middlewares/authenticate.ts`) verifies the JWT THEN reloads the user from the DB on every request, attaches `req.user` (`{id, role, status, email, name}`), and rejects suspended accounts with 403. Status/role changes therefore take effect on the next request.
- **`requireActiveMechanic`** is the single chokepoint for sensitive mechanic actions (accept job, GPS push, submit work log, Stripe Connect onboarding/status, mechanic loyalty redemption, browse `/jobs/available`, view REQUESTED job details). Pending mechanics can still log in and hit `/auth/me` so the mobile app shows the "awaiting approval" screen.
- **IDOR guards** on all per-resource GET/PATCH endpoints. `vehicles.ts` uses a shared `canAccessVehicle()` helper: admin OR current/past owner OR mechanic with a job whose status is in `{ACCEPTED, EN_ROUTE, IN_PROGRESS, COMPLETED, PAID}` (cancelled/refused jobs do NOT grant access). `worklogs/:id`, `worklogs/vin/:vin`, `jobs/:id`, `jobs/:id/status`, `ownership/:vehicleId` all enforce role-scoped access.
- **Login** rejects suspended users with 403; pending mechanics are allowed through.

## Architecture decisions

- **VIN permanence:** Service history (`work_logs`) is immutable and persists across ownership transfers.
- **Role-based navigation:** Root layout redirects based on `user.role` to `/(customer)`, `/(mechanic)`, or `/(admin)`.
- **Payment escrow (current flow):** Stripe Checkout authorizes with `capture_method="manual"` → on work-log submission, payment moves to `capture_pending` and a 24h `work_confirmations` row opens → customer Confirm captures immediately, Dispute freezes + opens dispute, silence past 24h auto-confirms via the 60s scheduler tick. Admin no longer needs to manually release happy-path payments. See `payoutHoldEngine.ts`.
- **Auth token flow:** JWT stored in AsyncStorage and injected into all API requests.
- **Mechanic tiers (5-tier ladder):** detailer → technician → senior → advanced → master. The shared `@workspace/tier-catalog` lib is the single source of truth for tier definitions, the ~64-service catalog, and the three commission rates: same-tier 20/80, working-down 25/75, detailing always 15/85. Visibility on `/jobs/available?mode=my_tier|work_down` is strict — mechanics NEVER see jobs above their tier; default mode shows only exact-tier (+ legacy null-tier rows treated as detailer); `mode=work_down` shows everything at-or-below. `POST /jobs/:id/accept` re-checks tier with `mechanicQualifiedFor` inside the same `FOR UPDATE` tx (returns 403). Customer service picker writes `serviceSlug` and the server derives `jobType` + `requiredTier` from the catalog — clients can't disagree with the server about what tier a job is.
- **True Net Profit commission model (v2 — actual parts + tax + Stripe fees):** APS commission applies ONLY to `(labor revenue − optional Stripe-fee)`, NEVER to parts cost or sales tax. Mechanic gets 100% of the parts-cost passthrough + 100% of tax passthrough + their tier-share (75/80/85%) of net profit. **Source of truth at capture is the actual itemized `parts_items` table** (sum of qty × unitPriceCents per active worklog), with fallback to the legacy estimate from `partsCostPctFor(svc)`. `financialEngine.computeBreakdown(amountCents, taxCents, partsCostCents, commission, deductStripeFee)` is the single canonical wrapper; called from `payments.ts` at authorization (estimate snapshot) and `payoutHoldEngine.captureNow()` at capture (actual snapshot). Snapshot fields stamped on `payments`: `taxCents`, `stripeFeeCents`, `partsCostAppliedCents`, `laborRevenueCents`, `netProfitCents`. Tax is collected via a separate Stripe Checkout line item (clamped 0–15%) and stamped on both `jobs.taxCents` and `payments.taxCents`. Stripe fee is backfilled on `payment_intent.succeeded` from the `balance_transaction.fee` (charge expansion). The synced `payments.amountCents` at worklog submission preserves `taxCents` so capture sees subtotal+tax. Customer invoice (`/jobs/:id/invoice`) is intentionally airgapped — uses `customerInvoiceView()` which exposes only labor / parts (itemized) / tax / total; commission, payout, fee, and internal IDs never leave the server. Fraud heuristic (`fraudHeuristics.ts`) flags suspicious parts-vs-labor ratios on worklog submit (`worklogs.flaggedForReview`) and is surfaced to admins via `/admin/finance/flagged`. Legacy `splitCents()` is retained for tip pass-through.
- **Dual loyalty system:** Two parallel ledgers (`customer_points_ledger`, `mechanic_points_ledger`) driven by a single engine. Idempotency via partial unique index `(user/mechanic, job_id, source_type) WHERE points>0 AND job_id IS NOT NULL` + `onConflictDoNothing`. Refund webhooks reverse both ledgers. Redemptions are atomic (`SELECT … FOR UPDATE` + in-tx balance check). Mechanic upsells only earn points when `customerApproved === true`.
- **Standalone referral system:** Isolated user-acquisition engine in `referralEngine.ts`. Writes ONLY `source_type="referral"` rows to the customer ledger via `awardCustomerPoints` — does not compute spending/review/survey/mechanic/tier points. Codes use `APS-XXXXXX` format. Conversion gates: referred user's FIRST captured payment + no refund. Atomic via `SELECT … FOR UPDATE` row lock; `pointsAwarded` is only stamped after the loyalty ledger insert succeeds (UI shows `pending` → `converted` → `rewarded`). `unique(referred_id)` enforces one referral per referred user. Refund path calls `revertReferralForJob` to un-convert + reverse points. Self-referral and same-address abuse heuristics block at signup.
- **User home address & Mechanic service radius:** Captured at registration and verified via Nominatim for location-based services.
- **AI Assistant:** Floating widget with ephemeral chat history, providing context-aware assistance via Anthropic.
- **Bidirectional reviews (Trust System v2):** 8 categories per direction, 1-5 star scale, optional text + photos. Visibility lock: every review is `hidden` until either the counterpart submits OR `submittedAt + 72h` passes — eliminates retaliation reviews. Every public read surface (`/reviews/user/:id`, `/reviews/job/:id`) lazy-runs `publishExpiredHiddenReviews()` so the 72h unlock is honoured regardless of cron. **Edits are frozen the moment a review becomes visible** (PATCH returns 409 if `visibility !== "hidden"`) — closes the retaliation loophole where an author could read the published counterpart and edit theirs. Edits create append-only `review_audit_logs` entries with full before/after snapshots. Admin moderate-remove logs the actor + reason and triggers reputation+badge recompute. Authors always see their own hidden reviews; admins see everything via `/admin/reviews/recent` (intentionally bypasses the lock for moderation).
- **Customer mechanic-approval flow:** `/jobs/:id/accept` is fully transactional — it `SELECT … FOR UPDATE`s the job row, conditionally updates only if status is still `REQUESTED`/`OFFERED`, and inserts the 60s `customer_approvals` row in the SAME tx (so we can never end up in `PENDING_APPROVAL` without a matching approval row). Customer screen `/job/[id]/approve` shows the mechanic's full reputation snapshot + badges with a live countdown. Approve → ACCEPTED. Decline → REQUESTED + mechanic cleared (re-dispatched). Silence past 60s → server sweeper auto-approves. The `fireApprovalAcceptedNotifications(jobId)` helper is the single source of truth for "job became ACCEPTED" push notifications — called from manual approve, lazy sweep, AND bulk sweep so notifications fire regardless of which path triggered the transition.
- **Reputation engine:** `recomputeUserReputation(userId)` does a full recompute over visible reviews where the user is the subject + behavioural metrics from jobs (completion / cancellation / no-show / repeat-customer rates). Trust score 0..100 with documented weighting: base 50, +up to 30 from rating avg, +10 from completion, +10 from review-volume saturation, −25× cancellation rate, −15× no-show rate. Recomputed after every visibility flip / edit / moderation. Cached in `user_reputation`.
- **Badge engine:** Definitions in code (`badgeEngine.ts`), not DB — adding a badge ships without migrations. Auto-award/revoke runs after every reputation recompute. `user_badges` partial unique index `(user_id, badge_key) WHERE revoked_at IS NULL` prevents double-active rows; revoking inserts `revoked_at` so award history is preserved.
- **Stripe payments:** PCI-compliant via Stripe Checkout with manual capture, 10% platform fee, and Connect Express onboarding for mechanics.
- **Vehicle transport (ghost-garage jobs):** `requiresGhostGarage` is now auto-derived server-side in `POST /jobs` from the description (tires/exhaust/transmission/suspension keywords) — clients can no longer toggle it. Customers must still approve transport via `/jobs/:id/transport-approval` (auto-approval is granted only for non-ghost jobs). Each ghost-garage job tracks two legs in `vehicle_transport_legs` (outbound + return) with `start_mileage` BEFORE driving and `end_mileage` AFTER arrival. Start-leg is gated by 4 checks inside a single `FOR UPDATE` tx: assigned mechanic + `requires_ghost_garage = true` + `customer_transport_approved = true` + no completed leg already exists in this direction (hard-cap one outbound + one return). Finish is atomic via conditional `WHERE id = ? AND status = 'in_progress'`. Mechanic GPS heartbeats (`watchPositionAsync`, 15s/50m) write `last_lat/lng/at`; customer screen polls every 12s while a leg is active. Cross-platform mileage prompt: iOS `Alert.prompt`, web `window.prompt`, Android renders `<MileagePromptHost />` (mounted once in `app/_layout.tsx`).
- **24h escrow hold + customer work-confirmation:** When the mechanic submits a work log, `openWorkConfirmation()` puts the payment into `capture_pending` (NOT captured) and inserts a `work_confirmations` row with `expiresAt = +24h`. Customer sees `/job/[id]/confirm-work` with a server-driven countdown (server is source of truth for `secondsRemaining`). Confirm → immediate capture; Dispute → freezes payment (`captureBlockedReason="dispute"`, `status="disputed"`) and opens an internal `disputes` row + notifies mechanic AND admins; silence past 24h → 60s sweep `auto_confirms` and captures. Capture is gated by an atomic claim on `work_confirmations.captureFired` (text "false"→"true" via conditional UPDATE); EVERY non-capture early-return resets the flag so a future retry (e.g. dispute resolved in mechanic's favor) can fire — no permanent dead-locks. Admin "resolve in mechanic's favor" auto-calls `manualRetryCapture()` to release funds without a second admin step.
- **Disputes (in-app + Stripe chargebacks):** Single `disputes` table with `kind ∈ {customer_filed, stripe_chargeback}`. Customer-filed routes through `applyWorkDecision` (notifies mechanic + all admins). Stripe `charge.dispute.*` webhooks call `recordStripeDispute()` which freezes the payment and mirrors Stripe's status (`open`/`under_review`/`resolved_customer`/`resolved_mechanic`). Stripe-chargeback rows are owned by Stripe — admins can only mark `under_review` for triage; resolution outcomes flow from Stripe webhooks.
- **Tipping:** Separate Stripe Checkout + PaymentIntent — `tipEngine.createTipCheckout()` pre-inserts the `tips` row to obtain an id, then embeds `metadata.tipId` on the PI. The webhook handles `payment_intent.succeeded` BEFORE the regular payment path, with a metadata fallback that stamps `providerPaymentIntentId` on the tips row if PI succeeds before `checkout.session.completed` lands — eliminates the webhook-ordering race. 100% to mechanic by default (`getTipPlatformFeePct()=0`); fee-pct is a single source of truth for future admin-configurable cuts. Tips are gated on job status `COMPLETED` or `PAID`.
- **Per-job payout destination toggle (shop owner / admin):** `PATCH /payouts/job/:jobId/destination` stamps `payments.{payoutDestination, shopId, shopSplitPct}` and is honoured at Stripe authorization time — `payments.ts` checkout reads the existing payment row's destination and routes `transfer_data.destination` to the shop's connected account when `payoutDestination="shop"` (validates `shop.stripeAccountReady`). Toggle is only allowed on `pending`/`authorized`/`capture_pending` rows; `authorized` rows trigger an automatic PI cancel + new checkout because Stripe `transfer_data.destination` is fixed at PI creation. `"split"` mode persists schema/UI state and routes to mechanic at capture; the secondary post-capture transfer to shop is intentionally left as a follow-up (logged via payout_events when wired).
- **Payout dashboards & timeline:** Mechanic `/mechanic/payouts` shows captured/pending/tips/fees per window (today/week/month/year), status buckets, recent payouts, and an event timeline backed by `payout_events` (transfer.created/reversed, payout.paid/failed/canceled, capture, retry, dispute_*). Failed captures expose a Retry button (`POST /payouts/:jobId/retry` → `manualRetryCapture()`). 1099/tax-documents link goes through `/payouts/tax-documents` which mints a Stripe Express Dashboard login link via Connect.
- **Vehicle Intelligence Workspace (mechanic+admin only):** VIN-keyed dealership-grade operating screen. `/mechanic/*` routes are gated by a SINGLE `requireMechanicOrAdmin` chokepoint — customers (and pending mechanics) get 403 on every endpoint. NHTSA vPIC decode is cached per-VIN in `mechanic_vehicle_profiles`. Opening a workspace by VIN is idempotent: `/mechanic/workspace/by-vin/:vin` lazily creates the `vehicles` row + profile if APS hasn't seen the VIN. Installed-parts uses a "replace-on-install" pattern (any active row in the same category becomes `removed` with reason "Superseded by new install" before the new row inserts) — preserves history while keeping the active list correct via partial unique index `(vehicle_id, category) WHERE removed_at IS NULL`. Compatibility engine promotes confidence to `high` when the same vehicle has a prior install record, and surfaces the most recent mechanic override so the next mechanic sees why someone deviated. Diagram lookup overlays NHTSA decode + currently-installed parts so a tap on "front brakes" shows OEM hint + the actual pads/rotors on this VIN.

## Product

- **Customer:** Register, add vehicles, request/track services, book detailing, browse/select mechanics, rate/review/report mechanics, view loyalty points/referrals.
- **Mechanic:** Register (pending approval), browse/accept jobs (tier-filtered), update status, share GPS, submit work logs, add certifications, rate/review/report customers, view profile, access OBD2/parts catalog.
- **Admin:** Manage users, promote mechanic tiers, release payments, resolve user reports, view platform dashboard.

## User preferences

_None recorded yet._

## Store release (mobile)

- **Bundle IDs:** iOS `com.aps.autoservice`, Android `com.aps.autoservice`. Don't change these post-launch — Apple/Google treat the bundle ID as the app's permanent identity.
- **Permission strings:** All iOS `NSxxxUsageDescription` keys are declared in `app.json` → `expo.ios.infoPlist`, mirrored on Android via the `expo-image-picker` and `expo-location` plugin config. App Store rejects builds that hit a native permission API without a matching `NSxxxUsageDescription` — keep these in sync if a new native API is added.
- **Edge-to-edge Android:** `android.edgeToEdgeEnabled: true` + `<StatusBar translucent />` in the root layout. Screens MUST use `useSafeAreaInsets()` (not legacy `<SafeAreaView>` only) for top/bottom padding because content draws under the status & nav bars.
- **System-UI flash:** Root `_layout.tsx` calls `SystemUI.setBackgroundColorAsync()` on theme changes so Android doesn't flash white between splash teardown and first JS frame in dark mode.
- **Versioning:** EAS production profile uses `autoIncrement: true` — iOS `buildNumber` and Android `versionCode` bump server-side per build. Bump `expo.version` (the marketing version, e.g. `1.0.0` → `1.0.1`) manually in `app.json` for any user-visible release.
- **Credentials:** Never commit `google-services.json`, `google-play-service-account.json`, `GoogleService-Info.plist`, or `AuthKey_*.p8` — all gitignored. Place them locally before running `eas build` / `eas submit`.
- **Haptics:** Use `import { tap, success, warning, error, selection } from "@/utils/haptics"` — never import `expo-haptics` directly. The wrapper no-ops on web and swallows errors so haptics never break the UI.
- **EAS project setup:** Three TODOs to fill BEFORE first build — `app.json` → `expo.owner` and `expo.extra.eas.projectId` (from `eas init`), and `eas.json` → `submit.production.ios.{appleId,ascAppId,appleTeamId}`. Full walkthrough in `artifacts/mobile/STORE_RELEASE.md`.

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