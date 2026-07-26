import { describe, expect, it } from "vitest";
import { typedOverlapCorrect, isFillBlankCorrect } from "@contracts/grade";

describe("typed answer overlap fallback", () => {
  it("rejects random gibberish even against a short/numeric reference", () => {
    // the reported bug: "azas" was marked correct because a short reference
    // ("0.20") produced no overlap tokens and any non-empty answer passed
    expect(typedOverlapCorrect("azas", "0.20")).toBe(false);
    expect(typedOverlapCorrect("qwerty", "20%")).toBe(false);
  });

  it("accepts an answer that contains a short/numeric reference", () => {
    expect(typedOverlapCorrect("the fraction is 0.20", "0.20")).toBe(true);
    expect(typedOverlapCorrect("about 20 percent", "20%")).toBe(true);
  });

  it("accepts a meaning match against a longer reference", () => {
    expect(
      typedOverlapCorrect(
        "carbon monoxide binds hemoglobin tighter than oxygen",
        "Carbon monoxide binds hemoglobin far more tightly than oxygen does.",
      ),
    ).toBe(true);
    expect(typedOverlapCorrect("the sky is blue", "Carbon monoxide binds hemoglobin.")).toBe(false);
  });

  it("empty answers are never correct", () => {
    expect(typedOverlapCorrect("", "0.20")).toBe(false);
    expect(isFillBlankCorrect("", ["ran"])).toBe(false);
  });
});
