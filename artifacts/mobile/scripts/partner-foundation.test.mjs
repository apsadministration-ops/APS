import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PARTNER_LAYER_LABEL, PARTNER_LAYER_DESCRIPTION } from "../lib/partnerIdentity.ts";
import { getRoleDestination } from "../lib/roleDestination.ts";

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
const screen = (name) => readFileSync(new URL(`../app/${name}.tsx`, import.meta.url), "utf8");
const registration = screen("(auth)/register");
assert.match(registration, /setRole\("shop_owner"\)/);
assert.match(registration, /role === "shop_owner" &&/);
for (const name of ["(auth)/register", "(shop-owner)/index", "(shop-owner)/profile"]) {
  assert.match(screen(name), /\{PARTNER_LAYER_LABEL\}/);
}
console.log("Partner foundation identity and legacy routing checks passed.");