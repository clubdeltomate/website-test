import { z } from "zod";

/* ------------------------------------------------------------------ */
/* Zod schemas for LLM outputs (mirror contracts/types.ts)              */
/* ------------------------------------------------------------------ */

export const levelSchema = z.enum(["A0", "A1", "A2", "B1", "B2", "C1", "C2"]);
export const imageStyleSchema = z.enum(["sketch", "watercolor", "flat", "photo", "none"]);
export const toneSchema = z.enum([
  "neutral",
  "casual",
  "conversational",
  "friendly",
  "professional",
  "formal",
  "scholarly",
]);

/** How each teaching tone should shape the deck's voice and terminology.
 *  Tone is a register dial layered ON TOP of the CEFR reading level — it
 *  changes voice and jargon load, never how much material is taught. */
const TONE_DIRECTIVE: Record<string, string> = {
  neutral:
    "a balanced, clear teaching voice — neither chatty nor stiff. Explain plainly and let the subject lead.",
  casual:
    "an easygoing, everyday voice. Use plain words, short sentences, and the occasional aside; introduce only the field terms that are truly necessary and gloss them in plain language. Favour understanding over precise jargon.",
  conversational:
    "a direct, conversational voice — address the reader as \"you\", ask the occasional rhetorical question, and explain ideas the way you would to a curious friend. Keep terminology light and always unpacked.",
  friendly:
    "a warm, encouraging voice. Reassure the reader, celebrate small wins, and frame difficulty as normal. Keep jargon modest and always explained.",
  professional:
    "a polished, professional voice — clear, efficient, and confident, the way a good industry trainer briefs a team. Use standard terminology precisely but without showing off.",
  formal:
    "a formal, impersonal register — full sentences, careful structure, no slang or contractions. Define terms exactly and maintain an objective distance.",
  scholarly:
    "a scholarly, academic register — technically precise and dense with the field's proper terminology, assuming an engaged reader. Use exact terms of art (with a brief gloss on first use), reference mechanisms and edge cases, and argue with rigour.",
};
export const templateSchema = z.enum(["course", "restaurant", "service", "shop", "walkthrough", "news", "other"]);

export const slideComponentSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("prose"), paragraphs: z.array(z.string().min(1)).min(1) }),
  z.object({
    type: z.literal("latex"),
    formula: z.string().min(1),
    caption: z.string().optional(),
  }),
  z.object({
    type: z.literal("chart"),
    chartType: z.enum(["bar", "line", "pie", "area"]),
    title: z.string(),
    labels: z.array(z.string()).min(2),
    series: z.array(z.object({ name: z.string(), data: z.array(z.number()) })).min(1),
    why: z.string().optional(),
  }),
  z.object({
    type: z.literal("svg"),
    title: z.string(),
    description: z.string(),
    sceneHint: z.string(),
  }),
  z.object({
    type: z.literal("table"),
    title: z.string().optional(),
    columns: z.array(z.string()).min(1),
    rows: z.array(z.array(z.string())).min(1),
  }),
  z.object({ type: z.literal("stickynote"), text: z.string().min(1) }),
  z.object({
    type: z.literal("image"),
    prompt: z.string().min(1),
    alt: z.string().min(1),
    style: imageStyleSchema,
  }),
  z.object({
    type: z.literal("code"),
    language: z.string(),
    code: z.string().min(1),
    caption: z.string().optional(),
  }),
  z.object({
    type: z.literal("wolfram"),
    query: z.string().min(2).max(200),
    caption: z.string().max(300).optional(),
  }),
]);

export const quizKindSchema = z.enum(["mcq", "mcq2", "fillblank", "typed", "solve"]);

/**
 * A slide's evaluation. Backward compatible: a quiz with no `kind` and 4
 * options parses as a 4-option MCQ. mcq2 = 2 options; fillblank/typed carry an
 * `answer` (accepted / reference) and no options.
 */
export const slideQuizSchema = z
  .object({
    kind: quizKindSchema.default("mcq"),
    question: z.string().min(1),
    options: z.array(z.string().min(1)).optional(),
    correctIndex: z.number().int().min(0).optional(),
    answer: z.string().min(1).optional(),
    acceptableAnswers: z.array(z.string().min(1)).optional(),
    explanation: z.string().min(1),
  })
  .superRefine((q, ctx) => {
    const addErr = (message: string) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, message });
    if (q.kind === "mcq" || q.kind === "mcq2") {
      const need = q.kind === "mcq" ? 4 : 2;
      if (!q.options || q.options.length !== need) addErr(`${q.kind} needs exactly ${need} options`);
      if (
        typeof q.correctIndex !== "number" ||
        q.correctIndex < 0 ||
        q.correctIndex >= (q.options?.length ?? 0)
      ) {
        addErr(`${q.kind} needs a valid correctIndex`);
      }
    } else {
      // fillblank / typed / solve all carry a reference "answer"
      if (!q.answer || !q.answer.trim()) addErr(`${q.kind} needs an "answer"`);
    }
  });

export const slideSchema = z.object({
  title: z.string().min(1),
  components: z.array(slideComponentSchema).min(1),
  quiz: slideQuizSchema.optional(),
});

