# Part 7 — Payments and External Integrations Audit

**Checked:** 2026-09-13 (UTC)  
**Scope:** Stripe checkout/capture/refund/dispute/payout behavior, Connect
onboarding and destinations, admin finance/ledger surfaces, tips, webhook
verification/idempotency/state/error gates, and the AI, email, push, media
storage, VIN, and parts-supplier integrations present in the backend.  
**Safety boundary:** No live charge, test-card submission, Stripe entity
mutation, provider webhook delivery, endpoint creation/deletion, database
fixture, workflow restart, browser-tester run, or credential value read/logged
was performed.

This is an evidence record and remediation handoff, not a production-readiness
approval. Source review and safe HTTP checks cannot prove that a Stripe
signing secret matches an endpoint, that a provider account is in test mode,
that an email/push/AI request is accepted upstream, or that a native device
receives a notification.

## Executive result

| Area | Result | Classification |
| --- | --- | --- |
| Stripe webhook readiness | The running-process evidence reports `missing_signing_secret`, 16 matching endpoints, and missing dispute/transfer/payout event families. | **Confirmed runtime configuration blocker** |
| Checkout and capture | Server-owned amounts, tax clamping, job locking, manual capture, destination readiness, ownership checks, and payment rate limits are present. | Static evidence; provider delivery remains uncertified |
| Refunds | Admin/state gates are present. Full Stripe refunds now use a deterministic idempotency key. Partial-refund reconciliation is not implemented. | Fix applied; partial refunds are an uncertified limitation |
| Webhook idempotency/state | Signature verification and event-ID deduplication exist. Dedup persistence now fails closed; stale payment/dispute transitions were narrowed. | Fix applied; claim-before-effects crash replay remains a beta/P0 blocker |
| Payout ledger | Transfer/payout events are recorded and linked to connected accounts. Insert failures now propagate for Stripe retry. Provider transfer IDs are not back-linked to payment rows, and transfer/payout failure does not update the payment status. | Fix applied plus confirmed observability/state gap |
| Connect | Mechanic onboarding is coherent. Shop onboarding stores the account on `users`, while shop-destination checkout reads `shops`; split routing fails closed. | Confirmed product/account-ownership mismatch; deferred |
| Tips | Amount, role, job-state, and mechanic readiness gates exist. Failed → success recovery, metadata fallback, refund terminality, and repeated-event no-op behavior are now explicit. Duplicate request protection still needs a transaction/schema contract because the current row is inserted before its idempotency key exists. | Ordered-event fix applied; duplicate-request blocker remains |
| Admin finance | All routes are router-wide admin-gated. The global average-profit calculation double-subtracted parts cost. | Defect fixed |
| AI | Assistant is authenticated, context-scoped, and returns explicit 503 when Anthropic is unavailable. Media generation is admin/policy gated. Input/rate limits and provider-data privacy are not certified; BYO OpenAI catalog credentials do not feed the image adapter. | Configuration/operational limitations; one confirmed configuration mismatch |
| Email | Resend uses the Replit connector and redacted failure responses. The connector header typo was corrected. | Defect fixed; provider delivery/configuration uncertified |
| Push | Expo sends only allow-listed token shapes, batches to 100, times out, validates tickets, and treats provider failures as nonfatal. No receipt persistence or device delivery is certified. | Uncertified external limitation |
| Media storage | Generated assets have DB state and failed-state handling, but bytes are local filesystem files. Durable object storage/mounted-volume behavior is not established. Video remains an explicit stub. | Production durability blocker/uncertified limitation |
| VIN | Mechanic/admin gates and strict 17-character validation exist; NHTSA failures return 502. Calls have no explicit timeout and two decode implementations remain. | Reliability hardening gap |
| Suppliers | APS Curated is local/catalog-backed and now accurately reports no live ordering. PartsTech is an explicit no-order stub. | Confirmed external setup/implementation blocker |
| Subscriptions | No subscription/billing route or schema was found. | Not implemented; no recurring-payment claim |

## Method and evidence boundaries

