# Part 7 — Database integrity and schema audit

**Checked:** 2026-09-13 UTC
**Environment:** development Replit PostgreSQL database (`replit_database`)
**Scope:** live relational constraints, Drizzle source schema, payment/work-log
reconciliation, refund and loyalty evidence, vehicle/VIN/ownership history,
partner organization scope, bay bookings, parts data, and lifecycle metadata.

This is an evidence record and remediation handoff, not a production-readiness
approval. The queries below were read-only. No rows, constraints, indexes,
schema objects, browser fixtures, or database settings were created, changed,
deleted, or repaired.

## Executive result

The sampled live database is internally consistent for the rows that currently
exist. The audit did **not** find an FK orphan, duplicated payment identifier,
duplicate payment row for a job, invalid VIN relationship, ownership interval
overlap, negative financial value, parts arithmetic error, or payment/work-log
state mismatch.

The main risks are guardrails that are absent from the live database rather
than corrupt rows already present:

1. Payment provider identifiers are indexed but not uniquely constrained.
2. There is no local refund entity containing provider refund identity,
   amount/currency, or refund event time. Payment/tip `status = refunded` and
   loyalty/referral reversal rows are not a refund ledger.
3. Several denormalized relationship columns have no FK or cross-column CHECK.
4. Financial, ledger, ownership-interval, and immutable-record invariants are
   largely application-enforced rather than database-enforced.
5. A small set of indexes declared by the current Drizzle source is absent from
   the live index catalog. This is schema drift/performance evidence, not an
   observed data-integrity failure.

The payment findings intentionally leave the product decision open. The current
implementation looks like one mutable canonical payment row per job, but this
audit does not assume that a future payment-attempts model is forbidden. The
provider-ID uniqueness recommendation is valid under either model; a
`payments.job_id` uniqueness constraint is conditional on the payment reviewer
confirming the one-canonical-row invariant.

## Method and evidence boundaries

### Sources inspected

* Live `information_schema.columns`, `information_schema.table_constraints`,
  `information_schema.key_column_usage`, `information_schema.referential_constraints`,
  `pg_constraint`, and `pg_indexes`.
* Drizzle source under `lib/db/src/schema`, including:
  `payments.ts`, `tips.ts`, `payoutEvents.ts`, `bayBookings.ts`,
  `worklogs.ts`, `inspections.ts`, `ownership.ts`, `loyaltyV2.ts`,
  `partnerOrganizations.ts`, `partnerVehicleOperations.ts`,
  `partnerServiceRequests.ts`, `jobs.ts`, and related tables.
* Payment and lifecycle code under
  `artifacts/api-server/src/routes/payments.ts`,
  `routes/stripeWebhook.ts`, `lib/payoutHoldEngine.ts`,
  `lib/referralEngine.ts`, and `lib/loyaltyEngine.ts`.

`lib/db/drizzle.config.ts` points Drizzle at `lib/db/src/schema/index.ts` and
PostgreSQL. There is no conventional generated SQL migration directory or
migration ledger outside dependency/vendor directories, but executable
migration scripts **are** checked in under `scripts/src` (reviewed in
“Focused review of executable migrations” below). Therefore, a source-vs-live
difference is recorded as drift; this audit cannot tell whether it is an
unapplied executable script, an intentional legacy exception, or a generated
schema change made outside this repository.

### Snapshot counts (non-PII aggregates)

The audited development snapshot contained:

| Relation | Rows |
| --- | ---: |
| `users` | 56 |
| `vehicles` | 16 |
| `jobs` | 9 |
| `work_logs` | 2 |
| `payments` | 2 |
| `bay_bookings` | 2 |
| `ownership_history` | 13 |
| `partner_organizations` | 2 |
| `partner_vehicle_operations` | 2 |
| `partner_service_requests` | 2 |
| `parts_catalog` | 32 |
| `parts_orders` | 0 |

These are development-fixture counts, not production volumes. Browser fixture
264 may have a vehicle left after a failed Add Vehicle attempt; this audit did
not identify, delete, or attribute any vehicle row to that attempt. All
vehicle rows were included in aggregate relationship checks and no PII or
vehicle identifiers were written to this report.

## 1. Query evidence: observed data quality

