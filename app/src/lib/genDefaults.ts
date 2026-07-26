import type { ImageStyle, Level } from '@contracts/types';

/**
 * Per-user "last setting is the new default" for slide generation. The values
 * a user last generated with (slide count, CEFR level, image style) become the
 * defaults they see next time — remembered locally, keyed per user so two
 * accounts on the same browser don't collide.
 *
 * Base defaults when a user has no history yet: 4 slides, A1 (the simplest
 * level — right for walkthroughs, news briefings and showcases), sketch style.
 */
export type TextDensity = 'brief' | 'standard' | 'detailed';

export interface GenDefaults {
  slideCount: number;
  level: Level;
  imageStyle: ImageStyle;
  textDensity: TextDensity;
}

export const BASE_GEN_DEFAULTS: GenDefaults = {
  slideCount: 4,
  level: 'A1',
  imageStyle: 'sketch',
  textDensity: 'standard',
};

function storageKey(userId?: number | null): string {
  return `sketchlearn:gendefaults:${userId ?? 'guest'}`;
}

export function loadGenDefaults(userId?: number | null): GenDefaults {
  if (typeof window === 'undefined') return { ...BASE_GEN_DEFAULTS };
  try {
    const raw = window.localStorage.getItem(storageKey(userId));
    if (!raw) return { ...BASE_GEN_DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<GenDefaults>;
    return {
      slideCount:
        typeof parsed.slideCount === 'number'
          ? Math.min(15, Math.max(4, parsed.slideCount))
          : BASE_GEN_DEFAULTS.slideCount,
      level: (parsed.level as Level) ?? BASE_GEN_DEFAULTS.level,
      imageStyle: (parsed.imageStyle as ImageStyle) ?? BASE_GEN_DEFAULTS.imageStyle,
      textDensity: (parsed.textDensity as TextDensity) ?? BASE_GEN_DEFAULTS.textDensity,
    };
  } catch {
    return { ...BASE_GEN_DEFAULTS };
  }
}

/** Remember the values a user just generated with, so they seed next time. */
export function saveGenDefaults(userId: number | null | undefined, next: GenDefaults): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(storageKey(userId), JSON.stringify(next));
  } catch {
    /* storage unavailable — best-effort only */
  }
}
