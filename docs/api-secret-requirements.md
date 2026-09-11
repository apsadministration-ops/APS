# APS API, secret, and integration requirements — Phase 5 preparation

**Status:** Phase 5 source reconciliation and runtime verification are documented; Phase 3 tests and metadata remain explicitly historical. The Phase 5 source updates make Anthropic optional/lazy, fail AI routes with explicit `503` unavailability when its pair is missing, reject malformed core URLs such as `https://undefined`, and remove the fixed Metro `8081` assumption. Full workspace typecheck, mobile helper regressions, 25 backend/AI tests, API build/start, Metro restart, the final `METRO_PORT=18115` mobile JS build, and the final narrow browser retest passed. Values were not inspected or copied. External/provider checks and signed native/device tests remain release gates.
**Audience:** the person preparing a Phase 5 beta/release, plus the owner of the
deployment, database, payment, email, and mobile accounts.

This document records what the repository actually reads, what it only
documents, and what is still a stub. A key being present in a deployment is
not evidence that it is valid, that the provider account is enabled, or that a
feature is implemented. Do not paste secrets into this document, source
control, tickets, screenshots, or chat.

**External-setup authorization:** Do not create provider accounts, personal-
identity credentials, domains, keys, or other external setup for APS until the
business-account owner authorizes it. Securely verify existing configuration
only; new account/key/domain acquisition is **BLOCKED EXTERNAL SETUP**. The
code may not require an LLC/EIN for domains, EAS, AI access, or test-mode keys,
but that technical fact is not authorization to obtain them under a personal
identity.

**Phase 5 source update:** Anthropic client construction is optional and lazy.
When its key/base-URL pair is missing or invalid, the API still starts and the
AI routes return an explicit `503` provider-unavailable response. Core mobile
and server URL consumers now fail closed for malformed placeholders including
`https://undefined`; this is source behavior, not a claim that native or
deployed paths were tested. The mobile build source now uses a configured or
available Metro port instead of assuming `8081`; the final local JS build
passed with `METRO_PORT=18115`. This does not claim a signed native artifact
or physical device test.

## How to read the counts

**Start here for practical setup:** [Beta configuration checklist](beta-configuration-checklist.md).
Sections 10–13 below add the exact per-secret decision matrix, all-45
now/wait decisions, verification boundaries, and business timing.
“Active” in the 45/15 counts means a first-party consumer or configuration
setter exists, including dormant catalog probes. It does **not** mean a
credential enables a functional feature or is mandatory for beta.

The counts below are reproducible from the source tree as follows:

* **Executable/config consumer path** means a name read or set by first-party
  API/mobile source, a package script, a build script, a Vite configuration, an
  EAS configuration, or a first-party operational script. The Vite-provided
  `import.meta.env.BASE_URL` name is included because it is consumed by the
  Vite artifacts. Names are counted once, case-sensitively. Generated `dist/`,
  `static-build/`, `node_modules/`, dependency internals, and test-only
  fixture assignments are excluded. `process.env` spread is not an invitation
  to enumerate every inherited process variable.
* **Secret-bearing environment variable** means the value is a credential,
  signing/encryption secret, database credential, or platform bearer token.
  Public URLs, IDs, paths, log levels, and routing metadata are not counted as
  secrets merely because they influence a sensitive feature.
* **Dynamic catalog alias** means an `envFallback` string in
  `artifacts/api-server/src/lib/integrationCatalog.ts`. These are included in
  the executable count and also shown separately so a DB key and its
  environment alias are not mistaken for two provider integrations.
* **Document-only** means a name appears in `.env.example` but has no
  first-party consumer. It is not a request to create that secret.
* **Non-environment slots** are counted separately from environment aliases:
  connector settings, encrypted DB rows, EAS account/release/signing
  placements, and provider IDs are not additional environment variables.

### Final inventory counts

| Inventory | Count | Definition |
| --- | ---: | --- |
| Unique executable/config environment names | **45** | First-party consumer/setter paths listed above, including Vite `BASE_URL`, lowercase `npm_config_user_agent`, and optional `METRO_PORT` |
| Secret-bearing names within those 45 | **15** | Type-based classification; not a claim that any value exists |
| Dynamic `envFallback` names | **9** | All nine catalog entries, including their non-secret IDs |
| Secret-bearing dynamic aliases | **6** | `OPENAI_API_KEY`, Facebook token, Instagram token, TikTok token, X access token, X access-token secret |
| `.env.example` names with no consumer | **6** | `STRIPE_SECRET_KEY`, Resend's two names, and Twilio's three names; list in its own section below |
| Additional comment-only environment name | **1** | `STRIPE_API_VERSION`; it is not read or set |
| Current non-environment integration credential slots | **13** | 2 Stripe connector settings + 2 Resend connector settings + 9 encrypted DB catalog keys |
| Secret-bearing current non-environment slots | **8** | Stripe secret, Resend `api_key`, and six secret DB catalog keys |
| Release/mobile identifier or provider-managed placements | **12** | App IDs, EAS owner/project, store submission IDs, service-account path, signing, APNs, and FCM placements; not part of the 13 integration slots |
| Live named external service adapters | **8** | Stripe, Replit Connector API, Resend, Anthropic proxy/SDK, OpenAI proxy/SDK, NHTSA vPIC, Nominatim, and Expo Push |
| Named registered provider stubs | **5** | PartsTech and the four social providers; the generic video stub is intentionally unnamed and excluded from this service count |
| Named planned-only services with no live adapter | **8** | Runway, Pika, Google Veo, OpenAI Sora, Nexpart, WHI Solutions, Worldpac SpeedDial, and Twilio |
| Named current + planned + release service references | **24** | 8 live + 5 named stubs + 8 planned-only + EAS, App Store Connect, and Google Play |

The **52 tracked environment-name mentions** are 45 executable/config names,
6 `.env.example`-only names, and the one comment-only `STRIPE_API_VERSION`.
The 13 current non-environment slots intentionally do **not** add the nine
environment aliases again. The release/mobile count is a placement checklist,
not a claim that a signing credential or provider account exists.

### Exact 45-name executable/config list

This is the Phase 5 audit baseline, including the Vite built-in, the lowercase
package-manager name, and the mobile build override. The historical Phase 4
baseline had 44 names and did not include `METRO_PORT`:

`ADMIN_SETUP_KEY`, `AI_INTEGRATIONS_ANTHROPIC_API_KEY`,
`AI_INTEGRATIONS_ANTHROPIC_BASE_URL`, `AI_INTEGRATIONS_OPENAI_API_KEY`,
`AI_INTEGRATIONS_OPENAI_BASE_URL`, `APP_BASE_URL`, `APP_STORE_URL`,
`APS_BASE_URL`, `BASE_PATH`, `BASE_URL`, `DATABASE_URL`,
`EXPO_PACKAGER_PROXY_URL`, `EXPO_PUBLIC_DOMAIN`, `EXPO_PUBLIC_REPL_ID`,
`FACEBOOK_PAGE_ID`, `FACEBOOK_PAGE_TOKEN`, `INSTAGRAM_ACCESS_TOKEN`,
`INSTAGRAM_USER_ID`, `LOG_LEVEL`, `MEDIA_STORAGE_DIR`, `NODE_ENV`,
`npm_config_user_agent`, `OPENAI_API_KEY`, `PARTSTECH_API_KEY`,
`PARTSTECH_SHOP_ID`, `PLAY_STORE_URL`, `PORT`, `PUBLIC_BASE_URL`,
`REACT_NATIVE_PACKAGER_HOSTNAME`, `REPL_ID`, `REPL_IDENTITY`, `REPLIT_CONNECTORS_HOSTNAME`,
`REPLIT_DEPLOYMENT`, `REPLIT_DEV_DOMAIN`, `REPLIT_DOMAINS`,
`REPLIT_EXPO_DEV_DOMAIN`, `REPLIT_INTERNAL_APP_DOMAIN`, `SESSION_SECRET`,
`STRIPE_WEBHOOK_SECRET`, `METRO_PORT`, `TIKTOK_ACCESS_TOKEN`, `TIKTOK_OPEN_ID`,
`TWITTER_ACCESS_TOKEN`, `TWITTER_ACCESS_TOKEN_SECRET`, `WEB_REPL_RENEWAL`.

The exact 15 secret-bearing names within those 45 are
`ADMIN_SETUP_KEY`, `AI_INTEGRATIONS_ANTHROPIC_API_KEY`,
`AI_INTEGRATIONS_OPENAI_API_KEY`, `DATABASE_URL`, `FACEBOOK_PAGE_TOKEN`,
`INSTAGRAM_ACCESS_TOKEN`, `OPENAI_API_KEY`, `PARTSTECH_API_KEY`,
`REPL_IDENTITY`, `SESSION_SECRET`, `STRIPE_WEBHOOK_SECRET`,
`TIKTOK_ACCESS_TOKEN`, `TWITTER_ACCESS_TOKEN`,
`TWITTER_ACCESS_TOKEN_SECRET`, and `WEB_REPL_RENEWAL`.

The six example-only names are `RESEND_API_KEY`, `RESEND_FROM_EMAIL`,
`STRIPE_SECRET_KEY`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and
`TWILIO_FROM_NUMBER`. `STRIPE_API_VERSION` is a seventh mention only in a
comment. Stripe's connector has a **publishable setting**, but there is no
first-party `STRIPE_PUBLISHABLE_KEY` environment consumer; the conceptual
secret/publishable names in the example/commentary do not change the 52
tracked-name count.

## Master Phase 5 checklist by requested status

The detailed tables below provide source lines and verification boundaries.
This compact matrix makes the status of every exact executable/config name
explicit. “Server-only” means Expo Go does not receive the value; Expo Go
still needs the server endpoint to be configured when exercising API flows.

