import { createContext, useCallback, useContext } from 'react';

/**
 * Shared state for lesson generations that are running right now.
 *
 * A deck takes 30-60 seconds to make, and the wizard used to own that wait: the
 * modal sat there spinning and the author was pinned to the page. Tracked above
 * the router instead, the spinner survives navigating away and coming back, so
 * a lesson can be started and then left alone.
 *
 * The context and its hook live apart from the provider component so a module
 * exports either components or helpers, never both — Fast Refresh cannot handle
 * a file that mixes them.
 */
export type LessonKey = string;
export const lessonKey = (repoSlug: string, lessonSeq: number): LessonKey =>
  `${repoSlug}:${lessonSeq}`;

/**
 * A failed attempt, in two halves.
 *
 * `summary` is the sentence anyone should read. `detail` names each provider
 * that was tried and what it said, which only an admin can act on — and which
 * is the difference between "no key configured" and "the key is fine but the
 * model refused a 16k-token deck request", two problems with the same summary
 * and completely different fixes.
 */
export interface LessonFailure {
  summary: string;
  detail: string | null;
}

export interface LessonGenerationApi {
  /** Run `job` for this lesson, marking it busy until it settles. */
  start: (repoSlug: string, lessonSeq: number, job: () => Promise<void>) => void;
  isRunning: (repoSlug: string, lessonSeq: number) => boolean;
  /**
   * Why the last attempt for this lesson failed, or null.
   *
   * A generation runs for the best part of a minute and its only report was a
   * toast, which is gone by the time anyone looks back at the row. The button
   * then reverted to "Set" — the same thing it says for a lesson nobody has
   * ever tried — so a permanent failure was indistinguishable from an untouched
   * lesson, and the honest answer to "why won't my presentation load" was
   * sitting in a notification nobody saw.
   */
  failureOf: (repoSlug: string, lessonSeq: number) => LessonFailure | null;
  /** Record why an attempt failed, so the row can keep saying so. */
  fail: (repoSlug: string, lessonSeq: number, failure: LessonFailure) => void;
}

export const LessonGenerationCtx = createContext<LessonGenerationApi | null>(null);

/** Null-safe: components may render outside the provider (tests, stories). */
export function useLessonGeneration(): LessonGenerationApi {
  const ctx = useContext(LessonGenerationCtx);
  const fallbackStart = useCallback(
    (_repoSlug: string, _lessonSeq: number, job: () => Promise<void>) => void job(),
    [],
  );
  const fallbackRunning = useCallback(() => false, []);
  const fallbackFailure = useCallback(() => null, []);
  const fallbackFail = useCallback(() => undefined, []);
  return (
    ctx ?? {
      start: fallbackStart,
      isRunning: fallbackRunning,
      failureOf: fallbackFailure,
      fail: fallbackFail,
    }
  );
}
