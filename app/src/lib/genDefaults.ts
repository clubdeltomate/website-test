import { TEXT_DENSITY_META, type ImageStyle, type Level, type TextDensity } from '@contracts/types';

/**
 * Per-user "last setting is the new default" for slide generation. The values
 * a user last generated with (slide count, CEFR level, image style) become the
 * defaults they see next time — remembered locally, keyed per user so two
 * accounts on the same browser don't collide.
 *
 * Base defaults when a user has no history yet: 4 slides, A1 (the simplest
 * level — right for walkthroughs, news briefings and showcases), sketch style.
 */
/** Re-exported so existing imports keep working; the scale itself lives in
 *  contracts, where the generator's prompt reads the same definition. */
export type { TextDensity };

export interface GenDefaults {
  slideCount: number;
  level: Level;
  imageStyle: ImageStyle;
  textDensity: TextDensity;
  /** Slides type: true = the deck evaluates as it teaches (quiz slides),
   *  false = it only presents. Chosen in the creation wizard and remembered
   *  like the rest, so the tool page opens on the same choice. */
  includeQuiz: boolean;
  /** Which half of the catalog the layouts are drawn from. */
  subject: 'auto' | 'stem' | 'humanities';
  /** A TEMPLATE_FLAVORS id narrowing the catalog further, or null for all. */
  flavor: string | null;
  /** One layout name per slide, in running order — the shuffleable plan built
   *  in the wizard. Empty means "let the AI choose each layout". */
  templatePlan: (string | null)[];
}

export const BASE_GEN_DEFAULTS: GenDefaults = {
  slideCount: 4,
  level: 'A1',
  imageStyle: 'sketch',
  textDensity: 'standard',
  includeQuiz: true,
  subject: 'auto',
  flavor: null,
  templatePlan: [],
};

/**
 * The image-style presets offered in the UI, in display order. Shared so the
 * "New slide tool" wizard and the tool's own settings page offer exactly the
 * same choices — if they drifted, a style picked at creation could be one the
 * settings page cannot show.
 */
export const STYLE_PRESETS: Exclude<ImageStyle, 'none'>[] = [
  'sketch',
  'watercolor',
  'flat',
  'photo',
];

/** Slide-count range shared by the creation wizard and the settings page. */
export const SLIDE_COUNT_MIN = 4;
export const SLIDE_COUNT_MAX = 15;

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
      includeQuiz:
        typeof parsed.includeQuiz === 'boolean'
          ? parsed.includeQuiz
          : BASE_GEN_DEFAULTS.includeQuiz,
      subject: parsed.subject ?? BASE_GEN_DEFAULTS.subject,
      flavor: parsed.flavor ?? BASE_GEN_DEFAULTS.flavor,
      templatePlan: Array.isArray(parsed.templatePlan)
        ? parsed.templatePlan
        : BASE_GEN_DEFAULTS.templatePlan,
      // "detailed" was the old top tier; it maps onto "explained", which has
      // the closest target. Without this a returning user's stored value would
      // fall through to standard and their decks would quietly get shorter.
      textDensity:
        (parsed.textDensity as string) === 'detailed'
          ? 'explained'
          : parsed.textDensity && parsed.textDensity in TEXT_DENSITY_META
            ? (parsed.textDensity as TextDensity)
            : BASE_GEN_DEFAULTS.textDensity,
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
