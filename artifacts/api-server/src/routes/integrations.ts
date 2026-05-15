/**
 * Admin Integrations API — surface and configure external-service
 * credentials (OpenAI BYO key + the four social platforms) without ever
 * returning a plaintext value to the client.
 *
 *   GET    /admin/growth/integrations        — grouped status (no values)
 *   PUT    /admin/growth/integrations/:key   — { value: string } → saves encrypted
 *   DELETE /admin/growth/integrations/:key   — clear the stored value (env fallback may still apply)
 */
import { Router, type IRouter } from "express";
import { z } from "zod";
import { authenticate, requireRole, type AuthRequest } from "../middlewares/authenticate";
import {
  listIntegrationStatus,
  setCredential,
  deleteCredential,
} from "../lib/credentialStore";
import { findCredentialDef } from "../lib/integrationCatalog";

const router: IRouter = Router();

router.use("/admin/growth/integrations", authenticate, requireRole("admin"));

router.get("/admin/growth/integrations", async (_req, res): Promise<void> => {
  const groups = await listIntegrationStatus();
  res.json({ groups });
});

const setSchema = z.object({ value: z.string().min(1).max(4096) });

router.put("/admin/growth/integrations/:key", async (req: AuthRequest, res): Promise<void> => {
  const key = String(req.params.key);
  const def = findCredentialDef(key);
  if (!def) { res.status(404).json({ error: "Unknown credential key" }); return; }
  const parsed = setSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", issues: parsed.error.issues });
    return;
  }
  try {
    await setCredential(key, parsed.data.value, req.user?.id ?? null);
  } catch (err) {
    req.log?.error({ err, key }, "setCredential failed");
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to save credential" });
    return;
  }
  res.json({ ok: true, key });
});

router.delete("/admin/growth/integrations/:key", async (req: AuthRequest, res): Promise<void> => {
  const key = String(req.params.key);
  const def = findCredentialDef(key);
  if (!def) { res.status(404).json({ error: "Unknown credential key" }); return; }
  await deleteCredential(key);
  res.json({ ok: true, key });
});

export default router;
