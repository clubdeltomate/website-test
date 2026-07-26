import {
  Check,
  ImageIcon,
  ListChecks,
  Plus,
  RefreshCw,
  StickyNote,
  Table as TableIcon,
  Trash2,
  Type,
  Upload,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { trpc } from '@/providers/trpc';
import SketchButton from '@/components/sketch/SketchButton';
import { LEVELS } from '@contracts/types';
import type { ImageStyle, Level, Slide, SlideComponent, SlideDeck, SlideQuiz } from '@contracts/types';

const inputCls =
  'w-full rounded-wobble-sm border-2 border-ink bg-paper px-3 py-2 text-sm text-ink shadow-offset outline-none placeholder:text-ink-faint focus:border-blue';

export const blankSlide = (): Slide => ({ title: '', components: [{ type: 'prose', paragraphs: [''] }] });
export const blankDeck = (topic: string): SlideDeck => ({
  level: 'B1',
  imageStyle: 'none',
  topic,
  slides: [blankSlide()],
});

const newComponent = (kind: SlideComponent['type'], imageStyle: ImageStyle): SlideComponent => {
  const style = imageStyle === 'none' ? 'sketch' : imageStyle;
  switch (kind) {
    case 'image':
      return { type: 'image', prompt: '', alt: '', style };
    case 'table':
      return { type: 'table', title: '', columns: ['Column A', 'Column B'], rows: [['', '']] };
    case 'stickynote':
      return { type: 'stickynote', text: '' };
    default:
      return { type: 'prose', paragraphs: [''] };
  }
};

/**
 * The by-hand deck editor shared by the repo preset editor and the standalone
 * manual-presentation builder. Edits every slide's title, prose, images,
 * tables, sticky notes and a multiple-choice question; add/remove slides and
 * blocks. Pure UI — the parent owns the deck and handles saving.
 */
export default function DeckBuilder({
  deck,
  onChange,
}: {
  deck: SlideDeck;
  onChange: (deck: SlideDeck) => void;
}) {
  const patchDeck = (patch: Partial<SlideDeck>) => onChange({ ...deck, ...patch });
  const patchSlide = (si: number, patch: Partial<Slide>) =>
    onChange({ ...deck, slides: deck.slides.map((s, i) => (i === si ? { ...s, ...patch } : s)) });
  const patchComponent = (si: number, ci: number, comp: SlideComponent) =>
    onChange({
      ...deck,
      slides: deck.slides.map((s, i) =>
        i === si ? { ...s, components: s.components.map((c, j) => (j === ci ? comp : c)) } : s,
      ),
    });
  const removeComponent = (si: number, ci: number) =>
    onChange({
      ...deck,
      slides: deck.slides.map((s, i) =>
        i === si ? { ...s, components: s.components.filter((_, j) => j !== ci) } : s,
      ),
    });
  const addComponent = (si: number, kind: SlideComponent['type']) =>
    onChange({
      ...deck,
      slides: deck.slides.map((s, i) =>
        i === si ? { ...s, components: [...s.components, newComponent(kind, deck.imageStyle)] } : s,
      ),
    });
  const addSlide = () => onChange({ ...deck, slides: [...deck.slides, blankSlide()] });
  const removeSlide = (si: number) =>
    deck.slides.length > 1 && onChange({ ...deck, slides: deck.slides.filter((_, i) => i !== si) });
  const addQuiz = (si: number) =>
    patchSlide(si, {
      quiz: { kind: 'mcq', question: '', options: ['', '', '', ''], correctIndex: 0, explanation: '' },
    });

  return (
    <div className="flex flex-col gap-5">
      <label className="flex items-center gap-1.5">
        <span className="micro text-[0.6rem] text-ink-faint">Level</span>
        <select
          value={deck.level}
          onChange={(e) => patchDeck({ level: e.target.value as Level })}
          className="rounded-wobble-sm border-2 border-ink bg-paper px-2 py-1 text-sm font-bold text-ink shadow-offset outline-none"
        >
          {LEVELS.map((lv) => (
            <option key={lv} value={lv}>
              {lv}
            </option>
          ))}
        </select>
        <span className="micro text-ink-faint">{deck.slides.length} slides</span>
      </label>

      {deck.slides.map((slide, si) => (
        <section key={si} className="rounded-wobble-2 border-2 border-ink bg-paper-3 p-5 shadow-offset">
          <div className="mb-3 flex items-center gap-2">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 border-ink bg-yellow-soft font-display text-sm font-bold text-ink">
              {si + 1}
            </span>
            <input
              className={cn(inputCls, 'font-heading text-lg font-bold')}
              value={slide.title}
              onChange={(e) => patchSlide(si, { title: e.target.value })}
              placeholder="Slide title"
            />
            {deck.slides.length > 1 && (
              <button
                type="button"
                onClick={() => removeSlide(si)}
                title="Remove slide"
                aria-label="Remove slide"
                className="rounded-wobble-sm border-2 border-transparent p-1.5 text-ink-faint transition-colors hover:border-dashed hover:border-red hover:text-red"
              >
                <Trash2 className="h-4 w-4" strokeWidth={2} />
              </button>
            )}
          </div>

          <div className="flex flex-col gap-3">
            {slide.components.map((comp, ci) => (
              <div key={ci} className="relative">
                <button
                  type="button"
                  onClick={() => removeComponent(si, ci)}
                  title="Remove this block"
                  aria-label="Remove block"
                  className="absolute right-2 top-2 z-10 rounded-wobble-sm border-2 border-transparent bg-paper-3/80 p-1 text-ink-faint transition-colors hover:border-dashed hover:border-red hover:text-red"
                >
                  <X className="h-3.5 w-3.5" strokeWidth={2} />
                </button>
                <ComponentEditor
                  comp={comp}
                  deckStyle={deck.imageStyle}
                  onChange={(next) => patchComponent(si, ci, next)}
                />
              </div>
            ))}
          </div>

          {slide.quiz && (slide.quiz.kind === 'mcq' || slide.quiz.kind === 'mcq2' || !slide.quiz.kind) && (
            <div className="relative">
              <button
                type="button"
                onClick={() => patchSlide(si, { quiz: undefined })}
                title="Remove the question"
                aria-label="Remove question"
                className="absolute right-2 top-2 z-10 rounded-wobble-sm border-2 border-transparent bg-paper-3/80 p-1 text-ink-faint transition-colors hover:border-dashed hover:border-red hover:text-red"
              >
                <X className="h-3.5 w-3.5" strokeWidth={2} />
              </button>
              <QuizEditor quiz={slide.quiz} onChange={(q) => patchSlide(si, { quiz: q })} />
            </div>
          )}

          <div className="mt-3 flex flex-wrap gap-2 border-t-2 border-dashed border-pencil pt-3">
            <AddChip icon={Type} label="Text" onClick={() => addComponent(si, 'prose')} />
            <AddChip icon={ImageIcon} label="Image" onClick={() => addComponent(si, 'image')} />
            <AddChip icon={TableIcon} label="Table" onClick={() => addComponent(si, 'table')} />
            <AddChip icon={StickyNote} label="Sticky" onClick={() => addComponent(si, 'stickynote')} />
            {!slide.quiz && (
              <AddChip icon={ListChecks} label="Multiple choice" onClick={() => addQuiz(si)} />
            )}
          </div>
        </section>
      ))}

      <button
        type="button"
        onClick={addSlide}
        className="flex items-center justify-center gap-1.5 rounded-wobble-2 border-2 border-dashed border-pencil bg-paper-2/40 px-3 py-3 font-heading font-semibold text-ink-soft transition-colors hover:border-ink hover:text-ink"
      >
        <Plus className="h-4 w-4" strokeWidth={2} /> Add slide
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function Label({ children }: { children: React.ReactNode }) {
  return <span className="micro mb-1 block text-[0.6rem] uppercase tracking-wider text-ink-faint">{children}</span>;
}

function AddChip({
  icon: Icon,
  label,
  onClick,
}: {
  icon: typeof Type;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1.5 rounded-wobble-sm border-2 border-dashed border-pencil px-2.5 py-1.5 font-heading text-xs font-semibold text-ink-soft transition-colors hover:border-ink hover:text-ink"
    >
      <Icon className="h-3.5 w-3.5" strokeWidth={2} /> {label}
    </button>
  );
}

function ComponentEditor({
  comp,
  deckStyle,
  onChange,
}: {
  comp: SlideComponent;
  deckStyle: SlideDeck['imageStyle'];
  onChange: (c: SlideComponent) => void;
}) {
  if (comp.type === 'prose') {
    return (
      <div className="rounded-wobble-sm border-2 border-dashed border-pencil bg-paper-2/40 p-3">
        <Label>Text</Label>
        {comp.paragraphs.map((p, pi) => (
          <div key={pi} className="mb-2 flex items-start gap-1.5">
            <textarea
              className={cn(inputCls, 'min-h-[70px] resize-y')}
              value={p}
              onChange={(e) =>
                onChange({
                  ...comp,
                  paragraphs: comp.paragraphs.map((x, j) => (j === pi ? e.target.value : x)),
                })
              }
            />
            {comp.paragraphs.length > 1 && (
              <button
                type="button"
                onClick={() =>
                  onChange({ ...comp, paragraphs: comp.paragraphs.filter((_, j) => j !== pi) })
                }
                className="mt-1 rounded-wobble-sm p-1 text-ink-faint hover:bg-red-soft hover:text-red"
                aria-label="Remove paragraph"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        ))}
        <button
          type="button"
          onClick={() => onChange({ ...comp, paragraphs: [...comp.paragraphs, ''] })}
          className="micro flex items-center gap-1 rounded-wobble-sm border-2 border-dashed border-pencil px-2 py-1 text-[0.62rem] text-ink-soft hover:border-ink hover:text-ink"
        >
          <Plus className="h-3 w-3" /> Add paragraph
        </button>
      </div>
    );
  }

  if (comp.type === 'image') {
    return <ImageEditor comp={comp} deckStyle={deckStyle} onChange={onChange} />;
  }

  if (comp.type === 'stickynote') {
    return (
      <div className="rounded-wobble-sm border-2 border-dashed border-pencil bg-paper-2/40 p-3">
        <Label>Sticky note</Label>
        <textarea
          className={cn(inputCls, 'min-h-[60px] resize-y')}
          value={comp.text}
          onChange={(e) => onChange({ ...comp, text: e.target.value })}
        />
      </div>
    );
  }

  if (comp.type === 'table') {
    return (
      <div className="rounded-wobble-sm border-2 border-dashed border-pencil bg-paper-2/40 p-3">
        <Label>Table</Label>
        <input
          className={cn(inputCls, 'mb-2')}
          value={comp.title ?? ''}
          placeholder="Table title"
          onChange={(e) => onChange({ ...comp, title: e.target.value })}
        />
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                {comp.columns.map((col, cci) => (
                  <th key={cci} className="p-1">
                    <input
                      className={cn(inputCls, 'font-bold')}
                      value={col}
                      onChange={(e) =>
                        onChange({
                          ...comp,
                          columns: comp.columns.map((x, j) => (j === cci ? e.target.value : x)),
                        })
                      }
                    />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {comp.rows.map((row, ri) => (
                <tr key={ri}>
                  {row.map((cell, ci2) => (
                    <td key={ci2} className="p-1">
                      <input
                        className={inputCls}
                        value={cell}
                        onChange={(e) =>
                          onChange({
                            ...comp,
                            rows: comp.rows.map((r, j) =>
                              j === ri ? r.map((x, k) => (k === ci2 ? e.target.value : x)) : r,
                            ),
                          })
                        }
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-wobble-sm border-2 border-dashed border-pencil bg-paper-2/30 px-3 py-2">
      <Label>{comp.type} (kept as-is)</Label>
    </div>
  );
}

function ImageEditor({
  comp,
  deckStyle,
  onChange,
}: {
  comp: Extract<SlideComponent, { type: 'image' }>;
  deckStyle: SlideDeck['imageStyle'];
  onChange: (c: SlideComponent) => void;
}) {
  const style = comp.style === 'none' ? (deckStyle === 'none' ? 'sketch' : deckStyle) : comp.style;
  const regen = trpc.generate.slideImage.useMutation({
    onSuccess: (r) => {
      if (r.imageUrl) {
        onChange({ ...comp, imageUrl: r.imageUrl });
        toast.success('Image regenerated ✓');
      } else toast.error('No image came back — check the AI image key');
    },
    onError: (e) => toast.error(e.message),
  });

  const onUpload = (file: File | undefined) => {
    if (!file) return;
    if (file.size > 4_000_000) {
      toast.error('Image too large (max ~4MB)');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => onChange({ ...comp, imageUrl: String(reader.result) });
    reader.readAsDataURL(file);
  };

  return (
    <div className="rounded-wobble-sm border-2 border-dashed border-ink bg-paper-2/40 p-3">
      <Label>Image</Label>
      <div className="flex flex-wrap gap-3">
        <div className="w-40 shrink-0 overflow-hidden rounded-sm border-2 border-ink bg-paper-3">
          {comp.imageUrl ? (
            <img src={comp.imageUrl} alt={comp.alt} className="h-28 w-full object-cover" />
          ) : (
            <div className="flex h-28 w-full items-center justify-center text-ink-faint">
              <ImageIcon className="h-6 w-6" />
            </div>
          )}
        </div>
        <div className="flex min-w-[200px] flex-1 flex-col gap-2">
          <div>
            <Label>Image prompt (used to regenerate)</Label>
            <textarea
              className={cn(inputCls, 'min-h-[48px] resize-y font-mono text-xs')}
              value={comp.prompt}
              onChange={(e) => onChange({ ...comp, prompt: e.target.value })}
            />
          </div>
          <div>
            <Label>Description / alt text</Label>
            <input
              className={inputCls}
              value={comp.alt}
              onChange={(e) => onChange({ ...comp, alt: e.target.value })}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <SketchButton
              variant="secondary"
              size="sm"
              loading={regen.isPending}
              onClick={() => regen.mutate({ prompt: comp.prompt, style })}
            >
              <RefreshCw className="h-3.5 w-3.5" /> Regenerate
            </SketchButton>
            <label className="flex cursor-pointer items-center gap-1.5 rounded-wobble-sm border-2 border-ink bg-paper px-3 py-1.5 text-sm font-bold text-ink shadow-offset hover:bg-paper-2">
              <Upload className="h-3.5 w-3.5" /> Upload
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => onUpload(e.target.files?.[0])}
              />
            </label>
          </div>
        </div>
      </div>
    </div>
  );
}

function QuizEditor({ quiz, onChange }: { quiz: SlideQuiz; onChange: (q: SlideQuiz) => void }) {
  const options = quiz.options ?? [];
  return (
    <div className="mt-3 rounded-wobble-sm border-2 border-ink bg-blue-soft/40 p-3">
      <Label>Multiple choice</Label>
      <input
        className={cn(inputCls, 'mb-2 font-semibold')}
        value={quiz.question}
        placeholder="Question"
        onChange={(e) => onChange({ ...quiz, question: e.target.value })}
      />
      <div className="flex flex-col gap-1.5">
        {options.map((opt, oi) => (
          <div key={oi} className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onChange({ ...quiz, correctIndex: oi })}
              title="Mark as the correct answer"
              className={cn(
                'flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition-colors',
                quiz.correctIndex === oi
                  ? 'border-green bg-green text-paper-3'
                  : 'border-pencil text-transparent hover:border-ink',
              )}
              aria-label="Mark correct"
            >
              <Check className="h-3.5 w-3.5" strokeWidth={3} />
            </button>
            <input
              className={inputCls}
              value={opt}
              onChange={(e) =>
                onChange({ ...quiz, options: options.map((x, j) => (j === oi ? e.target.value : x)) })
              }
            />
          </div>
        ))}
      </div>
      <div className="mt-2">
        <Label>Explanation (shown after answering)</Label>
        <textarea
          className={cn(inputCls, 'min-h-[48px] resize-y')}
          value={quiz.explanation}
          onChange={(e) => onChange({ ...quiz, explanation: e.target.value })}
        />
      </div>
    </div>
  );
}
