import OpenAI from "openai";

/**
 * Lazy-initialised OpenAI client backed by the Replit AI Integrations proxy.
 *
 * Unlike the Anthropic lib which throws on module import, this one defers the
 * throw so the API server can boot without the OpenAI integration connected.
 * Callers should `try { getOpenAI() } catch (e) { ... }` and surface a clean
 * "provider_not_configured" error to the user.
 */
export class OpenAINotConfiguredError extends Error {
  constructor() {
    super(
      "OpenAI AI integration is not connected. Ask the user to connect the " +
      "Replit OpenAI integration to enable image generation.",
    );
    this.name = "OpenAINotConfiguredError";
  }
}

let _client: OpenAI | null = null;

export function isOpenAIConfigured(): boolean {
  return Boolean(
    process.env.AI_INTEGRATIONS_OPENAI_API_KEY &&
    process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
  );
}

export function getOpenAI(): OpenAI {
  if (_client) return _client;
  if (!isOpenAIConfigured()) {
    throw new OpenAINotConfiguredError();
  }
  _client = new OpenAI({
    apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY!,
    baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL!,
  });
  return _client;
}
