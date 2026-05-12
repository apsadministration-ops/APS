import { commissionForJob, splitOnNetProfit, type TierKey, type ServiceCategory } from "@workspace/tier-catalog";

/**
 * APS True Net Profit Financial Engine.
 *
 * Single source of truth for the "what does the customer see vs. what does
 * APS take vs. what does the mechanic earn" math. ALL commissioned flows
 * read through this module. Never compute commission from gross revenue —
 * always from True Net Profit.
 */

export interface FinancialBreakdown {
  // Customer-visible (invoice)
  laborCents: number;
  partsCents: number;
  taxCents: number;
  customerTotalCents: number;
  // Internal (mechanic + admin only — NEVER returned to customer)
  stripeFeeCents: number;
  netProfitCents: number;
  apsCommissionCents: number;
  mechanicPayoutCents: number;
  commissionRate: number; // 0..1, the platform pct on net profit
  commissionReason: string;
}

export interface ComputeBreakdownInput {
  // Total customer charge in cents (labor + parts + tax). Source of truth
  // is what Stripe captured (or will capture).
  amountCents: number;
  taxCents: number;
  partsCostCents: number; // mechanic-entered actual parts cost (sum of parts_items)
  category: ServiceCategory;
  jobTier: TierKey | null;
  mechanicTier: TierKey | null;
  stripeFeeCents?: number; // 0 if not yet known
  deductStripeFee?: boolean; // default false
}

export function computeBreakdown(input: ComputeBreakdownInput): FinancialBreakdown {
  const amountCents = Math.max(0, Math.round(input.amountCents));
  const taxCents = Math.max(0, Math.round(input.taxCents));
  const partsCents = Math.max(0, Math.round(input.partsCostCents));
  const stripeFeeCents = Math.max(0, Math.round(input.stripeFeeCents ?? 0));

  // Labor revenue = total customer charge minus tax minus parts. Tax is
  // always passed through to the relevant tax authority and NEVER touched
  // by APS. Parts are reimbursed 100% to the mechanic.
  const laborCents = Math.max(0, amountCents - taxCents - partsCents);

  // Commission base = labor revenue minus (optionally) the Stripe fee.
  // Default: APS absorbs Stripe fees out of its own commission share by
  // NOT deducting from the mechanic's net profit (deductStripeFee=false).
  const commissionBaseCents = input.deductStripeFee
    ? Math.max(0, laborCents - stripeFeeCents)
    : laborCents;

  const commission = commissionForJob({
    category: input.category,
    jobTier: input.jobTier ?? "detailer",
    mechanicTier: input.mechanicTier ?? "detailer",
  });

  // splitOnNetProfit handles the "parts pass through 100%" math when given
  // (amount=labor+parts, partsCost=parts). We feed it (amount=commissionBase
  // + parts, partsCost=parts) so the net-profit base equals commissionBase.
  const split = splitOnNetProfit(commissionBaseCents + partsCents, partsCents, commission);
  // mechanic gets (split.mechanicPayoutCents) which already includes parts
  // passthrough. If we deducted the stripe fee from base, add the deducted
  // amount back to nothing — APS effectively absorbed it. Otherwise nothing
  // changes and APS pays Stripe out of its split.
  const apsCommissionCents = split.platformFeeCents;
  const mechanicPayoutCents = split.mechanicPayoutCents;
  const netProfitCents = commissionBaseCents;

  return {
    laborCents,
    partsCents,
    taxCents,
    customerTotalCents: amountCents,
    stripeFeeCents,
    netProfitCents,
    apsCommissionCents,
    mechanicPayoutCents,
    commissionRate: commission.platformPct,
    commissionReason: commission.reason,
  };
}

/** Customer-safe view: strips ALL internal financial data. */
export function customerInvoiceView(b: FinancialBreakdown) {
  return {
    laborCents: b.laborCents,
    partsCents: b.partsCents,
    taxCents: b.taxCents,
    totalCents: b.customerTotalCents,
  };
}
