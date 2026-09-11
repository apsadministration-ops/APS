import assert from "node:assert/strict";
import test from "node:test";
import { sendPushNotifications } from "./notifications";

const originalFetch = globalThis.fetch;

test("push delivery treats non-success HTTP responses as non-fatal", async () => {
  globalThis.fetch = async () => new Response(null, { status: 503 });
  try {
    await sendPushNotifications([{
      to: "ExponentPushToken[test]",
      title: "Fixture",
      body: "Fixture",
    }]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("push delivery treats Expo ticket errors as non-fatal", async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({
    data: [{ status: "error", message: "fixture", details: { error: "DeviceNotRegistered" } }],
  }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
  try {
    await sendPushNotifications([{
      to: "ExponentPushToken[test]",
      title: "Fixture",
      body: "Fixture",
    }]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("push delivery treats network failures as non-fatal", async () => {
  globalThis.fetch = async () => {
    throw new Error("fixture network failure");
  };
  try {
    await sendPushNotifications([{
      to: "ExponentPushToken[test]",
      title: "Fixture",
      body: "Fixture",
    }]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("push delivery skips invalid tokens without making a request", async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response(null, { status: 200 });
  };
  try {
    await sendPushNotifications([{
      to: "not-a-push-token",
      title: "Fixture",
      body: "Fixture",
    }]);
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});