The checks were aggregate `COUNT(*) FILTER (...)` queries. They deliberately
return counts and statuses rather than names, emails, VINs, addresses, or
provider identifiers.

### Identity, VIN, vehicle, and job relationships

Representative query logic:

```sql
SELECT
  count(*) FILTER (WHERE lower(j.vin) <> lower(v.vin)) AS jobs_vin_mismatch,
  count(*) FILTER (WHERE lower(w.vin) <> lower(v.vin)) AS worklogs_vin_mismatch,
  count(*) FILTER (WHERE lower(i.vin) <> lower(v.vin)) AS inspections_vin_mismatch,
  count(*) FILTER (WHERE lower(o.vin) <> lower(v.vin)) AS ownership_vin_mismatch,
  count(*) FILTER (WHERE lower(n.vin) <> lower(v.vin)) AS notes_vin_mismatch,
  count(*) FILTER (WHERE lower(r.vin) <> lower(v.vin)) AS recommendations_vin_mismatch,
  count(*) FILTER (WHERE lower(po.vin) <> lower(v.vin)) AS parts_orders_vin_mismatch
FROM vehicles v
LEFT JOIN jobs j ON j.vehicle_id = v.id
LEFT JOIN work_logs w ON w.vehicle_id = v.id
LEFT JOIN inspections i ON i.vehicle_id = v.id
LEFT JOIN ownership_history o ON o.vehicle_id = v.id
LEFT JOIN mechanic_vehicle_notes n ON n.vehicle_id = v.id
LEFT JOIN vehicle_recommendations r ON r.vehicle_id = v.id
LEFT JOIN parts_orders po ON po.vehicle_id = v.id;
```

Observed result:

```text
jobs_vin_mismatch  worklogs_vin_mismatch  inspections_vin_mismatch
0                  0                      0
ownership_vin_mismatch  notes_vin_mismatch  recommendations_vin_mismatch
0                       0                   0
parts_orders_vin_mismatch
0
```

Additional job relationship checks found:

* work-log actor/vehicle mismatch: **0**;
* inspection job/vehicle/mechanic mismatch: **0**;
* parts-order job/vehicle/mechanic mismatch: **0**;
* posting-shop organization mismatch for source jobs: **0**;
* source job request/organization/reverse-link mismatch: **0**;
* normalized duplicate emails (`lower(btrim(email))`): **0**;
* normalized duplicate VINs (`lower(btrim(vin))`): **0**;
* invalid vehicle year, negative vehicle mileage, or invalid coordinates: **0**.

The live vehicle uniqueness is stronger than a plain VIN index: both
`vehicles_vin_unique` and `vehicles_vin_lower_unique` are present. A
case-insensitive normalized email unique index is not present; the current
duplicate scan is clean.

### Ownership history

The audit checked reversed intervals, pairwise overlap on the same vehicle, and
more than one open (`end_date IS NULL`) owner:

```sql
SELECT
  count(*) FILTER (WHERE end_date IS NOT NULL AND end_date < start_date),
  count(*) FILTER (
    WHERE EXISTS (
      SELECT 1
      FROM ownership_history other
      WHERE other.vehicle_id = oh.vehicle_id
        AND other.id <> oh.id
        AND other.start_date < coalesce(oh.end_date, 'infinity'::timestamptz)
        AND oh.start_date < coalesce(other.end_date, 'infinity'::timestamptz)
    )
  )
FROM ownership_history oh;
```

Observed:

* reversed intervals: **0**;
* overlapping intervals: **0**;
* vehicles with multiple current/open owners: **0**;
* open rows: **13** across **13** vehicles.

The source table has ordinary vehicle/user FKs and indexes, but no PostgreSQL
exclusion constraint and no partial unique index for the current owner. The
current data therefore passes; concurrent future writes can still violate the
policy unless the application lock/transaction is perfect.

### Organizations, operations, requests, and commercial job scope

The checked joins covered:

* shop organization and primary-owner agreement;
* operation organization versus linked shop organization;
* request organization, operation, vehicle, and location agreement;
* request source subtype versus organization subtype;
* active organization/location gates;
* source request ↔ APS job bidirectional links;
* completed/cancelled/submitted timestamp presence;
* nonnegative request versions;
* commercial job source organization/posting shop/snapshot agreement.

