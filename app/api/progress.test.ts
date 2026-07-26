import { describe, expect, it } from "vitest";
import { isPassingScore, PASS_THRESHOLD } from "@contracts/progress";

describe("isPassingScore", () => {
  it("passes at or above the threshold", () => {
    expect(isPassingScore(7, 10)).toBe(true); // exactly 70%
    expect(isPassingScore(8, 10)).toBe(true);
    expect(isPassingScore(9, 9)).toBe(true);
  });

  it("fails below the threshold", () => {
    expect(isPassingScore(6, 10)).toBe(false);
    expect(isPassingScore(0, 4)).toBe(false);
    expect(isPassingScore(2, 3)).toBe(false); // 66%
  });

  it("a deck with no quizzes passes by completion", () => {
    expect(isPassingScore(0, 0)).toBe(true);
  });

  it("threshold stays a sane fraction", () => {
    expect(PASS_THRESHOLD).toBeGreaterThan(0);
    expect(PASS_THRESHOLD).toBeLessThanOrEqual(1);
  });
});
