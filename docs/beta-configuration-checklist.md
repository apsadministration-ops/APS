# APS Phase 5 beta configuration checklist

**Purpose:** practical, ordered preparation before the APS legal entity is live. This is not a credential request: never put secrets, tokens, private keys, service-account JSON, or legal documents in this file, source control, tickets, screenshots, or chat.

Every checkbox starts unchecked. Do not pre-mark future configuration because a secret name, connector, account, or prior audit exists; record completed audit/history separately. A provider key is not evidence that its adapter works.

**External-setup authorization:** Do not create provider accounts, personal-identity credentials, domains, keys, or other external setup for APS until the business-account owner authorizes it. Securely verify existing configuration only; new account/key/domain acquisition is **BLOCKED EXTERNAL SETUP**. The code may not require an LLC/EIN for domains, EAS, AI access, or test-mode keys, but that technical fact is not authorization to obtain them under a personal identity.

## 0. Choose the smallest release scope

- [ ] **Local Replit / Expo Go:** development API/DB/domain; no EAS, store, native push, or live money.
- [ ] **Private supervised beta:** invite-only deployed API, named supported flows, and an owner watching failures; keep money/native-only features off unless their later gates are met.
- [ ] **Open beta:** public users, trusted HTTPS/reset links, verified email sender, privacy/support links, monitoring, and rollback/contact ownership.
- [ ] **Money/native/store production:** select only when payment and/or EAS/store gates below are explicitly in scope. Excluded future social, PartsTech, video, VIN scanner/OCR, and splits must not delay beta.

## 1. Establish the core first

- [ ] Verify the existing development database/schema and managed `DATABASE_URL`; do not replace it. Prepare the separate production database configuration only when deploying that environment.
- [ ] Verify the platform supplies a positive runtime `PORT` and applicable `BASE_PATH`; use development `NODE_ENV` for the development workflow and production mode for the release runtime.
- [ ] Securely verify and preserve the existing strong `SESSION_SECRET`. If it is missing/inadequate, record the requirement for authorized deployment secret-manager setup rather than generating a personal credential; plan any migration because casual rotation invalidates sessions and can make existing encrypted credentials unreadable. Deliberately isolate development and production data/secrets.
- [ ] Securely verify the existing optional Anthropic pair in API runtime, when AI is in scope: `AI_INTEGRATIONS_ANTHROPIC_API_KEY` and `AI_INTEGRATIONS_ANTHROPIC_BASE_URL`. The Phase 5 client is lazy; a missing/invalid pair no longer blocks startup, and AI routes return an explicit `503` unavailability response.
- [ ] Set a valid HTTPS API host in `EXPO_PUBLIC_DOMAIN`; the client rejects missing/malformed values rather than inventing a URL.
- [ ] Securely verify trusted server URL settings (`APP_BASE_URL`, `PUBLIC_BASE_URL`, `REPLIT_DOMAINS`, and applicable deployment domains) resolve to an authorized valid origin. API/server URL consumers reject malformed placeholders such as `https://undefined` rather than emitting them; this source behavior is not a native/deployed test claim.
- [ ] Let Replit/build tooling supply platform-derived values as applicable: `REPLIT_CONNECTORS_HOSTNAME`, `REPL_IDENTITY` (or `WEB_REPL_RENEWAL`), `REPLIT_DEPLOYMENT`, `REPLIT_INTERNAL_APP_DOMAIN`, `REPLIT_DEV_DOMAIN`, and `REPL_ID`; local Expo/build also uses `REPLIT_EXPO_DEV_DOMAIN`, `EXPO_PACKAGER_PROXY_URL`, `REACT_NATIVE_PACKAGER_HOSTNAME`, `EXPO_PUBLIC_REPL_ID`, and optional non-secret `METRO_PORT` (otherwise `PORT`/ephemeral fallback).
- [ ] Keep server-only values out of the Expo public bundle. `EXPO_PUBLIC_*` is inlined: never put `DATABASE_URL`, `SESSION_SECRET`, connector bearer values, Anthropic/OpenAI keys, Stripe secrets, webhook secrets, admin keys, or integration tokens there.
- [ ] Configure `ADMIN_SETUP_KEY` only if admin bootstrap is needed. Independently verify trusted `APP_BASE_URL` or its valid fallback before password-reset delivery; reset does not require the admin setup key.

## 2. Local Replit / Expo Go

- [ ] Exercise the API from Expo Go using the development domain and DB, with isolated test accounts/data.
- [ ] Confirm scoped login/session persistence, role boundaries, vehicle/job/message flows, VIN decode, and foreground-location fallback. Expo Go does not validate native push.
- [ ] Do not acquire EAS signing, store enrollment, live Stripe, or future provider accounts merely for this scope.

