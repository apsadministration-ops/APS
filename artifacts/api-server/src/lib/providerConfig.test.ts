import assert from "node:assert/strict";
import test from "node:test";
import { isValidProviderBaseUrl } from "./providerConfig";

const ENV_KEYS = ["NODE_ENV", "REPLIT_DEPLOYMENT"] as const;

test("provider URLs require HTTPS except loopback in nonproduction", () => {
  const previous = Object.fromEntries(
    ENV_KEYS.map((key) => [key, process.env[key]]),
  ) as Record<(typeof ENV_KEYS)[number], string | undefined>;
  try {
    process.env.NODE_ENV = "development";
    delete process.env.REPLIT_DEPLOYMENT;
    assert.equal(isValidProviderBaseUrl("http://localhost"), true);
    assert.equal(isValidProviderBaseUrl("http://127.0.0.1:8080"), true);
    assert.equal(isValidProviderBaseUrl("http://provider.example.test"), false);
    assert.equal(isValidProviderBaseUrl("https://provider.example.test"), true);

    process.env.NODE_ENV = "production";
    assert.equal(isValidProviderBaseUrl("http://localhost"), false);
    assert.equal(isValidProviderBaseUrl("https://provider.example.test"), true);
  } finally {
    for (const key of ENV_KEYS) {
      const value = previous[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});