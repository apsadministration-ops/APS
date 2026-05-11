interface ExpoPushMessage {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  sound?: "default" | null;
  badge?: number;
}

export async function sendPushNotifications(messages: ExpoPushMessage[]): Promise<void> {
  if (messages.length === 0) return;

  // Chunk into batches of 100 (Expo limit)
  const chunks: ExpoPushMessage[][] = [];
  for (let i = 0; i < messages.length; i += 100) {
    chunks.push(messages.slice(i, i + 100));
  }

  for (const chunk of chunks) {
    try {
      await fetch("https://exp.host/--/api/v2/push/send", {
        method: "POST",
        headers: {
          "Accept": "application/json",
          "Accept-Encoding": "gzip, deflate",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(chunk),
      });
    } catch (err) {
      // Non-fatal — notifications are best-effort
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
  await sendPushNotifications([
    {
      to: token,
      title: "Service Complete",
      body: `Your ${vehicleName} has been serviced. Total: $${totalCost.toFixed(2)}.`,
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
  await sendPushNotifications([
    {
      to: token,
      title: "Mechanic En Route",
      body: `${mechanicName} accepted your job for ${vehicleName}.`,
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
  await sendPushNotifications([
    {
      to: token,
      title: "Approve your mechanic — 60s",
      body: `${mechanicName} wants to take your job. Tap to review and approve.`,
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
