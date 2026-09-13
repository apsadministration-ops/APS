import { logger } from "./logger";

interface ExpoPushMessage {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  sound?: "default" | null;
  badge?: number;
}

export const PUSH_REQUEST_TIMEOUT_MS = 8_000;

/**
 * Resolve business-facing identity only from the complete Part 6 source link.
 * This keeps the notification recipient (the human primary owner) unchanged
 * while preventing an owner's personal name from being presented as the
 * business on commercial jobs. The dynamic import keeps transport-only
 * notification tests independent from the database.
 */
async function commercialBusinessDisplayName(jobId: number): Promise<string | null> {
  try {
    const { and, eq } = await import("drizzle-orm");
    const {
      db,
      jobsTable,
      partnerOrganizationsTable,
      partnerServiceRequestsTable,
    } = await import("@workspace/db");
    const [row] = await db
      .select({
        name: partnerOrganizationsTable.name,
        legalName: partnerOrganizationsTable.legalName,
      })
      .from(jobsTable)
      .innerJoin(
        partnerOrganizationsTable,
        eq(
          partnerOrganizationsTable.id,
          jobsTable.sourceOrganizationId,
        ),
      )
      .innerJoin(
        partnerServiceRequestsTable,
        and(
          eq(
            partnerServiceRequestsTable.id,
            jobsTable.sourceServiceRequestId,
          ),
          eq(
            partnerServiceRequestsTable.organizationId,
            partnerOrganizationsTable.id,
          ),
          eq(partnerServiceRequestsTable.linkedApsJobId, jobsTable.id),
        ),
      )
      .where(eq(jobsTable.id, jobId));
    return row?.name || row?.legalName || null;
  } catch {
    // Notification delivery is best-effort. If the lookup cannot run, callers
    // retain the ordinary customer wording rather than disclosing a contact.
    return null;
  }
}

export async function sendPushNotifications(messages: ExpoPushMessage[]): Promise<void> {
  const validMessages = messages.filter((message) => message.to.startsWith("ExponentPushToken["));
  if (validMessages.length === 0) return;

  // Chunk into batches of 100 (Expo limit)
  const chunks: ExpoPushMessage[][] = [];
  for (let i = 0; i < validMessages.length; i += 100) {
    chunks.push(validMessages.slice(i, i + 100));
  }

  for (const chunk of chunks) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PUSH_REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch("https://exp.host/--/api/v2/push/send", {
        method: "POST",
        headers: {
          "Accept": "application/json",
          "Accept-Encoding": "gzip, deflate",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(chunk),
        signal: controller.signal,
      });
      if (!response.ok) {
        logger.warn({
          chunkSize: chunk.length,
          statusCode: response.status,
        }, "Push notification provider returned a non-success response");
        continue;
      }

      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        logger.warn({ chunkSize: chunk.length }, "Push notification provider returned invalid JSON");
        continue;
      }
      const tickets = payload && typeof payload === "object" && "data" in payload
        ? (payload as { data?: unknown }).data
        : null;
      if (!Array.isArray(tickets) || tickets.length !== chunk.length) {
        logger.warn({
          chunkSize: chunk.length,
          ticketCount: Array.isArray(tickets) ? tickets.length : 0,
        }, "Push notification provider returned an invalid ticket payload");
        continue;
      }
      const ticketErrors = tickets.filter((ticket) =>
        ticket && typeof ticket === "object" && (ticket as { status?: unknown }).status === "error",
      ).length;
      if (ticketErrors > 0) {
        logger.warn({
          chunkSize: chunk.length,
          ticketErrors,
        }, "Push notification provider reported ticket errors");
      }
    } catch (err) {
      logger.warn({
        chunkSize: chunk.length,
        errorName: err instanceof Error ? err.name : "UnknownError",
        timedOut: controller.signal.aborted,
      }, "Push notification delivery failed");
    } finally {
      clearTimeout(timeout);
    }
  }
}

