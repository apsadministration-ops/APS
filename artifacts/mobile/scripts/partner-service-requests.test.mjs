import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildServiceRequestListParams,
  buildServiceRequestTransitionPayload,
  buildServiceRequestUpdatePayload,
  createClientRequestId,
  requestCanEdit,
  requestCanTransition,
  requestTransitionOptions,
  serviceRequestContextKey,
} from "../lib/partnerServiceRequest.ts";

assert.equal(requestCanEdit("draft"), true);
assert.equal(requestCanEdit("submitted"), true);
assert.equal(requestCanEdit("in_progress"), false);
assert.equal(requestCanTransition("draft", "submitted"), true);
assert.equal(requestCanTransition("submitted", "in_progress"), true);
assert.equal(requestCanTransition("in_progress", "completed"), true);
assert.equal(requestCanTransition("draft", "completed"), false);
assert.equal(requestCanTransition("completed", "cancelled"), false);
assert.deepEqual(
  requestTransitionOptions("in_progress").map((option) => option.toStatus),
  ["completed", "cancelled"],
);

assert.deepEqual(
  buildServiceRequestListParams({
    search: " oil ",
    status: "submitted",
    urgency: "all",
    vehicleId: 20,
    locationId: null,
    limit: 100,
  }),
  { q: "oil", status: "submitted", vehicleId: 20, limit: 100 },
);

const request = { status: "submitted", version: 4 };
assert.deepEqual(
  buildServiceRequestUpdatePayload({
    request,
    category: "maintenance",
    urgency: "high",
    requestedWork: "  Replace filter ",
    serviceNotes: "  Fleet note ",
    locationId: 7,
  }),
  {
    expectedVersion: 4,
    category: "maintenance",
    urgency: "high",
    requestedWork: "Replace filter",
    serviceNotes: "Fleet note",
    locationId: 7,
  },
);
assert.equal(buildServiceRequestUpdatePayload({ request: { status: "completed", version: 2 }, urgency: "urgent" }), null);
assert.deepEqual(
  buildServiceRequestTransitionPayload(request, "in_progress", "  Start internal tracking "),
  { expectedVersion: 4, toStatus: "in_progress", note: "Start internal tracking" },
);
assert.equal(buildServiceRequestTransitionPayload(request, "completed"), null);

assert.equal(serviceRequestContextKey(42, 8), "42:8");
assert.notEqual(serviceRequestContextKey(42, 8), serviceRequestContextKey(42, 9));
assert.match(createClientRequestId(8, 22), /^partner-8-22-new-/);

const list = readFileSync(new URL("../app/(shop-owner)/service-requests/index.tsx", import.meta.url), "utf8");
assert.match(list, /useListPartnerServiceRequests/);
assert.match(list, /status/);
assert.match(list, /urgency/);
assert.match(list, /vehicleId/);
assert.match(list, /locationId/);
assert.match(list, /contextReady/);
const detail = readFileSync(new URL("../app/(shop-owner)/service-requests/[id].tsx", import.meta.url), "utf8");
assert.match(detail, /useGetPartnerServiceRequest/);
assert.match(detail, /statusHistory/);
assert.match(detail, /buildServiceRequestTransitionPayload/);
assert.match(detail, /requestTransitionOptions/);
assert.match(detail, /does not create an APS job/);
assert.match(detail, /originOrganizationIdRef/);
assert.match(detail, /organizationChanged/);
assert.match(detail, /router\.replace\("\/\(shop-owner\)\/service-requests"/);
assert.doesNotMatch(detail, /router\.back\(/);
const create = readFileSync(new URL("../app/(shop-owner)/service-requests/new.tsx", import.meta.url), "utf8");
assert.match(create, /clientRequestId/);
assert.match(create, /createClientRequestId/);
assert.match(create, /operationId/); // context comes from the registered operation, not manual VIN fields
assert.match(create, /originOrganizationIdRef/);
assert.match(create, /organizationChanged/);
assert.match(create, /router\.replace\("\/\(shop-owner\)\/service-requests"/);
assert.doesNotMatch(create, /router\.back\(/);
const nestedLayout = readFileSync(new URL("../app/(shop-owner)/service-requests/_layout.tsx", import.meta.url), "utf8");
assert.match(nestedLayout, /<Stack>/);
assert.match(nestedLayout, /name="index"/);
assert.match(nestedLayout, /name="new"/);
assert.match(nestedLayout, /name="\[id\]"/);
const parentLayout = readFileSync(new URL("../app/(shop-owner)/_layout.tsx", import.meta.url), "utf8");
assert.match(parentLayout, /name="service-requests"/);
assert.match(parentLayout, /headerShown: false/);

console.log("Partner service request helper and UI contract checks passed.");