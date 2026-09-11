# Phase 3 API, secret, and integration requirements

**Status:** final current-phase inventory and internal-test snapshot; values were
not inspected or copied. External/provider checks that are explicitly marked
unrun remain release gates.  
**Audience:** the person preparing a Phase 3 beta/release, plus the owner of the
deployment, database, payment, email, and mobile accounts.

This document records what the repository actually reads, what it only
documents, and what is still a stub. A key being present in a deployment is
not evidence that it is valid, that the provider account is enabled, or that a
feature is implemented. Do not paste secrets into this document, source
control, tickets, screenshots, or chat.

## How to read the counts

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
| Unique executable/config environment names | **44** | First-party consumer/setter paths listed above, including Vite `BASE_URL` and lowercase `npm_config_user_agent` |
| Secret-bearing names within those 44 | **15** | Type-based classification; not a claim that any value exists |
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

The **51 tracked environment-name mentions** are 44 executable/config names,
6 `.env.example`-only names, and the one comment-only `STRIPE_API_VERSION`.
The 13 current non-environment slots intentionally do **not** add the nine
environment aliases again. The release/mobile count is a placement checklist,
not a claim that a signing credential or provider account exists.

### Exact 44-name executable/config list

This is the audit baseline, including the Vite built-in and the lowercase
package-manager name:

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
`STRIPE_WEBHOOK_SECRET`, `TIKTOK_ACCESS_TOKEN`, `TIKTOK_OPEN_ID`,
`TWITTER_ACCESS_TOKEN`, `TWITTER_ACCESS_TOKEN_SECRET`, `WEB_REPL_RENEWAL`.

The exact 15 secret-bearing names within those 44 are
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
secret/publishable names in the example/commentary do not change the 51
tracked-name count.

## Master Phase 3 checklist by requested status

The detailed tables below provide source lines and acquisition instructions.
This compact matrix makes the status of every exact executable/config name
explicit. “Server-only” means Expo Go does not receive the value; Expo Go
still needs the server endpoint to be configured when exercising API flows.

