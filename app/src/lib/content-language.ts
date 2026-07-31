import { LANGUAGES, languageName } from '@contracts/languages';
import type { Lang } from '@/lib/i18n';

/* Which work shows up on which shelf.
 *
 * The rule, in one sentence: **Spanish is exclusive, English is the catch-all.**
 *
 * Reading the site in Spanish, you see Spanish work and nothing else — a
 * Spanish speaker browsing a Spanish site should not have to scroll past
 * English decks to find one they can read. Reading it in English, you see
 * everything, because English is where every other language lives too. A
 * French lesson carries an FR sticker so you can see what it is, but it sits
 * on the English shelf rather than getting a shelf of its own — there is no
 * point in a French-only view until there is enough French to fill one.
 *
 * The filter chips above each shelf are how you override that. They are not a
 * separate mechanism: the default chip is whatever this rule picks, and
 * changing the site's language moves the default with it.
 */

/** A shelf shows one language, or all of them. */
export type LanguageFilter = 'all' | string;

/**
 * What a shelf shows when nobody has touched the filter.
 *
 * Spanish narrows to Spanish; every other reading language is the catch-all.
 * Written as a function of the UI language rather than as a constant so that
 * adding, say, Portuguese as a site language is one line here and no changes
 * anywhere else.
 */
export const defaultFilterFor = (ui: Lang): LanguageFilter => (ui === 'es' ? 'es' : 'all');

/** What goes to the server: undefined means "do not narrow". */
export const filterToQuery = (f: LanguageFilter): string | undefined =>
  f === 'all' ? undefined : f;

/**
 * The two letters on the sticker.
 *
 * Uppercase ISO 639-1 — EN, ES, FR, PT. Not an invented abbreviation: the
 * codes are what the rest of the stack already stores, and a sticker that
 * disagrees with the database is a sticker nobody can trust.
 */
export const shortCode = (code: string): string => (code || 'en').slice(0, 2).toUpperCase();

/** "Español", for a menu — people look for their language under its own name. */
export const endonym = (code: string): string =>
  LANGUAGES.find((l) => l.code === code)?.endonym ?? languageName(code);

/**
 * The chips to offer above a shelf.
 *
 * Built from what is actually there, plus the two that always exist, rather
 * than listing all fifteen languages the generator can write: a filter for a
 * language nothing on the site is written in is a dead control.
 */
export function chipsFor(present: string[]): string[] {
  const seen = new Set(present.filter(Boolean));
  seen.add('en');
  seen.add('es');
  return [...seen].sort((a, b) => {
    // en and es first, in that order; everything else alphabetically after.
    const rank = (c: string) => (c === 'en' ? 0 : c === 'es' ? 1 : 2);
    return rank(a) - rank(b) || a.localeCompare(b);
  });
}