export const slideDeckSchema = z.object({
  slides: z.array(slideSchema).min(1),
  level: levelSchema,
  imageStyle: imageStyleSchema,
  topic: z.string().min(1),
});

export const lessonPathSchema = z.object({
  title: z.string().min(3),
  description: z.string().min(1),
  toolName: z.string().min(3),
  toolTopic: z.string().min(1),
  toolInstructions: z.string().min(1),
  units: z
    .array(
      z.object({
        title: z.string().min(1),
        lessons: z
          .array(
            z.object({
              title: z.string().min(1),
              objective: z.string().min(10),
            }),
          )
          .min(1),
      }),
    )
    .min(1),
});

export const coachResponseSchema = z.object({
  reply: z.string().min(1),
  actions: z
    .array(
      z.object({
        kind: z.enum(["lesson-path", "slides", "repos"]),
        label: z.string().min(1),
        payload: z
          .object({
            title: z.string().optional(),
            description: z.string().optional(),
            template: templateSchema.optional(),
            units: z.number().int().optional(),
            lessons: z.number().int().optional(),
            slug: z.string().optional(),
          })
          .optional(),
      }),
    )
    .default([]),
});

export type LessonPathDraft = z.infer<typeof lessonPathSchema>;

/* ------------------------------------------------------------------ */
/* System prompts                                                       */
/* ------------------------------------------------------------------ */

export interface LayoutTemplateForPrompt {
  name: string;
  tags: string[];
  components: string[];
}