| Status | Exact names | Expo Go / development dependence | Production dependence; secret and acquisition |
| --- | --- | --- | --- |
| **REQUIRED** | `DATABASE_URL`, `PORT`, `SESSION_SECRET`, `NODE_ENV`, `BASE_PATH` | `DATABASE_URL`/`PORT` are required by the API if Expo Go calls it; `BASE_PATH` is required by Vite artifacts, not the Expo client. Development may omit `SESSION_SECRET` only because an unsafe fallback exists. | API production requires DB, positive port, `NODE_ENV=production`, and strong `SESSION_SECRET`; `BASE_PATH` is required for Vite hosting. `DATABASE_URL` and `SESSION_SECRET` are secrets; obtain from deployment DB/secret manager. |
| **FEATURE SPECIFIC** | `AI_INTEGRATIONS_ANTHROPIC_API_KEY`, `AI_INTEGRATIONS_ANTHROPIC_BASE_URL`, `AI_INTEGRATIONS_OPENAI_API_KEY`, `AI_INTEGRATIONS_OPENAI_BASE_URL`, `ADMIN_SETUP_KEY`, `MEDIA_STORAGE_DIR`, `APS_BASE_URL` | Not read by Expo Go. Assistant/content, image generation, admin bootstrap, media persistence, and demo-script checks are server/ops features. | Anthropic pair is import-time required by the API route tree; OpenAI pair is required only for image calls. API key and admin key are secrets; connector/proxy acquisition is described below. Media path and demo URL are not secrets. |
| **FEATURE SPECIFIC** | `REPLIT_CONNECTORS_HOSTNAME`, `REPL_IDENTITY`, `WEB_REPL_RENEWAL`, `REPLIT_DEPLOYMENT`, `STRIPE_WEBHOOK_SECRET`, `PARTSTECH_API_KEY`, `PARTSTECH_SHOP_ID`, `OPENAI_API_KEY`, `FACEBOOK_PAGE_TOKEN`, `FACEBOOK_PAGE_ID`, `INSTAGRAM_ACCESS_TOKEN`, `INSTAGRAM_USER_ID`, `TIKTOK_ACCESS_TOKEN`, `TIKTOK_OPEN_ID`, `TWITTER_ACCESS_TOKEN`, `TWITTER_ACCESS_TOKEN_SECRET` | Not in the Expo bundle. Connector names are platform-managed; payment, email, supplier, and social settings are server-side. Dynamic aliases do not make the social/supplier stubs live. | Connector identity/hostname and Stripe webhook settings are needed only when those features are invoked. Secret subset: identity tokens, webhook secret, PartsTech key, and six catalog secret aliases. Acquire platform credentials/connectors or provider account values; details below. |
| **OPTIONAL** | `LOG_LEVEL`, `REPLIT_DOMAINS`, `REPLIT_DEV_DOMAIN`, `APP_BASE_URL`, `PUBLIC_BASE_URL`, `APP_STORE_URL`, `PLAY_STORE_URL` | Expo Go can use a valid API domain without reading these; development domains may supply URL fallbacks. | Recommended production URL settings prevent malformed reset/referral/payment links. All are non-secret metadata/URLs. Replit supplies platform domains; owner supplies trusted public/reset and store-link overrides. |
| **DEVELOPMENT ONLY** | `EXPO_PACKAGER_PROXY_URL`, `REACT_NATIVE_PACKAGER_HOSTNAME`, `REPLIT_EXPO_DEV_DOMAIN`, `REPL_ID`, `EXPO_PUBLIC_REPL_ID`, `npm_config_user_agent` | Expo/Vite dev tooling, Metro, Replit plugin gating, package-manager enforcement and build fallback. Public IDs/hostnames only; never put API secrets in them. | Not required by the production API. `ARTIFACT_DIR` and `SRC_DIR` in the demo validation shell script are unconditionally assigned local shell variables, not consumed environment inputs; neither is counted. |
| **PRODUCTION ONLY** | `REPLIT_INTERNAL_APP_DOMAIN`, `EXPO_PUBLIC_DOMAIN`, `REPLIT_DEPLOYMENT` | Expo Go/dev can use a supplied development/tunnel domain; `REPLIT_DEPLOYMENT` defaults to non-production behavior when not set. | Production mobile build must choose the real internal/public domain and inject `EXPO_PUBLIC_DOMAIN`; `REPLIT_DEPLOYMENT=1` selects production Connector credentials. These are non-secret routing/selector values. |
| **NOT CURRENTLY NEEDED** | `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `STRIPE_SECRET_KEY`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`, `STRIPE_API_VERSION` | No Expo Go consumer. | No current first-party consumer: Resend uses Connector settings, Stripe uses Connector settings, Twilio is unwired, and API-version text is a comment. Do not create these for Phase 3. |
| **BLOCKED UNTIL BUSINESS ACCOUNT IS AVAILABLE** | Live Stripe activation/payout bank account under the intended APS business entity; organization-owned store enrollment where that legal entity is intended | Not required for ordinary Expo Go tests or Stripe test-mode preparation. | Actual applicable entity/representative/tax/bank verification must occur in the provider portal. Resend, EAS, AI access and Stripe test credentials do **not** inherently require an LLC/EIN first. |

## 1. Preliminary Phase 3 readiness table

This is a planning status, not a credential inventory. “Metadata only” means
the deployment secret-name metadata supplied for this audit, not a read of
values or a successful provider call.

