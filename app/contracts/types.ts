export * from "./errors.js";

/* ------------------------------------------------------------------ */
/* SketchLearn shared contracts — frontend imports ONLY from here.      */
/* ------------------------------------------------------------------ */

export type Role = "user" | "moderator" | "admin";
/** CEFR-style difficulty levels (A0 = pre-beginner … C2 = mastery). */
export type Level = "A0" | "A1" | "A2" | "B1" | "B2" | "C1" | "C2";
/** Coarse difficulty tier used for template filtering & cost. */
export type LevelTier = "light" | "mid" | "dense";
export type ImageStyle = "sketch" | "watercolor" | "flat" | "photo" | "none";
export type RepoTemplate = "course" | "restaurant" | "service" | "shop" | "walkthrough" | "news" | "other";
export type AiProvider = "openai" | "anthropic" | "gemini" | "elevenlabs";
/**
 * Extra image sources. They are configured by env only and never hold a BYOK
 * or platform key row, so they are deliberately NOT part of the `provider` DB
 * enum — adding them there would need a migration for no gain. Unsplash is a
 * stock-photo search rather than a generator: it is the last resort that keeps
 * a deck illustrated when every real generator is down.
 */
export type ImageProvider = AiProvider | "leonardo" | "unsplash";
export type AiCapability = "text" | "image" | "tts";

export const LEVELS: Level[] = ["A0", "A1", "A2", "B1", "B2", "C1", "C2"];

/** Short human label for each CEFR level. */
export const LEVEL_LABEL: Record<Level, string> = {
  A0: "A0 · Pre-beginner",
  A1: "A1 · Beginner",
  A2: "A2 · Elementary",
  B1: "B1 · Intermediate",
  B2: "B2 · Upper-intermediate",
  C1: "C1 · Advanced",
  C2: "C2 · Mastery",
};

/** Coarse tier for template filtering & cost (A0-A2 light, B1-B2 mid, C1-C2 dense). */
export function levelTier(level: Level): LevelTier {
  if (level === "A0" || level === "A1" || level === "A2") return "light";
  if (level === "B1" || level === "B2") return "mid";
  return "dense";
}

/* ---------------- Text amount ------------------------------------- */

/**
 * How much written prose each slide carries. The character figures are
 * per-slide estimates shown in the UI so the choice is concrete rather than a
 * vague adjective — measured as roughly 6.2 characters per English word,
 * spaces included.
 *
 * "explained" replaces the old "detailed" tier and "dense" is new above it;
 * every tier's target was raised, because the previous "standard" (120-200
 * words) read as a blurb rather than a lesson.
 */
export type TextDensity = "minimal" | "brief" | "standard" | "explained" | "dense";

export const TEXT_DENSITIES: TextDensity[] = [
  "minimal",
  "brief",
  "standard",
  "explained",
  "dense",
];

export interface TextDensityMeta {
  label: string;
  /** approximate characters of prose per slide, for the picker */
  approxChars: string;
  hint: string;
  /** rough per-slide characters, used to warn about very large decks */
  charsPerSlide: number;
}

export const TEXT_DENSITY_META: Record<TextDensity, TextDensityMeta> = {
  minimal: {
    label: "Minimal",
    approxChars: "~200 characters",
    hint: "Two sentences. The visuals do the teaching.",
    charsPerSlide: 200,
  },
  brief: {
    label: "Brief",
    approxChars: "~700 characters",
    hint: "Short but real — the essentials, no filler.",
    charsPerSlide: 700,
  },
  standard: {
    label: "Standard",
    approxChars: "~1,700 characters",
    hint: "A proper lesson: two or three meaty paragraphs.",
    charsPerSlide: 1700,
  },
  explained: {
    label: "Explained",
    approxChars: "~3,000 characters",
    hint: "Worked through with examples, mistakes and consequences.",
    charsPerSlide: 3000,
  },
  dense: {
    label: "Dense",
    approxChars: "~4,600 characters",
    hint: "A reading assignment. Every angle, fully developed.",
    charsPerSlide: 4600,
  },
};

