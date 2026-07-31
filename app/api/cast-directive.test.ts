import { describe, expect, it } from "vitest";
import { DEFAULT_CAST, castDirective, castRoster } from "../contracts/cast.js";

describe("the default cast", () => {
  it("ships ten models with unique ids and names", () => {
    expect(DEFAULT_CAST).toHaveLength(10);
    expect(new Set(DEFAULT_CAST.map((m) => m.id)).size).toBe(10);
    expect(new Set(DEFAULT_CAST.map((m) => m.name)).size).toBe(10);
  });

  it("describes each of them densely enough to be reproducible", () => {
    for (const m of DEFAULT_CAST) {
      // A thin sheet is the failure mode that matters: the generator invents
      // the missing half and the model stops looking like themselves.
      expect(m.sheet.split(/\s+/).length, m.name).toBeGreaterThan(55);
      expect(m.sheet.startsWith(m.name), m.name).toBe(true);
      expect(m.headline.length, m.name).toBeLessThanOrEqual(60);
      expect(m.custom).toBe(false);
    }
  });

  it("covers the features a face-free frame still has to get right", () => {
    for (const m of DEFAULT_CAST) {
      expect(m.sheet.toLowerCase(), m.name).toMatch(/skin/);
      expect(m.sheet.toLowerCase(), m.name).toMatch(/hand|finger/);
      expect(m.sheet.toLowerCase(), m.name).toMatch(/build|frame|slight|heavyset|stocky/);
    }
  });
});

describe("castDirective", () => {
  it("says nothing at all when nobody is cast", () => {
    expect(castDirective([])).toBe("");
  });

  it("carries every chosen sheet verbatim", () => {
    const out = castDirective([
      { name: "Marisol Rivera", sheet: "Marisol Rivera, a woman with warm mid-brown skin." },
      { name: "Theo Achebe", sheet: "Theo Achebe, a tall man with deep brown skin." },
    ]);
    expect(out).toContain("Marisol Rivera, a woman with warm mid-brown skin.");
    expect(out).toContain("Theo Achebe, a tall man with deep brown skin.");
  });

  it("holds the generator to the person on a shot with no face in it", () => {
    const out = castDirective([{ name: "A", sheet: "A, someone." }]);
    expect(out).toMatch(/hands, forearms, feet or a body without a face/);
    expect(out).toMatch(/same skin tone/);
  });

  it("forbids quietly swapping in somebody else", () => {
    const out = castDirective([{ name: "A", sheet: "A, someone." }]);
    expect(out).toMatch(/Do not substitute anyone else/);
    expect(out).toMatch(/do not add extra people/);
  });
});

describe("castRoster", () => {
  it("lists who is available, with the one-liner that tells them apart", () => {
    expect(castRoster([{ name: "Grace Yoon", headline: "Early 60s · small, sturdy" }])).toBe(
      "Grace Yoon (Early 60s · small, sturdy)",
    );
  });
});
