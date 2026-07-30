import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, asc, eq, inArray, like, or, desc, ne } from "drizzle-orm";
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
  unitImages,
  units,
  users,
  type Repo,
  type User,
} from "../../db/schema.js";
import { repoRef, slugify, templateSchema } from "../ai/prompts.js";
import { LEVEL_BANNER_STAGES, makeCardBanner, REPO_BANNER_DIRECTIVE } from "../card-banner.js";
import { assignedSlugs } from "./assignments.js";
import { externalizeDeckImages, IMAGE_URL_PREFIX } from "../deck-images.js";
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
  // Images generated above arrive as base64 data URIs. Store them out of line
  // before this deck is written, or the row becomes megabytes that have to be
  // returned whole on every play.
  const { deck: lean } = await externalizeDeckImages({ ...deck, slides }, userId);
  return lean;
}

/**
 * Save a deck as a lesson's preset. A plain function rather than only a
 * procedure because the generator calls it directly: generating and saving used
 * to be two client-driven requests, so a tab that closed in between lost the
 * deck it had already paid for.
 */
export async function writeLessonPreset(
  repoSlug: string,
  lessonSeq: number,
  deck: unknown,
  user: User,
): Promise<void> {
  const db = getDb();
  const repo = await db.query.repos.findFirst({ where: eq(repos.slug, repoSlug) });
  if (!repo) throw new TRPCError({ code: "NOT_FOUND", message: "Repository not found" });
  if (!canEdit(repo, user)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Only the owner can set the preset" });
  }
  const lesson = await lessonBySeq(repo.id, lessonSeq);
  if (!lesson) throw new TRPCError({ code: "NOT_FOUND", message: "Item not found" });
  const prepared = deck
    ? await prepPresetDeck(deck as SlideDeck, repoPurpose(repo.template), user.id)
    : null;
  await db
    .update(lessons)
    .set({ presetDeckJson: prepared, presetAt: new Date() })
    .where(eq(lessons.id, lesson.id));
  await mirrorPresetTool(repo, lesson.globalSeq, lesson.title, lesson.objective, prepared as SlideDeck | null);
}

/** Save a user's own generated deck for a lesson. See writeLessonPreset. */
export async function writeCustomization(
  repoSlug: string,
  lessonSeq: number,
  deck: unknown,
  userId: number,
  toolSlug?: string,
): Promise<void> {
  const db = getDb();
  const repo = await db.query.repos.findFirst({ where: eq(repos.slug, repoSlug) });
  if (!repo) throw new TRPCError({ code: "NOT_FOUND", message: "Repository not found" });
  const lesson = await lessonBySeq(repo.id, lessonSeq);
  if (!lesson) throw new TRPCError({ code: "NOT_FOUND", message: "Item not found" });
  const { deck: lean } = await externalizeDeckImages(deck as SlideDeck, userId);
  const tool = toolSlug ?? repo.studyToolSlug ?? null;
  await db
    .insert(customizations)
    .values({ lessonId: lesson.id, repoId: repo.id, userId, toolSlug: tool, deckJson: lean })
    .onConflictDoUpdate({
      target: [customizations.userId, customizations.lessonId],
      set: { deckJson: lean, toolSlug: tool, repoId: repo.id, updatedAt: new Date() },
    });
}

/**
 * The repo's study tool, created if there isn't a usable one. No permission
 * check — callers do that. Shared with runs.complete, which needs a tool to
 * attach a finished play to and must not discard the play when the repo never
 * had one (a hand-built repo doesn't).
 */
/**
 * Keep a repo lesson's saved presentation visible on the Slides page: every
 * preset write upserts a real slideTools row (slug preset-<repo>-l<seq>)
 * carrying the same deck, and clearing the preset removes it. A real row —
 * not a pseudo-entry — so Play, banners, cost gates and assigning all work
 * on it unchanged; repoSlug/repoLessonSeq tie it back for the R-ref sticker
 * and for keeping the two copies in sync.
 */
