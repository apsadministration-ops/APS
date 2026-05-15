/**
 * Media-provider registry. Imported once at server boot; routes look up
 * adapters by key (e.g. when re-generating a specific asset).
 */
import { openaiImageProvider } from "./openaiImage";
import { videoStubProvider } from "./videoStub";
import type { MediaProvider } from "./types";

const providers = new Map<string, MediaProvider>();

export function registerMediaProvider(p: MediaProvider): void {
  providers.set(p.key, p);
}

export function getMediaProvider(key: string): MediaProvider | undefined {
  return providers.get(key);
}

export function listMediaProviders(): MediaProvider[] {
  return Array.from(providers.values());
}

/** Default provider for image generation. First configured image-capable adapter. */
export function defaultImageProvider(): MediaProvider | undefined {
  for (const p of providers.values()) {
    if (p.capabilities.image && p.isConfigured()) return p;
  }
  // Fall back to the first image-capable provider even if unconfigured, so
  // routes can return a clean "not configured" error rather than 404.
  for (const p of providers.values()) {
    if (p.capabilities.image) return p;
  }
  return undefined;
}

/** Default provider for video generation. First configured video-capable adapter. */
export function defaultVideoProvider(): MediaProvider | undefined {
  for (const p of providers.values()) {
    if (p.capabilities.video && p.isConfigured() && p.generateVideo) return p;
  }
  for (const p of providers.values()) {
    if (p.capabilities.video) return p;
  }
  return undefined;
}

export function initMediaProviders(): void {
  registerMediaProvider(openaiImageProvider);
  registerMediaProvider(videoStubProvider);
}