/**
 * Which text amounts make sense at a given level. A0 and A1 readers are
 * working through a few short sentences at a time — pouring a thousand
 * characters onto a pre-beginner slide does not teach more, it just makes the
 * slide unreadable for the person it was levelled for. Those levels offer the
 * two short amounts only.
 */
export function allowedDensities(level: Level): TextDensity[] {
  return level === "A0" || level === "A1" ? ["minimal", "brief"] : TEXT_DENSITIES;
}

/** Nearest allowed amount, used to pull a selection back in range when the
 *  level changes under it rather than silently generating something else. */
export function clampDensity(level: Level, density: TextDensity): TextDensity {
  const allowed = allowedDensities(level);
  return allowed.includes(density) ? density : allowed[allowed.length - 1];
}

export const IMAGE_STYLES: ImageStyle[] = ["sketch", "watercolor", "flat", "photo", "none"];
export const REPO_TEMPLATES: RepoTemplate[] = ["course", "restaurant", "service", "shop", "walkthrough", "news", "other"];

/**
 * What a repo is FOR — teaching, showcasing something to buy/hire, or simply
 * walking a viewer through an explanation.
 * "commercial" repos (restaurant menus, service offers, shop items) present a
 * product and end on a contact/order step; "education" repos (courses) teach
 * AND evaluate with quizzes; "walkthrough" repos explain WITHOUT any quiz and
 * end on a simple "visit the author / go back" step; "news" repos read like a
 * news briefing (headlines, datelines, factual reporting) with no quiz. Drives
 * which packets/templates are offered, whether quizzes appear, how the AI
 * expresses itself, and the finish screen.
 */
export type RepoPurpose = "education" | "commercial" | "walkthrough" | "news";
export function repoPurpose(template: RepoTemplate): RepoPurpose {
  if (template === "restaurant" || template === "service" || template === "shop") return "commercial";
  if (template === "walkthrough") return "walkthrough";
  if (template === "news") return "news";
  return "education";
}

/** Purpose used for template/packet filtering — walkthrough and news both draw
 *  from the same explanatory (education) layouts, they just omit the quiz. */
export function templateFilterPurpose(purpose: RepoPurpose): "education" | "commercial" {
  return purpose === "commercial" ? "commercial" : "education";
}

/** Purposes that read straight through with no quiz and close on the simple
 *  author/back screen instead of a score or an order step. */
export function isBriefingPurpose(purpose: RepoPurpose): boolean {
  return purpose === "walkthrough" || purpose === "news";
}

/* ---------------- Teaching tone (voice/register of the deck) --------
 * Tone is INDEPENDENT of CEFR level: level sets reading difficulty
 * (vocabulary + sentence complexity), tone sets voice and how much
 * field-specific terminology the deck leans on. A "scholarly" tone gets
 * technical and precise; a "casual" tone explains the same idea plainly
 * with minimal jargon. Default is "neutral" (existing behaviour).            */
export type Tone =
  | "neutral"
  | "casual"
  | "conversational"
  | "friendly"
  | "professional"
  | "formal"
  | "scholarly";

export const TONES: Tone[] = [
  "neutral",
  "casual",
  "conversational",
  "friendly",
  "professional",
  "formal",
  "scholarly",
];

/** Short human label + one-line hint for each teaching tone (UI). */
export const TONE_LABEL: Record<Tone, string> = {
  neutral: "Neutral",
  casual: "Casual",
  conversational: "Conversational",
  friendly: "Friendly",
  professional: "Professional",
  formal: "Formal",
  scholarly: "Scholarly",
};

export const TONE_HINT: Record<Tone, string> = {
  neutral: "Balanced and clear — the default voice.",
  casual: "Easygoing, everyday words, little jargon.",
  conversational: "Chatty and direct, like a friend explaining.",
  friendly: "Warm and encouraging, gently supportive.",
  professional: "Polished and businesslike, to the point.",
  formal: "Precise and impersonal, carefully structured.",
  scholarly: "Technical and academic, full field terminology.",
};

