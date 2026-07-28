import { describe, it, expect } from "vitest";
import { nextSlice, MIN_SLICE_MS } from "./provider.js";

/**
 * These guard the fix for the reported failure. The time budget used to be
 * divided evenly between candidates, so a deck — measured at ~5.5k output
 * tokens, which a provider takes 35-55s to write — failed BOTH 26s halves,
 * when one longer attempt would have succeeded. The budget is now a ceiling
 * for all candidates together, spent where it does the most good.
 */
describe("nextSlice", () => {
  const now = 1_000_000;

  it("gives the first candidate the whole budget, not a fraction of it", () => {
    // 50s left, 45s per-call cap → the first try may run for the full 45s.
    expect(nextSlice(45_000, now + 50_000, now)).toBe(45_000);
  });

  it("never exceeds the shared deadline", () => {
    // Only 12s left, so a 45s per-call cap must be trimmed to 12s rather than
    // overrunning the invocation the caller has to return inside.
    expect(nextSlice(45_000, now + 12_000, now)).toBe(12_000);
  });

  it("hands a fast failure's leftover time to the next candidate", () => {
    // A candidate that died in 3s of a 50s budget leaves 47s: the next one
    // still gets a full-length attempt, which is when fallback is useful.
    const deadline = now + 50_000;
    expect(nextSlice(45_000, deadline, now + 3_000)).toBe(45_000);
  });

  it("skips a candidate that cannot possibly answer in the time left", () => {
    expect(nextSlice(45_000, now + MIN_SLICE_MS - 1, now)).toBeNull();
    expect(nextSlice(45_000, now - 5_000, now)).toBeNull();
  });

  it("falls back to a plain per-call timeout when no budget is set", () => {
    expect(nextSlice(26_000, null, now)).toBe(26_000);
  });
});
