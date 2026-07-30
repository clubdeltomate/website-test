import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, inArray } from "drizzle-orm";
import { createRouter, publicQuery } from "../middleware.js";
import { authedProcedure, moderatorProcedure } from "../procedures.js";
import { getDb } from "../queries/connection.js";
import { resolveStudyTool } from "./repos.js";
import { customizations, lessons, repos, runs, slideTools, units, lessonLogs } from "../../db/schema.js";
import { externalizeDeckImages } from "../deck-images.js";
import { imageStyleSchema, levelSchema } from "../ai/prompts.js";
import type { LessonLogSlide, RunDetail, RunReplay, RunRow, RunSlideDetail, SlideDeck } from "../../contracts/types.js";

const perSlideSchema = z.object({
  title: z.string(),
  summary: z.string(),
  visuals: z.array(z.string()).default([]),
  question: z.string().nullable().default(null),
  chosenOption: z.string().nullable().default(null),
  correct: z.boolean().nullable().default(null),
});

const seedSchema = z.object({
  repoSlug: z.string(),
  repoRef: z.string(),
  unitTitle: z.string(),
  lessonTitle: z.string(),
  lessonIndex: z.number().int(),
  lessonCount: z.number().int(),
  lessonSeq: z.number().int(),
  lessonSeqTotal: z.number().int(),
});

function buildRunRow(
  r: typeof runs.$inferSelect,
  tool: { slug: string; name: string } | undefined,
  repo: { slug: string; ref: string } | undefined,
  lessonTitle: string | null,
): RunRow {
  return {
    id: r.id,
    toolSlug: tool?.slug ?? "unknown",
    toolName: tool?.name ?? "Unknown tool",
    repoSlug: repo?.slug ?? null,
    repoRef: repo?.ref ?? null,
    lessonTitle,
    playerName: r.playerName,
    level: r.level,
    imageStyle: r.imageStyle,
    slideCount: r.slideCount,
    scoreCorrect: r.scoreCorrect,
    scoreTotal: r.scoreTotal,
    elapsedSec: r.elapsedSec,
    flagged: r.flagged,
    completedAt: r.completedAt,
  };
}

async function toRunRow(db: ReturnType<typeof getDb>, r: typeof runs.$inferSelect): Promise<RunRow> {
  const tool = await db.query.slideTools.findFirst({ where: eq(slideTools.id, r.slideToolId) });
  const repo = r.repoId
    ? await db.query.repos.findFirst({ where: eq(repos.id, r.repoId) })
    : undefined;
  const lesson = r.lessonId
    ? await db.query.lessons.findFirst({ where: eq(lessons.id, r.lessonId) })
    : undefined;
  return buildRunRow(r, tool ?? undefined, repo ?? undefined, lesson?.title ?? null);
}

/**
 * Batch version of toRunRow for lists: resolves every run's tool/repo/lesson
 * in THREE queries total (one per table, keyed by id set) instead of ~3 per
 * run. This is what made the runs page slow — 100 rows meant ~300 sequential
 * lookups.
 */
async function toRunRows(
  db: ReturnType<typeof getDb>,
  rows: (typeof runs.$inferSelect)[],
): Promise<RunRow[]> {
  if (rows.length === 0) return [];
  const toolIds = [...new Set(rows.map((r) => r.slideToolId))];
  const repoIds = [...new Set(rows.map((r) => r.repoId).filter((v): v is number => v != null))];
  const lessonIds = [...new Set(rows.map((r) => r.lessonId).filter((v): v is number => v != null))];

  const [toolRows, repoRows, lessonRows] = await Promise.all([
    toolIds.length
      ? db.select({ id: slideTools.id, slug: slideTools.slug, name: slideTools.name })
          .from(slideTools).where(inArray(slideTools.id, toolIds))
      : Promise.resolve([]),
    repoIds.length
      ? db.select({ id: repos.id, slug: repos.slug, ref: repos.ref })
          .from(repos).where(inArray(repos.id, repoIds))
      : Promise.resolve([]),
    lessonIds.length
      ? db.select({ id: lessons.id, title: lessons.title })
          .from(lessons).where(inArray(lessons.id, lessonIds))
      : Promise.resolve([]),
  ]);

  const toolMap = new Map(toolRows.map((t) => [t.id, t]));
  const repoMap = new Map(repoRows.map((r) => [r.id, r]));
  const lessonMap = new Map(lessonRows.map((l) => [l.id, l]));

  return rows.map((r) =>
    buildRunRow(
      r,
      toolMap.get(r.slideToolId),
      r.repoId != null ? repoMap.get(r.repoId) : undefined,
      (r.lessonId != null ? lessonMap.get(r.lessonId)?.title : null) ?? null,
    ),
  );
}