export function buildSlidesSystemPrompt(opts: {
  level: string;
  imageStyle: string;
  tone?: string;
  purpose?: "education" | "commercial" | "walkthrough" | "news";
  /** how much explanatory text each slide carries — biases the paragraph floor */
  textDensity?: "minimal" | "brief" | "standard" | "detailed";
  /** news decks only: the moment in time the briefing reports from */
  newsPeriod?: string;
  /** the exact topic/item this deck is about (e.g. a product name) */
  subject?: string;
  previouslyTaught: string | null;
  layoutTemplates?: LayoutTemplateForPrompt[];
}): string {
  const toneDirective = TONE_DIRECTIVE[opts.tone ?? "neutral"] ?? TONE_DIRECTIVE.neutral;
  const commercial = opts.purpose === "commercial";
  // A walkthrough explains like a lesson but never tests — no quizzes at all.
  const walkthrough = opts.purpose === "walkthrough";
  // A news briefing reads like a newspaper section — factual reporting, no quiz.
  const news = opts.purpose === "news";
  // Minimum number of DISTINCT explanatory paragraphs a teaching slide must
  // carry, scaled to the CEFR band. Higher levels demand a fuller page: an
  // advanced (C1/C2) reader gets several substantial paragraphs, not one line.
  // Commercial showcases are exempt — listing copy should be as long as it
  // needs, not padded to a floor. A walkthrough gets at least 2 paragraphs even
  // at low levels: its whole point is a written explanation, so it must never
  // lean on visuals alone.
  const baseFloor = ["C1", "C2"].includes(opts.level)
    ? 4
    : ["B1", "B2"].includes(opts.level)
      ? 3
      : ["A2"].includes(opts.level)
        ? 2
        : 1;
  const purposeFloor = commercial || news ? 1 : walkthrough ? Math.max(2, baseFloor) : baseFloor;
  // Author-chosen text amount shifts the floor up or down (same idea, more/less
  // words). "detailed" adds substantially; "brief" trims to essentials.
  const density = opts.textDensity ?? "standard";
  const densityDelta =
    density === "minimal" ? -99 : density === "brief" ? -1 : density === "detailed" ? 2 : 0;
  const paraFloor = Math.max(1, purposeFloor + densityDelta);
  // Concrete word targets per tier so the knob visibly changes the output —
  // brief/standard/detailed aim ~25% above what models naturally produce.
  const textAmountDirective =
    density === "minimal"
      ? "TEXT AMOUNT — MINIMAL: HARD CAP of TWO sentences of written prose per slide, total. Make those two sentences count — specific and vivid — but never write a third. Visuals carry the rest."
      : density === "brief"
        ? "TEXT AMOUNT — BRIEF: concise but real — each slide carries roughly 60-90 words of written prose (about 3-5 sentences). Cut filler and tangents, never the substance."
        : density === "detailed"
          ? "TEXT AMOUNT — DETAILED: write fuller explanations — each slide carries roughly 280-380 words of written prose across its paragraphs. Go into depth with examples and consequences; when there is nothing genuinely new to add, reinforce the SAME point from a fresh angle or a closely-related supporting idea, so each slide carries substantial reading."
          : "TEXT AMOUNT — STANDARD: a solid, satisfying amount of reading — each slide carries roughly 140-190 words of written prose (two to three meaty paragraphs, not one short blurb).";

  const memory = opts.previouslyTaught
    ? `
PREVIOUSLY TAUGHT in this course — treat every item below as slides that already exist earlier in this same course. HARD anti-repetition rules:
(a) NEVER re-define, re-introduce, or re-explain anything listed below — not even "as a reminder". Reference it by name in at most ONE short clause ("using the hyphal growth from Lesson 2, ...").
(b) When a prior concept is needed, USE it — apply it, extend it, contrast it with the new material — exactly like a university course refers back to week 1 instead of re-teaching it.
(c) Every paragraph you write must teach material NOT covered below. If a slide would mostly restate prior material, replace it with the next new idea instead.
${opts.previouslyTaught}
`
    : "";

  const templates =
    opts.layoutTemplates && opts.layoutTemplates.length > 0
      ? `
SLIDE LAYOUT TEMPLATES — this is the ONLY set of slide configurations you may use. Build each slide as one of these layouts, following its component types IN ORDER and including ALL of its steps; pick the layout that best fits the concept and vary layouts across the deck. A layout with several "Text" steps means that many DISTINCT paragraphs (never repeat one). The evaluation step names map to the quiz "kind" (see rule 6): "Multiple choice"→mcq, "2-option"→mcq2, "Fill blank"→fillblank, "Typed answer"→typed, "Solve (worksheet)"→solve. Emit the quiz with EXACTLY that kind and its required fields — do not substitute one kind for another. These layouts are already chosen for this deck's difficulty level, so honor the text density they imply.
${opts.layoutTemplates.map((t) => `- ${t.name}${t.tags.length ? ` [${t.tags.join(", ")}]` : ""}: ${t.components.join(" -> ")}`).join("\n")}
When a layout calls for a Table, emit a valid table component with real rows, e.g. {"type":"table","columns":["Rule","Example"],"rows":[["Add -ed for past tense","walk -> walked"],["Double the consonant","stop -> stopped"]]}. When it calls for a Graph, emit a chart component, e.g. {"type":"chart","chartType":"bar","title":"...","labels":["A","B","C"],"series":[{"name":"...","data":[3,5,2]}]}. A malformed table/chart is dropped, which breaks the layout — always give columns+rows / labels+series.
MATH & PHYSICS: a template tagged [worked-example] is an EXPLAINER — its text must fully WORK THROUGH a sample problem step by step (state it, show each step with the formula/latex, explain the move), and its Multiple-choice question must probe ONE step of that solution ("Which step introduces...?", "What is the value after step 2?"). A [problem-solving] template ("Solve...") is the opposite: give a fresh problem for the student to solve themselves. When you have freedom to sequence math slides, teach first — show a worked example (explainer) BEFORE asking the student to solve one themselves.
VISUAL STUDY: a template tagged [anatomy] (text · image · text · evaluation) is for studying an item VISUALLY. Make the image the centrepiece — a clear, labelled depiction of the specific structure/specimen/object. The text before it introduces what the learner is looking at; the text after it describes and explains it (parts, function, what to notice); the evaluation checks that they can identify or reason about what they saw. Match the evaluation to the template's step (mcq / typed / fillblank / 2-option).
`
      : "";

  return `You are the SketchLearn ${commercial ? "showcase" : news ? "news briefing" : "teaching"} engine. You write ${commercial ? "short, persuasive slide presentations that SHOWCASE ONE item (a dish, a service, or a product) so a viewer wants it" : news ? "slide-format news briefings that REPORT the news on a topic, clearly and factually" : "evaluated slide decks that teach ONE topic deeply"}.
${
  commercial
    ? `
SHOWCASE MODE — this is a MENU / SERVICE / SHOP listing, NOT a lesson:
- THE ITEM YOU ARE SHOWCASING IS: "${opts.subject ?? "the given topic"}". EVERY slide must be about THIS EXACT item. Never introduce, list, or compare other products/dishes/services. If the item is a specific real product, present ITS real, known characteristics — do not invent unrelated features or capabilities it doesn't have.
- Present ONE item and make it appealing: what it is, why it's worth choosing, what makes it special (story, ingredients/materials, craftsmanship, benefits). Write it like great menu or catalog copy, adapted to the chosen tone and level.
- NO quizzes and NO evaluations — the commercial layout templates have no quiz step, so never add one. Do NOT test the viewer.
- Keep it tight: usually 3-4 slides. Photos matter — use the image steps for vivid, specific shots of the item. Tables are for ingredients / specs / what's-included.
- Do NOT put contact details, prices, or "order now" text in the slides — the app adds the contact/order step at the end of the presentation itself.
- The last slide should land the pitch (why choose this), leaving the viewer ready to act.
`
    : ""
}
${
  walkthrough
    ? `
WALKTHROUGH MODE — this is an EXPLANATION the viewer is guided through, NOT an evaluated lesson:
- Teach and explain "${opts.subject ?? "the given topic"}" clearly and completely, building idea by idea, exactly like a good lesson — same depth and rigor.
- TEXT CARRIES THE EXPLANATION. Every content slide MUST include real written prose that explains the point in words — at least two solid paragraphs. Images, tables, charts and diagrams SUPPORT the text; they never replace it. Never ship a slide that is just a visual with a caption: say, in sentences, what the visual shows, what to notice, and what it means.
- BUT never test the viewer: emit NO quiz/evaluation on ANY slide. If a layout template lists an evaluation step, SKIP that step and end the slide on its explanatory content. Do not ask questions the viewer must answer.
- The goal is understanding, not assessment — walk them through it and let the ideas land.
`
    : ""
}
${
  news
    ? `
TIME TRAVEL NEWS MODE — this is a slide-format NEWS BRIEFING about "${opts.subject ?? "the given topic"}", read like a newspaper section from a chosen moment in time, NOT a lesson:${
      opts.newsPeriod
        ? `\n- TIME PERIOD — the reader has "traveled" to "${opts.newsPeriod}" and is reading that day's paper:
  · PAST periods: report the news AS IT STOOD then. Every story's headline, facts and framing reflect what was happening THEN, not now, and must not include later developments. If you lack specific facts for that period, report the general, well-documented state of the beat at that time in careful, non-fabricated terms.
  · FUTURE periods: there are no facts yet — write a plausible, internally-consistent speculative briefing of what the beat could look like at that time, extrapolated from real current trends and known science. Keep the straight newspaper voice (it reads as that era's paper, not as prediction), and never contradict established present-day facts about how we got there.
  · ERA FIT — ADAPT THE TOPIC TO THE TIME: if the topic as named does not exist in that period (baseball in the year 1030, smartphones in the Jurassic), do NOT force an anachronism. Report that era's closest genuine equivalent instead (village games and contests instead of baseball; natural events instead of gadgets), acknowledging the requested angle in at most one clause. Likewise in the far future, if the topic has plausibly transformed or disappeared, report what took its place. The reader asked "what was the news about this topic THEN" — answer with what that time genuinely had.`
        : ""
    }
- Report, don't teach or sell: each slide is ONE news item / story / development on the topic, with its OWN fresh headline written for that era. Do NOT repeat the same story across slides.
- EVERY slide is a newspaper clipping with THREE parts, always present together:
  (1) HEADLINE — the slide TITLE.
  (2) PHOTO — an image component with a specific, relevant news photo prompt${opts.imageStyle === "none" ? " (SKIP only because image style is 'none')" : " (REQUIRED on every slide)"}.
  (3) SUMMARY — a written prose summary of the story, 2 to 4 sentences, reporting what happened, who is involved, where and when, and why it matters (inverted pyramid: most important facts first).
- NEVER ship a slide that is just a headline, and NEVER a headline with only a picture and no words. The written summary is mandatory on every slide — the reader is flipping through a paper and reading each brief, not looking at captions.
- Choose layouts that pair an image with prose; add a table or chart when the story has figures (scores, standings, prices, counts). Mix images, tables and charts across the deck, but the photo + written summary are always there.
- Attribution & accuracy: report only what is supported by the provided facts (and the web-verified facts if given). Do NOT invent quotes, statistics, outlets, or events. If the exact date isn't given, keep timing general ("this week", "recently") rather than fabricating one.
- NO quizzes and NO evaluations of ANY kind — never test the reader. If a layout lists an evaluation step, SKIP it and end the slide on its reporting.
- Tone stays factual and neutral regardless of the chosen register; the reader is here to be informed, not persuaded or quizzed.
`
    : ""
}
${textAmountDirective}
SPECIFICITY (non-negotiable): every paragraph you write must be SPECIFIC to "${opts.subject ?? "the given topic"}" and the user's instructions — concrete names, ingredients, flavors, facts, numbers, sensory details. NEVER write placeholder prose that could fit any topic ("look closely at…", "study what it shows", "this illustrates the concept"). A paragraph that would still make sense with the topic swapped out is a failed paragraph — rewrite it with real substance about THIS topic. EVERY slide must carry at least one such written paragraph; never rely on a title + visual alone.
${commercial ? "SHOWCASE" : news ? "BRIEFING" : "TEACHING"} RULES (non-negotiable):
1. NO greeting/welcome/outline slide — start teaching immediately on slide 1.
2. EVERY slide MUST be built from ONE of the SLIDE LAYOUT TEMPLATES listed below — use that template's exact component configuration (its component types, in the given order). Do NOT invent a slide shape that is not in the catalog, and do NOT drop any of a template's steps. Because every template pairs its visual/data steps with explanatory text, this means a slide is never just an image (or just a chart/table/diagram/formula/code) next to a question — the text step explains, in words, what the visual shows, what to notice in it, and what it means, and the quiz tests that explanation. Slides build introduce -> develop -> apply; never restate an earlier point; the deck reads as ONE continuous piece of teaching, with at most a one-clause stitch between slides.
3. Choose components deliberately per concept from this palette: prose, chart (bar/line/pie/area with real plausible data), latex, svg (a diagram description the app sketches), table (compact, few columns), stickynote (max ONE per deck, for a mnemonic or key warning), image (a vivid visual with an alt text and a generation prompt), code (short snippet), wolfram (a LIVE Wolfram|Alpha computed explanation rendered on the slide — set "query" to a precise computable input like "derivative of x^3 sin(x)" or "integrate 1/(1+x^2)"; perfect for showing a solved derivative/integral/equation step by step, with your own text before/after interpreting the result).
4. SUBJECT GATING: latex, code and wolfram ONLY for math/STEM/technical topics. Humanities, languages, business, food, history -> prose + images + tables + diagrams + sticky notes.
5. HARD max ONE latex formula per slide. When a formula or graph is present, order components: (1) the formula, (2) its graph/diagram, (3) a short "why it is here" text.
6. EVALUATION ("quiz"): each slide's evaluation MUST match the evaluation step its layout template lists, using the "kind" field — answerable ONLY from that slide's content plus everyday knowledge, difficulty matched to level "${opts.level}":
   - "Multiple choice" -> {"kind":"mcq","question":"...","options":["a","b","c","d"],"correctIndex":0,"explanation":"..."} — EXACTLY 4 options, ONE objectively correct.
   - "2-option" -> {"kind":"mcq2","question":"...","options":["a","b"],"correctIndex":0,"explanation":"..."} — EXACTLY 2 options (e.g. true/false, this/that).
   - "Fill blank" -> {"kind":"fillblank","question":"The past tense of run is ___.","answer":"ran","acceptableAnswers":["ran"],"explanation":"..."} — put a ___ blank in the question; "answer" is the exact missing word/phrase; add other correct spellings/forms to acceptableAnswers.
   - "Typed answer" -> {"kind":"typed","question":"In one sentence, why ...?","answer":"a concise correct reference answer","explanation":"..."} — an open recall/short-answer question the student types; "answer" is the model answer used to grade them.
   - "Solve (worksheet)" -> {"kind":"solve","question":"State the exact problem to solve (with all given values/conditions).","answer":"the correct FINAL answer (a number, expression, or short result — e.g. 'x = 3/2' or '12.5 m/s')","explanation":"the full step-by-step worked solution"} — a math/physics/chemistry problem the student works out by hand on a scratchpad and then types their final answer; "answer" is the final result used to grade them, "explanation" is the worked method. Use this kind ONLY for problems with a definite procedural solution.
   Choose the kind from the template's step; do NOT substitute a multiple-choice for a fill-blank/typed/solve step. NEVER phrase mcq/mcq2 as "explain"/"in your own words"; those belong to the typed kind. A "solve" step's question must be an actual solvable problem statement.
7. Images use imageStyle "${opts.imageStyle}"${opts.imageStyle === "none" ? " — style is 'none', so DO NOT emit any image components" : ""}.
8. CEFR LEVEL "${opts.level}" — calibrate reading difficulty precisely to this level (this controls VOCABULARY and SENTENCE COMPLEXITY, not how much you teach; every slide still fully explains its visual):
   - A0 (pre-beginner): 1-2 very short sentences, ~present tense, only the ~300 most common words, define/illustrate each key word; lean on images.
   - A1 (beginner): short simple sentences, common everyday vocabulary, one idea per sentence, define every term with a concrete example.
   - A2 (elementary): simple connected sentences, familiar topics, basic connectors (because, so, then).
   - B1 (intermediate): clear standard language, some subordinate clauses, explain any less-common term.
   - B2 (upper-intermediate): detailed paragraphs, some abstraction and comparison, precise terminology introduced with brief gloss.
   - C1 (advanced): complex, nuanced prose, dense information, edge cases, field-specific terms assumed.
   - C2 (mastery): near-native academic register, sophisticated argument, subtlety and exceptions, no hand-holding.
   Match sentence length and word choice to the level: a low level means SIMPLER language, not shallower coverage; a high level means denser, more sophisticated language.
   EXERCISE DIFFICULTY scales with the level too, not just the language: translate the CEFR band into how hard the PROBLEMS/exercises are. For a math/physics/chemistry problem (or any field's exercise), A0/A1 = a single one-step problem with small whole numbers; A2/B1 = two-to-three steps; B2 = multi-step with some abstraction; C1/C2 = genuinely challenging, multi-concept problems with edge cases. Pick problems, quiz questions and worked examples whose DIFFICULTY matches level "${opts.level}" — an A1 solve/quiz must be easy, a C2 one must be hard.
   LENGTH scales with level too: higher levels get LONGER text in general — A0/A1 prose paragraphs are 1-2 short sentences; A2/B1 are ~2-4 sentences; B2 are full multi-sentence paragraphs; C1/C2 prose paragraphs are substantial and challenging (roughly 4-7 dense sentences each), giving the advanced reader more to work through. This is a general rule, not absolute: a genuinely simple point may still be stated briefly at any level — don't pad — but by default a higher-level reader should get more, lengthier, more demanding text.
   PARAGRAPH FLOOR (hard requirement for level "${opts.level}"): every teaching slide MUST present at least ${paraFloor} DISTINCT explanatory paragraph${paraFloor > 1 ? "s" : ""} of body text. Count paragraphs across the slide's Text/prose steps: either emit several prose components, or give a prose component a "paragraphs" array with ${paraFloor}+ separate entries — a slide with a single short paragraph at this level is WRONG. Each paragraph must make a different point (setup, mechanism, worked detail, implication), never restate another. A visual (image/table/chart/diagram) does NOT count toward this floor; it is in addition to the ${paraFloor} paragraph${paraFloor > 1 ? "s" : ""}.
   EXCEPTION — "solve" (worksheet) slides are EXEMPT from the paragraph floor: a problem statement should be exactly as long as the problem needs, no more. A math or physics exercise is usually ONE concise paragraph that just states the givens and what to find — do NOT pad it. Only use more text when the problem genuinely needs it (e.g. a multi-part chemistry or biology scenario, or setup that must be explained before it can be solved). Judge the length from the topic.
9. TEACHING TONE — write the whole deck in ${toneDirective} Tone sets the VOICE and how much field-specific terminology you lean on; it does NOT change the reading level's sentence complexity or how much you teach. Keep this voice consistent across every slide, including quiz questions and explanations.
${memory}${templates}
OUTPUT: STRICT JSON ONLY (no markdown fences, no commentary) matching exactly:
{"slides":[{"title":"...","components":[...],"quiz":{"kind":"mcq","question":"...","options":["a","b","c","d"],"correctIndex":0,"explanation":"..."}}],"level":"${opts.level}","imageStyle":"${opts.imageStyle}","topic":"..."}
(set "quiz.kind" to the evaluation the slide's layout calls for: mcq, mcq2, fillblank, typed, or solve, with the fields shown in rule 6.)`;
}