The audit inspected the actual backend under `artifacts/api-server/src`, the
database schema under `lib/db/src/schema`, the AI integration packages, and
the existing payment/mobile evidence in
`docs/audit/part7-initial-payments-mobile.md`. The earlier safe checks and
running-listener probes are carried forward rather than repeated by restarting
anything.

The approved configuration status evidence showed the development Stripe
connection as present and the requested secret names as present, but secret
values were never read. Presence is not validity, environment selection, or
endpoint matching. No provider mutation or financial operation was used to
obtain evidence.

## 1. Stripe configuration, webhook verification, and event coverage

`stripeClient.ts` fetches Stripe settings through the Replit connector on every
call, chooses `development` unless `REPLIT_DEPLOYMENT === "1"`, validates the
connector hostname, and returns a generic `StripeNotConfiguredError` when the
connector cannot provide usable credentials. Card data is not stored.

`app.ts` mounts `express.raw({ type: "application/json" })` only on the Stripe
webhook path before the JSON parser. `stripeWebhook.ts` verifies the raw body
and `stripe-signature`; missing configuration returns 503 and missing/invalid
signatures return 400. This is the correct fail-closed shape.

Startup intentionally performs read-only endpoint inspection. It does not
create another endpoint to recover a secret. The current runtime evidence
supplied by the main agent is:

```text
Stripe webhook NOT ready
status: missing_signing_secret
matchingEndpoints: 16
missing: charge.dispute.* transfer.* payout.*
```

This is a **confirmed runtime configuration blocker**. The environment status
showed a `STRIPE_WEBHOOK_SECRET` name, but the running API process did not load
an accepted signing secret. Possible causes include scope mismatch, a stale
process, or a value rejected by startup validation; no value was inspected.
The 16 existing matching endpoints and missing event families are a separate
provider-configuration hygiene blocker. No endpoint was changed.

The required event list covers checkout completion, manual-capture lifecycle,
refund, all five dispute events, Connect account updates, transfer creation and
reversal, and payout paid/failed/canceled events. A signed delivery must still
be observed before claiming end-to-end readiness.

### Safe running-API evidence

These probes did not authenticate a user, create a payment, call Stripe, or
mutate an endpoint:

| Probe | Result | Meaning |
| --- | --- | --- |
| `GET /api/healthz` | 200 JSON | Existing API listener and health route were reachable |
| Unsigned `POST /api/stripe/webhook` | 503 `{"error":"Webhook not configured"}` | The running process had no loaded webhook secret and failed closed |
| Unauthenticated checkout POST | 401 JSON | Authentication gate stopped before job/provider work |
| Invalid-bearer checkout POST | 401 JSON | Bearer validation gate worked |
| `GET /api/payments/config` | 200 JSON | Publishable-key path was reachable; body was discarded, so test/live mode is not claimed |

The separate stale/duplicate listener `EADDRINUSE` condition is a process and
workflow-topology issue, not a Stripe business-logic defect.

## 2. Checkout, capture, refund, and state gates

`POST /payments/jobs/:jobId/checkout`:

1. accepts only customer or shop-owner roles;
2. verifies customer-of-record and commercial organization ownership;
3. locks the job row through session creation and payment-row persistence;
4. uses the server-side estimated price, clamps tax to 0–15%, and computes the
   tier/partner commission and net-profit split server-side;
5. requires an active mechanic Connect destination;
6. rejects unsupported split payout destinations;
7. creates a Stripe-hosted card Checkout Session with manual capture; and
8. persists a pending row before webhook processing is expected.

The payment rate limiter allows at most 10 checkout attempts per minute per
user/IP. The success page is informational; the webhook is the source of
truth. Work-log submission requires an authorized Stripe payment and caps the
final amount at the authorized amount. The 24-hour confirmation/dispute hold
uses conditional DB updates and a capture claim before calling Stripe.

The admin refund route requires an admin, a Stripe PaymentIntent, and a
refundable state. Captured refunds use:

```text
refund:payment:<database-payment-id>:intent:<stripe-payment-intent-id>
```

