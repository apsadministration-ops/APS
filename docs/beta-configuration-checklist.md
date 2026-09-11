# APS Phase 4 beta configuration checklist

**Purpose:** practical, ordered preparation before the APS legal entity is live. This is not a credential request: never put secrets, tokens, private keys, service-account JSON, or legal documents in this file, source control, tickets, screenshots, or chat.

Every checkbox starts unchecked. Do not pre-mark future configuration because a secret name, connector, account, or prior audit exists; record completed audit/history separately. A provider key is not evidence that its adapter works.

## 0. Choose the smallest release scope

- [ ] **Local Replit / Expo Go:** development API/DB/domain; no EAS, store, native push, or live money.
- [ ] **Private supervised beta:** invite-only deployed API, named supported flows, and an owner watching failures; keep money/native-only features off unless their later gates are met.
- [ ] **Open beta:** public users, trusted HTTPS/reset links, verified email sender, privacy/support links, monitoring, and rollback/contact ownership.
- [ ] **Money/native/store production:** select only when payment and/or EAS/store gates below are explicitly in scope. Excluded future social, PartsTech, video, VIN scanner/OCR, and splits must not delay beta.

## 1. Establish the core first

- [ ] Verify the existing development database/schema and managed `DATABASE_URL`; do not replace it. Prepare the separate production database configuration only when deploying that environment.
- [ ] Verify the platform supplies a positive runtime `PORT` and applicable `BASE_PATH`; use development `NODE_ENV` for the development workflow and production mode for the release runtime.
- [ ] Preserve the existing strong `SESSION_SECRET`. Generate one securely only if missing/inadequate, with a migration plan for existing data. It signs sessions and encrypts the integration store; casual rotation invalidates sessions and can make existing encrypted credentials unreadable. Deliberately isolate development and production data/secrets.
- [ ] Configure both import-time Anthropic names in API runtime: `AI_INTEGRATIONS_ANTHROPIC_API_KEY` and `AI_INTEGRATIONS_ANTHROPIC_BASE_URL`; missing either can fail route-tree import before an assistant request.
- [ ] Set a valid HTTPS API host in `EXPO_PUBLIC_DOMAIN`; the client rejects missing/malformed values rather than inventing a URL.
- [ ] Let Replit/build tooling supply platform-derived values as applicable: `REPLIT_CONNECTORS_HOSTNAME`, `REPL_IDENTITY` (or `WEB_REPL_RENEWAL`), `REPLIT_DEPLOYMENT`, `REPLIT_INTERNAL_APP_DOMAIN`, `REPLIT_DEV_DOMAIN`, and `REPL_ID`; local Expo also uses `REPLIT_EXPO_DEV_DOMAIN`, `EXPO_PACKAGER_PROXY_URL`, `REACT_NATIVE_PACKAGER_HOSTNAME`, and `EXPO_PUBLIC_REPL_ID`.
- [ ] Keep server-only values out of the Expo public bundle. `EXPO_PUBLIC_*` is inlined: never put `DATABASE_URL`, `SESSION_SECRET`, connector bearer values, Anthropic/OpenAI keys, Stripe secrets, webhook secrets, admin keys, or integration tokens there.
- [ ] Configure `ADMIN_SETUP_KEY` only if admin bootstrap is needed. Independently verify trusted `APP_BASE_URL` or its valid fallback before password-reset delivery; reset does not require the admin setup key.

## 2. Local Replit / Expo Go

- [ ] Exercise the API from Expo Go using the development domain and DB, with isolated test accounts/data.
- [ ] Confirm scoped login/session persistence, role boundaries, vehicle/job/message flows, VIN decode, and foreground-location fallback. Expo Go does not validate native push.
- [ ] Do not acquire EAS signing, store enrollment, live Stripe, or future provider accounts merely for this scope.

**Historical evidence, not completion of this checklist:** Phase 3 typecheck/server/mobile checks and development Expo **web** manual flows passed. Physical Expo Go permissions, native builds/devices, push, live NHTSA/Nominatim, AI, Resend, Stripe, and production deployment checks were explicitly unrun. Web PASS is not physical/native PASS.

## 3. Prepare now without APS LLC