| Area | Preliminary status | What must be confirmed before the relevant beta flow |
| --- | --- | --- |
| API process and DB | **BLOCKED until deployment validation** | `DATABASE_URL` and a valid positive `PORT`; DB migrations/schema availability; do not infer either from a grep or a secret-name list |
| Production auth and encrypted integration store | **BLOCKED UNTIL DEPLOYMENT VALIDATION** | `NODE_ENV=production`, a random `SESSION_SECRET` of at least 32 characters, and a DB connection; the credential store also requires at least 16 characters |
| Development auth metadata | **READY signal only** | `SESSION_SECRET` metadata was reported present in development; length, value, and runtime behavior were not inspected |
| Anthropic assistant/content | **READY signal only** | Both Anthropic proxy names were reported present in development; the client is import-time fail-fast, so validate the actual deployment and provider response |
| OpenAI image generation | **BLOCKED UNTIL FEATURE CREDENTIAL IS AVAILABLE** | The lazy proxy requires both OpenAI proxy names; those names were not listed in the confirmed development metadata. Test `gpt-image-1` after the integration is connected |
| Stripe payments | **BLOCKED UNTIL BUSINESS ACCOUNT IS AVAILABLE** | Connector access, selected test/live environment, publishable and secret connector settings, Connect onboarding, and the existing webhook endpoint/signing secret |
| Stripe webhook verification | **BLOCKED until secret/setup validation** | `STRIPE_WEBHOOK_SECRET` was not listed in the confirmed metadata; startup never creates or repairs an endpoint |
| Transactional email | **BLOCKED UNTIL BUSINESS ACCOUNT IS AVAILABLE** | Resend Connector search status is `not_setup` (not connected); missing config returns an email failure |
| Social publishing | **BLOCKED by implementation** | The four registered providers are stubs and throw even when all keys are present; OAuth/callback implementation is absent |
| Parts search/orders | **BLOCKED by implementation** | APS-curated DB offers are live; PartsTech keys only change a configured probe and cannot produce offers or place an order |
| AI video | **BLOCKED by implementation** | The only registered video adapter always reports unconfigured and throws |
| Push notifications | **BLOCKED for native release until EAS setup** | `projectId` and owner are absent from the checked mobile config; native permissions and APNs/FCM/EAS setup are also required. Expo Go intentionally skips push |
| Mobile API routing | **BLOCKED for production release until domain replacement** | The EAS base API domain is a documented placeholder; replace it with the deployed API domain before a production build |
| VIN decode | **READY without a provider key** | Requires network/upstream NHTSA availability and valid VIN input; it is not a credential-free guarantee of service uptime |
| Location/address lookup | **READY CODE PATH; EXTERNAL CHECK UNRUN** | Foreground native/browser location plus public Nominatim work when available; respect public-service availability/rate limits and retain typed fallback |
| Growth analytics | **READY as an internal DB feature** | Development database was reachable; no external analytics account or key exists |

## 2. Complete environment inventory

### 2.1 Core server, database, platform, and feature settings

