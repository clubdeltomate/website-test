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
 * The filter chips above each shelf are how you override that, and there are
 * exactly two of them: EN and ES. There is no third "All" chip, because EN
 * already IS all — a shelf showing English is a shelf showing everything.
 * Offering All beside English would be offering the same thing twice.
 */

/** Which shelf you are reading: everything, or Spanish only. */
export type LanguageFilter = 'en' | 'es';

/**
 * What a shelf shows when nobody has touched the filter.
 *
 * Spanish narrows to Spanish; every other reading language is the catch-all.
 * Written as a function of the UI language rather than as a constant so that
 * adding, say, Portuguese as a site language is one line here and no changes
 * anywhere else.
 */
export const defaultFilterFor = (ui: Lang): LanguageFilter => (ui === 'es' ? 'es' : 'en');

/**
 * What goes to the server.
 *
 * Undefined for English — not `'en'`. Narrowing to the code "en" would show
 * English work and hide the French and Portuguese work that belongs on the
 * same shelf, which is the opposite of what the English shelf is for.
 */
export const filterToQuery = (f: LanguageFilter): string | undefined =>
  f === 'es' ? 'es' : undefined;

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
