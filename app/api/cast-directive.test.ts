import { describe, expect, it } from "vitest";
import {
  DEFAULT_CAST,
  MAX_IN_FRAME,
  castDirective,
  castRoster,
  peopleWanted,
  pickForFrame,
} from "../contracts/cast.js";

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

  /* The bug: two people cast for a slide, one of them in the picture. A list
   * of descriptions reads as a set of options unless the count is spelled
   * out, so it is spelled out. */
  it("states the count, so a second person cannot quietly go missing", () => {
    const two = castDirective([
      { name: "Marisol Rivera", sheet: "Marisol Rivera, a woman." },
      { name: "Grace Yoon", sheet: "Grace Yoon, a woman." },
    ]);
    expect(two).toMatch(/exactly 2 people/);
    expect(two).toMatch(/ALL 2 must be visible in the frame together/);
    expect(two).toMatch(/Marisol Rivera, Grace Yoon/);
    expect(two).toMatch(/fewer than 2 of them is wrong/);
    expect(two).toMatch(/do not drop one of them/);
  });

  it("says one person plainly rather than counting to one", () => {
    const one = castDirective([{ name: "Theo Achebe", sheet: "Theo Achebe, a man." }]);
    expect(one).toMatch(/exactly ONE person in this image: Theo Achebe\./);
    expect(one).not.toMatch(/must be visible in the frame together/);
  });
});

/* The rule this guards: every face in a post comes from the ten. A brief
 * that mentions a person and gets nobody cast is how a stranger ends up in
 * the carousel; a brief about a plate that gets somebody cast is how a
 * person ends up standing in a close-up of dinner. */
describe("peopleWanted", () => {
  it("casts one for a brief with a single person in it", () => {
    for (const brief of [
      "An adult historian sitting at a wooden desk surrounded by books",
      "A barista pouring milk into a cup",
      "Someone reading by a window at sunrise",
      "Close-up of hands kneading dough",
    ]) {
      expect(peopleWanted(brief), brief).toBe(1);
    }
  });

  it("casts more when the brief is plural", () => {
    expect(peopleWanted("Two people cooking together in a bright kitchen")).toBe(2);
    expect(peopleWanted("A couple sharing a plate at a small table")).toBe(2);
    expect(peopleWanted("A team working around a whiteboard")).toBe(3);
  });

  it("leaves a picture with nobody in it alone", () => {
    for (const brief of [
      "A bowl of ramen on a wooden counter, steam rising",
      "An empty workshop at dawn, tools on the bench",
      "Close-up of a leather notebook and a fountain pen",
      "A city skyline at golden hour",
    ]) {
      expect(peopleWanted(brief), brief).toBe(0);
    }
  });

  it("never asks for more than one frame can hold", () => {
    expect(peopleWanted("A large group of people at a festival")).toBeLessThanOrEqual(MAX_IN_FRAME);
  });
});

describe("pickForFrame", () => {
  const people = Array.from({ length: 9 }, (_, i) => ({ name: `P${i}`, sheet: `P${i}, someone.` }));

  it("keeps every one of a small cast — the whole point of choosing them", () => {
    for (let n = 0; n <= MAX_IN_FRAME; n++) {
      expect(pickForFrame(people.slice(0, n))).toHaveLength(n);
    }
    expect(pickForFrame(people.slice(0, 3))).toEqual(people.slice(0, 3));
  });

  it("caps a crowd at what one frame can carry", () => {
    for (let n = MAX_IN_FRAME + 1; n <= 9; n++) {
      expect(pickForFrame(people.slice(0, n))).toHaveLength(MAX_IN_FRAME);
    }
  });

  it("only ever returns people who were cast, without repeating one", () => {
    const got = pickForFrame(people);
    expect(new Set(got).size).toBe(got.length);
    for (const g of got) expect(people).toContain(g);
  });

  it("does not always land on the same four", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 40; i++) seen.add(pickForFrame(people).map((p) => p.name).sort().join());
    expect(seen.size).toBeGreaterThan(1);
  });
});

describe("castRoster", () => {
  it("lists who is available, with the one-liner that tells them apart", () => {
    expect(castRoster([{ name: "Grace Yoon", headline: "Early 60s · small, sturdy" }])).toBe(
      "Grace Yoon (Early 60s · small, sturdy)",
    );
  });
});
