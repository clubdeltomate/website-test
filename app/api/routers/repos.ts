import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, eq, like, or, desc } from "drizzle-orm";
import { createRouter, publicQuery } from "../middleware.js";
import { authedProcedure } from "../procedures.js";
import { getDb } from "../queries/connection.js";
import {
  customizations,
  favorites,
  lessons,
  repos,
  runs,
  slideTools,
  units,
  users,
  type Repo,
  type User,
} from "../../db/schema.js";
import { repoRef, slugify, templateSchema } from "../ai/prompts.js";
import { generateImage } from "../ai/provider.js";
import { courseMemory } from "../memory.js";
import { isPassingScore } from "../../contracts/progress.js";
import { repoPurpose } from "../../contracts/types.js";
import type { RepoDetail, RepoLesson, RepoSummary, RepoUnit, LessonRunRow, Level, SlideDeck, RepoPurpose } from "../../contracts/types.js";

/**
 * Prepare a deck for saving as a preset:
 *  - EDUCATION: drop AI-graded evaluations (typed / solve) so free viewers can
 *    play it with zero AI cost — only the owner (or a paying student's custom
 *    generation) incurs those charges.
 *  - Bake every slide image so the preset is self-contained and never
 *    regenerates on view.
 */
async function prepPresetDeck(
  deck: SlideDeck,
  purpose: RepoPurpose,
  userId: number,
): Promise<SlideDeck> {
  let slides = deck.slides.map((s) =>
    purpose === "education" && (s.quiz?.kind === "typed" || s.quiz?.kind === "solve")
      ? { ...s, quiz: undefined }
      : s,
  );
  if (deck.imageStyle !== "none") {
    slides = await Promise.all(
      slides.map(async (s) => {
        const components = await Promise.all(
          s.components.map(async (c) => {
            if (c.type === "image" && !c.imageUrl) {
              try {
                const url = await generateImage({ userId, prompt: c.prompt, style: deck.imageStyle });
                if (url) return { ...c, imageUrl: url };
              } catch {
                /* best-effort — keep the prompt, player will lazy-load */
              }
            }
            return c;
          }),
        );
        return { ...s, components };
      }),
    );
  }
  return { ...deck, slides };
}

type RunLite = Pick<
  typeof runs.$inferSelect,
  "id" | "lessonId" | "userId" | "scoreCorrect" | "scoreTotal" | "completedAt" | "level" | "elapsedSec"
>;

/** Viewer-scoped progress fields for one lesson (guests → all-zero/unplayed). */
function lessonProgress(lessonId: number, viewerRuns: RunLite[]): Pick<
  RepoLesson,
  | "myAttempts"
  | "myBestCorrect"
  | "myBestTotal"
  | "myBestRunId"
  | "myBestLevel"
  | "myBestElapsedSec"
  | "myLastCorrect"
  | "myLastTotal"
  | "myLastLevel"
  | "myLastElapsedSec"
  | "myStatus"
> {
  const mine = viewerRuns
    .filter((r) => r.lessonId === lessonId)
    .sort((a, b) => a.completedAt.getTime() - b.completedAt.getTime());
  if (mine.length === 0) {
    return {
      myAttempts: 0,
      myBestCorrect: 0,
      myBestTotal: 0,
      myBestRunId: null,
      myBestLevel: null,
      myBestElapsedSec: 0,
      myLastCorrect: 0,
      myLastTotal: 0,
      myLastLevel: null,
      myLastElapsedSec: 0,
      myStatus: "unplayed",
    };
  }
  const ratio = (r: RunLite) => (r.scoreTotal === 0 ? 1 : r.scoreCorrect / r.scoreTotal);
  // Highest score wins; ties break toward the FASTER run, then the more recent
  // one — that best run is the canonical result surfaced and linked on the row.
  const best = mine.reduce((a, b) => {
    if (ratio(b) !== ratio(a)) return ratio(b) > ratio(a) ? b : a;
    if (b.elapsedSec !== a.elapsedSec) return b.elapsedSec < a.elapsedSec ? b : a;
    return b.completedAt.getTime() >= a.completedAt.getTime() ? b : a;
  });
  const last = mine[mine.length - 1];
  const passed = mine.some((r) => isPassingScore(r.scoreCorrect, r.scoreTotal));
  return {
    myAttempts: mine.length,
    myBestCorrect: best.scoreCorrect,
    myBestTotal: best.scoreTotal,
    myBestRunId: best.id,
    myBestLevel: (best.level as Level) ?? null,
    myBestElapsedSec: best.elapsedSec,
    myLastCorrect: last.scoreCorrect,
    myLastTotal: last.scoreTotal,
    myLastLevel: (last.level as Level) ?? null,
    myLastElapsedSec: last.elapsedSec,
    myStatus: passed ? "completed" : "try-again",
  };
}

