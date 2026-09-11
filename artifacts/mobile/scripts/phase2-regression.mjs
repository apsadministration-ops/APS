import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import http from "node:http";
import { API_CONFIGURATION_ERROR, getApiConfig, getApiUrl } from "../lib/apiConfig.ts";
import { classifyForgotPasswordResponse } from "../lib/forgotPassword.ts";
import { getRoleDestination } from "../lib/roleDestination.ts";
import { getPushFailureDiagnostic, inferExpoProjectId } from "../lib/pushDiagnostics.ts";

// Configuration must reject missing/sentinel domains without constructing a
// URL, while accepting the host formats injected by Expo/Replit.
assert.equal(getApiConfig("").valid, false);
assert.equal(getApiConfig("undefined").valid, false);
assert.equal(getApiConfig("https://undefined/").valid, false);
assert.equal(getApiConfig("https://NULL").valid, false);
assert.equal(getApiConfig("user:password@api.example.test").valid, false);
assert.equal(getApiConfig("https://api.example.test/").apiOrigin, "https://api.example.test/api");
assert.equal(getApiConfig("api.example.test/path").valid, false);
assert.equal(getApiConfig("").error, API_CONFIGURATION_ERROR);

// Static build deployment must use the workflow-assigned port (or a safe
// ephemeral port) and must not claim the fixed 8081 port used by another
// artifact.
const buildScript = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "build.js"),
  "utf8",
);
const mobileRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const capabilityScript = fs.readFileSync(
  path.join(mobileRoot, "lib", "deviceCapabilities.ts"),
  "utf8",
);
const transportScreen = fs.readFileSync(
  path.join(mobileRoot, "app", "transport", "[jobId].tsx"),
  "utf8",
);
assert.match(buildScript, /process\.env\.PORT/);
assert.match(buildScript, /--port/);
assert.doesNotMatch(buildScript, /localhost:8081|127\.0\.0\.1:8081/);
assert.match(buildScript, /throw new Error\("Metro readiness timeout after 60 seconds"\)/);
assert.match(buildScript, /metroProcess\.once\("error"/);
assert.match(capabilityScript, /LOCATION_OPERATION_TIMEOUT_MS = 15_000/);
assert.match(capabilityScript, /withLocationTimeout/);
assert.match(capabilityScript, /lateSubscription\) => lateSubscription\.remove\(\)/);
assert.match(transportScreen, /Platform\.OS === "web"\) return/);
assert.match(transportScreen, /distanceInterval: 50/);

const buildModule = await import("./build.js");
const buildHelpers = buildModule.default ?? buildModule;
assert.equal(buildHelpers.parsePort("not-a-port"), null);
assert.equal(buildHelpers.parsePort("8081"), 8081);
assert.equal(buildHelpers.parsePort("70000"), null);

const metroProbe = http.createServer((_request, response) => {
  response.writeHead(200, { "content-type": "text/plain" });
  response.end("packager-status:running");
});
await new Promise((resolve) => metroProbe.listen(0, "127.0.0.1", resolve));
const metroProbePort = metroProbe.address().port;
assert.equal(await buildHelpers.checkMetroHealth(metroProbePort), true);
await new Promise((resolve) => metroProbe.close(resolve));

const nonMetroProbe = http.createServer((_request, response) => {
  response.writeHead(200, { "content-type": "text/plain" });
  response.end("mockup-ready");
});
await new Promise((resolve) => nonMetroProbe.listen(0, "127.0.0.1", resolve));
const nonMetroProbePort = nonMetroProbe.address().port;
assert.equal(await buildHelpers.checkMetroHealth(nonMetroProbePort), false);
await new Promise((resolve) => nonMetroProbe.close(resolve));

const originalDomain = process.env.EXPO_PUBLIC_DOMAIN;
process.env.EXPO_PUBLIC_DOMAIN = "api.example.test";
assert.equal(getApiUrl("/auth/me"), "https://api.example.test/api/auth/me");
assert.equal(getApiUrl("/api/auth/me"), "https://api.example.test/api/auth/me");
delete process.env.EXPO_PUBLIC_DOMAIN;
assert.throws(() => getApiUrl("/auth/me"), new RegExp(API_CONFIGURATION_ERROR));
if (originalDomain === undefined) delete process.env.EXPO_PUBLIC_DOMAIN;
else process.env.EXPO_PUBLIC_DOMAIN = originalDomain;

// Only 2xx is a privacy-safe generic success.  400/500 must remain errors.
for (const status of [200, 201, 202, 204, 299]) {
  assert.equal(classifyForgotPasswordResponse(status), "success");
}
assert.equal(classifyForgotPasswordResponse(429), "rate-limited");
for (const status of [400, 401, 404, 500, 503]) {
  assert.equal(classifyForgotPasswordResponse(status), "error");
}

// All supported roles have one destination, including partner/shop_owner.
assert.deepEqual(getRoleDestination("customer"), "/(customer)");
assert.deepEqual(getRoleDestination("mechanic"), "/(mechanic)");
assert.deepEqual(getRoleDestination("admin"), "/(admin)");
assert.deepEqual(getRoleDestination("shop_owner"), "/(shop-owner)");
assert.equal(getRoleDestination("unknown"), null);

// Project-id inference supports both Expo config shapes. Diagnostics contain
// useful stable metadata but never include a token/error message.
assert.equal(
  inferExpoProjectId({ expoConfig: { extra: { eas: { projectId: "expo-id" } } }, easConfig: { projectId: "fallback" } }),
  "expo-id",
);
assert.equal(inferExpoProjectId({ easConfig: { projectId: "fallback" } }), "fallback");
const secret = "ExponentPushToken[do-not-log]";
const diagnostic = getPushFailureDiagnostic("token", new Error(secret));
assert.equal(diagnostic.code, "push_token_failed");
assert.equal(JSON.stringify(diagnostic).includes(secret), false);

console.log("Phase 2 mobile helper regressions passed.");