/* ---------------- Slide deck model (generation contract) ---------- */

export type SlideComponent =
  | { type: "prose"; paragraphs: string[] }
  | { type: "latex"; formula: string; caption?: string }
  | {
      type: "chart";
      chartType: "bar" | "line" | "pie" | "area";
      title: string;
      labels: string[];
      series: { name: string; data: number[] }[];
      why?: string;
    }
  | { type: "svg"; title: string; description: string; sceneHint: string }
  | { type: "table"; title?: string; columns: string[]; rows: string[][] }
  | { type: "stickynote"; text: string }
  | {
      type: "image";
      prompt: string;
      alt: string;
      style: ImageStyle;
      /** real generated image (base64 data URI) — falls back to the style thumbnail when absent */
      imageUrl?: string;
    }
  | { type: "code"; language: string; code: string; caption?: string }
  /** a live Wolfram|Alpha computed explanation — the server proxies the query */
  | { type: "wolfram"; query: string; caption?: string };

/** Evaluation kinds a slide can use. mcq = 4-option, mcq2 = 2-option,
 *  fillblank = type the missing word(s), typed = free typed answer. */
export type QuizKind = "mcq" | "mcq2" | "fillblank" | "typed" | "solve";

export interface SlideQuiz {
  /** defaults to "mcq" for decks generated before typed answers existed */
  kind?: QuizKind;
  question: string;
  /** mcq (4) / mcq2 (2) option texts */
  options?: string[];
  /** index of the correct option (mcq/mcq2) */
  correctIndex?: number;
  /** accepted answer for fillblank / reference answer for typed / final
      answer for a solve worksheet */
  answer?: string;
  /** extra accepted answers for fillblank (case/space-insensitive) */
  acceptableAnswers?: string[];
  explanation: string;
}

export interface Slide {
  title: string;
  components: SlideComponent[];
  quiz?: SlideQuiz;
}

export interface SlideDeck {
  slides: Slide[];
  level: Level;
  imageStyle: ImageStyle;
  topic: string;
  /** which model wrote the text (prose / quizzes / structure); null = mock */
  provider?: AiProvider | null;
  /** which model makes the images; null = none / mock */
  imageProvider?: ImageProvider | null;
}

/* ---------------- Lesson seed (repo → slide tool handoff) ---------- */

export interface LessonSeed {
  repoSlug: string;
  repoRef: string;
  unitTitle: string;
  lessonTitle: string;
  /** 1-based index of lesson inside its unit */
  lessonIndex: number;
  /** number of lessons in this unit */
  lessonCount: number;
  /** 1-based course-order number across the whole repo (globalSeq) */
  lessonSeq: number;
  /** total lessons in the repo */
  lessonSeqTotal: number;
}

/* ---------------- Auth --------------------------------------------- */

export interface SessionUser {
  id: number;
  email: string;
  name: string;
  role: Role;
  tokenBalance: number;
  /** moderator's pool of un-gifted customization tickets */
  ticketBalance: number;
  createdAt: Date;
  /** public contact shown at the end of a commercial showcase */
  whatsapp: string | null;
  socials: string[];
  contactNote: string | null;
}

/** One repo the signed-in user holds unused customization tickets for. */
export interface MyTicketGroup {
  repoSlug: string;
  repoTitle: string;
  count: number;
}

/** A user's request to a repo owner for customization tickets. */
export interface TicketRequestRow {
  id: number;
  repoSlug: string;
  repoTitle: string;
  requesterName: string;
  requesterEmail: string;
  count: number;
  note: string | null;
  status: "pending" | "credited" | "rejected";
  createdAt: Date;
}

/** A person in the public Users directory (everyone is listed). */
export interface DirectoryUser {
  id: number;
  name: string;
  role: Role;
  repoCount: number;
  /** distinct categories of the public repos they own (for topic filtering) */
  templates: RepoTemplate[];
  favorite: boolean;
}

