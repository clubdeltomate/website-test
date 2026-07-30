/* Word-level helpers for the marketing carousel's caption band.
 *
 * Kept out of the page so they can be tested on their own: the keyword match
 * is the part that decides what the AI's highlight actually paints, and it
 * runs on text the user may have edited since the AI last read it. */

/** Split a line the way the layout does — whitespace-separated, no blanks. */
export const wordsOf = (s: string): string[] => s.split(/\s+/).filter(Boolean);

/** Compare words the way a reader would: "Brew," and "brew" are the word. */
export const normWord = (s: string): string => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

/**
 * Turn the AI's keyword picks into word-index → colour.
 *
 * It answers with the words themselves rather than positions, because models
 * miscount words but copy them accurately. The match is therefore done here,
 * against the text the editor is actually showing — which also means a
 * highlight survives light editing of the line instead of sliding onto the
 * wrong word. A keyword of several words paints each of them.
 */
export function tintsFrom(
  text: string,
  keywords: string[],
  hex: string,
): Record<number, string> {
  const wanted = new Set<string>();
  for (const phrase of keywords) {
    for (const word of wordsOf(phrase)) {
      const n = normWord(word);
      if (n) wanted.add(n);
    }
  }
  const out: Record<number, string> = {};
  if (wanted.size === 0) return out;
  wordsOf(text).forEach((w, i) => {
    if (wanted.has(normWord(w))) out[i] = hex;
  });
  return out;
}

/** Read a band fill — hex or rgba() — as channels, so its ink can be chosen. */
export function bandRgb(fill: string): [number, number, number] {
  const hex = /^#([0-9a-f]{6})$/i.exec(fill.trim());
  if (hex) {
    const n = parseInt(hex[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const rgb = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i.exec(fill);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  return [11, 11, 11];
}

/**
 * White or near-black lettering, whichever the band can carry. The ink follows
 * the fill rather than being picked alongside it, so a colour mixed in the
 * picker stays readable without a second decision.
 */
export function inkFor(fill: string): string {
  const [r, g, b] = bandRgb(fill);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6 ? '#14110D' : '#FFFFFF';
}