| Name | Secret? | Requiredness and behavior | Acquisition/owner and source |
| --- | --- | --- | --- |
| `DATABASE_URL` | **Yes** (DB credential) | **Startup-required** by the DB package; Drizzle CLI and seed/migration/demo scripts also require it. | Provision the deployment database and use its deployment-managed connection string. `lib/db/src/index.ts:7-14`; `lib/db/drizzle.config.ts:4-12`; `scripts/src/seed_parts_catalog.mjs:12`; `scripts/src/migrate_parts_system.mjs:8`; `scripts/src/ghostGarageDemo.ts:4,67`; `README.md:133`. |
| `PORT` | No | **Startup-required for API**; must parse as a positive number and has no API default. The demo-video and mockup Vite configs also require it. The static mobile server defaults only its own listener to a local port. | Deployment/runtime assigns it. API: `artifacts/api-server/src/index.ts:4-18`; Vite: `artifacts/demo-video/vite.config.ts:7-18`, `artifacts/mockup-sandbox/vite.config.ts:8-19`; mobile static server: `artifacts/mobile/server/serve.js:132-134`. |
| `NODE_ENV` | No | Controls production enforcement of `SESSION_SECRET` and logger formatting. The API `dev` script forcibly sets development; production `start` must be launched with the intended value. | Deployment configuration, not a secret. `artifacts/api-server/src/lib/auth.ts:4-14`; `artifacts/api-server/src/lib/logger.ts:3-19`; `artifacts/api-server/package.json:6-10`; Vite plugin gating: both Vite configs at lines 35-47/37-47. |
| `SESSION_SECRET` | **Yes** | **Production-required**, at least 32 characters for JWT auth. Development silently uses a fixed unsafe fallback when absent. The AES-GCM integration store requires it at use time and accepts at least 16 characters; rotation invalidates encrypted DB credentials. | Generate a random deployment secret. Never use the development fallback. `artifacts/api-server/src/lib/auth.ts:4-14`; `artifacts/api-server/src/lib/credentialStore.ts:48-58`. |
| `ADMIN_SETUP_KEY` | **Yes** | Feature-only, not startup-required. Admin bootstrap refuses to operate when it is missing or blank. | Generate a one-time/admin-only deployment secret if bootstrap is needed, then use the admin route policy. `artifacts/api-server/src/lib/authorization.ts:9`; `artifacts/api-server/src/routes/auth.ts:153`. |
| `LOG_LEVEL` | No | Optional; defaults to `info`. | Set only when a different Pino level is required. `artifacts/api-server/src/lib/logger.ts:5-6`. |
| `REPLIT_DOMAINS` | No | Platform domain metadata. Used for payment return URLs, password-reset/referral/amplification links, Stripe webhook inspection, and tips/payout URLs. Missing metadata can create malformed or localhost URLs. | Replit deployment metadata; do not manufacture a secret. `artifacts/api-server/src/lib/stripeInit.ts:8-10`; `routes/payments.ts:217,352`; `routes/payouts.ts:291`; `routes/passwordReset.ts:53-66`; `routes/referrals.ts:24`; `lib/mechanicAmplification.ts:45-50`; `lib/tipEngine.ts:77`. |
| `REPLIT_DEV_DOMAIN` | No | Development/preview domain fallback for reset/referral URLs and mobile build domain precedence. | Replit development metadata. `artifacts/api-server/src/routes/passwordReset.ts:61-66`; `routes/referrals.ts:24`; `artifacts/mobile/scripts/build.js:57-73`. |
| `APP_BASE_URL` | No | Optional explicit trusted password-reset base URL; source precedence is `APP_BASE_URL`, then first `REPLIT_DOMAINS`, then `REPLIT_DEV_DOMAIN`, then localhost. | Set to the public HTTPS API/app origin for a deployed reset flow. `artifacts/api-server/src/routes/passwordReset.ts:53-66`. The test assignment in `tests/password-reset.integration.test.ts:85` is fixture-only and is not counted separately. |
| `PUBLIC_BASE_URL` | No | Optional amplification-link fallback. The implementation checks `REPLIT_DOMAINS` first, then this value, then localhost; it is not the password-reset setting. | Set to a trusted public origin if Replit domain metadata is unavailable. `artifacts/api-server/src/lib/mechanicAmplification.ts:45-50`. |
| `APP_STORE_URL` | No | Optional public marketing-link override; falls back to a built-in store link. | Set after store records exist; not a credential. `artifacts/api-server/src/lib/mechanicAmplification.ts:42-60`. |
| `PLAY_STORE_URL` | No | Optional public marketing-link override; falls back to a built-in store link. | Set after the Play record exists; not a credential. `artifacts/api-server/src/lib/mechanicAmplification.ts:42-60`. |
| `MEDIA_STORAGE_DIR` | No | Optional local filesystem directory for generated media; defaults under the process working directory. No cloud object-storage adapter is wired. | Choose a persistent writable deployment volume if media must survive restarts. `artifacts/api-server/src/lib/mediaEngine.ts:43-45`; media route/persistence: `lib/mediaEngine.ts:132-203`. |
| `REPLIT_CONNECTORS_HOSTNAME` | No (host metadata) | Required when Stripe or Resend connector lookup is invoked. Not a user API key. | Replit Connector platform binding. `artifacts/api-server/src/lib/stripeClient.ts:12-21`; `lib/email.ts:30-49`. |
| `REPL_IDENTITY` | **Yes** (platform bearer token) | One of the two connector auth inputs; preferred when present and prefixed internally for the Connector API. | Platform-managed; do not create a fake value. `artifacts/api-server/src/lib/stripeClient.ts:13-18`; `lib/email.ts:34-39`. |
| `WEB_REPL_RENEWAL` | **Yes** (platform bearer token) | Fallback connector auth input when `REPL_IDENTITY` is unavailable; prefixed internally. | Platform-managed deployment credential. `artifacts/api-server/src/lib/stripeClient.ts:14-18`; `lib/email.ts:35-39`. |
| `REPLIT_DEPLOYMENT` | No | Connector target selector: exactly `1` selects production, otherwise development. This is not a Stripe test/live switch exposed to users. | Replit deployment metadata. `artifacts/api-server/src/lib/stripeClient.ts:23-29`. |
| `STRIPE_WEBHOOK_SECRET` | **Yes** | Feature-required for signature verification; missing/invalid leaves webhooks not ready but does not stop API startup. | Obtain the signing secret from the already-created matching Stripe endpoint and store only in deployment secrets. `artifacts/api-server/src/lib/stripeInit.ts:6-28`; validation/cache: `lib/stripeWebhookSetup.ts:32-50`, `lib/stripeClient.ts:58-61`. |
| `PARTSTECH_API_KEY` | **Yes** | Only participates in the PartsTech stub’s configured check. It does not make search or ordering live. | A verified PartsTech shop account would provide it, but the adapter still needs implementation. `artifacts/api-server/src/lib/suppliers/external/partsTechStub.ts:1-20,30-53`. |
| `PARTSTECH_SHOP_ID` | No (account/shop ID) | Paired with the PartsTech key for the configured probe; no live behavior follows. | Verified supplier shop account, if/when the adapter is implemented. Same source as above. |