/** A user's public profile: their public repos + slide tools + contact. */
export interface UserProfile {
  id: number;
  name: string;
  role: Role;
  createdAt: Date;
  whatsapp: string | null;
  socials: string[];
  contactNote: string | null;
  favorite: boolean;
  repos: RepoSummary[];
  slideTools: SlideToolSummary[];
}

/* ---------------- Repos / slide tools ------------------------------ */

/** How a repo's content was authored — AI-generated or hand-built by a human.
 *  Today everything is "ai"; "human" is reserved for the future hand-fill editor. */
export type ContentSource = "ai" | "human";

export interface RepoSummary {
  slug: string;
  ref: string;
  title: string;
  description: string;
  template: RepoTemplate;
  /** how this repo was authored — drives the "Made with AI" gallery badge */
  source: ContentSource;
  unitCount: number;
  lessonCount: number;
  runCount: number;
  /** Lessons the current viewer has passed in this repo (0 for guests). */
  myCompletedCount: number;
  /** Units the viewer has fully completed — every lesson in the unit passed
      (0 for guests). Drives the repo card's progress strip. */
  myCompletedUnits: number;
  isPublic: boolean;
  favorite: boolean;
  ownerName: string | null;
  createdAt: Date;
}

export interface RepoLesson {
  id: number;
  title: string;
  objective: string;
  orderIndex: number;
  globalSeq: number;
  parentLessonId: number | null;
  runCount: number;
  /** true when the owner has saved a preset presentation for this item, so
      viewers can watch it without regenerating (commercial items). */
  hasPreset: boolean;
  /** true when the SIGNED-IN viewer has saved a personal custom generation of
      this lesson (spent a ticket). Lets them replay it or regenerate a new one. */
  myHasCustomization: boolean;
  /* Viewer-scoped progress — computed ONLY from the signed-in viewer's own
     runs, so one user's activity never shows on another user's page.
     Guests always see zeros / "unplayed". */
  myAttempts: number;
  myBestCorrect: number;
  myBestTotal: number;
  /** the viewer's highest-scoring run: its id (for replay), level, and time.
      This is the canonical run shown on the row and linked from "View best
      run" — the other attempts are not surfaced. null/0 when never played. */
  myBestRunId: number | null;
  myBestLevel: Level | null;
  myBestElapsedSec: number;
  myLastCorrect: number;
  myLastTotal: number;
  /** level + elapsed time of the viewer's most recent attempt (null/0 if none) */
  myLastLevel: Level | null;
  myLastElapsedSec: number;
  myStatus: "unplayed" | "try-again" | "completed";
}

/** Per-slide layout info surfaced in the player (admin diagnostics): which
 *  template the slide uses (pinned by the user, or the best match the AI
 *  produced) and its component recipe. */
export interface SlidePlanInfo {
  template: string | null;
  pinned: boolean;
  components: string[];
}

export interface RepoUnit {
  id: number;
  title: string;
  orderIndex: number;
  lessons: RepoLesson[];
}

export interface RepoDetail extends RepoSummary {
  ownerId: number | null;
  studyToolSlug: string | null;
  toolName: string | null;
  units: RepoUnit[];
}

export interface SlideToolSummary {
  slug: string;
  name: string;
  description: string;
  topic: string;
  instructions: string;
  defaultLevel: Level;
  defaultSlideCount: number;
  defaultImageStyle: ImageStyle;
  /** category/purpose: course (education) or restaurant/service/shop (commercial) */
  template: RepoTemplate;
  /** advanced default teaching tone for generations from this tool */
  defaultTone: Tone;
  /** "ai" = reusable AI generator; "human" = hand-built presentation with a saved deck */
  source: ContentSource;
  /** true when this tool carries a saved deck (hand-built, or a saved AI generation) */
  hasDeck: boolean;
  /** slide count of the saved deck, when there is one — the card shows this
   *  instead of the config default so it matches what was actually generated */
  deckSlideCount: number | null;
  isPublic: boolean;
  favorite: boolean;
  runCount: number;
  ownerName: string | null;
  createdAt: Date;
}

/* ---------------- Runs & lesson logs -------------------------------- */

