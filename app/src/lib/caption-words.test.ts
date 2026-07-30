import { describe, expect, it } from "vitest";
import { inkFor, normWord, tintsFrom, wordsOf } from "./caption-words";

const ACCENT = "#35C4F0";

describe("wordsOf", () => {
  it("splits on any run of whitespace and drops the blanks", () => {
    expect(wordsOf("  Upgrade   your\ndaily brew  ")).toEqual([
      "Upgrade",
      "your",
      "daily",
      "brew",
    ]);
    expect(wordsOf("   ")).toEqual([]);
  });
});

describe("normWord", () => {
  it("ignores case and punctuation, keeps letters and digits", () => {
    expect(normWord("Brew,")).toBe("brew");
    expect(normWord('"Coffee"')).toBe("coffee");
    expect(normWord("30-second")).toBe("30second");
    expect(normWord("—")).toBe("");
  });
});

describe("tintsFrom", () => {
  it("paints the keywords the AI picked, and only those", () => {
    const tints = tintsFrom("Upgrade your daily brew", ["Upgrade", "brew"], ACCENT);
    expect(tints).toEqual({ 0: ACCENT, 3: ACCENT });
  });

  it("matches through the punctuation and casing of the real line", () => {
    // The AI copies the word; the card carries it with a comma and a capital.
    const tints = tintsFrom("Boil, then Steep.", ["boil", "steep"], ACCENT);
    expect(tints).toEqual({ 0: ACCENT, 2: ACCENT });
  });

  it("paints every word of a multi-word keyword", () => {
    const tints = tintsFrom("Grind fresh beans first", ["fresh beans"], ACCENT);
    expect(tints).toEqual({ 1: ACCENT, 2: ACCENT });
  });

  it("paints every occurrence, so a repeated keyword is not half-lit", () => {
    const tints = tintsFrom("Brew, taste, brew again", ["brew"], ACCENT);
    expect(tints).toEqual({ 0: ACCENT, 2: ACCENT });
  });

  it("survives the line being edited after the AI read it", () => {
    // "steam" is gone from the card; "filter" moved. Neither must drag the
    // colour onto a neighbouring word.
    const tints = tintsFrom("Then you filter it", ["steam", "filter"], ACCENT);
    expect(tints).toEqual({ 2: ACCENT });
  });

  it("paints nothing when the AI returned nothing, or matched nothing", () => {
    expect(tintsFrom("Upgrade your daily brew", [], ACCENT)).toEqual({});
    expect(tintsFrom("Upgrade your daily brew", ["espresso"], ACCENT)).toEqual({});
    expect(tintsFrom("", ["brew"], ACCENT)).toEqual({});
  });

  it("ignores keywords that are pure punctuation", () => {
    expect(tintsFrom("Boil the water", ["—", "!"], ACCENT)).toEqual({});
  });
});

describe("inkFor", () => {
  it("puts white on dark fills and near-black on pale ones", () => {
    expect(inkFor("#0B0B0B")).toBe("#FFFFFF");
    expect(inkFor("#12294B")).toBe("#FFFFFF");
    expect(inkFor("#FFFDF6")).toBe("#14110D");
    expect(inkFor("#FFC53D")).toBe("#14110D");
  });

  it("reads a translucent fill, so glass keeps its white lettering", () => {
    expect(inkFor("rgba(11,11,11,0.62)")).toBe("#FFFFFF");
    expect(inkFor("rgba(255, 253, 246, 0.62)")).toBe("#14110D");
  });

  it("falls back to dark-band ink rather than throwing on an odd value", () => {
    expect(inkFor("not-a-colour")).toBe("#FFFFFF");
  });
});
