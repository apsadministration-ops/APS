# APS Phase 2 — Security and reliability stabilization

## Scope

Targeted changes to the existing Expo app, Express API, PostgreSQL storage and custom JWT/bcrypt authentication. No database replacement, schema migration, backend separation, redesign, generated-client regeneration, VIN scanner or secondary shop-transfer implementation.

## Changes and principal files

| Area | Result | Files |
| --- | --- | --- |
| Admin bootstrap | Missing/blank setup key returns 503; no fallback key. Configured key comparison is timing-safe. | API `routes/auth.ts`, `lib/authorization.ts` |
| Password recovery | Removed reset link/token/body/recipient/provider-error logging. Preserved hashed tokens, one-hour expiry and atomic single use. Mobile only reports success on 2xx; 429 and other failures are explicit. | API `lib/email.ts`, `routes/passwordReset.ts`; mobile `(auth)/forgot-password.tsx`, `lib/forgotPassword.ts` |
| Stripe startup | No automatic endpoint creation. Loads the configured signing secret or explicitly reports the configuration blocker. Endpoint inspection is read-only. | API `lib/stripeInit.ts`, `lib/stripeWebhookSetup.ts`, `app.ts` |
| Financial authorization | Retry requires active assigned mechanic/admin, COMPLETED job and failed payout. Confirmation allows customer or partner customer-of-record. Refund/legacy-release/dispute operations enforce their valid states. Concurrent retries cannot reset an in-flight capture claim. | API `lib/authorization.ts`, `lib/payoutHoldEngine.ts`, `routes/payouts.ts`, `routes/payments.ts`, `routes/disputes.ts` |
| Destination integrity | Shop owners must control the job and target shop. Checkout and destination edits hold the same job-row transaction lock. Pre-checkout destination setup remains available; metadata is immutable after provider references exist. Partner checkout still requires customer-of-record ownership. | API `routes/payouts.ts`, `routes/payments.ts` |
| Unsupported splits | New split selection, split checkout and capture of legacy split rows fail closed rather than silently paying the entire amount to one recipient. | Same API payment files; `STRIPE_SECURITY_AUDIT.md` |
| Mobile startup/routing | Validates API host before mounting authentication; rejects missing, sentinel, path-bearing and credential-bearing hosts. Shared four-role destinations prevent partner redirect loops. Raw app API requests use validated URL construction. | Mobile `lib/apiConfig.ts`, `lib/roleDestination.ts`, `app/_layout.tsx`, role layouts, `context/AuthContext.tsx`, API-calling screens |
| Push | Preserves Expo Go/web skips and lazy native loading. Adds safe project-ID inference, response checks and non-sensitive stage diagnostics, including native setup failures. | Mobile `hooks/usePushNotifications.ts`, `lib/pushDiagnostics.ts` |
| Misleading success | Checks critical checkout/tip links and action responses. Work confirmation is no longer presented as completed payment when capture has not completed. | Mobile payment/admin/job screens, including `job/[id]/confirm-work.tsx` |
| Orval | Installed version upgraded narrowly from 8.5.3 to 8.22.0. OpenAPI and generated clients remain unchanged. | `lib/api-spec/package.json`, `pnpm-lock.yaml` |

## Stripe: confirmed root cause and required manual configuration

Read-only inspection found **16 enabled test endpoints for the same development webhook URL**. Stripe endpoint listing does not return signing secrets. The previous startup code looked for a secret on a listed endpoint and created another endpoint when it was absent.

Startup no longer creates, modifies or deletes endpoints. No Stripe endpoints were changed during this phase.

**Webhook processing is still blocked until the correct `STRIPE_WEBHOOK_SECRET` is supplied.** A valid-looking secret being loaded is configuration readiness, not proof of a successfully verified delivery.

1. In Stripe's test environment, select the existing endpoint intended for this development app. Its URL must be the current API development origin followed by `/api/stripe/webhook`, not the Expo origin.
2. Reveal that endpoint's signing secret and enter it through the workspace's secure secret form as `STRIPE_WEBHOOK_SECRET`. Do not paste it into chat or commit it.
3. Check the endpoint event subscriptions against `REQUIRED_STRIPE_EVENTS` in `lib/stripeWebhookSetup.ts`. The inspected endpoints lacked the dispute, transfer and payout events listed below.
4. Restart the API and verify a signed test delivery. Check repeated delivery does not repeat business effects before considering payment integration verified.
5. Review duplicate endpoints deliberately in Stripe before disabling/deleting any. This phase performed no cleanup.

Required event types:

```text
checkout.session.completed
payment_intent.amount_capturable_updated
payment_intent.succeeded
payment_intent.payment_failed
payment_intent.canceled
account.updated
charge.refunded
charge.dispute.created
charge.dispute.updated
charge.dispute.closed
charge.dispute.funds_withdrawn
charge.dispute.funds_reinstated
transfer.created
transfer.reversed
payout.paid
payout.failed
payout.canceled
```

Use the appropriate endpoint and secret independently for production; production configuration and delivery were not verified here. Do not perform real-money checkout/capture/refund/payout validation until webhook configuration is resolved.

