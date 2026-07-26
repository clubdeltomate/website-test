import { useMemo, useState } from 'react';
import katex from 'katex';
import 'katex/contrib/mhchem';
import { trpc } from '@/providers/trpc';
import { PenLine, Image as ImageIcon, RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { SlideComponent } from '@contracts/types';
import StickyNote from '../sketch/StickyNote';
import WashiTape from '../sketch/WashiTape';
import { DoodleSparkle } from '../sketch/DoodleIcons';
import { splitSentences } from './narration';
import SketchChart from './SketchChart';
import { SpeakerButton } from './TtsReader';

/* ------------------------------------------------------------------ */
/* Karaoke span — highlights while the read-aloud speaks this unit     */
/* ------------------------------------------------------------------ */
export function Kara({
  k,
  current,
  children,
  className,
}: {
  k: string;
  current: string | null;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'rounded px-0.5 -mx-0.5 box-decoration-clone transition-colors duration-200',
        current === k && 'bg-yellow-soft',
        className,
      )}
    >
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Individual component renderers (design.md §C2 palette)              */
/* ------------------------------------------------------------------ */

function ProseView({
  paragraphs,
  ci,
  current,
}: {
  paragraphs: string[];
  ci: number;
  current: string | null;
}) {
  return (
    <div className="w-full text-[1.05rem] leading-[1.8] text-ink">
      {paragraphs.map((p, pi) => (
        // Justify so every full line spans the same width — the body text
        // reads as an evenly distributed block instead of a ragged edge.
        <p key={pi} className={cn('text-justify hyphens-auto', pi > 0 && 'mt-4')}>
          {splitSentences(p).map((s, si) => (
            <Kara key={si} k={`prose:${ci}:${pi}:${si}`} current={current}>
              {s}{' '}
            </Kara>
          ))}
          <SpeakerButton speakKey={`prose:${ci}:${pi}`} text={p} />
        </p>
      ))}
    </div>
  );
}

/** One KaTeX block (display mode), tolerant of bad input. */
function KatexLine({ latex }: { latex: string }) {
  const html = useMemo(() => {
    try {
      return katex.renderToString(latex, { displayMode: true, throwOnError: false });
    } catch {
      return null;
    }
  }, [latex]);
  return html ? (
    <div
      className="overflow-x-auto rounded-wobble-sm bg-paper-2/60 px-3 py-1.5 text-ink [&_.katex]:text-[1.1rem]"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  ) : (
    <code className="font-mono text-sm">{latex}</code>
  );
}

/** Friendly name of the exact model that answered, derived from the solver's
 *  provider identity (provider|baseUrl|model). */
function solverName(providerId: string, provider: string): string {
  const [, base = '', model = ''] = providerId.split('|');
  if (base.includes('x.ai')) return `Grok${model !== '-' ? ` (${model})` : ''}`;
  if (base.includes('deepseek')) return 'DeepSeek';
  if (base.includes('openrouter')) return `OpenRouter${model !== '-' ? ` (${model})` : ''}`;
  if (base.includes('moonshot')) return 'Kimi';
  if (provider === 'gemini') return 'Gemini';
  if (provider === 'anthropic') return 'Claude';
  if (provider === 'openai') return 'OpenAI';
  return provider;
}

/** Step-by-step solver card. The site's own AI works the problem out fully
 *  (calculus, matrices, chemistry, thermodynamics …) as paginated pages of
 *  numbered steps with KaTeX notation. When no AI provider answers, it falls
 *  back to the Wolfram|Alpha image card (with retry). */
function WolframView({
  query,
  caption,
  ci,
  current,
}: {
  query: string;
  caption?: string;
  ci: number;
  current: string | null;
}) {
  // provider rotation: each regenerate excludes the providers already used,
  // so a different AI answers; once all have had a turn the cycle restarts.
  const [usedProviders, setUsedProviders] = useState<string[]>([]);
  const steps = trpc.generate.mathSteps.useQuery(
    { query, exclude: usedProviders },
    { staleTime: Infinity, retry: 1, refetchOnWindowFocus: false },
  );
  const [page, setPage] = useState(0);
  const [imgFailed, setImgFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  const d = steps.data;
  const pageCount = d ? d.pages.length : 0;
  const safePage = Math.min(page, Math.max(0, pageCount - 1));
  const pg = d?.pages[safePage];

  return (
    <div className="rounded-wobble-2 border-2 border-ink bg-paper-3 px-4 py-4 shadow-offset">
      <p className="micro mb-2 flex items-center gap-1.5 text-ink-faint">
        <span className="inline-flex h-5 items-center rounded-full border border-ink bg-red-soft px-1.5 font-mono text-[0.65rem] font-bold text-ink">
          ∑
        </span>
        Step-by-step · <span className="font-mono normal-case">{query}</span>
        {d && (
          <>
            <span className="ml-auto whitespace-nowrap normal-case font-bold text-ink-soft">
              solved by {solverName(d.providerId, d.provider)}
            </span>
            <button
              type="button"
              title="Solve again with a DIFFERENT AI — rotates through every configured model before repeating"
              onClick={() => {
                setPage(0);
                setUsedProviders((used) => {
                  const next = used.includes(d.providerId) ? used : [...used, d.providerId];
                  // full cycle completed → start the rotation over
                  return next.length >= d.providerPool ? [] : next;
                });
              }}
              className="flex shrink-0 items-center gap-1 rounded-wobble-sm border-2 border-ink bg-yellow px-2 py-0.5 text-[0.65rem] font-bold normal-case text-ink shadow-offset transition-transform hover:-translate-y-0.5"
            >
              <RotateCcw className="h-3 w-3" strokeWidth={2.5} />
              Different AI
            </button>
          </>
        )}
      </p>

      {steps.isLoading ? (
        <div className="flex flex-col gap-2 py-4">
          <div className="skeleton-stroke h-4 w-2/3" />
          <div className="skeleton-stroke h-4 w-5/6" />
          <div className="skeleton-stroke h-4 w-1/2" />
          <p className="micro text-ink-faint">Working out the steps…</p>
        </div>
      ) : d && pg ? (
        <>
          <h4 className="font-heading text-lg font-bold text-ink">{d.title}</h4>
          {/* one "page" of the worked solution */}
          <div className="mt-2 rounded-wobble-sm border-2 border-dashed border-pencil bg-paper px-4 py-3">
            <p className="micro mb-2 font-bold text-ink-soft">{pg.title}</p>
            <ol className="flex flex-col gap-2.5">
              {pg.steps.map((st, i) => (
                <li key={i} className="flex items-start gap-2.5">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-ink bg-yellow-soft font-mono text-[0.65rem] font-bold text-ink">
                    {i + 1}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm leading-relaxed text-ink">{st.text}</span>
                    {st.latex && (
                      <span className="mt-1 block">
                        <KatexLine latex={st.latex} />
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ol>
            {/* the boxed answer closes the last page */}
            {safePage === pageCount - 1 && (d.answer.latex || d.answer.text) && (
              <div className="mt-3 rounded-wobble-sm border-2 border-green bg-green-soft/50 px-3 py-2">
                <p className="micro font-bold text-ink-soft">Answer</p>
                {d.answer.latex ? (
                  <KatexLine latex={d.answer.latex} />
                ) : (
                  <p className="text-sm font-bold text-ink">{d.answer.text}</p>
                )}
              </div>
            )}
          </div>
          {/* pagination */}
          {pageCount > 1 && (
            <div className="mt-2 flex items-center justify-center gap-3">
              <button
                type="button"
                disabled={safePage === 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                className="rounded-wobble-sm border-2 border-ink bg-paper-3 px-2.5 py-1 text-sm font-bold text-ink shadow-offset disabled:border-pencil disabled:text-pencil disabled:shadow-none"
              >
                ← Prev
              </button>
              <span className="font-mono text-xs text-ink-soft">
                Page {safePage + 1} of {pageCount}
              </span>
              <button
                type="button"
                disabled={safePage >= pageCount - 1}
                onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                className="rounded-wobble-sm border-2 border-ink bg-yellow px-2.5 py-1 text-sm font-bold text-ink shadow-offset disabled:border-pencil disabled:bg-paper-3 disabled:text-pencil disabled:shadow-none"
              >
                Next →
              </button>
            </div>
          )}
        </>
      ) : imgFailed ? (
        <div className="flex flex-col items-start gap-2.5">
          <p className="text-sm text-ink-soft">
            The worked solution isn't available right now — it can be retried, or run the query
            yourself: <span className="font-mono">{query}</span>
          </p>
          <button
            type="button"
            onClick={() => {
              setImgFailed(false);
              setAttempt((a) => a + 1);
              void steps.refetch();
            }}
            className="flex items-center gap-1.5 rounded-wobble-sm border-2 border-ink bg-yellow px-3 py-1.5 text-sm font-bold text-ink shadow-offset transition-transform hover:-translate-y-0.5"
          >
            <RotateCcw className="h-3.5 w-3.5" strokeWidth={2.5} />
            Get the explanation again
          </button>
        </div>
      ) : (
        /* fallback: the Wolfram|Alpha computed card — with a way back into
           the AI rotation, and honest attribution */
        <div>
          <img
            src={`/api/wolfram?i=${encodeURIComponent(query)}${attempt ? `&r=${attempt}` : ''}`}
            alt={`Wolfram|Alpha computed result for: ${query}`}
            className="mx-auto w-auto max-w-full rounded-wobble-sm border border-pencil"
            loading="lazy"
            onError={() => setImgFailed(true)}
          />
          <div className="mt-2 flex items-center justify-between gap-2">
            <span className="micro text-ink-faint">solved by Wolfram|Alpha (AI solver unavailable)</span>
            <button
              type="button"
              title="Retry the AI step-by-step solver"
              onClick={() => {
                setPage(0);
                void steps.refetch();
              }}
              className="flex shrink-0 items-center gap-1 rounded-wobble-sm border-2 border-ink bg-yellow px-2 py-0.5 text-[0.65rem] font-bold text-ink shadow-offset transition-transform hover:-translate-y-0.5"
            >
              <RotateCcw className="h-3 w-3" strokeWidth={2.5} />
              Try the AI solver
            </button>
          </div>
        </div>
      )}

      {caption && (
        <p className="mt-2 border-t-2 border-dashed border-pencil pt-2 text-sm italic text-ink-soft">
          <Kara k={`wolframcap:${ci}`} current={current}>
            {caption}
          </Kara>
        </p>
      )}
    </div>
  );
}

function LatexView({
  formula,
  caption,
  ci,
  current,
}: {
  formula: string;
  caption?: string;
  ci: number;
  current: string | null;
}) {
  const html = useMemo(() => {
    try {
      return katex.renderToString(formula, {
        displayMode: true,
        throwOnError: false,
      });
    } catch {
      return null;
    }
  }, [formula]);

  return (
    <div className="rounded-wobble-2 border-2 border-ink bg-paper-3 px-6 py-5 shadow-offset">
      {html ? (
        <div
          className="overflow-x-auto text-ink [&_.katex]:text-[1.25rem]"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <code className="font-mono text-sm">{formula}</code>
      )}
      {caption && (
        <p className="mt-2 border-t-2 border-dashed border-pencil pt-2 text-sm italic text-ink-soft">
          <Kara k={`latexcap:${ci}`} current={current}>
            {caption}
          </Kara>
        </p>
      )}
    </div>
  );
}

function ChartView({
  component,
  ci,
  current,
}: {
  component: Extract<SlideComponent, { type: 'chart' }>;
  ci: number;
  current: string | null;
}) {
  return (
    <figure className="rounded-wobble-3 border-2 border-ink bg-paper-3 p-4 shadow-offset">
      <figcaption className="mb-2 text-center font-display text-2xl font-bold text-ink">
        <Kara k={`chart:${ci}`} current={current}>
          {component.title}
        </Kara>
      </figcaption>
      <SketchChart
        chartType={component.chartType}
        labels={component.labels}
        series={component.series}
      />
      {component.why && (
        <p className="mt-3 border-t-2 border-dashed border-pencil pt-2 text-sm italic text-ink-soft">
          {splitSentences(component.why).map((s, si) => (
            <Kara key={si} k={`chartwhy:${ci}:${si}`} current={current}>
              {s}{' '}
            </Kara>
          ))}
        </p>
      )}
    </figure>
  );
}

function SvgView({
  component,
  ci,
  current,
}: {
  component: Extract<SlideComponent, { type: 'svg' }>;
  ci: number;
  current: string | null;
}) {
  return (
    <figure className="relative rounded-wobble-2 border-2 border-dashed border-ink bg-paper-2 p-6 text-center shadow-offset">
      <DoodleSparkle className="absolute right-3 top-3 h-4 w-4 text-purple" />
      <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border-2 border-ink bg-paper-3">
        <PenLine className="h-6 w-6 text-ink" strokeWidth={2} />
      </span>
      <figcaption className="mt-3 font-heading text-lg font-semibold text-ink">
        <Kara k={`svg:${ci}`} current={current}>
          {component.title}
        </Kara>
      </figcaption>
      <p className="mx-auto mt-1 max-w-sm text-sm text-ink-soft">
        {component.description}
      </p>
      <p className="mx-auto mt-3 max-w-md border-t-2 border-dashed border-pencil pt-2 font-mono text-[0.7rem] leading-relaxed text-ink-faint">
        ✦ sketch brief: {component.sceneHint}
      </p>
    </figure>
  );
}

function TableView({
  component,
  ci,
  current,
}: {
  component: Extract<SlideComponent, { type: 'table' }>;
  ci: number;
  current: string | null;
}) {
  return (
    <figure className="overflow-hidden rounded-wobble-sm border-2 border-ink bg-paper-3 shadow-offset">
      {component.title && (
        <figcaption className="border-b-2 border-ink bg-yellow px-3 py-2 font-heading text-sm font-bold text-ink">
          <Kara k={`table:${ci}`} current={current}>
            {component.title}
          </Kara>
        </figcaption>
      )}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left text-sm">
          <thead>
            <tr className="bg-yellow">
              {component.columns.map((col, i) => (
                <th
                  key={i}
                  className="micro border-b-2 border-ink px-3 py-2 text-ink"
                >
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {component.rows.map((row, ri) => (
              <tr
                key={ri}
                className="border-t-2 border-dashed border-pencil first:border-t-0 hover:bg-paper-2"
              >
                {row.map((cell, cellIdx) => (
                  <td
                    key={cellIdx}
                    className={cn(
                      'px-3 py-2 align-top',
                      /^-?[\d.,%]+$/.test(cell.trim()) && 'font-mono',
                    )}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}

function ImageView({
  component,
  ci,
  current,
  showcase = false,
}: {
  component: Extract<SlideComponent, { type: 'image' }>;
  ci: number;
  current: string | null;
  /** commercial decks: the image is the main stage, so render it larger */
  showcase?: boolean;
}) {
  const style = component.style === 'none' ? 'sketch' : component.style;
  return (
    <figure
      className={cn(
        'relative mx-auto w-full rotate-[-1deg] rounded-wobble-sm border-2 border-ink bg-paper-3 p-3 pb-4 shadow-offset',
        showcase ? 'max-w-xl' : 'max-w-sm',
      )}
    >
      <WashiTape rotate={-3} className="left-1/2 -translate-x-1/2" />
      <div className="overflow-hidden rounded-sm border-2 border-ink">
        <img
          src={component.imageUrl ?? `/style-${style}.svg`}
          alt={component.alt}
          className={cn('mx-auto w-full object-cover', showcase ? 'max-h-[26rem]' : 'max-h-64')}
        />
      </div>
      <figcaption className="mt-2 flex items-start gap-1.5 font-display text-base leading-snug text-ink-soft">
        <ImageIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-faint" />
        <Kara k={`image:${ci}`} current={current}>
          {component.prompt}
        </Kara>
      </figcaption>
    </figure>
  );
}

function CodeView({
  component,
  ci,
  current,
}: {
  component: Extract<SlideComponent, { type: 'code' }>;
  ci: number;
  current: string | null;
}) {
  const lines = component.code.split('\n');
  return (
    <figure className="overflow-hidden rounded-wobble-2 border-2 border-ink bg-paper-3 shadow-offset">
      <div className="flex items-center justify-between border-b-2 border-dashed border-pencil px-4 py-2">
        <span className="micro text-ink-faint">{component.language}</span>
        <span className="flex gap-1.5" aria-hidden="true">
          <span className="h-2.5 w-2.5 rounded-full border border-ink bg-red-soft" />
          <span className="h-2.5 w-2.5 rounded-full border border-ink bg-yellow-soft" />
          <span className="h-2.5 w-2.5 rounded-full border border-ink bg-green-soft" />
        </span>
      </div>
      <pre className="overflow-x-auto p-4 font-mono text-sm leading-relaxed text-ink">
        <code>
          {lines.map((line, i) => (
            <span key={i} className="flex">
              <span className="w-8 shrink-0 select-none text-right text-pencil">
                {i + 1}
              </span>
              <span className="pl-4">{line || ' '}</span>
            </span>
          ))}
        </code>
      </pre>
      {component.caption && (
        <figcaption className="border-t-2 border-dashed border-pencil px-4 py-2 text-sm italic text-ink-soft">
          <Kara k={`code:${ci}`} current={current}>
            {component.caption}
          </Kara>
        </figcaption>
      )}
    </figure>
  );
}

/* ------------------------------------------------------------------ */
/* Dispatcher                                                          */
/* ------------------------------------------------------------------ */

/** Human label for an AI provider id. */
export const PROVIDER_LABEL: Record<string, string> = {
  gemini: 'Gemini',
  openai: 'OpenAI',
  anthropic: 'Anthropic',
};

/** Tiny "made by <model>" caption shown under a generated section. */
export function SourceTag({ provider, kind }: { provider?: string | null; kind: string }) {
  if (!provider) return null;
  return (
    <span className="mt-1 block select-none text-[0.58rem] italic text-ink-faint/80">
      {kind} · {PROVIDER_LABEL[provider] ?? provider}
    </span>
  );
}

export interface SlideComponentViewProps {
  component: SlideComponent;
  /** component index within the slide (drives karaoke keys) */
  ci: number;
  /** karaoke key currently spoken, or null */
  current: string | null;
  /** commercial (menu/service/shop) decks put the image on the main stage */
  showcase?: boolean;
  /** model that wrote the text (for the tiny attribution caption) */
  provider?: string | null;
  /** model that made the images */
  imageProvider?: string | null;
}

export default function SlideComponentView({
  component,
  ci,
  current,
  showcase = false,
  provider,
  imageProvider,
}: SlideComponentViewProps) {
  switch (component.type) {
    case 'prose':
      return (
        <div>
          <ProseView paragraphs={component.paragraphs} ci={ci} current={current} />
          <SourceTag provider={provider} kind="text" />
        </div>
      );
    case 'latex':
      return (
        <LatexView
          formula={component.formula}
          caption={component.caption}
          ci={ci}
          current={current}
        />
      );
    case 'chart':
      return <ChartView component={component} ci={ci} current={current} />;
    case 'svg':
      return <SvgView component={component} ci={ci} current={current} />;
    case 'table':
      return <TableView component={component} ci={ci} current={current} />;
    case 'stickynote':
      return (
        <StickyNote rotate={-1.5} className="max-w-sm">
          <Kara k={`sticky:${ci}`} current={current}>
            {component.text}
          </Kara>
        </StickyNote>
      );
    case 'image':
      return (
        <div>
          <ImageView component={component} ci={ci} current={current} showcase={showcase} />
          <SourceTag provider={imageProvider} kind="image" />
        </div>
      );
    case 'wolfram':
      return (
        <WolframView
          query={component.query}
          caption={component.caption}
          ci={ci}
          current={current}
        />
      );
    case 'code':
      return <CodeView component={component} ci={ci} current={current} />;
    default:
      return null;
  }
}
