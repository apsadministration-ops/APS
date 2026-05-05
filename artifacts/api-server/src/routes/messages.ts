import { Router, type IRouter } from "express";
import { eq, asc } from "drizzle-orm";
import { db, messagesTable, jobsTable, usersTable } from "@workspace/db";
import { authenticate, type AuthRequest } from "../middlewares/authenticate";
import { sendPushNotifications } from "../lib/notifications";

const router: IRouter = Router();

router.get("/jobs/:jobId/messages", authenticate, async (req: AuthRequest, res): Promise<void> => {
  const jobId = parseInt(String(req.params.jobId), 10);
  if (isNaN(jobId)) { res.status(400).json({ error: "Invalid job ID" }); return; }

  const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, jobId));
  if (!job) { res.status(404).json({ error: "Job not found" }); return; }

  const isParticipant =
    req.userRole === "admin" ||
    job.customerId === req.userId ||
    job.mechanicId === req.userId;
  if (!isParticipant) { res.status(403).json({ error: "Forbidden" }); return; }

  const rows = await db
    .select({
      id: messagesTable.id,
      jobId: messagesTable.jobId,
      senderId: messagesTable.senderId,
      senderName: usersTable.name,
      senderRole: usersTable.role,
      content: messagesTable.content,
      createdAt: messagesTable.createdAt,
    })
    .from(messagesTable)
    .innerJoin(usersTable, eq(messagesTable.senderId, usersTable.id))
    .where(eq(messagesTable.jobId, jobId))
    .orderBy(asc(messagesTable.createdAt));

  res.json(rows);
});

router.post("/jobs/:jobId/messages", authenticate, async (req: AuthRequest, res): Promise<void> => {
  const jobId = parseInt(String(req.params.jobId), 10);
  if (isNaN(jobId)) { res.status(400).json({ error: "Invalid job ID" }); return; }

  const { content } = req.body as { content: string };
  if (!content?.trim()) { res.status(400).json({ error: "content is required" }); return; }

  const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, jobId));
  if (!job) { res.status(404).json({ error: "Job not found" }); return; }

  const isParticipant = job.customerId === req.userId || job.mechanicId === req.userId || req.userRole === "admin";
  if (!isParticipant) { res.status(403).json({ error: "Forbidden" }); return; }

  const [msg] = await db.insert(messagesTable).values({
    jobId,
    senderId: req.userId!,
    content: content.trim(),
  }).returning();

  const [sender] = await db.select().from(usersTable).where(eq(usersTable.id, req.userId!));

  // Notify the other participant via push (fire-and-forget)
  const recipientId = req.userId === job.customerId ? job.mechanicId : job.customerId;
  if (recipientId) {
    db.select({ pushToken: usersTable.pushToken })
      .from(usersTable)
      .where(eq(usersTable.id, recipientId))
      .then(([recipient]) => {
        const token = recipient?.pushToken;
        if (token?.startsWith("ExponentPushToken[")) {
          sendPushNotifications([{
            to: token,
            title: `Message from ${sender?.name ?? "Unknown"}`,
            body: content.trim().slice(0, 100),
            data: { jobId, screen: "messages" },
            sound: "default",
          }]).catch(() => {});
        }
      })
      .catch(() => {});
  }

  res.status(201).json({
    id: msg.id,
    jobId: msg.jobId,
    senderId: msg.senderId,
    senderName: sender?.name ?? "Unknown",
    senderRole: sender?.role ?? "customer",
    content: msg.content,
    createdAt: msg.createdAt,
  });
});

export default router;
