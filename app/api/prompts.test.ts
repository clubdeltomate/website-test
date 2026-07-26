import { describe, it, expect } from "vitest";
import { buildLessonPathPrompt } from "./ai/prompts.js";

describe("buildLessonPathPrompt", () => {
  it("folds attached reference material into the prompt", () => {
    const prompt = buildLessonPathPrompt({
      description: "Our cafe menu",
      template: "restaurant",
      unitCount: 3,
      lessonsPerUnit: 3,
      reference: "ESPRESSO $3\nLATTE $4\nCROISSANT $5",
    });
    expect(prompt).toContain("ATTACHED REFERENCE MATERIAL");
    expect(prompt).toContain("ESPRESSO $3");
    expect(prompt).toContain("do not invent");
  });

  it("omits the reference section when no attachment is given", () => {
    const prompt = buildLessonPathPrompt({
      description: "Intro to fractions",
      template: "course",
      unitCount: 4,
      lessonsPerUnit: 3,
    });
    expect(prompt).not.toContain("ATTACHED REFERENCE MATERIAL");
  });
});

import { buildSlidesSystemPrompt } from "./ai/prompts.js";

describe("buildSlidesSystemPrompt", () => {
  it("anchors a commercial deck to the exact product/subject", () => {
    const prompt = buildSlidesSystemPrompt({
      level: "B1",
      imageStyle: "photo",
      purpose: "commercial",
      subject: "Aura Ring",
      previouslyTaught: null,
    });
    expect(prompt).toContain('THE ITEM YOU ARE SHOWCASING IS: "Aura Ring"');
    expect(prompt).toContain("Never introduce, list, or compare other products");
  });
});