export interface RunRow {
  id: number;
  toolSlug: string;
  toolName: string;
  repoSlug: string | null;
  repoRef: string | null;
  lessonTitle: string | null;
  playerName: string;
  level: Level;
  imageStyle: ImageStyle;
  slideCount: number;
  scoreCorrect: number;
  scoreTotal: number;
  elapsedSec: number;
  flagged: boolean;
  completedAt: Date;
}

export interface RunSlideDetail {
  title: string;
  /** component type summary from the stored deck snapshot, in order */
  components: SlideComponent["type"][];
  question: string | null;
  /** the option text the student picked (null = no quiz / unanswered) */
  chosenOption: string | null;
  /** null = no quiz answer recorded for this slide */
  correct: boolean | null;
}

export interface RunDetail extends RunRow {
  slides: RunSlideDetail[];
}

/* ---------------- Freehand annotations (slide player only) ---------
 * A learner (or reviewer) can draw and drop text notes on top of a slide
 * in the player. Annotations are anchored to the slide content (they scroll
 * with it), stored per slide index, and saved with the run so a completed
 * play can be replayed with its markings — for the learner's own notes or a
 * moderator reviewing what a user did.                                       */
export interface AnnStroke {
  kind: "stroke";
  color: string;
  width: number;
  /** flat [x0,y0,x1,y1,…] in capture-space pixels */
  points: number[];
}
export interface AnnText {
  kind: "text";
  color: string;
  size: number;
  x: number;
  y: number;
  text: string;
}
export type SlideAnnotation = AnnStroke | AnnText;

/** All annotations for a deck: the capture width they were drawn at (so a
 *  replay at a different width can scale them proportionally) + per-slide
 *  lists keyed by slide index. */
export interface DeckAnnotations {
  w: number;
  slides: Record<number, SlideAnnotation[]>;
  /** worked-solution scratchpads for "solve" slides: per slide index, an
      ordered list of pages, each page its own list of marks. Saved so a
      learner (or moderator) can review the work they showed. */
  scratch?: Record<number, SlideAnnotation[][]>;
}

/* ---------------- Commercial (menu/service/shop) contact + orders --- */

/** Public contact details a poster shows at the end of a showcase. */
export interface OwnerContact {
  ownerId: number | null;
  name: string;
  whatsapp: string | null;
  socials: string[];
  contactNote: string | null;
}

/** Info the player needs to end a commercial presentation on a contact/order
 *  step instead of a score screen. Null for education decks. */
export interface CommercialInfo {
  owner: OwnerContact;
  itemTitle: string;
  repoSlug: string | null;
  lessonSeq: number | null;
}

/** Info the player needs to end a read-through presentation (walkthrough or
 *  news briefing): no score and no order step — just a link to the author's
 *  profile and a way back to where the viewer started. Null for other decks.
 *  `kind` only tweaks the closing copy. */
export interface WalkthroughInfo {
  ownerId: number | null;
  ownerName: string;
  itemTitle: string;
  kind: "walkthrough" | "news";
}

/** A saved preset presentation the owner generated once, for viewers to watch
 *  without regenerating. Includes the seed + (for commercial repos) the
 *  owner's contact, or (for walkthrough repos) the author info, so the player
 *  can end on the right closing screen. */
export interface LessonPreset {
  deck: SlideDeck;
  seed: LessonSeed;
  toolSlug: string;
  commercial: CommercialInfo | null;
  walkthrough: WalkthroughInfo | null;
}

/** A lead: a viewer expressed interest / placed an order from a showcase. */
export interface OrderLead {
  id: number;
  repoSlug: string | null;
  itemTitle: string | null;
  buyerName: string;
  note: string | null;
  seen: boolean;
  createdAt: Date;
}

/** A fully replayable recording of a past play: the exact deck as presented
 *  (text, images, charts…) plus what the student picked on each quiz. */
export interface RunReplay extends RunRow {
  deck: SlideDeck | null;
  /** per-slide recorded answer, aligned to deck.slides by index */
  answers: {
    chosenOption: string | null;
    correctOption: string | null;
    correct: boolean | null;
  }[];
  /** freehand drawings + text notes the player left on the slides */
  annotations: DeckAnnotations | null;
}

