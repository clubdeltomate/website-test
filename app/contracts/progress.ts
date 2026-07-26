/* ------------------------------------------------------------------ */
/* Shared lesson-progress rules.                                        */
/* One definition of "passing" used by the API (status computation)     */
/* and the player UI (finish-screen verdict) so they never disagree.    */
/* ------------------------------------------------------------------ */

/** Minimum first-try quiz accuracy to mark a lesson as completed. */
export const PASS_THRESHOLD = 0.7;

/**
 * A play passes when the student answered at least PASS_THRESHOLD of the
 * quizzes correctly. A deck with no quizzes counts as passed by finishing it.
 */
export function isPassingScore(correct: number, total: number): boolean {
  if (total === 0) return true;
  return correct / total >= PASS_THRESHOLD;
}

/**
 * Per-viewer status of a lesson:
 * - "unplayed": the viewer has never finished this lesson
 * - "try-again": finished at least once but never with a passing score
 * - "completed": passed at least once (best score is kept)
 */
export type LessonProgressStatus = "unplayed" | "try-again" | "completed";
