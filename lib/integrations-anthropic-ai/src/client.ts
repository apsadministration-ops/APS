import Anthropic from "@anthropic-ai/sdk";

/**
 * The Anthropic integration is optional for the API server. Keep the export
 * shape compatible with the SDK, but defer client construction until a caller
 * actually attempts an AI operation. This prevents an optional provider from
 * taking down unrelated routes during module loading.
 */
export class AnthropicUnavailableError extends Error {
  readonly code = "anthropic_provider_unavailable";
  readonly statusCode = 503;

  constructor() {
    super("Anthropic AI is not configured.");
    this.name = "AnthropicUnavailableError";
  }
}

function isValidBaseUrl(value: string | undefined): value is string {
  if (!value?.trim()) return false;
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    const deployment = process.env.REPLIT_DEPLOYMENT?.trim().toLowerCase();
    const production =
      process.env.NODE_ENV?.trim().toLowerCase() === "production" ||
      Boolean(deployment && deployment !== "0" && deployment !== "false");
    const isLoopback = ["localhost", "127.0.0.1", "::1"].includes(hostname);
    if (url.protocol === "http:" && (production || !isLoopback)) return false;
    return (
      (url.protocol === "https:" || url.protocol === "http:") &&
      hostname.length > 0 &&
      hostname !== "undefined" &&
      hostname !== "null" &&
      !hostname.includes("undefined")
    );
  } catch {
    return false;
  }
}

export function isAnthropicConfigured(): boolean {
  return Boolean(
    process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY?.trim() &&
      isValidBaseUrl(process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL),
  );
}

let client: Anthropic | null = null;
let clientConfigKey: string | null = null;

function getAnthropicClient(): Anthropic {
  const apiKey = process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY?.trim();
  const baseURL = process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL?.trim();
  if (!apiKey || !isValidBaseUrl(baseURL)) {
    throw new AnthropicUnavailableError();
  }

  // Recreate the lazy client if an isolated test or a deployment-side
  // configuration refresh changes either provider setting.
  const configKey = `${apiKey}\u0000${baseURL}`;
  if (!client || clientConfigKey !== configKey) {
    client = new Anthropic({ apiKey, baseURL });
    clientConfigKey = configKey;
  }
  return client;
}

/**
 * Preserve the SDK-compatible `anthropic.messages.create(...)` consumer API.
 * Any property access that would use the provider first validates readiness,
 * so missing optional credentials become an explicit 503-class error rather
 * than a startup crash or a fabricated response.
 */
export const anthropic = new Proxy({} as Anthropic, {
  get(_target, property) {
    const configuredClient = getAnthropicClient();
    const value = Reflect.get(configuredClient, property);
    return typeof value === "function" ? value.bind(configuredClient) : value;
  },
});
