import assert from "node:assert/strict";
import test from "node:test";
import { classifyApiError } from "./apiError";

test("API parser failures receive safe client error codes", () => {
  assert.deepEqual(classifyApiError({ type: "entity.parse.failed", code: "SECRET_DRIVER_CODE" }), {
    statusCode: 400,
    errorCode: "invalid_json",
  });
  assert.deepEqual(classifyApiError({ type: "entity.too.large", statusCode: 413 }), {
    statusCode: 413,
    errorCode: "request_too_large",
  });
  assert.deepEqual(classifyApiError({ type: "request.aborted" }), {
    statusCode: 400,
    errorCode: "bad_request",
  });
  assert.deepEqual(classifyApiError({ statusCode: 500, code: "database_secret" }), {
    statusCode: 500,
    errorCode: "internal_error",
  });
  assert.deepEqual(classifyApiError({ statusCode: 503, code: "provider_secret" }), {
    statusCode: 503,
    errorCode: "service_unavailable",
  });
});