| Status | Exact names | Expo Go / development dependence | Production dependence; secret and verification |
| --- | --- | --- | --- |
| **REQUIRED** | `DATABASE_URL`, `PORT`, `SESSION_SECRET`, `NODE_ENV`, `BASE_PATH` | `DATABASE_URL`/`PORT` are required by the API if Expo Go calls it; `BASE_PATH` is required by Vite artifacts, not the Expo client. Development may omit `SESSION_SECRET` only because an unsafe fallback exists. | API production requires DB, positive port, `NODE_ENV=production`, and strong `SESSION_SECRET`; `BASE_PATH` is required for Vite hosting. Securely verify existing deployment DB/secret-manager configuration; no personal credential acquisition. |
| **FEATURE SPECIFIC / OPTIONAL** | `AI_INTEGRATIONS_ANTHROPIC_API_KEY`, `AI_INTEGRATIONS_ANTHROPIC_BASE_URL`, `AI_INTEGRATIONS_OPENAI_API_KEY`, `AI_INTEGRATIONS_OPENAI_BASE_URL`, `ADMIN_SETUP_KEY`, `MEDIA_STORAGE_DIR`, `APS_BASE_URL` | Not read by Expo Go. Assistant/content, image generation, admin bootstrap, media persistence, and demo-script checks are server/ops features. | Anthropic pair is lazy and optional: missing/invalid values leave startup available and AI routes return explicit `503` unavailability. OpenAI pair is required only for image calls. API key and admin key are secrets; verify existing authorized configuration only; new external setup is **BLOCKED EXTERNAL SETUP**. Media path and demo URL are not secrets. |
| **FEATURE SPECIFIC** | `REPLIT_CONNECTORS_HOSTNAME`, `REPL_IDENTITY`, `WEB_REPL_RENEWAL`, `REPLIT_DEPLOYMENT`, `STRIPE_WEBHOOK_SECRET`, `PARTSTECH_API_KEY`, `PARTSTECH_SHOP_ID`, `OPENAI_API_KEY`, `FACEBOOK_PAGE_TOKEN`, `FACEBOOK_PAGE_ID`, `INSTAGRAM_ACCESS_TOKEN`, `INSTAGRAM_USER_ID`, `TIKTOK_ACCESS_TOKEN`, `TIKTOK_OPEN_ID`, `TWITTER_ACCESS_TOKEN`, `TWITTER_ACCESS_TOKEN_SECRET` | Not in the Expo bundle. Connector names are platform-managed; payment, email, supplier, and social settings are server-side. Dynamic aliases do not make the social/supplier stubs live. | Connector identity/hostname and Stripe webhook settings are needed only when those features are invoked. Secret subset: identity tokens, webhook secret, PartsTech key, and six catalog secret aliases. Verify existing authorized configuration only; new external setup is **BLOCKED EXTERNAL SETUP**. |
| **OPTIONAL** | `LOG_LEVEL`, `REPLIT_DOMAINS`, `REPLIT_DEV_DOMAIN`, `APP_BASE_URL`, `PUBLIC_BASE_URL`, `APP_STORE_URL`, `PLAY_STORE_URL` | Expo Go can use a valid API domain without reading these; development domains may supply URL fallbacks. | Recommended production URL settings prevent malformed reset/referral/payment links. All are non-secret metadata/URLs. Replit supplies platform domains; owner supplies trusted public/reset and store-link overrides. |
| **DEVELOPMENT ONLY** | `EXPO_PACKAGER_PROXY_URL`, `REACT_NATIVE_PACKAGER_HOSTNAME`, `REPLIT_EXPO_DEV_DOMAIN`, `REPL_ID`, `EXPO_PUBLIC_REPL_ID`, `METRO_PORT`, `npm_config_user_agent` | Expo/Vite dev tooling, Metro, Replit plugin gating, package-manager enforcement and build fallback. `METRO_PORT` is an optional non-secret build override; `PORT` remains the workflow/ephemeral fallback. Public IDs/hostnames only; never put API secrets in them. | Not required by the production API. `METRO_PORT` is used only to request a Metro port and does not remove collision/availability checks. `ARTIFACT_DIR` and `SRC_DIR` in the demo validation shell script are unconditionally assigned local shell variables, not consumed environment inputs; neither is counted. |
| **PRODUCTION ONLY** | `REPLIT_INTERNAL_APP_DOMAIN`, `EXPO_PUBLIC_DOMAIN`, `REPLIT_DEPLOYMENT` | Expo Go/dev can use a supplied development/tunnel domain; `REPLIT_DEPLOYMENT` defaults to non-production behavior when not set. | Production mobile build must choose the real internal/public domain and inject `EXPO_PUBLIC_DOMAIN`; `REPLIT_DEPLOYMENT=1` selects production Connector credentials. These are non-secret routing/selector values. |
| **NOT CURRENTLY NEEDED** | `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `STRIPE_SECRET_KEY`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`, `STRIPE_API_VERSION` | No Expo Go consumer. | No current first-party consumer: Resend uses Connector settings, Stripe uses Connector settings, Twilio is unwired, and API-version text is a comment. Do not create these for Phase 5. |
| **BLOCKED UNTIL BUSINESS ACCOUNT IS AVAILABLE** | Live Stripe activation/payout bank account under the intended APS business entity; organization-owned store enrollment where that legal entity is intended | Not required for ordinary Expo Go tests or Stripe test-mode preparation. | Actual applicable entity/representative/tax/bank verification must occur in the provider portal. Resend, EAS, AI access and Stripe test credentials do **not** inherently require an LLC/EIN first, but all new external setup remains **BLOCKED EXTERNAL SETUP** pending authorization. |

## 1. Preliminary Phase 3 readiness table — historical evidence

This is a planning status, not a credential inventory. “Metadata only” means
the deployment secret-name metadata supplied for this audit, not a read of
values or a successful provider call.

| Area | Preliminary status | What must be confirmed before the relevant beta flow |
| --- | --- | --- |
| API process and DB | **BLOCKED until deployment validation** | `DATABASE_URL` and a valid positive `PORT`; DB migrations/schema availability; do not infer either from a grep or a secret-name list |
| Production auth and encrypted integration store | **BLOCKED UNTIL DEPLOYMENT VALIDATION** | `NODE_ENV=production`, a random `SESSION_SECRET` of at least 32 characters, and a DB connection; the credential store also requires at least 16 characters |
| Development auth metadata | **READY signal only** | `SESSION_SECRET` metadata was reported present in development; length, value, and runtime behavior were not inspected |
| Anthropic assistant/content | **Historical Phase 3 READY signal only** | Both Anthropic proxy names were reported present in development at that time; Phase 5 code is lazy/optional, so missing/invalid configuration now leaves startup available and returns explicit `503` from AI routes. Validate any authorized deployment/provider response if AI is in scope |
| OpenAI image generation | **BLOCKED UNTIL FEATURE CREDENTIAL IS AVAILABLE** | The lazy proxy requires both OpenAI proxy names; those names were not listed in the confirmed development metadata. Test `gpt-image-1` only if an existing authorized integration is connected; otherwise defer external setup |
| Stripe payments | **BLOCKED UNTIL BUSINESS ACCOUNT IS AVAILABLE** | Connector access, selected test/live environment, publishable and secret connector settings, Connect onboarding, and the existing webhook endpoint/signing secret |
| Stripe webhook verification | **BLOCKED until secret/setup validation** | `STRIPE_WEBHOOK_SECRET` was not listed in the confirmed metadata; startup never creates or repairs an endpoint |
| Transactional email | **BLOCKED UNTIL BUSINESS ACCOUNT IS AVAILABLE** | Resend Connector search status is `not_setup` (not connected); missing config returns an email failure |
| Social publishing | **BLOCKED by implementation** | The four registered providers are stubs and throw even when all keys are present; OAuth/callback implementation is absent |
| Parts search/orders | **BLOCKED by implementation** | APS-curated DB offers are live; PartsTech keys only change a configured probe and cannot produce offers or place an order |
| AI video | **BLOCKED by implementation** | The only registered video adapter always reports unconfigured and throws |
| Push notifications | **BLOCKED for native release until EAS setup** | `projectId` and owner are absent from the checked mobile config; native permissions and APNs/FCM/EAS setup are also required. Expo Go intentionally skips push |
| Mobile API routing | **BLOCKED for production release until domain replacement** | The EAS base API domain is a documented placeholder; replace it with the deployed API domain before a production build |
| VIN decode | **READY without a provider key** | Requires network/upstream NHTSA availability and valid VIN input; it is not a credential-free guarantee of service uptime |
| Location/address lookup | **READY CODE PATH; FALLBACK RETEST PASS** | Aborted Nominatim request followed by typed-address continuation, unverified/no-coordinates notice, and customer home completion passed; `home_lat`/`home_lng` remained null. Live upstream availability/rate limits remain unclaimed |
| Growth analytics | **READY as an internal DB feature** | Development database was reachable; no external analytics account or key exists |

## 2. Complete environment inventory

### 2.1 Core server, database, platform, and feature settings

| Name | Secret? | Requiredness and behavior | Acquisition/owner and source |
| --- | --- | --- | --- |
| `DATABASE_URL` | **Yes** (DB credential) | **Startup-required** by the DB package; Drizzle CLI and seed/migration/demo scripts also require it. | Securely verify the existing deployment-managed database configuration; do not replace it. Separate production configuration is an authorized deployment concern. `lib/db/src/index.ts:7-14`; `lib/db/drizzle.config.ts:4-12`; `scripts/src/seed_parts_catalog.mjs:12`; `scripts/src/migrate_parts_system.mjs:8`; `scripts/src/ghostGarageDemo.ts:4,67`; `README.md:133`. |
| `PORT` | No | **Startup-required for API**; must parse as a positive number and has no API default. The demo-video and mockup Vite configs also require it. The static mobile server defaults only its own listener to a local port. | Deployment/runtime assigns it. API: `artifacts/api-server/src/index.ts:4-18`; Vite: `artifacts/demo-video/vite.config.ts:7-18`, `artifacts/mockup-sandbox/vite.config.ts:8-19`; mobile static server: `artifacts/mobile/server/serve.js:132-134`. |
| `NODE_ENV` | No | Controls production enforcement of `SESSION_SECRET` and logger formatting. The API `dev` script forcibly sets development; production `start` must be launched with the intended value. | Deployment configuration, not a secret. `artifacts/api-server/src/lib/auth.ts:4-14`; `artifacts/api-server/src/lib/logger.ts:3-19`; `artifacts/api-server/package.json:6-10`; Vite plugin gating: both Vite configs at lines 35-47/37-47. |
| `SESSION_SECRET` | **Yes** | **Production-required**, at least 32 characters for JWT auth. Development silently uses a fixed unsafe fallback when absent. The AES-GCM integration store requires it at use time and accepts at least 16 characters; rotation invalidates encrypted DB credentials. | Securely verify the existing strong deployment secret; never use the development fallback. If missing, authorized deployment secret-manager setup is required, but no personal credential creation is authorized. `artifacts/api-server/src/lib/auth.ts:4-14`; `artifacts/api-server/src/lib/credentialStore.ts:48-58`. |
| `ADMIN_SETUP_KEY` | **Yes** | Feature-only, not startup-required. Admin bootstrap refuses to operate when it is missing or blank. | Securely verify an existing authorized one-time/admin-only deployment secret if bootstrap is needed; do not display or create personal credentials. `artifacts/api-server/src/lib/authorization.ts:9`; `artifacts/api-server/src/routes/auth.ts:153`. |
| `LOG_LEVEL` | No | Optional; defaults to `info`. | Set only when a different Pino level is required. `artifacts/api-server/src/lib/logger.ts:5-6`. |
| `REPLIT_DOMAINS` | No | Platform domain metadata. Used for payment return URLs, password-reset/referral/amplification links, Stripe webhook inspection, and tips/payout URLs. Missing/invalid metadata now fails closed or makes the dependent flow explicitly unavailable rather than emitting `https://undefined`. | Replit deployment metadata; do not manufacture a secret. `artifacts/api-server/src/lib/stripeInit.ts:8-10`; `routes/payments.ts:217,352`; `routes/payouts.ts:291`; `routes/passwordReset.ts:53-66`; `routes/referrals.ts:24`; `lib/mechanicAmplification.ts:45-50`; `lib/tipEngine.ts:77`. |
| `REPLIT_DEV_DOMAIN` | No | Development/preview domain fallback for reset/referral URLs and mobile build domain precedence. | Replit development metadata. `artifacts/api-server/src/routes/passwordReset.ts:61-66`; `routes/referrals.ts:24`; `artifacts/mobile/scripts/build.js:57-73`. |
| `APP_BASE_URL` | No | Optional explicit trusted password-reset base URL; source precedence is `APP_BASE_URL`, then `REPLIT_DOMAINS`, then `REPLIT_DEV_DOMAIN`, then a development-only localhost fallback. Invalid/placeholder values fail closed in production. | Verify an authorized public HTTPS API/app origin for a deployed reset flow. `artifacts/api-server/src/routes/passwordReset.ts:53-66`. The test assignment in `tests/password-reset.integration.test.ts:85` is fixture-only and is not counted separately. |
| `PUBLIC_BASE_URL` | No | Optional amplification-link fallback. The implementation checks `REPLIT_DOMAINS` first, then this value; invalid placeholders fail closed, and it is not the password-reset setting. | Verify an authorized trusted public origin if Replit domain metadata is unavailable. `artifacts/api-server/src/lib/mechanicAmplification.ts:45-50`. |
| `APP_STORE_URL` | No | Optional public marketing-link override; falls back to a built-in store link. | Set after store records exist; not a credential. `artifacts/api-server/src/lib/mechanicAmplification.ts:42-60`. |
| `PLAY_STORE_URL` | No | Optional public marketing-link override; falls back to a built-in store link. | Set after the Play record exists; not a credential. `artifacts/api-server/src/lib/mechanicAmplification.ts:42-60`. |
| `MEDIA_STORAGE_DIR` | No | Optional local filesystem directory for generated media; defaults under the process working directory. No cloud object-storage adapter is wired. | Choose a persistent writable deployment volume if media must survive restarts. `artifacts/api-server/src/lib/mediaEngine.ts:43-45`; media route/persistence: `lib/mediaEngine.ts:132-203`. |
| `REPLIT_CONNECTORS_HOSTNAME` | No (host metadata) | Required when Stripe or Resend connector lookup is invoked. Not a user API key. | Replit Connector platform binding. `artifacts/api-server/src/lib/stripeClient.ts:12-21`; `lib/email.ts:30-49`. |
| `REPL_IDENTITY` | **Yes** (platform bearer token) | One of the two connector auth inputs; preferred when present and prefixed internally for the Connector API. | Platform-managed; do not create a fake value. `artifacts/api-server/src/lib/stripeClient.ts:13-18`; `lib/email.ts:34-39`. |
| `WEB_REPL_RENEWAL` | **Yes** (platform bearer token) | Fallback connector auth input when `REPL_IDENTITY` is unavailable; prefixed internally. | Platform-managed deployment credential. `artifacts/api-server/src/lib/stripeClient.ts:14-18`; `lib/email.ts:35-39`. |
| `REPLIT_DEPLOYMENT` | No | Connector target selector: exactly `1` selects production, otherwise development. This is not a Stripe test/live switch exposed to users. | Replit deployment metadata. `artifacts/api-server/src/lib/stripeClient.ts:23-29`. |
| `STRIPE_WEBHOOK_SECRET` | **Yes** | Feature-required for signature verification; missing/invalid leaves webhooks not ready but does not stop API startup. | Securely verify the signing secret from an already-authorized matching Stripe endpoint and store only in deployment secrets. New endpoint/key setup is **BLOCKED EXTERNAL SETUP**. `artifacts/api-server/src/lib/stripeInit.ts:6-28`; validation/cache: `lib/stripeWebhookSetup.ts:32-50`, `lib/stripeClient.ts:58-61`. |
| `PARTSTECH_API_KEY` | **Yes** | Only participates in the PartsTech stub’s configured check. It does not make search or ordering live. | Defer supplier account/key setup as **BLOCKED EXTERNAL SETUP**; even an authorized future key cannot replace the missing adapter. `artifacts/api-server/src/lib/suppliers/external/partsTechStub.ts:1-20,30-53`. |
| `PARTSTECH_SHOP_ID` | No (account/shop ID) | Paired with the PartsTech key for the configured probe; no live behavior follows. | Defer supplier shop setup as **BLOCKED EXTERNAL SETUP**. Same source as above. |

