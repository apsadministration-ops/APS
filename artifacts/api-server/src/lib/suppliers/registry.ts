/**
 * Supplier adapter registry.
 *
 * Adapters self-register at module-load time. The parts catalog engine
 * iterates `listAdapters()` to fan out offer queries. New adapters slot
 * in by adding a single import to `init.ts`.
 */

import type { SupplierAdapter } from "./types";

const REGISTRY = new Map<string, SupplierAdapter>();

export function registerSupplier(adapter: SupplierAdapter): void {
  REGISTRY.set(adapter.key, adapter);
}

export function getSupplier(key: string): SupplierAdapter | null {
  return REGISTRY.get(key) ?? null;
}

export function listAdapters(): SupplierAdapter[] {
  return Array.from(REGISTRY.values());
}