export function buildLessonPathPrompt(opts: {
  description: string;
  template: string;
  unitCount: number;
  lessonsPerUnit: number;
  /** text extracted from files the user attached (menu, catalog, syllabus…) */
  reference?: string;
}): string {
  const guidance: Record<string, string> = {
    course:
      "A learning course: units are topic areas, lessons are teachable concepts. Each lesson objective is a TEACHING PROMPT (imperative, specific, mentions what the learner must be able to do at the end).",
    restaurant:
      "A restaurant menu presented as learning: units are menu categories (e.g. Breakfast, Lunch, Dinner), lessons are individual dishes. Each lesson objective is a STORY/EXPLORATION presentation prompt of that dish: its origins, ingredients, preparation, how it is served and enjoyed.",
    service:
      "A service catalog as training: units are service areas, lessons are individual jobs/services. Objectives teach what the service is, when it is needed, and how it is done.",
    shop: "A shop collection as product stories: units are categories, lessons are products. Objectives present each product's story, materials, use, and care.",
    other:
      "A structured collection: units group related lessons; each lesson objective is a presentation prompt.",
  };
  const reference = opts.reference?.trim()
    ? `\n\nATTACHED REFERENCE MATERIAL — the user uploaded this; build the units, lessons and objectives FROM IT, staying faithful to its actual items, sections, names and details (do not invent items it doesn't contain):\n"""\n${opts.reference.trim().slice(0, 12000)}\n"""`
    : "";
  return `You are the SketchLearn lesson-path architect. Draft a complete repository structure.

SUBJECT: ${opts.description}
TEMPLATE: ${opts.template} — ${guidance[opts.template] ?? guidance.other}${reference}

RULES:
- Exactly ${opts.unitCount} units, each with exactly ${opts.lessonsPerUnit} lessons.
- Lesson order must build logically (lesson N assumes lessons 1..N-1).
- Objectives are 1-3 sentence prompts that will be fed directly to a slide-generation engine. Make them concrete and self-contained.
- toolName: a short friendly name for the slide tool that will present these lessons. toolTopic: the overall subject line. toolInstructions: 2-4 sentences of standing guidance for the slide tool (tone, audience, style).

OUTPUT: STRICT JSON ONLY (no markdown fences) matching exactly:
{"title":"...","description":"...","toolName":"...","toolTopic":"...","toolInstructions":"...","units":[{"title":"...","lessons":[{"title":"...","objective":"..."}]}]}`;
}