### 2.2 AI integration environment names

| Name | Secret? | Requiredness and behavior | Acquisition/source |
| --- | --- | --- | --- |
| `AI_INTEGRATIONS_ANTHROPIC_API_KEY` | **Yes** | Optional lazy provider setting. Missing/invalid value does not stop startup; assistant/content AI routes return explicit `503` provider unavailability when invoked. | Securely verify an existing authorized Replit Anthropic integration only. New external account/key setup is **BLOCKED EXTERNAL SETUP**. `lib/integrations-anthropic-ai/src/client.ts:1-74`; assistant/content route handling. |
| `AI_INTEGRATIONS_ANTHROPIC_BASE_URL` | No (endpoint) | Optional paired lazy provider endpoint. Missing/invalid value does not stop startup; AI calls are explicitly unavailable. | Securely verify an existing authorized managed proxy endpoint only; do not substitute an unapproved endpoint or acquire external credentials now. Same client source. |
| `AI_INTEGRATIONS_OPENAI_API_KEY` | **Yes** | Both OpenAI proxy names are required lazily for image generation. The API can boot without them, but image calls return provider-not-configured. | Securely verify an existing authorized Replit OpenAI AI integration only; new external account/key setup is **BLOCKED EXTERNAL SETUP**. `lib/integrations-openai-ai/src/client.ts:21-40`; live image adapter: `artifacts/api-server/src/lib/mediaProviders/openaiImage.ts:34-89`. |
| `AI_INTEGRATIONS_OPENAI_BASE_URL` | No (endpoint) | Paired with the proxy key; lazy feature requirement for `gpt-image-1`. | Verify the existing authorized managed endpoint only. Same client and image-adapter sources. |

### 2.3 Dynamic catalog environment fallbacks: all 9 names

`credentialStore` checks the encrypted DB row first and consults an
`envFallback` only when no DB row exists (`artifacts/api-server/src/lib/credentialStore.ts:108-145`).
The status endpoint never returns plaintext (`:178-235`). A DB row therefore
does not get replaced by a newly-added environment alias until that row is
deleted. These aliases are not evidence that the social adapters work.

| Canonical DB key | Environment fallback | Secret? | Catalog required? | Acquisition/consumer |
| --- | --- | --- | --- | --- |
| `openai_api_key` | `OPENAI_API_KEY` | **Yes** | Yes for the OpenAI BYO group | Admin encrypted store or deployment fallback; the current image adapter uses the Replit proxy, not this BYO key. `integrationCatalog.ts:99-108`; `openaiImage.ts:13-51`. |
| `facebook_page_token` | `FACEBOOK_PAGE_TOKEN` | **Yes** | Yes | Verify an existing authorized Page token only; new Meta account/token setup is **BLOCKED EXTERNAL SETUP**. No live Facebook adapter is registered. `integrationCatalog.ts:110-119`; `publishingProviders/stubs.ts:23-45`. |
| `facebook_page_id` | `FACEBOOK_PAGE_ID` | No | Yes | Numeric target Page ID; not sensitive by itself. Social provider is still a stub. `integrationCatalog.ts:120-128`; same stub source. |
| `instagram_access_token` | `INSTAGRAM_ACCESS_TOKEN` | **Yes** | Yes | Verify an existing authorized Page token for the linked Business account only; new account/token setup is **BLOCKED EXTERNAL SETUP**. No live adapter. `integrationCatalog.ts:130-139`; same stub source. |
| `instagram_user_id` | `INSTAGRAM_USER_ID` | No | Yes | Numeric Instagram Business user ID; no live adapter. `integrationCatalog.ts:140-148`. |
| `tiktok_access_token` | `TIKTOK_ACCESS_TOKEN` | **Yes** | Yes | Verify an existing authorized OAuth token with `video.publish` only; new app/account/token setup is **BLOCKED EXTERNAL SETUP**. No OAuth exchange or live adapter. `integrationCatalog.ts:150-159`. |
| `tiktok_open_id` | `TIKTOK_OPEN_ID` | No | Yes | Provider-issued open ID; no callback implementation. `integrationCatalog.ts:160-168`. |
| `twitter_access_token` | `TWITTER_ACCESS_TOKEN` | **Yes** | Yes | Verify an existing authorized OAuth 2.0 token with `tweet.write` only; new app/account/token setup is **BLOCKED EXTERNAL SETUP**. No live X adapter. `integrationCatalog.ts:170-179`. |
| `twitter_access_token_secret` | `TWITTER_ACCESS_TOKEN_SECRET` | **Yes** | No | Only needed for an OAuth 1.0a implementation; optional for the catalog and currently unused by a live adapter. `integrationCatalog.ts:180-188`. |

Catalog acquisition links currently shown to admins are Facebook Pages
(`integrationCatalog.ts:61-66`), Instagram Graph (`:69-75`), TikTok
Content Posting (`:79-84`), and X Developer Portal (`:87-93`). Manually
pasting tokens is the only current path; OAuth client IDs, client secrets,
redirect URIs, callback routes, token exchange, refresh, and revocation are
not implemented.

### 2.4 Mobile, build, package, scripts, and Vite names

| Name | Secret? | Requiredness and behavior | Acquisition/source |
| --- | --- | --- | --- |
| `APS_BASE_URL` | No | Optional script-only API base override; `ghostGarageDemo.ts` defaults locally when absent and still requires `DATABASE_URL`. | Set only when running that demo against a chosen API. `scripts/src/ghostGarageDemo.ts:3-4,30`. |
| `BASE_PATH` | No | **Required by both Vite configs**; optional with `/` default in the mobile build/serve scripts. | Hosting/build path setting. `artifacts/demo-video/vite.config.ts:21-27`; `artifacts/mockup-sandbox/vite.config.ts:22-28`; `artifacts/mobile/scripts/build.js:23`; `artifacts/mobile/server/serve.js:18`. |
| `BASE_URL` | No | Vite-provided built-in consumed by demo-video/mockup assets; not a separately provisioned deployment value. | Derived by Vite from its `base` configuration. `artifacts/demo-video/src/components/video/VideoTemplate.tsx:54,64`; `video_scenes/Scene1.tsx:26`; `artifacts/mockup-sandbox/src/App.tsx:91`. |
| `REPLIT_INTERNAL_APP_DOMAIN` | No | First mobile build domain precedence; build exits if none of this, `REPLIT_DEV_DOMAIN`, or `EXPO_PUBLIC_DOMAIN` is valid. | Replit platform metadata. `artifacts/mobile/scripts/build.js:47-73`. |
| `EXPO_PUBLIC_DOMAIN` | No (public API host) | Mobile API runtime/build input. Expo inlines `EXPO_PUBLIC_*`; invalid/missing values produce an explicit API configuration error rather than a fabricated URL. | Replit dev metadata, local tunnel/IP, or the deployment owner’s public API domain. `artifacts/mobile/lib/apiConfig.ts:1-67`; build injection `scripts/build.js:57-73,130-164`; EAS config `artifacts/mobile/eas.json:6-11`. |
| `METRO_PORT` | No | Optional non-secret Metro port override for a direct/mobile build invocation. When absent, the build uses workflow `PORT` or an available ephemeral port; occupied ports are not attached to or killed. | Existing build/runtime configuration only; no account or credential. `artifacts/mobile/scripts/build.js:117-127,191-211`. |
| `REPL_ID` | No (public project ID) | Used by Vite dev-plugin gating and mobile dev/build fallback. | Replit platform metadata. Vite configs at lines 35-47/37-47; `artifacts/mobile/scripts/build.js:126-128`; mobile package script line 7. |
| `EXPO_PUBLIC_REPL_ID` | No (public ID) | Set into Metro’s environment by the mobile build and used as fallback when `REPL_ID` is absent. | Build-derived public project ID; never put a server secret here. `artifacts/mobile/scripts/build.js:126-146`. |
| `EXPO_PACKAGER_PROXY_URL` | No | Dev-only package-script assignment from the Replit Expo dev domain. | Replit dev environment; `artifacts/mobile/package.json:6-11`. |
| `REACT_NATIVE_PACKAGER_HOSTNAME` | No | Dev-only package-script assignment from the Replit dev domain. | Replit dev environment; same package script. |
| `REPLIT_EXPO_DEV_DOMAIN` | No | Source for the dev-only Expo packager proxy URL. | Replit dev metadata; `artifacts/mobile/package.json:7`. |
| `npm_config_user_agent` | No | Root preinstall reads it only to enforce pnpm; it is not an application setting. | Package manager sets it. `package.json:5-9`. |

The Vite source references `import.meta.env.BASE_URL` in the demo-video and
mockup artifacts (`artifacts/demo-video/src/components/video/VideoTemplate.tsx:54,64`,
`video_scenes/Scene1.tsx:26`, and `artifacts/mockup-sandbox/src/App.tsx:91`).
`BASE_URL` is a Vite-provided built-in derived from `base`; it is included in
the 45-name audit count even though it is not a separately provisioned
deployment variable.

The mobile dev package script sets `EXPO_PUBLIC_DOMAIN`,
`EXPO_PUBLIC_REPL_ID`, `EXPO_PACKAGER_PROXY_URL`, and
`REACT_NATIVE_PACKAGER_HOSTNAME` before starting Expo and passes `PORT`
(`artifacts/mobile/package.json:7`). The mobile build reads optional
`METRO_PORT` before falling back to `PORT` or an available ephemeral port
(`scripts/build.js:117-127,191-211`); other process environment values are
passed through without additional named consumers to document.

### 2.5 Documentation-only `.env.example` names — NOT CURRENTLY NEEDED

These six names are extracted as names only. They have no first-party
consumer in the current source and must not be added merely because they are
shown in `.env.example`:

| Name | Why it is not currently needed |
| --- | --- |
| `STRIPE_SECRET_KEY` | The application obtains Stripe secret/publishable settings through the Replit Connector API; no self-hosted env-key path is implemented. |
| `RESEND_API_KEY` | Email fetches connector setting `api_key`, not this environment name. |
| `RESEND_FROM_EMAIL` | Email fetches connector setting `from_email`, not this environment name. |
| `TWILIO_ACCOUNT_SID` | No Twilio SDK, endpoint, or SMS adapter is wired. |
| `TWILIO_AUTH_TOKEN` | No Twilio consumer exists. |
| `TWILIO_FROM_NUMBER` | No Twilio consumer exists. |

`STRIPE_API_VERSION` appears in a Stripe client comment only
(`artifacts/api-server/src/lib/stripeClient.ts:43-47`); it is not read and is
not counted. The `.env.example` values were not read into this report.