Every mismatch count was **0**. The current distributions were two active
partner organizations, two operations, and two submitted requests (one linked
to an APS job). Composite FKs on the partner tables are doing useful work here.

### Bay bookings and Ghost Garage links

The booking checks covered:

* denormalized booking shop versus `bay.shop_id`;
* booking shop/bay activity;
* booking mechanic role and job mechanic agreement;
* reversed estimated/actual intervals;
* live interval overlap for the same bay;
* completed booking actual-cost arithmetic using actual start/end time;
* optional work-log booking and pre/post-inspection links.

All current mismatch/overlap/orphan counts were **0**. The two completed
bookings had valid actual-time cost calculations; comparing `total_cost` to
the *estimated* duration would be a false positive because completion bills
actual elapsed time with a one-hour minimum.

One `ACCEPTED` Ghost Garage job has no pre-inspection. This is not classified as
corruption: the work-log route requires both inspections before accepting a
Ghost Garage work log, and the job is not yet completed. Completed Ghost Garage
jobs missing a post-inspection: **0**.

### Work logs, parts, and numeric integrity

The checks covered negative costs/mileage/hours, total-cost arithmetic,
flagged-without-reason, mutable work-log rows, itemized part ownership and
quantity × unit-price arithmetic, and work-log parts-cost reconciliation.

Observed:

* negative work-log values: **0**;
* `total_cost != labor_cost + parts_cost`: **0**;
* flagged row without a reason: **0**;
* `immutable_flag = false`: **0**;
* parts-item arithmetic/actor mismatch: **0**;
* work-log parts cost versus itemized totals: **0**;
* invalid catalog pricing/warranty values or reversed fitment years: **0**;
* parts orders: **0**.

The `immutable_flag` columns are state markers, not database immutability:
there is no trigger preventing an update to an immutable row.

## 2. Payment lifecycle and payment-key evidence

### Actual current lifecycle

The live payment snapshot is:

```text
status    rows  provider_intent  provider_session  transfer  payout
held      2     0                0                 0         0
```

Both payment rows join to `COMPLETED` jobs and both jobs have work logs. The
following counts were all **0**:

* work logs without a payment;
* payments without a work log;
* held payments attached to an unexpected job state;
* released payments not attached to `PAID`;
* negative dollar amounts;
* `amount != platform_fee + mechanic_payout`;
* duplicate `payments.job_id`;
* duplicate non-null payment intent IDs;
* duplicate non-null checkout session IDs;
* payment/work-log state mismatch.

This is a legacy-looking fixture state: both rows are `held`, and neither has a
Stripe session, PaymentIntent, transfer, or payout ID. It is not evidence that
Stripe authorization/capture was successfully exercised in this database.

### One canonical payment row versus payment attempts

The current code and schema do **not** show a separate payment-attempts model:

* there is a `payments` table but no `payment_attempts`/checkout-attempt relation;
* checkout locks the job and selects an existing row by `job_id`;
* an existing pending row is updated/reused;
* the route comment says it should not create a second authorized intent for a
  job;
* webhook handlers look up and mutate `payments` by provider identifier.

That supports a **proposed** one-canonical-payment-row-per-job invariant, but
this audit does not unilaterally declare the absence of a `payments.job_id`
unique constraint a bug. A payment reviewer may decide that canceled/failed
attempt history should be retained in this table. If so, an attempts model
needs explicit attempt identity, active-attempt rules, and a reviewed
relationship to the canonical job payment.

Regardless of that product choice, provider identifiers should be unique when
non-null. `payments_provider_intent_idx` is currently a normal nonunique index,
not a unique constraint; there is no live unique index for
`provider_session_id`, `provider_transfer_id`, or `provider_payout_id`.
Provider IDs are provider-owned identities, and duplicate rows would make
`SELECT ... WHERE provider_payment_intent_id = ...` and webhook updates
ambiguous. Current duplicate counts are zero, so this is a missing
defense-in-depth constraint, not an observed duplicate.

### Payment constraints absent from the live catalog

The live `pg_constraint` check list contains no payment checks. The source
declares application/Drizzle enums, but live columns are `text`; the source
enum option is not by itself a PostgreSQL CHECK. The following rules are
therefore not database-enforced:

