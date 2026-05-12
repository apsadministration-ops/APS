/**
 * PartsTech adapter STUB.
 *
 * PartsTech is a B2B aggregator that exposes Advance Auto, NAPA, O'Reilly,
 * Worldpac, and many other suppliers behind a single API. Real integration
 * requires a verified shop account + API credentials. Until those are in
 * place this adapter is registered but never returns offers and refuses
 * orders explicitly (no silent fallbacks — the system fails loud).
 *
 * To wire up for real:
 *   1) Set PARTSTECH_API_KEY + PARTSTECH_SHOP_ID env vars.
 *   2) Replace `searchOffers` with a real REST call to the PartsTech
 *      catalog/quote endpoint and persist results into `parts_offers`
 *      with supplierKey = "partstech".
 *   3) Replace `placeOrder` with a call to PartsTech's order endpoint.
 *   4) Set `supportsLiveOrders = true`.
 *
 * Architecture is identical for Nexpart, WHI Solutions, Worldpac
 * SpeedDial, or any other B2B parts aggregator — copy this file, adjust
 * the env vars, swap the API endpoints.
 */

import type {
  SupplierAdapter, SupplierOffer, SupplierOrderRequest, SupplierOrderResult,
} from "../types";
import { SupplierNotConfiguredError } from "../types";

export const PARTSTECH_KEY = "partstech";

class PartsTechAdapter implements SupplierAdapter {
  readonly key = PARTSTECH_KEY;
  readonly label = "PartsTech (multi-supplier)";
  readonly supportsLiveOrders = false;

  private get configured(): boolean {
    return Boolean(process.env.PARTSTECH_API_KEY && process.env.PARTSTECH_SHOP_ID);
  }

  async searchOffers(_catalogIds: number[]): Promise<SupplierOffer[]> {
    // Configured-but-unimplemented: still return [] until the real call
    // is wired so the engine can degrade gracefully. Unconfigured: also
    // [] (no offers shown). Either way, never blocks other adapters.
    return [];
  }

  async placeOrder(_req: SupplierOrderRequest): Promise<SupplierOrderResult> {
    if (!this.configured) {
      throw new SupplierNotConfiguredError(this.key,
        "Set PARTSTECH_API_KEY + PARTSTECH_SHOP_ID and wire searchOffers/placeOrder.");
    }
    throw new SupplierNotConfiguredError(this.key,
      "PartsTech adapter scaffolded but live ordering not yet implemented.");
  }
}

export const partsTechAdapter = new PartsTechAdapter();
