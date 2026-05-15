/**
 * Posting-provider abstraction. One adapter per social platform. The
 * publishing engine never imports a platform SDK directly — adapters plug
 * in via this interface and can be swapped out without touching the engine
 * or routes.
 */
import type { SocialPost } from "@workspace/db";

export type PostingPlatform = "facebook" | "instagram" | "tiktok" | "twitter";

export interface PublishRequest {
  post: SocialPost;
  /** Public URLs (already proxy-served) of any approved media assets. */
  mediaUrls: string[];
}

export interface PublishResult {
  externalUrl: string;
  externalId: string;
  meta?: Record<string, unknown>;
}

export class PostingProviderNotConfiguredError extends Error {
  constructor(public platform: PostingPlatform, message?: string) {
    super(message ?? `Posting provider for "${platform}" is not configured.`);
    this.name = "PostingProviderNotConfiguredError";
  }
}

export class PostingProviderError extends Error {
  constructor(public platform: PostingPlatform, message: string, public cause?: unknown) {
    super(message);
    this.name = "PostingProviderError";
  }
}

export interface PostingProvider {
  readonly platform: PostingPlatform;
  readonly label: string;
  isConfigured(): boolean;
  publish(req: PublishRequest): Promise<PublishResult>;
}
