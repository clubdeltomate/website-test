import type {
  CoachReply,
  ImageStyle,
  Level,
  RepoTemplate,
  SlideDeck,
  Slide,
  SlideComponent,
} from "../../contracts/types.js";
import type { LessonPathDraft } from "./prompts.js";
import { isStemTopic } from "../../contracts/stem.js";
import { levelTier } from "../../contracts/types.js";

/* ------------------------------------------------------------------ */
/* Deterministic pseudo-generation — the platform is fully demo-able    */
/* with zero AI keys configured. Seeded by the prompt text.             */
/* ------------------------------------------------------------------ */

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function words(topic: string): string[] {
  return topic
    .replace(/[^a-zA-Z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2)
    .slice(0, 8);
}

function titleCase(s: string): string {
  return s.replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1));
}

/** Deterministic mock deck that mentions the topic and obeys the deck rules. */
export function mockDeck(opts: {
  topic: string;
  level: Level;
  slideCount: number;
  imageStyle: ImageStyle;
  previouslyTaught?: string | null;
}): SlideDeck {
  const { topic, level, slideCount, imageStyle } = opts;
  console.warn(
    `[ai/mock] No AI key configured — generating MOCK deck for "${topic}" (${slideCount} slides)`,
  );
  const rand = mulberry32(hashStr(topic + level + slideCount));
  const kw = words(topic);
  const subject = kw.slice(0, 4).join(" ") || topic;
  const stem = isStemTopic(topic);
  const slides: Slide[] = [];

  const anglePool = [
    "the core idea",
    "how it works step by step",
    "a concrete example",
    "the details that matter",
    "common pitfalls and how to spot them",
    "putting it into practice",
    "how the pieces connect",
    "a closer look at the numbers",
    "why it works the way it does",
    "applying it to a new situation",
    "the story behind it",
    "what to watch for next",
    "a guided walk-through",
    "the finishing touches",
    "tying it all together",
  ];

  for (let i = 0; i < slideCount; i++) {
    const angle = anglePool[i % anglePool.length];
    const k1 = kw[i % Math.max(1, kw.length)] ?? subject;
    const k2 = kw[(i + 1) % Math.max(1, kw.length)] ?? subject;
    const title = i === 0 ? `${titleCase(subject)}: first principles` : `${titleCase(k1)} — ${angle}`;

    const components: SlideComponent[] = [];
    const p1 = `${
      i === 0
        ? `Let's get straight into ${subject}. At its heart, ${k1} is about understanding how ${k2} behaves and why it matters — once you see the pattern, every later idea clicks into place.`
        : `Building on what we just covered, ${k1} adds a new layer: it explains ${angle} of ${subject}. The key move is to connect ${k1} back to ${k2} rather than memorizing it on its own.`
    }`;
    const p2 = `A useful way to picture ${k1}: imagine you are observing ${subject} in the real world and you write down what changes and what stays the same. That habit — observe, name, relate — is exactly how experts reason about ${k2}, and it transfers to everything else in this topic.`;
    components.push({ type: "prose", paragraphs: [p1, p2] });

    // STEM slides get (at most) one formula, followed by its chart, then a why text
    if (stem && i % 3 === 1) {
      const formulas = [
        "v = \\frac{\\Delta x}{\\Delta t}",
        "a = \\frac{\\Delta v}{\\Delta t}",
        "F = m \\cdot a",
        "E_k = \\tfrac{1}{2} m v^2",
        "p = m \\cdot v",
      ];
      components.push({
        type: "latex",
        formula: formulas[i % formulas.length],
        caption: `The working relationship for ${k1}`,
      });
      const labels = ["t=0", "t=1", "t=2", "t=3", "t=4"];
      const data = labels.map((_, j) => Math.round((j + 1) * (2 + rand() * 6) * 10) / 10);
      components.push({
        type: "chart",
        chartType: "line",
        title: `${titleCase(k1)} over time`,
        labels,
        series: [{ name: titleCase(k1), data }],
        why: `This is what the formula above predicts for ${subject}.`,
      });
      components.push({
        type: "prose",
        paragraphs: [
          `Why this formula is here: it compresses everything we said about ${k1} into one line. Read it slowly — the left side is the effect, the right side is the cause — and the graph underneath shows the same story as a picture.`,
        ],
      });
    } else if (!stem && (imageStyle !== "none" ? i % 3 === 1 : i % 4 === 2)) {
      components.push({
        type: "svg",
        title: `${titleCase(k1)} map`,
        description: `A simple labelled diagram of how ${k1} relates to ${k2}.`,
        sceneHint: `Sketch of ${subject}: a central shape labelled "${k1}" with arrows to two smaller shapes labelled "${k2}" and "example", paper background, ink strokes.`,
      });
    }

    // a compact table every few slides
    if (i % 4 === 2) {
      components.push({
        type: "table",
        title: `${titleCase(k1)} at a glance`,
        columns: ["Aspect", "What to remember", "Watch out for"],
        rows: [
          [titleCase(k1), `Core of ${angle}`, "Confusing it with " + k2],
          [titleCase(k2), `Supports ${k1}`, "Skipping the example"],
        ],
      });
    }

    // generated image placeholder (style thumbnail) on some slides
    if (imageStyle !== "none" && i % 3 === 0) {
      components.push({
        type: "image",
        prompt: `${imageStyle} style illustration of ${subject}, focusing on ${k1}, warm paper background, hand-drawn feel`,
        alt: `Illustration of ${k1} in ${subject}`,
        style: imageStyle,
      });
    }

    // one sticky note per deck
    if (i === Math.min(2, slideCount - 1)) {
      components.push({
        type: "stickynote",
        text: `Remember: ${k1} first, ${k2} second — the order matters in ${subject}.`,
      });
    }

    // quiz on most slides
    const quiz =
      i % 4 === 3
        ? undefined
        : {
            question:
              levelTier(level) === "light"
                ? `Which statement about the role of ${k1} in ${subject} is correct?`
                : levelTier(level) === "mid"
                  ? `You observe ${k2} changing in ${subject}. What does this slide say you should connect it to first?`
                  : `A peer claims ${k1} and ${k2} are interchangeable in ${subject}. Which objection is the strongest?`,
            options: [
              `It works together with ${k2} — ${angle}`,
              `It is just a label with no real role`,
              `It only matters in exams, not in practice`,
              `It replaces ${k2} entirely`,
            ] as [string, string, string, string],
            correctIndex: 0,
            explanation: `This slide showed that ${k1} earns its place through ${angle}, always in relation to ${k2} — it is neither decorative nor a replacement.`,
          };

    slides.push({ title, components, ...(quiz ? { quiz } : {}) });
  }

  return { slides, level, imageStyle, topic };
}

/** Deterministic mock lesson-path structure. */
export function mockLessonPath(opts: {
  description: string;
  template: RepoTemplate;
  unitCount: number;
  lessonsPerUnit: number;
}): LessonPathDraft {
  const { description, template, unitCount, lessonsPerUnit } = opts;
  console.warn(
    `[ai/mock] No AI key configured — generating MOCK lesson path for "${description}" (${template})`,
  );
  const kw = words(description);
  const subject = titleCase(kw.slice(0, 5).join(" ") || description.slice(0, 40));
  const rand = mulberry32(hashStr(description + template));

  const unitNames: Record<RepoTemplate, string[]> = {
    course: ["Foundations", "Core Ideas", "Deeper Mechanics", "Applications", "Mastery Project"],
    restaurant: ["Breakfast", "Lunch", "Dinner", "Drinks & Desserts", "Chef's Specials"],
    service: ["Diagnostics", "Standard Jobs", "Advanced Repairs", "Customer Care", "Safety"],
    shop: ["New Arrivals", "Bestsellers", "Collections", "Care & Materials", "Gift Picks"],
    walkthrough: ["Overview", "How It Works", "Step by Step", "In Practice", "Wrapping Up"],
    news: ["Top Stories", "World", "Business & Tech", "Sports", "In Brief"],
    other: ["Part One", "Part Two", "Part Three", "Part Four", "Part Five"],
  };
  const names = unitNames[template] ?? unitNames.other;

  const units = Array.from({ length: unitCount }, (_, u) => {
    const unitTitle = `${names[u % names.length]}${u >= names.length ? ` ${u + 1}` : ""}`;
    const lessons = Array.from({ length: lessonsPerUnit }, (_, l) => {
      const k = kw[(u * lessonsPerUnit + l) % Math.max(1, kw.length)] ?? subject;
      const title =
        template === "restaurant"
          ? `${titleCase(k)} ${["Classics", "Special", "Delight", "Favorites", "Signature"][l % 5]}`
          : template === "news"
            ? `${titleCase(k)}: ${["What Happened", "The Latest", "Key Development", "By the Numbers", "What's Next"][l % 5]}`
            : `${titleCase(k)} — ${["Basics", "In Practice", "Deep Dive", "Worked Example", "Common Mistakes", "Next Level"][Math.floor(rand() * 6)]}`;
      const objective =
        template === "restaurant"
          ? `Present the story of this dish: where it comes from, what goes into it, how the kitchen prepares it, and how it is best enjoyed. Make the learner smell it through the screen.`
          : template === "news"
            ? `Report the news on ${k} within ${subject}: lead with the headline, then cover what happened, who is involved, where and when, and why it matters — factual and photo-forward, no quiz.`
            : `Teach ${k} within ${subject}: introduce the idea with a concrete example, develop how it works step by step, and finish with a realistic application the learner can try.`;
      return { title, objective };
    });
    return { title: unitTitle, lessons };
  });

  return {
    title: subject,
    description: `A ${template} repository about ${description.slice(0, 140)} — units group related lessons, and each lesson is an evaluated slide deck.`,
    toolName: `${subject} Studio`,
    toolTopic: subject,
    toolInstructions: `Teach "${subject}" one lesson at a time. Be concrete, use everyday examples first, and never re-teach earlier lessons — build on them.`,
    units,
  };
}

/** Deterministic mock coach reply with keyword template detection. */
export function mockCoachReply(userText: string): CoachReply {
  console.warn(`[ai/mock] No AI key configured — MOCK coach reply`);
  const t = userText.toLowerCase();
  let template: RepoTemplate = "course";
  if (/(menu|restaurant|caf|diner|dish|breakfast|lunch|dinner|bakery|brunch|coffee|taco|pozole|mole)/.test(t))
    template = "restaurant";
  else if (/(repair|service|handyman|plumb|electric|hvac|trainee|technician|onboarding|salon)/.test(t))
    template = "service";
  else if (/(shop|store|product|candle|collection|merch|inventory|boutique|etsy)/.test(t))
    template = "shop";
  else if (/(news|briefing|headline|breaking|bulletin|gazette|dispatch|report(ing)?)/.test(t))
    template = "news";

  const title = titleCase(words(userText).slice(0, 6).join(" ") || userText.slice(0, 32));
  const units = template === "course" ? 4 : 3;
  const lessons = template === "course" ? 3 : 3;

  const openers: Record<RepoTemplate, string> = {
    other:
      "A structured collection! I'll break it into units and lessons, each lesson's objective becomes the prompt for an evaluated slide deck, and every play writes a log the next lesson reads.",
    restaurant:
      "Ooh, a menu! Each menu category becomes a unit and each dish its own little lesson — study the dish, then take a quick quiz. Completed plays write back to the notebook, so the next dish builds on the last.",
    service:
      "A service catalog teaches beautifully as lessons. Each service area becomes a unit, each job a lesson with a check-yourself quiz — and every finished run leaves a log so nothing gets re-taught.",
    shop: "A shop collection! Each category becomes a unit and each product a lesson-card that presents itself — perfect for training staff or showing customers around.",
    walkthrough:
      "A guided walkthrough! Each section becomes a unit and each topic an explanation-only deck — the viewer is walked through it with no quizzes, and can visit your profile or step back when they're done.",
    news:
      "A news briefing! Each beat becomes a section and each story its own briefing slide-deck — reported factually with headlines and photos, no quizzes, so readers just get caught up.",
    course:
      "A proper little course! I'll break it into units and lessons, and each lesson's objective becomes the prompt for an evaluated slide deck. Lesson 2 reads Lesson 1's log, so it never re-teaches what you already covered.",
  };

  return {
    reply: `${openers[template]} I've sketched a first plan: "${title}" — about ${units} units of ${lessons} lessons each. Open it in the Lesson Path to tweak every detail, or generate a single slide deck with the second card.`,
    actions: [
      {
        kind: "lesson-path",
        label: `Create "${title}" as a Lesson Path`,
        payload: { title, description: userText.slice(0, 300), template, units, lessons },
      },
      {
        kind: "slides",
        label: `Just a slide deck about "${title}"`,
        payload: { title, template },
      },
    ],
  };
}
