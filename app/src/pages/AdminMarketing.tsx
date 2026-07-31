import { useEffect, useMemo, useRef, useState } from 'react';
import {
  BadgeCheck,
  ChevronLeft,
  ChevronRight,
  Download,
  Eraser,
  Image as ImageIcon,
  Layers,
  Palette,
  Plus,
  RefreshCw,
  Save,
  Send,
  Sparkles,
  Trash2,
  Type,
  Upload,
  UserPlus,
  UserRound,
  Users,
  Wand2,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { FONT, OUT_W, bandRgb, inkFor, tintsFrom, wordsOf } from '@/lib/caption-words';
import { type ZipEntry, canvasBytes, makeZip } from '@/lib/zip';
import { POST_CATEGORIES, type PostCategory } from '@contracts/post';
import { LANGUAGES } from '@contracts/languages';
import { useNavigate } from 'react-router';
import { TEMPLATE_META } from '@/components/repo/shared';
import { trpc } from '@/providers/trpc';
import FollowPreview from '@/components/marketing/FollowPreview';
import {
  type FollowCard,
  drawFollowCard,
  emptyFollowCard,
  layoutFollow,
} from '@/components/marketing/follow-card';
import CostConfirmProvider from '@/components/marketing/CostConfirmProvider';
import { useCostConfirm } from '@/components/marketing/cost-confirm';
import AdminGate from '@/components/admin/AdminGate';
import SketchToaster from '@/components/admin/SketchToaster';
import SketchButton from '@/components/sketch/SketchButton';
import SketchCard from '@/components/sketch/SketchCard';
import { HubHeader } from '@/components/admin/PanelTiles';
import MarketingTabs from '@/components/marketing/MarketingTabs';

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

/** Ready-made band colours — all solid. How see-through the band is, is a
 *  separate decision (see FINISHES), so picking a colour never costs you the
 *  glass look and vice versa. Anything outside this row can be mixed with the
 *  picker beside it. */
const BAND_PRESETS = [
  { label: 'Ink', fill: '#0B0B0B' },
  { label: 'Paper', fill: '#FFFDF6' },
  { label: 'Navy', fill: '#12294B' },
  { label: 'Ocean', fill: '#0F6F86' },
  { label: 'Forest', fill: '#1E4A32' },
  { label: 'Olive', fill: '#5A6231' },
  { label: 'Wine', fill: '#6B1D2B' },
  { label: 'Rust', fill: '#B4471F' },
  { label: 'Plum', fill: '#43214F' },
  { label: 'Sun', fill: '#FFC53D' },
  { label: 'Blush', fill: '#F7D7D2' },
  { label: 'Sky', fill: '#CFE8F7' },
  { label: 'Sand', fill: '#E8D7AE' },
];

/** How the band meets the picture behind it. */
const FINISHES = [
  { id: 'solid' as const, label: 'Solid', hint: 'A flat block of colour.' },
  { id: 'glass' as const, label: 'Glass', hint: 'See-through — the picture shows faintly.' },
  { id: 'fade' as const, label: 'Fade', hint: 'Full at the bottom, dissolving into the picture at the top.' },
];
type FinishId = (typeof FINISHES)[number]['id'];

/** How see-through glass is. */
const GLASS_ALPHA = 0.62;

/**
 * How tall the dissolve above a faded band is. The ramp sits ABOVE the band
 * rather than inside it, so the words always have solid colour under them —
 * a gradient that started at the text would put white lettering on a nearly
 * white sky.
 */
const fadeRamp = (bandH: number) => Math.max(140, bandH * 0.6);

/** The band's own paint. Fade keeps it solid; the ramp is drawn separately. */
function bandBackground(fill: string, finish: FinishId): string {
  if (finish !== 'glass') return fill;
  const [r, g, b] = bandRgb(fill);
  return `rgba(${r},${g},${b},${GLASS_ALPHA})`;
}

/** The dissolve above a faded band, as CSS. */
function rampBackground(fill: string): string {
  const [r, g, b] = bandRgb(fill);
  return `linear-gradient(to top, rgb(${r},${g},${b}) 0%, rgba(${r},${g},${b},0) 100%)`;
}

/** Palette a word can be painted with — light accents for dark bands, dark
 *  ones for pale bands, plus a mixer for anything else. */
const COLORS = [
  { label: 'Default', hex: '' },
  { label: 'Cyan', hex: '#35C4F0' },
  { label: 'Yellow', hex: '#FFC53D' },
  { label: 'Green', hex: '#5BD37F' },
  { label: 'Red', hex: '#FF6B5A' },
  { label: 'Purple', hex: '#B79CF5' },
  { label: 'Orange', hex: '#FF8A3D' },
  { label: 'Pink', hex: '#FF7BB0' },
  { label: 'Blue', hex: '#2F63D8' },
  { label: 'Deep green', hex: '#12734A' },
  { label: 'Black', hex: '#0B0B0B' },
  { label: 'White', hex: '#FFFFFF' },
];

/**
 * The editor's rooms. Everything used to sit in one scrolling column, so
 * changing the band colour at the bottom meant scrolling back to the top to
 * see what it did. One panel at a time keeps the preview in view.
 */
const SECTIONS = [
  { id: 'cast' as const, label: 'Cast', icon: Users },
  { id: 'story' as const, label: 'Story', icon: Wand2 },
  { id: 'slide' as const, label: 'Slide', icon: Layers },
  { id: 'follow' as const, label: 'Follow card', icon: UserPlus },
  { id: 'design' as const, label: 'Design', icon: Type },
  { id: 'words' as const, label: 'Words', icon: Eraser },
  { id: 'share' as const, label: 'Post', icon: Send },
];
type SectionId = (typeof SECTIONS)[number]['id'];

interface Slide {
  id: string;
  imageUrl: string | null;
  imagePrompt: string;
  /** names of the cast members this slide's picture shows */
  cast: string[];
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
  /** a solid colour — a preset swatch or one mixed in the picker */
  bandFill: string;
  /** how it meets the picture: flat, see-through, or dissolving upward */
  bandFinish: FinishId;
}

const newSlide = (n: number): Slide => ({
  id: `s${n}-${Math.random().toString(36).slice(2, 8)}`,
  imageUrl: null,
  imagePrompt: '',
  cast: [],
  title: '',
  subtitle: '',
  titleTints: {},
  subTints: {},
});


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
  const [activeRaw, setActive] = useState(0);
  const [design, setDesign] = useState<Design>({
    format: '9:16',
    bandOn: true,
    inset: false,
    pad: 56,
    titleSize: 96,
    subSize: 40,
    bandFill: BAND_PRESETS[0].fill,
    bandFinish: 'solid',
  });
  const [topic, setTopic] = useState('');
  const [slideCount, setSlideCount] = useState(5);
  const [activeColor, setActiveColor] = useState(COLORS[1].hex);
  const [busy, setBusy] = useState(false);
  /** Index currently being drawn, so only that slide's button spins. */
  const [drawing, setDrawing] = useState<number | null>(null);
  const [follow, setFollow] = useState<FollowCard>(emptyFollowCard);
  const [drawingLogo, setDrawingLogo] = useState(false);
  /** ids of the models this carousel may draw from */
  const [picked, setPicked] = useState<string[]>([]);
  const [section, setSection] = useState<SectionId>('story');
  const [language, setLanguage] = useState('en');
  const [category, setCategory] = useState<PostCategory>('course');
  const [caption, setCaption] = useState('');
  const [posting, setPosting] = useState(false);
  const [modelNote, setModelNote] = useState('');
  const [reading, setReading] = useState(false);
  /** which model's face is being drawn, so only its button spins */
  const [portraying, setPortraying] = useState<string | null>(null);
  const confirm = useCostConfirm();

  const measureRef = useRef<CanvasRenderingContext2D | null>(null);
  if (measureRef.current === null && typeof document !== 'undefined') {
    measureRef.current = document.createElement('canvas').getContext('2d');
  }

  const utils = trpc.useUtils();
  const navigate = useNavigate();
  const quote = trpc.marketing.quote.useQuery();
  /* Who is posting: this site's own name and bio, read from the same
   * description the About page renders. It seeds the card once, so the thing
   * is already right before anyone types — and never fights an edit. */
  const cast = trpc.cast.list.useQuery();
  /* The pool the AI may cast from, and the lookup that turns the names it
   * chose back into the sheets an image prompt needs. */
  const roster = useMemo(() => cast.data ?? [], [cast.data]);
  const pickedModels = useMemo(
    () => roster.filter((m) => picked.includes(m.id)),
    [roster, picked],
  );
  const sheetsFor = (names: string[]) => {
    const want = names.map((n) => n.trim().toLowerCase());
    return pickedModels
      .filter((m) => want.includes(m.name.trim().toLowerCase()))
      .map((m) => ({ name: m.name, headline: m.headline, sheet: m.sheet }));
  };

  const brand = trpc.marketing.brand.useQuery();
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || !brand.data) return;
    seeded.current = true;
    const b = brand.data;
    // A card saved with Update wins outright — it IS the account. Only when
    // nothing has been saved yet do we fall back to describing this site.
    setFollow((f) =>
      b.saved
        ? { ...f, ...(b.saved as Partial<FollowCard>), on: f.on }
        : { ...f, name: f.name || b.name, headline: f.headline || b.headline, bio: f.bio || b.bio },
    );
  }, [brand.data]);

  /** Make this card the starting point for every future carousel. */
  const saveBrand = trpc.marketing.saveBrand.useMutation({
    onSuccess: (r) => {
      // The upload became a stored image on the way in; hold the short URL so
      // the megabyte of base64 does not sit in memory for the rest of the session.
      if (r.logoUrl !== follow.logoUrl) setFollow((f) => ({ ...f, logoUrl: r.logoUrl }));
      void brand.refetch();
      toast.success('Saved — every new carousel starts from this card');
    },
    onError: (e) => toast.error(e.message),
  });

  const outH = FORMATS.find((f) => f.id === design.format)!.h;
  /** The follow card, when it is on, is the slide after the last picture. */
  const total = slides.length + (follow.on ? 1 : 0);
  const active = Math.min(activeRaw, total - 1);
  const onFollow = follow.on && active === slides.length;
  const slide = slides[Math.min(active, slides.length - 1)];
  const layout = useMemo(
    () => layoutCard(slide, design, measureRef.current, outH),
    [slide, design, outH],
  );
  const followLayout = useMemo(
    () => layoutFollow(follow, measureRef.current, outH),
    [follow, outH],
  );
  const bandStyle = { fill: design.bandFill, ink: inkFor(design.bandFill) };
  /** What the AI paints keywords with — the swatch in hand, unless that is
   *  "Default", which would paint them the same colour as everything else. */
  const accent = activeColor || COLORS[1].hex;

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
          cast: s.cast,
          titleTints: tintsFrom(s.title, s.titleKeywords, accent),
          subTints: tintsFrom(s.subtitle, s.subtitleKeywords, accent),
        })),
      );
      setActive(0);
      // The closing card is written in the site's own voice, from the same
      // description the About page renders.
      if (r.endCard) {
        setFollow((f) => ({
          ...f,
          headline: r.endCard!.headline || f.headline,
          bio: r.endCard!.bio || f.bio,
        }));
      }
      toast.success(`Story written — ${r.slides.length} slides, ${r.cost} 🪙`);
      void utils.auth.me.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  /** Ask the AI which words carry each card, and paint those. Re-runnable, so
   *  a card typed or rewritten by hand gets the same treatment, and scoped so
   *  repainting the title cannot undo hand-picked subtitle colours. */
  const highlight = trpc.marketing.highlight.useMutation({
    onSuccess: (r) => {
      let painted = 0;
      setSlides((cur) =>
        cur.map((s, i) => {
          const k = r.slides[i];
          if (!k) return s;
          const next = { ...s };
          if (r.scope !== 'subtitle') {
            next.titleTints = tintsFrom(s.title, k.titleKeywords, accent);
            painted += Object.keys(next.titleTints).length;
          }
          if (r.scope !== 'title') {
            next.subTints = tintsFrom(s.subtitle, k.subtitleKeywords, accent);
            painted += Object.keys(next.subTints).length;
          }
          return next;
        }),
      );
      toast.success(`${painted} keyword${painted === 1 ? '' : 's'} highlighted — ${r.cost} 🪙`);
      void utils.auth.me.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const runHighlight = async (scope: 'title' | 'subtitle' | 'both') => {
    if (!(await confirm.ask('Picking the keywords', quote.data?.highlight))) return;
    highlight.mutate({
      scope,
      slides: slides.slice(0, 20).map((s) => ({ title: s.title, subtitle: s.subtitle })),
    });
  };

  /** Draw one slide's backdrop. The index is captured here rather than
   *  recovered from the response, so the picture always lands on the slide
   *  that asked for it even if the prompt was edited mid-flight. */
  const drawOne = async (i: number) => {
    const prompt = slides[i].imagePrompt.trim();
    if (prompt.length < 3) return;
    if (!(await confirm.ask('Drawing this backdrop', imgCost))) return;
    setDrawing(i);
    try {
      const r = await utils.client.marketing.generate.mutate({
        prompt,
        format: design.format,
        cast: sheetsFor(slides[i].cast),
      });
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
    if (
      !(await confirm.ask(
        `Drawing ${todo.length} backdrop${todo.length === 1 ? '' : 's'}`,
        imgCost == null ? undefined : imgCost * todo.length,
      ))
    )
      return;
    setBusy(true);
    let made = 0;
    for (const { s, i } of todo) {
      try {
        const r = await utils.client.marketing.generate.mutate({
          prompt: s.imagePrompt.trim(),
          format: design.format,
          cast: sheetsFor(s.cast),
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
      if (design.bandFinish === 'fade') {
        const ramp = fadeRamp(L.bandH);
        const [r, g, b] = bandRgb(design.bandFill);
        const grad = ctx.createLinearGradient(0, L.bandY, 0, L.bandY - ramp);
        grad.addColorStop(0, `rgb(${r},${g},${b})`);
        grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
        ctx.fillStyle = grad;
        ctx.fillRect(L.bandX, L.bandY - ramp, L.bandW, ramp);
      }
      ctx.fillStyle = bandBackground(design.bandFill, design.bandFinish);
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

  /** Render the closing follow card at full export size. */
  const renderFollow = async (): Promise<HTMLCanvasElement> => {
    const canvas = document.createElement('canvas');
    canvas.width = OUT_W;
    canvas.height = outH;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('This browser has no canvas to draw on');
    await drawFollowCard(ctx, follow, layoutFollow(follow, measureRef.current, outH), outH);
    return canvas;
  };

  const saveCanvas = (canvas: HTMLCanvasElement, name: string) => {
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = name;
    a.click();
  };

  const slideName = (index: number) =>
    follow.on && index === slides.length
      ? 'sketchlearn-post-follow.png'
      : `sketchlearn-post-${index + 1}.png`;

  const renderAt = (index: number) =>
    follow.on && index === slides.length ? renderFollow() : renderSlide(slides[index]);

  const download = async (all: boolean) => {
    setBusy(true);
    try {
      if (all) {
        // One archive rather than a burst of saves — a six-slide carousel used
        // to mean six trips through the download bar.
        const entries: ZipEntry[] = [];
        for (let i = 0; i < total; i++) {
          entries.push({ name: slideName(i), bytes: await canvasBytes(await renderAt(i)) });
        }
        const blob = new Blob([makeZip(entries) as BlobPart], { type: 'application/zip' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'sketchlearn-carousel.zip';
        a.click();
        URL.revokeObjectURL(a.href);
        toast.success(`${total} slide${total === 1 ? '' : 's'} zipped ✓`);
      } else {
        saveCanvas(await renderAt(active), slideName(active));
        toast.success('Slide downloaded ✓');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't build the image");
    } finally {
      setBusy(false);
    }
  };

  /**
   * Publish the carousel to the feed.
   *
   * The finished PNGs are what get posted, not the editor state that made
   * them — what people see stays what was published even if the cast, the
   * band or the follow card change later. They go up one at a time: six
   * 1080-wide slides in a single body would be past the request cap, and
   * nowhere near it individually.
   */
  const publish = async () => {
    if (!caption.trim()) return toast.error('Give the post a caption first');
    setPosting(true);
    try {
      const imageIds: number[] = [];
      for (let i = 0; i < total; i++) {
        const canvas = await renderAt(i);
        const r = await utils.client.posts.uploadSlide.mutate({
          image: canvas.toDataURL('image/png'),
        });
        imageIds.push(r.id);
      }
      const r = await utils.client.posts.create.mutate({
        caption: caption.trim(),
        category,
        imageIds,
        width: OUT_W,
        height: outH,
      });
      toast.success('Posted to the feed ✓');
      navigate(`/feed/${r.slug}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "That post couldn't be published");
    } finally {
      setPosting(false);
    }
  };

  /** Draw the follow card's logo. Its own art direction — a flat mark, not a
   *  photo — because it ends up small and round. */
  const drawLogo = async () => {
    const prompt = follow.logoPrompt.trim();
    if (prompt.length < 3) return;
    if (!(await confirm.ask('Drawing the logo', quote.data?.logo))) return;
    setDrawingLogo(true);
    try {
      const r = await utils.client.marketing.logo.mutate({ prompt });
      setFollow((f) => ({ ...f, logoUrl: r.url }));
      toast.success(`Logo drawn — ${r.cost} 🪙`);
      void utils.auth.me.invalidate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "That logo couldn't be drawn");
    } finally {
      setDrawingLogo(false);
    }
  };

  /** Read an uploaded photograph into a reusable cast member. */
  const modelFromPhoto = (file: File) => {
    if (file.size > 6_000_000) return toast.error('That photo is over 6 MB — try a smaller one');
    const reader = new FileReader();
    reader.onload = async () => {
      if (!(await confirm.ask('Reading that photo into a model', 1))) return;
      setReading(true);
      try {
        const r = await utils.client.cast.fromPhoto.mutate({
          image: String(reader.result),
          note: modelNote.trim(),
        });
        await cast.refetch();
        setPicked((p) => [...p, r.model.id]);
        setModelNote('');
        toast.success(`${r.model.name} joined the cast — ${r.cost} 🪙`);
        void utils.auth.me.invalidate();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "That photo couldn't be read");
      } finally {
        setReading(false);
      }
    };
    reader.onerror = () => toast.error("That file couldn't be read");
    reader.readAsDataURL(file);
  };

  /** Put a face on a model, so the picker shows who rather than two initials. */
  const drawPortrait = async (id: string, name: string) => {
    if (!(await confirm.ask(`Drawing ${name}`, imgCost))) return;
    setPortraying(id);
    try {
      const r = await utils.client.cast.portrait.mutate({ id });
      await cast.refetch();
      toast.success(`${name} drawn — ${r.cost} 🪙`);
      void utils.auth.me.invalidate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "That portrait couldn't be drawn");
    } finally {
      setPortraying(null);
    }
  };

  const removeModel = async (id: string) => {
    const numeric = Number(id.replace('own-', ''));
    if (!numeric) return;
    try {
      await utils.client.cast.remove.mutate({ id: numeric });
      setPicked((p) => p.filter((x) => x !== id));
      await cast.refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "That model couldn't be removed");
    }
  };

  const uploadLogo = (file: File) => {
    if (file.size > 6_000_000) return toast.error('That logo is over 6 MB — try a smaller one');
    const reader = new FileReader();
    reader.onload = () => setFollow((f) => ({ ...f, logoUrl: String(reader.result) }));
    reader.onerror = () => toast.error("That file couldn't be read");
    reader.readAsDataURL(file);
  };

  /** Save the logo on its own, whether it was drawn or uploaded. */
  const downloadLogo = async () => {
    if (!follow.logoUrl) return;
    try {
      const blob = await (await fetch(follow.logoUrl)).blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'sketchlearn-logo.png';
      a.click();
      URL.revokeObjectURL(a.href);
      toast.success('Logo downloaded ✓');
    } catch {
      toast.error("That logo couldn't be saved");
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
        blurb="Write a carousel, draw its pictures, set the words — then post it."
      />
      <MarketingTabs />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
        {/* ---------------- preview + carousel strip ---------------- */}
        {/* Pinned, so a change made in any panel is visible where it lands. */}
        <div className="flex flex-col gap-3 lg:sticky lg:top-4 lg:self-start">
          <div
            className="relative mx-auto w-full max-w-[340px] overflow-hidden rounded-wobble-sm border-2 border-ink bg-paper-2 shadow-offset [container-type:inline-size]"
            style={{ aspectRatio: `${OUT_W} / ${outH}` }}
          >
            {onFollow && <FollowPreview card={follow} layout={followLayout} />}
            {!onFollow &&
              (slide.imageUrl ? (
                <img src={slide.imageUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
              ) : (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center">
                  <ImageIcon className="h-8 w-8 text-ink-faint" strokeWidth={1.5} />
                  <p className="micro text-[0.62rem] text-ink-faint">
                    Write the story, then draw this slide's picture.
                  </p>
                </div>
              ))}
            {/* Redraw this one picture, from this one slide's brief, without
                scrolling down to find its card. */}
            {!onFollow && slide.imagePrompt.trim().length > 2 && (
              <button
                type="button"
                disabled={drawing === active}
                onClick={() => void drawOne(active)}
                aria-label={slide.imageUrl ? 'Redraw this picture' : 'Draw this picture'}
                title={
                  slide.imageUrl
                    ? `Redraw this picture from the slide's brief${imgCost != null ? ` — ${imgCost} 🪙` : ''}`
                    : `Draw this picture${imgCost != null ? ` — ${imgCost} 🪙` : ''}`
                }
                className="absolute right-2 top-2 z-10 flex items-center gap-1 rounded-wobble-sm border-2 border-ink bg-paper-3/90 px-2 py-1 text-ink shadow-offset transition-transform hover:-translate-y-0.5 disabled:opacity-60"
              >
                <RefreshCw
                  className={cn('h-3.5 w-3.5', drawing === active && 'animate-spin')}
                  strokeWidth={2.5}
                />
                <span className="micro text-[0.55rem] font-bold">
                  {drawing === active ? 'Drawing…' : slide.imageUrl ? 'Redraw' : 'Draw'}
                </span>
              </button>
            )}
            {!onFollow && layout.bandH > 0 && design.bandFinish === 'fade' && (
              <div
                className="pointer-events-none absolute"
                style={{
                  left: cq(layout.bandX),
                  width: cq(layout.bandW),
                  bottom: cq((design.inset ? 48 : 0) + layout.bandH),
                  height: cq(fadeRamp(layout.bandH)),
                  background: rampBackground(design.bandFill),
                }}
              />
            )}
            {!onFollow && layout.bandH > 0 && (
              <div
                className="absolute"
                style={{
                  left: cq(layout.bandX),
                  width: cq(layout.bandW),
                  bottom: cq(design.inset ? 48 : 0),
                  background: bandBackground(design.bandFill, design.bandFinish),
                  paddingTop: cq(layout.pad),
                  paddingBottom: cq(layout.pad),
                  fontFamily: FONT,
                  fontWeight: 900,
                }}
              >
                <WordRun
                  lines={layout.titleLines}
                  words={layout.titleWords}
                  tints={slide.titleTints}
                  ink={bandStyle.ink}
                  fontSize={cq(layout.titleSize)}
                  lineHeight={1.1}
                  upper
                  onPaint={(j) => paint('title', j)}
                />
                {layout.titleLines.length > 0 && layout.subLines.length > 0 && (
                  <div style={{ height: cq(layout.subSize * 0.6) }} />
                )}
                <WordRun
                  lines={layout.subLines}
                  words={layout.subWords}
                  tints={slide.subTints}
                  ink={bandStyle.ink}
                  fontSize={cq(layout.subSize)}
                  lineHeight={1.32}
                  upper={false}
                  onPaint={(j) => paint('subtitle', j)}
                />
              </div>
            )}
          </div>

          {/* carousel strip */}
          <div className="flex flex-wrap items-center gap-1.5">
            {slides.map((s, i) => (
              <button
                key={s.id}
                type="button"
                onClick={() => {
                  setActive(i);
                  setSection('slide');
                }}
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
            {follow.on && (
              <button
                type="button"
                onClick={() => {
                  setActive(slides.length);
                  setSection('follow');
                }}
                aria-label="Follow card"
                aria-pressed={onFollow}
                title="The closing follow card"
                className={cn(
                  'relative flex h-12 w-9 items-center justify-center overflow-hidden rounded-wobble-sm border-2 transition-transform hover:-translate-y-0.5',
                  onFollow ? 'border-ink shadow-offset' : 'border-pencil',
                )}
                style={{ background: follow.bg }}
              >
                {follow.logoUrl ? (
                  <img src={follow.logoUrl} alt="" className="h-6 w-6 rounded-full object-cover" />
                ) : (
                  <UserPlus className="h-4 w-4" strokeWidth={2} style={{ color: inkFor(follow.bg) }} />
                )}
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setSlides((s) => [...s, newSlide(s.length + 1)]);
                setActive(slides.length);
                setSection('slide');
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
              disabled={active === 0 || onFollow}
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
              disabled={active >= slides.length - 1}
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
              disabled={slides.length === 1 || onFollow}
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
              {OUT_W} × {outH} · {onFollow ? 'follow card' : `slide ${active + 1} of ${slides.length}`}
            </span>
          </div>
        </div>

        {/* ---------------- controls ---------------- */}
        <div className="flex flex-col gap-4">
          {/* One panel at a time. The whole editor used to be a single column
              you scrolled, which meant changing a colour at the bottom and
              scrolling back to the top to see what it did. */}
          <div className="flex flex-wrap items-center gap-1.5">
            {SECTIONS.map((sec) => (
              <button
                key={sec.id}
                type="button"
                onClick={() => setSection(sec.id)}
                aria-pressed={section === sec.id}
                className={cn(
                  'micro flex items-center gap-1.5 rounded-wobble-sm border-2 px-2.5 py-1.5 text-[0.6rem] font-bold transition-colors',
                  section === sec.id
                    ? 'border-ink bg-yellow text-ink shadow-offset'
                    : 'border-dashed border-pencil text-ink-soft hover:border-ink hover:text-ink',
                )}
              >
                <sec.icon className="h-3.5 w-3.5" strokeWidth={2} />
                {sec.label}
              </button>
            ))}
          </div>

          {/* the cast */}
          {section === 'cast' && (
          <SketchCard className="flex flex-col gap-3 p-5">
            <div className="flex w-full items-center gap-2">
              <span className="micro flex items-center gap-1.5 text-[0.6rem] font-semibold text-ink-soft">
                <Users className="h-3.5 w-3.5" strokeWidth={2} /> The cast
              </span>
              <span className="micro rounded-wobble-sm border-2 border-dashed border-pencil px-1.5 text-[0.58rem] font-bold text-ink-soft">
                {picked.length ? `${picked.length} picked` : 'nobody picked'}
              </span>
            </div>

            {(
              <>
                <div className="grid gap-1.5 sm:grid-cols-2">
                  {roster.map((m) => {
                    const on = picked.includes(m.id);
                    return (
                      <div
                        key={m.id}
                        className={cn(
                          'flex items-center gap-2 rounded-wobble-sm border-2 p-1.5 transition-colors',
                          on ? 'border-ink bg-yellow-soft shadow-offset' : 'border-dashed border-pencil',
                        )}
                      >
                        <button
                          type="button"
                          onClick={() =>
                            setPicked((p) => (on ? p.filter((x) => x !== m.id) : [...p, m.id]))
                          }
                          aria-pressed={on}
                          aria-label={m.name}
                          className="flex min-w-0 flex-1 items-center gap-2 text-left"
                        >
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-ink bg-paper-2 font-heading text-[0.6rem] font-bold text-ink">
                            {m.photoUrl ? (
                              <img src={m.photoUrl} alt="" className="h-full w-full object-cover" />
                            ) : (
                              m.name
                                .split(' ')
                                .map((w) => w[0])
                                .join('')
                                .slice(0, 2)
                            )}
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate text-[0.8rem] font-bold text-ink">
                              {m.name}
                            </span>
                            <span className="micro block truncate text-[0.55rem] text-ink-soft">
                              {m.headline}
                            </span>
                          </span>
                        </button>
                        <button
                          type="button"
                          disabled={portraying === m.id}
                          onClick={() => void drawPortrait(m.id, m.name)}
                          aria-label={`${m.photoUrl ? 'Redraw' : 'Draw'} ${m.name}'s portrait`}
                          title={
                            m.photoUrl
                              ? `Redraw ${m.name} from their description`
                              : `See what ${m.name} looks like`
                          }
                          className="shrink-0 text-ink-faint hover:text-ink disabled:opacity-40"
                        >
                          {portraying === m.id ? (
                            <RefreshCw className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
                          ) : (
                            <UserRound className="h-3.5 w-3.5" strokeWidth={2} />
                          )}
                        </button>
                        {m.custom && (
                          <button
                            type="button"
                            onClick={() => void removeModel(m.id)}
                            aria-label={`Remove ${m.name}`}
                            title="Remove this model"
                            className="shrink-0 text-ink-faint hover:text-red"
                          >
                            <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>

                <div className="flex flex-wrap items-center gap-2 border-t-2 border-dashed border-pencil pt-3">
                  <input
                    value={modelNote}
                    onChange={(e) => setModelNote(e.target.value)}
                    aria-label="Model note"
                    placeholder="Optional — what to call them, e.g. “Sam, runs the workshop”"
                    className="min-w-[200px] flex-1 rounded-wobble-sm border-2 border-ink bg-paper-3 px-3 py-2 text-sm text-ink shadow-offset outline-none placeholder:text-ink-faint focus:border-blue"
                  />
                  <label
                    className={cn(
                      'micro cursor-pointer rounded-wobble-sm border-2 border-dashed border-pencil px-2 py-1 text-[0.6rem] font-bold text-ink-soft hover:border-ink hover:text-ink',
                      reading && 'pointer-events-none opacity-50',
                    )}
                  >
                    <Upload className="mr-1 inline h-3 w-3" strokeWidth={2} />
                    {reading ? 'Reading the photo…' : 'New model from a photo'}
                    {quote.data ? ` — 1 🪙` : ''}
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      aria-label="New model from a photo"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) modelFromPhoto(file);
                        e.target.value = '';
                      }}
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => setPicked(picked.length === roster.length ? [] : roster.map((m) => m.id))}
                    className="micro rounded-wobble-sm border-2 border-dashed border-pencil px-2 py-1 text-[0.6rem] font-bold text-ink-soft hover:border-ink hover:text-ink"
                  >
                    {picked.length === roster.length ? 'Pick nobody' : 'Pick everyone'}
                  </button>
                </div>
                <p className="micro text-[0.58rem] text-ink-faint">
                  Pick who may appear and the AI casts each slide from them — often only two or
                  three across a whole carousel, and nobody at all on a slide that is a close-up.
                  They are written descriptions, not photos, so a shot of just hands still carries
                  the right skin, build and nails. Use the face button to draw a portrait from
                  someone's description and see who you are casting
                  {imgCost != null ? ` — ${imgCost} 🪙 each` : ''}. The same cast is here for every
                  carousel you make, which is what keeps a feed looking like one feed.
                </p>
              </>
            )}
          </SketchCard>
          )}

          {/* the story */}
          {section === 'story' && (
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
            {/* Which shelf this post belongs on — the same six the notebooks
                and slide tools use, so the feed filters read the same way. */}
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="micro w-full text-[0.6rem] text-ink-soft">This post is about…</span>
              {POST_CATEGORIES.map((c) => {
                const meta = TEMPLATE_META[c];
                const Icon = meta.icon;
                return (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setCategory(c)}
                    aria-pressed={category === c}
                    className={cn(
                      'micro flex items-center gap-1 rounded-wobble-sm border-2 px-2 py-1 text-[0.6rem] font-bold transition-colors',
                      category === c
                        ? 'border-ink bg-yellow text-ink shadow-offset'
                        : 'border-dashed border-pencil text-ink-soft hover:border-ink hover:text-ink',
                    )}
                  >
                    <Icon className="h-3 w-3" strokeWidth={2} />
                    {meta.label}
                  </button>
                );
              })}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label className="micro flex items-center gap-1.5 text-[0.6rem] text-ink-soft">
                Written in
                <select
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                  aria-label="Language"
                  className="rounded-wobble-sm border-2 border-ink bg-paper-3 px-2 py-1 text-sm text-ink shadow-offset outline-none focus:border-blue"
                >
                  {LANGUAGES.map((l) => (
                    <option key={l.code} value={l.code}>
                      {l.endonym}
                    </option>
                  ))}
                </select>
              </label>
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
                onClick={async () => {
                  if (!(await confirm.ask('Writing the carousel', quote.data?.storyboard))) return;
                  storyboard.mutate({
                    topic: topic.trim(),
                    slideCount,
                    format: design.format,
                    category,
                    language,
                    cast: pickedModels.map((m) => ({
                      name: m.name,
                      headline: m.headline,
                      sheet: m.sheet,
                    })),
                  });
                }}
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
          )}

          {/* this slide */}
          {section === 'slide' && (
          <SketchCard className={cn('flex flex-col gap-3 p-5', onFollow && 'hidden')}>
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
            {pickedModels.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="micro text-[0.58rem] text-ink-soft">In this picture</span>
                {pickedModels.map((m) => {
                  const on = slide.cast.some((n) => n.toLowerCase() === m.name.toLowerCase());
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() =>
                        patch(active, {
                          cast: on
                            ? slide.cast.filter((n) => n.toLowerCase() !== m.name.toLowerCase())
                            : [...slide.cast, m.name],
                        })
                      }
                      aria-pressed={on}
                      title={m.headline}
                      className={cn(
                        'micro rounded-wobble-sm border-2 px-2 py-0.5 text-[0.58rem] font-bold transition-colors',
                        on
                          ? 'border-ink bg-yellow text-ink shadow-offset'
                          : 'border-dashed border-pencil text-ink-soft hover:border-ink hover:text-ink',
                      )}
                    >
                      {m.name}
                    </button>
                  );
                })}
                {slide.cast.length === 0 && (
                  <span className="micro text-[0.55rem] text-ink-faint">nobody — an object shot</span>
                )}
              </div>
            )}
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
          )}

          {/* the closing follow card */}
          {section === 'follow' && (
          <SketchCard className="flex flex-col gap-3 p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="micro flex items-center gap-1.5 text-[0.6rem] font-semibold text-ink-soft">
                <UserPlus className="h-3.5 w-3.5" strokeWidth={2} /> Follow card — the last slide
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={follow.on}
                aria-label="Include the follow card"
                onClick={() => setFollow((f) => ({ ...f, on: !f.on }))}
                className="flex items-center gap-2 rounded-wobble-sm border-2 border-dashed border-pencil px-2.5 py-1 text-sm font-bold text-ink"
              >
                <span
                  className={cn(
                    'relative h-5 w-9 rounded-full border-2 border-ink transition-colors',
                    follow.on ? 'bg-green-soft' : 'bg-paper-2',
                  )}
                >
                  <span
                    className={cn(
                      'absolute top-1/2 h-3.5 w-3.5 -translate-y-1/2 rounded-full border-2 border-ink bg-paper-3 transition-all',
                      follow.on ? 'left-[18px]' : 'left-0.5',
                    )}
                  />
                </span>
                {follow.on ? 'Included' : 'Off'}
              </button>
            </div>

            {follow.on && (
              <>
                <textarea
                  value={follow.headline}
                  onChange={(e) => setFollow((f) => ({ ...f, headline: e.target.value }))}
                  rows={2}
                  aria-label="Follow headline"
                  placeholder="You will never see this page again unless you follow us right now 👇"
                  className="w-full resize-y rounded-wobble-sm border-2 border-ink bg-paper-3 px-3 py-2 text-sm text-ink shadow-offset outline-none placeholder:text-ink-faint focus:border-blue"
                />

                {/* logo */}
                <div className="flex flex-wrap items-center gap-2">
                  <div
                    className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-ink bg-paper-2"
                    aria-hidden="true"
                  >
                    {follow.logoUrl ? (
                      <img src={follow.logoUrl} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <ImageIcon className="h-5 w-5 text-ink-faint" strokeWidth={1.5} />
                    )}
                  </div>
                  <input
                    value={follow.logoPrompt}
                    onChange={(e) => setFollow((f) => ({ ...f, logoPrompt: e.target.value }))}
                    aria-label="Logo brief"
                    placeholder="What should the logo be? e.g. a pencil drawing an open book"
                    className="min-w-[180px] flex-1 rounded-wobble-sm border-2 border-ink bg-paper-3 px-3 py-2 text-sm text-ink shadow-offset outline-none placeholder:text-ink-faint focus:border-blue"
                  />
                  <SketchButton
                    variant="secondary"
                    loading={drawingLogo}
                    disabled={follow.logoPrompt.trim().length < 3}
                    onClick={() => void drawLogo()}
                  >
                    <Sparkles className="h-4 w-4" strokeWidth={2} />
                    {follow.logoUrl ? 'Redraw' : 'Draw'}
                    {imgCost != null ? ` — ${imgCost} 🪙` : ''}
                  </SketchButton>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <label className="micro cursor-pointer rounded-wobble-sm border-2 border-dashed border-pencil px-2 py-1 text-[0.6rem] font-bold text-ink-soft hover:border-ink hover:text-ink">
                    <Upload className="mr-1 inline h-3 w-3" strokeWidth={2} /> Upload a logo
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      aria-label="Upload a logo"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) uploadLogo(file);
                        e.target.value = '';
                      }}
                    />
                  </label>
                  <button
                    type="button"
                    disabled={!follow.logoUrl}
                    onClick={() => void downloadLogo()}
                    className="micro rounded-wobble-sm border-2 border-dashed border-pencil px-2 py-1 text-[0.6rem] font-bold text-ink-soft hover:border-ink hover:text-ink disabled:opacity-30"
                  >
                    <Download className="mr-1 inline h-3 w-3" strokeWidth={2} /> Download the logo
                  </button>
                  <button
                    type="button"
                    disabled={!follow.logoUrl}
                    onClick={() => setFollow((f) => ({ ...f, logoUrl: null }))}
                    className="micro rounded-wobble-sm border-2 border-dashed border-pencil px-2 py-1 text-[0.6rem] font-bold text-ink-soft hover:border-red hover:text-red disabled:opacity-30"
                  >
                    Remove
                  </button>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <input
                    value={follow.name}
                    onChange={(e) => setFollow((f) => ({ ...f, name: e.target.value }))}
                    aria-label="Account name"
                    placeholder="Account name"
                    className="min-w-[140px] flex-1 rounded-wobble-sm border-2 border-ink bg-paper-3 px-3 py-2 font-heading text-base font-bold text-ink shadow-offset outline-none placeholder:font-normal placeholder:text-ink-faint focus:border-blue"
                  />
                  <button
                    type="button"
                    role="switch"
                    aria-checked={follow.verified}
                    aria-label="Verified tick"
                    onClick={() => setFollow((f) => ({ ...f, verified: !f.verified }))}
                    className={cn(
                      'micro rounded-wobble-sm border-2 px-2 py-1 text-[0.6rem] font-bold transition-colors',
                      follow.verified
                        ? 'border-ink bg-blue-soft text-ink shadow-offset'
                        : 'border-dashed border-pencil text-ink-soft hover:border-ink hover:text-ink',
                    )}
                  >
                    <BadgeCheck className="mr-1 inline h-3 w-3" strokeWidth={2.5} /> Tick
                  </button>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {(['posts', 'followers', 'following'] as const).map((k) => (
                    <label key={k} className="micro flex items-center gap-1.5 text-[0.6rem] text-ink-soft">
                      {k}
                      <input
                        value={follow[k]}
                        onChange={(e) => setFollow((f) => ({ ...f, [k]: e.target.value }))}
                        aria-label={`${k} count`}
                        className="w-20 rounded-wobble-sm border-2 border-ink bg-paper-3 px-2 py-1 text-sm text-ink shadow-offset outline-none focus:border-blue"
                      />
                    </label>
                  ))}
                </div>

                <textarea
                  value={follow.bio}
                  onChange={(e) => setFollow((f) => ({ ...f, bio: e.target.value }))}
                  rows={2}
                  aria-label="Account bio"
                  placeholder={'The line under the name\nA second line, e.g. a contact'}
                  className="w-full resize-y rounded-wobble-sm border-2 border-ink bg-paper-3 px-3 py-2 text-sm text-ink shadow-offset outline-none placeholder:text-ink-faint focus:border-blue"
                />

                <Swatches
                  label="Card colour"
                  value={follow.bg}
                  onPick={(fill) => setFollow((f) => ({ ...f, bg: fill }))}
                />
                <div className="flex flex-wrap items-center gap-2 border-t-2 border-dashed border-pencil pt-3">
                  <SketchButton
                    variant="secondary"
                    loading={saveBrand.isPending}
                    onClick={() =>
                      // Everything except the two that belong to this session:
                      // whether the slide is switched on, and the brief that
                      // drew the logo.
                      saveBrand.mutate({
                        logoUrl: follow.logoUrl,
                        card: {
                          headline: follow.headline,
                          name: follow.name,
                          verified: follow.verified,
                          posts: follow.posts,
                          followers: follow.followers,
                          following: follow.following,
                          bio: follow.bio,
                          bg: follow.bg,
                        },
                      })
                    }
                  >
                    <Save className="h-4 w-4" strokeWidth={2} /> Update
                  </SketchButton>
                  <span className="micro text-[0.58rem] text-ink-faint">
                    Keeps this card — logo, name, counts, bio — as the starting point for every
                    carousel from now on.
                  </span>
                </div>
                <p className="micro text-[0.58rem] text-ink-faint">
                  Until you Update it, the card describes this site and the AI rewrites the headline
                  for whatever the carousel is about. Everything here is yours to overwrite.
                </p>
              </>
            )}
          </SketchCard>
          )}

          {/* design */}
          {section === 'design' && (
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
            </div>
            <Swatches
              label="Band colour"
              value={design.bandFill}
              onPick={(fill) => setDesign((d) => ({ ...d, bandFill: fill }))}
            />
            <div className="flex flex-wrap items-center gap-2">
              <span className="micro w-28 shrink-0 text-[0.6rem] text-ink-soft">Band finish</span>
              <div className="flex flex-1 flex-wrap items-center gap-1.5">
                {FINISHES.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setDesign((d) => ({ ...d, bandFinish: f.id }))}
                    aria-pressed={design.bandFinish === f.id}
                    title={f.hint}
                    className={cn(
                      'micro rounded-wobble-sm border-2 px-2 py-1 text-[0.6rem] font-bold transition-colors',
                      design.bandFinish === f.id
                        ? 'border-ink bg-yellow text-ink shadow-offset'
                        : 'border-dashed border-pencil text-ink-soft hover:border-ink hover:text-ink',
                    )}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
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
          )}

          {/* colour the words */}
          {section === 'words' && (
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
            <div className="flex flex-wrap items-center gap-2 border-t-2 border-dashed border-pencil pt-3">
              <span className="micro w-full text-[0.6rem] text-ink-soft">
                Let the AI pick the keywords in…
              </span>
              {(
                [
                  { scope: 'title' as const, label: 'The title' },
                  { scope: 'subtitle' as const, label: 'The subtitle' },
                  { scope: 'both' as const, label: 'Both' },
                ]
              ).map((b) => (
                <SketchButton
                  key={b.scope}
                  variant={b.scope === 'both' ? 'accent' : 'secondary'}
                  loading={highlight.isPending && highlight.variables?.scope === b.scope}
                  disabled={
                    highlight.isPending ||
                    slides.every((s) => !s.title.trim() && !s.subtitle.trim())
                  }
                  onClick={() => void runHighlight(b.scope)}
                >
                  <Sparkles className="h-4 w-4" strokeWidth={2.5} /> {b.label}
                  {quote.data ? ` — ${quote.data.highlight} 🪙` : ''}
                </SketchButton>
              ))}
            </div>
            <p className="micro text-[0.58rem] text-ink-faint">
              The AI reads every card and paints the words that carry it —{' '}
              <span className="font-bold" style={{ color: accent }}>
                in the swatch you have in hand
              </span>
              . Repainting one half leaves the other exactly as you left it, and the whole carousel
              gets this the moment it is written. To change one word yourself, pick a colour and
              click it in the preview.
            </p>
          </SketchCard>
          )}

          {/* publish and export */}
          {section === 'share' && (
          <SketchCard className="flex flex-col gap-3 p-5">
            <div className="flex flex-col gap-2">
              <span className="micro flex items-center gap-1.5 text-[0.6rem] font-semibold text-ink-soft">
                <Send className="h-3.5 w-3.5" strokeWidth={2} /> Put it on the feed
              </span>
              <textarea
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                rows={2}
                aria-label="Post caption"
                placeholder="The caption under the post — the first line becomes its address"
                className="w-full resize-y rounded-wobble-sm border-2 border-ink bg-paper-3 px-3 py-2 text-sm text-ink shadow-offset outline-none placeholder:text-ink-faint focus:border-blue"
              />
              <div className="flex flex-wrap items-center gap-2">
                <SketchButton
                  variant="accent"
                  loading={posting}
                  disabled={caption.trim().length === 0}
                  onClick={() => void publish()}
                >
                  <Send className="h-4 w-4" strokeWidth={2.5} /> Post {total} slide
                  {total === 1 ? '' : 's'}
                </SketchButton>
                <span className="micro text-[0.58rem] text-ink-faint">
                  Filed under {TEMPLATE_META[category].label}. Publishing is free — the pictures
                  are already paid for.
                </span>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 border-t-2 border-dashed border-pencil pt-3">
              <SketchButton variant="accent" loading={busy} onClick={() => void download(false)}>
                <Download className="h-4 w-4" strokeWidth={2.5} /> Download slide
              </SketchButton>
              <SketchButton
                variant="secondary"
                loading={busy}
                disabled={total < 2}
                onClick={() => void download(true)}
              >
                <Download className="h-4 w-4" strokeWidth={2} /> Download all {total} as a zip
              </SketchButton>
              <span className="micro text-[0.58rem] text-ink-faint">
                PNG · {OUT_W} × {outH}
              </span>
              {confirm.muted && (
                <button
                  type="button"
                  onClick={() => confirm.setMuted(false)}
                  className="micro ml-auto rounded-wobble-sm border-2 border-dashed border-pencil px-2 py-1 text-[0.58rem] font-bold text-ink-soft hover:border-ink hover:text-ink"
                >
                  Cost reminders are off — turn them back on
                </button>
              )}
            </div>
          </SketchCard>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * One wrapped run of words — every word its own clickable target.
 *
 * The gap between two words is its own element with white-space:pre. A space
 * left at the end of an inline-block (which is what a <button> is) gets
 * trimmed by the browser, and that is what ran the caption together into
 * "UPGRADEYOUR" while the canvas export, which measures its own spaces,
 * looked fine.
 */
function WordRun({
  lines,
  words,
  tints,
  ink,
  fontSize,
  lineHeight,
  upper,
  onPaint,
}: {
  lines: number[][];
  words: string[];
  tints: Record<number, string>;
  ink: string;
  fontSize: string;
  lineHeight: number;
  upper: boolean;
  onPaint: (wordIndex: number) => void;
}) {
  return (
    <>
      {lines.map((lineWords, li) => (
        <div key={li} className="whitespace-nowrap text-center" style={{ fontSize, lineHeight }}>
          {lineWords.map((j, k) => (
            <span key={j}>
              <button
                type="button"
                onClick={() => onPaint(j)}
                title={`Paint "${words[j]}"`}
                className={cn(
                  'cursor-pointer bg-transparent p-0 hover:opacity-70',
                  upper && 'uppercase',
                )}
                style={{
                  color: tints[j] || ink,
                  font: 'inherit',
                  fontSize: 'inherit',
                  lineHeight: 'inherit',
                }}
              >
                {words[j]}
              </button>
              {k < lineWords.length - 1 && <span style={{ whiteSpace: 'pre' }}> </span>}
            </span>
          ))}
        </div>
      ))}
    </>
  );
}

/** A row of preset colours plus a mixer, for anything that takes a fill. */
function Swatches({
  label,
  value,
  onPick,
}: {
  label: string;
  value: string;
  onPick: (fill: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="micro w-28 shrink-0 text-[0.6rem] text-ink-soft">{label}</span>
      <div className="flex flex-1 flex-wrap items-center gap-1.5">
        {BAND_PRESETS.map((b) => (
          <button
            key={b.label}
            type="button"
            onClick={() => onPick(b.fill)}
            aria-label={b.label}
            aria-pressed={value === b.fill}
            title={b.label}
            className={cn(
              'h-7 w-7 rounded-full border-2 transition-transform hover:scale-110',
              value === b.fill ? 'border-ink ring-2 ring-blue' : 'border-pencil',
            )}
            style={{ backgroundColor: b.fill }}
          />
        ))}
        <label
          title="Mix any other colour"
          className="flex h-7 cursor-pointer items-center gap-1 rounded-wobble-sm border-2 border-dashed border-pencil px-1.5 text-ink-soft hover:border-ink hover:text-ink"
        >
          <Palette className="h-3.5 w-3.5" strokeWidth={2} />
          <input
            type="color"
            aria-label={`Custom ${label.toLowerCase()}`}
            value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#0B0B0B'}
            onChange={(e) => onPick(e.target.value)}
            className="h-5 w-6 cursor-pointer border-0 bg-transparent p-0"
          />
        </label>
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
      <CostConfirmProvider>
        <MarketingBody />
      </CostConfirmProvider>
    </AdminGate>
  );
}
