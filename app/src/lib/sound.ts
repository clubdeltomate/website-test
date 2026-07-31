import { useSyncExternalStore } from 'react';

/* ------------------------------------------------------------------ */
/* Sound: one switch for the whole feed.                                */
/* ------------------------------------------------------------------ */

/**
 * Whether posts play their music, kept outside React.
 *
 * It is one decision, not one per post. Turning the sound on and then having
 * it go off again at the next post is not what the switch means — it means
 * "I want to hear these", and it should hold until it is turned off. Every
 * carousel on screen reads the same value, so the button says the same thing
 * everywhere and flipping it anywhere flips it everywhere.
 *
 * Remembered across reloads, because a preference that resets is a
 * preference you have to keep re-stating. It starts off: no browser lets a
 * page make noise unasked, and no reader wants it to.
 */
const KEY = 'sketchlearn.sound';

let on = false;
try {
  on = typeof window !== 'undefined' && window.localStorage.getItem(KEY) === '1';
} catch {
  /* storage unavailable — the switch still works, it just forgets */
}

const listeners = new Set<() => void>();

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function setSoundOn(next: boolean): void {
  if (on === next) return;
  on = next;
  try {
    window.localStorage.setItem(KEY, next ? '1' : '0');
  } catch {
    /* see above */
  }
  for (const fn of listeners) fn();
}

/** True when the reader has asked to hear the music. */
export function useSoundOn(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => on,
    () => false,
  );
}
