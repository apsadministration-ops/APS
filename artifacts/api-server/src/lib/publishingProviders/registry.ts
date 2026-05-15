import { facebookStub, instagramStub, tiktokStub, twitterStub } from "./stubs";
import type { PostingPlatform, PostingProvider } from "./types";

const providers = new Map<PostingPlatform, PostingProvider>();

export function registerPostingProvider(p: PostingProvider): void {
  providers.set(p.platform, p);
}

export function getPostingProvider(platform: PostingPlatform): PostingProvider | undefined {
  return providers.get(platform);
}

export function listPostingProviders(): PostingProvider[] {
  return Array.from(providers.values());
}

export function initPostingProviders(): void {
  registerPostingProvider(facebookStub);
  registerPostingProvider(instagramStub);
  registerPostingProvider(tiktokStub);
  registerPostingProvider(twitterStub);
}
