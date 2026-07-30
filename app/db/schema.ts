import {
  pgSchema,
  serial,
  varchar,
  text,
  timestamp,
  integer,
  boolean,
  json,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

/* ------------------------------------------------------------------ */
/* SketchLearn schema. */
/* (FK constraints intentionally omitted to keep compatibility with      */
/*  relationships are declared in db/relations.ts.)                     */
/* ------------------------------------------------------------------ */

const createdAt = () => timestamp("createdAt").defaultNow().notNull();
const updatedAt = () =>
  timestamp("updatedAt").defaultNow().notNull();
const fk = (name: string) => integer(name);
const appSchema = pgSchema("sketchlearn");

const roleEnum = appSchema.enum("role", ["user", "moderator", "admin"]);
const providerEnum = appSchema.enum("provider", ["openai", "anthropic", "gemini", "elevenlabs"]);
const capabilityEnum = appSchema.enum("capability", ["text", "image", "tts"]);
const templateEnum = appSchema.enum("template", ["course", "restaurant", "service", "shop", "walkthrough", "news", "other"]);
const levelEnum = appSchema.enum("level", ["A0", "A1", "A2", "B1", "B2", "C1", "C2"]);
const imageStyleEnum = appSchema.enum("imageStyle", ["sketch", "watercolor", "flat", "photo", "none"]);
const paymentStatusEnum = appSchema.enum("status", ["pending", "credited", "rejected"]);
const targetTypeEnum = appSchema.enum("targetType", ["repo", "slideTool", "user"]);

export const users = appSchema.table(
  "users",
  {
    id: serial("id").primaryKey(),
    email: varchar("email", { length: 320 }).notNull().unique(),
    passwordHash: varchar("passwordHash", { length: 255 }).notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    role: roleEnum("role").notNull().default("user"),
    tokenBalance: integer("tokenBalance").notNull().default(50),
    // Moderators hold a pool of un-gifted customization "tickets" bought from
    // the admin (paid for in credits). They gift them to users, one ticket =
    // one paid customization on one of the moderator's repos.
    ticketBalance: integer("ticketBalance").notNull().default(0),
    // Public contact details a poster shows at the end of a commercial
    // (menu/service/shop) presentation so viewers can reach out to order/hire.
    whatsapp: varchar("whatsapp", { length: 40 }),
    contactNote: varchar("contactNote", { length: 500 }),
    socials: json("socials"), // string[] of URLs/handles
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("users_role_idx").on(t.role)],
);

export const apiKeys = appSchema.table(
  "apiKeys",
  {
    id: serial("id").primaryKey(),
    userId: fk("userId").notNull(),
    provider: providerEnum("provider").notNull(),
    capability: capabilityEnum("capability").notNull(),
    apiKey: text("apiKey").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("apiKeys_user_provider_capability").on(t.userId, t.provider, t.capability)],
);

export const repos = appSchema.table(
  "repos",
  {
    id: serial("id").primaryKey(),
    slug: varchar("slug", { length: 191 }).notNull().unique(),
    ref: varchar("ref", { length: 5 }).notNull(),
    title: varchar("title", { length: 255 }).notNull(),
    description: text("description").notNull(),
    template: templateEnum("template").notNull().default("course"),
    ownerId: fk("ownerId"),
    studyToolSlug: varchar("studyToolSlug", { length: 191 }),
    // how the content was authored: "ai" (generated) or "human" (hand-built).
    // Precursor to a future hand-fill editor; today everything is "ai".
    source: varchar("source", { length: 16 }).notNull().default("ai"),
    isPublic: boolean("isPublic").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("repos_template_idx").on(t.template), index("repos_owner_idx").on(t.ownerId)],
);

export const units = appSchema.table(
  "units",
  {
    id: serial("id").primaryKey(),
    repoId: fk("repoId").notNull(),
    title: varchar("title", { length: 255 }).notNull(),
    orderIndex: integer("orderIndex").notNull(),
  },
  (t) => [index("units_repo_idx").on(t.repoId)],
);

export const lessons = appSchema.table(
  "lessons",
  {
    id: serial("id").primaryKey(),
    unitId: fk("unitId").notNull(),
    parentLessonId: fk("parentLessonId"),
    title: varchar("title", { length: 255 }).notNull(),
    objective: text("objective").notNull(),
    orderIndex: integer("orderIndex").notNull(),
    globalSeq: integer("globalSeq").notNull(),
    // A preset presentation the owner generated ONCE so viewers can watch it
    // without regenerating (used by commercial menu/service/shop items).
    presetDeckJson: json("presetDeckJson"),
    presetAt: timestamp("presetAt"),
    // How many times an answer key has been written for this lesson. The key
    // run itself is replaced on each rebuild, so the row keeps the count — it
    // feeds the "played n×" chip when the completed state comes from a key.
    answerKeyGenerations: integer("answerKeyGenerations").notNull().default(0),
  },
  (t) => [index("lessons_unit_idx").on(t.unitId)],
);

/**
 * A picture placed in a unit, sitting in the list beside its lessons — a cover,
 * a diagram, a photo of the board.
 *
 * It shares the lesson orderIndex space on purpose: the author wants to move an
 * image above or below a lesson, so both kinds have to be positions in one
 * sequence rather than two lists that happen to be drawn together. It is NOT a
 * lesson — nothing to play, nothing to grade, no globalSeq, so it never shifts
 * the "Lesson 3 of 8" numbering.
 *
 * The bytes live in slideImages and are served from /api/img/:id, the same way
 * generated slide images are, so a unit image costs the page a cacheable
 * request rather than base64 inside a JSON payload.
 */
export const unitImages = appSchema.table(
  "unitImages",
  {
    id: serial("id").primaryKey(),
    unitId: fk("unitId").notNull(),
    /** row in slideImages holding the bytes */
    imageId: fk("imageId").notNull(),
    caption: varchar("caption", { length: 300 }),
    /** shared sequence with lessons.orderIndex within the unit */
    orderIndex: integer("orderIndex").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("unitImages_unit_idx").on(t.unitId, t.orderIndex)],
);

export const slideTools = appSchema.table(
  "slideTools",
  {
    id: serial("id").primaryKey(),
    slug: varchar("slug", { length: 191 }).notNull().unique(),
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description").notNull(),
    ownerId: fk("ownerId"),
    topic: text("topic").notNull(),
    instructions: text("instructions").notNull(),
    defaultLevel: levelEnum("defaultLevel").notNull().default("A1"),
    defaultSlideCount: integer("defaultSlideCount").notNull().default(8),
    defaultImageStyle: imageStyleEnum("defaultImageStyle").notNull().default("sketch"),
    // Category/purpose of the tool: course (education) or restaurant/service/
    // shop (commercial showcase — no evaluations). Drives templates + prompt.
    template: templateEnum("template").notNull().default("course"),
    // Advanced default: teaching tone applied to generations from this tool.
    defaultTone: varchar("defaultTone", { length: 24 }).notNull().default("neutral"),
    // How this tool's content is authored: "ai" = a reusable AI generator (no
    // saved deck), "human" = a hand-built / customized presentation whose deck
    // lives in deckJson and plays directly (no generation).
    source: varchar("source", { length: 16 }).notNull().default("ai"),
    deckJson: json("deckJson"),
    isPublic: boolean("isPublic").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("slideTools_owner_idx").on(t.ownerId)],
);

export const slideTemplates = appSchema.table(
  "slideTemplates",
  {
    id: serial("id").primaryKey(),
    name: varchar("name", { length: 120 }).notNull(),
    level: levelEnum("level").notNull().default("A1"),
    /** ordered component types, e.g. ["prose","table","quiz"] */
    componentsJson: json("componentsJson").notNull(),
    /** lowercase subject hashtags, e.g. ["math","statistics"] */
    tagsJson: json("tagsJson").notNull(),
    createdBy: fk("createdBy"),
    createdAt: createdAt(),
  },
  (t) => [index("slideTemplates_creator_idx").on(t.createdBy)],
);

export const runs = appSchema.table(
  "runs",
  {
    id: serial("id").primaryKey(),
    slideToolId: fk("slideToolId").notNull(),
    repoId: fk("repoId"),
    lessonId: fk("lessonId"),
    userId: fk("userId"),
    playerName: varchar("playerName", { length: 255 }).notNull().default("Guest"),
    seedJson: json("seedJson"),
    level: levelEnum("level").notNull(),
    imageStyle: imageStyleEnum("imageStyle").notNull(),
    slideCount: integer("slideCount").notNull(),
    scoreCorrect: integer("scoreCorrect").notNull().default(0),
    scoreTotal: integer("scoreTotal").notNull().default(0),
    elapsedSec: integer("elapsedSec").notNull().default(0),
    deckJson: json("deckJson"),
    // freehand annotations the player left on the slides (DeckAnnotations)
    annotationsJson: json("annotationsJson"),
    flagged: boolean("flagged").notNull().default(false),
    /**
     * A model run built from the lesson's preset with every question answered
     * correctly — the teacher's answer key. Not a play by a person: nobody sat
     * through it, so it is excluded from the viewer's own progress and is
     * readable by anyone who can see the lesson, which is the point (a student
     * with no credits opens it to check their answers).
     */
    isAnswerKey: boolean("isAnswerKey").notNull().default(false),
    completedAt: timestamp("completedAt").defaultNow().notNull(),
  },
  (t) => [
    index("runs_tool_idx").on(t.slideToolId),
    index("runs_repo_idx").on(t.repoId),
    index("runs_user_idx").on(t.userId),
    index("runs_completed_idx").on(t.completedAt),
  ],
);

export const lessonLogs = appSchema.table(
  "lessonLogs",
  {
    id: serial("id").primaryKey(),
    repoId: fk("repoId").notNull(),
    lessonId: fk("lessonId").notNull(),
    runId: fk("runId").notNull(),
    userId: fk("userId"),
    level: levelEnum("level").notNull(),
    scoreCorrect: integer("scoreCorrect").notNull().default(0),
    scoreTotal: integer("scoreTotal").notNull().default(0),
    elapsedSec: integer("elapsedSec").notNull().default(0),
    perSlideJson: json("perSlideJson").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index("lessonLogs_repo_idx").on(t.repoId),
    index("lessonLogs_lesson_idx").on(t.lessonId),
  ],
);

/**
 * Order / interest signals from a commercial (menu/service/shop) presentation.
 * When a viewer taps "I'm interested" at the end of a showcase, a row lands
 * here so the poster (repo owner) sees the interest — like a run, but a lead.
 */
export const orders = appSchema.table(
  "orders",
  {
    id: serial("id").primaryKey(),
    repoId: fk("repoId").notNull(),
    lessonId: fk("lessonId"),
    ownerId: fk("ownerId"), // repo owner who receives the lead
    buyerUserId: fk("buyerUserId"), // null for guests
    buyerName: varchar("buyerName", { length: 255 }).notNull().default("Guest"),
    itemTitle: varchar("itemTitle", { length: 255 }),
    note: varchar("note", { length: 1000 }),
    seen: boolean("seen").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    index("orders_repo_idx").on(t.repoId),
    index("orders_owner_idx").on(t.ownerId),
    index("orders_created_idx").on(t.createdAt),
  ],
);

/**
 * Customization tickets. A moderator gifts one to a user for a specific repo;
 * the user spends it on ONE paid slide customization of that repo (education),
 * bypassing the credit charge. Once consumed it can't be reused.
 */
export const tickets = appSchema.table(
  "tickets",
  {
    id: serial("id").primaryKey(),
    /**
     * The repo this ticket customizes, or NULL for a general ticket that is
     * not tied to one. A general ticket pays for a slide-tool deck; a
     * repo-scoped one is meant for that repo but is still accepted by the
     * slide tool, because a ticket is a ticket to the person holding it.
     */
    repoId: fk("repoId"),
    holderId: fk("holderId").notNull(), // the user who may spend it
    issuedById: fk("issuedById").notNull(), // the moderator who gifted it
    consumed: boolean("consumed").notNull().default(false),
    consumedAt: timestamp("consumedAt"),
    createdAt: createdAt(),
  },
  (t) => [
    index("tickets_holder_repo_idx").on(t.holderId, t.repoId, t.consumed),
    index("tickets_issuer_idx").on(t.issuedById),
  ],
);

/**
 * A user's request to a repo's owner for customization tickets (the pull side
 * of the ticket economy — the owner still funds it from their pool). Mirrors
 * the credit-purchase request flow.
 */
export const ticketRequests = appSchema.table(
  "ticketRequests",
  {
    id: serial("id").primaryKey(),
    repoId: fk("repoId").notNull(),
    requesterId: fk("requesterId").notNull(),
    ownerId: fk("ownerId").notNull(), // repo owner who fulfills it
    count: integer("count").notNull().default(1),
    note: varchar("note", { length: 1000 }),
    status: paymentStatusEnum("status").notNull().default("pending"),
    resolvedAt: timestamp("resolvedAt"),
    createdAt: createdAt(),
  },
  (t) => [
    index("ticketRequests_owner_idx").on(t.ownerId, t.status),
    index("ticketRequests_requester_idx").on(t.requesterId),
  ],
);

/**
 * A user's saved custom generation of a lesson — the deck they produced by
 * spending a ticket. One per (user, lesson): generating a new one replaces it.
 * Lets a non-owner replay their own version for free and regenerate it (a new
 * ticket) to replace it.
 */
export const customizations = appSchema.table(
  "customizations",
  {
    id: serial("id").primaryKey(),
    lessonId: fk("lessonId").notNull(),
    repoId: fk("repoId").notNull(),
    userId: fk("userId").notNull(),
    toolSlug: varchar("toolSlug", { length: 191 }),
    deckJson: json("deckJson").notNull(),
    seedJson: json("seedJson"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("customizations_user_lesson").on(t.userId, t.lessonId)],
);

export const tokenLedger = appSchema.table(
  "tokenLedger",
  {
    id: serial("id").primaryKey(),
    userId: fk("userId").notNull(),
    delta: integer("delta").notNull(),
    reason: varchar("reason", { length: 255 }).notNull(),
    balanceAfter: integer("balanceAfter").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("tokenLedger_user_idx").on(t.userId), index("tokenLedger_created_idx").on(t.createdAt)],
);

export const payments = appSchema.table(
  "payments",
  {
    id: serial("id").primaryKey(),
    userId: fk("userId").notNull(),
    packId: varchar("packId", { length: 64 }).notNull(),
    packTokens: integer("packTokens").notNull(),
    amountCents: integer("amountCents").notNull(),
    note: text("note"),
    status: paymentStatusEnum("status").notNull().default("pending"),
    resolvedBy: fk("resolvedBy"),
    createdAt: createdAt(),
    resolvedAt: timestamp("resolvedAt"),
  },
  (t) => [index("payments_status_idx").on(t.status), index("payments_user_idx").on(t.userId)],
);

export const settings = appSchema.table("settings", {
  key: varchar("key", { length: 64 }).primaryKey(),
  valueJson: json("valueJson").notNull(),
});

export const favorites = appSchema.table(
  "favorites",
  {
    id: serial("id").primaryKey(),
    userId: fk("userId").notNull(),
    targetType: targetTypeEnum("targetType").notNull(),
    targetSlug: varchar("targetSlug", { length: 191 }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("favorites_user_target").on(t.userId, t.targetType, t.targetSlug),
  ],
);

/**
 * Generated images, stored once and referenced by URL from a deck.
 *
 * Image models hand back a base64 data URI, and those used to be written
 * straight into the deck JSON. That made an illustrated ten-slide deck 10-20 MB
 * of a single column that has to come back WHOLE every time anyone presses
 * Play — past the response limit of the serverless host it runs on, and slow
 * everywhere else. Held here, a deck is kilobytes again and each image is its
 * own cacheable request.
 */
export const slideImages = appSchema.table(
  "slideImages",
  {
    id: serial("id").primaryKey(),
    /** who paid to generate it — for attribution and cleanup, not access */
    ownerId: fk("ownerId"),
    mime: varchar("mime", { length: 100 }).notNull(),
    /** raw bytes, base64-decoded on the way in */
    data: text("data").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("slideImages_owner_idx").on(t.ownerId)],
);

/* Inferred types */
export type User = typeof users.$inferSelect;
export type ApiKey = typeof apiKeys.$inferSelect;
export type Repo = typeof repos.$inferSelect;
export type Unit = typeof units.$inferSelect;
export type Lesson = typeof lessons.$inferSelect;
export type SlideTool = typeof slideTools.$inferSelect;
export type Run = typeof runs.$inferSelect;
export type LessonLog = typeof lessonLogs.$inferSelect;
export type Order = typeof orders.$inferSelect;
export type Ticket = typeof tickets.$inferSelect;
export type TicketRequest = typeof ticketRequests.$inferSelect;
export type Customization = typeof customizations.$inferSelect;
export type TokenLedgerEntry = typeof tokenLedger.$inferSelect;
export type Payment = typeof payments.$inferSelect;
export type Setting = typeof settings.$inferSelect;
export type Favorite = typeof favorites.$inferSelect;
export type SlideImage = typeof slideImages.$inferSelect;
export type UnitImage = typeof unitImages.$inferSelect;
export type SlideTemplate = typeof slideTemplates.$inferSelect;
