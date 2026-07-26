import { describe, expect, it } from "vitest";
import {
  extractJson,
  repairDeckDraft,
  ensureExplanatoryProse,
  everySlideHasProse,
  slideHasProse,
  shuffleQuizAnswers,
  repoRef,
  slugify,
  slideDeckSchema,
  lessonPathSchema,
} from "./prompts.js";
import { mockDeck, mockLessonPath, mockCoachReply } from "./mock.js";
import { isStemTopic } from "@contracts/stem";

describe("isStemTopic", () => {
  it("classifies sciences as STEM", () => {
    for (const t of [
      "Mycology",
      "Particle physics",
      "Introduction to Astronomy",
      "Organic chemistry basics",
      "Geology of volcanoes",
      "Newton's laws of motion",
      "Machine learning for beginners",
      "Cell biology",
    ]) {
      expect(isStemTopic(t), t).toBe(true);
    }
  });

  it("classifies data science & computing topics as STEM", () => {
    for (const t of [
      "Data science",
      "Binary and Data Representation",
      "Bitwise operations",
      "Boolean logic and truth tables",
      "Hexadecimal and octal number systems",
      "Encoding and compression",
      "Unicode vs ASCII",
      "Neural networks and deep learning",
      "Databases and datasets",
      "Cybersecurity fundamentals",
    ]) {
      expect(isStemTopic(t), t).toBe(true);
    }
  });

  it("does not misfire on lookalike non-STEM words", () => {
    for (const t of [
      "Serving sizes: 250 ml of sauce", // 'ml' must NOT trigger
      "Classic hash browns", // 'hash' must NOT trigger
      "A history of Hawaii", // 'ai' inside a word must NOT trigger
    ]) {
      expect(isStemTopic(t), t).toBe(false);
    }
  });

  it("classifies humanities-style topics as non-STEM", () => {
    for (const t of [
      "The history of the Roman Empire",
      "French cooking",
      "A biography of Frida Kahlo",
      "Creative writing workshop",
      "Philosophy of art",
    ]) {
      expect(isStemTopic(t), t).toBe(false);
    }
  });
});

describe("slugify", () => {
  it("makes stable kebab slugs", () => {
    expect(slugify("FS1111 — Foundations of Physics: Motion & Forces")).toBe(
      "fs1111-foundations-of-physics-motion-forces",
    );
    expect(slugify("  Casa Azul — Mexican Kitchen  ")).toBe("casa-azul-mexican-kitchen");
    expect(slugify("!!!")).toBe("untitled");
  });
});

describe("repoRef", () => {
  it("is 5 chars, deterministic, and slug-dependent", () => {
    const a = repoRef("physics-fs1111-motion");
    expect(a).toMatch(/^[A-Z2-9]{5}$/);
    expect(repoRef("physics-fs1111-motion")).toBe(a);
    expect(repoRef("casa-azul-menu")).not.toBe(a);
  });
});

describe("extractJson", () => {
  it("tolerates fences and surrounding prose", () => {
    expect(extractJson('```json\n{"a":1}\n```')).toBe('{"a":1}');
    expect(extractJson('sure! {"a":{"b":2}} hope that helps')).toBe('{"a":{"b":2}}');
    expect(() => extractJson("no json here")).toThrow();
  });
});

