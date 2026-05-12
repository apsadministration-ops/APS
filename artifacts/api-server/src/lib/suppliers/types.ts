/**
 * SupplierAdapter contract.
 *
 * Every supplier (in-house APS-curated + future B2B aggregators like
 * PartsTech, Nexpart, WHI, or direct integrations like Worldpac SpeedDial)
 * implements this interface. The parts catalog engine queries adapters
 * for offers without caring whether the data is local or remote — when a
 * real supplier API key arrives, you ship the adapter and register it; no
 * route changes required.
 */

export interface SupplierOffer {
  catalogId: number;
  supplierKey: string;
  sku: string;
  priceCents: number;
  currency: string;
  inStock: boolean;
  etaDays: number;
  /** Adapter-specific raw payload kept for audit. */
  payload?: Record<string, unknown>;
}

export interface SupplierOrderRequest {
  catalogId: number;
  sku: string;
  qty: number;
  /** Mechanic-side reference so we can match against supplierOrderRef on callback. */
  externalRef: string;
}

export interface SupplierOrderResult {
  supplierOrderRef: string;
  invoiceUrl?: string;
  etaDays: number;
}

export interface SupplierAdapter {
  /** Stable string registered in the parts_offers + parts_orders tables. */
  readonly key: string;
  /** Human label shown to mechanics. */
  readonly label: string;
  /**
   * Whether this adapter can actually place an order through a real API.
   * The in-house APS-curated adapter and stub external adapters return
   * false; mechanics still see the offers, but the order stays in
   * "candidate" until a real fulfillment path is wired.
   */
  readonly supportsLiveOrders: boolean;
  /**
   * Return all offers this adapter can serve for the given catalog ids.
   * MUST be safe to call with an empty array.
   */
  searchOffers(catalogIds: number[]): Promise<SupplierOffer[]>;
  /**
   * Place a real order. Adapters that don't support live ordering throw
   * `SupplierNotConfiguredError` — caller catches and leaves the row in
   * "candidate" status with an explanatory `validationReasons` entry.
   */
  placeOrder(req: SupplierOrderRequest): Promise<SupplierOrderResult>;
}

export class SupplierNotConfiguredError extends Error {
  readonly code = "SUPPLIER_NOT_CONFIGURED";
  constructor(supplierKey: string, reason: string) {
    super(`Supplier ${supplierKey} not configured: ${reason}`);
  }
}
