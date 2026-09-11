export type ForgotPasswordOutcome = "success" | "rate-limited" | "error";

/**
 * The forgot-password endpoint intentionally uses a generic response for
 * every accepted email.  Only a 2xx response is an accepted request; treating
 * every non-429 response as success would show a false confirmation on 400/500.
 */
export function classifyForgotPasswordResponse(status: number): ForgotPasswordOutcome {
  if (status >= 200 && status < 300) return "success";
  if (status === 429) return "rate-limited";
  return "error";
}