describe("repairDeckDraft", () => {
  const defaults = { level: "A1", imageStyle: "sketch", topic: "Fungi" };

  it("salvages a deck with one bad component and a bad quiz", () => {
    const raw = {
      slides: [
        {
          title: "Good slide",
          components: [
            { type: "prose", paragraphs: ["Fungi are neither plants nor animals."] },
            { type: "chart", chartType: "bar", title: "bad", labels: ["a"], series: [] }, // invalid
          ],
          quiz: {
            question: "Pick one",
            options: ["a", "b", "c"], // only 3 — invalid
            correctIndex: 0,
            explanation: "x",
          },
        },
        { components: [] }, // no title, no quiz → genuinely empty → dropped
      ],
      // level/imageStyle/topic missing — filled from defaults
    };
    const deck = slideDeckSchema.parse(repairDeckDraft(raw, defaults));
    expect(deck.slides).toHaveLength(1); // the junk slide is dropped, the good one kept
    expect(deck.slides[0].components).toHaveLength(1);
    expect(deck.slides[0].quiz).toBeUndefined();
    expect(deck.level).toBe("A1");
    expect(deck.imageStyle).toBe("sketch");
    expect(deck.topic).toBe("Fungi");
  });

  it("snaps invented image styles to the deck style", () => {
    const raw = {
      slides: [
        {
          title: "s",
          components: [
            { type: "image", prompt: "a mushroom", alt: "mushroom", style: "hand-drawn" },
          ],
        },
      ],
      level: "A1",
      imageStyle: "sketch",
      topic: "Fungi",
    };
    const deck = slideDeckSchema.parse(repairDeckDraft(raw, defaults));
    const img = deck.slides[0].components[0];
    expect(img.type).toBe("image");
    if (img.type === "image") expect(img.style).toBe("sketch");
  });

  it("leaves a fully valid deck untouched", () => {
    const raw = {
      slides: [
        {
          title: "s",
          components: [{ type: "prose", paragraphs: ["p"] }],
          quiz: {
            question: "q?",
            options: ["a", "b", "c", "d"],
            correctIndex: 1,
            explanation: "e",
          },
        },
      ],
      level: "C1",
      imageStyle: "none",
      topic: "Spores",
    };
    const deck = slideDeckSchema.parse(repairDeckDraft(structuredClone(raw), defaults));
    // the schema now stamps the default quiz kind
    expect(deck.slides[0].quiz).toMatchObject({ ...raw.slides[0].quiz, kind: "mcq" });
    expect(deck.level).toBe("C1");
    expect(deck.topic).toBe("Spores");
  });

  it("parses each evaluation kind (mcq2, fillblank, typed)", () => {
    const mk = (quiz: Record<string, unknown>) =>
      slideDeckSchema.parse({
        slides: [{ title: "s", components: [{ type: "prose", paragraphs: ["p"] }], quiz }],
        level: "A1",
        imageStyle: "none",
        topic: "T",
      }).slides[0].quiz;
    expect(mk({ kind: "mcq2", question: "q", options: ["a", "b"], correctIndex: 1, explanation: "e" })?.kind).toBe("mcq2");
    expect(mk({ kind: "fillblank", question: "__ ran", answer: "she", explanation: "e" })?.answer).toBe("she");
    expect(mk({ kind: "typed", question: "why?", answer: "because", explanation: "e" })?.kind).toBe("typed");
    // mcq2 with 4 options is rejected
    expect(() =>
      mk({ kind: "mcq2", question: "q", options: ["a", "b", "c", "d"], correctIndex: 0, explanation: "e" }),
    ).toThrow();
    // fillblank without an answer is rejected
    expect(() => mk({ kind: "fillblank", question: "q", explanation: "e" })).toThrow();
  });
});