export async function notifyMechanics(
  tokens: string[],
  jobType: string,
  description: string,
  jobId: number,
): Promise<void> {
  const validTokens = tokens.filter((t) => t.startsWith("ExponentPushToken["));
  await sendPushNotifications(
    validTokens.map((to) => ({
      to,
      title: "New Job Available",
      body: `${jobType.charAt(0).toUpperCase() + jobType.slice(1)}: ${description.slice(0, 80)}${description.length > 80 ? "…" : ""}`,
      data: { jobId, screen: "available" },
      sound: "default",
    })),
  );
}

export async function notifyCustomerJobComplete(
  token: string,
  vehicleName: string,
  totalCost: number,
  jobId: number,
): Promise<void> {
  if (!token.startsWith("ExponentPushToken[")) return;
  const businessName = await commercialBusinessDisplayName(jobId);
  await sendPushNotifications([
    {
      to: token,
      title: businessName ? `${businessName} — Service Complete` : "Service Complete",
      body: businessName
        ? `${businessName}: your ${vehicleName} has been serviced. Total: $${totalCost.toFixed(2)}.`
        : `Your ${vehicleName} has been serviced. Total: $${totalCost.toFixed(2)}.`,
      data: { jobId, screen: "job" },
      sound: "default",
    },
  ]);
}

export async function notifyCustomerJobAccepted(
  token: string,
  mechanicName: string,
  vehicleName: string,
  jobId: number,
): Promise<void> {
  if (!token.startsWith("ExponentPushToken[")) return;
  const businessName = await commercialBusinessDisplayName(jobId);
  await sendPushNotifications([
    {
      to: token,
      title: businessName ? `${businessName} — Mechanic En Route` : "Mechanic En Route",
      body: businessName
        ? `${mechanicName} accepted ${businessName}'s job for ${vehicleName}.`
        : `${mechanicName} accepted your job for ${vehicleName}.`,
      data: { jobId, screen: "job" },
      sound: "default",
    },
  ]);
}

/**
 * Trust-system notifications. The customer must approve a candidate mechanic
 * within 60s, otherwise the system auto-approves. The mechanic gets a separate
 * notification once the customer responds.
 */
export async function notifyCustomerApprovalPending(
  token: string,
  mechanicName: string,
  jobId: number,
): Promise<void> {
  if (!token.startsWith("ExponentPushToken[")) return;
  const businessName = await commercialBusinessDisplayName(jobId);
  await sendPushNotifications([
    {
      to: token,
      title: businessName
        ? `Approve ${businessName} mechanic — 60s`
        : "Approve your mechanic — 60s",
      body: businessName
        ? `${mechanicName} wants to take ${businessName}'s job. Tap to review and approve.`
        : `${mechanicName} wants to take your job. Tap to review and approve.`,
      data: { jobId, screen: "approve" },
      sound: "default",
    },
  ]);
}

export async function notifyMechanicApprovalDeclined(
  token: string,
  jobId: number,
  reason?: string | null,
): Promise<void> {
  if (!token.startsWith("ExponentPushToken[")) return;
  await sendPushNotifications([
    {
      to: token,
      title: "Customer chose another mechanic",
      body: reason ? `Reason: ${reason.slice(0, 120)}` : "The job has been put back on the board.",
      data: { jobId, screen: "available" },
      sound: "default",
    },
  ]);
}

export async function notifyMechanicApprovalAccepted(
  token: string,
  jobId: number,
): Promise<void> {
  if (!token.startsWith("ExponentPushToken[")) return;
  await sendPushNotifications([
    {
      to: token,
      title: "Approved — go for it",
      body: "The customer approved you. Head to the job.",
      data: { jobId, screen: "job" },
      sound: "default",
    },
  ]);
}

/* -------------------------------------------------------------------------- */
/* Payout / dispute / tip notifications                                       */
/* -------------------------------------------------------------------------- */

