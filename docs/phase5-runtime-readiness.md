# APS Phase 5 runtime readiness

This report records the latest Phase 5 verification supplied for the repository.
It is a runtime-readiness record, not a secret inventory: no secret values,
tokens, provider payloads, private keys, service-account JSON, or legal
documents are included. The earlier Phase 3 evidence remains historical in
`docs/api-secret-requirements.md`; it is not silently relabeled as Phase 5.

## 1. Files changed

At the start of this documentation pass, the exact `git status --short` output
was:

```text
 M artifacts/api-server/src/app.ts
 M artifacts/api-server/src/index.ts
 M artifacts/api-server/src/lib/credentialStore.ts
 M artifacts/api-server/src/lib/email.ts
 M artifacts/api-server/src/lib/growthSchedulerInit.ts
 M artifacts/api-server/src/lib/mechanicAmplification.ts
 M artifacts/api-server/src/lib/mediaEngine.ts
 M artifacts/api-server/src/lib/mediaProviders/openaiImage.ts
 M artifacts/api-server/src/lib/notifications.ts
 M artifacts/api-server/src/lib/payoutSchedulerInit.ts
 M artifacts/api-server/src/lib/publishingEngine.ts
 M artifacts/api-server/src/lib/stripeClient.ts
 M artifacts/api-server/src/lib/stripeInit.ts
 M artifacts/api-server/src/lib/stripeWebhookSetup.ts
 M artifacts/api-server/src/lib/tipEngine.ts
 M artifacts/api-server/src/routes/amplification.ts
 M artifacts/api-server/src/routes/assistant.ts
 M artifacts/api-server/src/routes/growth.ts
 M artifacts/api-server/src/routes/health.ts
 M artifacts/api-server/src/routes/integrations.ts
 M artifacts/api-server/src/routes/jobs.ts
 M artifacts/api-server/src/routes/media.ts
 M artifacts/api-server/src/routes/passwordReset.ts
 M artifacts/api-server/src/routes/payments.ts
 M artifacts/api-server/src/routes/payouts.ts
 M artifacts/api-server/src/routes/referrals.ts
 M artifacts/api-server/src/routes/stripeWebhook.ts
 M artifacts/api-server/src/routes/tips.ts
 M artifacts/mobile/app/(admin)/growth/content/[id].tsx
 M artifacts/mobile/app/(admin)/growth/library.tsx
 M artifacts/mobile/app/(auth)/register.tsx
 M artifacts/mobile/app/(customer)/_layout.tsx
 M artifacts/mobile/app/(mechanic)/_layout.tsx
 M artifacts/mobile/app/(mechanic)/index.tsx
 M artifacts/mobile/app/(shop-owner)/_layout.tsx
 M artifacts/mobile/app/_layout.tsx
 M artifacts/mobile/app/detailing.tsx
 M artifacts/mobile/app/inspection/[jobId].tsx
 M artifacts/mobile/app/mechanic/workspace/[vin].tsx
 M artifacts/mobile/app/request-service.tsx
 M artifacts/mobile/app/tracker/[jobId].tsx
 M artifacts/mobile/app/transport/[jobId].tsx
 M artifacts/mobile/app/worklog/[jobId].tsx
 M artifacts/mobile/hooks/usePushNotifications.ts
 M artifacts/mobile/scripts/build.js
 M artifacts/mobile/scripts/phase2-regression.mjs
 M docs/api-secret-requirements.md
 M docs/beta-configuration-checklist.md
 M lib/integrations-anthropic-ai/src/client.ts
 M lib/integrations-anthropic-ai/src/index.ts
?? artifacts/api-server/src/lib/apiError.test.ts
?? artifacts/api-server/src/lib/apiError.ts
?? artifacts/api-server/src/lib/notifications.test.ts
?? artifacts/api-server/src/lib/providerConfig.test.ts
?? artifacts/api-server/src/lib/providerConfig.ts
?? artifacts/api-server/src/lib/publicUrl.test.ts
?? artifacts/api-server/src/lib/publicUrl.ts
?? artifacts/api-server/src/lib/validation.test.ts
?? artifacts/api-server/src/lib/validation.ts
?? artifacts/mobile/components/CapabilityNotice.tsx
?? artifacts/mobile/lib/deviceCapabilities.ts
?? lib/integrations-anthropic-ai/src/client.test.ts
```