describe("explanatory-prose guarantees", () => {
  it("repair salvages prose with blank paragraphs instead of dropping it", () => {
    const raw = {
      slides: [
        {
          title: "Osmosis",
          components: [
            { type: "prose", paragraphs: ["", "Water moves across the membrane.", "  "] },
            { type: "image", prompt: "a cell", alt: "cell", style: "sketch" },
          ],
          quiz: { question: "q", options: ["a", "b", "c", "d"], correctIndex: 0, explanation: "e" },
        },
      ],
      level: "A1",
      imageStyle: "sketch",
      topic: "Cells",
    };
    const deck = slideDeckSchema.parse(
      repairDeckDraft(raw, { level: "A1", imageStyle: "sketch", topic: "Cells" }),
    );
    expect(slideHasProse(deck.slides[0])).toBe(true);
    const prose = deck.slides[0].components.find((c) => c.type === "prose");
    expect(prose?.type === "prose" && prose.paragraphs).toEqual(["Water moves across the membrane."]);
  });

  it("repair keeps a slide whose components were all invalid (no shrinking the deck)", () => {
    const raw = {
      slides: [
        { title: "A", components: [{ type: "prose", paragraphs: ["real text"] }] },
        // this slide's only component is an eval-type (not a renderable
        // component) — it must be salvaged with text, not dropped
        {
          title: "B",
          components: [{ type: "fillblank", prompt: "___" }],
          quiz: { question: "q", options: ["a", "b", "c", "d"], correctIndex: 1, explanation: "because b" },
        },
        { title: "C", components: [{ type: "prose", paragraphs: ["more text"] }] },
      ],
      level: "A1",
      imageStyle: "sketch",
      topic: "T",
    };
    const deck = slideDeckSchema.parse(
      repairDeckDraft(raw, { level: "A1", imageStyle: "sketch", topic: "T" }),
    );
    // all three slides survive
    expect(deck.slides).toHaveLength(3);
    // the salvaged slide has prose (built from its quiz)
    expect(slideHasProse(deck.slides[1])).toBe(true);
  });

  it("detects a visual-only slide as missing prose", () => {
    const deck = {
      slides: [
        {
          title: "Just a picture",
          components: [{ type: "image", prompt: "x", alt: "x", style: "sketch" }],
          quiz: { question: "q", options: ["a", "b", "c", "d"], correctIndex: 0, explanation: "e" },
        },
      ],
    };
    expect(everySlideHasProse(deck)).toBe(false);
  });

  it("ensureExplanatoryProse fills a visual-only slide with ON-TOPIC text from its quiz", () => {
    const deck = slideDeckSchema.parse({
      slides: [
        {
          title: "The Language of Switches",
          components: [{ type: "image", prompt: "toggle switches", alt: "switches", style: "photo" }],
          quiz: {
            question: "Why do computers use binary (0s and 1s)?",
            options: [
              "Hardware components operate on two physical states: OFF (0) and ON (1)",
              "Binary digits take up less screen space",
              "Computers only exist in two countries",
              "Binary needs no electricity",
            ],
            correctIndex: 0,
            explanation: "A switch is either off or on, so two states map directly onto 0 and 1.",
          },
        },
      ],
      level: "A1",
      imageStyle: "photo",
      topic: "Binary",
    });
    expect(everySlideHasProse(deck)).toBe(false);
    const fixed = ensureExplanatoryProse(deck);
    expect(everySlideHasProse(fixed)).toBe(true);
    expect(() => slideDeckSchema.parse(fixed)).not.toThrow();
    const prose = fixed.slides[0].components.find((c) => c.type === "prose");
    const text = prose?.type === "prose" ? prose.paragraphs[0] : "";
    // the injected text teaches the quiz's point, not a generic placeholder
    expect(text).toContain("OFF (0) and ON (1)");
    expect(text).toContain("map directly onto 0 and 1");
    expect(text).not.toContain("Let's look at");
  });
});