## Other configuration and limitations

- `ADMIN_SETUP_KEY` was absent in development. Admin bootstrap is intentionally disabled until an operator securely configures it. Existing admin login is not removed.
- Push delivery requires a suitable native build, permissions and EAS project ID. Expo Go deliberately does not register remote push.
- Expo reported patch-version compatibility warnings: installed `expo` 54.0.35 versus expected ~54.0.37 and `expo-constants` 18.0.13 versus expected ~18.0.14. These were documented, not broadly upgraded.
- Secondary split transfers and VIN scanning remain incomplete. Existing split payments require operator review, not an automatic conversion to a different recipient. Internal customer-win disputes still require provider/admin settlement; this phase did not add new settlement behavior.
- Checkout's job-row lock spans the external Stripe call to prevent concurrent destination divergence. This favors financial consistency over concurrency for one job; unrelated jobs do not share that lock.

## Verification

Passed:

- Full workspace TypeScript checks, including API, mobile, demo video, mockup sandbox and shared libraries.
- API production bundle build.
- After final restarts: health endpoint returned 200; unauthenticated auth/payout-retry/refund calls returned 401; missing-key admin setup and unconfigured webhook returned the expected 503.
- 13 Node tests: four authorization/state tests, four Stripe-configuration tests, five password-reset HTTP integration tests.
- Mobile helper regressions for configuration, all four role mappings, recovery response classification and safe push diagnostics.
- Expo web login/recovery rendered. Actual invalid email produced HTTP 400 and an error. A valid nonexistent reserved test address produced the privacy-safe generic response.
- Browser-intercepted recovery HTTP 500 and 429 showed errors, not success; intercepted 200 showed generic confirmation.
- Mocked shop-owner auth state navigated away from the wrong role group without a visible loop. This was not a real partner login.
- Android and iOS development manifests/bundles returned HTTP 200 with the configured API domain. This validates JavaScript bundling, not native installation or physical-device operation.
- Focused security review passed after repairing the destination race and partner checkout restriction.
- Whitespace/diff checks.

Test commands:

```sh
pnpm run typecheck
pnpm --filter @workspace/api-server run build
pnpm --filter @workspace/mobile run test:phase2
pnpm --filter @workspace/scripts exec tsx --test \
  ../artifacts/api-server/src/lib/authorization.test.ts \
  ../artifacts/api-server/src/lib/stripeWebhookSetup.test.ts \
  ../artifacts/api-server/tests/password-reset.integration.test.ts
```

The password-reset tests bundle the actual Express router against isolated in-memory dependencies, then make HTTP requests. They verify hash-only token storage, expiry, successful bcrypt update and single-use rejection without sending email or modifying the real database. They do not establish PostgreSQL concurrency semantics or provider delivery.

Financial tests cover authorization helpers and fake Stripe reachability, not full real-account checkout/refund/capture flows. The shared job-row locking was code-reviewed; no real-database interleaving test was performed. All-role real-login testing, signed Stripe delivery, end-to-end settlement, native push and physical-device Expo Go testing remain unverified.

The initial browser check encountered temporary 502 responses while Metro restarted. Once healthy, the same recovery pass succeeded. Development-only style/deprecation warnings remain.

## Dependency triage

Final workspace dependency scan after installing Orval 8.22.0: **0 critical, 55 high, 25 moderate, 6 low** findings. These are scanner findings across the entire workspace, not 86 proven exploitable application paths. No Orval advisories remained in that scan.

Orval is a developer-time API generator. Its previous code-generation/template and SSRF/file-inclusion advisories are not direct mobile/API runtime exposures, but could affect developers processing untrusted specifications. Keep specification inputs and codegen hooks trusted. No codegen was run in this phase.

Prioritize a separately scoped dependency patch review:

- **Runtime-relevant:** Express brings `body-parser` 2.2.2 and `qs` 6.15.0; scanner fixes include body-parser 2.3.0 and qs 6.16.0. Reported parser denial-of-service conditions depend on options/input; their presence warrants review, not an unsupported claim of exploitation.
- **Potential server path:** `ws` 8.20.0 also appears through the OpenAI integration package. Scanner fixes include 8.21.0. Confirm whether any affected WebSocket path is actually used before assigning runtime reachability.
- **Development/build tooling:** Expo/Metro bring older `ws` families and `undici`; scan findings include WebSocket denial of service. Other findings cover Babel, archive/XML/image/build tools, Vite and related packages. These are not automatically native-app runtime vulnerabilities, but exposed development tooling and untrusted build inputs still need protection.
- **Additional high finding:** `form-data` 4.0.5 has a multipart field/filename CRLF-injection advisory with a 4.0.6 fix. Review affected dependency paths and whether untrusted multipart names reach them.
- Broad React Native/Expo/toolchain upgrades were intentionally deferred. Lower-priority, platform-specific build advisories can wait for that controlled maintenance effort; do not describe the remaining high findings as harmless.

No production audit, live payment action, endpoint deletion or physical-device test is claimed.