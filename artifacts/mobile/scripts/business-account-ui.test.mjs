import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(new URL(".", import.meta.url).pathname, "..");
const registerSource = fs.readFileSync(path.join(root, "app/(auth)/register.tsx"), "utf8");
const businessSource = fs.readFileSync(path.join(root, "lib/businessAccount.ts"), "utf8");
const authSource = fs.readFileSync(path.join(root, "context/AuthContext.tsx"), "utf8");
const selectionSource = fs.readFileSync(
  path.join(root, "hooks/useSelectedPartnerOrganization.ts"),
  "utf8",
);
const organizationSource = fs.readFileSync(
  path.join(root, "lib/partnerOrganization.ts"),
  "utf8",
);
const dashboardSource = fs.readFileSync(path.join(root, "app/(shop-owner)/index.tsx"), "utf8");
const payoutSource = fs.readFileSync(path.join(root, "app/(shop-owner)/payouts.tsx"), "utf8");
const mechanicPayoutSource = fs.readFileSync(
  path.join(root, "app/mechanic/payouts/index.tsx"),
  "utf8",
);
const generatedApiSource = fs.readFileSync(
  path.join(root, "../../lib/api-client-react/src/generated/api.ts"),
  "utf8",
);

// The individual flow remains the existing address/service-radius flow and
// keeps its role-specific payload branches.
assert.match(registerSource, /role === "mechanic" \? \{ serviceRadiusMiles: serviceRadius \} : \{\}/);
assert.match(registerSource, /Please enter your full home address/);
assert.match(registerSource, /Home Address/);
for (const label of [
  "Customer",
  "Mechanic",
  "Shop \\/ Repair Facility",
  "Dealership",
  "Fleet \\/ Commercial Fleet",
]) {
  assert.match(registerSource, new RegExp(label));
}

// Business credentials and organization profile fields are deliberately
// nested separately, and no home-address field is present in that payload.
assert.match(businessSource, /business: \{/);
assert.match(businessSource, /administrator: \{/);
assert.match(businessSource, /legalName: input\.legalName\.trim\(\)/);
assert.match(businessSource, /email: input\.administratorEmail\.trim\(\)/);
assert.doesNotMatch(businessSource, /contactName: input\.administratorName/);
assert.doesNotMatch(businessSource, /homeAddress|homeLat|homeLng/);

// Selection is per-user and is initialized through the existing auth context.
assert.match(authSource, /writeSelectedPartnerOrganizationId/);
assert.match(authSource, /organizationId/);
assert.match(authSource, /removeItem\("auth_token"\)/);
assert.match(authSource, /removeItem\("auth_user"\)/);
assert.match(selectionSource, /resolveSelectedPartnerOrganizationId/);
assert.match(selectionSource, /organizations\.length === 1/);
assert.match(selectionSource, /partner-organization-selection/);
assert.match(organizationSource, /partnerOrganizationsQueryKey/);
assert.match(organizationSource, /userId \?\? "signed-out"/);

// Business Connect and financial calls are organization-scoped. The business
// screen never uses a generic owner destination or silently falls back to a
// legacy account.
assert.match(payoutSource, /beginBusinessOrganizationPayoutOnboarding\(organizationId, \{\}\)/);
assert.match(payoutSource, /getBusinessOrganizationPayoutStatus\(organizationId\)/);
assert.match(payoutSource, /getBusinessOrganizationPayoutLoginLink\(organizationId\)/);
assert.match(payoutSource, /customFetch<T>/);
assert.match(generatedApiSource, /\/api\/partner-organizations\/\$\{organizationId\}\/payouts\/onboard/);
assert.match(generatedApiSource, /\/api\/partner-organizations\/\$\{organizationId\}\/payouts\/status/);
assert.match(generatedApiSource, /\/api\/partner-organizations\/\$\{organizationId\}\/payouts\/login-link/);
for (const pathName of ["summary", "buckets", "jobs", "events"]) {
  assert.match(payoutSource, new RegExp(`financialPath\\("${pathName}", organizationId`));
}
assert.match(payoutSource, /Select a business first/);
assert.match(dashboardSource, /link-business-payouts-dashboard/);
assert.match(payoutSource, /organization context loads/);
assert.match(payoutSource, /Loading business payout context/);
assert.match(payoutSource, /Payouts blocked/);
assert.match(payoutSource, /button-manage-inactive-business/);
assert.match(payoutSource, /notice-business-payouts-legacy/);
assert.match(payoutSource, /Legacy administrator or mechanic payout accounts are not used/);
assert.match(payoutSource, /Unable to load businesses/);
assert.match(payoutSource, /No business payout jobs yet/);
assert.doesNotMatch(payoutSource, /getApiUrl\(["']\/payouts\/(onboard|status|login)/);

// Mechanic payout UI remains on its existing user-owned routes.
assert.match(mechanicPayoutSource, /\/payouts\/summary\?window=\$\{window\}/);
assert.match(mechanicPayoutSource, /\/payouts\/buckets/);
assert.doesNotMatch(mechanicPayoutSource, /organizationId/);

// A business display label must never fall back to the administrator name.
assert.match(businessSource, /input\.name\?\.trim\(\) \|\| input\.legalName\?\.trim\(\)/);

console.log("business account mobile UI static checks passed");