as the Stripe idempotency key. A timed-out/retried admin request therefore
reuses the same provider refund instead of creating another one. Authorized
intents are canceled rather than refunded.

The `charge.refunded` webhook still treats a refund event as a full payment
refund and reverses job/loyalty/referral state. There is no partial-refund
endpoint or `amount_refunded` reconciliation. An operator issuing a partial
refund directly at Stripe could therefore produce a local full-refund state.
That is a confirmed **scope limitation**, not evidence of a failed full-refund
path.

## 3. Webhook idempotency and stale-event handling

Webhook event IDs are inserted into `processed_stripe_events` with
`ON CONFLICT DO NOTHING`. Duplicate deliveries are acknowledged without
re-running business handlers. If handler work fails, the dedup row is removed
before a 500 response so Stripe can retry.

The former behavior continued processing when the dedup insert failed. That
allowed two deliveries to run concurrently without a durable claim. It now
returns 503 (`Webhook deduplication unavailable`) and logs a redacted error so
Stripe retries after database availability returns.

This does **not** make webhook processing crash-safe. The dedup claim commits
before business side effects. If the process dies after the claim commits but
before (or during) side effects, a replay sees the existing claim and returns
200 without replaying the work. The architect's concurrent duplicate-delivery
probe also showed the claim path can acknowledge concurrent requests before
the first side effects are durably complete. A Stripe outbox/replay
architecture was intentionally not introduced in this pass. This remains a
**beta/P0 blocker** until a bounded existing-transaction repair is designed
and verified; no production exactly-once claim is made.

There is a second instance of the same beta blocker in the primary payment
path: `payment_intent.succeeded` marks the payment `captured` before loyalty,
referral, and progression side effects finish. If one of those effects throws,
the handler returns 500 and removes the dedup row, but a retry sees `captured`
and exits early, so the side effect is not replayed. No fee or earnings policy
was changed to mask this. This remains open pending a bounded, verified repair;
no new outbox architecture was introduced.

Payment transitions were narrowed so stale events cannot broadly regress a row:

* `amount_capturable_updated`: only `pending` or `authorized`;
* `payment_intent.succeeded`: only `authorized`, `capture_pending`, or
  `payout_failed`;
* `payment_intent.payment_failed`: only `pending`;
* `payment_intent.canceled`: only pending/authorized/capture-pending/failed
  capture states; and
* `charge.refunded`: only states that could represent an in-flight or
  completed provider charge, excluding canceled/failed/refunded rows.

Stripe dispute updates now use monotonic ranks (`open` → `under_review` →
terminal). A late created/update event cannot overwrite a terminal outcome,
and contradictory terminal events do not change the first recorded outcome or
re-arm capture. The read/rank/update decision now runs under a row lock in a
transaction with a conditional update, and same-provider insert races use the
unique key inside that transaction. A terminal-first event inserts without
creating a payment hold; terminal updates clear only the APS dispute hold
marker.

Tips now have explicit ordered transitions:

* `payment_failed` changes `pending` to recoverable `failed`;
* `payment_intent.succeeded` captures `pending` or recoverable `failed` on the
  same intent;
* a cancellation-marked failure is not revived by a late success;
* `charge.refunded` changes `pending`/`captured` or a recoverable
  `failed`/`Payment failed` tip to `refunded`, while `refunded` remains
  terminal; and
* repeated events update zero rows and never re-send the tip effect.

Tip intent matching first uses the provider intent ID and then signed
`kind=tip, tipId` metadata. A metadata-resolved terminal tip is still consumed
by the tip branch and cannot fall through to the job-payment handler. The
state transition tests execute under `tsx`.

These changes are source-level safeguards. The tip ordering/state tests pass,
but they do not replace a signed test-mode delivery and a PostgreSQL
concurrency test. The dedup crash-replay P0 remains explicitly open.

## 4. Tips and duplicate-request behavior

Tips are bounded to 100–50,000 cents, require the customer to own a completed
or paid job, require an assigned mechanic with a ready Connect account, and
use a separate PaymentIntent. Tip payment-failed, canceled, succeeded, and
refunded events update only the `tips` row and never touch the underlying job
payment. A failed attempt can recover to captured on the same PaymentIntent,
or be refunded before a late success; a cancellation-marked failure and a
refunded tip cannot be revived.

