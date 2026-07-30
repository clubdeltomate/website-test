import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, eq, inArray, isNotNull, ne, like, or, desc } from "drizzle-orm";
import { createRouter, publicQuery } from "../middleware.js";
import { authedProcedure } from "../procedures.js";
import { getDb } from "../queries/connection.js";
import { favoriteSlugs } from "./repos.js";
import { externalizeDeckImages, IMAGE_URL_PREFIX } from "../deck-images.js";
import { makeCardBanner, TOOL_BANNER_DIRECTIVE, TOOL_BANNER_SCENES } from "../card-banner.js";
import { assignedSlugs } from "./assignments.js";
import { favorites, lessons, repos, runs, slideTools, units, users, type SlideTool, type User } from "../../db/schema.js";
import { imageStyleSchema, levelSchema, slugify, templateSchema } from "../ai/prompts.js";
import { AI_CHECKED_KINDS, TONES, repoPurpose } from "../../contracts/types.js";
import type { RepoTemplate, SlideDeck, SlideToolSummary, Tone } from "../../contracts/types.js";

const toneSchema = z.string().refine((t) => (TONES as string[]).includes(t), "unknown tone");

export async function toSummary(tool: SlideTool, userId: number | undefined): Promise<SlideToolSummary> {
  const db = getDb();
  // Play counts exclude answer keys (a key is written, not played), but the
  // card's "Best run" eye counts them: a key IS a viewable perfect run, and
  // it stands in until a real play beats it — a played run always outranks
  // the key, whatever its score, because typed answers are worth more.
  // Guarded — a play count must never be the reason a card fails to render.
  let allRuns: {
    id: number;
    scoreCorrect: number;
    scoreTotal: number;
    elapsedSec: number;
    isAnswerKey: boolean;
  }[] = [];
  try {
    allRuns = await db
      .select({
        id: runs.id,
        scoreCorrect: runs.scoreCorrect,
        scoreTotal: runs.scoreTotal,
        elapsedSec: runs.elapsedSec,
        isAnswerKey: runs.isAnswerKey,
      })
      .from(runs)
      .where(eq(runs.slideToolId, tool.id));
  } catch (err) {
    console.warn("[slideTools] run count unavailable:", err instanceof Error ? err.message : err);
  }
  const toolRuns = allRuns.filter((r) => !r.isAnswerKey);
  const ratio = (r: { scoreCorrect: number; scoreTotal: number }) =>
    r.scoreTotal === 0 ? 1 : r.scoreCorrect / r.scoreTotal;
  const bestPlayed = toolRuns.reduce<(typeof allRuns)[number] | null>((a, b) => {
    if (!a) return b;
    if (ratio(b) !== ratio(a)) return ratio(b) > ratio(a) ? b : a;
    return b.elapsedSec < a.elapsedSec ? b : a;
  }, null);
  const keyRun = allRuns.find((r) => r.isAnswerKey) ?? null;
  const deck = tool.deckJson != null ? (tool.deckJson as SlideDeck) : null;

  // Count the AI-checked questions in whatever Play would actually open: the
  // saved deck, or the latest generation's snapshot. This is the number the
  // card's Free/paid sticker and the pre-play cost dialog quote — 0 for a
  // multiple-choice-only deck, which is checked locally and plays free.
  let deckForCost = deck;
  if (deckForCost == null) {
    try {
      const [latest] = await db
        .select({ deckJson: runs.deckJson })
        .from(runs)
        .where(and(eq(runs.slideToolId, tool.id), isNotNull(runs.deckJson)))
        .orderBy(desc(runs.completedAt))
        .limit(1);
      deckForCost = (latest?.deckJson as SlideDeck | undefined) ?? null;
    } catch (err) {
      console.warn("[slideTools] cost lookup unavailable:", err instanceof Error ? err.message : err);
    }
  }
  const aiCheckCount =
    deckForCost != null && Array.isArray(deckForCost.slides)
      ? deckForCost.slides.filter(
          (s) => s.quiz && (AI_CHECKED_KINDS as readonly string[]).includes(s.quiz.kind ?? "mcq"),
        ).length
      : 0;
  let favorite = false;
  if (userId) {
    const fav = await db.query.favorites.findFirst({
      where: and(
        eq(favorites.userId, userId),
        eq(favorites.targetType, "slideTool"),
        eq(favorites.targetSlug, tool.slug),
      ),
    });
    favorite = !!fav;
  }
  // Where this presentation came from: a mirrored preset knows its repo
  // directly; a repo's studio tool is found by the reverse pointer. Either
  // way the card wears the repo's R-ref sticker.
  let repoRef: string | null = null;
  try {
    if (tool.repoSlug) {
      const r = await db.query.repos.findFirst({ where: eq(repos.slug, tool.repoSlug) });
      repoRef = r?.ref ?? null;
    } else {
      const r = await db.query.repos.findFirst({ where: eq(repos.studyToolSlug, tool.slug) });
      repoRef = r?.ref ?? null;
    }
  } catch (err) {
    console.warn("[slideTools] repo ref unavailable:", err instanceof Error ? err.message : err);
  }
  let ownerName: string | null = null;
  let ownerVerified = false;
  let ownerAvatarUrl: string | null = null;
  if (tool.ownerId) {
    const owner = await db.query.users.findFirst({ where: eq(users.id, tool.ownerId) });
    ownerName = owner?.name ?? null;
    ownerVerified = owner?.verified ?? false;
    ownerAvatarUrl = owner?.avatarImageId != null ? `${IMAGE_URL_PREFIX}${owner.avatarImageId}` : null;
  }
  return {
    slug: tool.slug,
    name: tool.name,
    description: tool.description,
    topic: tool.topic,
    instructions: tool.instructions,
    defaultLevel: tool.defaultLevel,
    defaultSlideCount: tool.defaultSlideCount,
    defaultImageStyle: tool.defaultImageStyle,
    template: (tool.template ?? "course") as RepoTemplate,
    defaultTone: ((tool.defaultTone as Tone) ?? "neutral") as Tone,
    source: tool.source === "human" ? "human" : "ai",
    hasDeck: tool.deckJson != null,
    deckSlideCount: deck != null && Array.isArray(deck.slides) ? deck.slides.length : null,
    isPublic: tool.isPublic,
    favorite,
    runCount: toolRuns.length,
    ownerId: tool.ownerId ?? null,
    ownerName,
    ownerVerified,
    ownerAvatarUrl,
    repoRef,
    createdAt: tool.createdAt,
    // A saved deck answers directly; without one, an education tool is quiz
    // material by nature — its generations carry questions.
    hasQuiz:
      deck != null && Array.isArray(deck.slides)
        ? deck.slides.some((s) => s.quiz != null)
        : repoPurpose((tool.template ?? "course") as RepoTemplate) === "education",
    bestRunId: bestPlayed?.id ?? keyRun?.id ?? null,
    aiCheckCount,
    bannerUrl: tool.bannerImageId != null ? `${IMAGE_URL_PREFIX}${tool.bannerImageId}` : null,
    // Whether THIS viewer holds an assignment is a shelf question, answered
    // where the shelf is assembled (list) — a lone summary defaults to no.
    assigned: false,
  };
}

