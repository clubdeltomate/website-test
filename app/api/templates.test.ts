import { describe, expect, it } from "vitest";
import {
  BUILTIN_SLIDE_TEMPLATES,
  templatesForSubject,
  templatesForSubjectAndLevel,
  slideConformsToTemplate,
  slideConformsToAny,
  bestMatchingTemplate,
  sectionForTags,
  isGradable,
  GRADABLE_TYPES,
  TEMPLATE_COMPONENT_LABELS,
  TEMPLATE_LEVELS,
  templatePurpose,
} from "@contracts/slide-templates";
import { levelTier } from "@contracts/types";

describe("slide-template catalog", () => {
  it("every built-in has a name, level, components, valid labels; education ones are gradable", () => {
    for (const t of BUILTIN_SLIDE_TEMPLATES) {
      expect(t.name.length).toBeGreaterThan(0);
      expect(TEMPLATE_LEVELS).toContain(t.level);
      expect(t.components.length).toBeGreaterThan(0);
      for (const c of t.components) expect(TEMPLATE_COMPONENT_LABELS[c]).toBeTruthy();
      // an EDUCATION template is either scoreable OR an explicit read-through
      // (evaluation-free by design — marked with a green dot in the picker),
      // in which case it must carry real written prose. Commercial showcases
      // end on a contact/order close instead of a quiz.
      if (templatePurpose(t.tags) === "education" && !t.components.some((c) => isGradable(c))) {
        expect(t.components.includes("prose"), t.name).toBe(true);
      }
    }
  });

  it("has ~10 STEM and ~10 humanities per tier, and 10 general", () => {
    const stem = BUILTIN_SLIDE_TEMPLATES.filter((t) => sectionForTags(t.tags) === "stem");
    const hum = BUILTIN_SLIDE_TEMPLATES.filter((t) => sectionForTags(t.tags) === "humanities");
    const gen = BUILTIN_SLIDE_TEMPLATES.filter((t) => sectionForTags(t.tags) === "general");
    for (const tier of ["light", "mid", "dense"] as const) {
      expect(stem.filter((t) => levelTier(t.level) === tier).length).toBeGreaterThanOrEqual(10);
      expect(hum.filter((t) => levelTier(t.level) === tier).length).toBeGreaterThanOrEqual(10);
    }
    expect(gen.length).toBeGreaterThanOrEqual(10);
  });

  it("higher-tier education templates carry denser text than lower-tier ones", () => {
    const avgProse = (tier: "light" | "dense") => {
      const set = BUILTIN_SLIDE_TEMPLATES.filter(
        (t) => levelTier(t.level) === tier && templatePurpose(t.tags) === "education",
      );
      return set.reduce((n, t) => n + t.components.filter((c) => c === "prose").length, 0) /
        Math.max(1, set.length);
    };
    expect(avgProse("dense")).toBeGreaterThan(avgProse("light"));
  });

  it("STEM subjects get STEM + humanities + general (variety); humanities subjects exclude STEM", () => {
    // STEM decks may also pull text/image-rich humanities layouts for variety.
    const stem = templatesForSubject(BUILTIN_SLIDE_TEMPLATES, true);
    expect(stem.some((t) => sectionForTags(t.tags) === "stem")).toBe(true);
    expect(stem.some((t) => sectionForTags(t.tags) === "humanities")).toBe(true);
    expect(stem.some((t) => sectionForTags(t.tags) === "general")).toBe(true);
    // Humanities decks still exclude STEM-only layouts (formulas, code).
    const hum = templatesForSubject(BUILTIN_SLIDE_TEMPLATES, false);
    for (const t of hum) expect(sectionForTags(t.tags)).not.toBe("stem");
  });

  it("subject+level filtering returns only that level (when non-empty)", () => {
    const advStem = templatesForSubjectAndLevel(BUILTIN_SLIDE_TEMPLATES, true, "C1");
    expect(advStem.length).toBeGreaterThan(0);
    for (const t of advStem) expect(t.level).toBe("C1");
  });

  it("gradable set is exactly the five evaluation types", () => {
    expect(new Set(GRADABLE_TYPES)).toEqual(
      new Set(["quiz", "mcq2", "fillblank", "shortanswer", "solve"]),
    );
  });
});

describe("slide conformance to templates", () => {
  const beginnerStem = templatesForSubjectAndLevel(BUILTIN_SLIDE_TEMPLATES, true, "A1");

  it("an image + quiz slide with no text conforms to NO beginner STEM template", () => {
    // this is exactly the bad slide the user reported
    const shape = { componentTypes: ["image"], hasQuiz: true };
    expect(slideConformsToAny(shape, beginnerStem)).toBe(false);
  });

  it("a text + image + quiz slide conforms to an approved template", () => {
    const shape = { componentTypes: ["image", "prose"], hasQuiz: true };
    expect(slideConformsToAny(shape, beginnerStem)).toBe(true);
  });

  it("a template with a gradable step is not satisfied without a quiz", () => {
    const t = BUILTIN_SLIDE_TEMPLATES.find((x) => x.name === "Spot it on the graph")!;
    expect(slideConformsToTemplate({ componentTypes: ["prose", "chart"], hasQuiz: false }, t)).toBe(false);
    expect(slideConformsToTemplate({ componentTypes: ["prose", "chart"], hasQuiz: true }, t)).toBe(true);
  });

  it("prose COUNT is soft but the structural component is hard-required", () => {
    // "Grammar deep dive" = prose, table, prose, shortanswer (needs 2 prose + a table)
    const t = BUILTIN_SLIDE_TEMPLATES.find((x) => x.name === "Grammar deep dive")!;
    // one prose (several paragraphs) + a table + a quiz → conforms (prose count soft)
    expect(slideConformsToTemplate({ componentTypes: ["prose", "table"], hasQuiz: true }, t)).toBe(true);
    // but dropping the table → does NOT conform (this was the reported bug)
    expect(slideConformsToTemplate({ componentTypes: ["prose"], hasQuiz: true }, t)).toBe(false);
    // no prose at all → does not conform
    expect(slideConformsToTemplate({ componentTypes: ["table"], hasQuiz: true }, t)).toBe(false);
  });

  it("extra components are allowed (template content is a subset)", () => {
    const t = BUILTIN_SLIDE_TEMPLATES.find((x) => x.name === "Read the table")!; // prose + table + mcq2
    const shape = { componentTypes: ["prose", "table", "stickynote"], hasQuiz: true };
    expect(slideConformsToTemplate(shape, t)).toBe(true);
  });

  it("bestMatchingTemplate labels a table slide with a TABLE layout, not an all-text one", () => {
    // a slide with 1 prose + a table + a typed quiz (the reported case)
    const shape = { componentTypes: ["prose", "table"], hasQuiz: true };
    const best = bestMatchingTemplate(shape, BUILTIN_SLIDE_TEMPLATES);
    expect(best).not.toBeNull();
    // the chosen template must itself contain a table
    expect(best!.components).toContain("table");
  });

  it("every built-in template is self-conforming (its own shape satisfies it)", () => {
    for (const t of BUILTIN_SLIDE_TEMPLATES) {
      const grad = ["quiz", "mcq2", "fillblank", "shortanswer", "solve"];
      const content = t.components.filter((c) => !grad.includes(c));
      const hasQuiz = t.components.some((c) => grad.includes(c));
      expect(slideConformsToTemplate({ componentTypes: content, hasQuiz }, t), t.name).toBe(true);
    }
  });
});