### 2.2 AI integration environment names

| Name | Secret? | Requiredness and behavior | Acquisition/source |
| --- | --- | --- | --- |
| `AI_INTEGRATIONS_ANTHROPIC_API_KEY` | **Yes** | **Required by the Anthropic client at import time.** Missing value throws before any caller can handle it. Used by assistant and content-generation paths imported by the API route tree. | Provision/connect the Replit Anthropic AI integration for each deployment environment. `lib/integrations-anthropic-ai/src/client.ts:1-17`; assistant import: `artifacts/api-server/src/routes/assistant.ts:1-13`; route registration: `routes/index.ts:17,59`. |
| `AI_INTEGRATIONS_ANTHROPIC_BASE_URL` | No (endpoint) | **Required by the same import-time client.** It is the proxy base URL, not a provider bearer secret. | Supplied by the Replit Anthropic integration; do not substitute an unapproved endpoint. Same client source. |
| `AI_INTEGRATIONS_OPENAI_API_KEY` | **Yes** | Both OpenAI proxy names are required lazily for image generation. The API can boot without them, but image calls return provider-not-configured. | Connect the Replit OpenAI AI integration. `lib/integrations-openai-ai/src/client.ts:21-40`; live image adapter: `artifacts/api-server/src/lib/mediaProviders/openaiImage.ts:34-89`. |
| `AI_INTEGRATIONS_OPENAI_BASE_URL` | No (endpoint) | Paired with the proxy key; lazy feature requirement for `gpt-image-1`. | Supplied by the Replit OpenAI integration. Same client and image-adapter sources. |

### 2.3 Dynamic catalog environment fallbacks: all 9 names

`credentialStore` checks the encrypted DB row first and consults an
`envFallback` only when no DB row exists (`artifacts/api-server/src/lib/credentialStore.ts:108-145`).
The status endpoint never returns plaintext (`:178-235`). A DB row therefore
does not get replaced by a newly-added environment alias until that row is
deleted. These aliases are not evidence that the social adapters work.

| Canonical DB key | Environment fallback | Secret? | Catalog required? | Acquisition/consumer |
| --- | --- | --- | --- | --- |
| `openai_api_key` | `OPENAI_API_KEY` | **Yes** | Yes for the OpenAI BYO group | Admin encrypted store or deployment fallback; the current image adapter uses the Replit proxy, not this BYO key. `integrationCatalog.ts:99-108`; `openaiImage.ts:13-51`. |
| `facebook_page_token` | `FACEBOOK_PAGE_TOKEN` | **Yes** | Yes | Obtain a long-lived Page token with the needed Page/Graph permissions. No live Facebook adapter is registered. `integrationCatalog.ts:110-119`; `publishingProviders/stubs.ts:23-45`. |
| `facebook_page_id` | `FACEBOOK_PAGE_ID` | No | Yes | Numeric target Page ID; not sensitive by itself. Social provider is still a stub. `integrationCatalog.ts:120-128`; same stub source. |
| `instagram_access_token` | `INSTAGRAM_ACCESS_TOKEN` | **Yes** | Yes | Page token for the linked Instagram Business account; no live adapter. `integrationCatalog.ts:130-139`; same stub source. |
| `instagram_user_id` | `INSTAGRAM_USER_ID` | No | Yes | Numeric Instagram Business user ID; no live adapter. `integrationCatalog.ts:140-148`. |
| `tiktok_access_token` | `TIKTOK_ACCESS_TOKEN` | **Yes** | Yes | OAuth token with `video.publish`; no OAuth exchange or live adapter. `integrationCatalog.ts:150-159`. |
| `tiktok_open_id` | `TIKTOK_OPEN_ID` | No | Yes | Provider-issued open ID; no callback implementation. `integrationCatalog.ts:160-168`. |
| `twitter_access_token` | `TWITTER_ACCESS_TOKEN` | **Yes** | Yes | OAuth 2.0 user token with `tweet.write`; no live X adapter. `integrationCatalog.ts:170-179`. |
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
the 44-name audit count even though it is not a separately provisioned
deployment variable.

