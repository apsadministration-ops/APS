import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { createServer, resolveStaticPath } from "../server/serve.js";

const readApp = (name) =>
  readFileSync(new URL(`../app/${name}`, import.meta.url), "utf8");

// Keep this test independent from static-build output: a failed/partial mobile
// build must not make the path-boundary regression un-runnable.
const staticRoot = mkdtempSync(path.join(tmpdir(), "part7-static-root-"));
const androidManifest = path.join(staticRoot, "android", "manifest.json");
const iosManifest = path.join(staticRoot, "ios", "manifest.json");
mkdirSync(path.dirname(androidManifest), { recursive: true });
mkdirSync(path.dirname(iosManifest), { recursive: true });
writeFileSync(androidManifest, '{"platform":"android","test":true}\n');
writeFileSync(iosManifest, '{"platform":"ios","test":true}\n');

try {
  assert.equal(resolveStaticPath("/android/manifest.json", staticRoot), androidManifest);
  assert.equal(resolveStaticPath("/ios/manifest.json", staticRoot), iosManifest);

  for (const traversal of [
    "/../package.json",
    "/../../package.json",
    "/%2e%2e/%2e%2e/package.json",
    "/%2E%2E/%2E%2E/package.json",
    "/nested/%2e%2e/%2e%2e/package.json",
    "/%2e%2e/%2f%2e%2e/package.json",
  ]) {
    assert.equal(resolveStaticPath(traversal, staticRoot), null, traversal);
  }

  // A sibling path shares the old string prefix but is not inside the fixture.
  assert.equal(resolveStaticPath("/../static-build-backup/secret.txt", staticRoot), null);
  assert.equal(resolveStaticPath("/%00secret", staticRoot), null);
  assert.equal(resolveStaticPath("/%E0%A4%A", staticRoot), null);

  const server = createServer({ staticRoot });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();

  const request = (requestPath, headers = {}) =>
    new Promise((resolve, reject) => {
      const request = http.request(
        { host: "127.0.0.1", port, path: requestPath, headers },
        (response) => {
          const chunks = [];
          response.on("data", (chunk) => chunks.push(chunk));
          response.on("end", () =>
            resolve({
              status: response.statusCode,
              body: Buffer.concat(chunks).toString("utf8"),
            }),
          );
        },
      );
      request.on("error", reject);
      request.end();
    });

  try {
    for (const [platform, manifestPath] of [
      ["android", androidManifest],
      ["ios", iosManifest],
    ]) {
      const response = await request("/manifest", { "expo-platform": platform });
      assert.equal(response.status, 200);
      assert.equal(response.body, readFileSync(manifestPath, "utf8"));
    }

    const invalidManifest = await request("/manifest", {
      "expo-platform": "../../package.json",
    });
    assert.equal(invalidManifest.status, 403);
    assert.doesNotMatch(invalidManifest.body, /"name"\s*:/);

    const encodedTraversal = await request("/%2e%2e%2f%2e%2e%2fpackage.json");
    assert.equal(encodedTraversal.status, 403);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
} finally {
  rmSync(staticRoot, { recursive: true, force: true });
}

for (const screen of ["(admin)/certifications", "(mechanic)/progression"]) {
  const source = readApp(`${screen}.tsx`);
  for (const match of source.matchAll(/customFetch<[^>]*>?\((["'`])([^"'`]+)\1/g)) {
    assert.match(match[2], /^\/api\//, `${screen} customFetch must use the API prefix`);
  }
  for (const match of source.matchAll(/customFetch\((["'`])([^"'`]+)\1/g)) {
    assert.match(match[2], /^\/api\//, `${screen} customFetch must use the API prefix`);
  }
}

const adminUsers = readApp("(admin)/users.tsx");
assert.match(
  adminUsers,
  /const TIER_ORDER = \["detailer", "technician", "senior", "advanced", "master"\]/,
);

for (const component of ["VehicleCard", "JobCard"]) {
  const source = readFileSync(
    new URL(`../components/${component}.tsx`, import.meta.url),
    "utf8",
  );
  // Expo Router's web Link renders an anchor. Flattening the RN style before
  // Link's asChild slot prevents a style array from reaching CSSStyleDeclaration.
  assert.match(source, /style=\{StyleSheet\.flatten\(\[/, component);
}
assert.match(readApp("(customer)/vehicles.tsx"), /<VehicleCard\s+vehicle=\{v\}\s*\/>/);

console.log("Part 7 static path and frontend regressions passed.");