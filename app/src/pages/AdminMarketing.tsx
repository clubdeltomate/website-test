import { useMemo, useRef, useState } from 'react';
import { Download, Eraser, Image as ImageIcon, Sparkles, Type } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { trpc } from '@/providers/trpc';
import AdminGate from '@/components/admin/AdminGate';
import SketchToaster from '@/components/admin/SketchToaster';
import SketchButton from '@/components/sketch/SketchButton';
import SketchCard from '@/components/sketch/SketchCard';
import { HubHeader } from '@/components/admin/PanelTiles';

/* Marketing: compose a 9:16 social post — an AI backdrop, a caption band over
 * the bottom, and per-word colour like the posts this is modelled on. What you
 * see is what downloads: the preview and the exported PNG are laid out by the
 * same rules, so the picture that lands in your downloads folder is the one
 * you arranged. */

/** Export size — 1080×1920 is the native 9:16 for every social surface. */
const OUT_W = 1080;
const OUT_H = 1920;
/** Caption face. A plain heavy sans so the browser preview and the canvas
 *  export resolve to the same glyphs — a webfont would drift between them. */
const CAPTION_FONT = "'Arial Black', 'Arial Bold', 'Helvetica Neue', Arial, sans-serif";

/**
 * Wrap the caption at export scale and pick the biggest size whose band still
 * leaves most of the picture visible. Both the on-screen preview and the PNG
 * read this one result, so the preview isn't an approximation of the download
 * — it is the same layout, drawn twice.
 */
function layoutCaption(
  words: string[],
  measure: CanvasRenderingContext2D | null,
): { size: number; lines: number[][]; bandH: number } {
  const pad = 64;
  const maxTextW = OUT_W - pad * 2;
  if (!measure || words.length === 0) return { size: 92, lines: [], bandH: 0 };
  let size = 92;
  let lines: number[][] = [];
  for (; size >= 34; size -= 4) {
    measure.font = `900 ${size}px ${CAPTION_FONT}`;
    lines = [];
    let line: number[] = [];
    for (let i = 0; i < words.length; i++) {
      const trial = [...line, i];
      const w = measure.measureText(trial.map((j) => words[j]).join(' ').toUpperCase()).width;
      if (w > maxTextW && line.length > 0) {
        lines.push(line);
        line = [i];
      } else {
        line = trial;
      }
    }
    if (line.length) lines.push(line);
    if (lines.length * size * 1.12 + pad * 2 <= OUT_H * 0.45) break;
  }
  return { size, lines, bandH: lines.length * size * 1.12 + pad * 2 };
}

/** The palette a word can be tinted with. First entry = plain (no tint). */
const COLORS = [
  { id: 'plain', label: 'White', hex: '#FFFFFF' },
  { id: 'cyan', label: 'Cyan', hex: '#35C4F0' },
  { id: 'yellow', label: 'Yellow', hex: '#FFC53D' },
  { id: 'green', label: 'Green', hex: '#5BD37F' },
  { id: 'red', label: 'Red', hex: '#FF6B5A' },
  { id: 'purple', label: 'Purple', hex: '#B79CF5' },
];