* allowed payment status values;
* nonnegative dollar and cent amounts;
* dollar/cents agreement;
* platform fee + mechanic payout reconciliation;
* tax/parts/labor/net-profit relationships;
* `payout_destination` agreement with `shop_id`;
* `shop_split_pct` range and shop payout arithmetic;
* required provider identifiers for provider-managed states;
* hold/release timestamp/state agreement.

The current value scans for these rules returned **0** violations.
Recommendations are recorded below without applying a migration or rebuilding
the schema.

## 3. Refund and reversal audit evidence

The earlier short report's “no refund audit table” conclusion was rechecked
against all relevant relations and metadata, not only table names.

### Live schema/row evidence

An information-schema table search found no public table named:

* `refunds`;
* `payment_refunds`; or
* `refund_events`.

The `payments` columns include `status`, `failure_reason`, `released_at`,
`updated_at`, provider session/intent/transfer/payout IDs, and financial
snapshots. They do **not** include a provider refund ID, refund amount,
refunded-at timestamp, refund currency, or partial-refund total. `tips` has
`status`, `failure_reason`, `captured_at`, and provider session/intent IDs, but
the same refund metadata is absent.

`processed_stripe_events` only stores deduplication identity/type/time. It does
not store a refund ID, refund amount, payment FK, or raw refund payload. The
current count of processed event types matching `%refund%`/`%charge%` is **0**.

Current reversal/refund-related counts are all **0**:

| Evidence relation/condition | Rows |
| --- | ---: |
| `payments.status = 'refunded'` | 0 |
| `tips.status = 'refunded'` | 0 |
| `disputes.kind = 'stripe_chargeback'` | 0 |
| customer ledger `source_type = 'reversal'` | 0 |
| mechanic ledger `source_type = 'reversal'` | 0 |
| referral `event_type = 'reverted'` | 0 |
| payout `kind = 'transfer_reversed'` | 0 |

The absence of current refund rows is expected for an empty/legacy fixture; it
does not prove that a future refund will be auditable.

### Code-path evidence and limitation

`POST /payments/:jobId/refund` has an admin gate, rejects already-refunded
rows, cancels an authorized intent, and uses a deterministic full-refund
Stripe idempotency key for captured payments. The `charge.refunded` webhook
then sets the local payment to `refunded`, moves the job to `COMPLETED`, and
creates loyalty/referral reversal effects.

Those effects are useful downstream audit consequences, but they are not a
refund ledger. The local schema cannot answer:

* which Stripe refund object caused the transition;
* whether the amount was full or partial;
* whether multiple partial refunds occurred;
* which currency/fee/transfer reversal amounts were involved; or
* when the refund was provider-confirmed independently of `updated_at`.

The existing payment integration audit already classifies partial-refund
reconciliation as an explicit limitation. This database audit confirms the
schema reason. It does **not** claim that the full-refund endpoint is broken,
and it does not prescribe a refund-table shape without the payment reviewer's
decision.

## 4. Ledger, payout, dispute, and review integrity

### Loyalty and redemption ledgers

The audit checked:

* negative points only on `source_type = 'reversal'`;
* reversal rows having a job and a corresponding positive award;
* positive award uniqueness by actor/job/source;
* customer/mechanic actor roles;
* job/customer or job/mechanic agreement;
* user balance snapshots equaling ledger sums;
* positive redemption amounts;
* fulfilled rows having `fulfilled_at`, and non-fulfilled rows not having it.

Every count was **0**. Existing partial unique indexes
`cust_pts_unique_award` and `mech_pts_unique_award` protect positive awards.
There are no equivalent database CHECKs for points sign/source semantics.

### Payout events

The live table has FKs for `payment_id`, `tip_id`, and `mechanic_id`, and a
unique `provider_event_id` index. The audit found **0** events, so there are no
current orphan or contradictory event rows. There is no CHECK requiring an
event to link to exactly one of payment/tip, and no CHECK for nonnegative
`amount_cents` or kind-specific provider fields. A provider event can
legitimately arrive before a payment row is discoverable, so this needs a
reviewed “unknown external event” policy rather than a blind NOT NULL
constraint.

The source declares `payout_events_created_idx`; it is absent from the live
index catalog. This is an audit-query/performance gap, not a current ledger
corruption finding.

### Disputes, approvals, reviews, referrals

