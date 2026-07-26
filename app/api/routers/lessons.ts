import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { asc, eq, inArray } from "drizzle-orm";
import { createRouter } from "../middleware.js";
import { authedProcedure } from "../procedures.js";
import { getDb } from "../queries/connection.js";
import { lessons, repos, units, type Repo, type User } from "../../db/schema.js";

/* ------------------------------------------------------------------ */
/* Ownership helpers — every mutation verifies owner-or-admin via the  */
/* FK chain (unit → repo / lesson → unit → repo).                      */
/* ------------------------------------------------------------------ */

function assertCanEdit(repo: Repo, user: User) {
  if (repo.ownerId !== user.id && user.role !== "admin") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Only the owner or an admin can edit this notebook",
    });
  }
}

async function repoBySlug(slug: string): Promise<Repo> {
  const repo = await getDb().query.repos.findFirst({ where: eq(repos.slug, slug) });
  if (!repo) throw new TRPCError({ code: "NOT_FOUND", message: "Repository not found" });
  return repo;
}

async function repoByUnitId(unitId: number): Promise<{ repo: Repo; unit: typeof units.$inferSelect }> {
  const db = getDb();
  const unit = await db.query.units.findFirst({ where: eq(units.id, unitId) });
  if (!unit) throw new TRPCError({ code: "NOT_FOUND", message: "Unit not found" });
  const repo = await db.query.repos.findFirst({ where: eq(repos.id, unit.repoId) });
  if (!repo) throw new TRPCError({ code: "NOT_FOUND", message: "Repository not found" });
  return { repo, unit };
}

async function repoByLessonId(
  lessonId: number,
): Promise<{ repo: Repo; unit: typeof units.$inferSelect; lesson: typeof lessons.$inferSelect }> {
  const db = getDb();
  const lesson = await db.query.lessons.findFirst({ where: eq(lessons.id, lessonId) });
  if (!lesson) throw new TRPCError({ code: "NOT_FOUND", message: "Lesson not found" });
  const { repo, unit } = await repoByUnitId(lesson.unitId);
  return { repo, unit, lesson };
}

/**
 * Renumber lesson globalSeq across a whole repo: 1..M in unit order,
 * then lesson order. Sub-lessons share their parent's seq (they never
 * advance it — see db/seed.ts); orphaned subs are renumbered in place.
 */
