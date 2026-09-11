import assert from "node:assert/strict";
import { build } from "esbuild";
import express from "express";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test, { after, before, beforeEach } from "node:test";
import bcrypt from "bcryptjs";

type TestState = {
  users: Array<Record<string, any>>;
  tokens: Array<Record<string, any>>;
  emails: Array<Record<string, any>>;
  logs: Array<Record<string, any>>;
  transactions: number;
};

const testDir = dirname(fileURLToPath(import.meta.url));
const fakeDir = join(testDir, "fakes");
const routeSource = resolve(testDir, "../src/routes/passwordReset.ts");
const requestEmail = "known@example.com";
const resetPassword = "a-new-password-that-is-not-logged";
let state: TestState;
let baseUrl = "";
let server: any;
let requestNumber = 1;
let bundleDir = "";

function freshState(): TestState {
  return {
    users: [{
      id: 7,
      name: "Known Test User",
      email: requestEmail,
      passwordHash: "old-password-hash",
      status: "active",
    }],
    tokens: [],
    emails: [],
    logs: [],
    transactions: 0,
  };
}

function currentState(): TestState {
  return (globalThis as any).__passwordResetTestState as TestState;
}

async function jsonRequest(path: string, body: Record<string, any>) {
  const headers = new Headers({
    accept: "application/json",
    "content-type": "application/json",
    "x-forwarded-for": `192.0.2.${requestNumber++}`,
  });
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

async function getRequest(path: string) {
  return fetch(`${baseUrl}${path}`, {
    headers: {
      accept: "text/html",
      "x-forwarded-for": `192.0.2.${requestNumber++}`,
    },
  });
}

function emailedToken(): string {
  const text = currentState().emails[0]?.text;
  assert.equal(typeof text, "string");
  const match = text.match(/\/api\/auth\/reset-password\?token=([A-Za-z0-9_-]+)/);
  assert.ok(match, "the isolated email stub should receive a reset token");
  return decodeURIComponent(match[1]);
}

function serializedLogs(): string {
  return JSON.stringify(currentState().logs);
}

before(async () => {
  process.env.APP_BASE_URL = "https://aps.test";

  // Keep the temporary ESM bundle under this package so externalized npm
  // dependencies resolve through artifacts/api-server/node_modules.
  bundleDir = await mkdtemp(join(testDir, ".password-reset-route-"));
  const bundlePath = join(bundleDir, "password-reset-route.mjs");
  await build({
    entryPoints: [routeSource],
    bundle: true,
    format: "esm",
    platform: "node",
    outfile: bundlePath,
    external: ["express", "express-rate-limit", "bcryptjs"],
    plugins: [{
      name: "password-reset-isolated-dependencies",
      setup(buildApi) {
        buildApi.onResolve({ filter: /^@workspace\/db$/ }, () => ({
          path: join(fakeDir, "password-reset-db.ts"),
        }));
        buildApi.onResolve({ filter: /^drizzle-orm$/ }, () => ({
          path: join(fakeDir, "password-reset-drizzle.ts"),
        }));
        buildApi.onResolve({ filter: /^\.\.\/lib\/auth$/ }, () => ({
          path: join(fakeDir, "password-reset-auth.ts"),
        }));
        buildApi.onResolve({ filter: /^\.\.\/lib\/email$/ }, () => ({
          path: join(fakeDir, "password-reset-email.ts"),
        }));
        buildApi.onResolve({ filter: /^\.\.\/lib\/logger$/ }, () => ({
          path: join(fakeDir, "password-reset-logger.ts"),
        }));
      },
    }],
  });

  const routeModule = await import(`${pathToFileURL(bundlePath).href}?test=${Date.now()}`);
  const app = express();
  app.set("trust proxy", 1);
  app.use((req: any, _res, next) => {
    req.log = {
      info(fields: Record<string, any>, message: string) {
        currentState().logs.push({ level: "info", fields, message });
      },
      warn(fields: Record<string, any>, message: string) {
        currentState().logs.push({ level: "warn", fields, message });
      },
      error(fields: Record<string, any>, message: string) {
        currentState().logs.push({ level: "error", fields, message });
      },
    };
    next();
  });
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(routeModule.default);

  server = await new Promise<any>((resolveServer) => {
    const listeningServer = app.listen(0, () => resolveServer(listeningServer));
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

beforeEach(() => {
  state = freshState();
  (globalThis as any).__passwordResetTestState = state;
});

after(async () => {
  if (server) await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
  if (bundleDir) await rm(bundleDir, { recursive: true, force: true });
});

test("forgot password keeps known and unknown responses generic", async () => {
  const knownResponse = await jsonRequest("/auth/forgot-password", { email: requestEmail });
  const knownBody = await knownResponse.json();
  const unknownResponse = await jsonRequest("/auth/forgot-password", { email: "unknown@example.com" });
  const unknownBody = await unknownResponse.json();

  assert.equal(knownResponse.status, 200);
  assert.equal(unknownResponse.status, 200);
  assert.deepEqual(knownBody, unknownBody);
  assert.equal(currentState().emails.length, 1);
  assert.match(currentState().emails[0].to, new RegExp(`^${requestEmail}$`));
});

test("forgot password stores only a token hash with a one-hour TTL", async () => {
  const startedAt = Date.now();
  const response = await jsonRequest("/auth/forgot-password", { email: requestEmail });
  const finishedAt = Date.now();
  assert.equal(response.status, 200);

  const token = emailedToken();
  const stored = currentState().tokens[0];
  assert.ok(stored);
  assert.equal(stored.tokenHash, createHash("sha256").update(token).digest("hex"));
  assert.notEqual(stored.tokenHash, token);
  assert.equal(stored.tokenHash.length, 64);
  assert.ok(stored.expiresAt instanceof Date);
  assert.ok(stored.expiresAt.getTime() >= startedAt + 60 * 60 * 1000);
  assert.ok(stored.expiresAt.getTime() <= finishedAt + 60 * 60 * 1000);
});

test("invalid and expired tokens return the invalid-link response", async () => {
  const invalidResponse = await getRequest("/auth/reset-password?token=not-a-real-reset-token");
  assert.equal(invalidResponse.status, 410);
  assert.match(await invalidResponse.text(), /invalid, expired, or already used/i);

  await jsonRequest("/auth/forgot-password", { email: requestEmail });
  const token = emailedToken();
  currentState().tokens[0].expiresAt = new Date(Date.now() - 1);

  const expiredGet = await getRequest(`/auth/reset-password?token=${encodeURIComponent(token)}`);
  assert.equal(expiredGet.status, 410);
  assert.match(await expiredGet.text(), /invalid, expired, or already used/i);

  const expiredPost = await jsonRequest("/auth/reset-password", { token, newPassword: resetPassword });
  assert.equal(expiredPost.status, 410);
  assert.deepEqual(currentState().users[0].passwordHash, "old-password-hash");
});

test("reset success hashes the password and the token is single-use", async () => {
  await jsonRequest("/auth/forgot-password", { email: requestEmail });
  const token = emailedToken();
  const oldHash = currentState().users[0].passwordHash;

  const successResponse = await jsonRequest("/auth/reset-password", {
    token,
    newPassword: resetPassword,
  });
  assert.equal(successResponse.status, 200);
  assert.deepEqual(await successResponse.json(), {
    ok: true,
    message: "Password updated. You can now sign in.",
  });

  const updatedHash = currentState().users[0].passwordHash;
  assert.notEqual(updatedHash, oldHash);
  assert.equal(await bcrypt.compare(resetPassword, updatedHash), true);
  assert.equal(currentState().tokens[0].usedAt instanceof Date, true);
  assert.equal(currentState().transactions, 1);

  const secondAttempt = await jsonRequest("/auth/reset-password", {
    token,
    newPassword: "another-password-that-is-not-used",
  });
  assert.equal(secondAttempt.status, 410);
  assert.deepEqual(currentState().users[0].passwordHash, updatedHash);
});

test("request logs never contain reset credentials", async () => {
  await jsonRequest("/auth/forgot-password", { email: requestEmail });
  const token = emailedToken();
  await jsonRequest("/auth/reset-password", { token, newPassword: resetPassword });

  const logs = serializedLogs();
  assert.equal(logs.includes(requestEmail), false);
  assert.equal(logs.includes(token), false);
  assert.equal(logs.includes(resetPassword), false);
  assert.equal(logs.includes("passwordHash"), false);
});