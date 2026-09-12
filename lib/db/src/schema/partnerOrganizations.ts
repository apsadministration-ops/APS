import {
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
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