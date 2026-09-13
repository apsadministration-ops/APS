# Part 7 — Initial Payments and Mobile Checks (4–6)

**Checked:** 2026-09-13 (UTC)  
**Scope:** Existing Stripe webhook warning, payment behavior, development
configuration, and native/physical-device test availability.  
**Safety boundary:** No live money operation, Stripe entity mutation, endpoint
creation/deletion, production mutation, browser tester launch, workflow launch,
or credential value read/logged was performed.

This is an evidence record, not a production-readiness approval. The
development Stripe connector is present, but the checks below do not prove
that a particular endpoint secret matches the endpoint, that a signed event
has been delivered, or that live settlement is enabled.

## Executive result

| Area | Result | Classification |
| --- | --- | --- |
| Existing webhook warning | The warning is an intentional fail-closed readiness diagnostic. It is emitted when the webhook signing secret is absent/invalid or the read-only connector inspection cannot complete. | Configuration/environment blocker when present; not evidence of a charge failure |
| Stripe processing | Raw-body signature verification, event-id deduplication, server-side pricing, manual capture, and state guards are present in source. | Static/code evidence only |
| Mobile payment authorization | A confirmed UI defect hid checkout from shop-owner commercial principals even though the API accepts that customer-of-record role. Fixed in the mobile payment-owned screen. | Confirmed defect, fixed |
| Mobile fee display | Admin UI labeled every platform fee as `10%`, while backend commission is dynamic. Changed only the label to `Platform fee`; no amount or fee rule changed. | Confirmed display defect, fixed |
| Shop payout destination | The shop onboarding route writes a Connect account to the owner row, while shop-destination checkout validates the shop row. The route is not called by the current mobile app and was not redesigned in this pass. | Confirmed code-path mismatch; deferred payment-owned follow-up |
| Test-mode delivery | No signed Stripe CLI delivery or test-mode Checkout was run. | Uncertified limitation |
| Native/physical device | No physical devices are registered, no signed EAS build was verified, and no device run is claimed. Existing web/static bundle evidence is not native-device evidence. | Uncertified limitation |

## Method and evidence boundaries

Inspected the actual source under `artifacts/api-server/src` and
`artifacts/mobile`, the workspace and artifact package configuration, the
existing payment/security documents, and the Expo metadata. Read the Stripe,
monetization, integrations, and environment-secrets skill instructions before
checking configuration.

The approved environment-status tool was used only to summarize presence/status.
It returned presence for the development-requested Stripe and runtime keys,
including `STRIPE_WEBHOOK_SECRET`, `STRIPE_SECRET_KEY`,
`STRIPE_PUBLISHABLE_KEY`, `DATABASE_URL`, connector identity, and Replit
domain metadata. Secret values and environment values were not printed or
copied. The integrations status showed:

* Stripe connection: `added` (`connection` status).
* A separate Stripe MCP listing: `not_setup`; it was not needed for this
  source/configuration audit and was not proposed.

Presence is not validity. In particular, this check did not inspect a key
prefix, compare a secret with a Dashboard endpoint, infer test/live mode from a
secret, or use a provider API to create or mutate anything.

No development database fixture was created. No fixture data was inserted,
updated, or deleted by this pass, so there was no fixture cleanup operation to
perform.

## Check 4 — Existing Stripe webhook warning

### What the server actually does

* `artifacts/api-server/src/app.ts:35–45` mounts
  `express.raw({ type: "application/json" })` only at
  `/api/stripe/webhook`, before `express.json()` and the rest of `/api`.
  This preserves the raw bytes required for Stripe signature verification
  without breaking JSON routes.
* `artifacts/api-server/src/app.ts:68–70` invokes `initStripeWebhook()` at
  startup without provisioning an endpoint.
* `artifacts/api-server/src/lib/stripeInit.ts:7–29` passes the configured
  `STRIPE_WEBHOOK_SECRET` to the read-only inspection helper. A configured
  secret produces an informational readiness message; every other result
  produces the explicit `Stripe webhook NOT ready` error. Connector inspection
  failures produce a generic error without logging provider error objects.
