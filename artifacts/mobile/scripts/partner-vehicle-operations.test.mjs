import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  PARTNER_SUBTYPE_CAPABILITY_CONFIGS,
  partnerSubtypeHasVehicleOperationsCore,
} from "../lib/partnerSubtypeCapabilitiesCore.ts";
import { buildPartnerVehicleIdentityPayload } from "../lib/partnerVehicleOperationPayload.ts";

assert.equal(partnerSubtypeHasVehicleOperationsCore("shop"), false);
assert.equal(partnerSubtypeHasVehicleOperationsCore("commercial_business"), false);
assert.equal(partnerSubtypeHasVehicleOperationsCore("dealership"), true);
assert.equal(partnerSubtypeHasVehicleOperationsCore("fleet"), true);
assert.deepEqual(PARTNER_SUBTYPE_CAPABILITY_CONFIGS.shop.vehicleFields, []);
assert.deepEqual(PARTNER_SUBTYPE_CAPABILITY_CONFIGS.commercial_business.vehicleFields, []);
assert.ok(PARTNER_SUBTYPE_CAPABILITY_CONFIGS.dealership.vehicleFields.includes("stockNumber"));
assert.ok(PARTNER_SUBTYPE_CAPABILITY_CONFIGS.dealership.vehicleFields.includes("serviceNotes"));
assert.ok(PARTNER_SUBTYPE_CAPABILITY_CONFIGS.fleet.vehicleFields.includes("maintenanceDueMileage"));
assert.ok(PARTNER_SUBTYPE_CAPABILITY_CONFIGS.fleet.vehicleFields.includes("downtimeSince"));

assert.deepEqual(
  buildPartnerVehicleIdentityPayload({
    linkedShopId: 8,
    vin: " 1hgcm82633a004352 ",
    make: " Honda ",
    model: " Accord ",
    year: 2003,
    mileage: 120000,
    plate: " abc-123 ",
  }),
  {
    linkedShopId: 8,
    vin: "1HGCM82633A004352",
    make: "Honda",
    model: "Accord",
    year: 2003,
    mileage: 120000,
    plateNumber: "ABC-123",
  },
);

const screen = readFileSync(new URL("../app/(shop-owner)/partner-vehicles.tsx", import.meta.url), "utf8");
assert.match(screen, /useListPartnerVehicleOperations/);
assert.match(screen, /useCreatePartnerVehicleOperation/);
assert.match(screen, /useLinkPartnerVehicleOperation/);
assert.match(screen, /useUpdatePartnerVehicleOperation/);
assert.match(screen, /contextKey/);
assert.match(screen, /originalOrganizationId/);
assert.doesNotMatch(screen, /locationIds/);

const dashboard = readFileSync(new URL("../app/(shop-owner)/index.tsx", import.meta.url), "utf8");
assert.match(dashboard, /Open dealership inventory/);
assert.match(dashboard, /Open fleet operations/);
console.log("Partner vehicle capability and payload checks passed.");