async function renumberGlobalSeq(repoId: number): Promise<void> {
  const db = getDb();
  const repoUnits = await db
    .select()
    .from(units)
    .where(eq(units.repoId, repoId))
    .orderBy(asc(units.orderIndex));
  let seq = 0;
  for (const u of repoUnits) {
    const ls = await db
      .select()
      .from(lessons)
      .where(eq(lessons.unitId, u.id))
      .orderBy(asc(lessons.orderIndex));
    const top = ls.filter((l) => l.parentLessonId == null);
    const subs = ls.filter((l) => l.parentLessonId != null);
    const topIds = new Set(top.map((t) => t.id));
    for (const l of top) {
      seq += 1;
      if (l.globalSeq !== seq) {
        await db.update(lessons).set({ globalSeq: seq }).where(eq(lessons.id, l.id));
      }
      for (const s of subs.filter((x) => x.parentLessonId === l.id)) {
        if (s.globalSeq !== seq) {
          await db.update(lessons).set({ globalSeq: seq }).where(eq(lessons.id, s.id));
        }
      }
    }
    // sub-lessons whose parent no longer exists keep order but get their own seq
    for (const s of subs.filter((x) => !topIds.has(x.parentLessonId!))) {
      seq += 1;
      if (s.globalSeq !== seq) {
        await db.update(lessons).set({ globalSeq: seq }).where(eq(lessons.id, s.id));
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/* units                                                               */
/* ------------------------------------------------------------------ */

export const unitsRouter = createRouter({
  create: authedProcedure
    .input(
      z.object({
        repoSlug: z.string().min(1),
        title: z.string().min(1).max(255),
        orderIndex: z.number().int().min(0).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const repo = await repoBySlug(input.repoSlug);
      assertCanEdit(repo, ctx.user);
      const existing = await db
        .select()
        .from(units)
        .where(eq(units.repoId, repo.id))
        .orderBy(asc(units.orderIndex));
      const orderIndex = input.orderIndex ?? existing.length;
      // make room if inserting in the middle
      for (const u of existing.filter((u) => u.orderIndex >= orderIndex)) {
        await db
          .update(units)
          .set({ orderIndex: u.orderIndex + 1 })
          .where(eq(units.id, u.id));
      }
      const [{ id }] = await db
        .insert(units)
        .values({ repoId: repo.id, title: input.title, orderIndex })
        .returning({ id: units.id });
      await renumberGlobalSeq(repo.id);
      return { ok: true as const, unitId: id };
    }),

  update: authedProcedure
    .input(z.object({ unitId: z.number().int(), title: z.string().min(1).max(255) }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const { repo, unit } = await repoByUnitId(input.unitId);
      assertCanEdit(repo, ctx.user);
      await db.update(units).set({ title: input.title }).where(eq(units.id, unit.id));
      return { ok: true as const };
    }),

  delete: authedProcedure
    .input(z.object({ unitId: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const { repo, unit } = await repoByUnitId(input.unitId);
      assertCanEdit(repo, ctx.user);
      await db.delete(lessons).where(eq(lessons.unitId, unit.id));
      await db.delete(units).where(eq(units.id, unit.id));
      // close the gap in unit order
      const remaining = await db
        .select()
        .from(units)
        .where(eq(units.repoId, repo.id))
        .orderBy(asc(units.orderIndex));
      for (let i = 0; i < remaining.length; i++) {
        if (remaining[i].orderIndex !== i) {
          await db.update(units).set({ orderIndex: i }).where(eq(units.id, remaining[i].id));
        }
      }
      await renumberGlobalSeq(repo.id);
      return { ok: true as const };
    }),
});

/* ------------------------------------------------------------------ */
/* lessons                                                             */
/* ------------------------------------------------------------------ */

export const lessonsRouter = createRouter({
  create: authedProcedure
    .input(
      z.object({
        unitId: z.number().int(),
        title: z.string().min(1).max(255),
        objective: z.string().min(1).max(4000),
        parentLessonId: z.number().int().nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const { repo, unit } = await repoByUnitId(input.unitId);
      assertCanEdit(repo, ctx.user);
      if (input.parentLessonId != null) {
        const parent = await db.query.lessons.findFirst({
          where: eq(lessons.id, input.parentLessonId),
        });
        if (!parent || parent.unitId !== unit.id) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Parent lesson not in this unit" });
        }
      }
      const existing = await db
        .select()
        .from(lessons)
        .where(eq(lessons.unitId, unit.id))
        .orderBy(asc(lessons.orderIndex));
      const orderIndex = existing.length
        ? Math.max(...existing.map((l) => l.orderIndex)) + 1
        : 0;
      const [{ id }] = await db
        .insert(lessons)
        .values({
          unitId: unit.id,
          parentLessonId: input.parentLessonId ?? null,
          title: input.title,
          objective: input.objective,
          orderIndex,
          globalSeq: 0, // fixed by renumber below
        })
        .returning({ id: lessons.id });
      await renumberGlobalSeq(repo.id);
      return { ok: true as const, lessonId: id };
    }),

  update: authedProcedure
    .input(
      z.object({
        lessonId: z.number().int(),
        title: z.string().min(1).max(255).optional(),
        objective: z.string().min(1).max(4000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const { repo, lesson } = await repoByLessonId(input.lessonId);
      assertCanEdit(repo, ctx.user);
      const set: Partial<Pick<typeof lessons.$inferSelect, "title" | "objective">> = {};
      if (input.title !== undefined) set.title = input.title;
      if (input.objective !== undefined) set.objective = input.objective;
      if (Object.keys(set).length > 0) {
        await db.update(lessons).set(set).where(eq(lessons.id, lesson.id));
      }
      return { ok: true as const };
    }),

  delete: authedProcedure
    .input(z.object({ lessonId: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const { repo, unit, lesson } = await repoByLessonId(input.lessonId);
      assertCanEdit(repo, ctx.user);
      // delete the lesson plus any sub-lessons hanging off it
      const doomed = [lesson.id];
      const subs = await db
        .select({ id: lessons.id })
        .from(lessons)
        .where(eq(lessons.parentLessonId, lesson.id));
      doomed.push(...subs.map((s) => s.id));
      await db.delete(lessons).where(inArray(lessons.id, doomed));
      // close the gap in lesson order within the unit
      const remaining = await db
        .select()
        .from(lessons)
        .where(eq(lessons.unitId, unit.id))
        .orderBy(asc(lessons.orderIndex));
      for (let i = 0; i < remaining.length; i++) {
        if (remaining[i].orderIndex !== i) {
          await db.update(lessons).set({ orderIndex: i }).where(eq(lessons.id, remaining[i].id));
        }
      }
      await renumberGlobalSeq(repo.id);
      return { ok: true as const };
    }),

  reorder: authedProcedure
    .input(
      z.object({
        unitId: z.number().int(),
        lessonIds: z.array(z.number().int()).min(1).max(200),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const { repo, unit } = await repoByUnitId(input.unitId);
      assertCanEdit(repo, ctx.user);
      const existing = await db
        .select()
        .from(lessons)
        .where(eq(lessons.unitId, unit.id))
        .orderBy(asc(lessons.orderIndex));
      const byId = new Map(existing.map((l) => [l.id, l]));
      const seen = new Set<number>();
      const ordered: typeof existing = [];
      for (const id of input.lessonIds) {
        const l = byId.get(id);
        if (l && !seen.has(id)) {
          ordered.push(l);
          seen.add(id);
        }
      }
      // anything not mentioned keeps its relative order at the end
      ordered.push(...existing.filter((l) => !seen.has(l.id)));
      for (let i = 0; i < ordered.length; i++) {
        if (ordered[i].orderIndex !== i) {
          await db.update(lessons).set({ orderIndex: i }).where(eq(lessons.id, ordered[i].id));
        }
      }
      await renumberGlobalSeq(repo.id);
      return { ok: true as const };
    }),
});