* `artifacts/api-server/src/lib/stripeWebhookSetup.ts:38–44` accepts only a
  nonblank `whsec_`-prefixed value with more than the prefix. This is a
  syntactic check, not proof that the value belongs to the intended endpoint.
* If no secret is supplied but a valid domain is available, the helper lists
  existing endpoints and reports matching URL/event gaps. It does not create,
  edit, or delete endpoints. Invalid/missing domains fail closed rather than
  constructing an `https://undefined` URL.
* `artifacts/api-server/src/routes/stripeWebhook.ts:33–58` returns `503` when
  no signing secret is loaded, `400` for a missing signature or invalid signed
  payload, and only passes a verified raw event to business handling.
  `:60–103` inserts `event.id` into the hard dedup table, acknowledges a
  duplicate without repeating handler work, and removes the dedup row before
  returning `500` if handler processing fails so Stripe can retry.

### Why the warning may exist

The message is a deliberate configuration warning, not a statement that a
customer's card was declined. It means one of the following:

1. `STRIPE_WEBHOOK_SECRET` was not available in the API process at startup.
2. The value was present but did not pass the safe `whsec_` shape check.
3. The connector could not be reached or did not return usable Stripe
   credentials while the read-only endpoint inspection ran.
4. The configured secret is syntactically valid but belongs to another
   endpoint/environment. Source alone cannot detect this until a signed
   delivery is verified.

The approved status check found the development secret name present and Stripe
connection status `added`. Because the value was deliberately not read, the
current check cannot distinguish a valid matching test secret from a stale,
wrong-endpoint, or wrong-environment secret. Because workflows and console
logs were not read, this pass did not reproduce or time the warning. A warning
seen in a previously running process can also reflect process startup before a
secret update; that is an environment/process-state explanation, not a code
fix.

### Historical endpoint evidence

`docs/phase2-stabilization.md:22–34` records a prior read-only inspection of
16 enabled development test endpoints for the same webhook URL. It also
records that endpoint listing does not return signing secrets and that some
inspected endpoints lacked dispute, transfer, and payout events. This is
historical evidence and was not re-run here. No endpoint cleanup or event
subscription change was performed.

The source-required event list is
`artifacts/api-server/src/lib/stripeWebhookSetup.ts:5–23`:

* `checkout.session.completed`
* `payment_intent.amount_capturable_updated`
* `payment_intent.succeeded`
* `payment_intent.payment_failed`
* `payment_intent.canceled`
* `account.updated`
* `charge.refunded`
* all five dispute events
* `transfer.created`, `transfer.reversed`
* `payout.paid`, `payout.failed`, `payout.canceled`

### Classification and safe next step

**Classification: configuration/environment blocker if the warning is
currently emitted; not a confirmed application defect.** The safe operator
next step is to identify the intended existing development test endpoint,
securely configure its signing secret through the workspace secret manager,
then deliver a signed test event and verify one duplicate delivery. This was
not done here because it requires provider-side confirmation and delivery, and
the task forbids live/provider mutations and credential disclosure.

## Check 5 — Payment behavior in backend and mobile code

### Backend flow observed

1. `POST /api/payments/jobs/:jobId/checkout` in
   `artifacts/api-server/src/routes/payments.ts:85–343` authenticates the
   customer or shop-owner customer-of-record, locks the job row, reads the
   server-side estimated price, clamps tax input, computes the commission and
   parts/net-profit split, resolves the connected-account destination, and
   creates a Stripe-hosted Checkout Session with `capture_method: "manual"`.
   The client cannot supply the amount. The route stores a pending payment
   row before the webhook is expected to arrive and passes an idempotency key
   to Stripe.
2. `checkout.session.completed` moves only a matching pending row to
   `authorized`. `payment_intent.amount_capturable_updated` also authorizes a
   matching intent.
