import { describe, expect, it } from "vitest";
import { musicCost } from "./routers/marketing.js";
import { MUSIC_MAX_SECONDS, MUSIC_MIN_SECONDS, generateMusic } from "./ai/provider.js";

/* Music is the one thing here billed by the second rather than by the call,
 * so the arithmetic is worth pinning: a minute must cost twice a half minute,
 * and nothing may ever come out free. The standing rule on this site is that
 * everything made costs the maker coins, and a rounding hole would be a way
 * around it. */

describe("musicCost", () => {
  it("charges the settings figure for the reference thirty seconds", () => {
    expect(musicCost(20, 30)).toBe(20);
  });

  it("scales with length", () => {
    expect(musicCost(20, 60)).toBe(2 * musicCost(20, 30));
    expect(musicCost(20, 15)).toBe(10);
  });

  it("never charges nothing, however short the clip or cheap the price", () => {
    for (const seconds of [MUSIC_MIN_SECONDS, 15, 30, MUSIC_MAX_SECONDS]) {
      expect(musicCost(0, seconds)).toBeGreaterThanOrEqual(1);
      expect(musicCost(0.1, seconds)).toBeGreaterThanOrEqual(1);
    }
  });

  it("rounds up rather than down, so a part-second is never free", () => {
    expect(musicCost(1, 10)).toBe(1);
    expect(musicCost(7, 20)).toBe(5); // 4.67 → 5
  });
});

describe("generateMusic under the mock provider", () => {
  it("returns an mp3 data URI that grows with the length asked for", async () => {
    const short = await generateMusic({ prompt: "warm lo-fi", seconds: 10 });
    const long = await generateMusic({ prompt: "warm lo-fi", seconds: 60 });
    if (!short.ok || !long.ok) throw new Error(`mock music failed: ${JSON.stringify(short)}`);
    expect(short.mime).toBe("audio/mpeg");
    expect(short.audio.startsWith("data:audio/mpeg;base64,")).toBe(true);
    expect(long.audio.length).toBeGreaterThan(short.audio.length);
  });

  it("refuses an empty brief rather than charging for silence", async () => {
    const out = await generateMusic({ prompt: "   ", seconds: 30 });
    expect(out.ok).toBe(false);
  });

  it("says WHY it failed, so the toast can point somewhere useful", async () => {
    // Without the mock and without a key, the answer has to name the thing
    // that is missing rather than shrug.
    const was = process.env.SKETCHLEARN_ALLOW_MOCK_AI;
    delete process.env.SKETCHLEARN_ALLOW_MOCK_AI;
    const was2 = process.env.ELEVENLABS_API_KEY;
    delete process.env.ELEVENLABS_API_KEY;
    try {
      const out = await generateMusic({ prompt: "warm lo-fi", seconds: 30 });
      expect(out.ok).toBe(false);
      if (out.ok) return;
      expect(out.reason).toMatch(/ELEVENLABS_API_KEY|Settings/);
    } finally {
      if (was !== undefined) process.env.SKETCHLEARN_ALLOW_MOCK_AI = was;
      if (was2 !== undefined) process.env.ELEVENLABS_API_KEY = was2;
    }
  });
});
