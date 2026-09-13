import {
  index,
  integer,
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
import { usersTable } from "./users";

export const PARTNER_ORGANIZATION_SUBTYPES = [
  "shop",
  "dealership",
  "fleet",
  "commercial_business",
] as const;

export const PARTNER_ORGANIZATION_STATUSES = ["active", "inactive"] as const;

export const partnerOrganizationsTable = pgTable(
  "partner_organizations",
  {
    id: serial("id").primaryKey(),
    primaryOwnerId: integer("primary_owner_id")
      .notNull()
      .references(() => usersTable.id),
    // Legal identity is retained separately from the canonical display/DBA
    // name. Existing rows remain valid and may be populated through the
    // owner-only organization editor.
    legalName: text("legal_name"),
    name: text("name").notNull(),
    subtype: text("subtype", { enum: PARTNER_ORGANIZATION_SUBTYPES }).notNull(),
    contactName: text("contact_name"),
    phone: text("phone").notNull(),
    email: text("email").notNull(),
    address: text("address").notNull(),
    city: text("city").notNull(),
    region: text("region").notNull(),
    zipCode: text("zip_code"),
    status: text("status", { enum: PARTNER_ORGANIZATION_STATUSES })
      .notNull()
      .default("active"),
    // Connect state belongs to the organization, not its human owner. These
    // fields are intentionally omitted from public/mechanic formatters.
    stripeAccountId: text("stripe_account_id"),
    stripeAccountReady: integer("stripe_account_ready").notNull().default(0),
    stripeAccountType: text("stripe_account_type", {
      enum: ["individual", "company"],
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    // The composite key is the target for shops' owner-consistency FK. It
    // prevents a location owned by one user from being linked to another
    // user's organization even when a caller bypasses the HTTP API.
    unique("partner_organizations_id_owner_unique").on(
      table.id,
      table.primaryOwnerId,
    ),
    uniqueIndex("partner_organizations_stripe_account_id_unique")
      .on(table.stripeAccountId)
      .where(sql`${table.stripeAccountId} IS NOT NULL`),
    index("partner_organizations_owner_id_idx").on(table.primaryOwnerId),
    index("partner_organizations_status_idx").on(table.status),
  ],
);

export const insertPartnerOrganizationSchema = createInsertSchema(
  partnerOrganizationsTable,
).omit({ id: true, createdAt: true, updatedAt: true });

export type InsertPartnerOrganization = z.infer<
  typeof insertPartnerOrganizationSchema
>;
export type PartnerOrganization =
  typeof partnerOrganizationsTable.$inferSelect;