3. A mechanic work log opens a 24-hour confirmation hold through
   `artifacts/api-server/src/lib/payoutHoldEngine.ts:55–101`. Customer
   confirmation or expiry calls `captureNow`; conditional state/claim updates
   prevent concurrent captures. Capture success is reflected by the verified
   `payment_intent.succeeded` webhook, which marks the payment captured and the
   job `PAID`, then performs loyalty/referral/tier side effects.
4. Payment failure/cancellation, refunds, disputes, Connect account changes,
   transfer, and payout events each have explicit webhook paths. Refund and
   retry routes are role/state-gated.
5. Tips are independent Checkout sessions in
   `artifacts/api-server/src/lib/tipEngine.ts:36–109`, are bounded to
   100–50,000 cents, and use a deterministic tip-row idempotency key. Tip
   capture is handled separately from the job payment.
6. `artifacts/api-server/src/middlewares/paymentRateLimit.ts` limits checkout
   creation to 10 attempts/minute per user/IP, tips to 5/minute, and the
   publishable-key config read to 60/minute.

This is a backend-authoritative design: a mobile success page does not mark a
job paid. The payment webhook must be configured and delivered for the
authorized/captured state changes.

### Mobile flow observed

* `artifacts/mobile/app/job/[id].tsx:109–136` calls the backend checkout
  endpoint and opens the returned Stripe-hosted URL in `WebBrowser` on native
  or a new browser window on web. It does not handle card data or mark
  payment success locally.
* The job screen requires an accepted job and server-returned estimated price
  before showing authorization. On native, this is a browser/Custom Tab
  payment flow, not a React Native Stripe SDK flow.
* `artifacts/mobile/app/job/[id]/tip.tsx:26–61` sends cents to the bounded tip
  endpoint and opens the returned hosted URL. It checks that a URL exists and
  reports non-2xx/network failures.
* `artifacts/mobile/app/mechanic/payouts` reads server payout summaries,
  payment states, tips, and payout events. It does not itself release or
  capture customer funds.
* The admin payment screen keeps legacy `held/released` behavior separate from
  Stripe `pending/authorized/captured` behavior. It only presents manual
  release for legacy rows without a Stripe session.

### Confirmed defects fixed in this pass

1. **Commercial customer authorization was hidden on mobile.** The backend
   explicitly allows a `shop_owner` whose commercial job is the customer of
   record (`payments.ts:85–114`), but the job screen previously rendered the
   authorization card only for `user.role === "customer"`. A valid commercial
   principal could therefore receive a server-authorized payment flow but have
   no payment action in the app. `job/[id].tsx:154–160,384–385` now derives
   `canAuthorizePayment` from customer-of-record ownership or the existing
   commercial-principal guard. This changes visibility only; it does not
   bypass the backend check.
2. **Admin platform-fee label was stale.** The screen displayed
   `Platform (10%)`, while backend commission is tier-aware and partner jobs
   can carry a server-side override. The label is now `Platform fee` in
   `artifacts/mobile/app/(admin)/payments.tsx:185–187`. The displayed
   `payment.platformFee` value and all backend fee calculations are unchanged.
   No fee percentage or money rule was changed.

### Confirmed code-path mismatch deferred

The shop-destination path needs a separate follow-up:

* Checkout validates `shopsTable.stripeAccountId` and
  `shopsTable.stripeAccountReady` before using a shop destination
  (`artifacts/api-server/src/routes/payments.ts:231–240`).
* `POST /payouts/shop/connect/onboarding` in
  `artifacts/api-server/src/routes/payouts.ts:311–344` creates/stores the
  account on `usersTable`, not on a selected shop row. Its status route also
  reads/writes the user row (`:346–367`), and it has no shop-id request
  contract.
* The current mobile app does not call these shop onboarding routes. Thus no
  live user flow was changed or tested here. If a shop payout destination is
  selected without a separately populated shop account, checkout correctly
  fails closed with “Selected shop has not finished payout setup yet,” but the
  available onboarding path cannot establish the row checkout requires.

**Classification: confirmed backend payment-path mismatch, currently
uncertified/unused from mobile.** It was not “fixed” by copying an owner
account into a shop or adding a new request contract, because that would be an
architecture/product decision for multiple locations and account ownership.
No money behavior was broadened.