export async function favoriteSlugs(
  userId: number | undefined,
  targetType: "repo" | "slideTool" | "user",
) {
  if (!userId) return new Set<string>();
  const rows = await getDb()
    .select({ slug: favorites.targetSlug })
    .from(favorites)
    .where(and(eq(favorites.userId, userId), eq(favorites.targetType, targetType)));
  return new Set(rows.map((r) => r.slug));
}

export async function repoSummaries(repoRows: Repo[], userId: number | undefined): Promise<RepoSummary[]> {
  const db = getDb();
  const favs = await favoriteSlugs(userId, "repo");
  const out: RepoSummary[] = [];
  for (const repo of repoRows) {
    const repoUnits = await db.select().from(units).where(eq(units.repoId, repo.id));
    let lessonCount = 0;
    // Lesson ids grouped by unit, so we can tell when a whole unit is done.
    const unitLessonIds: number[][] = [];
    for (const u of repoUnits) {
      const ls = await db.select({ id: lessons.id }).from(lessons).where(eq(lessons.unitId, u.id));
      lessonCount += ls.length;
      unitLessonIds.push(ls.map((l) => l.id));
    }
    const repoRuns = await db
      .select({
        id: runs.id,
        lessonId: runs.lessonId,
        userId: runs.userId,
        scoreCorrect: runs.scoreCorrect,
        scoreTotal: runs.scoreTotal,
      })
      .from(runs)
      .where(eq(runs.repoId, repo.id));
    // Viewer's own completed lessons — never another user's activity
    const passedLessonIds = new Set<number>();
    if (userId) {
      for (const r of repoRuns) {
        if (r.userId === userId && r.lessonId && isPassingScore(r.scoreCorrect, r.scoreTotal)) {
          passedLessonIds.add(r.lessonId);
        }
      }
    }
    // A unit counts as complete when it has lessons and every one is passed.
    const myCompletedUnits = unitLessonIds.filter(
      (ids) => ids.length > 0 && ids.every((id) => passedLessonIds.has(id)),
    ).length;
    let ownerName: string | null = null;
    if (repo.ownerId) {
      const owner = await db.query.users.findFirst({ where: eq(users.id, repo.ownerId) });
      ownerName = owner?.name ?? null;
    }
    out.push({
      slug: repo.slug,
      ref: repo.ref,
      title: repo.title,
      description: repo.description,
      template: repo.template,
      source: repo.source === "human" ? "human" : "ai",
      unitCount: repoUnits.length,
      lessonCount,
      runCount: repoRuns.length,
      myCompletedCount: passedLessonIds.size,
      myCompletedUnits,
      isPublic: repo.isPublic,
      favorite: favs.has(repo.slug),
      ownerName,
      createdAt: repo.createdAt,
    });
  }
  return out;
}

function canEdit(repo: Repo, user: User) {
  return repo.ownerId === user.id || user.role === "admin";
}

