import { useMemo } from 'react';
import katex from 'katex';
import { PenLine, Image as ImageIcon } from 'lucide-react';
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
    case 'code':
      return <CodeView component={component} ci={ci} current={current} />;
    default:
      return null;
  }
}
