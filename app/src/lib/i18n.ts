import { ES } from '@/lib/i18n.es';

/* The site in more than one language.
 *
 * Keyed by the English string itself, not by an invented id. `say("Save")`
 * rather than `say("card.actions.save")`. Two reasons, both about what happens
 * when a translation is missing: a source-keyed lookup falls back to
 * perfectly good English, where an id-keyed one falls back to
 * "card.actions.save" on the button; and the code stays readable — you can
 * see what a screen says without opening a second file.
 *
 * `say` is a plain function reading a module-level language rather than a
 * hook, so it can be called anywhere a string is rendered — inside a
 * component, inside a `.map` over a module-level constant, inside a toast
 * handler. The provider sets the language during its own render, before any
 * child renders, and re-renders the tree when it changes.
 *
 * It is `say` and not the conventional `t` because this codebase already
 * uses `t` for dozens of ordinary locals — a template, a totals object, a
 * timer handle. An import named `t` would be silently shadowed inside those
 * scopes, and a shadowed translator does not fail loudly, it calls a totals
 * object as a function in whichever branch nobody clicked yet.
 */

export type Lang = 'en' | 'es';

export const LANGS: { id: Lang; label: string; short: string }[] = [
  { id: 'en', label: 'English', short: 'EN' },
  { id: 'es', label: 'Español', short: 'ES' },
];

const DICTS: Record<Lang, Record<string, string>> = { en: {}, es: ES };

let current: Lang = 'en';

export const getLang = (): Lang => current;

/** Set by the provider during render. Not for calling from anywhere else. */
export function applyLang(lang: Lang): void {
  current = lang;
}

/**
 * Collapse the whitespace JSX invents.
 *
 * A sentence written across three indented lines in a component arrives here
 * with newlines and runs of spaces in it, and the browser renders it as one
 * line. The dictionary is keyed on what is rendered, so both sides normalise
 * the same way and reformatting a component never silently drops its
 * translation.
 */
const norm = (s: string): string => s.trim().replace(/\s+/g, ' ');

/* Overloaded so that wrapping an optional label — `say(spec?.hint)` — keeps
   its optionality instead of lying about it. A missing string comes back
   missing; it is not turned into an empty one, because an empty helper line
   and no helper line are different things on screen. */
export function say(source: string): string;
export function say(source: string | undefined): string | undefined;
export function say(source: string | undefined): string | undefined {
  if (current === 'en' || !source) return source;
  const dict = DICTS[current];
  const hit = dict[source] ?? dict[norm(source)];
  if (hit === undefined) return source;
  /* Leading and trailing spaces in JSX text are load-bearing — they are the
     gap between a word and the element next to it — and no translator should
     have to remember to keep them. They are put back here. */
  const lead = /^\s*/.exec(source)?.[0] ?? '';
  const tail = source.trim() ? (/\s*$/.exec(source)?.[0] ?? '') : '';
  return `${lead}${hit}${tail}`;
}

/**
 * A number and its noun, in the right language.
 *
 * Spanish and English agree on when to pluralise, which is the only reason
 * one helper covers both; a language that does not agree would need its own
 * rule rather than another argument here.
 */
export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? say(one) : say(many)}`;
}

/** Whether a string has a translation — used by the coverage check. */
export function has(lang: Lang, source: string): boolean {
  const dict = DICTS[lang];
  return dict[source] !== undefined || dict[norm(source)] !== undefined;
}

export const dictionaryFor = (lang: Lang): Record<string, string> => DICTS[lang];