The regression cases executed with `tsx` cover failed → success on the same
intent, failed → refund → late success, same-intent and replacement-metadata
ordering, metadata tip-ID resolution, the actual runtime refund SQL predicate,
and repeated events. The DB update predicates preserve those transitions under
ordinary row locking; signed provider delivery and full concurrent DB fixtures
remain uncertified.

The remaining duplicate-request issue is real: the route inserts a new tip row
to obtain `tipId`, then derives the Stripe idempotency key from that newly
inserted ID. Two identical HTTP requests therefore have different keys and
can create two tip rows/sessions. Changing the key to job/customer/amount
alone would be unsafe because both rows could then point at the same provider
session and both be captured. Correct protection needs a unique client request
key or a transaction/row-lock contract that reuses the existing pending row.
It was not invented in this pass.

## 5. Disputes and payouts

Customer disputes freeze a capture-pending payment and create an internal
dispute. Stripe chargebacks are mirrored into the dispute table, freeze the
payment while active, notify the mechanic/admin, and leave the actual
card-network outcome to Stripe. Admin resolution is role/state gated; only an
internal mechanic-favoring outcome re-arms capture. A terminal-first provider
event does not leave the payment frozen.

Transfer/payout webhooks persist an event row with provider event ID,
connected-account ID, amount, currency, failure data, and raw provider
payload. Payout-event insert errors now propagate to the webhook handler,
which returns 500 and permits Stripe retry; previously the error was logged and
the event was acknowledged as if the ledger write succeeded.

Two payout limitations remain:

* `transfer.created` receives a transfer ID, but the engine intentionally does
  not resolve `source_transaction` back to the PaymentIntent. Consequently
  `payments.providerTransferId` is not populated and payout-event
  `paymentId` can remain null even when the connected account is known.
* Transfer reversal and payout failure are recorded in `payout_events`, but do
  not transition the associated payment to `payout_failed`. The payment
  `payout_failed` state currently represents capture/API failure, so the
  dashboard can show a captured payment while a later provider payout event
  is failed. This needs a reviewed provider-ID linking/state policy before it
  can be safely changed.

`payouts/:jobId/retry` is role and state gated and retries failed capture flow;
it does not retry a provider payout itself. Tax-document links are
Connect-dashboard login links, not APS-generated tax documents.

## 6. Connect destinations and shop ownership

Mechanic Connect onboarding creates an Express account on `users`, requests
transfers/card-payments capabilities, and refreshes readiness from Stripe.
`account.updated` also updates readiness. Checkout fixes the
`transfer_data.destination` at PaymentIntent creation and serializes with
destination changes using the job lock.

Shop destinations are not currently coherent end-to-end:

* shop onboarding creates/stores the company account on the shop owner's
  `users` row; but
* shop-destination checkout validates `shops.stripeAccountId` and
  `shops.stripeAccountReady`.

The destination route correctly rejects unsupported split payouts and rejects
changing a destination after Stripe checkout starts. The mismatch was not
“fixed” by copying one owner account to an arbitrary shop, because that is an
account-ownership/product decision for multiple shops and locations.

## 7. Admin ledger and invoice surfaces

`routes/adminFinance.ts` applies `authenticate` and `requireRole("admin")` at
router scope. Global and per-mechanic summaries use captured payment rows;
customer invoice output omits APS commission, mechanic payout, Stripe fees,
supplier cost, and margin fields. Customer/mechanic/commercial-owner invoice
scoping is explicit.

The global `avgProfitPerJobCents` calculation was wrong: `laborRevenueCents`
already excludes parts reimbursement, but the route subtracted
`partsCostCents` a second time. The query now sums `netProfitCents` and uses
that value for the average.

The payout buckets route still labels a possible `processing` bucket but does
not populate it from provider events. This is an observability limitation
related to the missing transfer-to-payment linkage above, not permission
leakage.

## 8. AI and media integrations

### Assistant

