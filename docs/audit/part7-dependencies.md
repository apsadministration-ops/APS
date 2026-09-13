# Part 7 dependency remediation

## Scope and baseline

This review covers the dependency scanner in
`docs/audit/part7-security-scanners.json`. The baseline contains 102 dependency
findings: **11 critical, 59 high, 26 moderate, and 6 low**. This change is
limited to workspace package manifests, the pnpm catalog/overrides, and
`pnpm-lock.yaml`; application code and the two SAST findings in the scanner
artifact are outside this dependency-only remediation.

The lockfile was regenerated as one coherent dependency resolution after the
manifest/catalog changes, then installed with `--frozen-lockfile`. The
post-change scanner run is intentionally left to the main agent; the
remediation inventory below must not be treated as a scanner-confirmed
finding count.

## Targeted remediations pending scanner confirmation

The following baseline records are addressed by compatible direct updates or
targeted lockfile overrides. This is an implementation inventory, not a claim
that 96 findings are fixed. The main agent must rerun the same scanner and
replace the baseline counts with its actual post-change output. Overrides are
limited to the vulnerable resolved version and retain the parent package's
supported major/range; they are not blanket replacements.

| Package (baseline) | Reachability / direct parent | Remediation and locked result |
| --- | --- | --- |
| `@babel/core@7.29.0` (1 low) | Mobile's direct dev dependency; also shared by Expo/Metro and Vite React tooling | Mobile manifest raised to `^7.29.6`; lock resolves `7.29.7` |
| `@xmldom/xmldom@0.8.13`, `@xmldom/xmldom@0.9.10` (23 high/moderate) | Expo 54's `@expo/plist`; the 0.9 chain is Expo `xcode` → `simple-plist` → `plist` | Targeted branch-preserving overrides lock `0.8.15` and `0.9.12`; Expo remains SDK 54 |
| `baseline-browser-mapping@2.10.0` and `browserslist@4.28.1` (3 moderate/high) | Babel helper targets and Expo/Metro tooling in mobile/demo-video | Targeted fixes; lock resolves `baseline-browser-mapping@2.11.22` and `browserslist@4.28.7` |
| `body-parser@2.2.2` (1 low) | API server's direct `express@5.2.1` dependency | Express-compatible targeted override to `2.3.0` |
| `brace-expansion@5.0.5` (4 high/moderate) | Expo CLI/fingerprint, React Native's `glob`, and Orval's TypeDoc | Existing workspace override tightened to the fixed 5.x line; lock `5.0.9` |
| `fast-uri@3.1.2` (6 high) | `ajv` from `expo-build-properties` and Orval's Scalar/OpenAPI parser | Existing override tightened to fixed 3.x; lock `3.1.7` |
| `fflate@0.6.10`, `fflate@0.8.2` (2 high) | Demo-video `three-stdlib` and `@types/three` through `@react-three/drei` | Separate targeted branch overrides; lock `0.6.11` and `0.8.3` |
| `form-data@4.0.5` (1 high) | API server → OpenAI → `@types/node-fetch` | Targeted patch override to `4.0.6` |
| `ip-address@10.2.0` (3 high/moderate) | API server's `express-rate-limit@8.5.1` | Targeted 10.x override to `10.3.1` |
| `js-yaml@3.14.2`, `4.1.1`, `4.2.0` (11 high/moderate) | Expo/RN test tooling uses 3.x; Expo `@expo/xcpretty` and Orval use 4.x | Separate major-line overrides; lock `3.15.2` and `4.3.2` |
| `nanoid@3.3.11` (3 high/moderate) | PostCSS used by Vite and Metro | Targeted fix plus the PostCSS update; lock is `3.3.18`/`3.3.19` |
| `orval@8.5.3` (11 critical, 1 high) | Direct dev dependency of `@workspace/api-spec` | Updated to `8.22.0`, still Orval major 8. The config's `zod.version: 3`, catalog Zod `3.25.76`, generated output paths, and React Query/Zod clients are unchanged |
| `postcss@8.5.14` (1 high, 1 moderate) | Vite and Expo/Metro build tooling | Existing override tightened to fixed 8.x; lock `8.5.28` |
| `qs@6.15.0` (2 moderate, 1 low) | API server through Express/body-parser | Targeted compatible 6.x fix to `6.16.0` |
| `shell-quote@1.8.3` (2 high) | React Native `react-devtools-core` | Targeted fix to `1.9.0` |
| `tar@7.5.13` (5 high, 1 moderate) | Expo CLI archive tooling | Targeted compatible 7.x fix to `7.5.21` |
| `undici@6.25.0` (1 high, 4 moderate, 2 low) | Expo CLI's HTTP tooling | Targeted compatible 6.x fix to `6.28.0` |
| `vite@7.3.2` (1 high, 1 moderate) | Catalog dependency of demo-video and mockup-sandbox | Catalog raised within Vite 7; lock `7.3.6` |
| `ws@6.2.3`, `7.5.10`, `8.20.0` (3 high, 1 moderate) | React Native/Metro, React DevTools, Expo CLI, OpenAI and root Stripe sync | Separate patch-line overrides lock `6.2.4`, `7.5.11`, and `8.21.0` |