export const COACH_SYSTEM_PROMPT = `You are the SketchLearn Coach — a friendly pencil-mascot assistant inside a learning-studio app. You help people decide what to build: a Lesson Path (a repository of units -> lessons plus a linked slide tool, great for courses, restaurant menus, service catalogs, shop collections) or a single slide deck.

STYLE: warm, encouraging, concise (2-5 sentences), plain text. Never use markdown headers or tables.

BEHAVIOR:
- If the user describes something to teach/present, reply with a short plan and include a "lesson-path" action (with title, template one of course|restaurant|service|shop|other, rough units & lessons counts) and optionally a "slides" action for a single deck.
- If the user asks to browse/resume existing work, include a "repos" action.
- If the intent is unclear, ask ONE clarifying question, no actions.
- Restaurant/menu/cafe/dish words -> template restaurant. Repair/service/training/onboarding -> service. Shop/store/product/collection -> shop. Otherwise course.

OUTPUT: STRICT JSON ONLY: {"reply":"...","actions":[{"kind":"lesson-path|slides|repos","label":"short card label","payload":{"title":"...","template":"course","units":4,"lessons":12}}]}`;

/* ------------------------------------------------------------------ */
/* Helpers                                                              */
/* ------------------------------------------------------------------ */

/** kebab-case slug, stable */
export function slugify(text: string): string {
  const base = text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return base || "untitled";
}

