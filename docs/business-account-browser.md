# Business-first account browser verification

## Scope and method

This pass tested one fresh UI signup/session journey for each requested type:

- Customer
- Mechanic
- Shop / Repair Facility
- Dealership
- Fleet / Commercial Fleet

Customer and mechanic used the existing personal form and `/auth/register`
through the UI. Business types used the business-first form and
`/auth/register-business` through the UI. Every fixture used unique
`p8-*` names/emails. Credentials are intentionally not recorded here.

The business address was entered as `1600 Pennsylvania Ave NW, Washington, DC
20500` and verified through the live address lookup. The provider resolved it
to the White House / Pennsylvania Avenue Northwest address. No typed-address
bypass was used.

## Account results

### Customer — PASS

- Signup started at `/login` → Sign Up → Customer (`718x1k`).
- Existing personal fields remained: Full Name, Email, optional Phone,
  Password, Home Address, Verify Address.
- Address verification showed `Address Verified` and the canonical resolved
  address (`q5j1fs`).
- UI submission authenticated the fresh customer and loaded the customer Home
  dashboard (`azpnin`).
- Dashboard was customer-specific: `Request a Service`, Vehicles, Jobs,
  Profile, zero vehicles/jobs/spend, and no business organization card.
- Profile showed the human principal, role `CUSTOMER`, entered email/phone,
  and `Account Status ACTIVE` (`xycxlf`).
- UI logout was verified after explicitly accepting the native confirmation
  dialog (`uxbers`).

### Mechanic — PASS with non-blocking dashboard limitation

- Signup used the unchanged personal mechanic form with the additional Service
  Radius section (`6h3ubu`).
- Address verification succeeded and `50 mi` was selected (`gmewgl`).
- UI submission authenticated the fresh mechanic and loaded mechanic-specific
  navigation: Dashboard, Available, Active, History, Profile, Tier
  (`fzes8h4`).
- Profile showed the human principal, Detailer/Tier 1, entered email/phone,
  and `Account Status PENDING` (`fsk8h4`). This is the expected mechanic
  status; the requested 50-mile value was selected in the form but is not
  exposed by the current Profile UI.
- The Dashboard shell displayed `Failed to load dashboard` and three HTTP 403
  resource loads, while Profile and mechanic navigation rendered. This is
  recorded as a non-blocking dashboard-data limitation; it did not prevent
  signup, authentication, or pending-status verification.
- UI logout was verified with explicit dialog acceptance (`dmrl50`).

### Shop / Repair Facility — PASS

- Business-first form showed Shop selected, Business profile first, then a
  separate Primary owner/admin section; no personal home-address-only form was
  present (`vnm3k3`).
- Business legal name/DBA/email/phone and admin name/login email/phone/password
  were distinct. Address verification succeeded (`m1lppq`).
- UI submission created exactly one selected Shop organization, with separate
  DBA/legal names and `0 linked physical locations`; the UI said `No
  locations yet` (`x73ca7`).
- Profile showed administrator and selected business separately: admin name and
  login email versus DBA, legal name, business email, and phone (`0qhg9t`).
- `/api/auth/me` returned HTTP 200 for the human administrator, role
  `shop_owner`, status `active`, id 341 (`nja07t`).
- UI logout was verified with explicit dialog acceptance (`x4qbgu`).

### Dealership — PASS

- Business-first Dealership form rendered with separate business/admin
  sections (`fv2pc9`). Business and admin names/emails were distinct and the
  address verified (`9e58dx`).
- UI submission loaded the Dealership dashboard with exactly one selected
  organization, separate DBA/legal name, and `0 linked physical locations`;
  `No locations yet` was visible (`s1ubnp`).
- Profile kept identities separate: Dealership admin versus selected Dealership
  business/legal/contact fields (`8e43kk`).
- `/api/auth/me` returned HTTP 200 for human admin id 350, role `shop_owner`,
  status `active` (`y4ujok`).
- Payout view was organization-scoped and safe: selected Dealership, account
  `Not connected`, Charges/Payouts/Details all `Not yet`, zero activity, and
  visible `Set up company payouts` control (`hpgx5s`). The onboarding control
  was intentionally not clicked because it would create a real Stripe account.
- UI logout was verified (`xkj9xc`).

### Fleet / Commercial Fleet — PASS

- Fleet was selected from the five-option chooser (`2ekz4n`), and the
  business-first form had distinct business/admin values. Address verification
  succeeded (`wentn4`).
- UI submission loaded the Fleet dashboard with exactly one selected
  organization, Fleet subtype, separate DBA/legal name, `0 linked physical
  locations`, and `No locations yet` (`9l2454`).
- Profile showed separate Fleet admin and selected Fleet business identity
  (`8igone`).
- `/api/auth/me` returned HTTP 200 for human admin id 351, role `shop_owner`,
  status `active` (`u68vph`).
- Payout view was organization-scoped and safe: selected Fleet, account
  `Not connected`, Charges/Payouts/Details all `Not yet`, zero activity, and
  visible `Set up company payouts` control (`ojcf1x`). Onboarding was not
  clicked.
- UI logout was verified (`oxe7tq`).

## Organization selection and scope