export const reposRouter = createRouter({
  list: publicQuery
    .input(
      z
        .object({
          q: z.string().max(200).optional(),
          template: templateSchema.optional(),
          limit: z.number().int().min(1).max(100).default(50),
          /** only the signed-in user's own repos (personal shelf) */
          mine: z.boolean().default(false),
        })
        .optional(),
    )
    .query(async ({ ctx, input }): Promise<RepoSummary[]> => {
      const db = getDb();
      if (input?.mine && !ctx.user) return []; // a guest owns nothing
      const conds = [];
      if (input?.mine && ctx.user) conds.push(eq(repos.ownerId, ctx.user.id));
      if (!ctx.user || ctx.user.role === "user") conds.push(eq(repos.isPublic, true));
      if (input?.template) conds.push(eq(repos.template, input.template));
      if (input?.q) {
        const q = `%${input.q}%`;
        conds.push(or(like(repos.title, q), like(repos.description, q), like(repos.slug, q))!);
      }
      const rows = await db
        .select()
        .from(repos)
        .where(conds.length ? and(...conds) : undefined)
        .orderBy(desc(repos.createdAt))
        .limit(input?.limit ?? 50);
      const summaries = await repoSummaries(rows, ctx.user?.id);
      // favorites first for signed-in users
      return summaries.sort((a, b) => Number(b.favorite) - Number(a.favorite));
    }),

  getBySlug: publicQuery
    .input(z.object({ slug: z.string().min(1) }))
    .query(async ({ ctx, input }): Promise<RepoDetail> => {
      const db = getDb();
      const repo = await db.query.repos.findFirst({ where: eq(repos.slug, input.slug) });
      if (!repo) throw new TRPCError({ code: "NOT_FOUND", message: "Repository not found" });
      if (!repo.isPublic && (!ctx.user || !canEdit(repo, ctx.user))) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Repository not found" });
      }
      const [summary] = await repoSummaries([repo], ctx.user?.id);
      const repoUnits = await db
        .select()
        .from(units)
        .where(eq(units.repoId, repo.id))
        .orderBy(units.orderIndex);
      const repoRuns = await db.select().from(runs).where(eq(runs.repoId, repo.id));
      // Progress fields are computed ONLY from the viewer's own runs so one
      // user's activity never shows on another user's page (guests: none).
      const viewerRuns: RunLite[] = ctx.user
        ? repoRuns.filter((r) => r.userId === ctx.user!.id)
        : [];
      // Lesson ids the signed-in viewer has a saved personal customization for.
      const myCustomLessonIds = new Set<number>();
      if (ctx.user) {
        const rows = await db
          .select({ lessonId: customizations.lessonId })
          .from(customizations)
          .where(and(eq(customizations.userId, ctx.user.id), eq(customizations.repoId, repo.id)));
        for (const r of rows) myCustomLessonIds.add(r.lessonId);
      }
      const unitList: RepoUnit[] = [];
      for (const u of repoUnits) {
        const ls = await db
          .select()
          .from(lessons)
          .where(eq(lessons.unitId, u.id))
          .orderBy(lessons.orderIndex);
        const lessonList: RepoLesson[] = ls.map((l) => ({
          id: l.id,
          title: l.title,
          objective: l.objective,
          orderIndex: l.orderIndex,
          globalSeq: l.globalSeq,
          parentLessonId: l.parentLessonId,
          runCount: repoRuns.filter((r) => r.lessonId === l.id).length,
          hasPreset: l.presetDeckJson != null,
          myHasCustomization: myCustomLessonIds.has(l.id),
          ...lessonProgress(l.id, viewerRuns),
        }));
        unitList.push({ id: u.id, title: u.title, orderIndex: u.orderIndex, lessons: lessonList });
      }
      let toolName: string | null = null;
      if (repo.studyToolSlug) {
        const tool = await db.query.slideTools.findFirst({
          where: eq(slideTools.slug, repo.studyToolSlug),
        });
        toolName = tool?.name ?? null;
      }
      return {
        ...summary,
        ownerId: repo.ownerId,
        studyToolSlug: repo.studyToolSlug,
        toolName,
        units: unitList,
      };
    }),

  create: authedProcedure
    .input(
      z.object({
        title: z.string().min(3).max(255),
        description: z.string().max(4000).default(""),
        template: templateSchema.default("course"),
        studyToolSlug: z.string().max(191).optional(),
        // "ai" (default) for generator-built repos, "human" for hand-laid ones.
        source: z.enum(["ai", "human"]).default("ai"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const base = slugify(input.title);
      let slug = base;
      for (let i = 2; await db.query.repos.findFirst({ where: eq(repos.slug, slug) }); i++) {
        slug = `${base}-${i}`;
      }
      await db.insert(repos).values({
        slug,
        ref: repoRef(slug),
        title: input.title,
        description: input.description,
        template: input.template,
        ownerId: ctx.user.id,
        studyToolSlug: input.studyToolSlug ?? null,
        source: input.source,
        isPublic: true,
      });
      return { slug, ref: repoRef(slug) };
    }),

  update: authedProcedure
    .input(
      z.object({
        slug: z.string().min(1),
        title: z.string().min(3).max(255).optional(),
        description: z.string().max(4000).optional(),
        isPublic: z.boolean().optional(),
        studyToolSlug: z.string().max(191).nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const repo = await db.query.repos.findFirst({ where: eq(repos.slug, input.slug) });
      if (!repo) throw new TRPCError({ code: "NOT_FOUND", message: "Repository not found" });
      if (!canEdit(repo, ctx.user)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only the owner or an admin can edit" });
      }
      // NOTE: slug and ref are stable — never changed here.
      const set: Partial<Pick<Repo, "title" | "description" | "isPublic" | "studyToolSlug">> = {};
      if (input.title !== undefined) set.title = input.title;
      if (input.description !== undefined) set.description = input.description;
      if (input.isPublic !== undefined) set.isPublic = input.isPublic;
      if (input.studyToolSlug !== undefined) set.studyToolSlug = input.studyToolSlug;
      if (Object.keys(set).length > 0) {
        await db.update(repos).set(set).where(eq(repos.id, repo.id));
      }
      return { ok: true as const };
    }),

  delete: authedProcedure
    .input(z.object({ slug: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const repo = await db.query.repos.findFirst({ where: eq(repos.slug, input.slug) });
      if (!repo) throw new TRPCError({ code: "NOT_FOUND", message: "Repository not found" });
      if (!canEdit(repo, ctx.user)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only the owner or an admin can delete" });
      }
      const repoUnits = await db.select().from(units).where(eq(units.repoId, repo.id));
      for (const u of repoUnits) {
        await db.delete(lessons).where(eq(lessons.unitId, u.id));
      }
      await db.delete(units).where(eq(units.repoId, repo.id));
      await db.delete(repos).where(eq(repos.id, repo.id));
      return { ok: true as const };
    }),

  toggleFavorite: authedProcedure
    .input(z.object({ slug: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const existing = await db.query.favorites.findFirst({
        where: and(
          eq(favorites.userId, ctx.user.id),
          eq(favorites.targetType, "repo"),
          eq(favorites.targetSlug, input.slug),
        ),
      });
      if (existing) {
        await db.delete(favorites).where(eq(favorites.id, existing.id));
        return { favorite: false };
      }
      await db.insert(favorites).values({
        userId: ctx.user.id,
        targetType: "repo",
        targetSlug: input.slug,
      });
      return { favorite: true };
    }),

  lessonRuns: publicQuery
    .input(z.object({ slug: z.string().min(1), limit: z.number().int().min(1).max(200).default(100) }))
    .query(async ({ ctx, input }): Promise<LessonRunRow[]> => {
      const db = getDb();
      const repo = await db.query.repos.findFirst({ where: eq(repos.slug, input.slug) });
      if (!repo) throw new TRPCError({ code: "NOT_FOUND", message: "Repository not found" });
      // Regular users see ONLY their own runs; the repo owner, moderators and
      // admins keep the full oversight view. Guests see none.
      const privileged =
        !!ctx.user &&
        (repo.ownerId === ctx.user.id ||
          ctx.user.role === "moderator" ||
          ctx.user.role === "admin");
      const scope = privileged
        ? eq(runs.repoId, repo.id)
        : and(eq(runs.repoId, repo.id), eq(runs.userId, ctx.user?.id ?? -1));
      const repoRuns = await db
        .select()
        .from(runs)
        .where(scope)
        .orderBy(desc(runs.completedAt))
        .limit(input.limit);
      const repoUnits = await db.select().from(units).where(eq(units.repoId, repo.id));
      const lessonById = new Map<number, { title: string; globalSeq: number }>();
      for (const u of repoUnits) {
        const ls = await db.select().from(lessons).where(eq(lessons.unitId, u.id));
        for (const l of ls) lessonById.set(l.id, { title: l.title, globalSeq: l.globalSeq });
      }
      return repoRuns.map((r) => ({
        id: r.id,
        lessonId: r.lessonId,
        lessonTitle: r.lessonId ? (lessonById.get(r.lessonId)?.title ?? null) : null,
        lessonSeq: r.lessonId ? (lessonById.get(r.lessonId)?.globalSeq ?? null) : null,
        playerName: r.playerName,
        level: r.level as Level,
        scoreCorrect: r.scoreCorrect,
        scoreTotal: r.scoreTotal,
        elapsedSec: r.elapsedSec,
        completedAt: r.completedAt,
      }));
    }),

  courseMemory: publicQuery
    .input(z.object({ slug: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const db = getDb();
      const repo = await db.query.repos.findFirst({ where: eq(repos.slug, input.slug) });
      if (!repo) throw new TRPCError({ code: "NOT_FOUND", message: "Repository not found" });
      // Memory is the viewer's own learning history, never another user's.
      return courseMemory(repo.id, ctx.user?.id);
    }),

  /* -------------------- preset presentations -------------------- */

  /** Owner saves a generated deck as the item's preset (generate once). */
  setLessonPreset: authedProcedure
    .input(z.object({ repoSlug: z.string(), lessonSeq: z.number().int(), deck: z.unknown() }))
    .mutation(async ({ ctx, input }): Promise<{ ok: true }> => {
      const db = getDb();
      const repo = await db.query.repos.findFirst({ where: eq(repos.slug, input.repoSlug) });
      if (!repo) throw new TRPCError({ code: "NOT_FOUND", message: "Repository not found" });
      if (!canEdit(repo, ctx.user)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only the owner can set the preset" });
      }
      const lesson = await lessonBySeq(repo.id, input.lessonSeq);
      if (!lesson) throw new TRPCError({ code: "NOT_FOUND", message: "Item not found" });
      const prepared = input.deck
        ? await prepPresetDeck(input.deck as SlideDeck, repoPurpose(repo.template), ctx.user.id)
        : null;
      await db
        .update(lessons)
        .set({ presetDeckJson: prepared, presetAt: new Date() })
        .where(eq(lessons.id, lesson.id));
      return { ok: true };
    }),

  /**
   * Owner / admin saves inline edits to an existing preset deck (title, prose,
   * images, MCQ options, …). Unlike setLessonPreset this does NOT re-bake
   * images — the edited deck already carries its image URLs — it just persists
   * the edited deck, defensively stripping any education AI-graded evaluation
   * that an edit might have introduced so the preset stays free to play.
   */
  updateLessonPreset: authedProcedure
    .input(z.object({ repoSlug: z.string(), lessonSeq: z.number().int(), deck: z.unknown() }))
    .mutation(async ({ ctx, input }): Promise<{ ok: true }> => {
      const db = getDb();
      const repo = await db.query.repos.findFirst({ where: eq(repos.slug, input.repoSlug) });
      if (!repo) throw new TRPCError({ code: "NOT_FOUND", message: "Repository not found" });
      if (!canEdit(repo, ctx.user)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only the owner can edit the preset" });
      }
      const lesson = await lessonBySeq(repo.id, input.lessonSeq);
      if (!lesson) throw new TRPCError({ code: "NOT_FOUND", message: "Item not found" });
      const deck = input.deck as SlideDeck;
      const isEducation = repoPurpose(repo.template) === "education";
      const cleaned: SlideDeck = {
        ...deck,
        slides: deck.slides.map((s) =>
          isEducation && (s.quiz?.kind === "typed" || s.quiz?.kind === "solve")
            ? { ...s, quiz: undefined }
            : s,
        ),
      };
      await db
        .update(lessons)
        .set({ presetDeckJson: cleaned, presetAt: new Date() })
        .where(eq(lessons.id, lesson.id));
      return { ok: true };
    }),

  /** Owner removes the preset so it can be re-set. */
  deleteLessonPreset: authedProcedure
    .input(z.object({ repoSlug: z.string(), lessonSeq: z.number().int() }))
    .mutation(async ({ ctx, input }): Promise<{ ok: true }> => {
      const db = getDb();
      const repo = await db.query.repos.findFirst({ where: eq(repos.slug, input.repoSlug) });
      if (!repo) throw new TRPCError({ code: "NOT_FOUND", message: "Repository not found" });
      if (!canEdit(repo, ctx.user)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only the owner can clear the preset" });
      }
      const lesson = await lessonBySeq(repo.id, input.lessonSeq);
      if (lesson) {
        await db
          .update(lessons)
          .set({ presetDeckJson: null, presetAt: null })
          .where(eq(lessons.id, lesson.id));
      }
      return { ok: true };
    }),

  /** Load an item's saved preset to watch (no generation, no charge). */
  lessonPreset: publicQuery
    .input(z.object({ repoSlug: z.string(), lessonSeq: z.number().int() }))
    .query(async ({ ctx, input }): Promise<import("../../contracts/types.js").LessonPreset | null> => {
      const db = getDb();
      const repo = await db.query.repos.findFirst({ where: eq(repos.slug, input.repoSlug) });
      if (!repo) return null;
      if (!repo.isPublic && (!ctx.user || !canEdit(repo, ctx.user))) return null;
      const lesson = await lessonBySeq(repo.id, input.lessonSeq);
      if (!lesson || lesson.presetDeckJson == null) return null;

      const repoUnits = await db.select().from(units).where(eq(units.repoId, repo.id));
      const unit = repoUnits.find((u) => u.id === lesson.unitId);
      const unitLessons = await db.select().from(lessons).where(eq(lessons.unitId, lesson.unitId));
      let lessonSeqTotal = 0;
      for (const u of repoUnits) {
        const c = await db.select({ id: lessons.id }).from(lessons).where(eq(lessons.unitId, u.id));
        lessonSeqTotal += c.length;
      }
      const seed = {
        repoSlug: repo.slug,
        repoRef: repo.ref,
        unitTitle: unit?.title ?? "",
        lessonTitle: lesson.title,
        lessonIndex: lesson.orderIndex,
        lessonCount: unitLessons.length,
        lessonSeq: lesson.globalSeq,
        lessonSeqTotal,
      };

      const purpose = repoPurpose(repo.template);
      let commercial: import("../../contracts/types.js").CommercialInfo | null = null;
      let walkthrough: import("../../contracts/types.js").WalkthroughInfo | null = null;
      if (repo.ownerId && purpose === "commercial") {
        const owner = await db.query.users.findFirst({ where: eq(users.id, repo.ownerId) });
        if (owner) {
          commercial = {
            owner: {
              ownerId: owner.id,
              name: owner.name,
              whatsapp: owner.whatsapp ?? null,
              socials: Array.isArray(owner.socials) ? (owner.socials as string[]) : [],
              contactNote: owner.contactNote ?? null,
            },
            itemTitle: lesson.title,
            repoSlug: repo.slug,
            lessonSeq: lesson.globalSeq,
          };
        }
      } else if (purpose === "walkthrough" || purpose === "news") {
        const owner = repo.ownerId
          ? await db.query.users.findFirst({ where: eq(users.id, repo.ownerId) })
          : null;
        walkthrough = {
          ownerId: owner?.id ?? null,
          ownerName: owner?.name ?? "",
          itemTitle: lesson.title,
          kind: purpose === "news" ? "news" : "walkthrough",
        };
      }

      return {
        deck: lesson.presetDeckJson as import("../../contracts/types.js").SlideDeck,
        seed,
        toolSlug: repo.studyToolSlug ?? "",
        commercial,
        walkthrough,
      };
    }),

  /* ---------------- per-user saved customizations ---------------- */

  /**
   * Save (or replace) the signed-in user's personal custom generation of a
   * lesson — the deck they produced by spending a ticket. One per user+lesson.
   */
  saveMyCustomization: authedProcedure
    .input(
      z.object({
        repoSlug: z.string(),
        lessonSeq: z.number().int(),
        deck: z.unknown(),
        toolSlug: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }): Promise<{ ok: true }> => {
      const db = getDb();
      const repo = await db.query.repos.findFirst({ where: eq(repos.slug, input.repoSlug) });
      if (!repo) throw new TRPCError({ code: "NOT_FOUND", message: "Repository not found" });
      const lesson = await lessonBySeq(repo.id, input.lessonSeq);
      if (!lesson) throw new TRPCError({ code: "NOT_FOUND", message: "Item not found" });
      await db
        .insert(customizations)
        .values({
          lessonId: lesson.id,
          repoId: repo.id,
          userId: ctx.user.id,
          toolSlug: input.toolSlug ?? repo.studyToolSlug ?? null,
          deckJson: input.deck as SlideDeck,
        })
        .onConflictDoUpdate({
          target: [customizations.userId, customizations.lessonId],
          set: {
            deckJson: input.deck as SlideDeck,
            toolSlug: input.toolSlug ?? repo.studyToolSlug ?? null,
            repoId: repo.id,
            updatedAt: new Date(),
          },
        });
      return { ok: true };
    }),

  /** Load the signed-in user's saved customization of a lesson (replay it free). */
  myCustomization: authedProcedure
    .input(z.object({ repoSlug: z.string(), lessonSeq: z.number().int() }))
    .query(async ({ ctx, input }): Promise<import("../../contracts/types.js").LessonPreset | null> => {
      const db = getDb();
      const repo = await db.query.repos.findFirst({ where: eq(repos.slug, input.repoSlug) });
      if (!repo) return null;
      const lesson = await lessonBySeq(repo.id, input.lessonSeq);
      if (!lesson) return null;
      const row = await db.query.customizations.findFirst({
        where: and(eq(customizations.userId, ctx.user.id), eq(customizations.lessonId, lesson.id)),
      });
      if (!row) return null;

      const repoUnits = await db.select().from(units).where(eq(units.repoId, repo.id));
      const unit = repoUnits.find((u) => u.id === lesson.unitId);
      const unitLessons = await db.select().from(lessons).where(eq(lessons.unitId, lesson.unitId));
      let lessonSeqTotal = 0;
      for (const u of repoUnits) {
        const c = await db.select({ id: lessons.id }).from(lessons).where(eq(lessons.unitId, u.id));
        lessonSeqTotal += c.length;
      }
      return {
        deck: row.deckJson as SlideDeck,
        seed: {
          repoSlug: repo.slug,
          repoRef: repo.ref,
          unitTitle: unit?.title ?? "",
          lessonTitle: lesson.title,
          lessonIndex: lesson.orderIndex,
          lessonCount: unitLessons.length,
          lessonSeq: lesson.globalSeq,
          lessonSeqTotal,
        },
        toolSlug: row.toolSlug ?? repo.studyToolSlug ?? "",
        commercial: null,
        walkthrough: null,
      };
    }),
});

/** Resolve a lesson within a repo by its global sequence number. */
async function lessonBySeq(repoId: number, seq: number) {
  const db = getDb();
  const repoUnits = await db.select().from(units).where(eq(units.repoId, repoId));
  for (const u of repoUnits) {
    const lesson = await db.query.lessons.findFirst({
      where: (l, { and: a, eq: e }) => a(e(l.unitId, u.id), e(l.globalSeq, seq)),
    });
    if (lesson) return lesson;
  }
  return null;
}
