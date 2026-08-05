import { useCallback, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  LessonGenerationCtx,
  lessonKey,
  type LessonKey,
} from './lesson-generation';

/**
 * Holds the lesson generations that are in flight. Mounted above the router so
 * the work outlives both the wizard that started it and the page it started on.
 *
 * In memory only, so a full reload forgets what was running — but the
 * generation is a single server request that also SAVES the deck, so the work
 * still completes and a refreshed page simply shows the finished Play button.
 */
export function LessonGenerationProvider({ children }: { children: ReactNode }) {
  const [running, setRunning] = useState<ReadonlySet<LessonKey>>(() => new Set());
  // Ref mirror so start() can reject a duplicate without depending on state.
  const runningRef = useRef<Set<LessonKey>>(new Set());
  /* Why the last attempt for each lesson failed. Kept beside the running set
     because it is the same question asked at a different moment — "what is this
     lesson doing" and "what did it just do" — and the row needs both to say
     anything truthful about its button. */
  const [failures, setFailures] = useState<ReadonlyMap<LessonKey, string>>(() => new Map());

  const start = useCallback((repoSlug: string, lessonSeq: number, job: () => Promise<void>) => {
    const key = lessonKey(repoSlug, lessonSeq);
    // A second press while the first is still going would charge twice for the
    // same lesson and race over which deck wins.
    if (runningRef.current.has(key)) return;
    runningRef.current.add(key);
    setRunning(new Set(runningRef.current));
    // Trying again clears the last complaint — it is about to be replaced by
    // whatever this attempt does.
    setFailures((prev) => {
      if (!prev.has(key)) return prev;
      const next = new Map(prev);
      next.delete(key);
      return next;
    });
    void job().finally(() => {
      runningRef.current.delete(key);
      setRunning(new Set(runningRef.current));
    });
  }, []);

  const isRunning = useCallback(
    (repoSlug: string, lessonSeq: number) => running.has(lessonKey(repoSlug, lessonSeq)),
    [running],
  );

  const fail = useCallback((repoSlug: string, lessonSeq: number, message: string) => {
    setFailures((prev) => new Map(prev).set(lessonKey(repoSlug, lessonSeq), message));
  }, []);

  const failureOf = useCallback(
    (repoSlug: string, lessonSeq: number) => failures.get(lessonKey(repoSlug, lessonSeq)) ?? null,
    [failures],
  );

  const api = useMemo(
    () => ({ start, isRunning, fail, failureOf }),
    [start, isRunning, fail, failureOf],
  );
  return <LessonGenerationCtx.Provider value={api}>{children}</LessonGenerationCtx.Provider>;
}