For the Shop account, the allowed API prerequisite created exactly one second
organization, id 249, owned by the same administrator. The first automatically
created organization was id 248. The UI selector showed exactly both active
organizations (`vzezpb`), and selecting the second through the UI changed the
selected business details to its distinct legal/DBA/contact/address with
`0` linked locations (`xllb4g`).

Profile followed the selected organization while retaining the same human
administrator (`sy7huf`). The selected second organization’s payout view was
organization-scoped and safe: `Not connected`, all three capabilities `Not
yet`, zero activity, legacy-account warning, and visible onboarding control
(`bofvhz`). No other account context was shown, and no Stripe onboarding was
started.

## Cleanup

After all UI journeys, one guarded transaction deleted only this run’s
records:

- Users 335, 336, 341, 350, 351 (customer, mechanic, Shop admin, Dealership
  admin, Fleet admin)
- Organizations 248, 249, 256, 257

Pre-delete child inventory for those exact IDs was empty for shops,
operations, service requests, jobs, work logs, approvals, ownership, and bay
bookings. The transaction committed with exactly 4 organization deletes and 5
user deletes. Fresh post-commit verification returned zero for every checked
category: users, organizations, shops, operations, service requests, jobs,
work logs, approvals, ownership, and bay bookings.

No global baseline-count assertion was made because legacy/concurrent fixtures
may be owned by other test helpers; cleanup and verification were restricted
to this run’s unique records.

## Limits and warnings

- The mechanic dashboard shell showed `Failed to load dashboard` with three
  HTTP 403 resource loads; Profile and expected `PENDING` status remained
  usable.
- No Stripe onboarding, payout account creation, charge, or payment action was
  performed.
- Repeated runtime-only warnings included unavailable push notifications,
  deprecated React Native web style/responder props, and the password field not
  being contained in an HTML form.

## Narrow session/login follow-up

The original five UI signup journeys were not repeated. Three fresh
Shop/Dealership/Fleet fixtures were created only as an API prerequisite so
their administrator credentials could be exercised through the real login UI:

- Shop user 366, organization 269
- Dealership user 367, organization 270
- Fleet user 368, organization 271

### UI administrator login and reload — PASS

- Shop administrator login through `/login` restored the correct Shop
  dashboard, selected DBA/legal identity, and 0 linked locations (`kyw2pp`).
  Profile separated the administrator and Shop business (`wo9sge`). Reloading
  the authenticated Profile route returned to the root dashboard and retained
  the same Shop organization and 0 locations (`6k1nss`).
- Dealership administrator login restored the correct Dealership dashboard,
  subtype, legal name, and 0 linked locations, with no Shop-specific content
  (`zykk0k`). Profile showed the matching admin/business pair (`t5bwks`).
  Reload retained the Dealership organization and 0 locations (`3iux0q`).
- Fleet administrator login restored the correct Fleet dashboard, Fleet
  operations action, and 0 linked locations, with no Dealer/Shop business
  selected (`515o34`). Profile showed the matching admin/business pair
  (`vcpud3`). Reload retained the Fleet organization and 0 locations
  (`8oiunn`).
- Each logout used the UI and explicitly accepted the native confirmation
  dialog before the next login. The final session also ended at `/login`.

### Shop second organization, logout/login restore — PASS

- While authenticated as Shop user 366, the permitted browser-authenticated
  API prerequisite created organization 272. The initial context-request
  attempt returned 401 and created nothing; retrying via the browser’s stored
  auth token returned HTTP 201 and created only org 272.
- The UI Organizations view then showed exactly two active owned Shop
  organizations, 269 and 272 (`tkaevu`). Selecting org 272 through the UI
  showed its distinct DBA/legal/contact/New York address and `0` linked
  locations, with no unlinked locations available (`qciywt`).
- Profile followed selected org 272 while retaining the same administrator
  (`le5rqv`). Its payout view remained scoped to org 272: `Not connected`,
  Charges/Payouts/Details all `Not yet`, zero activity, and the legacy-account
  warning (`aa6fuk`). The Stripe onboarding button was not clicked.
- The Shop session was logged out through UI, logged back in through `/login`,
  and restored org 272 rather than reverting to org 269. Dashboard showed the
  second DBA/legal/contact and 0 linked locations (`otbyez`); Profile confirmed
  the same selected business/admin pair after login (`2sw0lz`).

### Cross-owner deep-link denial — PASS

While authenticated as Shop user 366, API GET requests for the other owners’
organizations returned 404 `{"error":"Organization not found"}` for all four:

- `/api/partner-organizations/270`
- `/api/partner-organizations/270/locations`
- `/api/partner-organizations/271`
- `/api/partner-organizations/271/locations`

The negative result and unchanged Shop Profile context are captured in
`06farl`. No foreign organization data or payout state was disclosed.

### Session follow-up cleanup

After the final Shop logout, pre-delete child inventory for users 366–368 and
organizations 269–272 was zero for shops, vehicle operations, service
requests, jobs, and work logs. One guarded transaction deleted exactly four
organizations and three users. Fresh exact-ID verification returned zero for
users, organizations, shops, operations, service requests, jobs, and work
logs. The final browser pages were both at `/login` (`92xds1`, `cks6b1`).

The session-follow-up fixtures were restricted to this run’s IDs; unrelated
legacy/concurrent fixtures were preserved.