- [ ] Connect Resend and set `api_key` and verified `from_email` in connector settings, not `RESEND_API_KEY`/`RESEND_FROM_EMAIL` (current code does not consume those example-only names).
- [ ] Use [Resend API keys](https://resend.com/api-keys) and [Resend domains](https://resend.com/domains) to create the provider key and verify a domain you control. Add the exact DKIM, SPF/return-path, and aligned DMARC records Resend supplies; do not blindly replace existing SPF. DNS/sender authorization does not require an LLC.
- [ ] For Stripe **test mode**, inspect the existing endpoint in the [Stripe Dashboard](https://dashboard.stripe.com/) / [test webhooks](https://dashboard.stripe.com/test/webhooks). Confirm its URL is `https://<deployed-api-domain>/api/stripe/webhook`, required events, and signing secret; store that existing secret in the API deployment target as `STRIPE_WEBHOOK_SECRET`.
- [ ] Bind Stripe test `settings.secret` and `settings.publishable` in the Replit Connector; current code does not consume self-hosted `STRIPE_SECRET_KEY`. Verify test Connect onboarding without claiming live payout readiness.
- [ ] Do not create, edit, or delete the existing Stripe endpoint or event subscriptions now; startup inspection is read-only and production is separate.
- [ ] If image generation is in beta scope, connect the Replit OpenAI pair `AI_INTEGRATIONS_OPENAI_API_KEY` and `AI_INTEGRATIONS_OPENAI_BASE_URL` and test `gpt-image-1`; otherwise leave it out of the critical path.
- [ ] Treat generated media as public-by-URL local media: no current object-storage adapter exists, and local files may not survive restarts. Do not promise private or durable image storage.

## 4. Private supervised beta gate

- [ ] Verify the actual deployment has `DATABASE_URL`, positive `PORT`, `NODE_ENV=production`, retained `SESSION_SECRET`, Anthropic pair, trusted API/reset domain, and platform-derived connector identity.
- [ ] Verify only invitation/test-plan flows; record provider responses and rollback/contact ownership without copying secrets.
- [ ] If email is user-visible, verify a real Resend sender/domain and reset delivery. Missing Resend blocks that delivery, not ordinary login.
- [ ] Keep Stripe in test mode unless section 7 payment gates are complete.

## 5. Open beta gate (may still exclude money/native)

- [ ] Confirm public HTTPS API and reset/referral origins (`APP_BASE_URL` or trusted Replit metadata), error handling, support contact, and rollback path.
- [ ] Confirm Resend delivery and sender DNS/reputation; do not use the code’s placeholder sender as production configuration.
- [ ] Re-run scoped auth/authorization/job flows with non-fixture accounts and review public media/privacy implications before enabling image uploads.
- [ ] Publish exclusions: social publishing, PartsTech ordering, AI video, VIN camera/OCR scanner, and splits are not enabled by acquiring keys.

## 6. Conditional EAS/native preparation

- [ ] If beta needs a custom native build, push, or store distribution, create/link the EAS project at [Expo dashboard](https://expo.dev/); add its owner and `expo.extra.eas.projectId`. Current `app.json` has neither (`extra` is empty), so the project ID is missing. Ordinary supported Expo Go permissions do not by themselves require EAS.
- [ ] Replace the known `eas.json` `EXPO_PUBLIC_DOMAIN` placeholder `aps.replit.app` with the real deployed API host before any EAS build. Never put server secrets in `eas.json` or `EXPO_PUBLIC_*`.
- [ ] Test supported camera/image-picker/location behavior in physical Expo Go first. For APS-specific native permission declarations, native-only keyboard behavior and remote push, test an internal development/preview build on a physical device; Expo Go cannot validate that custom native configuration.
- [ ] Resolve or explicitly accept the known build risk before release: `artifacts/mobile/scripts/build.js` probes fixed Metro port `8081`, while managed startup is dynamic and the mockup can occupy `8081`.
- [ ] Keep EAS account/project/signing/APNs/FCM work out of a web-only beta.

## 7. Money and store production gates

- [ ] For production money, bind/validate the production Stripe Connector selected by `REPLIT_DEPLOYMENT=1`; validate publishable/secret settings without confusing them with test mode.
- [ ] Use the existing production webhook endpoint at the deployed API URL with matching `STRIPE_WEBHOOK_SECRET`, required event coverage, signature verification, retries, refunds/disputes, and Connect account readiness.
- [ ] Complete Stripe’s applicable legal representative, tax, bank, and payout verification for the intended APS entity before enabling live settlement.
- [ ] For a store release, create records for `com.aps.autoservice`, configure EAS signing/submission and privacy/data disclosures, and keep Google service-account JSON outside git.
- [ ] Use [Apple Developer enrollment](https://developer.apple.com/programs/enroll/) and [Google Play Console](https://play.google.com/console/signup) only when native/store scope requires them; organization enrollment may wait for APS.

## 8. Missing secret versus stub

| Signal | Meaning |
| --- | --- |
| Missing `DATABASE_URL`, `PORT`, `SESSION_SECRET`, or Anthropic pair | Real core deployment blocker. |
| Missing Resend connector/DNS | Blocks production email/reset, not login. |
| Missing Stripe connector/webhook secret | Blocks payment/webhook readiness, not non-money beta. |
| Missing OpenAI proxy pair | Optional images unavailable; API can boot. |
| PartsTech/social/video key present | Does not enable the current stub; keys alone are not beta work. |
| VIN provider key absent | No key is needed for NHTSA decode; camera/OCR scanner remains incomplete. |

## 9. Business timing and provider costs

- [ ] Wait for the actual APS entity only for live Stripe payouts/bank/tax/representative verification and organization-owned Apple/Google enrollment where that entity is required. Do not wait for domains, hosting, Resend, EAS, AI access, or Stripe test mode.
- [ ] Replit AI usage is billed through Replit credits; Resend has a free tier; Expo/EAS has a limited free tier; Apple/Google enrollment is paid when its native/store scope requires it. Consult current provider pricing/limits; do not invent or hard-code fees here.

**Source boundaries:** implementation inventory: `docs/api-secret-requirements.md`; mobile placeholders/placements: `artifacts/mobile/app.json`, `artifacts/mobile/eas.json`, and `artifacts/mobile/STORE_RELEASE.md`; fixed-8081 risk: `artifacts/mobile/scripts/build.js`.