`POST /assistant/chat` requires authentication, validates user/assistant
message roles, limits retained history to the last 12 messages, and only
loads vehicle/job/work-log context when the caller is the owning customer,
assigned mechanic, or admin. Anthropic configuration is validated before any
provider call; missing/invalid configuration returns an explicit 503 rather
than a fabricated answer. Provider errors are redacted in logs.

The route has no dedicated AI rate limiter and the generated Zod body does not
cap message/history content lengths. This is a confirmed operational
hardening gap because authenticated users can submit oversized prompts or
repeated provider requests. Prompt context includes VIN, plate, work history,
and mechanic notes, so provider data-handling/retention terms also need an
explicit deployment decision. No provider call was made.

### Image/video generation

Media generation is admin-only, blocked for published posts, subject to the
admin pause and daily-draft policy, and records `generating`, `ready`, or
`failed` asset states. OpenAI image generation validates the Replit AI
integration base URL and returns explicit provider-not-configured errors.
Video is an explicit provider stub and cannot be represented as live
generation.

The Growth integration catalog accepts and encrypts an `openai_api_key` BYO
credential, but the OpenAI image adapter reads only the Replit
`AI_INTEGRATIONS_OPENAI_*` variables. Saving the BYO credential therefore does
not configure image generation. This is a confirmed configuration/catalog
mismatch; no UI or provider architecture was changed here.

The daily cap is a count-then-generate policy rather than a transactional
quota claim, so simultaneous admin requests can race around the cap. That is a
hardening limitation.

## 9. Email, push, and storage

### Email

Password reset responses are intentionally generic to avoid account
enumeration. Resend credentials are fetched through the Replit connector and
provider errors do not expose response bodies or reset links.

The connector request used `X_REPLIT_TOKEN`, which does not match the
connector's `X-Replit-Token` header used by the Stripe path. It now uses the
correct hyphenated header. Resend availability and actual delivery remain
uncertified; no email was sent. The helper has a short in-memory credential
cache despite a stale “never cache” comment, and has no explicit request
timeout. These are reliability hardening items.

### Push

Expo messages accept only `ExponentPushToken[...]`-prefixed values, are sent
in batches of 100, use an 8-second abort timeout, validate the ticket payload,
and log only counts/statuses. Push failures are intentionally nonfatal to
payment/job transitions. There is no receipt polling, invalid-token cleanup,
or durable delivery record; no physical-device delivery is claimed.

### Media bytes

Generated PNG/MP4 bytes are written below `MEDIA_STORAGE_DIR` and referenced
by DB asset rows. The public file route allow-lists generated filename shapes
and extensions and does not expose arbitrary paths. Local filesystem
persistence is not durable across a deployment without a mounted volume, and
Replit Object Storage is only documented as a future replacement. The DB row
can therefore outlive an asset file; production durability is uncertified.

## 10. VIN and parts suppliers

### VIN/NHTSA

The parts and mechanic-workspace VIN routes require an active mechanic or
admin, reject non-17-character values and I/O/Q, return 502 on NHTSA
failures, and avoid assigning customer ownership when a mechanic opens a
workspace. Accepted-job enrichment is explicitly best-effort and
nonblocking.

There are two implementations of the NHTSA decode request
(`vinDecodeService.ts` and `mechanicWorkspace.ts`), neither with an explicit
fetch timeout. A provider hang can hold a user request for an unbounded
period, although the accepted-job background hook does not block job
acceptance. Consolidating the implementation and adding a timeout is a
reliability follow-up.

### Supplier adapters and parts ordering

The registry initializes APS Curated and PartsTech. APS Curated reads
`parts_offers` and creates only a synthetic `APS-...` reference; it does not
place an external order and now reports `supportsLiveOrders = false`.
PartsTech is deliberately registered as a stub: credentials alone do not
enable search or ordering, and live orders throw an explicit not-configured
error. Nexpart/WHI/Worldpac adapters are not present.