**Historical evidence, not completion of this checklist:** Phase 3 typecheck/server/mobile checks and development Expo **web** manual flows passed. Phase 5 verification separately passed the full workspace typecheck, mobile helper regressions, 25 backend/AI tests, API build/start, Metro restart, and the final local JavaScript bundle/manifests build; those results do not claim signed native/device behavior. Physical Expo Go permissions, push, live NHTSA/Nominatim, AI, Resend, Stripe, and production deployment checks remain unrun. Web PASS is not physical/native PASS.

**Final narrow browser evidence — PASS:** mechanic real-UI
Available/Profile/logout; shop-owner Locations/Vehicles/Profile/logout; admin
dashboard/Users/logout with fixture-only DB elevation; suspended login `403`;
and the mechanic DOM-anchor/address-geocoder fixes. The aborted Nominatim →
typed-address → unverified/no-coordinates → registration/customer-home path
passed with `home_lat`/`home_lng` null. Screenshots:
`mechanic23w786`, `address6s6f0r`, `adminmxqysg`, `partner5xn25q`,
`invalids2dfkm`, `cleanloginp73byr`. No remaining failure was found in the
exercised flows. `/forgot-password` was rendered only, not submitted; no live
recovery-email pass is claimed. Invalid reset token returned friendly HTML
`410`; Expo `/reset-password` redirects to login because no recovery route is
implemented. Scoped users and `reset_tokens` were cleaned to zero.
Deprecated `shadow*`, `pointerEvents`, and password-not-form warnings are
minor/nonblocking. Admin logout produced duplicate confirmation logs but
succeeded; no exercised flow failed. Proxied `/api/healthz` returned HTTP
`200`/`status: "ok"`, and malformed-login JSON returned HTTP `400`/
`invalid_json`.

## 3. Verify existing configuration; defer external setup

