/* ------------------------------------------------------------------ */
/* Languages a carousel can be written in.                              */
/* ------------------------------------------------------------------ */

/**
 * Each entry carries the name in English — which is what the model is
 * instructed with — and the endonym, which is what the picker shows, because
 * someone looking for Portuguese is looking for "Português".
 */
export interface Language {
  code: string;
  /** how the AI is told which language to write in */
  name: string;
  /** what it calls itself, for the menu */
  endonym: string;
}

export const LANGUAGES: Language[] = [
  { code: "en", name: "English", endonym: "English" },
  { code: "es", name: "Spanish", endonym: "Español" },
  { code: "pt", name: "Portuguese", endonym: "Português" },
  { code: "fr", name: "French", endonym: "Français" },
  { code: "de", name: "German", endonym: "Deutsch" },
  { code: "it", name: "Italian", endonym: "Italiano" },
  { code: "nl", name: "Dutch", endonym: "Nederlands" },
  { code: "pl", name: "Polish", endonym: "Polski" },
  { code: "tr", name: "Turkish", endonym: "Türkçe" },
  { code: "ru", name: "Russian", endonym: "Русский" },
  { code: "ar", name: "Arabic", endonym: "العربية" },
  { code: "hi", name: "Hindi", endonym: "हिन्दी" },
  { code: "zh", name: "Chinese (Simplified)", endonym: "简体中文" },
  { code: "ja", name: "Japanese", endonym: "日本語" },
  { code: "ko", name: "Korean", endonym: "한국어" },
];

export const LANGUAGE_CODES = LANGUAGES.map((l) => l.code) as [string, ...string[]];

export const languageName = (code: string): string =>
  LANGUAGES.find((l) => l.code === code)?.name ?? "English";

/**
 * What the storyboard is told about language.
 *
 * The picture briefs are deliberately left in English. They never reach a
 * reader — they go to an image generator, and every one of ours is trained
 * overwhelmingly on English captions, so translating them buys nothing and
 * costs picture quality.
 */
export function languageRule(code: string): string {
  const name = languageName(code);
  if (code === "en") {
    return "Write every title and subtitle in English. ";
  }
  return (
    `Write every title, subtitle and the closing card in ${name}, as a native speaker would — ` +
    "idiomatic, not translated word for word, and correctly accented. " +
    "The imagePrompt field is the ONE exception: keep it in English, because it is read by an " +
    "image generator rather than by a person. " +
    `Any keywords you pick must be copied exactly from the ${name} text you wrote. `
  );
}