The mobile dev package script sets `EXPO_PUBLIC_DOMAIN`,
`EXPO_PUBLIC_REPL_ID`, `EXPO_PACKAGER_PROXY_URL`, and
`REACT_NATIVE_PACKAGER_HOSTNAME` before starting Expo and passes `PORT`
(`artifacts/mobile/package.json:7`). The mobile build intentionally passes
through the rest of `process.env` (`scripts/build.js:139-143`) but has no
additional named consumer to document.

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
| Connector `settings.secret` | **Yes** | Required for Stripe API calls, payments, Connect onboarding, and webhook inspection | Bind/configure Stripe in the Replit Connector for the selected development or production environment. Stripe documentation: [Connect testing](https://docs.stripe.com/connect/testing). |
| Connector `settings.publishable` | No (publishable credential) | Required wherever the server returns a publishable key for client checkout/onboarding flows | Same Stripe Connector binding; never replace it with a secret key in mobile code. |
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
Expo/mobile origin (`lib/stripeWebhookSetup.ts:46-52`). The existing endpoint
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
| iOS bundle ID | No | Existing app identifier; create/match the App Store Connect app record. |
| Android package | No | Existing app identifier; create/match the Play Console app. |
| Expo owner/account | No (account ID) | `eas login`, then `eas init`; copy the owner into `app.json`. |
| EAS project ID | No (project ID) | `eas init`, then add `expo.extra.eas.projectId`; native push token registration cannot infer a project without it. `STORE_RELEASE.md:22-30`; `hooks/usePushNotifications.ts:63-80`. |
| Apple ID, App Store Connect app ID, Apple Team ID | No (submission/account IDs) | Fill `eas.json` production submit settings after the Apple Developer/App Store Connect app exists. |
| Google Play service-account JSON | **Yes** (credential material) | Create a least-privilege Play service account, grant the required release role, store the JSON outside git at the configured path, and never place it in the app bundle. `STORE_RELEASE.md:14-20,40-43`. |
| iOS EAS signing credentials | **Yes** (provider-managed signing material) | Acquire/manage interactively with `eas credentials` and an Apple Developer membership. `STORE_RELEASE.md:65-79`. |
| Android EAS signing credentials | **Yes** (provider-managed signing material) | Manage through EAS/Android release setup; keep keystore material in the provider-managed credential store. |
| APNs push credentials | **Yes** (provider-managed push credential) | Required for iOS native push in production; configure through EAS/Apple setup rather than adding an APNs key to the JS bundle. |
| FCM/Android push credentials | **Yes** (provider-managed push credential) | Required for Android native push in production; configure through EAS/Google setup. The server uses Expo Push and has no FCM env key. |

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
| Anthropic | `@anthropic-ai/sdk` through the configured proxy base URL | Two proxy names are import-time required; assistant/content callers use it. No callback. `lib/integrations-anthropic-ai/src/client.ts:1-17`. |
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
  deliberately returns a failure and does not send. Verify a production
  sender/domain at Resend.
* No SMS/Twilio path exists. Do not add Twilio credentials for Phase 3.
* DNS setup: add the exact DKIM record(s) and SPF/return-path records Resend
  supplies for the sending domain. Its return-path setup can include MX
  records. Add a DMARC policy after aligning SPF/DKIM; do not invent record
  values or replace an existing domain SPF record blindly. DNS-zone access
  and verified sender authorization are needed, not an LLC.
* `routes/passwordReset.ts:142` is the only current `sendEmail` caller.
  Registration does not implement email-verification delivery. General
  notifications use the internal/Expo notification path rather than Resend.
  Missing email credentials specifically block password-reset delivery;
  they do not block ordinary login.

### 5.3 AI assistant, content, image, and video

* Anthropic’s import-time client means any API route tree importing assistant
  or content code needs both proxy names, even if a user does not open the
  assistant screen.
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
not a Phase 3 live-publishing commitment.

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
| Production mobile | **Store/EAS setup required** | Replace the EAS API-domain placeholder; add owner/project ID; create matching Apple/Google records; configure EAS signing, APNs/FCM, submission IDs/service account, privacy policy/data disclosures, and a real public domain. |

There is no requirement to obtain every future provider account before a
focused beta. Choose the beta flows first (for example, auth/DB, VIN,
location, and Stripe only if payments are in scope), but do not treat a stub
as usable merely because a key was acquired.

## 7. Confirmed metadata and uncertainty boundaries

These are explicitly limited observations, not claims about credential
values:

* Development secret metadata confirmed `SESSION_SECRET`,
  `AI_INTEGRATIONS_ANTHROPIC_BASE_URL`, and
  `AI_INTEGRATIONS_ANTHROPIC_API_KEY` names as present. Values, secret
  strength, endpoint reachability, and provider response were not inspected.
* `ADMIN_SETUP_KEY`, `STRIPE_WEBHOOK_SECRET`, and the two OpenAI proxy names
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

## 8. Testing — current internal phase results

The following results are complete and are reported without credential values
or provider payloads:

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

### Explicitly unrun external/native checks — RELEASE GATES

- [ ] Physical Expo Go/native permission flows for camera, image picker, and
      location denial behavior.
- [ ] Push on a physical native device; Expo Go push remains intentionally
      unsupported. The backend also does not inspect Expo ticket responses
      (`artifacts/api-server/src/lib/notifications.ts:19-33`).
- [ ] Live VIN/NHTSA and Nominatim network behavior, including upstream
      failures and public-service rate limits.
- [ ] Anthropic assistant/content, OpenAI image generation, Resend email, and
      Stripe Connector/payment/webhook flows.
- [ ] Production API and native EAS development/preview/production builds,
      signing, store submissions, APNs/FCM, and real production domain.
- [ ] Token expiry, offline behavior, and cross-group permission loops.

### Known untested release-path risk

`artifacts/mobile/scripts/build.js` hardcodes its local Metro fetch/health
port to `8081`, while managed mobile startup uses a dynamic port and the
mockup artifact currently occupies `8081`. This production build-path
collision remains untested and is documented here without changing app code.
No new blocking bug was found in the completed internal checks.

## 9. Category checklist and beta setup order

The categories below index the exact names, source references and acquisition
steps above. Status is about the **current implementation**, not a promise
that buying a provider account will complete an adapter.

| Category | Checklist / current requirement |
| --- | --- |
| Core application | **REQUIRED:** valid API `PORT`, mobile `EXPO_PUBLIC_DOMAIN`, appropriate `NODE_ENV`; framework-managed path settings as detailed above |
| Database | **REQUIRED:** `DATABASE_URL` and existing schema; development connectivity and fixture-backed queries passed; production not queried |
| Authentication | **REQUIRED:** strong `SESSION_SECRET`; **FEATURE SPECIFIC:** `ADMIN_SETUP_KEY` for bootstrap only; no external OAuth login provider required |
| Payments and Stripe | **FEATURE SPECIFIC:** connector secret/publishable settings, platform connector identity, `STRIPE_WEBHOOK_SECRET`, existing endpoint/events and connected-account readiness |
| AI services | **REQUIRED for present API startup:** Anthropic proxy pair; **FEATURE SPECIFIC:** OpenAI proxy pair for images; **NOT CURRENTLY NEEDED:** BYO OpenAI catalog key for the current image adapter and future video-provider keys |
| Email | **FEATURE SPECIFIC:** connect Resend, `settings.api_key`, verified sender/domain/DNS; password-reset delivery blocked until configured |
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

- Continue basic development/Expo Go account, vehicle, job and messaging tests.
- Connect Resend and verify a domain you control; no LLC/EIN prerequisite is implied.
- Configure the existing Stripe **test** webhook secret/events and prepare
  test Connect onboarding. No Stripe endpoint was created or changed here.
- Create/link the EAS project, plan native builds and obtain the relevant
  individual developer accounts if that is the intended publishing route.
- Provision OpenAI proxy access if image generation is included in beta.
- Keep future supplier/social/video account work separate from beta-critical
  setup: their incomplete code is not a missing-secret problem.

### What must wait for the intended APS business setup

Live Stripe settlement must use accurate legal/representative/tax and bank
details accepted by Stripe for the chosen business type. If APS is to operate
as an LLC, finish that entity and its applicable tax/bank setup before
onboarding it as that entity. Organization-owned store enrollment can likewise
require legal-entity verification and applicable organization identifiers.
Requirements vary by country/provider/business type; an LLC/EIN is not
universally required for test mode, individual developer enrollment, Resend,
EAS or AI access. Submit any required sensitive documents directly to the
provider, never to chat, source files or this checklist.

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