## 3. Non-environment credential slots and identifiers

### 3.1 Stripe Connector and account slots

The application does **not** read `STRIPE_SECRET_KEY` or a publishable key
from environment. `getCredentials()` calls the Replit Connector API on every
Stripe operation with `include_secrets=true`, asks for `connector_names=stripe`,
and selects `development` unless `REPLIT_DEPLOYMENT` is exactly `1`
(`artifacts/api-server/src/lib/stripeClient.ts:12-40`). The two current
Stripe connector slots are therefore:

| Slot | Secret? | Requiredness | Acquisition and external settings |
| --- | --- | --- | --- |
| Connector `settings.secret` | **Yes** | Required for Stripe API calls, payments, Connect onboarding, and webhook inspection | Securely verify an already-authorized Stripe Connector binding for the selected environment. New account/key setup is **BLOCKED EXTERNAL SETUP**. Stripe documentation: [Connect testing](https://docs.stripe.com/connect/testing). |
| Connector `settings.publishable` | No (publishable credential) | Required wherever the server returns a publishable key for client checkout/onboarding flows | Verify the existing authorized Connector binding; never replace it with a secret key in mobile code. New setup is **BLOCKED EXTERNAL SETUP**. |
| Connected Stripe account IDs in user/shop DB rows | No (provider IDs) | Required per mechanic/shop that receives Connect transfers; onboarding must mark the account ready | The user/shop completes Stripe Connect onboarding through the server. The IDs are persisted by payment routes (`artifacts/api-server/src/routes/payments.ts:121-225,336-373`). |
| Stripe customer/payment/checkout/transfer IDs in DB | No (provider IDs) | Created as payment flows run; not a credential | Server-side Stripe objects are referenced from payment rows; no value belongs in this report. |

Stripe live payouts also require the applicable identity/entity/bank and
provider verification. An LLC or EIN is **not universally mandatory for
testing or every Stripe legal-business type**; never ask users to send legal
documents to this project. Let Stripe request the actual applicable
information inside its provider onboarding flow. For live setup, see
[required verification information](https://docs.stripe.com/connect/required-verification-information).

### 3.2 Stripe webhook, callback, and external settings checklist

The inbound callback is the server-owned `POST /api/stripe/webhook` endpoint,
mounted with a raw body parser before JSON parsing
(`artifacts/api-server/src/app.ts:34-41`). The configured external endpoint
must target `https://<first deployment domain>/api/stripe/webhook`, not the
Expo/mobile origin (`lib/stripeWebhookSetup.ts:46-52`). Core URL validation now
applies across API/server public URL, reset, referral, payment, payout, tip, and
webhook/callback consumers: malformed placeholders such as `https://undefined`
fail closed rather than being emitted. Verify an authorized HTTPS deployment
domain before using those flows; this is source-level validation, not a claim
that deployed or native paths were tested. The existing endpoint
must be enabled and include these events, unless it uses a wildcard:

* `checkout.session.completed`
* `payment_intent.amount_capturable_updated`
* `payment_intent.succeeded`
* `payment_intent.payment_failed`
* `payment_intent.canceled`
* `account.updated`
* `charge.refunded`
* `charge.dispute.created`
* `charge.dispute.updated`
* `charge.dispute.closed`
* `charge.dispute.funds_withdrawn`
* `charge.dispute.funds_reinstated`
* `transfer.created`
* `transfer.reversed`
* `payout.paid`
* `payout.failed`
* `payout.canceled`

At startup, Stripe initialization is asynchronous and non-blocking. With a
signing secret it only caches that secret; without one it lists endpoints to
report a matching URL and missing events. It never creates, edits, or deletes
an endpoint (`artifacts/api-server/src/lib/stripeInit.ts:6-28`;
`stripeWebhookSetup.ts:1-64`). This means endpoint creation, endpoint secret
retrieval, event selection, Connect platform settings, test/live account
selection, payout/bank onboarding, and business verification are external
operations—not things a key alone completes.

### 3.3 Resend connector slots

Resend is a live REST adapter, but its credentials are obtained through the
Replit Connector rather than the two `.env.example` names:

| Connector setting | Secret? | Requiredness | Source/acquisition |
| --- | --- | --- | --- |
| `settings.api_key` | **Yes** | Required for any send; missing settings returns `email_provider_not_configured` and sends nothing | Bind the Resend connector, obtain an API key in the provider, and verify a sending domain. The connector lookup and send are `artifacts/api-server/src/lib/email.ts:30-99`. |
| `settings.from_email` | No (sender identity) | Optional in code, but a real verified sender/domain is required for production deliverability | Configure a verified sender/domain in Resend; code uses a placeholder fallback only when connector setting is absent. See [Resend domain setup](https://resend.com/docs/dashboard/domains/introduction). |

The outbound endpoint is `POST https://api.resend.com/emails`. There is no
Resend webhook or callback consumer in the repository. Password reset callers
mask provider failure from the user to prevent account enumeration; that
does not make delivery successful.

The Resend Connector search status is **`not_setup` (not connected)**. No
credential value or sender value was accessed.

### 3.4 Encrypted DB integration slots

The nine canonical keys in the dynamic table are the current DB-backed slots,
not nine additional provider accounts. They are stored in
`integration_credentials.value_encrypted` using AES-256-GCM
(`lib/db/src/schema/integrationCredentials.ts:13-24`) and are written/read
only through admin-protected integration routes
(`artifacts/api-server/src/routes/integrations.ts:22-56`). The store never
returns plaintext in status responses. The current slot count is therefore
**9 total / 6 secret / 3 non-secret IDs**:

* Secret slots: `openai_api_key`, `facebook_page_token`,
  `instagram_access_token`, `tiktok_access_token`, `twitter_access_token`,
  `twitter_access_token_secret`.
* Non-secret ID slots: `facebook_page_id`, `instagram_user_id`,
  `tiktok_open_id`.

The `openai_api_key` catalog slot is labeled BYO/future in the catalog and is
not consumed by the current Replit OpenAI image adapter. Social slots can
make a stub’s status appear configured, but do not enable publishing.

### 3.5 EAS, store, signing, APNs, and FCM placements

The mobile app has iOS bundle identifier and Android package
`com.aps.autoservice` in `artifacts/mobile/app.json:12-30`, but EAS owner and
project ID are absent from `expo.extra` (`app.json:122-127`). The checked
`eas.json` contains production submit placements that still require real
account identifiers and a Google service-account file path
(`artifacts/mobile/eas.json:40-50`). Do not put API-server secrets into
`EXPO_PUBLIC_*` variables; the store guide explicitly places DB/JWT/Stripe
server secrets in the API deployment (`artifacts/mobile/STORE_RELEASE.md:121-128`).

| Placement/ID | Secret? | Requirement and acquisition |
| --- | --- | --- |
| iOS bundle ID | No | Existing app identifier; verify any already-authorized App Store Connect app record. New record/setup is **BLOCKED EXTERNAL SETUP**. |
| Android package | No | Existing app identifier; verify any already-authorized Play Console app. New record/setup is **BLOCKED EXTERNAL SETUP**. |
| Expo owner/account | No (account ID) | Verify an existing authorized Expo owner/project only; do not log in, create, or link an account under a personal identity. |
| EAS project ID | No (project ID) | Verify an existing authorized `expo.extra.eas.projectId`; native push token registration cannot infer a project without it. New project setup is **BLOCKED EXTERNAL SETUP**. `STORE_RELEASE.md:22-30`; `hooks/usePushNotifications.ts:63-80`. |
| Apple ID, App Store Connect app ID, Apple Team ID | No (submission/account IDs) | Verify existing authorized production submit settings only. New store enrollment/IDs are **BLOCKED EXTERNAL SETUP**. |
| Google Play service-account JSON | **Yes** (credential material) | Verify authorized existing release credentials stored outside git; do not create a service account or obtain personal-identity credentials. New setup is **BLOCKED EXTERNAL SETUP**. `STORE_RELEASE.md:14-20,40-43`. |
| iOS EAS signing credentials | **Yes** (provider-managed signing material) | Verify authorized existing EAS/Apple signing configuration only. New membership or signing setup is **BLOCKED EXTERNAL SETUP**. `STORE_RELEASE.md:65-79`. |
| Android EAS signing credentials | **Yes** (provider-managed signing material) | Verify authorized existing EAS/Android signing configuration only; new setup is **BLOCKED EXTERNAL SETUP**. |
| APNs push credentials | **Yes** (provider-managed push credential) | Verify authorized existing EAS/Apple push configuration only; new credential setup is **BLOCKED EXTERNAL SETUP**. |
| FCM/Android push credentials | **Yes** (provider-managed push credential) | Verify authorized existing EAS/Google push configuration only; new credential setup is **BLOCKED EXTERNAL SETUP**. The server uses Expo Push and has no FCM env key. |

The 12 release placements counted above are the two app IDs, Expo owner and
project ID, three Apple submission IDs, the Google service-account placement,
two signing placements, and APNs/FCM push placements. They are requirements,
not evidence of account or credential presence. See the Expo references:
[notifications SDK](https://docs.expo.dev/versions/v54.0.0/sdk/notifications/)
and [push notification setup](https://docs.expo.dev/push-notifications/push-notifications-setup/).

### 3.6 OAuth and callbacks: explicitly not implemented

No OAuth client ID/secret, authorization route, redirect URI, callback
handler, token exchange, refresh-token storage, revocation, or inbound social
webhook was found for Facebook, Instagram, TikTok, or X. The admin UI accepts
manually supplied catalog values and encrypts them, but the registered
providers are `facebookStub`, `instagramStub`, `tiktokStub`, and
`twitterStub` (`artifacts/api-server/src/lib/publishingProviders/registry.ts:18-23`;
`stubs.ts:23-53`). Each stub throws from `publish()` even when required keys
are present.

Do not tell a beta user that acquiring these tokens enables publishing. A
future implementation will need provider app registration, client
credentials, exact HTTPS redirect URLs, scopes, secure token storage/refresh,
and platform-specific callback/webhook validation. Those planned OAuth slots
are not counted as current credentials because no code consumes them.

## 4. Services: live, stubbed, and planned

The service count uses one row per distinct named provider/SDK adapter, not one
row per URL path. Internal API routes and ordinary provider links are not
counted as external services.

### 4.1 Live adapters (8)

| Service/adapter | Actual endpoint or SDK | Credential requirement and callback/settings |
| --- | --- | --- |
| Replit Connector API | `https://<REPLIT_CONNECTORS_HOSTNAME>/api/v2/connection` | Platform hostname plus identity token; serves Stripe and Resend connector settings. No user-created API key in app env. `stripeClient.ts:12-40`; `email.ts:30-49`. |
| Stripe | Installed `stripe` SDK; provider calls from `stripeClient.ts` | Secret/publishable settings come from Connector; connected account IDs and webhook signing secret are separate requirements. Inbound callback is `/api/stripe/webhook`. |
| Resend | `https://api.resend.com/emails` | Connector `api_key` and verified sender/domain; no callback. `email.ts:67-99`. |
| Anthropic | `@anthropic-ai/sdk` through the configured proxy base URL | Optional lazy provider. Assistant/content callers use the pair when configured; missing/invalid settings leave startup available and return explicit `503` unavailability from AI routes. No callback. `lib/integrations-anthropic-ai/src/client.ts:1-74`. |
| OpenAI image | `openai` SDK through the configured Replit proxy; model adapter `gpt-image-1` | Two proxy names are lazy feature requirements; output is persisted to local media storage. No callback. `lib/integrations-openai-ai/src/client.ts:21-40`; `openaiImage.ts:34-89`. |
| NHTSA vPIC | `https://vpic.nhtsa.dot.gov/api/vehicles/decodevinvalues/{VIN}?format=json` | Unauthenticated; no API key or callback. Upstream failure returns 502; raw/normalized decode data is persisted by workspace flow. `routes/mechanicWorkspace.ts:82-145,156-187`. |
| OpenStreetMap Nominatim | `https://nominatim.openstreetmap.org/reverse` and `/search` | Unauthenticated public geocoding; no API key or callback. Public-service rate limits/availability are operational dependencies. `artifacts/mobile/app/request-service.tsx:107-195`; detailing has the same pattern. |
| Expo Push Service | `https://exp.host/--/api/v2/push/send` | No API key in server code. Requires native Expo project ID, device permission/token, and production APNs/FCM/EAS setup. Server sends best-effort and does not inspect ticket responses. `artifacts/api-server/src/lib/notifications.ts:10-33`; mobile registration `hooks/usePushNotifications.ts:47-100`. |

### 4.2 Named registered stubs (5)

* **PartsTech** is registered but `searchOffers()` always returns an empty
  list and `placeOrder()` always throws, even if both environment names are
  set (`artifacts/api-server/src/lib/suppliers/external/partsTechStub.ts:30-53`).
* **Facebook Pages, Instagram Graph, TikTok Content Posting, and X v2** check
  catalog-key presence but `publish()` always throws
  (`publishingProviders/stubs.ts:23-53`).
* The generic AI video adapter is registered as `video-stub`, always reports
  unconfigured, and always throws (`mediaProviders/videoStub.ts:15-33`). It is
  deliberately not counted as a named service because it has no provider name.

Keys do not turn a stub into a live service. The APS-curated internal supplier
is a separate live DB adapter using `parts_offers`, with no external
credential (`lib/suppliers/internal/apsCuratedAdapter.ts:21-53`).

### 4.3 Planned-only services (8)

The source names four future video choices—Runway, Pika, Google Veo, and
OpenAI Sora—and three future supplier adapters—Nexpart, WHI Solutions, and
Worldpac SpeedDial—in comments only
(`mediaProviders/videoStub.ts:4-8`; `suppliers/external/partsTechStub.ts:10-20`).
Twilio appears in `.env.example` only and has no adapter. These eight planned
names have no current live consumer. The installed `stripe-replit-sync`
dependency also has no first-party application use and is not counted as an
adapter. The separate three named release services counted in the 24 total are
EAS, App Store Connect, and Google Play; their 12 credential/ID placements are
listed in section 3.5.

## 5. Functional surfaces and external settings

### 5.1 Payments and payouts

* Stripe Checkout, manual capture, Connect onboarding, transfers, payout
  handling, disputes, refunds, and tips are implemented under
  `artifacts/api-server/src/routes/payments.ts`,
  `routes/payouts.ts`, `lib/payoutHoldEngine.ts`, and
  `lib/payoutEventEngine.ts`.
* The provider Connector environment is selected by
  `REPLIT_DEPLOYMENT`, not by a user-facing test/live environment variable.
  Validate development and production connections independently.
* Stripe webhook signature verification is not optional for a payment
  deployment. Supply the existing endpoint’s signing secret and confirm URL,
  enabled events, and account mode outside the app. Startup is read-only.
* Live payouts need actual provider onboarding/verification appropriate to the
  connected person or business. Testing does not universally require an LLC or
  EIN, and this project must never request legal documents from users.

### 5.2 Email and password reset

* Password reset base URL is trusted configuration, not a request header:
  `APP_BASE_URL` → `REPLIT_DOMAINS` → `REPLIT_DEV_DOMAIN`
  (`routes/passwordReset.ts:53-66`).
* Resend connector settings are fetched and cached briefly; missing config
  deliberately returns a failure and does not send. Securely verify an
  already-authorized production sender/domain at Resend; new setup is
  **BLOCKED EXTERNAL SETUP**.
* No SMS/Twilio path exists. Do not add Twilio credentials for Phase 5.
* DNS verification: securely inspect any already-authorized DKIM record(s) and
  SPF/return-path records Resend supplied for the sending domain. Its
  return-path setup can include MX records. Inspect DMARC alignment without
  adding or changing records now; do not invent values or replace an existing
  SPF record blindly. DNS-zone access and verified sender authorization are
  needed, not an LLC, but new DNS/domain setup is **BLOCKED EXTERNAL SETUP**.
* `routes/passwordReset.ts:142` is the only current `sendEmail` caller.
  Registration does not implement email-verification delivery. General
  notifications use the internal/Expo notification path rather than Resend.
  Missing email credentials specifically block password-reset delivery;
  they do not block ordinary login.

### 5.3 AI assistant, content, image, and video

* Anthropic’s client is optional and lazy. API route trees can import assistant
  or content code without the pair; when an AI route is invoked without valid
  settings it returns explicit `503` provider unavailability rather than
  taking down startup.
* OpenAI is lazy and only the live image adapter is wired. The DB BYO
  `openai_api_key` is cataloged but is not read by that adapter.
* Generated images are saved to local filesystem/media DB paths; no S3,
  Cloudinary, or other object-storage credential exists. The media file route
  is unauthenticated and uses UUID-like filenames
  (`artifacts/api-server/src/routes/media.ts:11-12,37-60`); those URLs are
  public-by-URL, not private authorization.
* Video is a deliberate stub. Runway/Pika/Veo/Sora acquisition cannot unblock
  it without a provider implementation.

### 5.4 Social growth and OAuth

The growth engine, social-post DB state, and scheduler are live, but all four
publishers are stubs. Credentials can be status-checked and encrypted via the
admin integrations routes, yet a publish attempt still records a provider
failure. There are no provider callbacks or OAuth routes. This feature is
not a current live-publishing commitment.

### 5.5 Parts and supplier ordering

The APS-curated catalog adapter reads the database and has no external key.
PartsTech is only a scaffold. Its comments call for a verified shop account,
catalog/quote endpoint, order endpoint, and `supportsLiveOrders=true`; none
is implemented. Do not promise live supplier availability because keys exist.

### 5.6 Analytics

`artifacts/api-server/src/lib/growthAnalytics.ts:1-603` is fully wired
internal PostgreSQL aggregation, not an external analytics provider. It
computes acquisition, referrals, regional density, CPA/LTV-style metrics,
engagement, amplification, scheduling, signups, conversion, and retention
from users/jobs/payments/referrals/social posts. It has no analytics SDK,
account, webhook, API key, or environment variable. Documented hard-coded
assumptions include `$75/hour` and 12 minutes per post
(`growthAnalytics.ts:361-362`) plus default posting hours
(`:551-556`); treat these as product assumptions, not provider facts.

### 5.7 Maps, location, and VIN

* There is **no Google Maps, Mapbox, map tile, or maps API key** and no
  `MapView` implementation. Native/browser location is used to get foreground
  coordinates; Nominatim reverse geocodes and searches ZIP codes. Users can
  type an address/ZIP when permission or public geocoding fails
  (`artifacts/mobile/app/request-service.tsx:119-225`).
* The app declares an always/background location string, but source inspection
  found only foreground permission/current-position logic
  (`artifacts/mobile/app/request-service.tsx:130-134`; `app.json:19-25,97-102`).
  Do not describe background tracking as delivered until a background task and
  active-job policy are implemented.
* The VIN UI validates a 17-character VIN and calls the authenticated APS
  route. The server calls NHTSA vPIC without credentials, returns 502 on
  upstream failure, rejects an unrecognized decode, and stores raw plus
  normalized make/model/year/trim/engine/transmission/drivetrain/fuel/body
  values (`routes/mechanicWorkspace.ts:73-187`). VIN decode is advisory and
  repeated workspace creation can call upstream again.
* Camera/photo permissions exist, but the VIN scan/photo buttons remain
  placeholders; a camera permission is not evidence of OCR/barcode
  implementation.

## 6. Runtime and release checklist

| Runtime | Can be exercised without production credentials? | Required conditions and known limits |
| --- | --- | --- |
| Expo Go | **Partly** | Ordinary JS navigation/forms/API calls, VIN UI, foreground location, and Nominatim can be exercised when the API domain is valid. Push is intentionally skipped because SDK 53 removed Expo Go registration; native keyboard-controller behavior and scanner placeholders are not validated. `artifacts/mobile/hooks/usePushNotifications.ts:9-35`; `app/_layout.tsx:36-45`. |
| EAS development build | **Native setup required** | Development profile is internal, Android APK, and iOS simulator. Push requires project ID, device permissions, and native notification setup; an iOS simulator is not a real push-device test. |
| EAS preview build | **Native setup required** | Internal device build is suitable for permissions and push checks, subject to EAS owner/project/signing and provider setup. |
| Production API | **Deployment setup required** | Valid DB/port, production `NODE_ENV`, strong session secret, trusted public/reset domain, and any feature connectors/secrets selected for beta scope. Use API package `start`, not the development script. |
| Production mobile | **Store/EAS setup required** | Under authorized business-account setup, replace the EAS API-domain placeholder; add owner/project ID; match Apple/Google records; configure EAS signing, APNs/FCM, submission IDs/service account, privacy policy/data disclosures, and a real public domain. New external setup is **BLOCKED EXTERNAL SETUP**. |

There is no requirement to obtain every future provider account before a
focused beta. Choose the beta flows first (for example, auth/DB, VIN, and
location), securely verify only already-authorized configuration, and keep all
new account/key acquisition **BLOCKED EXTERNAL SETUP**. Do not treat a stub as
usable merely because a key is present.

## 7. Confirmed Phase 3 metadata and uncertainty boundaries — historical

These are explicitly limited historical observations, not claims about current
credential values:

* **Historical Phase 3 observation:** development secret metadata confirmed `SESSION_SECRET`,
  `AI_INTEGRATIONS_ANTHROPIC_BASE_URL`, and
  `AI_INTEGRATIONS_ANTHROPIC_API_KEY` names as present. Values, secret
  strength, endpoint reachability, and provider response were not inspected.
* **Historical Phase 3 observation:** `ADMIN_SETUP_KEY`, `STRIPE_WEBHOOK_SECRET`, and the two OpenAI proxy names
  were not listed in that confirmed development-secret metadata. This does
  not prove they are absent: runtime-managed DB/domain/platform values may
  not appear in a secret list.
* Stripe is installed as a dependency, and prior read-only Stripe test access
  worked. That is not proof of a currently bound production connector,
  publishable/secret settings, account verification, or webhook readiness.
* Resend Connector search status is `not_setup` (not connected). No API key or
  sender value was accessed.
* The development database was reachable. `SELECT key FROM
  integration_credentials` returned zero rows; no values were accessed. This
  is point-in-time metadata only and is not a guarantee that rows are absent
  now.
* No `.env` file values, credential values, tokens, private keys, service
  account JSON, or connector payload secrets were read for this report.

## 8. Testing — Phase 3 historical results plus Phase 5 verification

The following Phase 3 results are retained without credential values or
provider payloads and remain historical evidence. The Phase 5 verification
listed below is separate and does not rewrite the Phase 3 record:

### Automated checks — PASS

- [x] Full workspace typecheck — **PASS**.
- [x] Mobile regression suite — **PASS**.
- [x] 13 server tests — **PASS**.
- [x] No mocked provider tests were used in the manual flow report here.

### Development Expo web/manual flows — PASS

The resumed development Expo web run completed the following:

- [x] Four-role login, dashboards, and logout — **PASS**.
- [x] Customer reload/session persistence — **PASS**.
- [x] Wrong password returns `401`; suspended account returns `403` — **PASS**.
- [x] Fixture customer vehicle create/read/list — **PASS**.
- [x] Outsider mechanic vehicle access returns `403` — **PASS**.
- [x] Compatible Detailer job create/read/available/accept — **PASS**.
- [x] Customer/mechanic messages create/read — **PASS**.
- [x] Outsider partner access returns `403` — **PASS**.
- [x] All five fixture users, two jobs, one vehicle, three messages, and one
      ownership row were cleaned up — **PASS**; no existing PII or provider
      records were mutated.

Interpretation notes:

- Customer `DELETE /jobs/:jobId` returning `403` is intentional: the route is
  admin-only (`artifacts/api-server/src/routes/jobs.ts:483-485`), not a
  regression.
- An initial wrong service slug was corrected in the test input; the resulting
  tier `403` was expected.
- The first page was blank for approximately 15–20 seconds before rendering;
  only style warnings remained and no blocking runtime error was observed.
- Vehicle edit was not run because no PATCH/PUT vehicle-edit route was found;
  this is an untested surface, not a claimed pass.

### Phase 5 verification — PASS

- [x] Full workspace typecheck — **PASS**.
- [x] Mobile helper regressions — **PASS**.
- [x] All 25 backend/AI tests — **PASS** (`src/lib/*.test.ts` plus
      `password-reset.integration.test.ts` and
      `lib/integrations-anthropic-ai/src/client.test.ts`).
- [x] API restart, build, and start — **PASS**.
- [x] Metro restart — **PASS**.
- [x] Final mobile build — **PASS**:
      `METRO_PORT=18115 pnpm --filter @workspace/mobile run build`; iOS/Android
      JavaScript bundles and manifests emitted with 49 assets.
- [x] Earlier runtime API/DB health and isolated startup without optional
      providers — **PASS**.
- [x] Configuration inventory — **45 executable/config names and 15
      secret-bearing names**.

The original browser/API evidence covered the real-UI customer
login/navigation/persistence/logout flow; customer/mechanic registration,
admin-registration rejection, API mechanic/admin/suspended/wrong-password
authentication, vehicle/job/mechanic-accept, messaging, and outsider checks
also passed. The final narrow browser retest passed mechanic dashboard
Available/Profile/logout, shop-owner Locations/Vehicles/Profile/logout, admin
dashboard/Users/logout with fixture-only DB elevation, and suspended login
`403`. The mechanic DOM-anchor CSS crash and address-geocoder signup block are
fixed with no remaining failure in the exercised flows. Screenshots:
`mechanic23w786`, `address6s6f0r`, `adminmxqysg`, `partner5xn25q`,
`invalids2dfkm`, and `cleanloginp73byr`.

The aborted Nominatim → typed-address fallback → unverified/no-coordinates
notice → registration/customer-home path passed, with `home_lat`/`home_lng`
null. `/forgot-password` rendered but was not submitted, so no recovery-email
pass is claimed. An actual invalid-token
`/api/auth/reset-password?token=...` request returned friendly HTML `410`;
Expo `/reset-password` redirects to login and no recovery route is
implemented. Scoped users and `reset_tokens` were cleaned to zero, with no new
jobs, vehicles, or messages. Latest proxied `/api/healthz` returned `200`
`status: "ok"`, and malformed-login JSON returned `400` `invalid_json`.
Minor warnings for deprecated `shadow*`, `pointerEvents`, and
password-not-form markup remain nonblocking. Admin logout emitted duplicate
confirmation logs but succeeded; this was not a failure.

### Explicitly unrun external/native checks — RELEASE GATES

- [ ] Physical Expo Go/native permission flows for camera, image picker, and
      location denial behavior.
- [ ] Push on a physical native device; Expo Go push remains intentionally
      unsupported. The backend also does not inspect Expo ticket responses
      (`artifacts/api-server/src/lib/notifications.ts:19-33`).
- [ ] Live VIN/NHTSA and Nominatim service behavior, including successful
      upstream responses, upstream failures, and public-service rate limits.
- [ ] Anthropic assistant/content, OpenAI image generation, Resend email, and
      Stripe Connector/payment/webhook flows.
- [ ] Signed/native EAS development/preview/production artifacts, physical
      device behavior, store submissions, APNs/FCM, and the real production
      domain. The local JavaScript bundle/manifests build above is not a native
      signing or device test.
- [ ] Token expiry, offline behavior, and cross-group permission loops.

### Known release-path status — source updated, local build PASS; native release pending

The historical Phase 3 source review identified a fixed-`8081` Metro
fetch/health collision risk. Phase 5 source now accepts optional
`METRO_PORT`, falls back to workflow `PORT` or an available ephemeral port,
and guards occupied ports. The final local mobile JavaScript build passed with
`METRO_PORT=18115`; signed native builds, device tests, and store submission
remain pending. No native/device pass is claimed here.

## 9. Category checklist and beta setup order

The categories below index the exact names, source references and verification
boundaries above. Status is about the **current implementation**, not a
promise that obtaining a provider account will complete an adapter.

| Category | Checklist / current requirement |
| --- | --- |
| Core application | **REQUIRED:** valid API `PORT`, mobile `EXPO_PUBLIC_DOMAIN`, appropriate `NODE_ENV`; framework-managed path settings as detailed above |
| Database | **REQUIRED:** `DATABASE_URL` and existing schema; development connectivity and fixture-backed queries passed; production not queried |
| Authentication | **REQUIRED:** strong `SESSION_SECRET`; **FEATURE SPECIFIC:** `ADMIN_SETUP_KEY` for bootstrap only; no external OAuth login provider required |
| Payments and Stripe | **FEATURE SPECIFIC:** connector secret/publishable settings, platform connector identity, `STRIPE_WEBHOOK_SECRET`, existing endpoint/events and connected-account readiness |
| AI services | **OPTIONAL:** Anthropic proxy pair; missing/invalid settings leave API startup available and AI routes return explicit `503` unavailability. **FEATURE SPECIFIC:** OpenAI proxy pair for images; **NOT CURRENTLY NEEDED:** BYO OpenAI catalog key for the current image adapter and future video-provider keys |
| Email | **FEATURE SPECIFIC:** securely verify existing authorized Resend `settings.api_key`, sender/domain/DNS; password-reset delivery blocked until configured. New setup is **BLOCKED EXTERNAL SETUP** |
| Push notifications | **FEATURE SPECIFIC:** EAS project ID, native notification permissions, APNs/FCM credentials; **NOT CURRENTLY NEEDED for Expo Go:** remote-push credentials because the app skips registration there |
| Maps and geolocation | **FEATURE SPECIFIC:** foreground permission and Nominatim availability; no Google/Mapbox key, map renderer or implemented background tracking |
| VIN and vehicle services | **FEATURE SPECIFIC:** public NHTSA vPIC network access; no key; VIN scanning/OCR remains incomplete. No separate credentialed recalls provider was found |
| Parts suppliers | **NOT CURRENTLY NEEDED:** PartsTech key/shop ID until adapter implementation; internal curated DB catalog needs no external account |
| Media and file storage | **OPTIONAL:** `MEDIA_STORAGE_DIR`; production needs durable accessible storage, not an assumed persistent local directory. Current public generated-media URLs are not private file access |
| Social publishing | **NOT CURRENTLY NEEDED for working beta flows:** catalog tokens/IDs for four stubbed publishers. OAuth callbacks, exchange and refresh are unimplemented |
| Analytics | **REQUIRED:** existing DB for internal analytics; **NOT CURRENTLY NEEDED:** external analytics credentials |
| External integrations | **FEATURE SPECIFIC:** connector hostname and managed identity; encrypted catalog uses existing `SESSION_SECRET`; no integration credential rows were present in the audited development DB |
| Development services | **DEVELOPMENT ONLY:** Expo proxy/packager domain, Replit dev metadata and package-manager metadata; not production secrets |
| Production services | **PRODUCTION ONLY:** correct release API domain and store submission settings; **FEATURE SPECIFIC:** native signing/push credentials; never put server keys in `EXPO_PUBLIC_*` |
| Business setup | **BLOCKED UNTIL BUSINESS ACCOUNT IS AVAILABLE:** live settlement in the intended APS legal entity and its verified payout banking; organization store enrollment if APS will publish as that entity |
| Optional links/operations | **OPTIONAL:** logging, public/reset URL overrides and store links; valid trusted URLs are still necessary when the corresponding email/payment/referral flow is used |

### What can be prepared immediately

- Continue development/Expo Go account, vehicle, job and messaging tests only
  with already-authorized local/runtime configuration; do not create accounts or
  personal-identity credentials.
- Securely verify existing Resend connector/sender/DNS configuration without
  copying values. New Resend account, key, domain, or DNS setup is
  **BLOCKED EXTERNAL SETUP**.
- Read-only verify the existing authorized Stripe **test** webhook
  secret/events and connector settings. No endpoint was created or changed
  here; new test keys/account setup is **BLOCKED EXTERNAL SETUP**.
- Securely verify existing authorized EAS/project configuration if present.
  New EAS project, store, signing, push, or individual developer account work
  is **BLOCKED EXTERNAL SETUP**.
- Securely verify an existing authorized OpenAI proxy pair if image generation
  is already authorized; new proxy/account/key setup is **BLOCKED EXTERNAL
  SETUP**.
- Keep future supplier/social/video account work separate from beta-critical
  setup: their incomplete code is not a missing-secret problem.

### What must wait for the intended APS business setup

Live Stripe settlement must use accurate legal/representative/tax and bank
details accepted by Stripe for the chosen business type. If APS is to operate
as an LLC, finish that entity and its applicable tax/bank setup before
onboarding it as that entity. Organization-owned store enrollment can likewise
require legal-entity verification and applicable organization identifiers.
Requirements vary by country/provider/business type; an LLC/EIN is not
universally required by the code for domains, test mode, EAS or AI access.
That technical fact does not authorize new external setup under a personal
identity: all such acquisition is **BLOCKED EXTERNAL SETUP** until the
business-account owner authorizes it. Submit any eventually required sensitive
documents directly to the provider, never to chat, source files or this
checklist.

### Storage and credential counting boundaries

`mediaEngine.ts:32-45` mentions Replit Object Storage as a future persistence
option; no storage SDK, bucket credential or object-storage environment
consumer is wired. Do not add S3/Cloudinary credentials as a substitute.
The 15 secret-bearing environment names plus the two connector-only secrets
represent **17 logical application secret slots** after treating six DB
catalog secrets as aliases of their corresponding environment fallbacks.
Five additional native-release credential categories (Play service account,
iOS signing, Android signing, APNs and FCM) are documented separately:
**22 secret/credential categories in total**, not 22 values to obtain now.
Certificates, passwords and key files inside a provider-managed signing
category are not counted individually; dormant documentation-only names are
not additional active secrets.

## 10. Exact secret-bearing environment variables: configure now or wait

All **15** values in this table must remain private and server-side. None
belongs in `EXPO_PUBLIC_*`, a committed file, chat, or a report. “Beta” means
the selected beta feature scope: taking real payments in a beta requires
live payment requirements, while a supervised no-money Expo Go test does not.
Private test credentials are safe only in the provider's corresponding test
environment; they are never safe to disclose. Platform identities and session
secrets do not have a Stripe-style test mode.

Source abbreviations below refer to existing files, not proposed components:
`auth` = `artifacts/api-server/src/lib/auth.ts`;
`credentials` = `artifacts/api-server/src/lib/credentialStore.ts`;
`catalog` = `artifacts/api-server/src/lib/integrationCatalog.ts`;
`stripeClient` = `artifacts/api-server/src/lib/stripeClient.ts`;
`email` = `artifacts/api-server/src/lib/email.ts`.
Earlier tables retain line references.

| Exact secret name | Provider / controls / actual consumer | Basic APS | Beta | Production | Obtain now; business/domain prerequisite; test use |
| --- | --- | --- | --- | --- | --- |
| `DATABASE_URL` | PostgreSQL authenticated connection; `lib/db/src/index.ts`, Drizzle config and operational scripts | Required | Required for DB flows | Required | Existing platform DB configuration; no LLC/domain needed. Use development DB credentials only for development; keep production separate |
| `SESSION_SECRET` | APS JWT signing and integration-store encryption; `auth`, `credentials` | Configure now; do not rely on development fallback | Required | Required, at least 32 characters | Generate cryptographically strong private material in a secure secret manager; no provider, billing, domain or LLC. Different environments should have deliberate isolation. Preserve existing value: changing it invalidates JWTs and can make stored credentials unreadable without a migration |
| `AI_INTEGRATIONS_ANTHROPIC_API_KEY` | Replit Anthropic proxy; `lib/integrations-anthropic-ai/src/client.ts`; assistant/content route imports | Optional | Optional; AI routes return explicit `503` when unavailable | Optional; AI routes return explicit `503` when unavailable | Securely verify an existing authorized managed integration only. New account/key setup is **BLOCKED EXTERNAL SETUP**; no personal-identity credential acquisition |
| `ADMIN_SETUP_KEY` | APS admin bootstrap; `routes/auth.ts`, `lib/authorization.ts` | No, if an admin already exists | Only if bootstrap is needed | Only if bootstrap is needed | Generate secure random value; no outside account. Leave absent when bootstrap is not needed. Use a separate dev key; never weaken production bootstrap |
| `STRIPE_WEBHOOK_SECRET` | Stripe signature verification; `lib/stripeInit.ts`, `lib/stripeWebhookSetup.ts`, webhook handler via cached secret | No | Required if Stripe test/live flows are in scope | Required for payment launch | Securely verify the secret from an already-authorized existing test endpoint; test and live endpoint secrets differ. New test key/account setup is **BLOCKED EXTERNAL SETUP**. Endpoint URL and event list must match |
| `REPL_IDENTITY` | Replit platform bearer identity for Stripe/Resend connector lookup; `stripeClient`, `email` | No for non-connector flows | Connector features only | Connector features if this platform identity is supplied | Platform injects it; do not obtain/copy/rotate manually. No personal business prerequisites. Not a provider test key; connector environment determines credential selection |
| `WEB_REPL_RENEWAL` | Alternative deployment bearer identity for the same connector clients | No for non-connector flows | When deployment connector lookup uses this alternative | Same conditional requirement | Platform-managed alternative to `REPL_IDENTITY`, not a second manually supplied key. Private; never fabricate a value |
| `AI_INTEGRATIONS_OPENAI_API_KEY` | Replit OpenAI image proxy; `lib/integrations-openai-ai/src/client.ts`, `lib/mediaProviders/openaiImage.ts` | No | Only if AI images are included | Only if AI images are included | Securely verify an existing authorized managed integration only; new account/key setup is **BLOCKED EXTERNAL SETUP**. No free image-generation test mode is assumed |
| `OPENAI_API_KEY` | BYO alias for `openai_api_key` in `catalog`/`credentials`; current image adapter does not consume it | No | No for current implemented image path | No for current implemented image path | **Do not obtain or pay for this credential for APS now.** The direct API account/key path is deferred and is **BLOCKED EXTERNAL SETUP** |
| `PARTSTECH_API_KEY` | `lib/suppliers/external/partsTechStub.ts` readiness probe with shop ID; no functional external search/order | No | No | No until adapter work is done | Defer supplier account/key setup as **BLOCKED EXTERNAL SETUP**. A key alone cannot enable ordering |
| `FACEBOOK_PAGE_TOKEN` | Catalog alias `facebook_page_token`; Facebook publishing stub | No | No | No until publishing implemented | Defer Meta/Page account and token setup as **BLOCKED EXTERNAL SETUP**; no APS live adapter exists |
| `INSTAGRAM_ACCESS_TOKEN` | Catalog alias `instagram_access_token`; Instagram publishing stub | No | No | No until publishing implemented | Defer linked Business account/token setup as **BLOCKED EXTERNAL SETUP**; no APS live adapter exists |
| `TIKTOK_ACCESS_TOKEN` | Catalog alias `tiktok_access_token`; TikTok posting stub | No | No | No until publishing implemented | Defer developer app/account/token setup as **BLOCKED EXTERNAL SETUP**; no APS live adapter exists |
| `TWITTER_ACCESS_TOKEN` | Catalog alias `twitter_access_token`; X publishing stub | No | No | No until publishing implemented | Defer X developer app/account/token setup as **BLOCKED EXTERNAL SETUP**; no APS live adapter exists |
| `TWITTER_ACCESS_TOKEN_SECRET` | Optional catalog alias `twitter_access_token_secret`; OAuth 1.0a alternative only | No | No | No until an OAuth 1.0a adapter is chosen | Wait. Not needed alongside an OAuth 2-only implementation. No reason to create an extra credential now |

**Non-env secrets still required for their features:** Stripe connector
`settings.secret`, Resend connector `settings.api_key`, and native signing/
push/store credentials in section 3.5. Stripe `settings.publishable` is public,
but still should come from the correctly selected connector environment.
Neither `STRIPE_SECRET_KEY` nor `RESEND_API_KEY` is an implemented environment
input for these adapters. Do not copy connector keys into unused env names.

## 11. All 45 consumed configuration names — exact preparation decisions

Primary classification avoids counting overlapping uses twice. Production
relevance does not mean “set only in production”: core secrets are also
needed on a public beta server. Source references and secret flags are in
sections 2 and 10.

| # | Name | Primary group | Now or wait / exact purpose |
| ---: | --- | --- | --- |
| 1 | `DATABASE_URL` | Required core / secret | Now: preserve managed development connection; separate production configuration later |
| 2 | `PORT` | Required core | Now: platform injects service-specific port; do not hardcode a shared port |
| 3 | `SESSION_SECRET` | Required secret | Now: retain strong configured value; do not rotate casually |
| 4 | `NODE_ENV` | Required core | Development for dev; production for exposed release runtime. Never use API dev script as production start |
| 5 | `AI_INTEGRATIONS_ANTHROPIC_API_KEY` | Optional AI feature / secret | Verify existing authorized pair only when AI is in scope; missing/invalid configuration leaves startup available and AI routes return explicit `503` unavailability |
| 6 | `AI_INTEGRATIONS_ANTHROPIC_BASE_URL` | Optional AI feature / provider endpoint | Same lazy optional behavior as its key; verify existing authorized managed endpoint only |
| 7 | `EXPO_PUBLIC_DOMAIN` | Public mobile | Now: actual HTTPS API host for Expo Go; real deployed API host before beta/native builds |
| 8 | `EXPO_PUBLIC_REPL_ID` | Public mobile / build metadata | Derived by existing dev/build tooling; not an API key or EAS project ID |
| 9 | `REPLIT_DEV_DOMAIN` | Development configuration | Platform-provided API development host; never use as an assumed production URL |
| 10 | `REPLIT_EXPO_DEV_DOMAIN` | Development configuration | Platform-provided Expo origin; not the API origin |
| 11 | `EXPO_PACKAGER_PROXY_URL` | Development configuration | Existing script derives it; no manual credential acquisition |
| 12 | `REACT_NATIVE_PACKAGER_HOSTNAME` | Development configuration | Existing script derives it; no provider account |
| 13 | `REPL_ID` | Development / build metadata | Platform-provided ID used by build fallbacks/Vite plugins |
| 14 | `METRO_PORT` | Development/build override | Optional non-secret Metro override; use only if authorized runtime configuration supplies it, otherwise build falls back to `PORT` or an available ephemeral port |
| 15 | `npm_config_user_agent` | Development tooling | Package manager sets it; do not configure manually |
| 16 | `BASE_PATH` | Framework routing | Now where Vite configs require it; platform-managed artifact path. Mobile build defaults to root |
| 17 | `BASE_URL` | Framework built-in | Vite derives it from base; never create a secret for it |
| 18 | `REPLIT_INTERNAL_APP_DOMAIN` | Production build metadata | Platform deployment/build input when available; no manual fake domain |
| 19 | `REPLIT_DOMAINS` | Deployment / feature URLs | Verify supplied domain(s) before payment, reset and referral flows; app uses first domain |
| 20 | `REPLIT_DEPLOYMENT` | Production connector selection | Platform-managed flag selects connector production settings; do not toggle to simulate test mode |
| 21 | `REPLIT_CONNECTORS_HOSTNAME` | Feature-specific platform | Supplied by platform for Stripe/Resend; not a secret or provider-issued API host to invent |
| 22 | `REPL_IDENTITY` | Feature-specific secret | Platform injects connector identity; never ask user to paste it |
| 23 | `WEB_REPL_RENEWAL` | Feature-specific alternative secret | Platform alternative deployment identity; not both identities manually required |
| 24 | `ADMIN_SETUP_KEY` | Feature-specific secret | Configure only if admin bootstrap required; existing admin login does not need it |
| 25 | `STRIPE_WEBHOOK_SECRET` | Feature-specific secret | Securely verify existing test endpoint secret if payments beta planned; live separately; new setup is **BLOCKED EXTERNAL SETUP** |
| 26 | `AI_INTEGRATIONS_OPENAI_API_KEY` | Feature-specific secret | Verify existing authorized proxy only if image generation is in beta; new setup is **BLOCKED EXTERNAL SETUP** |
| 27 | `AI_INTEGRATIONS_OPENAI_BASE_URL` | Feature-specific provider endpoint | Same decision as its paired proxy key |
| 28 | `MEDIA_STORAGE_DIR` | Optional / feature-specific | Default local path for dev; if generated media is included, verify writable durable storage for hosted use |
| 29 | `LOG_LEVEL` | Optional | Default `info`; change only for operational need, never enable secret logging |
| 30 | `APP_BASE_URL` | Optional trusted URL override | Verify/set through authorized deployment configuration before password-reset email; use actual intended public origin |
| 31 | `PUBLIC_BASE_URL` | Optional link override | Needed only if amplification/share links require override |
| 32 | `APP_STORE_URL` | Optional store link | Wait until an authorized actual iOS listing exists; do not fabricate a listing |
| 33 | `PLAY_STORE_URL` | Optional store link | Wait until an authorized actual Android listing exists |
| 34 | `APS_BASE_URL` | Optional development/demo | Only for manually running the existing demo against a chosen API; not app runtime |
| 35 | `PARTSTECH_API_KEY` | Dormant feature probe / secret | Wait for actual adapter project and supplier approval; new setup is **BLOCKED EXTERNAL SETUP** |
| 36 | `PARTSTECH_SHOP_ID` | Dormant feature probe / public identifier | Same; code is a stub even with both values |
| 37 | `OPENAI_API_KEY` | Dormant BYO alias / secret | Wait; current images use the proxy pair instead; direct account/key setup is **BLOCKED EXTERNAL SETUP** |
| 38 | `FACEBOOK_PAGE_TOKEN` | Dormant publishing alias / secret | Wait for publishing implementation; external setup is **BLOCKED EXTERNAL SETUP** |
| 39 | `FACEBOOK_PAGE_ID` | Dormant publishing alias / public ID | Wait with Facebook implementation; external setup is **BLOCKED EXTERNAL SETUP** |
| 40 | `INSTAGRAM_ACCESS_TOKEN` | Dormant publishing alias / secret | Wait for publishing implementation; external setup is **BLOCKED EXTERNAL SETUP** |
| 41 | `INSTAGRAM_USER_ID` | Dormant publishing alias / public ID | Wait with Instagram implementation; external setup is **BLOCKED EXTERNAL SETUP** |
| 42 | `TIKTOK_ACCESS_TOKEN` | Dormant publishing alias / secret | Wait for publishing implementation; external setup is **BLOCKED EXTERNAL SETUP** |
| 43 | `TIKTOK_OPEN_ID` | Dormant publishing alias / public ID | Wait with TikTok implementation; external setup is **BLOCKED EXTERNAL SETUP** |
| 44 | `TWITTER_ACCESS_TOKEN` | Dormant publishing alias / secret | Wait for publishing implementation/access model; external setup is **BLOCKED EXTERNAL SETUP** |
| 45 | `TWITTER_ACCESS_TOKEN_SECRET` | Dormant optional OAuth alias / secret | Wait; only relevant if future adapter chooses OAuth 1.0a; external setup is **BLOCKED EXTERNAL SETUP** |

### Documentation-only, unused and duplicate configuration

- **Documentation-only / not consumed:** `STRIPE_SECRET_KEY`,
  `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `TWILIO_ACCOUNT_SID`,
  `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`; comment-only
  `STRIPE_API_VERSION`. Do not configure any of them for the current app.
- **Dormant, not proven deprecated:** the nine catalog fallback names and
  PartsTech pair have actual code references. They remain in the 45, but
  their provider features are not functional. No variable is removed here.
- **Aliases to consolidate only in future code work:** nine lower-case DB
  catalog keys vs nine uppercase environment fallbacks; DB wins today.
  `OPENAI_API_KEY` is not a replacement for the proxy key. Choosing one
  authoritative credential path later is useful, but blindly deleting
  aliases now changes functionality.
- **Overlapping URL purposes:** `APP_BASE_URL`, `PUBLIC_BASE_URL`,
  `REPLIT_DOMAINS`, `REPLIT_DEV_DOMAIN`, `EXPO_PUBLIC_DOMAIN`,
  `REPLIT_INTERNAL_APP_DOMAIN` have different consumers/precedence.
  Keep them consistent; do not rename them into one variable without code work.
- **Intentional alternatives, not cleanup targets:** `REPL_IDENTITY` vs
  `WEB_REPL_RENEWAL`; test vs production credentials; `REPL_ID` vs
  build-derived `EXPO_PUBLIC_REPL_ID`; Vite `BASE_URL` vs service `BASE_PATH`.

## 12. Existing-configuration verification and blocked external setup

These links document where an authorized business owner may eventually verify
configuration. Plan limits, regional fees, eligibility and review requirements
can change. No account, personal-identity credential, secret, endpoint,
external domain, or billing setup is to be created or acquired now. New
external account/key/domain acquisition is **BLOCKED EXTERNAL SETUP**. The
action for this phase is secure verification of existing authorized
configuration only.

| Provider / exact destination | Account / cost / billing | Domain/business verification and testing | What goes where |
| --- | --- | --- | --- |
| Existing Replit project: [Secrets](https://docs.replit.com/core-concepts/project-editor/app-setup/secrets), [AI Integrations](https://docs.replit.com/features/integrations/replit-ai-integrations) | Verify the existing authorized workspace only; managed AI usage is metered through Replit credits. A separate Anthropic/OpenAI developer account is not needed for the current proxy path | LLC/domain verification may not be technically required, but no new account/key setup is authorized now | Securely verify existing Anthropic pair and OpenAI pair if already authorized. Platform injects database/connector identities; never manually copy platform bearer tokens |
| Secure password/secret manager, then project Secrets | Internal secret storage, not an external provider account | No domain/LLC; preserve environment separation and never expose values | Securely verify current strong `SESSION_SECRET`; create/rotate internal bootstrap material only through authorized deployment procedures, never display values in this report |
| [Stripe Dashboard](https://dashboard.stripe.com/), [API keys](https://dashboard.stripe.com/apikeys), [Workbench webhooks](https://dashboard.stripe.com/workbench/webhooks), [Connect testing](https://docs.stripe.com/connect/testing) | Read-only verify an existing authorized Stripe account/sandbox and Connector; do not create or acquire test/live credentials now | Test mode may not require APS LLC, but no test-account/key setup is authorized now; HTTPS callback origin still must be verified | Verify existing Connector settings and existing endpoint signing secret for `STRIPE_WEBHOOK_SECRET`. Do not copy keys into unused `STRIPE_SECRET_KEY` or create duplicate endpoints |
| [Resend signup](https://resend.com/signup), [API keys](https://resend.com/api-keys), [Domains](https://resend.com/domains), [Pricing](https://resend.com/pricing) | Reference only; verify an existing authorized account/connector, not a new signup or key | Domain/DNS control may not require LLC, but new account/key/domain/DNS setup is **BLOCKED EXTERNAL SETUP** | Verify existing connector `settings.api_key`/`from_email` and sender state without copying values. No current `RESEND_API_KEY` env consumer |
| Your domain registrar/DNS provider; [Resend domain setup](https://resend.com/docs/add-a-domain) | Verify existing authorized domain/DNS ownership only; no new registration or paid setup | Domain ownership may not require LLC, but no new domain/DNS changes are authorized now | Verify existing DKIM/SPF/return-path/DMARC state; do not add records or copy provider secrets during this phase |
| [Expo account](https://expo.dev/signup), [Expo dashboard](https://expo.dev/), [EAS Build setup](https://docs.expo.dev/build/setup/), [EAS plans](https://docs.expo.dev/billing/plans/) | Reference only; verify an existing authorized EAS project/account, not a new account or login under personal identity | EAS may not require LLC, but new project/account setup is **BLOCKED EXTERNAL SETUP**. Expo Go needs no store account | Verify existing owner/project ID and authorized build profile; public project ID is not `EXPO_PUBLIC_REPL_ID` or a secret |
| [Apple enrollment](https://developer.apple.com/programs/enroll/), [App Store Connect](https://appstoreconnect.apple.com/), [Certificates/keys](https://developer.apple.com/account/resources/) | Reference only; do not enroll or create an Apple account for APS now | Individual enrollment may not require LLC; organization enrollment requires the intended entity. No personal-identity enrollment is authorized | Verify existing authorized records only; signing/APNs material remains provider-managed and outside JS |
| [Google Play Console](https://play.google.com/console/signup), [Enrollment requirements](https://support.google.com/googleplay/android-developer/answer/6112435), [Google Cloud IAM](https://console.cloud.google.com/iam-admin/serviceaccounts) | Reference only; do not register a Play account or create a service account for APS now | Requirements vary; no personal-identity enrollment is authorized | Verify existing authorized app/release configuration only; service-account JSON stays outside source and mobile bundle |
| [Firebase Console](https://console.firebase.google.com/), [Expo FCM setup](https://docs.expo.dev/push-notifications/fcm-credentials/) | Reference only; verify existing authorized project/credential configuration | LLC may not be required technically, but new Firebase/FCM setup is **BLOCKED EXTERNAL SETUP** | Verify existing authorized native push configuration only; APS server uses Expo Push and has no current `FCM_*` env input |
| [OpenAI direct API keys](https://platform.openai.com/api-keys) | Reference only; do not create a direct API account or acquire a BYO key for APS now | Domain/LLC may not be required, but direct account/key setup is **BLOCKED EXTERNAL SETUP** | Current `OPENAI_API_KEY` catalog alias does not power the implemented image adapter |
| [PartsTech](https://partstech.com/) | Reference only; do not open/pay for a supplier account or acquire a key for a readiness probe | Provider approval/legal terms remain unknown and external setup is **BLOCKED EXTERNAL SETUP** | No operational adapter; future key/shop ID remains deferred |
| [Meta developer apps](https://developers.facebook.com/apps/), [TikTok developer portal](https://developers.tiktok.com/), [X developer portal](https://developer.x.com/) | Reference only; do not create developer apps, user accounts, or tokens for APS now | Provider review/access terms remain unknown and external setup is **BLOCKED EXTERNAL SETUP** | Future tokens/IDs remain deferred; no APS OAuth callback/refresh/publish implementation |

### Free/public services needing no copied credential

NHTSA vPIC (`https://vpic.nhtsa.dot.gov/api/`) and public Nominatim
(`https://nominatim.openstreetmap.org/`) use unauthenticated requests in APS.
They need network availability and compliance with provider usage policies,
not a Google Maps/Mapbox/NHTSA key. Public Nominatim is not a purchased SLA;
review attribution, identification, caching and rate limits before scaling.
Internal growth analytics and curated parts need the existing database only.
Local generated-media files need storage durability/access planning, not a
Cloudinary/S3 credential that no adapter consumes.

## 13. Business timing and local/beta/production decisions

### Genuine business-dependent steps

| Step | Wait for what, and why? | Can anything be prepared now? |
| --- | --- | --- |
| Live Stripe activation as APS LLC | Accurate legal entity/tax/representative information and provider-required verification. Do not enroll a nonexistent entity or substitute invented information | Securely verify existing authorized test connector/webhook configuration only; new account/sandbox setup is **BLOCKED EXTERNAL SETUP** |
| Live Connect verification | Each payee's applicable identity/business information and capabilities. APS formation does not automatically verify independent mechanics/shops | Review existing authorized test configuration only; new account/onboarding setup is **BLOCKED EXTERNAL SETUP** |
| Production settlement / bank payouts | Accepted live capabilities and verified payout banking for the intended entity/payee; actual funds require a real eligible destination | Review provider requirements and ownership planning only; no bank details or new account setup in project docs |
| Tax/business identity information | Actual applicable tax identifiers and legal details; requirements vary by country and business type. EIN is not a universal Stripe test requirement | Review provider's requirement checklist only; do not collect or create sensitive identity documents |
| Apple enrollment as APS organization | Legal entity, binding authority, generally D-U-N-S, domain email/public site; organization seller identity must be real | Verify requirements and any existing authorized configuration only; do not create an individual Apple account or personal-identity enrollment for APS |
| Google Play enrollment as APS organization | Applicable organization identity/D-U-N-S and verification; business account must match intended publisher | Verify requirements and any existing authorized configuration only; do not create an individual account or personal-identity enrollment for APS |
| Supplier commercial onboarding, if later implemented | Provider-dependent shop/company approval and purchasing/payment terms, not established by repository | Review existing authorized API eligibility/pricing documentation only; no subscription or credential collection is authorized for beta |

**Not intrinsically business-gated in the code:** production domain ownership,
hosting, TLS, DNS control, Resend verified sender, Expo/EAS project, AI proxy
access, and development database. The technical absence of an LLC/EIN
requirement is not authorization to perform new external setup now. Securely
verify existing authorized configuration only; new account, key, domain, DNS,
EAS, AI, or test-mode setup is **BLOCKED EXTERNAL SETUP** until the
business-account owner authorizes it. Organization enrollment remains
conditional on the intended entity; do not substitute a personal account.

| Stage | Required baseline | Conditional additions / what must not delay it |
| --- | --- | --- |
| Local/Replit development and Expo Go | Existing DB/schema, API port, strong session secret, valid reachable mobile API host; platform supplies runtime metadata. Anthropic pair is optional unless AI is in scope | Admin setup only if needed. No Stripe/email/store/social/parts/video credentials required for supervised no-money flows. Native device tests still necessary |
| Private supervised beta | Same baseline on reachable service, controlled accounts, confirmed auth/role boundaries and device testing; no exposed weak dev fallback | Password reset email strongly recommended; supervised account recovery may be explicitly limited. Native push/store accounts only if included |
| Open beta | Stable secure hosted API/domain/DB and session secret, appropriate production-mode runtime, operational recovery/support; verify actual native/API journeys | Treat password-reset delivery as a release gate if self-service recovery is advertised. Money, push, media and store distribution each trigger their own launch requirements |
| Production launch | Same secure baseline plus production environment separation, real URLs and operational verification | Live payment credentials/verified payouts if taking money; Resend domain if recovery offered; native signing/stores/push when shipping those features; durable media when offered. Excluded social/video/PartsTech/scanner/split features are not credential blockers |

### Current service status summary

- **Stripe — implemented, setup-dependent, not financially acceptance-tested:** current code has Checkout/manual capture/Connect/refund/payout handlers; requires correct connector mode, account readiness and signed webhook verification. Split payouts remain incomplete and are not included in this status.
- **Resend — implemented but unconfigured at historical Phase 3 observation:** connector `not_setup`; password-reset delivery needs connector and domain. No signup email verification implementation is present.
- **Anthropic — historical Phase 3 metadata observation:** names were reported present and generation was not acceptance-tested. Phase 5 client construction is lazy/optional; missing/invalid pair leaves startup available and AI routes return explicit `503` unavailability. No generation test is claimed.
- **OpenAI images — implemented but unconfigured at prior observation:** proxy pair missing; BYO alias cannot substitute. Generated media persistence remains local.
- **Expo/EAS — Expo web/Go tooling implemented; release configuration incomplete at the historical observation:** missing EAS project ID and placeholder release API domain/submission settings. New EAS setup is **BLOCKED EXTERNAL SETUP** pending authorization.
- **Push — partially implemented:** guarded native registration and Expo sending exist; project/native credentials needed, ticket/receipt handling incomplete; entirely skipped by this app in Expo Go.
- **NHTSA VIN decode — implemented, no key required:** public upstream was untested in historical Phase 3; scan/OCR is placeholder, not a credential issue.
- **Nominatim/geolocation — implemented foreground lookup/manual fallback, no key:** no live map/background tracking implementation; native permission and upstream policy validation remain.
- **PartsTech — stub:** credentials only change readiness probe. Curated APS database catalog is implemented independently.
- **Facebook/Instagram/TikTok/X — stubs:** no live publishing/OAuth callback/refresh logic, even if credential status says configured.
- **AI video — stub; Runway/Pika/Veo/Sora planned:** no useful provider key to configure until an adapter is selected and implemented.
- **Media storage — partially production-ready:** local generated files and public retrieval implemented, no cloud adapter; verify durability/privacy before a media beta.
- **Analytics — implemented internally:** no external service credential; metrics' business assumptions are separate from API setup.
- **Nexpart, WHI Solutions, Worldpac SpeedDial, Twilio — planned/reference-only:** no functional current API integration; do not obtain keys for this phase.
- **Example-only direct Stripe/Resend env names — no longer needed as setup instructions for this architecture:** connector-backed code is authoritative. They remain documentation debt, not deleted functionality.

### Uncertainty boundaries

Country, intended individual-vs-organization store enrollment, provider account
ownership, selected beta features, actual domain ownership, supplier entitlements,
production settings and live verification state have not been established.
Phase 3 credential-presence observations are dated evidence, not fresh key
validation in Phase 5. Provider pricing/review policy can change. No physical
device, payment, email, generation, or mobile build tests were rerun for this
documentation phase; no value, account or external endpoint was changed.