export async function mirrorPresetTool(
  repo: Repo,
  lessonSeq: number,
  title: string,
  objective: string,
  deck: SlideDeck | null,
): Promise<void> {
  const db = getDb();
  const slug = `preset-${repo.slug}-l${lessonSeq}`.slice(0, 191);
  if (!deck) {
    await db.delete(slideTools).where(eq(slideTools.slug, slug));
    return;
  }
  const existing = await db.query.slideTools.findFirst({ where: eq(slideTools.slug, slug) });
  const fields = {
    name: title.slice(0, 255),
    description: objective.slice(0, 4000),
    topic: title.slice(0, 2000),
    defaultLevel: (deck.level ?? "A1") as (typeof slideTools.$inferInsert)["defaultLevel"],
    template: repo.template,
    deckJson: deck,
    isPublic: repo.isPublic,
    ownerId: repo.ownerId,
    repoSlug: repo.slug,
    repoLessonSeq: lessonSeq,
  };
  if (existing) {
    await db.update(slideTools).set(fields).where(eq(slideTools.id, existing.id));
  } else {
    await db.insert(slideTools).values({ slug, instructions: "", source: "ai", ...fields });
  }
}

export async function resolveStudyTool(
  repo: Repo,
  fallbackOwnerId: number | null,
): Promise<{ slug: string; created: boolean }> {
  const db = getDb();
  if (repo.studyToolSlug) {
    const existing = await db.query.slideTools.findFirst({
      where: eq(slideTools.slug, repo.studyToolSlug),
    });
    if (existing) return { slug: existing.slug, created: false };
  }
  // Named after the repo so it is recognisable in the author's shelf, and owned
  // by the repo's owner so they can edit it like any other tool.
  const base = slugify(`${repo.title} studio`);
  let slug = base;
  for (let i = 2; await db.query.slideTools.findFirst({ where: eq(slideTools.slug, slug) }); i++) {
    slug = `${base}-${i}`;
  }
  await db.insert(slideTools).values({
    slug,
    name: `${repo.title} — studio`.slice(0, 255),
    description: `Generates the lessons in ${repo.title}.`.slice(0, 4000),
    topic: repo.title.slice(0, 2000),
    instructions: "",
    template: repo.template,
    ownerId: repo.ownerId ?? fallbackOwnerId,
    isPublic: repo.isPublic,
  });
  await db.update(repos).set({ studyToolSlug: slug }).where(eq(repos.id, repo.id));
  return { slug, created: true };
}

/**
 * Runs for one repo, used only for play counts and the viewer's own progress.
 * Returns an empty list rather than throwing: see the call site.
 */
async function runStats(
  db: ReturnType<typeof getDb>,
  repoId: number,
): Promise<
  { id: number; lessonId: number | null; userId: number | null; scoreCorrect: number; scoreTotal: number }[]
> {
  try {
    return await db
      .select({
        id: runs.id,
        lessonId: runs.lessonId,
        userId: runs.userId,
        scoreCorrect: runs.scoreCorrect,
        scoreTotal: runs.scoreTotal,
      })
      .from(runs)
      .where(and(eq(runs.repoId, repoId), eq(runs.isAnswerKey, false)));
  } catch (err) {
    console.warn("[repos] run stats unavailable:", err instanceof Error ? err.message : err);
    return [];
  }
}

type RunLite = Pick<
  typeof runs.$inferSelect,
  "id" | "lessonId" | "userId" | "scoreCorrect" | "scoreTotal" | "completedAt" | "level" | "elapsedSec"
>;

type LessonProgressFields = Pick<
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
> & { fromAnswerKey: boolean };

/**
 * Viewer-scoped progress fields for one lesson (guests → all-zero/unplayed).
 *
 * A published answer key presents as a perfect completed run — full score, the
 * fixed 4:42, the rebuild count as "times played" — but only while the viewer
 * has no completed run of their own. The moment a real player finishes the
 * lesson, their run takes the slot even against the key's perfect score: their
 * typed answers are worth more than a listed key.
 */
