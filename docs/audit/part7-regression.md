# Part 7 application regression, typecheck, and build audit

**Checked:** 2026-09-13 01:52 UTC  
**Scope:** available repository regression tests, package typechecks/builds, Part
1–6 partner suites, Part 7 bay/mobile/security changes, and safe coverage
inventory. This audit did not launch the browser tester, restart a workflow,
apply a migration, mutate production data, submit a payment, or call a live
payment provider.

## Executive result

The safe API and database suites passed. The duplicate Ghost Garage local was
renamed without removing either assertion, and the service-request contract
now asserts the intended scoped-context-safe `router.dismissTo(...)` behavior
instead of the old `router.replace(...)` literal. The Part 7 mobile security
script now creates a unique, self-cleaning standalone manifest root through
the server's injected `staticRoot` helper; it does not depend on a completed
Metro build or ignored static-build artifacts.

The mobile static build remains a separate unresolved harness result: it
reaches Metro readiness and 99.9% of the iOS bundle transform, then does not
return within the 300-second command timeout. It leaves no platform manifests.
The build was not repeated after the focused test-harness fixes.

No live/external payment operation was attempted. Stripe coverage below is
limited to fail-closed unit tests and fake-provider authorization gates.

## Dependency/install state

The dependency helper changed `pnpm-lock.yaml`, workspace overrides, the
Orval version in `lib/api-spec/package.json`, and the mobile test script. I
did not start a second install while that helper was active. The helper's
`pnpm install --frozen-lockfile` process completed before the post-install
tests.

The actual install was checked with:

```sh
pnpm --filter @workspace/mobile list --depth=0 --json
pnpm --filter @workspace/api-server list --depth=0 --json
stat -c '%y %n' pnpm-lock.yaml node_modules/.pnpm/lock.yaml artifacts/mobile/node_modules
node -e 'const fs=require("fs"); const l=fs.readFileSync("pnpm-lock.yaml","utf8"); const n=fs.readFileSync("node_modules/.pnpm/lock.yaml","utf8"); console.log("lockfile bytes",l.length,"installed-lock bytes",n.length,"equal",l===n)'
```

Result: both filtered package inspections exited 0, the installed pnpm lock
metadata was refreshed, and the final comparison reported equal byte lengths
and `equal true`. During the helper/codegen transition, one early root
typecheck saw 113 missing `lib/api-client-react/src/generated/api.schemas/*`
modules while the generated source files were temporarily absent. Once the
install/codegen state settled, the same command passed; this was an
install/codegen race, not a TypeScript error in the application source.

## Script and test inventory

Package scripts were inventoried from the package manifests. There is no
Jest/Vitest/Playwright test script in this workspace; API tests use Node's test
runner through `tsx`, and mobile checks are standalone Node scripts.

### Root and package scripts

* Root: `preinstall`, `build`, `typecheck:libs`, `typecheck`.
* `@workspace/api-server`: `dev`, `build`, `start`, and
  `test:partner-organizations`, `test:partner-vehicle-operations`,
  `test:partner-service-requests`, `test:partner-commercial`,
  `test:shops-ghost-garage`, `test:partner-part6-bays`, `typecheck`.
* `@workspace/mobile`: `dev`, `build`, `serve`, `test:phase2`,
  `test:partner-vehicles`, `test:partner-service-requests`,
  `test:ghost-garage-ui`, newly available `test:part7-security`, and
  `typecheck`.
* `@workspace/demo-video`: `dev`, `build`, `serve`, `typecheck`.
* `@workspace/mockup-sandbox`: `dev`, `build`, `preview`, `typecheck`.
* `@workspace/scripts`: `hello`, `ghost-garage-demo`, partner report/migration
  scripts, and `typecheck`. No migration/report script was run.
* `@workspace/api-spec`: `codegen` (not run manually because it rewrites
  generated clients).
* `@workspace/db`: `push` and `push-force` (not run).

### Test files and opt-in flags

API library tests are:

```text
artifacts/api-server/src/lib/apiError.test.ts
artifacts/api-server/src/lib/authorization.test.ts
artifacts/api-server/src/lib/bayAvailability.test.ts
artifacts/api-server/src/lib/notifications.test.ts
artifacts/api-server/src/lib/providerConfig.test.ts
artifacts/api-server/src/lib/publicUrl.test.ts
artifacts/api-server/src/lib/stripeWebhookSetup.test.ts
artifacts/api-server/src/lib/validation.test.ts
artifacts/api-server/src/lib/userProfile.test.ts
```

The isolated password-reset integration test is
`artifacts/api-server/tests/password-reset.integration.test.ts`. The
development-DB integration files and their exact opt-in variables are:

| Test file | Flag |
| --- | --- |
| `partner-organizations.integration.test.ts` | `RUN_PARTNER_ORG_INTEGRATION=1` |
| `partner-vehicle-operations.integration.test.ts` | `RUN_PARTNER_VEHICLE_OPERATIONS_INTEGRATION=1` |
| `partner-service-requests.integration.test.ts` | `RUN_PARTNER_SERVICE_REQUESTS_INTEGRATION=1` |
| `partner-commercial.integration.test.ts` | `RUN_PARTNER_COMMERCIAL_INTEGRATION=1` |
| `partner-part6-bays.integration.test.ts` | `RUN_PART6_BAYS_INTEGRATION=1` |
| `shops-ghost-garage.integration.test.ts` | `RUN_SHOP_GHOST_INTEGRATION=1` |

Each DB suite additionally requires a non-production `NODE_ENV` and
`DATABASE_URL`. The suites use synthetic `example.test` identities and
dependency-ordered cleanup of IDs collected from their own inserts. They were
run one at a time to avoid database locking.

Mobile scripts inventoried:

```text
artifacts/mobile/scripts/phase2-regression.mjs
artifacts/mobile/scripts/partner-foundation.test.mjs
artifacts/mobile/scripts/partner-vehicle-operations.test.mjs
artifacts/mobile/scripts/partner-service-requests.test.mjs
artifacts/mobile/scripts/ghost-garage-ui.test.mjs
artifacts/mobile/scripts/part7-security-regression.test.mjs
```

`partner-foundation.test.mjs` has no package alias, so it was invoked directly
with Node's TypeScript stripping support.

## Commands and results

All database commands below were issued sequentially. No command below
contacts Stripe or submits money.

### API library and isolated tests

```sh
pnpm --filter @workspace/api-server exec tsx --test src/lib/*.test.ts
```

**PASS: 24/24, fail 0, skipped 0.** This includes the new authorization
flag/cancellation gates, bay overnight evaluator, Stripe webhook setup
fail-closed checks, notifications, provider/public URL guards, validation, and
the public mechanic profile field allow-list.

```sh
pnpm --filter @workspace/api-server exec tsx --test tests/password-reset.integration.test.ts
```

**PASS: 5/5, fail 0, skipped 0.** The suite uses isolated fakes and no
development-DB fixture.

```sh
artifacts/api-server/node_modules/.bin/tsx --test \
  lib/integrations-anthropic-ai/src/client.test.ts
```

**PASS: 3/3, fail 0, skipped 0.** The package does not declare its own `tsx`
binary, so the first attempted package-filter command
`pnpm --filter @workspace/integrations-anthropic-ai exec tsx --test
src/client.test.ts` failed with “Command `tsx` not found”; the workspace API
package's installed binary provided the equivalent runner. A native
`node --experimental-strip-types --test ...` attempt was also not usable
because the test imports `./client` without a `.ts` extension. These are
runner/harness limitations; the test itself passed with the available
workspace runner.

### Partner Parts 1–6 and bay DB suites

The following exact commands were run in order, with only the named flag
enabled:

```sh
env RUN_PARTNER_ORG_INTEGRATION=1 \
  pnpm --filter @workspace/api-server exec tsx --test \
  tests/partner-organizations.integration.test.ts
env RUN_PARTNER_VEHICLE_OPERATIONS_INTEGRATION=1 \
  pnpm --filter @workspace/api-server exec tsx --test \
  tests/partner-vehicle-operations.integration.test.ts
env RUN_PARTNER_SERVICE_REQUESTS_INTEGRATION=1 \
  pnpm --filter @workspace/api-server exec tsx --test \
  tests/partner-service-requests.integration.test.ts
env RUN_PARTNER_COMMERCIAL_INTEGRATION=1 \
  pnpm --filter @workspace/api-server exec tsx --test \
  tests/partner-commercial.integration.test.ts
env RUN_PART6_BAYS_INTEGRATION=1 \
  pnpm --filter @workspace/api-server exec tsx --test \
  tests/partner-part6-bays.integration.test.ts
env RUN_SHOP_GHOST_INTEGRATION=1 \
  pnpm --filter @workspace/api-server exec tsx --test \
  tests/shops-ghost-garage.integration.test.ts
```

Recorded results:

| Suite | Result |
| --- | --- |
| Organizations / Part 2 | **PASS 5/5** |
| Vehicle operations / Part 4 | **PASS 3/3** |
| Service requests / Part 5 | **PASS 1/1** |
| Commercial bridge / Part 6 | **PASS 2/2**; rerun after the frozen install also **PASS 2/2** |
| Bays / Part 6 + Part 7 availability | **PASS 4/4**; rerun after the frozen install also **PASS 4/4** |
| Shop/Ghost Garage | **PASS 1/1** after renaming the second local to `overlapBookingApproval` |

The successful DB total is now **16/16 test cases**, plus **0 skipped**. The
commercial rerun covers real linked completion/work history and earnings
projection. The bay rerun covers pending/manual approval, rejection,
cancellation, discovery, conflicts/inactive bays, mechanic lift approval
reset, and the Part 7 manual/auto-approved availability gates. The focused
Ghost Garage rerun completed its synthetic fixture lifecycle and cleaned only
its collected IDs.

### Mobile regression scripts

Commands:

```sh
pnpm --filter @workspace/mobile run test:phase2
pnpm --filter @workspace/mobile exec node --experimental-strip-types \
  scripts/partner-foundation.test.mjs
pnpm --filter @workspace/mobile run test:partner-vehicles
pnpm --filter @workspace/mobile run test:partner-service-requests
pnpm --filter @workspace/mobile run test:ghost-garage-ui
pnpm --filter @workspace/mobile run test:part7-security
```

Results are script-level because these files use `assert` rather than
Node's per-test runner:

| Script | Result |
| --- | --- |
| Phase 2 helper regression | **PASS** |
| Partner foundation | **PASS** |
| Partner vehicle operations | **PASS** |
| Partner service requests | **PASS** after asserting `router.dismissTo(...)` for context-reset navigation and retaining the no-`router.back()` assertion |
| Ghost Garage UI contract | **PASS** (also rerun after install) |
| Part 7 security regression | **PASS** with a unique self-cleaning standalone manifest root injected through `createServer({ staticRoot })` |

Thus **6/6 scripts passed, 0 failed, 0 skipped**. The package scripts emitted
only existing Node `MODULE_TYPELESS_PACKAGE_JSON` performance warnings for
TypeScript helper imports; those warnings did not fail their scripts.

The focused security script now directly covers the standalone-manifest
dependency as well as path traversal and frontend checks. It creates
`/tmp/aps-part7-security-*` only through `mkdtemp`, injects that root into the
server, and removes it in `finally`; no `static-build` files are created or
deleted.

```sh
pnpm --filter @workspace/mobile run test:part7-security
```

It exited 0. The check rejected encoded traversal, malformed encoding, NUL,
and sibling-prefix paths; returned 403 for an unsupported manifest platform;
and confirmed `/api/` prefixes, tier order, removal of `Platform (10%)`, the
`Platform fee` label, the commercial payment guard, and flattened card styles.

## Typecheck and build validation

```sh
pnpm run typecheck
```

**PASS.** The final run completed root library build-mode checking plus all
five recursive artifact/script typechecks: API server, demo video, mobile,
mockup sandbox, and scripts. No final TypeScript errors remain.