export async function notifyCustomerWorkAwaitingConfirmation(
  token: string,
  vehicleName: string,
  jobId: number,
): Promise<void> {
  if (!token.startsWith("ExponentPushToken[")) return;
  const businessName = await commercialBusinessDisplayName(jobId);
  await sendPushNotifications([{
    to: token,
    title: businessName
      ? `Confirm ${businessName} work — 24h`
      : "Confirm completed work — 24h",
    body: businessName
      ? `Tap to approve the work on ${businessName}'s ${vehicleName} or open a dispute.`
      : `Tap to approve the work on your ${vehicleName} or open a dispute.`,
    data: { jobId, screen: "confirm-work" },
    sound: "default",
  }]);
}

export async function notifyMechanicWorkUnderReview(
  token: string, jobId: number,
): Promise<void> {
  if (!token.startsWith("ExponentPushToken[")) return;
  await sendPushNotifications([{
    to: token,
    title: "Work submitted — 24h customer review",
    body: "Funds will release after the customer confirms or 24 hours pass.",
    data: { jobId, screen: "payouts" },
    sound: "default",
  }]);
}

export async function notifyMechanicPayoutInitiated(
  token: string, jobId: number, amount: number,
): Promise<void> {
  if (!token.startsWith("ExponentPushToken[")) return;
  await sendPushNotifications([{
    to: token,
    title: "Payout on the way",
    body: `$${amount.toFixed(2)} captured for Job #${jobId}. Heading to your bank.`,
    data: { jobId, screen: "payouts" },
    sound: "default",
  }]);
}

export async function notifyMechanicPayoutCompleted(
  token: string, amount: number,
): Promise<void> {
  if (!token.startsWith("ExponentPushToken[")) return;
  await sendPushNotifications([{
    to: token,
    title: "Payout arrived",
    body: `$${amount.toFixed(2)} just landed in your bank account.`,
    data: { screen: "payouts" },
    sound: "default",
  }]);
}

export async function notifyMechanicPayoutFailed(
  token: string, jobId: number,
): Promise<void> {
  if (!token.startsWith("ExponentPushToken[")) return;
  await sendPushNotifications([{
    to: token,
    title: "Payout failed",
    body: jobId
      ? `Your payout for Job #${jobId} couldn't be sent. Tap for details.`
      : "A recent payout couldn't be sent. Tap for details.",
    data: { jobId, screen: "payouts" },
    sound: "default",
  }]);
}

export async function notifyMechanicDisputeOpened(
  token: string, jobId: number, reason?: string | null,
): Promise<void> {
  if (!token.startsWith("ExponentPushToken[")) return;
  await sendPushNotifications([{
    to: token,
    title: "Customer opened a dispute",
    body: reason ? `Reason: ${reason.slice(0, 120)}` : `Job #${jobId} payout is on hold pending review.`,
    data: { jobId, screen: "payouts" },
    sound: "default",
  }]);
}

export async function notifyMechanicDisputeResolved(
  token: string, jobId: number, mechanicWon: boolean,
): Promise<void> {
  if (!token.startsWith("ExponentPushToken[")) return;
  await sendPushNotifications([{
    to: token,
    title: mechanicWon ? "Dispute resolved in your favor" : "Dispute resolved",
    body: mechanicWon
      ? `Job #${jobId} payout will release shortly.`
      : `Job #${jobId} dispute closed. Tap for details.`,
    data: { jobId, screen: "payouts" },
    sound: "default",
  }]);
}

export async function notifyMechanicTipReceived(
  token: string, jobId: number, amount: number,
): Promise<void> {
  if (!token.startsWith("ExponentPushToken[")) return;
  await sendPushNotifications([{
    to: token,
    title: "You got a tip",
    body: `$${amount.toFixed(2)} on Job #${jobId} — 100% yours.`,
    data: { jobId, screen: "payouts" },
    sound: "default",
  }]);
}

export async function notifyAdminDispute(
  token: string, jobId: number, reason?: string | null,
): Promise<void> {
  if (!token.startsWith("ExponentPushToken[")) return;
  await sendPushNotifications([{
    to: token,
    title: "Dispute opened",
    body: reason ? `Job #${jobId}: ${reason.slice(0, 100)}` : `Job #${jobId} needs review.`,
    data: { jobId, screen: "disputes" },
    sound: "default",
  }]);
}
