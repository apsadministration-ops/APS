/**
 * Video-generation stub adapter.
 *
 * Registered so the engine + UI surface video capabilities and so the
 * "configure later" admin error is consistent with other unconfigured
 * providers (Stripe Connect, suppliers, etc.). Real implementations
 * (Runway, Pika, Google Veo, OpenAI Sora) plug in via the same
 * `MediaProvider` interface — no engine changes required.
 */
import {
  MediaProviderNotConfiguredError,
  type MediaProvider,
} from "./types";

export const videoStubProvider: MediaProvider = {
  key: "video-stub",
  label: "AI Video (not configured)",
  capabilities: { image: false, video: true },
  isConfigured(): boolean {
    return false;
  },
  async generateImage(): Promise<never> {
    throw new MediaProviderNotConfiguredError(
      "video-stub",
      "Video stub adapter cannot generate images.",
    );
  },
  async generateVideo(): Promise<never> {
    throw new MediaProviderNotConfiguredError(
      "video-stub",
      "No video provider is connected yet. Wire up Runway / Pika / Google Veo / OpenAI Sora via the MediaProvider interface to enable video generation.",
    );
  },
};