- [ ] Securely verify any already-authorized Resend connector `api_key`/`from_email` and sender/domain configuration, without displaying or copying values. New Resend account/key/domain/DNS setup is **BLOCKED EXTERNAL SETUP**; the code uses connector settings, not `RESEND_API_KEY`/`RESEND_FROM_EMAIL`.
- [ ] For Stripe **test mode**, read-only inspect any already-authorized existing endpoint in the [Stripe Dashboard](https://dashboard.stripe.com/) / [test webhooks](https://dashboard.stripe.com/test/webhooks). Confirm its URL is `https://<deployed-api-domain>/api/stripe/webhook`, required events, and signing secret; verify existing deployment configuration for `STRIPE_WEBHOOK_SECRET`. Test keys/account setup are **BLOCKED EXTERNAL SETUP** pending business-account authorization.
- [ ] Securely verify already-authorized Stripe test `settings.secret` and `settings.publishable` in the Replit Connector; current code does not consume self-hosted `STRIPE_SECRET_KEY`. Do not claim live payout readiness.
- [ ] Do not create, edit, or delete the existing Stripe endpoint or event subscriptions now; startup inspection is read-only and production is separate.
- [ ] If image generation is in beta scope, securely verify an already-authorized Replit OpenAI pair `AI_INTEGRATIONS_OPENAI_API_KEY` and `AI_INTEGRATIONS_OPENAI_BASE_URL`; new integration/key acquisition and `gpt-image-1` calls are **BLOCKED EXTERNAL SETUP** until authorized. Otherwise leave images out of the critical path.
- [ ] Treat generated media as public-by-URL local media: no current object-storage adapter exists, and local files may not survive restarts. Do not promise private or durable image storage.

## 4. Private supervised beta gate

- [ ] Verify the actual deployment has `DATABASE_URL`, positive `PORT`, `NODE_ENV=production`, retained `SESSION_SECRET`, trusted API/reset domain, and platform-derived connector identity. Verify the optional Anthropic pair only when AI routes are in scope; its absence does not block API startup.
- [ ] Verify only invitation/test-plan flows; record provider responses and rollback/contact ownership without copying secrets.
- [ ] If email is user-visible, securely verify an already-authorized Resend sender/domain and reset delivery. Missing Resend blocks that delivery, not ordinary login; new setup is **BLOCKED EXTERNAL SETUP**.
- [ ] Keep Stripe in test mode unless section 7 payment gates are complete.

## 5. Open beta gate (may still exclude money/native)

- [ ] Confirm public HTTPS API and reset/referral origins (`APP_BASE_URL` or trusted Replit metadata), error handling, support contact, and rollback path.
- [ ] Confirm already-authorized Resend delivery and sender DNS/reputation; do not use the code’s placeholder sender as production configuration or perform new external setup.
- [ ] Re-run scoped auth/authorization/job flows with non-fixture accounts and review public media/privacy implications before enabling image uploads.
- [ ] Publish exclusions: social publishing, PartsTech ordering, AI video, VIN camera/OCR scanner, and splits are not enabled by acquiring keys.

## 6. Conditional EAS/native preparation (external setup gated)

- [ ] If beta needs a custom native build, push, or store distribution, securely verify an already-authorized EAS project at [Expo dashboard](https://expo.dev/) and its owner/`expo.extra.eas.projectId`. Current `app.json` has neither (`extra` is empty), so project setup is **BLOCKED EXTERNAL SETUP** pending authorization. Ordinary supported Expo Go permissions do not by themselves require EAS.
- [ ] Replace the known `eas.json` `EXPO_PUBLIC_DOMAIN` placeholder `aps.replit.app` with the real deployed API host only through an authorized release configuration before any EAS build. Never put server secrets in `eas.json` or `EXPO_PUBLIC_*`.
- [ ] Test supported camera/image-picker/location behavior in physical Expo Go first. For APS-specific native permission declarations, native-only keyboard behavior and remote push, test an internal development/preview build on a physical device; Expo Go cannot validate that custom native configuration.
- [ ] Source update addresses the fixed-`8081` build risk: `artifacts/mobile/scripts/build.js` now uses the configured/available Metro port and guards occupied ports. **Final local build PASS:** `METRO_PORT=18115 pnpm --filter @workspace/mobile run build`; iOS/Android JavaScript bundles and manifests emitted with 49 assets. Signed native/device testing remains pending.
- [ ] Keep new EAS account/project/signing/APNs/FCM work **BLOCKED EXTERNAL SETUP** and out of a web-only beta; do not create personal-identity credentials.

## 7. Money and store production gates

- [ ] For production money, once business-account authorization exists, bind/validate the production Stripe Connector selected by `REPLIT_DEPLOYMENT=1`; validate publishable/secret settings without confusing them with test mode. New setup is **BLOCKED EXTERNAL SETUP**.
- [ ] Use the existing production webhook endpoint at the deployed API URL with matching `STRIPE_WEBHOOK_SECRET`, required event coverage, signature verification, retries, refunds/disputes, and Connect account readiness.
- [ ] Complete Stripe’s applicable legal representative, tax, bank, and payout verification for the intended APS entity before enabling live settlement.
- [ ] For a store release, after business-account authorization, configure existing records for `com.aps.autoservice`, EAS signing/submission, and privacy/data disclosures; keep Google service-account JSON outside git. New records/credentials are **BLOCKED EXTERNAL SETUP**.
- [ ] Use [Apple Developer enrollment](https://developer.apple.com/programs/enroll/) and [Google Play Console](https://play.google.com/console/signup) only when native/store scope requires them and authorization is granted; do not create personal-identity enrollment for APS.

## 8. Missing secret versus stub

| Signal | Meaning |
| --- | --- |
| Missing `DATABASE_URL`, `PORT`, or `SESSION_SECRET` | Real core deployment blocker. |
| Missing Anthropic pair | AI assistant/content routes explicitly return `503` unavailable; API startup and unrelated routes are not blocked. |
| Missing Resend connector/DNS | Blocks production email/reset, not login. |
| Missing Stripe connector/webhook secret | Blocks payment/webhook readiness, not non-money beta. |
| Missing OpenAI proxy pair | Optional images unavailable; API can boot. |
| PartsTech/social/video key present | Does not enable the current stub; keys alone are not beta work. |
| VIN provider key absent | No key is needed for NHTSA decode; camera/OCR scanner remains incomplete. |

## 9. Business timing and provider costs

- [ ] Wait for the actual APS entity/business-account authorization for live Stripe payouts/bank/tax/representative verification and organization-owned Apple/Google enrollment where that entity is required. Domain, hosting, Resend, EAS, AI, and Stripe test mode may be technically usable without an LLC/EIN, but no new external setup or credential/account acquisition is authorized now: **BLOCKED EXTERNAL SETUP**. Verify existing configuration only.
- [ ] For already-authorized configurations, Replit AI usage is billed through Replit credits; Resend has a free tier; Expo/EAS has a limited free tier; Apple/Google enrollment is paid when its native/store scope requires it. No new external setup is authorized now; consult current provider pricing/limits only when business-account authorization exists, and do not invent or hard-code fees here.

**Source boundaries:** implementation inventory: `docs/api-secret-requirements.md`; mobile placeholders/placements: `artifacts/mobile/app.json`, `artifacts/mobile/eas.json`, and `artifacts/mobile/STORE_RELEASE.md`; Phase 5 source update for the former fixed-8081 risk: `artifacts/mobile/scripts/build.js` (local JavaScript bundle/manifests build PASS; signed native/device test pending).