/** 5-char repo ref derived from slug (uppercase letters+digits), e.g. K7J2A */
export function repoRef(slug: string): string {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let h = 5381;
  for (let i = 0; i < slug.length; i++) {
    h = ((h << 5) + h + slug.charCodeAt(i)) >>> 0;
  }
  let out = "";
  let x = h;
  for (let i = 0; i < 5; i++) {
    out += alphabet[x % alphabet.length];
    x = Math.floor(x / alphabet.length) + h;
  }
  return out;
}

/**
 * Salvage an LLM deck draft before strict validation. Real model output is
 * imperfect in small ways — a quiz with 3 options, a chart with string data,
 * an image with a made-up style — and rejecting the WHOLE deck for one bad
 * piece wastes an otherwise good generation. Drop invalid components and
 * quizzes individually, drop slides left with no components, and fill the
 * top-level level/imageStyle/topic fields the caller already knows.
 */
export function repairDeckDraft(
  raw: unknown,
  defaults: { level: string; imageStyle: string; topic: string },
): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const draft = raw as Record<string, unknown>;
  if (!levelSchema.safeParse(draft.level).success) draft.level = defaults.level;
  if (!imageStyleSchema.safeParse(draft.imageStyle).success) draft.imageStyle = defaults.imageStyle;
  if (typeof draft.topic !== "string" || !draft.topic.trim()) draft.topic = defaults.topic;

  if (Array.isArray(draft.slides)) {
    draft.slides = draft.slides
      .map((slide) => {
        if (!slide || typeof slide !== "object") return null;
        const s = slide as Record<string, unknown>;
        if (Array.isArray(s.components)) {
          const kept = s.components.filter((c) => {
            const comp = c as Record<string, unknown> | null;
            // images sometimes carry an invented style — snap it to the deck's
            if (
              comp &&
              comp.type === "image" &&
              !imageStyleSchema.safeParse(comp.style).success
            ) {
              comp.style = defaults.imageStyle;
            }
            // salvage prose whose paragraphs array has empty/blank entries
            // (dropping it whole is what left slides text-less before)
            if (comp && comp.type === "prose" && Array.isArray(comp.paragraphs)) {
              comp.paragraphs = comp.paragraphs.filter(
                (p) => typeof p === "string" && p.trim().length > 0,
              );
            }
            const ok = slideComponentSchema.safeParse(c).success;
            if (!ok) console.warn("[ai/repair] dropping invalid slide component:", comp?.type);
            return ok;
          });
          s.components = kept;
        }
        if (s.quiz !== undefined && !slideQuizSchema.safeParse(s.quiz).success) {
          console.warn("[ai/repair] dropping invalid quiz on slide:", s.title);
          delete s.quiz;
        }
        // If a slide lost ALL its components (e.g. the model emitted only
        // eval-type components, which aren't renderable), salvage it with a
        // text paragraph instead of dropping it — dropping shrinks the deck
        // below the requested slide count.
        if (Array.isArray(s.components) && s.components.length === 0 && (s.title || s.quiz)) {
          s.components = [{ type: "prose", paragraphs: [slideFallbackParagraph(s as LooseSlide)] }];
        }
        return s;
      })
      .filter(
        (s) =>
          s !== null && Array.isArray(s.components) && s.components.length > 0,
      );
  }
  return draft;
}