Parts recommendations fan out across registered adapters and swallow an
individual adapter search failure so one unavailable supplier cannot block the
curated catalog. The current order API is mechanic/admin-gated and records a
candidate row; there is no live supplier mutation in this audit. Before
enabling a real adapter, the order contract must make the selected offer and
server-snapshotted price authoritative rather than trusting a client-supplied
price/SKU alone.

## 11. Subscriptions and recurring billing

No subscription, recurring invoice, customer portal, billing-plan, or
subscription schema/route was found. APS should not claim recurring-payment
support based on the one-time Checkout implementation.

## Safe checks and changes

Previously executed safe checks remain:

| Check | Result |
| --- | --- |
| API static/unit test suite (`tsx --test src/lib/*.test.ts src/routes/*.test.ts`) | **PASS**, 30 tests |
| Mobile phase-2 regression script | **PASS** |
| API typecheck after backend changes | **PASS** |
| Focused tip/webhook regression subset | **PASS**, 11 tests (included in the 30-test suite) |
| Mobile typecheck after the prior payment-owned UI fixes | **PASS** |
| Static assertions for prior mobile payment fixes | **PASS** |
| Audit-owned `git diff --check` paths | **PASS** |

No check above proves a Stripe signature, webhook delivery, provider
settlement, Resend delivery, Expo device receipt, NHTSA availability,
supplier order, AI provider response, durable media volume, or native-device
behavior.

Workspace-wide `git diff --check` still reports blank lines at EOF in three
generated API files outside this audit's owned paths
(`lib/api-client-react/src/generated/api.schemas.ts`,
`lib/api-client-react/src/generated/api.ts`, and
`lib/api-zod/src/generated/api.ts`); those files were not modified here.

### Backend files changed in this audit

* `artifacts/api-server/src/routes/payments.ts` — deterministic full-refund
  Stripe idempotency key.
* `artifacts/api-server/src/routes/stripeWebhook.ts` — dedup fail-closed
  behavior, stale payment guards, recoverable tip failure → success/refund,
  metadata intent fallback, terminal refund handling, and repeated-event
  no-op behavior.
* `artifacts/api-server/src/lib/tipState.ts`,
  `artifacts/api-server/src/lib/tipState.test.ts`, and
  `artifacts/api-server/src/lib/tipRuntimeGuard.test.ts` — shared ordered-tip
  state/SQL rules and executable `tsx` regressions against the runtime query
  predicate.
* `artifacts/api-server/src/lib/payoutEventEngine.ts` — propagate ledger
  insert failure to trigger provider retry.
* `artifacts/api-server/src/lib/disputeEngine.ts` — transactional row-lock
  and conditional monotonic Stripe dispute upsert; terminal-first events do
  not create a hold.
* `lib/db/src/schema/tips.ts` — document recoverable failed attempts.
* `artifacts/api-server/src/routes/adminFinance.ts` — correct net-profit
  average.
* `artifacts/api-server/src/lib/email.ts` — correct Replit connector header.
* `artifacts/api-server/src/lib/suppliers/internal/apsCuratedAdapter.ts` —
  accurately mark local synthetic ordering as non-live.

No additional UI, provider, endpoint, workflow, or database fixture changes
were made by this audit.

## Final classification and handoff

1. Reconcile the runtime webhook secret with the intended existing development
   endpoint and add the missing event families without creating duplicate
   endpoints. Then observe one signed event and one duplicate delivery.
2. Treat claim-before-effects crash replay and capture-before-loyalty failure
   replay as **beta/P0 blockers**. Do not approve production exactly-once
   effects until a bounded existing-transaction repair is verified; no new
   outbox architecture was introduced in this audit.
3. Decide the shop Connect account ownership model and transfer/payout
   linkage policy before changing those payment paths.
4. Add a client idempotency/request-key contract or locked pending-row reuse
   for tips; do not derive a duplicate key from a newly inserted row.
5. Before enabling external integrations, add AI request limits, NHTSA
   timeouts, durable media storage, provider delivery/receipt evidence, and
   real supplier adapters. Treat BYO OpenAI credentials and social-platform
   credential status as nonfunctional until their adapters consume them.
6. Keep subscriptions classified as not implemented.
