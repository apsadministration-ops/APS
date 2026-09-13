import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { partnerOrganizationsTable } from "./partnerOrganizations";
import { partnerVehicleOperationsTable } from "./partnerVehicleOperations";
import { shopsTable } from "./shops";
import { vehiclesTable } from "./vehicles";
import { usersTable } from "./users";
import { jobsTable } from "./jobs";

export const PARTNER_SERVICE_REQUEST_STATUSES = [
  "draft",
  "submitted",
  "in_progress",
  "completed",
  "cancelled",
] as const;

export const PARTNER_SERVICE_REQUEST_CATEGORIES = [
  "inspection",
  "diagnostics",
  "maintenance",
  "repair",
  "recall",
  "other",
] as const;

export const PARTNER_SERVICE_REQUEST_URGENCIES = [
  "low",
  "normal",
  "high",
  "urgent",
] as const;

export const PARTNER_SERVICE_REQUEST_SUBTYPES = [
  "dealership",
  "fleet",
] as const;

/**
 * Owner-managed intake only. This table is intentionally independent from
 * APS jobs, dispatch, mechanic work, earnings, and customer workflows.
 */
export const partnerServiceRequestsTable = pgTable(
  "partner_service_requests",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => partnerOrganizationsTable.id),
    operationId: integer("operation_id").notNull(),
    vehicleId: integer("vehicle_id").notNull(),
    sourceSubtype: text("source_subtype", {
      enum: PARTNER_SERVICE_REQUEST_SUBTYPES,
    }).notNull(),
    locationId: integer("location_id").notNull(),
    status: text("status", {
      enum: PARTNER_SERVICE_REQUEST_STATUSES,
    })
      .notNull()
      .default("draft"),
    category: text("category", {
      enum: PARTNER_SERVICE_REQUEST_CATEGORIES,
    }).notNull(),
    urgency: text("urgency", {
      enum: PARTNER_SERVICE_REQUEST_URGENCIES,
    })
      .notNull()
      .default("normal"),
    requestedWork: text("requested_work").notNull(),
    serviceNotes: text("service_notes"),

    // This is server-built from the vehicle and operation at creation time.
    // It is never accepted from or replaced by an API caller.
    creationContext: jsonb("creation_context").$type<Record<string, unknown>>().notNull(),
    clientRequestId: text("client_request_id").notNull(),
    creationFingerprint: text("creation_fingerprint").notNull(),
    version: integer("version").notNull().default(0),

    // Set only by the explicit owner "Send to APS" bridge. A request may
    // create at most one APS job; the unique index and transaction lock make
    // retries return the original job rather than dispatching a duplicate.
    linkedApsJobId: integer("linked_aps_job_id").references(() => jobsTable.id),
    linkedAt: timestamp("linked_at", { withTimezone: true }),
    sendToApsFingerprint: text("send_to_aps_fingerprint"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    // The request's operation and vehicle must come from this organization.
    foreignKey({
      name: "partner_service_requests_org_operation_vehicle_fk",
      columns: [table.organizationId, table.operationId, table.vehicleId],
      foreignColumns: [
        partnerVehicleOperationsTable.organizationId,
        partnerVehicleOperationsTable.id,
        partnerVehicleOperationsTable.vehicleId,
      ],
    }),
    // A request may only point at a location belonging to its organization.
    foreignKey({
      name: "partner_service_requests_org_location_fk",
      columns: [table.organizationId, table.locationId],
      foreignColumns: [shopsTable.organizationId, shopsTable.id],
    }),
    unique("partner_service_requests_org_client_request_id_unique").on(
      table.organizationId,
      table.clientRequestId,
    ),
    uniqueIndex("partner_service_requests_linked_aps_job_unique").on(
      table.linkedApsJobId,
    ),
    index("partner_service_requests_org_idx").on(table.organizationId),
    index("partner_service_requests_operation_idx").on(table.operationId),
    index("partner_service_requests_vehicle_idx").on(table.vehicleId),
    index("partner_service_requests_location_idx").on(table.locationId),
    index("partner_service_requests_status_idx").on(table.status),
    check(
      "partner_service_requests_status_check",
      sql`${table.status} IN ('draft', 'submitted', 'in_progress', 'completed', 'cancelled')`,
    ),
    check(
      "partner_service_requests_category_check",
      sql`${table.category} IN ('inspection', 'diagnostics', 'maintenance', 'repair', 'recall', 'other')`,
    ),
    check(
      "partner_service_requests_urgency_check",
      sql`${table.urgency} IN ('low', 'normal', 'high', 'urgent')`,
    ),
    check(
      "partner_service_requests_subtype_check",
      sql`${table.sourceSubtype} IN ('dealership', 'fleet')`,
    ),
    check(
      "partner_service_requests_version_check",
      sql`${table.version} >= 0`,
    ),
  ],
);

export const partnerServiceRequestStatusHistoryTable = pgTable(
  "partner_service_request_status_history",
  {
    id: serial("id").primaryKey(),
    requestId: integer("request_id")
      .notNull()
      .references(() => partnerServiceRequestsTable.id),
    actorUserId: integer("actor_user_id")
      .notNull()
      .references(() => usersTable.id),
    fromStatus: text("from_status", {
      enum: PARTNER_SERVICE_REQUEST_STATUSES,
    }),
    toStatus: text("to_status", {
      enum: PARTNER_SERVICE_REQUEST_STATUSES,
    }).notNull(),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("partner_service_request_status_history_request_idx").on(
      table.requestId,
      table.createdAt,
    ),
    check(
      "partner_service_request_status_history_to_status_check",
      sql`${table.toStatus} IN ('draft', 'submitted', 'in_progress', 'completed', 'cancelled')`,
    ),
    check(
      "partner_service_request_status_history_from_status_check",
      sql`${table.fromStatus} IS NULL OR ${table.fromStatus} IN ('draft', 'submitted', 'in_progress', 'completed', 'cancelled')`,
    ),
  ],
);

export const insertPartnerServiceRequestSchema = createInsertSchema(
  partnerServiceRequestsTable,
).omit({
  id: true,
  createdAt: true,
  submittedAt: true,
  startedAt: true,
  completedAt: true,
  cancelledAt: true,
  updatedAt: true,
});

export type InsertPartnerServiceRequest = z.infer<
  typeof insertPartnerServiceRequestSchema
>;
export type PartnerServiceRequest =
  typeof partnerServiceRequestsTable.$inferSelect;
export type PartnerServiceRequestStatusHistory =
  typeof partnerServiceRequestStatusHistoryTable.$inferSelect;