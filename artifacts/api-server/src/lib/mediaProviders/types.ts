/**
 * Provider-agnostic media generation interface.
 *
 * Adding OpenAI / Runway / Pika / Kling / Luma is a matter of writing a new
 * adapter that implements `MediaProvider`. The rest of the engine (engine,
 * routes, UI, DB) never imports a provider SDK directly.
 */

export type AspectRatio = "1:1" | "9:16" | "16:9" | "4:3" | "3:4";

export type MediaIntent =
  | "square_feed"
  | "vertical_reel"
  | "landscape_header"
  | "thumbnail"
  | "generic";

export interface GenerateImageRequest {
  prompt: string;
  negativePrompt?: string;
  aspectRatio: AspectRatio;
  /** Optional caller-supplied seed for reproducibility (provider may ignore). */
  seed?: number;
}

export interface GeneratedImage {
  /** Raw PNG bytes — the engine handles persisting them. */
  pngBytes: Buffer;
  width: number;
  height: number;
  /** Provider model id, e.g. "gpt-image-1". */
  model: string;
  /** Free-form metadata to stamp on the asset row. */
  meta: Record<string, unknown>;
}

export interface GenerateVideoRequest {
  prompt: string;
  negativePrompt?: string;
  aspectRatio: AspectRatio;
  /** Duration hint in seconds (provider clamps to its own limits). */
  durationSeconds?: number;
  seed?: number;
}

export interface GeneratedVideo {
  /** Raw MP4 bytes — the engine handles persisting them. */
  mp4Bytes: Buffer;
  width: number;
  height: number;
  durationSeconds: number;
  model: string;
  meta: Record<string, unknown>;
}

export class MediaProviderNotConfiguredError extends Error {
  constructor(public providerKey: string, message?: string) {
    super(message ?? `Media provider "${providerKey}" is not configured.`);
    this.name = "MediaProviderNotConfiguredError";
  }
}

export class MediaProviderError extends Error {
  constructor(public providerKey: string, message: string, public cause?: unknown) {
    super(message);
    this.name = "MediaProviderError";
  }
}

export interface MediaProvider {
  /** Stable identifier persisted on the asset row. */
  readonly key: string;
  /** Human label for admin UI. */
  readonly label: string;
  /** Capabilities this adapter supports today. */
  readonly capabilities: {
    image: boolean;
    video: boolean;
  };
  /** True if env / connection is wired up. Cheap to call. */
  isConfigured(): boolean;
  /** Generate a single image. Throws `MediaProviderNotConfiguredError` if not configured. */
  generateImage(req: GenerateImageRequest): Promise<GeneratedImage>;
  /**
   * Generate a single short video clip. Optional — providers that don't
   * support video should leave this undefined; the engine will then surface
   * a clean "no video provider configured" error.
   */
  generateVideo?(req: GenerateVideoRequest): Promise<GeneratedVideo>;
}