function canEdit(tool: SlideTool, user: User) {
  return tool.ownerId === user.id || user.role === "admin";
}

export const slideToolsRouter = createRouter({
  list: publicQuery
    .input(
      z
        .object({
          q: z.string().max(200).optional(),
          limit: z.number().int().min(1).max(100).default(50),
          /** only the signed-in user's own tools (personal shelf) */
          mine: z.boolean().default(false),
          /** community gallery: everyone's work EXCEPT the viewer's own */
          excludeMine: z.boolean().default(false),
          /** only work owned by people the viewer follows */
          followingOnly: z.boolean().default(false),
        })
        .optional(),
    )
    .query(async ({ ctx, input }): Promise<SlideToolSummary[]> => {
      const db = getDb();
      if (input?.mine && !ctx.user) return []; // a guest owns nothing
      const conds = [];
      if (input?.mine && ctx.user) conds.push(eq(slideTools.ownerId, ctx.user.id));
      if (input?.excludeMine && ctx.user) conds.push(ne(slideTools.ownerId, ctx.user.id));
      // In the query, not on the returned rows — see the same note in repos.list.
      if (input?.followingOnly) {
        if (!ctx.user) return [];
        const ids = [...(await favoriteSlugs(ctx.user.id, "user"))].map(Number).filter(Number.isFinite);
        if (ids.length === 0) return [];
        conds.push(inArray(slideTools.ownerId, ids));
      }
      if (!ctx.user || ctx.user.role === "user") conds.push(eq(slideTools.isPublic, true));
      if (input?.q) {
        const q = `%${input.q}%`;
        conds.push(or(like(slideTools.name, q), like(slideTools.description, q), like(slideTools.topic, q))!);
      }
      const rows = await db
        .select()
        .from(slideTools)
        .where(conds.length ? and(...conds) : undefined)
        .orderBy(desc(slideTools.createdAt))
        .limit(input?.limit ?? 50);
      // The personal shelf also carries what a moderator handed this user:
      // assigned tools appear beside their own, tagged so the card says why.
      const assignedSet = new Set<string>();
      if (input?.mine && ctx.user) {
        for (const slug of await assignedSlugs(ctx.user.id, "slideTool")) {
          assignedSet.add(slug);
          if (!rows.some((r) => r.slug === slug)) {
            const extra = await db.query.slideTools.findFirst({ where: eq(slideTools.slug, slug) });
            if (extra) rows.push(extra);
          }
        }
      }
      const summaries = await Promise.all(
        rows.map(async (t) => ({ ...(await toSummary(t, ctx.user?.id)), assigned: assignedSet.has(t.slug) })),
      );
      // Drafts (no deck generated, never played) are private to their owner:
      // everyone else browsing the gallery only sees finished, playable tools.
      // Admins keep full visibility for moderation.
      const visible = summaries.filter((s, i) => {
        const isDraft = !s.hasDeck && s.runCount === 0;
        if (!isDraft) return true;
        return !!ctx.user && (rows[i].ownerId === ctx.user.id || ctx.user.role === "admin");
      });
      return visible.sort((a, b) => Number(b.favorite) - Number(a.favorite));
    }),

  /**
   * Draw (or redraw) the card's banner strip. The prompt is built from the
   * tool's own content the first time and stored; Refresh reuses it, so a new
   * image is reseeded from the same description rather than a new guess.
   */
  generateBanner: authedProcedure
    .input(z.object({ slug: z.string().min(1), onlyIfMissing: z.boolean().default(false) }))
    .mutation(async ({ ctx, input }): Promise<{ url: string; cost: number }> => {
      const db = getDb();
      const tool = await db.query.slideTools.findFirst({ where: eq(slideTools.slug, input.slug) });
      if (!tool) throw new TRPCError({ code: "NOT_FOUND", message: "Slide tool not found" });
      if (!canEdit(tool, ctx.user)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only the tool's owner can draw its banner" });
      }
      // Auto-hooks fire after every generation; without this guard a re-set
      // presentation would quietly buy a new banner each time.
      if (input.onlyIfMissing && tool.bannerImageId != null) {
        return { url: `${IMAGE_URL_PREFIX}${tool.bannerImageId}`, cost: 0 };
      }
      // Publicity for THIS tool's content, staged in its category's setting
      // (course → campus, restaurant → kitchen and tables, …). Computed
      // fresh every time so a style change reaches old cards through their
      // Refresh button instead of being frozen into a stored prompt.
      const scene =
        TOOL_BANNER_SCENES[(tool.template ?? "course") as string] ?? TOOL_BANNER_SCENES.course;
      const deckForSubject = tool.deckJson != null ? (tool.deckJson as SlideDeck) : null;
      const slideTitles =
        deckForSubject && Array.isArray(deckForSubject.slides)
          ? deckForSubject.slides.slice(0, 6).map((s) => s.title).join("; ")
          : "";
      const subject =
        `An advertising banner promoting "${tool.name}" — ${(tool.topic || tool.description).slice(0, 160)}.` +
        (slideTitles ? ` It covers: ${slideTitles}.` : "") +
        ` Set the scene in ${scene}.`;
      const { imageId, cost } = await makeCardBanner(ctx.user, subject, TOOL_BANNER_DIRECTIVE);
      await db
        .update(slideTools)
        .set({ bannerImageId: imageId, bannerPrompt: subject })
        .where(eq(slideTools.id, tool.id));
      return { url: `${IMAGE_URL_PREFIX}${imageId}`, cost };
    }),

  getBySlug: publicQuery
    .input(z.object({ slug: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const db = getDb();
      const tool = await db.query.slideTools.findFirst({ where: eq(slideTools.slug, input.slug) });
      if (!tool) throw new TRPCError({ code: "NOT_FOUND", message: "Slide tool not found" });
      if (!tool.isPublic && (!ctx.user || !canEdit(tool, ctx.user))) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Slide tool not found" });
      }
      return toSummary(tool, ctx.user?.id);
    }),

  create: authedProcedure
    .input(
      z.object({
        name: z.string().min(3).max(255),
        description: z.string().max(4000).default(""),
        topic: z.string().max(2000).default(""),
        instructions: z.string().max(4000).default(""),
        defaultLevel: levelSchema.default("A1"),
        defaultSlideCount: z.number().int().min(1).max(15).default(8),
        defaultImageStyle: imageStyleSchema.default("sketch"),
        defaultTone: toneSchema.default("neutral"),
        template: templateSchema.default("course"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const base = slugify(input.name);
      let slug = base;
      for (let i = 2; await db.query.slideTools.findFirst({ where: eq(slideTools.slug, slug) }); i++) {
        slug = `${base}-${i}`;
      }
      await db.insert(slideTools).values({ ...input, slug, ownerId: ctx.user.id, isPublic: true });
      return { slug };
    }),

  /**
   * Create a HAND-BUILT presentation (source = "human"). Stores the deck the
   * user built by hand; its card plays directly with no AI generation.
   */
  createManual: authedProcedure
    .input(
      z.object({
        name: z.string().min(3).max(255),
        description: z.string().max(4000).default(""),
        deck: z.unknown(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const base = slugify(input.name);
      let slug = base;
      for (let i = 2; await db.query.slideTools.findFirst({ where: eq(slideTools.slug, slug) }); i++) {
        slug = `${base}-${i}`;
      }
      const deck = input.deck as SlideDeck;
      await db.insert(slideTools).values({
        slug,
        name: input.name,
        description: input.description,
        topic: deck?.topic ?? input.name,
        instructions: "",
        ownerId: ctx.user.id,
        isPublic: true,
        source: "human",
        deckJson: (await externalizeDeckImages(deck, ctx.user.id)).deck,
        defaultLevel: deck?.level ?? "B1",
        defaultImageStyle: deck?.imageStyle ?? "none",
      });
      return { slug };
    }),

  /**
   * Owner/admin saves the hand-built deck for a tool. Source is NOT changed on
   * edit — a thing is "human" only if it was HAND-BUILT from scratch (see
   * createManual); merely editing an AI deck keeps it "ai".
   */
  saveDeck: authedProcedure
    .input(z.object({ slug: z.string().min(1), deck: z.unknown() }))
    .mutation(async ({ ctx, input }): Promise<{ ok: true }> => {
      const db = getDb();
      const tool = await db.query.slideTools.findFirst({ where: eq(slideTools.slug, input.slug) });
      if (!tool) throw new TRPCError({ code: "NOT_FOUND", message: "Slide tool not found" });
      if (!canEdit(tool, ctx.user)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only the owner can edit this presentation" });
      }
      const lean = (await externalizeDeckImages(input.deck as SlideDeck, ctx.user.id)).deck;
      await db
        .update(slideTools)
        .set({ deckJson: lean, updatedAt: new Date() })
        .where(eq(slideTools.id, tool.id));
      // A mirrored repo preset has TWO copies of its deck; editing the tool
      // writes the lesson's preset too, or the repo would keep playing the
      // version from before the edit.
      if (tool.repoSlug && tool.repoLessonSeq != null) {
        const repo = await db.query.repos.findFirst({ where: eq(repos.slug, tool.repoSlug) });
        if (repo) {
          const repoUnits = await db.select().from(units).where(eq(units.repoId, repo.id));
          for (const u of repoUnits) {
            const lesson = await db.query.lessons.findFirst({
              where: and(eq(lessons.unitId, u.id), eq(lessons.globalSeq, tool.repoLessonSeq)),
            });
            if (lesson) {
              await db
                .update(lessons)
                .set({ presetDeckJson: lean, presetAt: new Date() })
                .where(eq(lessons.id, lesson.id));
              break;
            }
          }
        }
      }
      return { ok: true };
    }),

  /**
   * Load a tool's saved deck to play it (no generation, no charge) — a
   * hand-built presentation or a saved AI generation. Resolves the tool's
   * purpose (from its category) + owner so the player ends on the right screen:
   * commercial → contact, walkthrough/news → author-profile/back.
   */
  deck: publicQuery
    .input(z.object({ slug: z.string().min(1) }))
    .query(
      async ({
        ctx,
        input,
      }): Promise<{
        deck: SlideDeck;
        name: string;
        commercial: import("../../contracts/types.js").CommercialInfo | null;
        walkthrough: import("../../contracts/types.js").WalkthroughInfo | null;
      } | null> => {
        const db = getDb();
        const tool = await db.query.slideTools.findFirst({ where: eq(slideTools.slug, input.slug) });
        if (!tool) return null;
        if (!tool.isPublic && (!ctx.user || !canEdit(tool, ctx.user))) return null;
        // No saved deck? Play the tool's most recent generation instead. An
        // AI tool keeps its decks inside run snapshots, and the card's Play
        // button promises a replay — free, nothing regenerated — not a
        // "couldn't find that deck" dead end.
        let deckJson = tool.deckJson;
        if (deckJson == null) {
          const [latest] = await db
            .select({ deckJson: runs.deckJson })
            .from(runs)
            .where(and(eq(runs.slideToolId, tool.id), isNotNull(runs.deckJson)))
            .orderBy(desc(runs.completedAt))
            .limit(1);
          deckJson = latest?.deckJson ?? null;
        }
        if (deckJson == null) return null;

        const purpose = repoPurpose((tool.template ?? "course") as RepoTemplate);
        let commercial: import("../../contracts/types.js").CommercialInfo | null = null;
        let walkthrough: import("../../contracts/types.js").WalkthroughInfo | null = null;
        if (purpose !== "education" && tool.ownerId) {
          const owner = await db.query.users.findFirst({ where: eq(users.id, tool.ownerId) });
          if (owner && purpose === "commercial") {
            commercial = {
              owner: {
                ownerId: owner.id,
                name: owner.name,
                whatsapp: owner.whatsapp ?? null,
                socials: Array.isArray(owner.socials) ? (owner.socials as string[]) : [],
                contactNote: owner.contactNote ?? null,
              },
              itemTitle: tool.name,
              repoSlug: null,
              lessonSeq: null,
            };
          } else if (purpose === "walkthrough" || purpose === "news") {
            walkthrough = {
              ownerId: owner?.id ?? null,
              ownerName: owner?.name ?? "",
              itemTitle: tool.name,
              kind: purpose === "news" ? "news" : "walkthrough",
            };
          }
        }
        return { deck: deckJson as SlideDeck, name: tool.name, commercial, walkthrough };
      },
    ),

  update: authedProcedure
    .input(
      z.object({
        slug: z.string().min(1),
        name: z.string().min(3).max(255).optional(),
        description: z.string().max(4000).optional(),
        topic: z.string().max(2000).optional(),
        instructions: z.string().max(4000).optional(),
        defaultLevel: levelSchema.optional(),
        defaultSlideCount: z.number().int().min(1).max(15).optional(),
        defaultImageStyle: imageStyleSchema.optional(),
        defaultTone: toneSchema.optional(),
        template: templateSchema.optional(),
        isPublic: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const tool = await db.query.slideTools.findFirst({ where: eq(slideTools.slug, input.slug) });
      if (!tool) throw new TRPCError({ code: "NOT_FOUND", message: "Slide tool not found" });
      if (!canEdit(tool, ctx.user)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only the owner or an admin can edit" });
      }
      const { slug: _slug, ...set } = input;
      const clean = Object.fromEntries(Object.entries(set).filter(([, v]) => v !== undefined));
      if (Object.keys(clean).length > 0) {
        await db.update(slideTools).set(clean).where(eq(slideTools.id, tool.id));
      }
      return { ok: true as const };
    }),

  delete: authedProcedure
    .input(z.object({ slug: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const tool = await db.query.slideTools.findFirst({ where: eq(slideTools.slug, input.slug) });
      if (!tool) throw new TRPCError({ code: "NOT_FOUND", message: "Slide tool not found" });
      if (!canEdit(tool, ctx.user)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only the owner or an admin can delete" });
      }
      await db.delete(slideTools).where(eq(slideTools.id, tool.id));
      return { ok: true as const };
    }),

  toggleFavorite: authedProcedure
    .input(z.object({ slug: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const existing = await db.query.favorites.findFirst({
        where: and(
          eq(favorites.userId, ctx.user.id),
          eq(favorites.targetType, "slideTool"),
          eq(favorites.targetSlug, input.slug),
        ),
      });
      if (existing) {
        await db.delete(favorites).where(eq(favorites.id, existing.id));
        return { favorite: false };
      }
      await db.insert(favorites).values({
        userId: ctx.user.id,
        targetType: "slideTool",
        targetSlug: input.slug,
      });
      return { favorite: true };
    }),
});
