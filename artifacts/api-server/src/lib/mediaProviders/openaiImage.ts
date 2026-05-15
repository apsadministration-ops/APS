/**
 * OpenAI gpt-image-1 adapter.
 *
 * Uses the Replit AI Integrations OpenAI proxy — no API key required from
 * the user. Falls back to `MediaProviderNotConfiguredError` if the
 * integration isn't connected.
 *
 * gpt-image-1 supports these sizes today: 1024x1024 (square),
 * 1536x1024 (landscape), 1024x1536 (portrait). 9:16 vertical reels are
 * approximated with 1024x1536 (a 2:3 portrait) — the closest officially
 * supported aspect.
 */
import { getOpenAI, isOpenAIConfigured } from "@workspace/integrations-openai-ai";
import {
  MediaProviderError,
  MediaProviderNotConfiguredError,
  type GenerateImageRequest,
  type GeneratedImage,
  type MediaProvider,
} from "./types";

const MODEL = "gpt-image-1";

function sizeFor(req: GenerateImageRequest): { size: "1024x1024" | "1536x1024" | "1024x1536"; w: number; h: number } {
  switch (req.aspectRatio) {
    case "1:1":  return { size: "1024x1024", w: 1024, h: 1024 };
    case "16:9":
    case "4:3":  return { size: "1536x1024", w: 1536, h: 1024 };
    case "9:16":
    case "3:4":  return { size: "1024x1536", w: 1024, h: 1536 };
  }
}

export const openaiImageProvider: MediaProvider = {
  key: "openai-image",
  label: "OpenAI gpt-image-1",
  capabilities: { image: true, video: false },

  isConfigured() {
    return isOpenAIConfigured();
  },

  async generateImage(req: GenerateImageRequest): Promise<GeneratedImage> {
    let client;
    try {
      client = getOpenAI();
    } catch {
      throw new MediaProviderNotConfiguredError(
        this.key,
        "Connect the Replit OpenAI integration to enable image generation.",
      );
    }

    const { size, w, h } = sizeFor(req);
    const fullPrompt = req.negativePrompt
      ? `${req.prompt}\n\nAvoid: ${req.negativePrompt}`
      : req.prompt;

    let result;
    try {
      result = await client.images.generate({
        model: MODEL,
        prompt: fullPrompt,
        size,
        n: 1,
      });
    } catch (err) {
      throw new MediaProviderError(
        this.key,
        err instanceof Error ? err.message : "OpenAI image generation failed",
        err,
      );
    }

    const data = result.data?.[0];
    const b64 = data?.b64_json;
    if (!b64) {
      throw new MediaProviderError(this.key, "OpenAI returned no image data");
    }

    return {
      pngBytes: Buffer.from(b64, "base64"),
      width: w,
      height: h,
      model: MODEL,
      meta: {
        revisedPrompt: data.revised_prompt ?? null,
      },
    };
  },
};