function MarketingBody() {
  const [prompt, setPrompt] = useState('');
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [footerOn, setFooterOn] = useState(true);
  const [caption, setCaption] = useState('Hobbies that build an insane level of confidence');
  /** word index → hex. Absent = the default white. */
  const [tints, setTints] = useState<Record<number, string>>({ 7: '#35C4F0' });
  const [activeColor, setActiveColor] = useState(COLORS[1].hex);
  const [busy, setBusy] = useState(false);
  /** Offscreen 2d context used only to measure text for the shared layout. */
  const measureRef = useRef<CanvasRenderingContext2D | null>(null);
  if (measureRef.current === null && typeof document !== 'undefined') {
    measureRef.current = document.createElement('canvas').getContext('2d');
  }

  const quote = trpc.marketing.quote.useQuery();
  const utils = trpc.useUtils();
  const generate = trpc.marketing.generate.useMutation({
    onSuccess: (r) => {
      setImageUrl(r.url);
      toast.success(`Backdrop drawn — ${r.cost} 🪙`);
      void utils.auth.me.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const words = useMemo(() => caption.split(/\s+/).filter(Boolean), [caption]);
  const layout = useMemo(() => layoutCaption(words, measureRef.current), [words]);
  /** Export px → preview: 1cqw is 1% of the frame's width, whatever it is. */
  const cqw = (px: number) => `${(px / OUT_W) * 100}cqw`;

  /** Click a word to paint it with the active colour; click again to clear. */
  const paintWord = (i: number) =>
    setTints((t) => {
      const next = { ...t };
      if (next[i] === activeColor) delete next[i];
      else next[i] = activeColor;
      return next;
    });

  /**
   * Redraw the composition at full size and hand it over as a PNG.
   *
   * Drawn from the same model the preview reads — cover-fit backdrop, band
   * sized to the wrapped caption — rather than screenshotting the DOM, so the
   * export is a clean 1080×1920 regardless of how the page happens to be
   * scaled on screen.
   */
  const download = async () => {
    if (!imageUrl) return;
    setBusy(true);
    try {
      const img = new Image();
      img.src = imageUrl;
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error("The backdrop couldn't be loaded"));
      });
      const canvas = document.createElement('canvas');
      canvas.width = OUT_W;
      canvas.height = OUT_H;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('This browser has no canvas to draw on');

      // backdrop, cover-fit and centred
      const scale = Math.max(OUT_W / img.width, OUT_H / img.height);
      const dw = img.width * scale;
      const dh = img.height * scale;
      ctx.drawImage(img, (OUT_W - dw) / 2, (OUT_H - dh) / 2, dw, dh);

      if (footerOn && layout.lines.length > 0) {
        const { size, lines, bandH } = layout;
        const pad = 64;
        const lineH = size * 1.12;
        ctx.fillStyle = '#0B0B0B';
        ctx.fillRect(0, OUT_H - bandH, OUT_W, bandH);

        ctx.font = `900 ${size}px ${CAPTION_FONT}`;
        ctx.textBaseline = 'middle';
        lines.forEach((lineWords, li) => {
          const text = lineWords.map((j) => words[j]).join(' ').toUpperCase();
          const totalW = ctx.measureText(text).width;
          let x = (OUT_W - totalW) / 2;
          const y = OUT_H - bandH + pad + li * lineH + lineH / 2;
          lineWords.forEach((j, k) => {
            const word = words[j].toUpperCase() + (k < lineWords.length - 1 ? ' ' : '');
            ctx.fillStyle = tints[j] ?? '#FFFFFF';
            ctx.fillText(word, x, y);
            x += ctx.measureText(word).width;
          });
        });
      }

      const href = canvas.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = href;
      a.download = `sketchlearn-post-${Date.now()}.png`;
      a.click();
      toast.success('Post downloaded ✓');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't build the image");
    } finally {
      setBusy(false);
    }
  };

  const cost = quote.data?.cost;

  return (
    <div className="mx-auto flex w-full max-w-content flex-col gap-6 px-4 py-8 lg:px-8">
      <SketchToaster />
      <HubHeader
        backTo="/admin/projects"
        backLabel="Projects"
        title="Marketing"
        blurb="Compose a 9:16 post: an AI backdrop, a caption band, colour by the word."
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
        {/* ---------------- the 9:16 canvas ---------------- */}
        <div>
          <div
            className="relative mx-auto flex aspect-[9/16] w-full max-w-[320px] flex-col justify-end overflow-hidden rounded-wobble-sm border-2 border-ink bg-paper-2 shadow-offset [container-type:inline-size]"
          >
            {imageUrl ? (
              <img src={imageUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
            ) : (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center">
                <ImageIcon className="h-8 w-8 text-ink-faint" strokeWidth={1.5} />
                <p className="micro text-[0.62rem] text-ink-faint">
                  Describe the backdrop and press Generate — it lands here at 9:16.
                </p>
              </div>
            )}
            {footerOn && layout.lines.length > 0 && (
              <div
                className="relative w-full bg-[#0B0B0B]"
                style={{
                  paddingTop: cqw(64),
                  paddingBottom: cqw(64),
                  fontFamily: CAPTION_FONT,
                  fontWeight: 900,
                  fontSize: cqw(layout.size),
                  lineHeight: 1.12,
                }}
              >
                {layout.lines.map((lineWords, li) => (
                  <div key={li} className="whitespace-nowrap text-center">
                    {lineWords.map((j, k) => (
                      <button
                        key={j}
                        type="button"
                        onClick={() => paintWord(j)}
                        title={`Paint "${words[j]}"`}
                        className="cursor-pointer bg-transparent p-0 uppercase hover:opacity-75"
                        style={{
                          color: tints[j] ?? '#FFFFFF',
                          fontFamily: 'inherit',
                          fontWeight: 900,
                          fontSize: 'inherit',
                          lineHeight: 'inherit',
                        }}
                      >
                        {words[j]}
                        {k < lineWords.length - 1 ? ' ' : ''}
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
          <p className="micro mt-2 text-center text-[0.58rem] text-ink-faint">
            1080 × 1920 on download · click a word above to paint it
          </p>
        </div>

        {/* ---------------- the controls ---------------- */}
        <div className="flex flex-col gap-4">
          <SketchCard className="flex flex-col gap-3 p-5">
            <span className="micro flex items-center gap-1.5 text-[0.6rem] font-semibold text-ink-soft">
              <ImageIcon className="h-3.5 w-3.5" strokeWidth={2} /> Backdrop
            </span>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={3}
              aria-label="Backdrop prompt"
              placeholder="What should the picture show? e.g. a confident woman walking through a city plaza at golden hour"
              className="w-full resize-y rounded-wobble-sm border-2 border-ink bg-paper-3 px-3 py-2 text-sm text-ink shadow-offset outline-none placeholder:text-ink-faint focus:border-blue"
            />
            <div className="flex flex-wrap items-center gap-2">
              <SketchButton
                variant="accent"
                loading={generate.isPending}
                disabled={prompt.trim().length < 3}
                onClick={() => generate.mutate({ prompt: prompt.trim() })}
              >
                <Sparkles className="h-4 w-4" strokeWidth={2.5} />
                {imageUrl ? 'Redraw' : 'Generate'}
                {cost != null ? ` — ${cost} 🪙` : ''}
              </SketchButton>
              <SketchButton variant="secondary" disabled={!imageUrl || busy} onClick={() => void download()}>
                <Download className="h-4 w-4" strokeWidth={2} /> Download PNG
              </SketchButton>
            </div>
          </SketchCard>

          <SketchCard className="flex flex-col gap-3 p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="micro flex items-center gap-1.5 text-[0.6rem] font-semibold text-ink-soft">
                <Type className="h-3.5 w-3.5" strokeWidth={2} /> Caption band
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={footerOn}
                aria-label="Caption band"
                onClick={() => setFooterOn((v) => !v)}
                className="flex items-center gap-2 rounded-wobble-sm border-2 border-dashed border-pencil px-2.5 py-1 text-sm font-bold text-ink"
              >
                <span
                  className={cn(
                    'relative h-5 w-9 rounded-full border-2 border-ink transition-colors',
                    footerOn ? 'bg-green-soft' : 'bg-paper-2',
                  )}
                >
                  <span
                    className={cn(
                      'absolute top-1/2 h-3.5 w-3.5 -translate-y-1/2 rounded-full border-2 border-ink bg-paper-3 transition-all',
                      footerOn ? 'left-[18px]' : 'left-0.5',
                    )}
                  />
                </span>
                {footerOn ? 'On' : 'Off'}
              </button>
            </div>
            <textarea
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              rows={4}
              aria-label="Caption text"
              disabled={!footerOn}
              placeholder="Write the caption — three sentences fit comfortably; the band grows to hold them."
              className="w-full resize-y rounded-wobble-sm border-2 border-ink bg-paper-3 px-3 py-2 text-sm text-ink shadow-offset outline-none placeholder:text-ink-faint focus:border-blue disabled:opacity-50"
            />
            <div className="flex flex-wrap items-center gap-2">
              <span className="micro text-[0.58rem] text-ink-faint">Paint with</span>
              {COLORS.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setActiveColor(c.hex)}
                  aria-label={c.label}
                  aria-pressed={activeColor === c.hex}
                  title={c.label}
                  className={cn(
                    'h-7 w-7 rounded-full border-2 transition-transform hover:scale-110',
                    activeColor === c.hex ? 'border-ink ring-2 ring-blue' : 'border-pencil',
                  )}
                  style={{ backgroundColor: c.hex }}
                />
              ))}
              <button
                type="button"
                onClick={() => setTints({})}
                disabled={Object.keys(tints).length === 0}
                title="Clear every painted word"
                className="micro ml-auto flex items-center gap-1 rounded-wobble-sm border-2 border-dashed border-pencil px-2 py-1 text-[0.6rem] font-bold text-ink-soft transition-colors hover:border-ink hover:text-ink disabled:opacity-40"
              >
                <Eraser className="h-3.5 w-3.5" strokeWidth={2} /> Reset colours
              </button>
            </div>
            <p className="micro text-[0.58rem] text-ink-faint">
              Pick a colour, then click the words in the preview you want in it.
            </p>
          </SketchCard>
        </div>
      </div>
    </div>
  );
}

export default function AdminMarketing() {
  return (
    <AdminGate minRole="admin">
      <MarketingBody />
    </AdminGate>
  );
}