export const runsRouter = createRouter({
  /**
   * Save a completed play. Call ONLY when the player reaches the finish
   * screen — a run row means a full completion (design.md §9).
   */
  complete: publicQuery
    .input(
      z.object({
        /**
         * May be blank. A preset play sends whatever the repo has recorded, and
         * a repo that never had a study tool sends "" — min(1) turned that into
         * a validation failure, so finishing the lesson was silently discarded
         * and the repo went on claiming the lesson was unplayed. The tool is
         * resolved from the seed's repo below instead.
         */
        toolSlug: z.string().default(""),
        seed: seedSchema.optional(),
        level: levelSchema,
        imageStyle: imageStyleSchema,
        slideCount: z.number().int().min(1).max(30),
        elapsedSec: z.number().int().min(0).max(24 * 3600),
        playerName: z.string().max(255).optional(),
        deck: z.unknown().optional(), // full generated deck snapshot
        perSlide: z.array(perSlideSchema).max(30).default([]),
        annotations: z.unknown().optional(), // DeckAnnotations (freehand marks)
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();

      const answered = input.perSlide.filter((s) => s.correct !== null);
      const scoreTotal = answered.length;
      const scoreCorrect = answered.filter((s) => s.correct === true).length;

      // Resolve repo/lesson from the seed
      let repoId: number | null = null;
      let lessonId: number | null = null;
      let seedRepo: typeof repos.$inferSelect | null = null;
      if (input.seed) {
        const repo = await db.query.repos.findFirst({
          where: eq(repos.slug, input.seed.repoSlug),
        });
        if (repo) {
          repoId = repo.id;
          seedRepo = repo;
          const repoUnits = await db.select().from(units).where(eq(units.repoId, repo.id));
          for (const u of repoUnits) {
            const lesson = await db.query.lessons.findFirst({
              where: and(eq(lessons.unitId, u.id), eq(lessons.globalSeq, input.seed.lessonSeq)),
            });
            if (lesson) {
              lessonId = lesson.id;
              break;
            }
          }
        }
      }

      /**
       * Which tool this play belongs to. Named slug first, then the repo's own —
       * a completed lesson is a fact about the learner, and throwing it away
       * because a bookkeeping row is missing is the wrong trade.
       */
      let tool = input.toolSlug
        ? await db.query.slideTools.findFirst({ where: eq(slideTools.slug, input.toolSlug) })
        : undefined;
      if (!tool && seedRepo) {
        // A hand-built repo can have a playable lesson and no study tool at all,
        // and a run row needs one. Grow it rather than drop the play — the same
        // repair repos.ensureStudyTool performs, and it happens once.
        const { slug } = await resolveStudyTool(seedRepo, ctx.user?.id ?? null);
        tool = await db.query.slideTools.findFirst({ where: eq(slideTools.slug, slug) });
      }
      if (!tool) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Slide tool not found — this play could not be recorded",
        });
      }

      /**
       * The deck this run replays. The client no longer uploads inline images —
       * that upload was over the request-body limit and lost the whole play — so
       * for a repo lesson the snapshot is taken from the stored deck instead,
       * which already has its images as URLs. Full fidelity, nothing uploaded.
       */
      let snapshot = input.deck ?? null;
      if (lessonId) {
        const stored = await db.query.lessons.findFirst({ where: eq(lessons.id, lessonId) });
        const mine = ctx.user
          ? await db.query.customizations.findFirst({
              where: and(
                eq(customizations.lessonId, lessonId),
                eq(customizations.userId, ctx.user.id),
              ),
            })
          : null;
        // A viewer playing their own configured version replays that one.
        snapshot = mine?.deckJson ?? stored?.presetDeckJson ?? snapshot;
      }
      // Anything still carrying a data URI gets stored once rather than copied
      // into every run row.
      if (snapshot) {
        snapshot = (await externalizeDeckImages(snapshot as SlideDeck, ctx.user?.id ?? null)).deck;
      }

      const [{ runId }] = await db.transaction(async (tx) => {
        const [{ id }] = await tx
          .insert(runs)
          .values({
            slideToolId: tool.id,
            repoId,
            lessonId,
            userId: ctx.user?.id ?? null,
            playerName: input.playerName ?? ctx.user?.name ?? "Guest",
            seedJson: input.seed ?? null,
            level: input.level,
            imageStyle: input.imageStyle,
            slideCount: input.slideCount,
            scoreCorrect,
            scoreTotal,
            elapsedSec: input.elapsedSec,
            deckJson: snapshot,
            annotationsJson: input.annotations ?? null,
          })
          .returning({ id: runs.id });

        // Repo-launched play → write the lesson log (the memory loop)
        if (repoId && lessonId) {
          await tx.insert(lessonLogs).values({
            repoId,
            lessonId,
            runId: id,
            userId: ctx.user?.id ?? null,
            level: input.level,
            scoreCorrect,
            scoreTotal,
            elapsedSec: input.elapsedSec,
            perSlideJson: input.perSlide,
          });
        }
        return [{ runId: id }];
      });

      return { score: { correct: scoreCorrect, total: scoreTotal }, runId };
    }),

  /**
   * Build (or rebuild) the lesson's ANSWER KEY: a model run over the saved
   * preset with every question answered correctly.
   *
   * Setting a lesson leaves the owner with no way to show the answers short of
   * sitting through the deck and answering everything themselves, once per
   * lesson. This does that pass for them — no AI, no credits, nothing generated;
   * it reads the correct answer already stored on each slide and writes it down
   * as if it had been played.
   *
   * The run is flagged isAnswerKey, which keeps it out of the owner's own
   * progress and opens it to anyone who can see the lesson. That is the point:
   * a student with no credits can read the answers without playing.
   */
  createAnswerKey: authedProcedure
    .input(z.object({ repoSlug: z.string(), lessonSeq: z.number().int() }))
    .mutation(async ({ ctx, input }): Promise<{ runId: number; answered: number }> => {
      const db = getDb();
      const repo = await db.query.repos.findFirst({ where: eq(repos.slug, input.repoSlug) });
      if (!repo) throw new TRPCError({ code: "NOT_FOUND", message: "Repository not found" });
      if (repo.ownerId !== ctx.user.id && ctx.user.role !== "admin") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only the repo's owner can publish an answer key",
        });
      }
      const repoUnits = await db.select().from(units).where(eq(units.repoId, repo.id));
      let lesson: typeof lessons.$inferSelect | undefined;
      for (const u of repoUnits) {
        lesson = await db.query.lessons.findFirst({
          where: and(eq(lessons.unitId, u.id), eq(lessons.globalSeq, input.lessonSeq)),
        });
        if (lesson) break;
      }
      if (!lesson) throw new TRPCError({ code: "NOT_FOUND", message: "Item not found" });
      const deck = lesson.presetDeckJson as SlideDeck | null;
      if (!deck) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Set the presentation first — there is nothing to answer yet",
        });
      }
      const { slug: toolSlug } = await resolveStudyTool(repo, ctx.user.id);
      const tool = await db.query.slideTools.findFirst({ where: eq(slideTools.slug, toolSlug) });
      if (!tool) throw new TRPCError({ code: "NOT_FOUND", message: "Slide tool not found" });

      // The correct answer is already on the slide, whatever kind of question it
      // is: an option index for the multiple choices, a written answer otherwise.
      const perSlide = deck.slides.map((slide) => {
        const prose = slide.components.find((c) => c.type === "prose");
        const summary =
          prose && prose.type === "prose"
            ? (prose.paragraphs[0] ?? slide.title).slice(0, 220)
            : slide.title;
        const correctOption = slide.quiz
          ? (slide.quiz.options && typeof slide.quiz.correctIndex === "number"
              ? slide.quiz.options[slide.quiz.correctIndex]
              : undefined) ?? slide.quiz.answer ?? null
          : null;
        return {
          title: slide.title,
          summary,
          visuals: slide.components.map((c) => c.type).filter((t) => t !== "prose" && t !== "stickynote"),
          question: slide.quiz?.question ?? null,
          chosenOption: correctOption,
          // null on a slide with no question, so it is not counted as scored.
          correct: slide.quiz ? true : null,
        };
      });
      const answered = perSlide.filter((p) => p.correct !== null).length;

      const seed = {
        repoSlug: repo.slug,
        repoRef: repo.ref,
        unitTitle: repoUnits.find((u) => u.id === lesson!.unitId)?.title ?? "",
        lessonTitle: lesson.title,
        lessonIndex: lesson.orderIndex,
        lessonCount: 0,
        lessonSeq: lesson.globalSeq,
        lessonSeqTotal: 0,
      };
      const snapshot = (await externalizeDeckImages(deck, ctx.user.id)).deck;

      return db.transaction(async (tx) => {
        // One key per lesson: rebuilding replaces the old one rather than
        // stacking keys that disagree after the preset is regenerated.
        const previous = await tx
          .select({ id: runs.id })
          .from(runs)
          .where(and(eq(runs.lessonId, lesson!.id), eq(runs.isAnswerKey, true)));
        for (const p of previous) {
          await tx.delete(lessonLogs).where(eq(lessonLogs.runId, p.id));
          await tx.delete(runs).where(eq(runs.id, p.id));
        }
        const [{ id }] = await tx
          .insert(runs)
          .values({
            slideToolId: tool.id,
            repoId: repo.id,
            lessonId: lesson!.id,
            // No userId: nobody played it, so it belongs to no one's progress.
            userId: null,
            playerName: "Answer key",
            seedJson: seed,
            level: deck.level,
            imageStyle: deck.imageStyle,
            slideCount: deck.slides.length,
            scoreCorrect: answered,
            scoreTotal: answered,
            elapsedSec: 0,
            deckJson: snapshot,
            isAnswerKey: true,
          })
          .returning({ id: runs.id });
        await tx.insert(lessonLogs).values({
          repoId: repo.id,
          lessonId: lesson!.id,
          runId: id,
          userId: null,
          level: deck.level,
          scoreCorrect: answered,
          scoreTotal: answered,
          elapsedSec: 0,
          perSlideJson: perSlide,
        });
        return { runId: id, answered };
      });
    }),

  /** The lesson's answer-key run, if the owner has published one. */
  answerKeyFor: publicQuery
    .input(z.object({ repoSlug: z.string(), lessonSeq: z.number().int() }))
    .query(async ({ input }): Promise<{ runId: number; scoreTotal: number } | null> => {
      const db = getDb();
      const repo = await db.query.repos.findFirst({ where: eq(repos.slug, input.repoSlug) });
      if (!repo) return null;
      const repoUnits = await db.select().from(units).where(eq(units.repoId, repo.id));
      for (const u of repoUnits) {
        const lesson = await db.query.lessons.findFirst({
          where: and(eq(lessons.unitId, u.id), eq(lessons.globalSeq, input.lessonSeq)),
        });
        if (!lesson) continue;
        const key = await db.query.runs.findFirst({
          where: and(eq(runs.lessonId, lesson.id), eq(runs.isAnswerKey, true)),
        });
        return key ? { runId: key.id, scoreTotal: key.scoreTotal } : null;
      }
      return null;
    }),

  /**
   * Full run detail for the Runs-page drawer: the run row plus a clean
   * per-slide recap. Slide titles/components come from the stored deck
   * snapshot (deckJson); recorded answers come from the lessonLogs row
   * (perSlideJson) written for repo-launched plays.
   */
  get: publicQuery
    .input(z.object({ runId: z.number().int() }))
    .query(async ({ input }): Promise<RunDetail> => {
      const db = getDb();
      const r = await db.query.runs.findFirst({ where: eq(runs.id, input.runId) });
      if (!r) throw new TRPCError({ code: "NOT_FOUND", message: "Run not found" });
      const row = await toRunRow(db, r);

      const log = await db.query.lessonLogs.findFirst({ where: eq(lessonLogs.runId, r.id) });
      const answers: LessonLogSlide[] = Array.isArray(log?.perSlideJson)
        ? (log!.perSlideJson as LessonLogSlide[])
        : [];
      const deck = (r.deckJson ?? null) as SlideDeck | null;
      const deckSlides = deck && Array.isArray(deck.slides) ? deck.slides : [];

      const count = Math.max(deckSlides.length, answers.length);
      const slides: RunSlideDetail[] = [];
      for (let i = 0; i < count; i++) {
        const d = deckSlides[i];
        const a = answers[i];
        slides.push({
          title: a?.title ?? d?.title ?? `Slide ${i + 1}`,
          components: Array.isArray(d?.components) ? d.components.map((c) => c.type) : [],
          question: a?.question ?? d?.quiz?.question ?? null,
          chosenOption: a?.chosenOption ?? null,
          correct: a?.correct ?? null,
        });
      }
      return { ...row, slides };
    }),

  /**
   * Full replay of a past play: the exact stored deck (deckJson) plus the
   * student's recorded answers, so the played slideshow is navigable again
   * like a reviewable post. Access is scoped — only the player who made the
   * run, the repo owner, moderators and admins may replay it.
   */
  replay: publicQuery
    .input(z.object({ runId: z.number().int() }))
    .query(async ({ ctx, input }): Promise<RunReplay> => {
      const db = getDb();
      const r = await db.query.runs.findFirst({ where: eq(runs.id, input.runId) });
      if (!r) throw new TRPCError({ code: "NOT_FOUND", message: "Run not found" });

      // access control: own run, or repo owner, or moderator/admin
      let repoOwnerId: number | null = null;
      let repoIsPublic = false;
      if (r.repoId) {
        const repo = await db.query.repos.findFirst({ where: eq(repos.id, r.repoId) });
        repoOwnerId = repo?.ownerId ?? null;
        repoIsPublic = repo?.isPublic ?? false;
      }
      // An answer key is published on purpose: it holds the correct answers and
      // nobody's own work, so anyone who can open the lesson can read it. That
      // is the whole reason it exists — a student with no credits checking their
      // answers without playing.
      const isPublishedKey = r.isAnswerKey && (repoIsPublic || repoOwnerId === ctx.user?.id);
      const privileged =
        isPublishedKey ||
        (!!ctx.user &&
          (r.userId === ctx.user.id ||
            repoOwnerId === ctx.user.id ||
            ctx.user.role === "moderator" ||
            ctx.user.role === "admin"));
      if (!privileged) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You can only replay your own presentation runs.",
        });
      }

      const row = await toRunRow(db, r);
      const deck = (r.deckJson ?? null) as SlideDeck | null;
      const log = await db.query.lessonLogs.findFirst({ where: eq(lessonLogs.runId, r.id) });
      const recorded: LessonLogSlide[] = Array.isArray(log?.perSlideJson)
        ? (log!.perSlideJson as LessonLogSlide[])
        : [];

      const slides = deck && Array.isArray(deck.slides) ? deck.slides : [];
      const answers = slides.map((s, i) => {
        const a = recorded[i];
        const correctOption = s.quiz
          ? s.quiz.answer ??
            (s.quiz.options && typeof s.quiz.correctIndex === "number"
              ? (s.quiz.options[s.quiz.correctIndex] ?? null)
              : null)
          : null;
        return {
          chosenOption: a?.chosenOption ?? null,
          correctOption,
          correct: a?.correct ?? null,
        };
      });
      const annotations = (r.annotationsJson ?? null) as RunReplay["annotations"];
      return { ...row, deck, answers, annotations };
    }),

  listGlobal: publicQuery
    .input(
      z
        .object({
          limit: z.number().int().min(1).max(100).default(25),
          offset: z.number().int().min(0).default(0),
        })
        .optional(),
    )
    .query(async ({ input }) => {
      const db = getDb();
      const rows = await db
        .select()
        .from(runs)
        .orderBy(desc(runs.completedAt))
        .limit(input?.limit ?? 25)
        .offset(input?.offset ?? 0);
      return toRunRows(db, rows);
    }),

  listMine: authedProcedure
    .input(z.object({ limit: z.number().int().min(1).max(100).default(50) }).optional())
    .query(async ({ ctx, input }) => {
      const db = getDb();
      const rows = await db
        .select()
        .from(runs)
        .where(eq(runs.userId, ctx.user.id))
        .orderBy(desc(runs.completedAt))
        .limit(input?.limit ?? 50);
      return toRunRows(db, rows);
    }),

  setFlagged: moderatorProcedure
    .input(z.object({ runId: z.number().int(), flagged: z.boolean() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      await db.update(runs).set({ flagged: input.flagged }).where(eq(runs.id, input.runId));
      return { ok: true as const };
    }),
});
