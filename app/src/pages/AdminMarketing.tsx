import { useMemo, useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Eraser,
  Image as ImageIcon,
  Layers,
  Plus,
  Sparkles,
  Trash2,
  Type,
  Wand2,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { trpc } from '@/providers/trpc';
import AdminGate from '@/components/admin/AdminGate';
import SketchToaster from '@/components/admin/SketchToaster';
import SketchButton from '@/components/sketch/SketchButton';
import SketchCard from '@/components/sketch/SketchCard';
import { HubHeader } from '@/components/admin/PanelTiles';

/* Marketing: a small Canva for Instagram carousels.
 *
 * One prompt writes the whole story — hook, the steps in between, closing
 * card — and every slide gets a backdrop, a title, a subtitle and a caption
 * band you can resize, restyle and colour word by word. Preview and export
 * are laid out by the SAME function, so the PNG that downloads is the card
 * that was arranged on screen, drawn at full social size instead of
 * screenshotted. */

/** Post formats. Width is always 1080 — the export height follows the ratio. */
const FORMATS = [
  { id: '9:16' as const, label: 'Story 9:16', h: 1920 },
  { id: '4:5' as const, label: 'Post 4:5', h: 1350 },
  { id: '1:1' as const, label: 'Square', h: 1080 },
];
type FormatId = (typeof FORMATS)[number]['id'];
const OUT_W = 1080;

/** Caption face: a plain heavy sans, so the browser preview and the canvas
 *  export resolve to the same glyphs — a webfont would drift between them. */
const FONT = "'Arial Black', 'Arial Bold', 'Helvetica Neue', Arial, sans-serif";

/** Band styles — "different types of banners" without a colour picker each. */
const BANDS = [
  { id: 'dark' as const, label: 'Dark', fill: '#0B0B0B', ink: '#FFFFFF' },
  { id: 'light' as const, label: 'Light', fill: '#FFFDF6', ink: '#14110D' },
  { id: 'glass' as const, label: 'Glass', fill: 'rgba(11,11,11,0.62)', ink: '#FFFFFF' },
];
type BandId = (typeof BANDS)[number]['id'];

/** Palette a word can be painted with. */
const COLORS = [
  { label: 'Default', hex: '' },
  { label: 'Cyan', hex: '#35C4F0' },
  { label: 'Yellow', hex: '#FFC53D' },
  { label: 'Green', hex: '#5BD37F' },
  { label: 'Red', hex: '#FF6B5A' },
  { label: 'Purple', hex: '#B79CF5' },
];

interface Slide {
  id: string;
  imageUrl: string | null;
  imagePrompt: string;
  title: string;
  subtitle: string;
  /** word index → hex. Absent = the band's default ink. */
  titleTints: Record<number, string>;
  subTints: Record<number, string>;
}

interface Design {
  format: FormatId;
  bandOn: boolean;
  /** full-bleed to the edges, or floated inside a margin */
  inset: boolean;
  /** breathing room inside the band, in export px */
  pad: number;
  titleSize: number;
  subSize: number;
  band: BandId;
}

const newSlide = (n: number): Slide => ({
  id: `s${n}-${Math.random().toString(36).slice(2, 8)}`,
  imageUrl: null,
  imagePrompt: '',
  title: '',
  subtitle: '',
  titleTints: {},
  subTints: {},
});

const wordsOf = (s: string) => s.split(/\s+/).filter(Boolean);

/** Wrap one run of words to a width, returning lines of word indices. */
function wrap(
  words: string[],
  size: number,
  maxW: number,
  measure: CanvasRenderingContext2D,
  upper: boolean,
): number[][] {
  measure.font = `900 ${size}px ${FONT}`;
  const lines: number[][] = [];
  let line: number[] = [];
  for (let i = 0; i < words.length; i++) {
    const trial = [...line, i];
    const text = trial.map((j) => words[j]).join(' ');
    const w = measure.measureText(upper ? text.toUpperCase() : text).width;
    if (w > maxW && line.length > 0) {
      lines.push(line);
      line = [i];
    } else {
      line = trial;
    }
  }
  if (line.length) lines.push(line);
  return lines;
}

interface Layout {
  titleWords: string[];
  subWords: string[];
  titleLines: number[][];
  subLines: number[][];
  titleSize: number;
  subSize: number;
  bandX: number;
  bandW: number;
  bandY: number;
  bandH: number;
  pad: number;
}

/**
 * Lay the card out at export scale. One result feeds both the preview and the
 * PNG, so they can never disagree. Sizes come from the sliders; the only
 * automatic move is a proportional shrink when a band would swallow the whole
 * picture, which keeps a long paste from producing a broken export.
 */
function layoutCard(
  slide: Slide,
  design: Design,
  measure: CanvasRenderingContext2D | null,
  outH: number,
): Layout {
  const margin = design.inset ? 48 : 0;
  const bandX = margin;
  const bandW = OUT_W - margin * 2;
  const empty: Layout = {
    titleWords: [],
    subWords: [],
    titleLines: [],
    subLines: [],
    titleSize: design.titleSize,
    subSize: design.subSize,
    bandX,
    bandW,
    bandY: outH,
    bandH: 0,
    pad: design.pad,
  };
  if (!measure || !design.bandOn) return empty;

  const titleWords = wordsOf(slide.title);
  const subWords = wordsOf(slide.subtitle);
  if (titleWords.length === 0 && subWords.length === 0) return empty;

  const maxCap = outH * 0.8;
  let scale = 1;
  let titleSize = design.titleSize;
  let subSize = design.subSize;
  let titleLines: number[][] = [];
  let subLines: number[][] = [];
  let bandH = 0;
  // Shrink together (never past 45%) if the band would take over the card.
  for (; scale >= 0.45; scale -= 0.05) {
    titleSize = Math.round(design.titleSize * scale);
    subSize = Math.round(design.subSize * scale);
    const pad = design.pad * scale;
    const textW = bandW - pad * 2;
    titleLines = wrap(titleWords, titleSize, textW, measure, true);
    subLines = wrap(subWords, subSize, textW, measure, false);
    const gap = titleLines.length && subLines.length ? subSize * 0.6 : 0;
    bandH =
      pad * 2 + titleLines.length * titleSize * 1.1 + gap + subLines.length * subSize * 1.32;
    if (bandH <= maxCap) break;
  }
  const pad = design.pad * scale;
  const bandY = outH - bandH - margin;
  return {
    titleWords,
    subWords,
    titleLines,
    subLines,
    titleSize,
    subSize,
    bandX,
    bandW,
    bandY,
    bandH,
    pad,
  };
}

function MarketingBody() {
  const [slides, setSlides] = useState<Slide[]>([newSlide(1)]);
  const [active, setActive] = useState(0);
  const [design, setDesign] = useState<Design>({
    format: '9:16',
    bandOn: true,
    inset: false,
    pad: 56,
    titleSize: 96,
    subSize: 40,
    band: 'dark',
  });
  const [topic, setTopic] = useState('');
  const [slideCount, setSlideCount] = useState(5);
  const [activeColor, setActiveColor] = useState(COLORS[1].hex);
  const [busy, setBusy] = useState(false);
  /** Index currently being drawn, so only that slide's button spins. */
  const [drawing, setDrawing] = useState<number | null>(null);

  const measureRef = useRef<CanvasRenderingContext2D | null>(null);
  if (measureRef.current === null && typeof document !== 'undefined') {
    measureRef.current = document.createElement('canvas').getContext('2d');
  }

  const utils = trpc.useUtils();
  const quote = trpc.marketing.quote.useQuery();
  const outH = FORMATS.find((f) => f.id === design.format)!.h;
  const slide = slides[Math.min(active, slides.length - 1)];
  const layout = useMemo(
    () => layoutCard(slide, design, measureRef.current, outH),
    [slide, design, outH],
  );
  const bandStyle = BANDS.find((b) => b.id === design.band)!;

  const patch = (i: number, p: Partial<Slide>) =>
    setSlides((s) => s.map((sl, k) => (k === i ? { ...sl, ...p } : sl)));

  const storyboard = trpc.marketing.storyboard.useMutation({
    onSuccess: (r) => {
      setSlides(
        r.slides.map((s, i) => ({
          ...newSlide(i + 1),
          title: s.title,
          subtitle: s.subtitle,
          imagePrompt: s.imagePrompt,
        })),
      );
      setActive(0);
      toast.success(`Story written — ${r.slides.length} slides, ${r.cost} 🪙`);
      void utils.auth.me.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  /** Draw one slide's backdrop. The index is captured here rather than
   *  recovered from the response, so the picture always lands on the slide
   *  that asked for it even if the prompt was edited mid-flight. */
  const drawOne = async (i: number) => {
    const prompt = slides[i].imagePrompt.trim();
    if (prompt.length < 3) return;
    setDrawing(i);
    try {
      const r = await utils.client.marketing.generate.mutate({ prompt, format: design.format });
      patch(i, { imageUrl: r.url });
      toast.success(`Backdrop drawn — ${r.cost} 🪙`);
      void utils.auth.me.invalidate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "That backdrop couldn't be drawn");
    } finally {
      setDrawing(null);
    }
  };

  /** Draw every slide that still has no picture, one after another. */
  const drawAllMissing = async () => {
    const todo = slides.map((s, i) => ({ s, i })).filter(({ s }) => !s.imageUrl && s.imagePrompt.trim().length > 2);
    if (todo.length === 0) return toast.error('Every slide with a prompt already has a picture');
    setBusy(true);
    let made = 0;
    for (const { s, i } of todo) {
      try {
        const r = await utils.client.marketing.generate.mutate({
          prompt: s.imagePrompt.trim(),
          format: design.format,
        });
        patch(i, { imageUrl: r.url });
        made++;
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'A backdrop failed');
        break;
      }
    }
    setBusy(false);
    if (made) toast.success(`${made} backdrop${made === 1 ? '' : 's'} drawn`);
    void utils.auth.me.invalidate();
  };

  /** Click a word in the preview to paint it with the active colour. */
  const paint = (kind: 'title' | 'subtitle', i: number) => {
    const key = kind === 'title' ? 'titleTints' : 'subTints';
    const cur = slide[key];
    const next = { ...cur };
    if (!activeColor || next[i] === activeColor) delete next[i];
    else next[i] = activeColor;
    patch(active, { [key]: next } as Partial<Slide>);
  };

  /** Render one slide to a canvas at full export size. */
  const renderSlide = async (s: Slide): Promise<HTMLCanvasElement> => {
    const canvas = document.createElement('canvas');
    canvas.width = OUT_W;
    canvas.height = outH;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('This browser has no canvas to draw on');
    ctx.fillStyle = '#F4EBD6';
    ctx.fillRect(0, 0, OUT_W, outH);

    if (s.imageUrl) {
      const img = new Image();
      img.src = s.imageUrl;
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error("A backdrop couldn't be loaded"));
      });
      const scale = Math.max(OUT_W / img.width, outH / img.height);
      const dw = img.width * scale;
      const dh = img.height * scale;
      ctx.drawImage(img, (OUT_W - dw) / 2, (outH - dh) / 2, dw, dh);
    }

    const L = layoutCard(s, design, measureRef.current, outH);
    if (L.bandH > 0) {
      ctx.fillStyle = bandStyle.fill;
      ctx.fillRect(L.bandX, L.bandY, L.bandW, L.bandH);
      ctx.textBaseline = 'middle';
      let y = L.bandY + L.pad;

      const drawRun = (
        lines: number[][],
        words: string[],
        size: number,
        lineH: number,
        tints: Record<number, string>,
        upper: boolean,
      ) => {
        ctx.font = `900 ${size}px ${FONT}`;
        for (const lineWords of lines) {
          const text = lineWords.map((j) => (upper ? words[j].toUpperCase() : words[j])).join(' ');
          let x = L.bandX + (L.bandW - ctx.measureText(text).width) / 2;
          lineWords.forEach((j, k) => {
            const w = (upper ? words[j].toUpperCase() : words[j]) + (k < lineWords.length - 1 ? ' ' : '');
            ctx.fillStyle = tints[j] || bandStyle.ink;
            ctx.fillText(w, x, y + lineH / 2);
            x += ctx.measureText(w).width;
          });
          y += lineH;
        }
      };

      drawRun(L.titleLines, L.titleWords, L.titleSize, L.titleSize * 1.1, s.titleTints, true);
      if (L.titleLines.length && L.subLines.length) y += L.subSize * 0.6;
      drawRun(L.subLines, L.subWords, L.subSize, L.subSize * 1.32, s.subTints, false);
    }
    return canvas;
  };

  const downloadOne = async (s: Slide, index: number) => {
    const canvas = await renderSlide(s);
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = `sketchlearn-post-${index + 1}.png`;
    a.click();
  };

  const download = async (all: boolean) => {
    setBusy(true);
    try {
      if (all) {
        for (let i = 0; i < slides.length; i++) {
          await downloadOne(slides[i], i);
          await new Promise((r) => setTimeout(r, 350)); // let each save land
        }
        toast.success(`${slides.length} slide${slides.length === 1 ? '' : 's'} downloaded ✓`);
      } else {
        await downloadOne(slide, active);
        toast.success('Slide downloaded ✓');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't build the image");
    } finally {
      setBusy(false);
    }
  };

  /** Export px → preview: 1cqw is 1% of the frame's width, whatever it is. */
  const cq = (px: number) => `${(px / OUT_W) * 100}cqw`;
  const imgCost = quote.data?.image;
  const missing = slides.filter((s) => !s.imageUrl && s.imagePrompt.trim().length > 2).length;

  return (
    <div className="mx-auto flex w-full max-w-content flex-col gap-6 px-4 py-8 lg:px-8">
      <SketchToaster />
      <HubHeader
        backTo="/admin/projects"
        backLabel="Projects"
        title="Marketing"
        blurb="Write a carousel, draw its pictures, set the words — then download the post."
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
        {/* ---------------- preview + carousel strip ---------------- */}
        <div className="flex flex-col gap-3">
          <div
            className="relative mx-auto w-full max-w-[340px] overflow-hidden rounded-wobble-sm border-2 border-ink bg-paper-2 shadow-offset [container-type:inline-size]"
            style={{ aspectRatio: `${OUT_W} / ${outH}` }}
          >
            {slide.imageUrl ? (
              <img src={slide.imageUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
            ) : (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center">
                <ImageIcon className="h-8 w-8 text-ink-faint" strokeWidth={1.5} />
                <p className="micro text-[0.62rem] text-ink-faint">
                  Write the story, then draw this slide's picture.
                </p>
              </div>
            )}
            {layout.bandH > 0 && (
              <div
                className="absolute"
                style={{
                  left: cq(layout.bandX),
                  width: cq(layout.bandW),
                  bottom: cq(design.inset ? 48 : 0),
                  background: bandStyle.fill,
                  paddingTop: cq(layout.pad),
                  paddingBottom: cq(layout.pad),
                  fontFamily: FONT,
                  fontWeight: 900,
                }}
              >
                {layout.titleLines.map((lineWords, li) => (
                  <div
                    key={`t${li}`}
                    className="whitespace-nowrap text-center"
                    style={{ fontSize: cq(layout.titleSize), lineHeight: 1.1 }}
                  >
                    {lineWords.map((j, k) => (
                      <button
                        key={j}
                        type="button"
                        onClick={() => paint('title', j)}
                        title={`Paint "${layout.titleWords[j]}"`}
                        className="cursor-pointer bg-transparent p-0 uppercase hover:opacity-75"
                        style={{
                          color: slide.titleTints[j] || bandStyle.ink,
                          font: 'inherit',
                          fontSize: 'inherit',
                          lineHeight: 'inherit',
                        }}
                      >
                        {layout.titleWords[j]}
                        {k < lineWords.length - 1 ? ' ' : ''}
                      </button>
                    ))}
                  </div>
                ))}
                {layout.titleLines.length > 0 && layout.subLines.length > 0 && (
                  <div style={{ height: cq(layout.subSize * 0.6) }} />
                )}
                {layout.subLines.map((lineWords, li) => (
                  <div
                    key={`s${li}`}
                    className="whitespace-nowrap text-center"
                    style={{ fontSize: cq(layout.subSize), lineHeight: 1.32 }}
                  >
                    {lineWords.map((j, k) => (
                      <button
                        key={j}
                        type="button"
                        onClick={() => paint('subtitle', j)}
                        title={`Paint "${layout.subWords[j]}"`}
                        className="cursor-pointer bg-transparent p-0 hover:opacity-75"
                        style={{
                          color: slide.subTints[j] || bandStyle.ink,
                          font: 'inherit',
                          fontSize: 'inherit',
                          lineHeight: 'inherit',
                        }}
                      >
                        {layout.subWords[j]}
                        {k < lineWords.length - 1 ? ' ' : ''}
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* carousel strip */}
          <div className="flex flex-wrap items-center gap-1.5">
            {slides.map((s, i) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setActive(i)}
                aria-label={`Slide ${i + 1}`}
                aria-pressed={i === active}
                className={cn(
                  'relative h-12 w-9 overflow-hidden rounded-wobble-sm border-2 bg-paper-2 transition-transform hover:-translate-y-0.5',
                  i === active ? 'border-ink shadow-offset' : 'border-pencil',
                )}
              >
                {s.imageUrl && <img src={s.imageUrl} alt="" className="h-full w-full object-cover" />}
                <span className="absolute bottom-0 right-0 bg-ink px-1 font-mono text-[0.55rem] text-paper-3">
                  {i + 1}
                </span>
              </button>
            ))}
            <button
              type="button"
              onClick={() => {
                setSlides((s) => [...s, newSlide(s.length + 1)]);
                setActive(slides.length);
              }}
              aria-label="Add slide"
              title="Add a slide"
              className="flex h-12 w-9 items-center justify-center rounded-wobble-sm border-2 border-dashed border-pencil text-ink-faint hover:border-ink hover:text-ink"
            >
              <Plus className="h-4 w-4" strokeWidth={2} />
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              disabled={active === 0}
              onClick={() => {
                setSlides((s) => {
                  const n = [...s];
                  [n[active - 1], n[active]] = [n[active], n[active - 1]];
                  return n;
                });
                setActive((a) => a - 1);
              }}
              aria-label="Move slide earlier"
              title="Move earlier"
              className="rounded-wobble-sm border-2 border-dashed border-pencil p-1 text-ink-faint hover:border-ink hover:text-ink disabled:opacity-30"
            >
              <ChevronLeft className="h-3.5 w-3.5" strokeWidth={2.5} />
            </button>
            <button
              type="button"
              disabled={active === slides.length - 1}
              onClick={() => {
                setSlides((s) => {
                  const n = [...s];
                  [n[active + 1], n[active]] = [n[active], n[active + 1]];
                  return n;
                });
                setActive((a) => a + 1);
              }}
              aria-label="Move slide later"
              title="Move later"
              className="rounded-wobble-sm border-2 border-dashed border-pencil p-1 text-ink-faint hover:border-ink hover:text-ink disabled:opacity-30"
            >
              <ChevronRight className="h-3.5 w-3.5" strokeWidth={2.5} />
            </button>
            <button
              type="button"
              disabled={slides.length === 1}
              onClick={() => {
                setSlides((s) => s.filter((_, i) => i !== active));
                setActive((a) => Math.max(0, a - 1));
              }}
              aria-label="Delete slide"
              title="Delete this slide"
              className="rounded-wobble-sm border-2 border-dashed border-pencil p-1 text-ink-faint hover:border-red hover:text-red disabled:opacity-30"
            >
              <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
            </button>
            <span className="micro ml-auto text-[0.58rem] text-ink-faint">
              {OUT_W} × {outH} · slide {active + 1} of {slides.length}
            </span>
          </div>
        </div>

        {/* ---------------- controls ---------------- */}
        <div className="flex flex-col gap-4">
          {/* the story */}
          <SketchCard className="flex flex-col gap-3 p-5">
            <span className="micro flex items-center gap-1.5 text-[0.6rem] font-semibold text-ink-soft">
              <Wand2 className="h-3.5 w-3.5" strokeWidth={2} /> The story
            </span>
            <textarea
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              rows={2}
              aria-label="Carousel subject"
              placeholder="What should the carousel explain? e.g. how to brew great coffee at home"
              className="w-full resize-y rounded-wobble-sm border-2 border-ink bg-paper-3 px-3 py-2 text-sm text-ink shadow-offset outline-none placeholder:text-ink-faint focus:border-blue"
            />
            <div className="flex flex-wrap items-center gap-2">
              <label className="micro flex items-center gap-1.5 text-[0.6rem] text-ink-soft">
                Slides
                <input
                  type="number"
                  min={2}
                  max={10}
                  value={slideCount}
                  onChange={(e) => setSlideCount(Math.max(2, Math.min(10, Number(e.target.value) || 5)))}
                  aria-label="Slide count"
                  className="w-16 rounded-wobble-sm border-2 border-ink bg-paper-3 px-2 py-1 text-sm text-ink shadow-offset outline-none focus:border-blue"
                />
              </label>
              <SketchButton
                variant="accent"
                loading={storyboard.isPending}
                disabled={topic.trim().length < 3}
                onClick={() =>
                  storyboard.mutate({ topic: topic.trim(), slideCount, format: design.format })
                }
              >
                <Sparkles className="h-4 w-4" strokeWidth={2.5} /> Write the carousel
                {quote.data ? ` — ${quote.data.storyboard} 🪙` : ''}
              </SketchButton>
              <SketchButton
                variant="secondary"
                loading={busy}
                disabled={missing === 0}
                onClick={() => void drawAllMissing()}
              >
                <ImageIcon className="h-4 w-4" strokeWidth={2} /> Draw {missing} picture
                {missing === 1 ? '' : 's'}
                {imgCost != null && missing > 0 ? ` — ${missing * imgCost} 🪙` : ''}
              </SketchButton>
            </div>
            <p className="micro text-[0.58rem] text-ink-faint">
              The AI writes a title, a subtitle and a picture brief for every slide — an opening
              hook, the steps in order, then a closing card. Everything stays editable below.
            </p>
          </SketchCard>

          {/* this slide */}
          <SketchCard className="flex flex-col gap-3 p-5">
            <span className="micro flex items-center gap-1.5 text-[0.6rem] font-semibold text-ink-soft">
              <Layers className="h-3.5 w-3.5" strokeWidth={2} /> Slide {active + 1}
            </span>
            <div className="flex flex-wrap items-end gap-2">
              <textarea
                value={slide.imagePrompt}
                onChange={(e) => patch(active, { imagePrompt: e.target.value })}
                rows={2}
                aria-label="Picture brief"
                placeholder="What's in this slide's picture?"
                className="min-w-[220px] flex-1 resize-y rounded-wobble-sm border-2 border-ink bg-paper-3 px-3 py-2 text-sm text-ink shadow-offset outline-none placeholder:text-ink-faint focus:border-blue"
              />
              <SketchButton
                variant="secondary"
                loading={drawing === active}
                disabled={slide.imagePrompt.trim().length < 3}
                onClick={() => void drawOne(active)}
              >
                <Sparkles className="h-4 w-4" strokeWidth={2} />
                {slide.imageUrl ? 'Redraw' : 'Draw'}
                {imgCost != null ? ` — ${imgCost} 🪙` : ''}
              </SketchButton>
            </div>
            <input
              value={slide.title}
              onChange={(e) => patch(active, { title: e.target.value })}
              aria-label="Title"
              placeholder="Title — the big line"
              className="w-full rounded-wobble-sm border-2 border-ink bg-paper-3 px-3 py-2 font-heading text-base font-bold text-ink shadow-offset outline-none placeholder:font-normal placeholder:text-ink-faint focus:border-blue"
            />
            <textarea
              value={slide.subtitle}
              onChange={(e) => patch(active, { subtitle: e.target.value })}
              rows={2}
              aria-label="Subtitle"
              placeholder="Subtitle — the smaller sentences underneath"
              className="w-full resize-y rounded-wobble-sm border-2 border-ink bg-paper-3 px-3 py-2 text-sm text-ink shadow-offset outline-none placeholder:text-ink-faint focus:border-blue"
            />
          </SketchCard>

          {/* design */}
          <SketchCard className="flex flex-col gap-3 p-5">
            <span className="micro flex items-center gap-1.5 text-[0.6rem] font-semibold text-ink-soft">
              <Type className="h-3.5 w-3.5" strokeWidth={2} /> Design — applies to every slide
            </span>
            <div className="flex flex-wrap items-center gap-1.5">
              {FORMATS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setDesign((d) => ({ ...d, format: f.id }))}
                  aria-pressed={design.format === f.id}
                  className={cn(
                    'micro rounded-wobble-sm border-2 px-2 py-1 text-[0.6rem] font-bold transition-colors',
                    design.format === f.id
                      ? 'border-ink bg-yellow text-ink shadow-offset'
                      : 'border-dashed border-pencil text-ink-soft hover:border-ink hover:text-ink',
                  )}
                >
                  {f.label}
                </button>
              ))}
              <span className="mx-1 h-5 w-px bg-pencil" />
              {BANDS.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => setDesign((d) => ({ ...d, band: b.id }))}
                  aria-pressed={design.band === b.id}
                  className={cn(
                    'micro rounded-wobble-sm border-2 px-2 py-1 text-[0.6rem] font-bold transition-colors',
                    design.band === b.id
                      ? 'border-ink bg-yellow text-ink shadow-offset'
                      : 'border-dashed border-pencil text-ink-soft hover:border-ink hover:text-ink',
                  )}
                >
                  {b.label}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                role="switch"
                aria-checked={design.bandOn}
                aria-label="Caption band"
                onClick={() => setDesign((d) => ({ ...d, bandOn: !d.bandOn }))}
                className="flex items-center gap-2 rounded-wobble-sm border-2 border-dashed border-pencil px-2.5 py-1 text-sm font-bold text-ink"
              >
                <span
                  className={cn(
                    'relative h-5 w-9 rounded-full border-2 border-ink transition-colors',
                    design.bandOn ? 'bg-green-soft' : 'bg-paper-2',
                  )}
                >
                  <span
                    className={cn(
                      'absolute top-1/2 h-3.5 w-3.5 -translate-y-1/2 rounded-full border-2 border-ink bg-paper-3 transition-all',
                      design.bandOn ? 'left-[18px]' : 'left-0.5',
                    )}
                  />
                </span>
                Band
              </button>
              <button
                type="button"
                role="switch"
                aria-checked={design.inset}
                aria-label="Float the band"
                onClick={() => setDesign((d) => ({ ...d, inset: !d.inset }))}
                className="micro rounded-wobble-sm border-2 border-dashed border-pencil px-2 py-1 text-[0.6rem] font-bold text-ink-soft hover:border-ink hover:text-ink"
              >
                {design.inset ? 'Floating' : 'Full width'}
              </button>
            </div>
            <Slider
              label="Band thickness"
              value={design.pad}
              min={16}
              max={140}
              onChange={(v) => setDesign((d) => ({ ...d, pad: v }))}
            />
            <Slider
              label="Title size"
              value={design.titleSize}
              min={40}
              max={180}
              onChange={(v) => setDesign((d) => ({ ...d, titleSize: v }))}
            />
            <Slider
              label="Subtitle size"
              value={design.subSize}
              min={20}
              max={90}
              onChange={(v) => setDesign((d) => ({ ...d, subSize: v }))}
            />
          </SketchCard>

          {/* colour + export */}
          <SketchCard className="flex flex-col gap-3 p-5">
            <span className="micro flex items-center gap-1.5 text-[0.6rem] font-semibold text-ink-soft">
              <Eraser className="h-3.5 w-3.5" strokeWidth={2} /> Colour the words
            </span>
            <div className="flex flex-wrap items-center gap-2">
              {COLORS.map((c) => (
                <button
                  key={c.label}
                  type="button"
                  onClick={() => setActiveColor(c.hex)}
                  aria-label={c.label}
                  aria-pressed={activeColor === c.hex}
                  title={c.hex ? c.label : 'Default — clears a painted word'}
                  className={cn(
                    'h-7 w-7 rounded-full border-2 transition-transform hover:scale-110',
                    activeColor === c.hex ? 'border-ink ring-2 ring-blue' : 'border-pencil',
                    !c.hex && 'bg-paper-2',
                  )}
                  style={c.hex ? { backgroundColor: c.hex } : undefined}
                />
              ))}
              <button
                type="button"
                onClick={() => patch(active, { titleTints: {}, subTints: {} })}
                title="Clear every painted word on this slide"
                className="micro ml-auto rounded-wobble-sm border-2 border-dashed border-pencil px-2 py-1 text-[0.6rem] font-bold text-ink-soft hover:border-ink hover:text-ink"
              >
                Reset slide colours
              </button>
            </div>
            <p className="micro text-[0.58rem] text-ink-faint">
              Pick a colour, then click words in the preview — title or subtitle, either one.
            </p>
            <div className="flex flex-wrap items-center gap-2 border-t-2 border-dashed border-pencil pt-3">
              <SketchButton variant="accent" loading={busy} onClick={() => void download(false)}>
                <Download className="h-4 w-4" strokeWidth={2.5} /> Download slide
              </SketchButton>
              <SketchButton
                variant="secondary"
                loading={busy}
                disabled={slides.length < 2}
                onClick={() => void download(true)}
              >
                <Download className="h-4 w-4" strokeWidth={2} /> Download all {slides.length}
              </SketchButton>
              <span className="micro text-[0.58rem] text-ink-faint">
                PNG · {OUT_W} × {outH}
              </span>
            </div>
          </SketchCard>
        </div>
      </div>
    </div>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex items-center gap-3">
      <span className="micro w-28 shrink-0 text-[0.6rem] text-ink-soft">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        aria-label={label}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-pencil accent-orange"
      />
      <span className="micro w-10 text-right text-[0.6rem] tabular-nums text-ink-faint">{value}</span>
    </label>
  );
}

export default function AdminMarketing() {
  return (
    <AdminGate minRole="admin">
      <MarketingBody />
    </AdminGate>
  );
}