The source and test entries above were pre-existing to this documentation pass;
their individual ownership is not inferred from `git status`. The two existing
inventory/checklist files were also already modified before this report and
received the readiness-status updates recorded here. The only new file created
by this documentation pass is:

```text
?? docs/phase5-runtime-readiness.md
```

No application code, test code, architecture, or database schema was changed
for this report.

## 2. Passed

- Full workspace typecheck — **PASS**.
- Mobile helper regressions — **PASS**.
- All 25 backend/AI tests — **PASS**, covering `src/lib/*.test.ts` plus
  `password-reset.integration.test.ts` and
  `lib/integrations-anthropic-ai/src/client.test.ts`.
- API restarted successfully after build/start — **PASS**.
- Metro restarted — **PASS**.
- Final mobile build after the latest source fixes — **PASS**:
  `METRO_PORT=18115 pnpm --filter @workspace/mobile run build`.
  iOS/Android JavaScript bundles and manifests were emitted with 49 assets.
- Earlier runtime API/DB health — **PASS**.
- Isolated startup with optional providers absent — **PASS**.
- Configuration inventory — **45 executable/config names and 15
  secret-bearing names**.
- Original browser/API evidence: real-UI customer login, navigation,
  persistence, and logout; customer/mechanic registrations; admin registration
  rejection; mechanic/admin/suspended/wrong-password authentication; vehicle,
  job, mechanic-accept, messaging, and outsider checks — **PASS**.
- Final narrow real-UI retest — **PASS**: mechanic dashboard
  Available/Profile/logout; shop-owner Locations/Vehicles/Profile/logout; admin
  dashboard/Users/logout with fixture-only DB elevation; suspended login `403`;
  and the address fallback/signup path. Screenshots:
   mechanic `23w786`, address `6s6f0r`, admin `mxqysg`, partner `5xn25q`,
   invalid reset `s2dfkm`, clean login `p73byr`.
- Aborted Nominatim request → typed address continuation → unverified/no
  coordinates notice → real-UI registration/customer home — **PASS**;
  `home_lat`/`home_lng` remained null.
- `/forgot-password` form rendering — **PASS** without submission or a live
  email claim. An actual invalid-token
  `/api/auth/reset-password?token=...` request returned friendly HTML `410` —
  **PASS**. Expo `/reset-password` redirects to login; a recovery route is not
  implemented.
- Latest proxied `/api/healthz` returned HTTP `200` with `status: "ok"`, and
  malformed-login JSON returned HTTP `400` with `invalid_json` — **PASS**.
- Isolated fixtures were cleaned to zero. No existing PII or provider records
  were mutated.
- Scoped users and `password_reset_tokens` were cleaned to zero; no fresh jobs, vehicles,
  or messages remained.

## 3. Failed, pending, or not claimed

- No failed result was reported for the verification items listed in section 2.
- The final narrow post-fix UI retest for the mechanic DOM-anchor CSS crash and
  address-geocoder signup block is **PASS**; no failure remained in the
  exercised flows.
- Sixteen matching existing Stripe development endpoints were observed without
  the required event coverage and signing secret; this external state is
  unchanged and remains unresolved.
- Resend remains `not_setup`; password-reset email delivery is not ready.
- No live email submission, payment, AI generation, push, physical-device,
  signed-native, or store-release pass is claimed. Isolated reset-router tests
  cover reset behavior; browser recovery-email submission was not claimed.
- The local JavaScript bundle/manifests build is not a signed native build or
  physical-device test.
- Expo package warnings remain: Expo `54.0.35` versus approximately `54.0.37`,
  and `expo-constants` `18.0.13` versus approximately `18.0.14`. No upgrades
  were made.
- Minor nonblocking warnings remain for deprecated `shadow*`,
  `pointerEvents`, and password-not-form markup. Admin logout emitted duplicate
  confirmation logs but succeeded; neither observation is a flow failure.

## 4. External blockers

- **BLOCKED EXTERNAL SETUP:** new provider accounts, personal-identity
  credentials, domains, keys, sender/DNS setup, payment setup, and native EAS
  setup remain unauthorized. Securely verify existing authorized configuration
  only; do not obtain personal account credentials.
- Live Stripe activation, event/signing-secret readiness, payouts, bank/tax/
  representative verification, and connected-account readiness require the
  authorized APS business account.
- Resend connector/sender/domain configuration is not set up.
- Native EAS project/signing/APNs/FCM/store configuration remains blocked until
  authorized. Physical Expo Go validation remains untested and needs access to
  a compatible device/client; ordinary Expo Go testing does not require EAS signing.
