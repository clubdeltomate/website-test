import { describe, it, expect } from "vitest";
import { normalizeUsername } from "../contracts/types.js";

describe("normalizeUsername", () => {
  it("closes up spaces rather than rejecting the name", () => {
    expect(normalizeUsername("Sam Sketcher")).toBe("SamSketcher");
    expect(normalizeUsername("  Ada  Admin  ")).toBe("AdaAdmin");
  });

  it("handles every kind of whitespace, not just the space bar", () => {
    // A tab or a non-breaking space is invisible in a form field but would
    // survive a naive .replace(/ /g, "") and leave an unsignable username.
    expect(normalizeUsername("Moe\tModerator")).toBe("MoeModerator");
    expect(normalizeUsername("Moe Moderator")).toBe("MoeModerator");
    expect(normalizeUsername("Moe\nModerator")).toBe("MoeModerator");
  });

  it("leaves an already-valid name untouched, so backfills are idempotent", () => {
    for (const name of ["SamSketcher", "user_42", "小明", "José"]) {
      expect(normalizeUsername(name)).toBe(name);
      expect(normalizeUsername(normalizeUsername(name))).toBe(name);
    }
  });

  it("returns empty for a name that was nothing but whitespace", () => {
    // Callers treat empty as "reject" — it can't be silently written.
    expect(normalizeUsername("   ")).toBe("");
    expect(normalizeUsername("")).toBe("");
  });

  it("stays inside the column width", () => {
    expect(normalizeUsername("a".repeat(400))).toHaveLength(255);
  });
});
