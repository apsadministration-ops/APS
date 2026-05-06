import { Router, type IRouter, type Response } from "express";
import { eq, desc, and } from "drizzle-orm";
import {
  db,
  vehiclesTable,
  jobsTable,
  workLogsTable,
  ownershipTable,
  usersTable,
} from "@workspace/db";
import { AssistantChatBody } from "@workspace/api-zod";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { authenticate, type AuthRequest } from "../middlewares/authenticate";

const router: IRouter = Router();

const SYSTEM_PROMPT = `You are the APS in-app AI Assistant. APS is a VIN-centric automotive service marketplace that connects vehicle owners with mechanics.

Your job: translate technical automotive information into clear, simple explanations that help non-mechanics understand WHY a repair is needed, WHAT a part does, and HOW URGENT an issue is.

Voice & rules:
- Plain English. Avoid jargon; if you must use a technical term, define it in the same sentence.
- Neutral and informational. Never pressure the user. Never act sales-y.
- You are NOT a diagnostic engine, a pricing authority, or a decision-maker. You explain — the mechanic decides.
- Keep answers tight. 2–5 short paragraphs OR a brief intro + bulleted breakdown. No long essays.
- Use the vehicle context provided when relevant; don't ask for info you already have.
- For SAFETY issues (brakes, steering, tires, suspension control), be direct about urgency.

When asked about a part, briefly cover: what it is, what it does, what failure looks like, why it might have been recommended (use context if available), and an urgency level.

When asked "why do I need this repair?", connect: symptoms → likely cause → what fails next if ignored → mechanic's reasoning.

Always classify urgency when relevant:
- LOW   → routine maintenance, can be scheduled
- MEDIUM → should be repaired soon (weeks, not months)
- HIGH  → safety-critical or breakdown risk; address immediately
Explain WHY you assigned that level.

If the user asks something outside automotive scope (life advice, jokes, code), politely steer back: "I'm here to help with your vehicle and service questions."`;

interface AssistantContext {
  screen?: string;
  vehicleId?: number | null;
  jobId?: number | null;
}

async function loadContextSummary(
  ctx: AssistantContext,
  userId: number,
  userRole: string,
): Promise<string> {
  const parts: string[] = [];

  // Determine vehicleId from jobId if needed.
  // Track whether the vehicle context is authorized for THIS user — mechanics
  // only get vehicle/worklog context for vehicles tied to a job they're
  // assigned to. Customers must own the vehicle. Admins always allowed.
  let vehicleId: number | null = null;
  let vehicleAuthorized = false;
  let jobRow: typeof jobsTable.$inferSelect | null = null;

  if (ctx.jobId) {
    const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, ctx.jobId));
    if (job) {
      // Permission: customer owns it; mechanic is assigned; admin sees all.
      const allowed =
        userRole === "admin" ||
        (userRole === "customer" && job.customerId === userId) ||
        (userRole === "mechanic" && job.mechanicId === userId);
      if (allowed) {
        jobRow = job;
        vehicleId = job.vehicleId;
        // Vehicle context inherits authorization from the job link.
        vehicleAuthorized = true;
      }
    }
  }

  // Only consider an explicit context.vehicleId if a job didn't already
  // resolve one (and validate ownership separately).
  if (!vehicleId && ctx.vehicleId) {
    if (userRole === "admin") {
      vehicleId = ctx.vehicleId;
      vehicleAuthorized = true;
    } else if (userRole === "customer") {
      const [own] = await db
        .select()
        .from(ownershipTable)
        .where(
          and(
            eq(ownershipTable.vehicleId, ctx.vehicleId),
            eq(ownershipTable.userId, userId),
          ),
        );
      if (own) {
        vehicleId = ctx.vehicleId;
        vehicleAuthorized = true;
      }
    } else if (userRole === "mechanic") {
      // Mechanics must have an active/assigned job for that vehicle.
      const [j] = await db
        .select()
        .from(jobsTable)
        .where(
          and(
            eq(jobsTable.vehicleId, ctx.vehicleId),
            eq(jobsTable.mechanicId, userId),
          ),
        )
        .limit(1);
      if (j) {
        vehicleId = ctx.vehicleId;
        vehicleAuthorized = true;
      }
    }
  }

  if (vehicleId && vehicleAuthorized) {
    const [vehicle] = await db
      .select()
      .from(vehiclesTable)
      .where(eq(vehiclesTable.id, vehicleId));

    if (vehicle) {
      {
        parts.push(
          `VEHICLE: ${vehicle.year} ${vehicle.make} ${vehicle.model}` +
            (vehicle.trim ? ` ${vehicle.trim}` : "") +
            (vehicle.color ? ` (${vehicle.color})` : "") +
            ` — VIN ${vehicle.vin}` +
            (vehicle.plateNumber ? `, plate ${vehicle.plateNumber}` : ""),
        );

        // Recent work log history (last 5)
        const recentLogs = await db
          .select()
          .from(workLogsTable)
          .where(eq(workLogsTable.vehicleId, vehicle.id))
          .orderBy(desc(workLogsTable.createdAt))
          .limit(5);

        if (recentLogs.length > 0) {
          const logLines = recentLogs.map((l) => {
            const date = l.createdAt ? new Date(l.createdAt).toISOString().slice(0, 10) : "";
            const partsText = l.partsUsed?.length ? ` [parts: ${l.partsUsed.join(", ")}]` : "";
            return `- ${date} • ${l.serviceCategory}: ${l.serviceDescription} ($${l.totalCost})${partsText}`;
          });
          parts.push(`RECENT SERVICE HISTORY:\n${logLines.join("\n")}`);
        } else {
          parts.push("RECENT SERVICE HISTORY: (none on file)");
        }
      }
    }
  }

  if (jobRow) {
    const lines = [
      `JOB: #${jobRow.id} (${jobRow.status})`,
      `Type: ${jobRow.jobType}`,
      `Description: ${jobRow.description}`,
    ];
    if (jobRow.estimatedPrice != null) lines.push(`Estimated price: $${jobRow.estimatedPrice}`);
    if (jobRow.finalPrice != null) lines.push(`Final price: $${jobRow.finalPrice}`);

    // Pull this job's work log if completed
    const [jobLog] = await db
      .select()
      .from(workLogsTable)
      .where(eq(workLogsTable.jobId, jobRow.id))
      .limit(1);
    if (jobLog) {
      lines.push(`Work performed: ${jobLog.serviceDescription}`);
      if (jobLog.partsUsed?.length) lines.push(`Parts used: ${jobLog.partsUsed.join(", ")}`);
      if (jobLog.notes) lines.push(`Mechanic notes: ${jobLog.notes}`);
      lines.push(`Labor: $${jobLog.laborCost} • Parts: $${jobLog.partsCost} • Total: $${jobLog.totalCost}`);
    }

    if (jobRow.mechanicId) {
      const [mech] = await db
        .select({ name: usersTable.name, tier: usersTable.mechanicTier })
        .from(usersTable)
        .where(eq(usersTable.id, jobRow.mechanicId));
      if (mech) lines.push(`Mechanic: ${mech.name}${mech.tier ? ` (${mech.tier})` : ""}`);
    }

    parts.push(lines.join("\n"));
  }

  if (ctx.screen) parts.unshift(`SCREEN: ${ctx.screen}`);
  parts.unshift(`USER ROLE: ${userRole}`);

  return parts.join("\n\n");
}