function lessonProgress(
  lessonId: number,
  viewerRuns: RunLite[],
  keyRun: RunLite | undefined,
  keyGenerations: number,
): LessonProgressFields {
  const mine = viewerRuns
    .filter((r) => r.lessonId === lessonId)
    .sort((a, b) => a.completedAt.getTime() - b.completedAt.getTime());
  const asKey = (): LessonProgressFields => ({
    myAttempts: Math.max(1, keyGenerations),
    myBestCorrect: keyRun!.scoreCorrect,
    myBestTotal: keyRun!.scoreTotal,
    myBestRunId: keyRun!.id,
    myBestLevel: (keyRun!.level as Level) ?? null,
    myBestElapsedSec: keyRun!.elapsedSec,
    myLastCorrect: keyRun!.scoreCorrect,
    myLastTotal: keyRun!.scoreTotal,
    myLastLevel: (keyRun!.level as Level) ?? null,
    myLastElapsedSec: keyRun!.elapsedSec,
    myStatus: "completed",
    fromAnswerKey: true,
  });
  if (mine.length === 0) {
    if (keyRun) return asKey();
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
      fromAnswerKey: false,
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
  // Played but never passed: the key still stands in as the visible best run,
  // so a stuck student can always reach the answers through the eye.
  if (!passed && keyRun) return asKey();
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
    fromAnswerKey: false,
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
    // Answer keys are excluded from every play count: nobody played them, and
    // counting the teacher's key as a play overstates how used a repo is.
    //
    // Guarded, because a play count is decoration and the shelf is the page. A
    // database that hasn't caught up with a newly-referenced column made this
    // query fail, and the whole repo list failed with it — "Couldn't load
    // repositories" for a statistic nobody was looking at. Progress and counts
    // degrade to zero; the notebooks still appear.
    const repoRuns = await runStats(db, repo.id);
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
    let ownerVerified = false;
    let ownerAvatarUrl: string | null = null;
    if (repo.ownerId) {
      const owner = await db.query.users.findFirst({ where: eq(users.id, repo.ownerId) });
      ownerName = owner?.name ?? null;
      ownerVerified = owner?.verified ?? false;
      ownerAvatarUrl = owner?.avatarImageId != null ? `${IMAGE_URL_PREFIX}${owner.avatarImageId}` : null;
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
      ownerId: repo.ownerId ?? null,
      ownerName,
      ownerVerified,
      ownerAvatarUrl,
      bannerUrl: repo.bannerImageId != null ? `${IMAGE_URL_PREFIX}${repo.bannerImageId}` : null,
      // Whether THIS viewer holds an assignment is a shelf question, answered
      // where the shelf is assembled (list) — a lone summary defaults to no.
      assigned: false,
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
          /** community gallery: everyone's work EXCEPT the viewer's own */
          excludeMine: z.boolean().default(false),
          /** only work owned by people the viewer follows */
          followingOnly: z.boolean().default(false),
        })
        .optional(),
    )
    .query(async ({ ctx, input }): Promise<RepoSummary[]> => {
      const db = getDb();
      if (input?.mine && !ctx.user) return []; // a guest owns nothing
      const conds = [];
      if (input?.mine && ctx.user) conds.push(eq(repos.ownerId, ctx.user.id));
      if (input?.excludeMine && ctx.user) conds.push(ne(repos.ownerId, ctx.user.id));
      // Narrowing to followed owners has to happen in the QUERY, not on the
      // rows that come back: the result is capped, so filtering afterwards
      // would silently drop work by someone you follow that fell outside the
      // cap — a filter that quietly under-reports is worse than none.
      if (input?.followingOnly) {
        if (!ctx.user) return [];
        const ids = [...(await favoriteSlugs(ctx.user.id, "user"))].map(Number).filter(Number.isFinite);
        if (ids.length === 0) return [];
        conds.push(inArray(repos.ownerId, ids));
      }
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
      // The personal shelf also carries what a moderator handed this user:
      // assigned repos appear beside their own, tagged so the card says why.
      const assignedSet = new Set<string>();
      if (input?.mine && ctx.user) {
        for (const slug of await assignedSlugs(ctx.user.id, "repo")) {
          assignedSet.add(slug);
          if (!rows.some((r) => r.slug === slug)) {
            const extra = await db.query.repos.findFirst({ where: eq(repos.slug, slug) });
            if (extra) rows.push(extra);
          }
        }
      }
      const summaries = (await repoSummaries(rows, ctx.user?.id)).map((s) => ({
        ...s,
        assigned: assignedSet.has(s.slug),
      }));
      // favorites first for signed-in users
      return summaries.sort((a, b) => Number(b.favorite) - Number(a.favorite));
    }),

  /**
   * Draw (or redraw) the repo card's banner strip. Same contract as the
   * slide-tool banner: first draw builds the prompt from the repo's own
   * content and stores it, Refresh reseeds from that stored prompt.
   */
  generateBanner: authedProcedure
    .input(z.object({ slug: z.string().min(1), onlyIfMissing: z.boolean().default(false) }))
    .mutation(async ({ ctx, input }): Promise<{ url: string; cost: number }> => {
      const db = getDb();
      const repo = await db.query.repos.findFirst({ where: eq(repos.slug, input.slug) });
      if (!repo) throw new TRPCError({ code: "NOT_FOUND", message: "Repository not found" });
      if (!canEdit(repo, ctx.user)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only the repo's owner can draw its banner" });
      }
      // Auto-hooks pass this so a repeat firing never buys a second banner.
      if (input.onlyIfMissing && repo.bannerImageId != null) {
        return { url: `${IMAGE_URL_PREFIX}${repo.bannerImageId}`, cost: 0 };
      }
      // Computed fresh every generation (not read back from the stored
      // prompt) so a style change reaches old cards through Refresh. The
      // scene's DEPTH follows the course's level: beginners in a classroom
      // at A0, the field practiced professionally by C2.
      let level = "A1";
      if (repo.studyToolSlug) {
        const tool = await db.query.slideTools.findFirst({
          where: eq(slideTools.slug, repo.studyToolSlug),
        });
        level = tool?.defaultLevel ?? "A1";
      }
      const stage = LEVEL_BANNER_STAGES[level] ?? LEVEL_BANNER_STAGES.A1;
      const repoUnits = await db
        .select({ title: units.title })
        .from(units)
        .where(eq(units.repoId, repo.id))
        .orderBy(asc(units.orderIndex));
      const subject =
        `University catalog photography for a ${level}-level course "${repo.title}" — ` +
        `${repo.description.slice(0, 160)}.` +
        (repoUnits.length > 0
          ? ` It covers: ${repoUnits.slice(0, 5).map((u) => u.title).join("; ")}.`
          : "") +
        ` Show ${stage}.`;
      const { imageId, cost } = await makeCardBanner(ctx.user, subject, REPO_BANNER_DIRECTIVE);
      await db
        .update(repos)
        .set({ bannerImageId: imageId, bannerPrompt: subject })
        .where(eq(repos.id, repo.id));
      return { url: `${IMAGE_URL_PREFIX}${imageId}`, cost };
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
      // One fetch, split in memory: real plays feed counts and progress, the
      // answer keys stand in as a perfect run on lessons the viewer hasn't
      // completed. Guarded for the same reason as the shelf: a lesson's chips
      // are worth losing, a whole repo page is not.
      let repoRuns: (typeof runs.$inferSelect)[] = [];
      const keyRuns = new Map<number, RunLite>();
      try {
        const allRuns = await db.select().from(runs).where(eq(runs.repoId, repo.id));
        repoRuns = allRuns.filter((r) => !r.isAnswerKey);
        for (const r of allRuns) {
          if (r.isAnswerKey && r.lessonId != null) keyRuns.set(r.lessonId, r);
        }
      } catch (err) {
        console.warn("[repos] run history unavailable:", err instanceof Error ? err.message : err);
      }
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
          ...lessonProgress(l.id, viewerRuns, keyRuns.get(l.id), l.answerKeyGenerations),
        }));
        const pics = await db
          .select()
          .from(unitImages)
          .where(eq(unitImages.unitId, u.id))
          .orderBy(asc(unitImages.orderIndex));
        unitList.push({
          id: u.id,
          title: u.title,
          orderIndex: u.orderIndex,
          lessons: lessonList,
          images: pics.map((p) => ({
            id: p.id,
            url: `${IMAGE_URL_PREFIX}${p.imageId}`,
            caption: p.caption,
            orderIndex: p.orderIndex,
          })),
        });
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
      if (input.studyToolSlug) {
        const tool = await db.query.slideTools.findFirst({
          where: eq(slideTools.slug, input.studyToolSlug),
        });
        if (!tool) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `No slide tool called "${input.studyToolSlug}"`,
          });
        }
      }
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
        // Same check as update(): a slug that resolves to nothing is worse than
        // none at all, because the UI treats it as a working link.
        studyToolSlug: input.studyToolSlug ?? null,
        source: input.source,
        isPublic: true,
      });
      return { slug, ref: repoRef(slug) };
    }),

  /**
   * Resolve the repo's study tool, creating it if there isn't a usable one.
   *
   * A repo's studyToolSlug is a free-text column that nothing validated: a repo
   * built by hand never got one at all, and a slug whose tool was later deleted
   * kept pointing at nothing. Either way the lesson's "Set" button had no tool
   * to generate into — it either did nothing or failed with "Slide tool not
   * found" after the author had answered every question.
   *
   * Rather than make the author go and build a tool by hand and link it, the
   * repo grows one on demand. A study tool is an implementation detail of
   * generating a repo's lessons, so needing one is not news the author should
   * have to act on.
   */
  ensureStudyTool: authedProcedure
    .input(z.object({ repoSlug: z.string() }))
    .mutation(async ({ ctx, input }): Promise<{ slug: string; created: boolean }> => {
      const db = getDb();
      const repo = await db.query.repos.findFirst({ where: eq(repos.slug, input.repoSlug) });
      if (!repo) throw new TRPCError({ code: "NOT_FOUND", message: "Repository not found" });
      if (repo.ownerId !== ctx.user.id && ctx.user.role !== "admin") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only the repo's owner can set up its slide tool",
        });
      }
      return resolveStudyTool(repo, ctx.user.id);
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
      if (input.studyToolSlug !== undefined) {
        // Refuse a slug with no tool behind it. Storing one was how a repo
        // ended up with a "Set" button that failed at the last step; the column
        // has no foreign key, so this is the only place to catch it.
        if (input.studyToolSlug) {
          const tool = await db.query.slideTools.findFirst({
            where: eq(slideTools.slug, input.studyToolSlug),
          });
          if (!tool) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `No slide tool called "${input.studyToolSlug}"`,
            });
          }
        }
        set.studyToolSlug = input.studyToolSlug;
      }
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
      await writeLessonPreset(input.repoSlug, input.lessonSeq, input.deck, ctx.user);
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
      const { deck: lean } = await externalizeDeckImages(cleaned, ctx.user.id);
      await db
        .update(lessons)
        .set({ presetDeckJson: lean, presetAt: new Date() })
        .where(eq(lessons.id, lesson.id));
      await mirrorPresetTool(repo, lesson.globalSeq, lesson.title, lesson.objective, lean);
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
        await mirrorPresetTool(repo, lesson.globalSeq, lesson.title, lesson.objective, null);
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
        // Empty when the repo never had a study tool. runs.complete resolves it
        // from the repo, so a play still records; see the note on its input.
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
      await writeCustomization(input.repoSlug, input.lessonSeq, input.deck, ctx.user.id, input.toolSlug);
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