export interface LessonLogSlide {
  title: string;
  summary: string;
  visuals: string[];
  question: string | null;
  chosenOption: string | null;
  correct: boolean | null;
}

export interface LessonRunRow {
  id: number;
  lessonId: number | null;
  lessonTitle: string | null;
  lessonSeq: number | null;
  playerName: string;
  level: Level;
  scoreCorrect: number;
  scoreTotal: number;
  elapsedSec: number;
  completedAt: Date;
}

export interface CourseMemoryEntry {
  lessonSeq: number;
  lessonTitle: string;
  unitTitle: string;
  timesTaught: number;
  bestScoreCorrect: number;
  bestScoreTotal: number;
  lastLevel: Level;
  summaries: string[];
}

/* ---------------- Tokens & payments --------------------------------- */

export interface TokenPack {
  id: string;
  tokens: number;
  priceCents: number;
  label: string;
}

export interface TokenLedgerRow {
  id: number;
  delta: number;
  reason: string;
  balanceAfter: number;
  createdAt: Date;
}

export type PaymentStatus = "pending" | "credited" | "rejected";

export interface PaymentRow {
  id: number;
  userId: number;
  userName: string | null;
  userEmail: string | null;
  packId: string;
  packTokens: number;
  amountCents: number;
  note: string | null;
  status: PaymentStatus;
  createdAt: Date;
  resolvedAt: Date | null;
}

/* ---------------- Cost estimate ------------------------------------- */

export interface CostEstimate {
  slideCount: number;
  baseCost: number;
  imageCost: number;
  ttsCost: number;
  levelMultiplier: number;
  /** text portion zeroed because the user has a BYOK text key */
  usingOwnKey: boolean;
  total: number;
  breakdown: string[];
}

/* ---------------- Coach --------------------------------------------- */

export interface CoachAction {
  kind: "lesson-path" | "slides" | "repos";
  label: string;
  payload?: {
    title?: string;
    description?: string;
    template?: RepoTemplate;
    units?: number;
    lessons?: number;
    slug?: string;
  };
}

export interface CoachReply {
  reply: string;
  actions: CoachAction[];
}

/* ---------------- Settings ------------------------------------------ */

export interface PlatformAiKey {
  provider: AiProvider;
  apiKey: string;
  baseUrl?: string;
}

export interface PriceSettings {
  perSlideBase: number;
  perImageSlide: number;
  perTts: number;
  levelMultiplier: Record<Level, number>;
  /** Admin-set ticket price in coins; null/absent = auto (the price of the
   *  most expensive possible customization). Set from Finance → Set prices. */
  ticketPriceOverride?: number | null;
}

export interface AppSettings {
  tokenPacks: TokenPack[];
  prices: PriceSettings;
  googleSheetUrl: string;
  platformAiKeys: Partial<Record<AiCapability, PlatformAiKey>>;
  featureFlags: { coachEnabled: boolean; guestDemo: boolean; [k: string]: boolean };
}

/* ---------------- API keys (BYOK) ------------------------------------ */

export interface ApiKeyRow {
  id: number;
  provider: AiProvider;
  capability: AiCapability;
  /** masked: first 6 + … + last 4 */
  maskedKey: string;
  createdAt: Date;
}

/* ---------------- Admin ---------------------------------------------- */

export interface AdminUserRow {
  id: number;
  email: string;
  name: string;
  role: Role;
  tokenBalance: number;
  ticketBalance: number;
  runCount: number;
  createdAt: Date;
}

export interface AdminDashboard {
  totals: {
    users: number;
    repos: number;
    slideTools: number;
    runs: number;
    tokensIssued: number;
    pendingPayments: number;
    flaggedRuns: number;
  };
  recentRuns: RunRow[];
  /** token ledger deltas summed per day, oldest → newest */
  tokensOverTime: { date: string; delta: number }[];
  pendingPayments: PaymentRow[];
}
