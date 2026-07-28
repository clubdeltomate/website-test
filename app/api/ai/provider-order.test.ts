import { describe, it, expect } from "vitest";
import { orderForDiversity, type ResolvedKey } from "./provider.js";

const key = (
  provider: ResolvedKey["provider"],
  source: ResolvedKey["source"],
  baseUrl?: string,
): ResolvedKey => ({ provider, source, baseUrl, apiKey: "k" });

const label = (k: ResolvedKey) => `${k.provider}${k.baseUrl ? `@${k.baseUrl}` : ""}/${k.source}`;

describe("orderForDiversity", () => {
  /**
   * The failure this exists to prevent: a deck can only afford two tries, and
   * both were spent on Gemini because a platform key and an env key for the
   * same API sat at the top. Gemini was slow, both timed out, and Grok —
   * configured and healthy — was never asked.
   */
  it("does not let one service occupy both of a two-try budget", () => {
    const candidates = [
      key("gemini", "platform"),
      key("gemini", "env"),
      key("openai", "env", "https://api.x.ai/v1"), // Grok
      key("anthropic", "env"),
    ];
    const firstTwo = orderForDiversity(candidates).slice(0, 2).map(label);
    expect(firstTwo).toEqual(["gemini/platform", "openai@https://api.x.ai/v1/env"]);
  });

  it("keeps OpenAI-protocol providers apart by endpoint, not by provider id", () => {
    // Grok, DeepSeek, Kimi and OpenRouter all report provider "openai" —
    // grouping on that alone would collapse four distinct APIs into one.
    const candidates = [
      key("openai", "env", "https://api.x.ai/v1"),
      key("openai", "env", "https://api.deepseek.com/v1"),
      key("openai", "env", "https://api.moonshot.ai/v1"),
    ];
    expect(orderForDiversity(candidates).map(label)).toEqual(candidates.map(label));
  });

  it("keeps duplicate keys, just behind every distinct service", () => {
    const candidates = [
      key("gemini", "byok"),
      key("gemini", "platform"),
      key("gemini", "env"),
      key("anthropic", "env"),
    ];
    expect(orderForDiversity(candidates).map(label)).toEqual([
      "gemini/byok",
      "anthropic/env",
      "gemini/platform",
      "gemini/env",
    ]);
  });

  it("preserves priority order when every candidate is already distinct", () => {
    const candidates = [key("gemini", "byok"), key("anthropic", "env"), key("openai", "env")];
    expect(orderForDiversity(candidates).map(label)).toEqual(candidates.map(label));
  });
});