## Explicit compatibility blockers

These six findings are retained as explicit compatibility blockers rather than
being forced through a broad override or library replacement. Their severity
counts are copied from the baseline only (**4 high, 1 moderate, and 1 low**);
the post-change status must be confirmed by the main agent's scanner run.

| Package (baseline) | Reachability | Why remediation is blocked |
| --- | --- | --- |
| `decode-uri-component@0.2.2` (1 moderate) | Expo Router 6 → `query-string@7.1.3` → `decode-uri-component` | The fixed `0.5.0` is outside the parent's declared `^0.2.2` range; updating `query-string` to its next major or forcing an out-of-range parser is not a verified Expo-compatible change |
| `esbuild@0.27.3` (1 low) | Direct API-server dev tool, Vite, Orval, Drizzle tooling, and `tsx` | The scanner fix `0.28.1` is outside Vite 7.3.6's `^0.27.0` range and the API server's `^0.27.3` contract; the finding is a Windows development-server issue |
| `image-size@1.2.1` (2 high) | Expo/React Native SDK 54 Metro 0.83.3/0.83.7 | No scanner fix is published; the current latest is 2.x, a major API line that would require changing the Expo/RN Metro chain |
| `uuid@3.4.0`, `uuid@7.0.3` (2 high) | Expo ngrok uses 3.x; Expo config plugins → xcode uses 7.x | The only listed fix is `11.1.1`, requiring a major upgrade in Expo-owned chains; no replacement or cross-major override was applied |

## Verification notes

- `pnpm install --frozen-lockfile` completed successfully, followed by a
  frozen lockfile-only resolution check.
- Installed package checks report Orval `8.22.0`, Zod `3.25.76`, TanStack
  React Query `5.90.21`, and Babel core `7.29.7`.
- Expo remains on SDK `54.0.35` with React Native `0.81.5`; no Expo major
  upgrade or native library replacement was made.
- Orval remains on major version 8 and the existing Zod 3 codegen setting is
  preserved.

## Codegen/regression handoff

After the frozen install, `pnpm --filter @workspace/api-spec run codegen`
completed with Orval `8.22.0` and the workspace `tsc --build` library
typecheck. The output uses Zod 3 APIs (`zod.object`, `zod.enum`, etc.), and no
Zod 4-only APIs were generated.

The generated React client retained all 788 previously exported names and the
schema barrel retained all 270 names. The Zod client retained all 440 previous
exports and adds 38 response validators generated by Orval 8.22. The existing
`CreateShopBayBody as CreateBayBody` compatibility alias remains in
`lib/api-zod/src/index.ts`. The Orval post-write hook deduplicates its
generated React barrel exports so repeated codegen does not change the
existing package surface. Orval 8.22 does rewrite formatting/templates across
the generated files, but the export comparison and server/mobile typechecks
found no removed route/client symbols.

Regression helper handoff: the dependency install, codegen, generated-export
comparison, Zod 3 check, and library typecheck are ready for the main agent's
coordinated regression run. The dependency scanner rerun remains the explicit
next step.