Current scans found **0** for:

* dispute rows without payment/job or required terminal-resolution metadata;
* customer approval actor/job mismatches or invalid status lifecycle;
* review participant/role mismatches, ratings outside 1–5, or invalid
  visibility/removal metadata;
* self-referrals, converted metadata mismatches, and referral flag mismatch;
* invalid enum values across approvals, recommendations, transport legs,
  redemptions, rewards, social posts, reviews, and payout events.

The database still does not enforce several cross-table authorization rules,
such as “review author is the job participant,” “approval mechanic is the
assigned mechanic,” or monotonic status-history transitions. The API currently
guards these paths; a direct SQL writer could bypass them.

## 5. Live constraints versus Drizzle source

### Foreign keys observed

The live catalog contains FKs for the normal user/job/vehicle/payment/ledger
relationships, including partner composite-scope FKs. This is why ordinary
deleted-parent orphan counts cannot be used to assess application semantics:
PostgreSQL prevents most of them already.

Denormalized or optional source columns without a live FK include:

| Column | Current evidence | Follow-up |
| --- | --- | --- |
| `bay_bookings.shop_id` | all current values agree with `bays.shop_id`; mismatch **0** | Add a composite/derived relationship or remove the redundant write field |
| `payments.shop_id` | current values valid; orphan **0** | Add FK to `shops` if retained |
| `work_logs.bay_booking_id` | all current links valid; missing/mismatch **0** | Add FK with reviewed delete behavior |
| `work_logs.pre_inspection_id` | all current links valid; missing/mismatch **0** | Add FK |
| `work_logs.post_inspection_id` | all current links valid; missing/mismatch **0** | Add FK |
| `jobs.source_organization_id/source_service_request_id` pair | null-pair and scope mismatches **0** | Add paired-null CHECK if both-or-neither is the contract |

`parts_orders.supplier_key/sku` is intentionally not treated as an FK to
`parts_offers`: the adapter registry and external supplier identity are not a
stable relational parent. A selected catalog offer/price snapshot should,
however, remain authoritative in the application order contract.

### Live CHECK constraints

`pg_constraint` currently shows checks for bay-booking status; job status,
urgency, required tier, commission override, and partner-kind snapshot; partner
organization subtype/status; partner request subtype/status/category/urgency/
version; partner operation inventory/operating status and nonnegative
operational counters; review rating; shop partner kind/commission override; and
social platform/status.

No live CHECK was found for payments, tips, work logs, vehicles, users,
ownership intervals, customer/mechanic points ledgers, redemptions,
confirmations, or payout-event amount/link shape. Source text enums and Zod
insert schemas help typed application writes but do not protect direct SQL or
already-running processes.

### Source/live index drift

The following names are declared by current source but were not found in
`pg_indexes`:

* `disputes_mechanic_idx`;
* `payout_events_created_idx`;
* `tips_customer_idx`;
* `tips_intent_idx`.

The live favorites unique index has a legacy name
(`favorites_customer_id_mechanic_id_key`) while the source calls it
`favorites_customer_mechanic_unique`; its uniqueness behavior is present, so
this is naming drift rather than a missing uniqueness rule. The live payment
provider-intent index is present but nonunique, as noted above.

No conventional migration SQL directory or migration ledger is checked into
the application repository, but executable `.mjs` migration scripts are
present and reviewed in Section 6. These differences should be reconciled by
the owning database migration process after checking script history, deploy
history, and any external migration metadata. This report does not run any
script, `drizzle-kit push`, generate migrations, or rebuild any schema object.

## 6. Focused review of executable migrations

The repository contains executable, PostgreSQL-facing migration scripts even
though it does not contain a conventional migration directory or migration
ledger. This section reviews those scripts read-only; no migration,
`drizzle-kit push`, or replay was run.

### Inventory

The checked-in migration entry points under `scripts/src` are:

| Script | Scope |
| --- | --- |
| `migrate_partner_organizations.mjs` | Partner organization foundation and nullable `shops.organization_id` |
| `migrate_partner_part4_vehicle_operations.mjs` | Normalized VIN uniqueness and partner vehicle operations |
| `migrate_partner_part5_service_requests.mjs` | Partner service requests and status history |
| `migrate_partner_part6_commercial.mjs` | Job ↔ service-request/organization source bridge |
| `migrate_partner_part6_bays.mjs` | Bay availability, booking status CHECK, active-booking uniqueness |
| `migrate_partner_part6_bay_booking_history.mjs` | Incremental terminal booking-history uniqueness adjustment |
| `migrate_parts_system.mjs` | VIN-enriched mechanic profiles and parts catalog/offer/order tables |

The companion `report_partner_*.mjs` files are read-only preflight scripts, not
migrations. They check existing relation/column presence, normalized VIN
duplicates, missing vehicle owner shops, baseline counts, and duplicate
organization/client request IDs. The migration package scripts expose the
partner organization, Part 4, and Part 5 migration/report pairs plus the Part 6
entry points; the parts migration is a direct `.mjs` entry point.

### Idempotency and transaction review

The partner organization, Part 4, Part 5, and all three Part 6 scripts:

* open an explicit transaction;
* use `COMMIT` on success and attempt `ROLLBACK` on failure;
* use `IF NOT EXISTS` for tables, columns, and most indexes;
* guard named constraint creation with `pg_constraint` checks; and
* do not backfill or rewrite existing data.

The Part 6 scripts explicitly reject `NODE_ENV=production`. The earlier
organization, Part 4, Part 5, and parts-system scripts do not have the same
runtime production guard; their “run only after review” comments are an
operational convention, not an enforced safety boundary.

`migrate_parts_system.mjs` is materially different: it concatenates all DDL
and executes it without `BEGIN`/`COMMIT`/`ROLLBACK`. A failure after the first
ALTER or CREATE can leave a partially applied schema. Its `IF NOT EXISTS`
clauses make common reruns harmless, but they do not verify that an existing
column, table, index, or relation has the expected definition. None of the
scripts performs a persistent applied-version/checksum/ledger write, so
successful replay cannot be proven from the database alone.

### Preflight and conflict behavior

The preflights reduce, but do not eliminate, replay risk:

* The organization report checks relation/column presence and linked-shop
  counts, but does not check every owner/scope conflict that the composite FK
  could reject.
* The Part 4 report checks duplicate normalized VINs and missing owner shops.
  It does not fully model every organization/shop composite-FK conflict before
  the migration creates the constraint.
* The Part 5 report checks duplicate `(organization_id, client_request_id)`;
  it does not preflight all operation/vehicle/location composite-FK and
  status-history conflicts.
* Part 6 commercial has no repository preflight companion. Its new FKs and
  unique indexes are nullable/additive, but existing orphan source IDs or
  duplicate non-null `(source_organization_id, source_service_request_id)` or
  `linked_aps_job_id` values would make the transaction fail.
* Part 6 bays and its booking-history follow-up have no companion preflight.
  They add a status CHECK and a partial unique active-booking index. Existing
  duplicate pending/reserved/active rows would fail the index creation.
  They also inspect and drop any old full `UNIQUE(job_id)` constraint or
  non-partial unique index matching that shape. This deliberately preserves
  terminal history, but it should be treated as a destructive catalog
  operation and reviewed against deploy history before replay.
* The parts migration has no preflight. It adds the catalog tables and indexes
  but does not check pre-existing relation definitions, existing enriched
  profile columns, or the required numeric/status semantics.

The existing audit data checks provide useful evidence for the current
development snapshot: normalized VIN duplicates, partner scope mismatches,
orphan source links, duplicate request IDs, booking conflicts, and parts
arithmetic errors were all **0**. They do not substitute for a transaction
preflight on a different database or a concurrent writer.

### Constraint/replay shape

The scripts are additive but not full schema reconciliation:

* `CREATE TABLE IF NOT EXISTS` does not add missing columns or constraints to a
  same-named pre-existing table with a different shape.
* Constraint guards match a named constraint, not its definition. A stale
  same-named constraint with weaker/different semantics would be accepted.
* The Part 6 bay scripts intentionally remove an old full job uniqueness object
  before creating `bay_bookings_job_id_live_unique`, so replay is idempotent
  only for the expected object shapes.
* The commercial script adds nullable source fields and independent FKs, but
  does not add an explicit both-or-neither CHECK for the source organization /
  service-request pair.
