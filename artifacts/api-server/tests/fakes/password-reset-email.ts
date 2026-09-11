export async function sendEmail(args: Record<string, any>): Promise<{ ok: true }> {
  const state = (globalThis as any).__passwordResetTestState;
  state.emails.push({ ...args });
  return { ok: true };
}