The first post-install attempt failed with **113 TS2307 missing generated
schema modules** while Orval-generated API client files were being replaced.
Rerunning after the frozen install/codegen state settled passed as documented
above.

```sh
pnpm run build
```

**FAIL before package builds:** the Vite configs require `PORT` and
`BASE_PATH`; the unqualified command stopped with those environment
configuration errors.

```sh
PORT=4173 BASE_PATH=/ pnpm run build
```

**TIMEOUT at 300 seconds in the mobile build phase.** Typechecks completed,
and the parallel demo/mockup builds started, but the mobile static build's
Metro process did not return from the iOS bundle download after reaching
99.9%. The same direct mobile command was reproduced:

```sh
PORT=4173 BASE_PATH=/ pnpm --filter @workspace/mobile run build
```

It reached `Metro ready`, fetched the iOS bundle, and then timed out without
writing `static-build/ios/manifest.json` or `static-build/android/manifest.json`.
Metro printed compatibility warnings (`expo@54.0.35` expected `~54.0.37` and
`expo-constants@18.0.13` expected `~18.0.14`), but no source transform error.
This is reported as a Metro/static-build harness blocker, not as a payment or
security pass.

The independent package builds were run with the required configuration:

```sh
pnpm --filter @workspace/api-server run build
PORT=4173 BASE_PATH=/ NODE_ENV=production \
  pnpm --filter @workspace/demo-video run build
PORT=4174 BASE_PATH=/ NODE_ENV=production \
  pnpm --filter @workspace/mockup-sandbox run build
```

**PASS:** API server esbuild, demo video Vite build, and mockup sandbox Vite
build. No mobile static bundle build can be claimed.

Finally:

```sh
git diff --check
```

**FAIL (generated-output formatting only):** Orval 8.22.0 left a blank line at
EOF in `lib/api-client-react/src/generated/api.schemas.ts`,
`lib/api-client-react/src/generated/api.ts`, and
`lib/api-zod/src/generated/api.ts`. No hand-authored implementation file was
reported by this check. The generated files were not manually reformatted.

## Coverage matrix and limitations

| Area requested for regression | Evidence run | Status/limit |
| --- | --- | --- |
| Bay availability/editor Part 7 | 3 unit tests, 4 DB tests, Ghost Garage UI contract, standalone-manifest security script | **Pass** for executable coverage; no native readiness claim |
| Partner Parts 1–6 | Foundation mobile check plus organization, vehicle, service-request, commercial, and bay DB suites | **16/16 DB cases pass** |
| Customer/mechanic/job completion | Commercial bridge completion/work-history projection, bay lifecycle, authorization gates | Partial; no dedicated general customer/mechanic job fixture suite |
| Approvals | Authorization unit gates, commercial approval flow, bay approval/conflict tests, Ghost Garage lifecycle | Partial; no general customer/mechanic fixture suite |
| Inspections | No dedicated test file/script found | **Missing coverage** |
| Trust/reputation | No dedicated end-to-end test file; public-profile allow-list unit passed | **Missing route coverage** |
| Disputes | Authorization state-gate unit passed | **Missing route/provider integration coverage** |
| Messaging | No dedicated test file/script found | **Missing coverage** |
| Ratings/reviews | No dedicated test file; commercial tests do not exercise review routes | **Missing coverage** |
| Earnings/payouts | Commercial bridge earnings projection and fake Stripe authorization gates | Partial; no provider settlement/payout delivery |
| Payments | Webhook/setup/unit guards and source checks only | No Checkout, PaymentIntent, capture, refund, Connect, transfer, payout, or live/test-card operation |
| Mobile/native | Static scripts/typecheck; no browser tester or device | No browser/device/native certification |

No migrations, production fixtures, broad fixture deletion, workflow restart,
browser tester, live API call, Stripe entity mutation, or actual money
operation was performed. The focused harness failures are resolved. Remaining
limitations are generated-output formatting noise and the previously observed
Metro static-build timeout with exact missing artifacts
`artifacts/mobile/static-build/ios/manifest.json` and
`artifacts/mobile/static-build/android/manifest.json`; the mobile build was
not repeated, and no native readiness claim is made.