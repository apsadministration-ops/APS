import test from "node:test";
import assert from "node:assert/strict";
import { vehiclesTable, ownershipTable, usersTable } from "@workspace/db";
import { formatVehicle } from "./vehicles";

const vehicle = {
  id: 41,
  vin: "1HGBH41JXMN109186",
  plateNumber: "APS-41",
  make: "Honda",
  model: "Civic",
  year: 2021,
  trim: null,
  color: "blue",
  mileage: 42000,
  insuranceCarrier: null,
  insurancePolicyNumber: null,
  ownerShopId: null,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
} as typeof vehiclesTable.$inferSelect;

const ownership = {
  id: 51,
  vehicleId: vehicle.id,
  userId: 7,
  vin: vehicle.vin,
  startDate: new Date("2026-01-01T00:00:00.000Z"),
  endDate: null,
  transferVerified: true,
} as typeof ownershipTable.$inferSelect;

const owner = {
  id: ownership.userId,
  name: "Vehicle Customer",
  email: "customer@example.test",
  phone: "+1-555-0100",
  role: "customer",
  status: "active",
  avatarUrl: null,
  createdAt: new Date("2025-01-01T00:00:00.000Z"),
} as typeof usersTable.$inferSelect;

test("vehicle formatter withholds owner contact from historical access", () => {
  const formatted = formatVehicle(vehicle, ownership, owner, 3, 99);
  assert.equal(formatted.currentOwner?.id, owner.id);
  assert.equal("email" in (formatted.currentOwner ?? {}), false);
  assert.equal("phone" in (formatted.currentOwner ?? {}), false);
});

test("vehicle formatter preserves contact only for an approved current-participant purpose", () => {
  const formatted = formatVehicle(vehicle, ownership, owner, 3, 99, {
    includeOwnerContact: true,
  });
  assert.equal(formatted.currentOwner?.email, owner.email);
  assert.equal(formatted.currentOwner?.phone, owner.phone);
});