- AI generation, email delivery, payment/webhook flows, push, and live
  NHTSA/Nominatim behavior were not externally validated.
- No credential can complete the incomplete PartsTech/supplier, social
  publishing, video, VIN camera/OCR, or split-payout implementations.

The code does not currently require an LLC/EIN for domains, EAS, AI access, or
test-mode keys as a technical matter; that fact is not authorization for new
external setup.

## 5. Bugs fixed

- Made the Anthropic client optional and lazy. A missing or invalid pair no
  longer prevents API startup; AI routes return explicit `503` unavailability.
- Added fail-closed validation for malformed core URLs such as
  `https://undefined` across API/server URL consumers.
- Removed the fixed Metro `8081` assumption. The mobile build accepts
  `METRO_PORT`, falls back to workflow `PORT` or an available ephemeral port,
  and guards occupied ports.
- Preserved purpose-specific callback URL precedence and rejected insecure
  provider HTTP URLs except loopback in development.
- Rejected invalid numeric job IDs before DB queries, added a real DB health
  query, and sanitized parser/service errors without exposing stack traces.
- Made optional-provider failures nonfatal to core functionality. Push sending
  now checks HTTP/ticket failures and times out; delivery receipts remain unimplemented.
- Added bounded native permission/location setup with late-subscription cleanup,
  explicit capability notices, and Expo Go native-module gates.
- Fixed and retested the mechanic DOM-anchor CSS crash — **PASS** in the real
  mechanic dashboard Available/Profile/logout flow.
- Fixed and retested the address-geocoder block that prevented signup — **PASS**:
  an aborted Nominatim request allowed typed-address continuation, showed the
  unverified/no-coordinates notice, and completed real-UI registration/customer
  home with `home_lat`/`home_lng` remaining null.
- Preserved existing architecture and database behavior; no architecture or
  database replacement was performed.

## 6. Remaining bugs and implementation gaps

- No remaining failure was found in the exercised browser/API flows. The
  screenshots listed above are the final narrow-retest evidence.
- Stripe development endpoints still lack required events/signing-secret
  readiness; this external state is unchanged and is configuration/provider
  work, not a code claim.
- Resend is not configured, so password-reset delivery remains unavailable.
- Signed native/EAS builds, physical-device behavior, push, APNs/FCM, and store
  submission remain unvalidated.
- Supplier/PartsTech ordering, social publishing, AI video, VIN camera/OCR,
  and split payouts remain incomplete implementation areas. Credentials alone
  will not fix them.
- Expo/`expo-constants` version warnings remain intentionally unresolved; no
  dependency upgrade was authorized.
- Deprecated `shadow*`/`pointerEvents`/password-not-form warnings remain
  cosmetic/nonblocking. Duplicate admin logout confirmation logs are noisy but
  the logout flow succeeds.
- Live provider and upstream network behavior remains untested, including
  email, payment, AI generation, NHTSA, Nominatim, and push service behavior.

## 7. Expo Go readiness

The app is prepared for supervised Expo Go testing, not device-certified.
Testing needs an Expo Go client compatible with SDK 54, a valid HTTPS API host,
development DB, and isolated test data. Compatibility with the currently
distributed store client was not verified. The final local mobile build produced the expected
iOS/Android JavaScript bundles and manifests, but this does not establish
physical Expo Go permissions or signed native release readiness.

Camera/image-picker behavior, location denial behavior on a physical device,
native keyboard behavior, push, APNs/FCM, EAS signing, and store distribution
remain outside the Expo Go readiness claim. Expo Go push registration is
intentionally unsupported for this scope. The Expo `54.0.35` and
`expo-constants` `18.0.13` warnings were recorded without upgrades.

## 8. Next steps

1. For any in-scope provider flow, securely verify existing authorized
   configuration without displaying or copying values: Resend sender/DNS,
   Stripe test endpoint events/signing secret, and optional AI integrations.
   Keep new account/key/domain/sender/payment/native EAS setup **BLOCKED
   EXTERNAL SETUP**.
2. Keep live payments, email, AI generation, push, and store/native release
   disabled until their external checks and authorization gates pass.
3. After business-account authorization, validate native EAS/signing/device
   gates and production Stripe/Resend configuration separately; do not infer
   those results from the local JavaScript build.
4. Treat supplier/social/video/VIN scanner/split-payout work as separate
   implementation scope. Do not attempt to resolve those gaps by acquiring
   personal credentials or provider accounts.