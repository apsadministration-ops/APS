import assert from "node:assert/strict";
import test from "node:test";
import {
  anthropic,
  AnthropicUnavailableError,
  isAnthropicConfigured,
} from "./client";

const ENV_KEYS = [
  "AI_INTEGRATIONS_ANTHROPIC_API_KEY",
  "AI_INTEGRATIONS_ANTHROPIC_BASE_URL",
  "NODE_ENV",
  "REPLIT_DEPLOYMENT",
] as const;

function restoreEnv(previous: Record<(typeof ENV_KEYS)[number], string | undefined>): void {
  for (const key of ENV_KEYS) {
    const value = previous[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

test("Anthropic remains importable without optional provider configuration", () => {
  const previous = Object.fromEntries(
    ENV_KEYS.map((key) => [key, process.env[key]]),
  ) as Record<(typeof ENV_KEYS)[number], string | undefined>;

  delete process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY;
  delete process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL;
  try {
    assert.equal(isAnthropicConfigured(), false);
    assert.throws(
      () => anthropic.messages.create({
        model: "fixture",
        max_tokens: 1,
        messages: [{ role: "user", content: "fixture" }],
      }),
      AnthropicUnavailableError,
    );
  } finally {
    restoreEnv(previous);
  }
});

test("Anthropic rejects placeholder provider URLs without making a request", () => {
  const previous = Object.fromEntries(
    ENV_KEYS.map((key) => [key, process.env[key]]),
  ) as Record<(typeof ENV_KEYS)[number], string | undefined>;

  process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY = "fixture-key";
  process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL = "https://undefined";
  try {
    assert.equal(isAnthropicConfigured(), false);
    assert.throws(
      () => anthropic.messages.create({
        model: "fixture",
        max_tokens: 1,
        messages: [{ role: "user", content: "fixture" }],
      }),
      AnthropicUnavailableError,
    );
  } finally {
    restoreEnv(previous);
  }
});

test("Anthropic allows HTTP only for loopback development endpoints", () => {
  const previous = Object.fromEntries(
    ENV_KEYS.map((key) => [key, process.env[key]]),
  ) as Record<(typeof ENV_KEYS)[number], string | undefined>;

  process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY = "fixture-key";
  process.env.NODE_ENV = "development";
  delete process.env.REPLIT_DEPLOYMENT;
  try {
    process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL = "http://localhost";
    assert.equal(isAnthropicConfigured(), true);
    process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL = "http://provider.example.test";
    assert.equal(isAnthropicConfigured(), false);
    process.env.NODE_ENV = "production";
    process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL = "http://localhost";
    assert.equal(isAnthropicConfigured(), false);
  } finally {
    restoreEnv(previous);
  }
});