function detectUrgency(reply: string): "low" | "medium" | "high" | null {
  const upper = reply.toUpperCase();
  // Look for an explicit "URGENCY: HIGH" style marker first, then any standalone keyword.
  const explicit = upper.match(/URGENCY[:\s-]+\s*(HIGH|MEDIUM|LOW)/);
  if (explicit) return explicit[1].toLowerCase() as "low" | "medium" | "high";
  if (/\bHIGH\b.*URGENC|URGENC.*\bHIGH\b|SAFETY[- ]CRITICAL|IMMEDIATELY|BREAKDOWN RISK/.test(upper))
    return "high";
  if (/\bMEDIUM\b.*URGENC|URGENC.*\bMEDIUM\b|SOON/.test(upper)) return "medium";
  if (/\bLOW\b.*URGENC|URGENC.*\bLOW\b|ROUTINE MAINTENANCE/.test(upper)) return "low";
  return null;
}

router.post(
  "/assistant/chat",
  authenticate,
  async (req: AuthRequest, res: Response): Promise<void> => {
    const parsed = AssistantChatBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const { message, history = [], context } = parsed.data;

    let contextSummary = "";
    try {
      contextSummary = await loadContextSummary(
        {
          screen: context?.screen,
          vehicleId: context?.vehicleId ?? null,
          jobId: context?.jobId ?? null,
        },
        req.userId!,
        req.userRole!,
      );
    } catch (err) {
      req.log.warn({ err }, "Failed to load assistant context");
    }

    const systemPrompt = contextSummary
      ? `${SYSTEM_PROMPT}\n\n--- CURRENT CONTEXT ---\n${contextSummary}`
      : SYSTEM_PROMPT;

    const messages = [
      ...history.slice(-12).map((m) => ({ role: m.role, content: m.content })),
      { role: "user" as const, content: message },
    ];

    try {
      const result = await anthropic.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 1024,
        system: systemPrompt,
        messages,
      });

      const text = result.content
        .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();

      const reply = text || "I couldn't generate a response. Please try rephrasing your question.";
      res.json({ reply, urgency: detectUrgency(reply) });
    } catch (err) {
      req.log.error({ err }, "Assistant chat failed");
      res.status(500).json({ error: "Assistant is temporarily unavailable. Please try again." });
    }
  },
);

export default router;
