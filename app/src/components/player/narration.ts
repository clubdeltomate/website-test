import type { Slide } from '@contracts/types';

/**
 * A narratable unit of a slide. `key` is a stable address used for the
 * karaoke highlight: renderers compute the same keys so the read-aloud
 * hook can highlight exactly the sentence being spoken (slide-tool.md §C5).
 */
export interface NarrationUnit {
  text: string;
  key: string;
}

/** Naive sentence splitter — good enough for generated prose. */
export function splitSentences(text: string): string[] {
  const parts = text.match(/[^.!?]+[.!?]+["'”’)\]]*\s*|[^.!?]+$/g);
  return (parts ?? [text]).map((s) => s.trim()).filter(Boolean);
}

const LETTERS = ['A', 'B', 'C', 'D'];

/**
 * Ordered narration for a slide (design.md §9 read-aloud contract):
 * title → paragraphs → (formulas skipped: "see the formula shown") →
 * captions / why texts → question + options.
 */
export function buildNarration(slide: Slide): NarrationUnit[] {
  const units: NarrationUnit[] = [{ text: slide.title, key: 'title' }];

  slide.components.forEach((c, ci) => {
    switch (c.type) {
      case 'prose':
        c.paragraphs.forEach((p, pi) =>
          splitSentences(p).forEach((s, si) =>
            units.push({ text: s, key: `prose:${ci}:${pi}:${si}` }),
          ),
        );
        break;
      case 'latex':
        units.push({ text: 'See the formula shown.', key: `latex:${ci}` });
        if (c.caption) units.push({ text: c.caption, key: `latexcap:${ci}` });
        break;
      case 'chart':
        units.push({ text: c.title, key: `chart:${ci}` });
        if (c.why)
          splitSentences(c.why).forEach((s, si) =>
            units.push({ text: s, key: `chartwhy:${ci}:${si}` }),
          );
        break;
      case 'svg':
        units.push({ text: `${c.title}. ${c.description}`, key: `svg:${ci}` });
        break;
      case 'table':
        if (c.title) units.push({ text: c.title, key: `table:${ci}` });
        break;
      case 'stickynote':
        units.push({ text: c.text, key: `sticky:${ci}` });
        break;
      case 'image':
        units.push({ text: c.alt || c.prompt, key: `image:${ci}` });
        break;
      case 'code':
        if (c.caption) units.push({ text: c.caption, key: `code:${ci}` });
        break;
    }
  });

  if (slide.quiz) {
    units.push({ text: slide.quiz.question, key: 'quizq' });
    (slide.quiz.options ?? []).forEach((o, i) =>
      units.push({ text: `Option ${LETTERS[i]}: ${o}`, key: `quizo:${i}` }),
    );
  }
  return units;
}
