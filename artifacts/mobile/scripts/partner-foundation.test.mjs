import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PARTNER_LAYER_LABEL, PARTNER_LAYER_DESCRIPTION } from "../lib/partnerIdentity.ts";
import { getRoleDestination } from "../lib/roleDestination.ts";
import {
  PARTNER_ORGANIZATION_SUBTYPE_OPTIONS,
  partnerOrganizationSelectionStorageKey,
  partnerOrganizationSubtypeLabel,
} from "../lib/partnerOrganization.ts";
import {
  isPartnerRouteActive,
  isPartnerServiceRequestDetailActive,
} from "../lib/partnerRouteAccessibility.ts";

assert.equal(PARTNER_LAYER_LABEL, "Dealer / Fleet / Shop");
assert.match(PARTNER_LAYER_DESCRIPTION, /Ghost Garages/);
assert.match(PARTNER_LAYER_DESCRIPTION, /commercial businesses/);
assert.equal(getRoleDestination("shop_owner"), "/(shop-owner)");
assert.equal(getRoleDestination("customer"), "/(customer)");
assert.equal(getRoleDestination("mechanic"), "/(mechanic)");
assert.equal(getRoleDestination("admin"), "/(admin)");
// Display names must not become new login roles.
assert.equal(getRoleDestination(PARTNER_LAYER_LABEL), null);
assert.equal(getRoleDestination("dealer"), null);
assert.equal(getRoleDestination("fleet"), null);
assert.deepEqual(
  PARTNER_ORGANIZATION_SUBTYPE_OPTIONS.map((option) => option.value),
  ["shop", "dealership", "fleet", "commercial_business"],
);
assert.equal(partnerOrganizationSubtypeLabel("commercial_business"), "Commercial business");
assert.equal(partnerOrganizationSubtypeLabel("unknown"), "Organization");
assert.equal(partnerOrganizationSelectionStorageKey(42), "partner-organization-selection:42");
assert.equal(isPartnerRouteActive("/(shop-owner)/service-requests", "service-requests"), true);
assert.equal(isPartnerRouteActive("/service-requests/42", "service-request-detail"), true);
assert.equal(isPartnerRouteActive("/service-requests/42", "service-requests"), false);
assert.equal(isPartnerRouteActive("/service-requests/new", "service-request-detail"), false);
assert.equal(isPartnerServiceRequestDetailActive("/service-requests/42", 42), true);
assert.equal(isPartnerServiceRequestDetailActive("/service-requests/42", 43), false);
assert.equal(isPartnerServiceRequestDetailActive("/service-requests/new", 42), false);
assert.equal(isPartnerRouteActive("/partner-vehicles", "partner-vehicles"), true);
assert.equal(isPartnerRouteActive("/organizations", "organizations"), true);
const screen = (name) => readFileSync(new URL(`../app/${name}.tsx`, import.meta.url), "utf8");
const registration = screen("(auth)/register");
assert.match(registration, /role: "shop_owner"/);
assert.match(registration, /selectRole\(option\.role, option\.businessSubtype\)/);
assert.match(registration, /useRegisterBusiness/);
assert.match(registration, /PARTNER_LAYER_DESCRIPTION/);
for (const name of ["(shop-owner)/index", "(shop-owner)/profile"]) {
  assert.match(screen(name), /\{PARTNER_LAYER_LABEL\}/);
}
const organizations = screen("(shop-owner)/organizations");
assert.match(organizations, /useListPartnerOrganizations/);
assert.match(organizations, /useLinkPartnerOrganizationLocation/);
assert.match(organizations, /organizationId == null/);
assert.doesNotMatch(organizations, /primaryOwnerId|ownerId\s*:/); // server-owned fields are never submitted
const selectionHook = readFileSync(new URL("../hooks/useSelectedPartnerOrganization.ts", import.meta.url), "utf8");
assert.match(selectionHook, /useQuery/);
assert.match(selectionHook, /SELECTION_QUERY_PREFIX/);
assert.match(selectionHook, /writeSelectedPartnerOrganizationId[\s\S]*\.catch/);
console.log("Partner foundation identity and legacy routing checks passed.");