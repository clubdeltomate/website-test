import { describe, expect, it } from "vitest";
import { aiUnavailableMessage } from "./routers/generate.js";

/**
 * A generation can fail because nobody answered, or because somebody answered
 * with something unusable. They need different messages, because they need
 * different fixes — and telling someone whose keys work perfectly to go and
 * check their keys sends them to the one place that has nothing wrong with it.
 */
describe("aiUnavailableMessage", () => {
  it("falls back to the key advice when nothing is known", () => {
    const msg = aiUnavailableMessage([], []);
    expect(msg).toContain("no AI provider produced content");
    expect(msg).toContain("GEMINI_API_KEY");
    expect(msg).not.toContain("Providers tried");
  });

  it("names each provider that refused", () => {
    const msg = aiUnavailableMessage(["gemini: 429 rate limit", "openai: 401 invalid key"]);
    expect(msg).toContain("no AI provider produced content");
    expect(msg).toContain("Providers tried — gemini: 429 rate limit | openai: 401 invalid key");
  });

  it("says the keys are FINE when a provider replied but its deck was unusable", () => {
    const msg = aiUnavailableMessage([], ['attempt 1 via openai: [{"path":["slides",0,"components"]}]']);
    // The headline must not send someone to check working credentials.
    expect(msg).toContain("the AI replied but its deck could not be read");
    expect(msg).toContain("Your API keys are working");
    expect(msg).not.toContain("GEMINI_API_KEY");
    // And it must carry the reason the deck was rejected.
    expect(msg).toContain("A provider DID reply");
    expect(msg).toContain("slides");
  });

  it("reports both when some providers refused and another replied badly", () => {
    const msg = aiUnavailableMessage(["gemini: 429"], ["attempt 2 via openai: truncated JSON"]);
    // Something genuinely refused, so the key advice still stands.
    expect(msg).toContain("no AI provider produced content");
    expect(msg).toContain("Providers tried — gemini: 429");
    expect(msg).toContain("A provider DID reply");
  });

  it("keeps the detail on its own paragraph so a toast can drop it", () => {
    const msg = aiUnavailableMessage(["gemini: 429"]);
    const [summary, ...rest] = msg.split("\n\n");
    expect(summary).not.toContain("Providers tried");
    expect(rest.join("\n\n")).toContain("Providers tried");
  });
});
