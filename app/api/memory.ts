import { getDb } from "./queries/connection.js";
import { lessons, units, lessonLogs } from "../db/schema.js";
import { and, eq, inArray, lt } from "drizzle-orm";
import type { CourseMemoryEntry, LessonLogSlide } from "../contracts/types.js";

/**
 * Build the "PREVIOUSLY TAUGHT" block for a repo lesson: titles, taught
 * summaries and student scores from lessonLogs of lessons with
 * globalSeq < lessonSeq (design.md §9 cross-lesson memory).
 *
 * Memory is PER STUDENT: only the given user's own logs count, so one
 * learner's progress never changes what another learner is taught.
 * Guests (no userId) get no memory — every deck starts fresh.
 */
export async function buildPreviouslyTaught(
  repoId: number,
  lessonSeq: number,
  userId: number | undefined,
): Promise<string | null> {
  if (!userId) return null;
  const db = getDb();
  const repoUnits = await db.select().from(units).where(eq(units.repoId, repoId));
  const unitIds = repoUnits.map((u) => u.id);
  if (unitIds.length === 0) return null;
  const priorLessons = await db
    .select()
    .from(lessons)
    .where(and(inArray(lessons.unitId, unitIds), lt(lessons.globalSeq, lessonSeq)));
  if (priorLessons.length === 0) return null;
  const priorIds = priorLessons.map((l) => l.id);
  const logs = await db
    .select()
    .from(lessonLogs)
    .where(
      and(
        eq(lessonLogs.repoId, repoId),
        eq(lessonLogs.userId, userId),
        inArray(lessonLogs.lessonId, priorIds),
      ),
    );

  const lines: string[] = [];
  const sorted = [...priorLessons].sort((a, b) => a.globalSeq - b.globalSeq);
  for (const lesson of sorted) {
    const lessonLogList = logs.filter((lg) => lg.lessonId === lesson.id);
    if (lessonLogList.length === 0) continue; // not taught yet — nothing to assume
    const latest = lessonLogList[lessonLogList.length - 1];
    const perSlide = (latest.perSlideJson ?? []) as LessonLogSlide[];
    const summaries = perSlide
      .map((s) => s.summary)
      .filter(Boolean)
      .slice(0, 4)
      .join(" · ");
    const scores = lessonLogList
      .map((lg) => `${lg.scoreCorrect}/${lg.scoreTotal}`)
      .slice(-3)
      .join(", ");
    lines.push(
      `- Lesson ${lesson.globalSeq} "${lesson.title}" — student score(s): ${scores}. Taught: ${summaries || lesson.title}`,
    );
  }
  return lines.length > 0 ? lines.join("\n") : null;
}

/**
 * Folded memory for the repo page "Course memory" panel — scoped to the
 * viewing user's own logs (guests see an empty panel).
 */
export async function courseMemory(
  repoId: number,
  userId: number | undefined,
): Promise<CourseMemoryEntry[]> {
  if (!userId) return [];
  const db = getDb();
  const repoUnits = await db.select().from(units).where(eq(units.repoId, repoId));
  const unitById = new Map(repoUnits.map((u) => [u.id, u]));
  const unitIds = repoUnits.map((u) => u.id);
  if (unitIds.length === 0) return [];
  const repoLessons = await db.select().from(lessons).where(inArray(lessons.unitId, unitIds));
  const logs = await db
    .select()
    .from(lessonLogs)
    .where(and(eq(lessonLogs.repoId, repoId), eq(lessonLogs.userId, userId)));

  const entries: CourseMemoryEntry[] = [];
  for (const lesson of repoLessons.sort((a, b) => a.globalSeq - b.globalSeq)) {
    const lessonLogList = logs.filter((lg) => lg.lessonId === lesson.id);
    if (lessonLogList.length === 0) continue;
    const latest = lessonLogList[lessonLogList.length - 1];
    const perSlide = (latest.perSlideJson ?? []) as LessonLogSlide[];
    const best = lessonLogList.reduce(
      (acc, lg) => (lg.scoreTotal > 0 && lg.scoreCorrect / lg.scoreTotal > acc.correct / Math.max(1, acc.total)
        ? { correct: lg.scoreCorrect, total: lg.scoreTotal }
        : acc),
      { correct: lessonLogList[0].scoreCorrect, total: lessonLogList[0].scoreTotal },
    );
    entries.push({
      lessonSeq: lesson.globalSeq,
      lessonTitle: lesson.title,
      unitTitle: unitById.get(lesson.unitId)?.title ?? "",
      timesTaught: lessonLogList.length,
      bestScoreCorrect: best.correct,
      bestScoreTotal: best.total,
      lastLevel: latest.level,
      summaries: perSlide.map((s) => s.summary).filter(Boolean).slice(0, 4),
    });
  }
  return entries;
}