## Check 6 — Development setup and native/physical-device availability

### Development setup

* Root `package.json` includes `stripe` and `stripe-replit-sync`; the existing
  API server uses the Replit connector client in
  `artifacts/api-server/src/lib/stripeClient.ts`, not a hardcoded key.
* `.replit:11–18` identifies the Project workflow and Stripe integration.
  The API/mobile package scripts are present, but this pass did not launch or
  restart them.
* `stripeClient.ts:23–58` fetches a fresh connector connection on each call,
  selects `development` unless `REPLIT_DEPLOYMENT === "1"`, and fails closed
  when connector identity/credentials are unavailable. It does not cache
  secrets.
* `.env.example:38–42` correctly documents Replit Connector handling and
  labels direct secret-key variables as self-hosted alternatives. The current
  source path consumes the connector API.
* `artifacts/mobile/lib/apiConfig.ts:26–92` rejects missing, sentinel,
  path-bearing, credential-bearing, or malformed public hosts instead of
  fabricating a URL. This protects API requests, but is not a proof that the
  current host is reachable from a device.

### What exists for mobile

* `artifacts/mobile/app.json` declares iOS and Android identifiers,
  permissions, browser support, and Expo SDK configuration.
* `artifacts/mobile/eas.json:6–37` contains an internal development profile and
  an `EXPO_PUBLIC_DOMAIN` value that is documented as a placeholder in
  `STORE_RELEASE.md:121–128`. `app.json` has no `expo.extra.eas.projectId`;
  the submit section still contains TODO store-account values.
* `artifacts/mobile/.expo/devices.json` contains an empty `devices` list. This
  is direct evidence that no device is registered in the local Expo metadata,
  not evidence that a device could never be used.
* Existing `static-build/android/manifest.json` and
  `static-build/ios/manifest.json` describe JavaScript bundle/manifests for
  Expo SDK 54. They are not signed iOS/Android binaries and do not establish
  physical-device installation, permissions, browser handoff, push,
  biometric, or store behavior.

**Classification: uncertified native limitation, not a web defect.** A browser
or Expo-web check would exercise React Native Web and a web browser, not a
physical iOS/Android device. No physical-device or signed-native test is
claimed in this record. The browser tester was intentionally not launched;
the main agent retains the sole tester.

## Safe checks executed

These checks were local/static or fixture-free. They did not call Stripe to
create Checkout Sessions, PaymentIntents, customers, refunds, Connect
accounts, transfers, payouts, or test charges.

| Check | Result |
| --- | --- |
| `pnpm --filter @workspace/api-server exec tsx --test src/lib/stripeWebhookSetup.test.ts src/lib/providerConfig.test.ts src/lib/publicUrl.test.ts src/lib/authorization.test.ts` | **PASS**, 11 tests |
| `pnpm --filter @workspace/mobile run test:phase2` | **PASS** — mobile helper regressions. Node emitted the existing typeless-module performance warning; it was not a test failure. |
| `pnpm --filter @workspace/api-server run typecheck` | **PASS** |
| `pnpm --filter @workspace/mobile run typecheck` | **PASS** after the two mobile payment-screen changes |
| Fixture-free static assertions for the commercial payment guard and removal of the stale `Platform (10%)` label | **PASS** |
| `git diff --check` | **PASS** |

The API tests cover webhook setup decision logic, URL/provider fail-closed
logic, and authorization state gates. They do not prove a real Stripe
signature, endpoint delivery, PostgreSQL concurrency interleaving, Checkout
session, capture, refund, Connect payout, or native-device result. No Stripe
CLI delivery was run and no live/test card was submitted.

## Running-code evidence follow-up

**Checked:** 2026-09-13 (UTC), against the already-running API listener on
`127.0.0.1:8080`. The API process was not restarted, and the browser tester
was not launched or run concurrently.

The main-agent-supplied current workflow context reports this startup result:

```text
Stripe webhook NOT ready
status: missing_signing_secret
matchingEndpoints: 16
missing: charge.dispute.* transfer.* payout.*
```

This changes the earlier status-only classification: the missing webhook
signing secret is now a **confirmed runtime configuration blocker**, not merely
a historical or unverified possibility. The environment-status tool reported
that a development key with the name `STRIPE_WEBHOOK_SECRET` exists, but the
running API process did not receive/use a signing secret. A status-only
presence result cannot override the process-level runtime result. Likely
causes include an environment-scope mismatch, stale process started before the
secret was available, or a secret that was not accepted by the startup
configuration path. No secret value was read or logged.

The 16 matching enabled endpoints and missing dispute, transfer, and payout
event families are also current runtime inspection output. They are a
provider-configuration hygiene blocker for complete event coverage, but no
endpoint was created, edited, deleted, or otherwise mutated.

### Safe HTTP probes

The probes used no credentials, did not create a Checkout
Session/PaymentIntent, and did not reach a charge or endpoint-management
operation. Response bodies were discarded except for the explicit
fail-closed webhook body recorded below.

| Probe | Observed result | Evidence |
| --- | --- | --- |
| `GET http://127.0.0.1:8080/api/healthz` | `200 application/json` | API listener and DB health route reachable |
| Unsigned `POST http://127.0.0.1:8080/api/stripe/webhook` with `{}` and no `stripe-signature` | `503 application/json`, body `{"error":"Webhook not configured"}` | Running handler has no loaded webhook signing secret and fails closed before signature verification/dedup |
| Unauthenticated `POST http://127.0.0.1:8080/api/payments/jobs/1/checkout` | `401 application/json` | Checkout authentication gate is reachable; no user/job/provider/payment work is entered |
| Same checkout request with `Authorization: Bearer invalid` | `401 application/json` | Invalid bearer token is rejected by the authentication gate |
| `GET http://127.0.0.1:8080/api/payments/config` | `200 application/json` | Runtime Stripe publishable-key config path is reachable; response body/key was discarded |

The `payments/config` `200` proves only that the runtime can serve a
publishable-key response through the connector path. Its body was not read, so
this probe does not claim test versus live mode. The checkout probes stopped at
authentication; without an authorized customer fixture/account, this pass did
not exercise job ownership, `ACCEPTED` status, public URL, destination
readiness, pricing, or Checkout creation. This preserves the no-fixture/no-
charge boundary.

### Separate listener/process environment issue

The main-agent-supplied running context also reports a stale/duplicate listener
`EADDRINUSE` condition. Classify this separately as a workflow/process
topology issue, not a Stripe payment-code defect. Do not restart the workflow
while the tester is active; terminate or reconcile the stale listener only
through the normal owner-controlled workflow procedure. This evidence pass did
not restart either listener.

## Final classification and handoff

1. **Webhook warning:** the running API now confirms an environment/runtime
   configuration blocker (`missing_signing_secret`). Securely reconcile the
   secret scope/process and intended development endpoint before claiming
   webhook readiness. Then observe a signed test event. Do not “solve” it by
   creating another endpoint; the code intentionally avoids that mutation.
2. **Payment state machine:** source review and safe unit checks support the
   documented backend-authoritative behavior. Provider delivery and settlement
   remain uncertified.
3. **Fixed defects:** commercial principals can now see the server-authorized
   mobile authorization action; the admin fee label no longer asserts an
   incorrect fixed percentage. No payment amount, fee rule, Stripe setting, or
   database schema changed.
4. **Deferred mismatch:** shop-level Connect onboarding versus shop-level
   destination storage needs an explicitly reviewed API/account-ownership
   decision before implementation.
5. **Native availability:** no physical-device or signed EAS evidence exists;
   web/static bundle evidence must not be reported as device evidence.

**Edited implementation files:**  
`artifacts/mobile/app/job/[id].tsx`  
`artifacts/mobile/app/(admin)/payments.tsx`  
**Added evidence file:**  
`docs/audit/part7-initial-payments-mobile.md`