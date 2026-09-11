import assert from "node:assert/strict";
import test from "node:test";
import { getPublicBaseUrl, getPublicDomain } from "./publicUrl";

const URL_KEYS = [
  "APP_BASE_URL",
  "PUBLIC_BASE_URL",
  "REPLIT_DOMAINS",
  "REPLIT_DEV_DOMAIN",
  "REPLIT_DEPLOYMENT",
  "NODE_ENV",
] as const;

test("URL sources remain purpose-specific and invalid configured values fail closed", () => {
  const previous = Object.fromEntries(
    URL_KEYS.map((key) => [key, process.env[key]]),
  ) as Record<(typeof URL_KEYS)[number], string | undefined>;
  try {
    process.env.NODE_ENV = "development";
    delete process.env.REPLIT_DEPLOYMENT;
    process.env.APP_BASE_URL = "https://reset.example.test";
    process.env.PUBLIC_BASE_URL = "https://amplification.example.test";
    process.env.REPLIT_DOMAINS = "app.example.test";
    process.env.REPLIT_DEV_DOMAIN = "preview.example.test";
    assert.equal(getPublicBaseUrl("reset"), "https://reset.example.test");
    assert.equal(getPublicBaseUrl("payment"), "https://app.example.test");
    assert.equal(getPublicBaseUrl("payout"), "https://app.example.test");
    assert.equal(getPublicBaseUrl("tip"), "https://app.example.test");
    assert.equal(getPublicBaseUrl("domain_callback"), "https://app.example.test");
    assert.equal(getPublicBaseUrl("referral"), "https://app.example.test");
    assert.equal(getPublicBaseUrl("amplification"), "https://amplification.example.test");

    process.env.APP_BASE_URL = "https://undefined";
    process.env.PUBLIC_BASE_URL = "https://undefined";
    assert.equal(getPublicBaseUrl("reset"), null);
    assert.equal(getPublicBaseUrl("amplification"), null);
    assert.equal(getPublicBaseUrl("payment"), "https://app.example.test");
    delete process.env.REPLIT_DOMAINS;
    assert.equal(getPublicBaseUrl("payment"), "https://preview.example.test");
  } finally {
    for (const key of URL_KEYS) {
      const value = previous[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("production URL helpers fail closed instead of producing https://undefined", () => {
  const previous = Object.fromEntries(
    URL_KEYS.map((key) => [key, process.env[key]]),
  ) as Record<(typeof URL_KEYS)[number], string | undefined>;
  try {
    process.env.NODE_ENV = "production";
    process.env.REPLIT_DEPLOYMENT = "1";
    process.env.REPLIT_DOMAINS = "undefined";
    delete process.env.APP_BASE_URL;
    delete process.env.PUBLIC_BASE_URL;
    delete process.env.REPLIT_DEV_DOMAIN;
    assert.equal(getPublicBaseUrl("payment"), null);
    assert.equal(getPublicDomain("domain_callback"), null);
  } finally {
    for (const key of URL_KEYS) {
      const value = previous[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});