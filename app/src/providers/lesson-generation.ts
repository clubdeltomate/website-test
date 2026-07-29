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

export interface LessonGenerationApi {
  /** Run `job` for this lesson, marking it busy until it settles. */
  start: (repoSlug: string, lessonSeq: number, job: () => Promise<void>) => void;
  isRunning: (repoSlug: string, lessonSeq: number) => boolean;
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
  return ctx ?? { start: fallbackStart, isRunning: fallbackRunning };
}