describe("shuffleQuizAnswers", () => {
  // simple deterministic RNG (mulberry32)
  function rngFrom(seed: number) {
    let a = seed;
    return () => {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  it("keeps the correct option pointing at the same text after shuffling", () => {
    const deck = {
      slides: [
        {
          quiz: {
            question: "q",
            options: ["CORRECT", "b", "c", "d"],
            correctIndex: 0,
            explanation: "e",
          },
        },
      ],
    };
    shuffleQuizAnswers(deck, rngFrom(123));
    const q = deck.slides[0].quiz;
    expect(q.options[q.correctIndex]).toBe("CORRECT");
  });

  it("distributes the correct answer across positions (not always 'A')", () => {
    const positions = new Set<number>();
    const rng = rngFrom(7);
    for (let n = 0; n < 40; n++) {
      const deck = {
        slides: [
          {
            quiz: {
              question: "q",
              options: ["CORRECT", "b", "c", "d"],
              correctIndex: 0,
              explanation: "e",
            },
          },
        ],
      };
      shuffleQuizAnswers(deck, rng);
      positions.add(deck.slides[0].quiz.correctIndex);
    }
    // over many shuffles the correct answer lands in more than one slot
    expect(positions.size).toBeGreaterThan(1);
  });

  it("shuffled deck still validates against the schema", () => {
    const deck = slideDeckSchema.parse({
      slides: [
        {
          title: "s",
          components: [{ type: "prose", paragraphs: ["p"] }],
          quiz: { question: "q?", options: ["a", "b", "c", "d"], correctIndex: 2, explanation: "e" },
        },
      ],
      level: "A1",
      imageStyle: "sketch",
      topic: "T",
    });
    const q0 = deck.slides[0].quiz!;
    const before = q0.options![q0.correctIndex!];
    shuffleQuizAnswers(deck, rngFrom(99));
    expect(() => slideDeckSchema.parse(deck)).not.toThrow();
    const q1 = deck.slides[0].quiz!;
    expect(q1.options![q1.correctIndex!]).toBe(before);
  });
});

describe("mock generators satisfy the output contracts", () => {
  it("mockDeck validates against slideDeckSchema", () => {
    const deck = mockDeck({
      topic: "Newton's laws of motion",
      level: "A1",
      slideCount: 6,
      imageStyle: "sketch",
    });
    const parsed = slideDeckSchema.parse(deck);
    expect(parsed.slides).toHaveLength(6);
    // at most one sticky note per deck
    const stickies = parsed.slides.flatMap((s) =>
      s.components.filter((c) => c.type === "stickynote"),
    );
    expect(stickies.length).toBeLessThanOrEqual(1);
    // at most one latex per slide
    for (const s of parsed.slides) {
      expect(s.components.filter((c) => c.type === "latex").length).toBeLessThanOrEqual(1);
    }
  });

  it("mock quiz questions are closed-form MCQs (never open-ended prompts)", () => {
    for (const level of ["A1", "B1", "C1"] as const) {
      const deck = mockDeck({ topic: "Newton's laws of motion", level, slideCount: 8, imageStyle: "sketch" });
      const questions = deck.slides.flatMap((s) => (s.quiz ? [s.quiz.question] : []));
      expect(questions.length).toBeGreaterThan(0);
      for (const q of questions) {
        expect(q.toLowerCase()).not.toContain("in your own words");
        expect(q.toLowerCase()).not.toMatch(/\b(explain|describe|what do you think)\b/);
      }
    }
  });

  it("mockDeck is deterministic", () => {
    const opts = { topic: "chilaquiles", level: "B1" as const, slideCount: 4, imageStyle: "flat" as const };
    expect(mockDeck(opts)).toEqual(mockDeck(opts));
  });

  it("mockLessonPath validates and respects requested shape", () => {
    const draft = mockLessonPath({
      description: "A taco restaurant menu",
      template: "restaurant",
      unitCount: 3,
      lessonsPerUnit: 2,
    });
    const parsed = lessonPathSchema.parse(draft);
    expect(parsed.units).toHaveLength(3);
    for (const u of parsed.units) expect(u.lessons).toHaveLength(2);
  });

  it("mockCoachReply detects templates from keywords", () => {
    expect(mockCoachReply("build my restaurant menu").actions[0].payload?.template).toBe("restaurant");
    expect(mockCoachReply("teach new technicians plumbing repair").actions[0].payload?.template).toBe("service");
    expect(mockCoachReply("my candle shop collection").actions[0].payload?.template).toBe("shop");
    expect(mockCoachReply("a physics course").actions[0].payload?.template).toBe("course");
  });
});