* The parts tables define relational FKs and indexes, but no CHECKs for
  positive quantity, nonnegative prices, `total_price_cents` arithmetic, or
  allowed order status values. This matches the live guardrail gap reported
  above.

### Live catalog alignment

A read-only `information_schema`/`pg_catalog` comparison found the expected
objects from the executable scripts present and validated:

* all four partner tables (`partner_organizations`,
  `partner_vehicle_operations`, `partner_service_requests`, and
  `partner_service_request_status_history`);
* `shops.organization_id` and all seven VIN-enriched
  `mechanic_vehicle_profiles` columns;
* the Part 2/4/5/6 named foreign keys and CHECKs;
* `vehicles_vin_lower_unique`;
* `jobs_source_organization_fk`,
  `jobs_source_service_request_fk`, and
  `partner_service_requests_linked_aps_job_fk`;
* `jobs_source_organization_id_idx`,
  `jobs_source_org_request_unique`, and
  `partner_service_requests_linked_aps_job_unique`;
* `bay_bookings_approved_interval_idx` and
  `bay_bookings_job_id_live_unique`; and
* all four parts tables, their parts-system indexes, and both unique
  catalog/offer indexes.

The live catalog therefore aligns with the checked-in partner/parts migration
objects for the current snapshot. It does **not** establish when or by which
script each object was applied because there is no migration ledger. The
separate Drizzle-source index drift remains: `disputes_mechanic_idx`,
`payout_events_created_idx`, `tips_customer_idx`, and `tips_intent_idx` are
absent from the live catalog. Those four indexes are not created by the
scripts listed above and need a source/deploy-history decision.

No migration was run to “fix” either the executable-script or Drizzle index
differences.

## 7. Remaining missing constraints and proposed review questions

These are recommendations only; they were not applied.

### Payment reviewer decision

1. Confirm whether `payments` is one canonical mutable row per job or an
   attempts/history relation.
2. Under the canonical-row decision, consider a unique `payments.job_id`
   constraint after reviewing legacy cancellation/retry behavior.
3. Under either decision, add partial unique constraints for each non-null
   provider identity that must be one-to-one (`provider_payment_intent_id`,
   `provider_session_id`, and the reviewed transfer/payout identity policy).
4. Decide whether provider IDs may move between rows during retry; if yes,
   document and constrain the transition rather than relying on first-row
   selection.
5. Define a refund audit contract that supports at least provider refund ID,
   payment/tip link, amount, currency, status, timestamps, and partial/multiple
   refunds before adding a migration.

### General relational guardrails

* Add reviewed FKs for the denormalized links in the table above.
* Add paired-null/source-scope checks for commercial jobs.
* Add ownership interval exclusion and one-open-owner uniqueness, with a
  backfill/overlap policy before enabling constraints.
* Add nonnegative/money arithmetic checks to payments, tips, parts, work logs,
  and bookings.
* Add status/source/sign checks to loyalty and redemption ledgers.
* Add payout-event exactly-one-source and kind-specific checks only after
  deciding how unknown/out-of-order provider events are retained.
* Add status/timestamp checks for confirmations, disputes, certifications,
  transport legs, and recommendations where the application contract is
  stable.
* Use a trigger or restricted write path for rows documented as immutable;
  an `immutable_flag` boolean alone does not enforce immutability.
* Reconcile the missing non-unique indexes after checking migration history.

## Limitations

* All counts are one development snapshot and can change when browser fixtures
  or tests run. They are not production sampling or a historical consistency
  proof.
* Aggregate counts intentionally omit PII and do not identify whether a
  browser-created vehicle is associated with a particular failed request.
* No mutation, transaction-race test, direct SQL write test, migration replay,
  Stripe provider delivery, signed webhook, refund, chargeback, payout,
  payment attempt, or browser workflow was run.
* Absence of a live row is not proof that a code path works; in particular,
  this database had no modern provider IDs, refunds, tips, payout events,
  disputes, work confirmations, parts orders, or processed refund events.
* Foreign-key validity does not prove role authorization, organization scope,
  legal ownership, or lifecycle transition validity where those rules are
  application-level.
* A schema recommendation is not a migration plan. Existing data, retries,
  legacy `held`/`released` rows, external provider event ordering, and the
  payment-attempts product decision must be reviewed before changing
  constraints.
