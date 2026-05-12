/**
 * Supplier adapter bootstrap.
 *
 * Imported once at server startup. Registers every adapter so the
 * registry is populated before any route handler queries it.
 */

import { registerSupplier } from "./registry";
import { apsCuratedAdapter } from "./internal/apsCuratedAdapter";
import { partsTechAdapter } from "./external/partsTechStub";

let initialized = false;
export function initSuppliers(): void {
  if (initialized) return;
  registerSupplier(apsCuratedAdapter);
  registerSupplier(partsTechAdapter);
  initialized = true;
}