type LooseQuiz = {
  question?: string;
  options?: string[];
  correctIndex?: number;
  explanation?: string;
};
type LooseSlide = {
  title?: string;
  quiz?: LooseQuiz | null;
  components?: Array<{ type?: string; paragraphs?: unknown }>;
};

/** True when a slide carries at least one prose component with real text. */
export function slideHasProse(slide: LooseSlide): boolean {
  return (slide.components ?? []).some(
    (c) =>
      c?.type === "prose" &&
      Array.isArray(c.paragraphs) &&
      c.paragraphs.some((p) => typeof p === "string" && p.trim().length > 0),
  );
}

/** True when EVERY slide in a deck has explanatory prose. */
export function everySlideHasProse(deck: { slides?: LooseSlide[] }): boolean {
  const slides = deck?.slides;
  if (!Array.isArray(slides) || slides.length === 0) return false;
  return slides.every(slideHasProse);
}

const VISUAL_LABEL: Record<string, string> = {
  image: "the image",
  chart: "the chart",
  svg: "the diagram",
  wolfram: "the Wolfram|Alpha explanation",
  table: "the table",
  latex: "the formula",
  code: "the code",
};

/** Build an on-topic paragraph for a text-less slide from its own quiz. The
 *  quiz's correct answer + explanation ARE real teaching content, so this
 *  yields prose related to the question instead of a generic placeholder. */
function proseFromQuiz(quiz: LooseQuiz | null | undefined): string | null {
  if (!quiz) return null;
  const correct =
    typeof quiz.correctIndex === "number" ? quiz.options?.[quiz.correctIndex] : undefined;
  const claim = correct?.trim().replace(/[.!?]+$/, "");
  const explanation = quiz.explanation?.trim();
  const parts = [claim ? `${claim}.` : null, explanation || null].filter(Boolean);
  return parts.length > 0 ? parts.join(" ") : null;
}

/**
 * Last-resort safety net: guarantee every slide has explanatory text. If the
 * model still returns a slide that is only a visual + question, prepend a
 * prose paragraph. Prefer text built from the slide's own quiz (its correct
 * answer + explanation), which is real, on-topic teaching content; only fall
 * back to a title/visual sentence when there is no quiz to draw from. The
 * prompt is expected to do this well; this just prevents a text-less or
 * off-topic slide from ever shipping.
 */
/** A single explanatory paragraph for a slide that has none — drawn from its
 *  quiz (real, on-topic) when possible, else its title/visual. Shared by the
 *  repair salvage (so a slide is never dropped for shrinking the deck) and the
 *  final ensureExplanatoryProse net. */
export function slideFallbackParagraph(slide: LooseSlide, purpose?: string, topic?: string): string {
  const fromQuiz = proseFromQuiz(slide.quiz);
  if (fromQuiz) return fromQuiz;
  const visual = (slide.components ?? []).find((c) => c?.type && VISUAL_LABEL[c.type]);
  const title = (slide.title ?? "this idea").trim();
  const about = topic?.trim();
  // Tailor the net to the deck's own prompt and register — a menu slide must
  // read like menu copy about ITS dish, never like a classroom instruction.
  if (purpose === "commercial") {
    return about
      ? `${title} is one of the touches that makes ${about} worth choosing — prepared and presented with real care. ${visual ? `The ${VISUAL_LABEL[visual.type as string].replace(/^the /, "")} below shows it up close: the textures, colors and details tell you how it will taste before the first bite.` : `Ask for it by name — it is a highlight of ${about}.`}`
      : `${title} — prepared and presented with care${visual ? `; ${VISUAL_LABEL[visual.type as string]} below shows it up close` : ""}.`;
  }
  if (purpose === "walkthrough" && about) {
    return `${title} is a key step in understanding ${about}. ${visual ? `${VISUAL_LABEL[visual.type as string][0].toUpperCase()}${VISUAL_LABEL[visual.type as string].slice(1)} below shows how this piece fits into ${about} as a whole.` : `It connects directly to the rest of ${about}.`}`;
  }
  if (about && purpose !== "news") {
    return visual
      ? `${title} is a core part of ${about}: ${VISUAL_LABEL[visual.type as string]} below illustrates how it works within ${about} — the parts it shows are the ones this lesson builds on.`
      : `${title} — the next building block of ${about}.`;
  }
  // A news slide must read like reporting, never like a lesson ("study what
  // it shows"): keep the newspaper register even in the safety net.
  if (purpose === "news") {
    return visual
      ? `${title} — a developing story on this beat. ${VISUAL_LABEL[visual.type as string][0].toUpperCase()}${VISUAL_LABEL[visual.type as string].slice(1)} below carries the key facts of the report: what happened, who is involved, and the figures that matter.`
      : `${title} — a developing story on this beat; further details were still coming in at press time.`;
  }
  return visual
    ? `Look closely at ${title}: ${VISUAL_LABEL[visual.type as string]} below illustrates it. Study what it shows and how the parts relate.`
    : `Let's work through ${title}.`;
}

export function ensureExplanatoryProse<T extends { slides?: LooseSlide[] }>(
  deck: T,
  purpose?: string,
  topic?: string,
): T {
  for (const slide of deck.slides ?? []) {
    if (slideHasProse(slide)) continue;
    if (!Array.isArray(slide.components)) slide.components = [];
    console.warn("[ai/prose] slide had no explanatory text — injecting a fallback paragraph:", slide.title);
    slide.components.unshift({ type: "prose", paragraphs: [slideFallbackParagraph(slide, purpose, topic)] });
  }
  return deck;
}

type ShuffleQuiz = { options?: unknown; correctIndex?: unknown };
type ShuffleSlide = { quiz?: ShuffleQuiz | null };

/**
 * Randomize the position of each quiz's correct answer. Models overwhelmingly
 * place the correct option first (correctIndex 0), so without this every
 * question in a deck has answer "A". Fisher-Yates shuffle the options and
 * re-point correctIndex at the correct option's new slot. RNG is injectable
 * for deterministic tests.
 */
export function shuffleQuizAnswers<T extends { slides?: ShuffleSlide[] }>(
  deck: T,
  rng: () => number = Math.random,
): T {
  for (const slide of deck.slides ?? []) {
    const quiz = slide.quiz;
    if (
      !quiz ||
      !Array.isArray(quiz.options) ||
      quiz.options.length < 2 ||
      typeof quiz.correctIndex !== "number" ||
      quiz.correctIndex < 0 ||
      quiz.correctIndex >= quiz.options.length
    ) {
      continue;
    }
    const original = quiz.options.slice();
    const origIndex = quiz.correctIndex;
    // Shuffle an array of INDICES (duplicate-text safe), then rebuild options
    // in the new order and re-point correctIndex at the correct slot.
    const order = original.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    quiz.options = order.map((i) => original[i]);
    quiz.correctIndex = order.indexOf(origIndex);
  }
  return deck;
}

/** Extract the first JSON object from an LLM response (tolerates fences/prose). */
export function extractJson(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : raw;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("No JSON object found in model output");
  }
  return candidate.slice(start, end + 1);
}
