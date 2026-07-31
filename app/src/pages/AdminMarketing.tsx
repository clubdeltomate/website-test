import { useEffect, useMemo, useRef, useState } from 'react';
import {
  BadgeCheck,
  ChevronLeft,
  ChevronRight,
  Download,
  Eraser,
  Eye,
  Image as ImageIcon,
  Check,
  Layers,
  Music,
  Paperclip,
  Palette,
  Plus,
  RefreshCw,
  Save,
  Send,
  Sigma,
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
import { trimBars } from '@/lib/trim-bars';
import {
  POST_CATEGORIES,
  POST_VISIBILITY,
  VISIBILITY_BRIEF,
  VISIBILITY_LABEL,
  type PostCategory,
  type PostVisibility,
} from '@contracts/post';
import { LANGUAGES } from '@contracts/languages';
import { MAX_IN_FRAME } from '@contracts/cast';
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
  { id: 'music' as const, label: 'Music', icon: Music },
  { id: 'share' as const, label: 'Post', icon: Send },
];
type SectionId = (typeof SECTIONS)[number]['id'];

/**
 * What a carousel is made of.
 *
 * "Photos" is the marketing carousel this tool started as. "Working" solves a
 * problem across the slides instead — the maths set large on the card, the
 * plain-language line for that step in the band underneath, and a closing
 * card naming the formula. Same band, same words, same export; only what
 * fills the picture area changes.
 */
const MODES = [
  { id: 'photos' as const, label: 'Pictures', icon: ImageIcon },
  { id: 'math' as const, label: 'Working', icon: Sigma },
];
type ModeId = (typeof MODES)[number]['id'];

interface Slide {
  id: string;
  imageUrl: string | null;
  imagePrompt: string;
  /** names of the cast members this slide's picture shows */
  cast: string[];
  /** lines of working, set on the card itself — a "working" carousel only */
  steps: string[];
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

/**
 * The most a rendered slide may weigh on its way to the feed.
 *
 * The upload endpoint takes a data URL and stops at four million characters,
 * which is the serverless request cap wearing a different hat. A 1080×1920
 * PNG of a photograph goes past it easily — PNG does not compress photographs
 * — so publishing a carousel of real pictures used to fail outright.
 */
const UPLOAD_MAX = 4_000_000;

/**
 * A slide encoded small enough to publish.
 *
 * JPEG rather than PNG: the same picture lands at a fraction of the size with
 * nothing visible lost at this width, which is what every social network does
 * to it on the way in anyway. Quality steps down only if the first pass is
 * still too heavy. Downloads stay PNG — that copy is yours to keep.
 */
function uploadDataUrl(canvas: HTMLCanvasElement): string {
  for (const quality of [0.92, 0.82, 0.7, 0.55]) {
    const url = canvas.toDataURL('image/jpeg', quality);
    if (url.length <= UPLOAD_MAX) return url;
  }
  throw new Error('That slide is too detailed to publish — try a smaller format');
}

const newSlide = (n: number): Slide => ({
  id: `s${n}-${Math.random().toString(36).slice(2, 8)}`,
  imageUrl: null,
  imagePrompt: '',
  cast: [],
  steps: [],
  title: '',
  subtitle: '',
  titleTints: {},
  subTints: {},
});

/* ------------------------------------------------------------------ */
/* Working slides: the maths on the card                               */
/* ------------------------------------------------------------------ */

/**
 * The paper a worked step is set on, and the ink it is set in.
 *
 * Deliberately not a photograph: a page of working wants to look like a page
 * of working. The band underneath keeps whatever colour and finish the rest
 * of the carousel uses, so a solution still looks like it came from the same
 * account as the pictures.
 */
const MATH_PAPER = '#FFFDF6';
const MATH_INK = '#12294B';

/** Space the working gets: everything above the band, less a margin. */
const MATH_PAD = 90;

interface StepLayout {
  lines: string[];
  size: number;
  lineH: number;
  top: number;
}

/**
 * Lay the working out above the band.
 *
 * One function for the preview and the export, like everything else here.
 * The size comes down until the lines fit the space the band leaves — a
 * six-step page on a square post gets smaller type, and nothing runs off the
 * card or under the band.
 */
function layoutSteps(
  steps: string[],
  measure: CanvasRenderingContext2D | null,
  bandTop: number,
): StepLayout {
  const empty: StepLayout = { lines: [], size: 0, lineH: 0, top: 0 };
  const text = steps.map((s) => s.trim()).filter(Boolean);
  if (!measure || text.length === 0) return empty;
  const maxW = OUT_W - MATH_PAD * 2;
  const room = Math.max(200, bandTop - MATH_PAD * 2);

  for (let size = 74; size >= 26; size -= 2) {
    measure.font = `700 ${size}px ${FONT}`;
    const lines: string[] = [];
    let tooWide = false;
    for (const line of text) {
      if (measure.measureText(line).width <= maxW) {
        lines.push(line);
        continue;
      }
      // A step too long for one line is broken on spaces rather than
      // shrunk further — a wrapped equation still reads, a tiny one doesn't.
      const words = line.split(/\s+/);
      let cur = '';
      for (const w of words) {
        const next = cur ? `${cur} ${w}` : w;
        if (measure.measureText(next).width <= maxW) cur = next;
        else if (cur) {
          lines.push(cur);
          cur = w;
        } else {
          tooWide = true;
          cur = w;
        }
      }
      if (cur) lines.push(cur);
    }
    const lineH = size * 1.55;
    if (!tooWide && lines.length * lineH <= room) {
      return { lines, size, lineH, top: MATH_PAD + (room - lines.length * lineH) / 2 };
    }
    if (size === 26) {
      return { lines, size, lineH, top: MATH_PAD };
    }
  }
  return empty;
}


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
  /** null = let the AI decide how many it takes */
  const [slideCount, setSlideCount] = useState<number | null>(5);
  const [mode, setMode] = useState<ModeId>('photos');
  /** a photo or a text file the writer should read first */
  const [attachment, setAttachment] = useState<{
    kind: 'image' | 'text';
    label: string;
    data: string;
    name: string;
  } | null>(null);
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
  /** Who the post is for, and — when that is "assigned" — exactly whom. */
  const [who, setWho] = useState<PostVisibility>('public');
  const [sendTo, setSendTo] = useState<number[]>([]);
  const [sending, setSending] = useState(false);
  const [userQuery, setUserQuery] = useState('');
  const [modelNote, setModelNote] = useState('');
  const [reading, setReading] = useState(false);
  /* The soundtrack. Held as an id as well as a URL because publishing hands
     the post the id, and the URL is only how the player fetches it. */
  const [musicPrompt, setMusicPrompt] = useState('');
  const [musicSeconds, setMusicSeconds] = useState(30);
  const [music, setMusic] = useState<{ id: number; url: string; seconds: number } | null>(null);
  const [composing, setComposing] = useState(false);
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
  /** The one model this account has made from a photograph, if it has. */
  const ownModel = useMemo(() => roster.find((m) => m.custom) ?? null, [roster]);
  /* Looked up across the whole roster rather than the pool: a slide can name
     someone directly in its own picker without them being cast for the
     carousel, and that choice has to reach the prompt. */
  const sheetsFor = (names: string[]) => {
    const want = names.map((n) => n.trim().toLowerCase());
    return roster
      .filter((m) => want.includes(m.name.trim().toLowerCase()))
      .map((m) => ({ name: m.name, headline: m.headline, sheet: m.sheet }));
  };

  /* Everyone who could be sent a post. Only fetched once the audience is
     actually "assigned" — the feed does not need a user list to publish. */
  const directory = trpc.users.directory.useQuery(
    { q: userQuery.trim() || undefined },
    { enabled: sending },
  );

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
  const stepLayout = useMemo(
    () => layoutSteps(slide.steps, measureRef.current, layout.bandY),
    [slide.steps, layout.bandY],
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

  /**
   * Read a file the AI should see first.
   *
   * A picture goes to the vision model as bytes; anything the browser will
   * hand over as text is pasted into the brief. Nothing else is accepted —
   * a PDF read as text is line noise, and pretending otherwise would send
   * the AI a page of nonsense and charge for it.
   */
  const attachFile = async (file: File) => {
    if (file.size > 3_000_000) return toast.error('That file is over 3 MB — try a smaller one');
    const isImage = file.type.startsWith('image/');
    const isText = file.type.startsWith('text/') || /\.(txt|md|csv|json)$/i.test(file.name);
    if (!isImage && !isText) {
      return toast.error('Attach a picture, or a text file (.txt, .md, .csv, .json)');
    }
    try {
      if (isImage) {
        const url = await new Promise<string>((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve(String(r.result));
          r.onerror = () => reject(new Error('unreadable'));
          r.readAsDataURL(file);
        });
        const m = /^data:(image\/[a-z+.-]+);base64,(.+)$/s.exec(url);
        if (!m) throw new Error('unreadable');
        setAttachment({ kind: 'image', label: m[1], data: m[2], name: file.name });
      } else {
        const text = await file.text();
        setAttachment({ kind: 'text', label: file.name, data: text.slice(0, 12_000), name: file.name });
      }
      toast.success(`${file.name} attached — the AI will read it`);
    } catch {
      toast.error("That file couldn't be read");
    }
  };

  /** The attachment in the shape the endpoints take. */
  const attachmentForApi = () =>
    attachment ? { kind: attachment.kind, label: attachment.label, data: attachment.data } : null;

  /**
   * Work a problem out across the slides.
   *
   * The steps land on the cards, the plain-language line lands in the band,
   * and the closing card explains the formula — which is what the follow
   * card's two lines become when the carousel is a solution rather than an
   * advert.
   */
  const solve = trpc.marketing.mathboard.useMutation({
    onSuccess: (r) => {
      setSlides(
        r.slides.map((s, i) => ({
          ...newSlide(i + 1),
          title: s.title,
          subtitle: s.note,
          steps: s.steps,
          titleTints: {},
          subTints: {},
        })),
      );
      setActive(0);
      if (r.footer.title || r.footer.blurb) {
        setFollow((f) => ({
          ...f,
          headline: r.footer.title || f.headline,
          bio: r.footer.blurb || f.bio,
        }));
      }
      toast.success(
        `Solved in ${r.slides.length} slide${r.slides.length === 1 ? '' : 's'}${r.answer ? ` — ${r.answer}` : ''} · ${r.cost} 🪙`,
      );
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

  /**
   * A drawn backdrop, with any flat bar the generator padded it with cut off.
   *
   * A padded picture is the one way a photograph can fail to reach the bottom
   * of the caption band: cover-fitting keeps the bar, and the bar lands right
   * where the band begins. Cutting it here means every later use — the
   * preview, the PNG, the published post — gets the clean picture, whatever
   * height the band happens to be. A picture with no bar is left alone and
   * costs nothing extra.
   */
  const cleanBackdrop = async (url: string): Promise<string> => {
    try {
      const cut = await trimBars(url);
      if (!cut?.trimmed) return url;
      const r = await utils.client.posts.uploadSlide.mutate({
        image: uploadDataUrl(cut.canvas),
      });
      return `/api/img/${r.id}`;
    } catch {
      return url; // never lose a picture we already paid for
    }
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
      // The cast comes back with the picture: who the generator was actually
      // told to put in it, which is who is in it. The chips then describe the
      // image that exists rather than the one that was asked for.
      patch(i, { imageUrl: await cleanBackdrop(r.url), cast: r.cast });
      toast.success(
        `Backdrop drawn — ${r.cost} 🪙${r.cast.length ? ` · ${r.cast.join(', ')}` : ''}`,
      );
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
        patch(i, { imageUrl: await cleanBackdrop(r.url), cast: r.cast });
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
    ctx.fillStyle = mode === 'math' ? MATH_PAPER : '#F4EBD6';
    ctx.fillRect(0, 0, OUT_W, outH);

    if (mode === 'math') {
      // A faint rule down the left, the way working is written on paper.
      ctx.strokeStyle = 'rgba(18,41,75,0.14)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(MATH_PAD * 0.55, 0);
      ctx.lineTo(MATH_PAD * 0.55, outH);
      ctx.stroke();
    }

    if (mode === 'photos' && s.imageUrl) {
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

    if (mode === 'math') {
      const steps = layoutSteps(s.steps, measureRef.current, L.bandY);
      ctx.fillStyle = MATH_INK;
      ctx.textBaseline = 'middle';
      ctx.font = `700 ${steps.size}px ${FONT}`;
      let y = steps.top;
      for (const line of steps.lines) {
        ctx.fillText(line, (OUT_W - ctx.measureText(line).width) / 2, y + steps.lineH / 2);
        y += steps.lineH;
      }
    }

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
          image: uploadDataUrl(canvas),
        });
        imageIds.push(r.id);
      }
      const r = await utils.client.posts.create.mutate({
        caption: caption.trim(),
        category,
        imageIds,
        width: OUT_W,
        height: outH,
        audioId: music?.id ?? null,
        visibility: who,
        assignedUserIds: sendTo,
      });
      toast.success(
        who === 'public'
          ? sendTo.length
            ? `Posted to the feed, and sent to ${sendTo.length} ✓`
            : 'Posted to the feed ✓'
          : sendTo.length
            ? `Posted — you and ${sendTo.length} ${sendTo.length === 1 ? 'other' : 'others'} ✓`
            : 'Posted — only you can see it ✓',
      );
      // Onto the feed standing on what was just posted, not onto a page of
      // its own — you should be able to carry on scrolling from there.
      navigate(`/feed?post=${encodeURIComponent(r.slug)}`);
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
      toast.success('Model deleted — you can read a new photo now');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "That model couldn't be removed");
    }
  };

  /** What a bed of this length costs, scaled off the quoted thirty seconds. */
  const musicCost =
    quote.data == null ? null : Math.max(1, Math.ceil((quote.data.music * musicSeconds) / 30));

  /**
   * Compose the music that plays under the carousel on the feed.
   *
   * Charged in coins like everything else the tool makes, whoever is asking —
   * the API call costs the same whether an admin or anyone else makes it.
   */
  const composeMusic = async () => {
    const prompt = musicPrompt.trim();
    if (prompt.length < 3) return toast.error('Say what the music should sound like first');
    if (!(await confirm.ask(`Composing ${musicSeconds}s of music`, musicCost ?? undefined))) return;
    setComposing(true);
    try {
      const r = await utils.client.marketing.music.mutate({ prompt, seconds: musicSeconds });
      const id = Number(r.url.split('/').pop());
      setMusic({ id, url: r.url, seconds: r.seconds });
      toast.success(`Music composed — ${r.cost} 🪙`);
      void utils.auth.me.invalidate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "That music couldn't be composed");
    } finally {
      setComposing(false);
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
    /* The whole tool inside the window.
     *
     * It is a workbench, not a document: the preview on the left has to stay
     * in sight of the panel on the right, and scrolling the page moved one
     * away from the other. So the page takes the window's height, the
     * preview shrinks to whatever is left after the header, and each column
     * scrolls inside itself. Below lg it goes back to being an ordinary
     * scrolling page — there is no room to keep two things in view on a
     * phone, and pretending otherwise only makes both of them tiny. */
    <div className="mx-auto flex w-full max-w-content flex-col gap-3 px-4 py-4 lg:h-full lg:min-h-0 lg:px-8">
      <SketchToaster />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <HubHeader
          backTo="/admin/projects"
          backLabel="Projects"
          title="Marketing"
          blurb="Write a carousel, draw its pictures, set the words — then post it."
        />
        <MarketingTabs />
      </div>

      <div className="grid gap-6 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
        {/* ---------------- preview + carousel strip ---------------- */}
        <div className="flex flex-col gap-3 lg:min-h-0">
          <div
            className="relative mx-auto w-full max-w-[340px] overflow-hidden rounded-wobble-sm border-2 border-ink bg-paper-2 shadow-offset [container-type:inline-size] lg:w-auto lg:min-h-0 lg:flex-1"
            style={{
              aspectRatio: `${OUT_W} / ${outH}`,
              // Never wider than the column: cap the height at the one that
              // makes a 340px-wide frame, and let a short window shrink it.
              maxHeight: `${Math.round((340 * outH) / OUT_W)}px`,
            }}
          >
            {onFollow && <FollowPreview card={follow} layout={followLayout} />}
            {!onFollow && mode === 'math' && (
              /* The working, laid out by the same function the PNG uses, so
                 what is arranged here is what is exported. */
              <div className="absolute inset-0" style={{ background: MATH_PAPER }}>
                <div
                  className="absolute inset-y-0"
                  style={{
                    left: cq(MATH_PAD * 0.55),
                    width: '2px',
                    background: 'rgba(18,41,75,0.14)',
                  }}
                />
                <div
                  className="absolute left-0 right-0 flex flex-col"
                  style={{
                    top: cq(stepLayout.top),
                    fontFamily: FONT,
                    fontWeight: 700,
                    color: MATH_INK,
                  }}
                >
                  {stepLayout.lines.map((line, i) => (
                    <span
                      key={`${line}-${i}`}
                      className="block text-center"
                      style={{
                        fontSize: cq(stepLayout.size),
                        lineHeight: cq(stepLayout.lineH),
                        height: cq(stepLayout.lineH),
                      }}
                    >
                      {line}
                    </span>
                  ))}
                  {stepLayout.lines.length === 0 && (
                    <span
                      className="block px-6 text-center"
                      style={{ fontSize: cq(34), color: 'rgba(18,41,75,0.45)' }}
                    >
                      The working goes here.
                    </span>
                  )}
                </div>
              </div>
            )}
            {!onFollow &&
              mode === 'photos' &&
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
            {!onFollow && mode === 'photos' && slide.imagePrompt.trim().length > 2 && (
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
        <div className="flex flex-col gap-3 lg:min-h-0">
          {/* One panel at a time. The whole editor used to be a single column
              you scrolled, which meant changing a colour at the bottom and
              scrolling back to the top to see what it did. The menu stays
              put; only the panel under it scrolls, and only when its own
              contents are taller than the window. */}
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

          {/* Only the open panel scrolls, and only when it has to — the menu
              above it stays where you left it. data-lenis-prevent hands the
              wheel back to this box: the site's smooth scroll owns the wheel
              by default and scrolls the page with it, and this page has no
              page to scroll, so without it the wheel did nothing at all over
              a panel taller than the window. */}
          <div
            data-lenis-prevent
            className="flex flex-col gap-4 lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:pb-1 lg:pr-1"
          >
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
                  {/* One at a time: a model read out of a photograph is a
                      likeness of a real person, so this account holds exactly
                      one and swapping it means deleting the one it has. */}
                  <label
                    title={
                      ownModel
                        ? `${ownModel.name} was made from a photo — delete them to make another`
                        : 'Read a photo into a reusable cast member'
                    }
                    className={cn(
                      'micro cursor-pointer rounded-wobble-sm border-2 border-dashed border-pencil px-2 py-1 text-[0.6rem] font-bold text-ink-soft hover:border-ink hover:text-ink',
                      (reading || !!ownModel) && 'pointer-events-none opacity-50',
                    )}
                  >
                    <Upload className="mr-1 inline h-3 w-3" strokeWidth={2} />
                    {reading
                      ? 'Reading the photo…'
                      : ownModel
                        ? `Photo model: ${ownModel.name}`
                        : 'New model from a photo'}
                    {!ownModel && quote.data ? ` — 1 🪙` : ''}
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      disabled={!!ownModel}
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
                  carousel you make, which is what keeps a feed looking like one feed. A model read
                  out of a photograph is yours alone and you may hold one at a time — delete{' '}
                  {ownModel ? ownModel.name : 'it'} to make another.
                </p>
              </>
            )}
          </SketchCard>
          )}

          {/* the story */}
          {section === 'story' && (
          <SketchCard className="flex flex-col gap-3 p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="micro flex items-center gap-1.5 text-[0.6rem] font-semibold text-ink-soft">
                <Wand2 className="h-3.5 w-3.5" strokeWidth={2} />
                {mode === 'math' ? 'The problem' : 'The story'}
              </span>
              {/* Two kinds of carousel out of the same parts: pictures with
                  captions, or a problem worked out across the slides. */}
              <div className="flex overflow-hidden rounded-wobble-sm border-2 border-ink shadow-offset">
                {MODES.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setMode(m.id)}
                    aria-pressed={mode === m.id}
                    className={cn(
                      'micro flex items-center gap-1 px-2.5 py-1 text-[0.6rem] font-bold transition-colors',
                      mode === m.id ? 'bg-yellow text-ink' : 'bg-paper-3 text-ink-soft hover:text-ink',
                    )}
                  >
                    <m.icon className="h-3 w-3" strokeWidth={2} />
                    {m.label}
                  </button>
                ))}
              </div>
            </div>
            <textarea
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              rows={2}
              aria-label={mode === 'math' ? 'The problem' : 'Carousel subject'}
              placeholder={
                mode === 'math'
                  ? 'What should it solve? e.g. integrate x·e^x dx, or balance Fe + O2 -> Fe2O3'
                  : 'What should the carousel explain? e.g. how to brew great coffee at home'
              }
              className="w-full resize-y rounded-wobble-sm border-2 border-ink bg-paper-3 px-3 py-2 text-sm text-ink shadow-offset outline-none placeholder:text-ink-faint focus:border-blue"
            />
            {/* Something for the AI to read first — a photograph of the
                problem, a menu, a page of notes. An image goes to the vision
                model; a text file is pasted into the brief. */}
            <div className="flex flex-wrap items-center gap-2">
              <label className="micro cursor-pointer rounded-wobble-sm border-2 border-dashed border-pencil px-2 py-1 text-[0.6rem] font-bold text-ink-soft hover:border-ink hover:text-ink">
                <Paperclip className="mr-1 inline h-3 w-3" strokeWidth={2} />
                {attachment ? 'Replace the file' : 'Attach a file for context'}
                <input
                  type="file"
                  accept="image/*,text/*,.txt,.md,.csv,.json"
                  className="hidden"
                  aria-label="Attach a file for context"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void attachFile(file);
                    e.target.value = '';
                  }}
                />
              </label>
              {attachment && (
                <span className="micro flex items-center gap-1.5 rounded-wobble-sm border-2 border-ink bg-yellow-soft px-2 py-1 text-[0.58rem] font-bold text-ink">
                  {attachment.kind === 'image' ? 'Photo' : 'Notes'}: {attachment.name}
                  <button
                    type="button"
                    onClick={() => setAttachment(null)}
                    aria-label="Remove the attachment"
                    className="text-ink-faint hover:text-red"
                  >
                    <Trash2 className="h-3 w-3" strokeWidth={2} />
                  </button>
                </span>
              )}
            </div>
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
              {/* How many slides, or nobody's guess — which is the honest
                  answer when you do not yet know how much explaining the
                  subject takes. A worked problem is always the AI's call:
                  the number of steps is part of the answer. */}
              {/* A div, not a label: a <button> inside a <label> takes its
                  accessible name from the label, so this one announced itself
                  as "Slides" instead of what it does. */}
              <div className="micro flex items-center gap-1.5 text-[0.6rem] text-ink-soft">
                <span>Slides</span>
                <button
                  type="button"
                  onClick={() => setSlideCount((c) => (c == null ? 5 : null))}
                  aria-pressed={slideCount == null}
                  disabled={mode === 'math'}
                  title="Let the AI use as many slides as the subject needs"
                  className={cn(
                    'micro rounded-wobble-sm border-2 px-2 py-1 text-[0.58rem] font-bold transition-colors disabled:opacity-60',
                    slideCount == null || mode === 'math'
                      ? 'border-ink bg-yellow text-ink shadow-offset'
                      : 'border-dashed border-pencil text-ink-soft hover:border-ink hover:text-ink',
                  )}
                >
                  AI decides
                </button>
                {slideCount != null && mode !== 'math' && (
                  <input
                    type="number"
                    min={2}
                    max={10}
                    value={slideCount}
                    onChange={(e) =>
                      setSlideCount(Math.max(2, Math.min(10, Number(e.target.value) || 5)))
                    }
                    aria-label="Slide count"
                    className="w-16 rounded-wobble-sm border-2 border-ink bg-paper-3 px-2 py-1 text-sm text-ink shadow-offset outline-none focus:border-blue"
                  />
                )}
              </div>
              <SketchButton
                variant="accent"
                loading={storyboard.isPending}
                disabled={topic.trim().length < 3}
                onClick={async () => {
                  if (
                    !(await confirm.ask(
                      mode === 'math' ? 'Working the problem' : 'Writing the carousel',
                      quote.data?.storyboard,
                    ))
                  )
                    return;
                  if (mode === 'math') {
                    solve.mutate({
                      problem: topic.trim(),
                      maxSlides: 8,
                      language,
                      attachment: attachmentForApi(),
                    });
                    return;
                  }
                  storyboard.mutate({
                    topic: topic.trim(),
                    slideCount,
                    format: design.format,
                    category,
                    language,
                    attachment: attachmentForApi(),
                    cast: pickedModels.map((m) => ({
                      name: m.name,
                      headline: m.headline,
                      sheet: m.sheet,
                    })),
                  });
                }}
              >
                <Sparkles className="h-4 w-4" strokeWidth={2.5} />
                {mode === 'math' ? 'Work it out' : 'Write the carousel'}
                {quote.data ? ` — ${quote.data.storyboard} 🪙` : ''}
              </SketchButton>
              {mode === 'photos' && (
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
              )}
            </div>
            <p className="micro text-[0.58rem] text-ink-faint">
              {mode === 'math'
                ? 'The AI solves it and lays the working across as many slides as it takes — the maths on the card, what was done and why in the band under it, and a closing card naming the formula. Everything stays editable below.'
                : 'The AI writes a title, a subtitle and a picture brief for every slide — an opening hook, the steps in order, then a closing card. Everything stays editable below.'}
            </p>
          </SketchCard>
          )}

          {/* this slide */}
          {section === 'slide' && (
          <SketchCard className={cn('flex flex-col gap-3 p-5', onFollow && 'hidden')}>
            <span className="micro flex items-center gap-1.5 text-[0.6rem] font-semibold text-ink-soft">
              <Layers className="h-3.5 w-3.5" strokeWidth={2} /> Slide {active + 1}
            </span>
            {mode === 'math' ? (
              /* The working itself: one line per line on the card. Editable
                 like everything else — the AI is a first draft, and a step
                 you would have written differently is one you can retype. */
              <div className="flex flex-col gap-1.5">
                <span className="micro text-[0.58rem] text-ink-soft">
                  The working — one line each
                </span>
                <textarea
                  value={slide.steps.join('\n')}
                  onChange={(e) =>
                    patch(active, { steps: e.target.value.split('\n').map((l) => l.trimEnd()) })
                  }
                  rows={Math.min(6, Math.max(3, slide.steps.length + 1))}
                  aria-label="The working"
                  placeholder={'∫ x·eˣ dx\nu = x,  dv = eˣ dx\n= x·eˣ − ∫ eˣ dx'}
                  className="w-full resize-y rounded-wobble-sm border-2 border-ink bg-paper-3 px-3 py-2 font-mono text-sm text-ink shadow-offset outline-none placeholder:text-ink-faint focus:border-blue"
                />
                <p className="micro text-[0.55rem] text-ink-faint">
                  Plain text, drawn straight onto the card — × ÷ √ ² π ∫ ∑ ≤ ≥ ≈ → all work. The
                  type shrinks to fit, so a long line still lands on the slide.
                </p>
              </div>
            ) : (
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
            )}
            {mode === 'photos' && (
            <>
            {/* Who is in THIS picture.
                The whole roster, not just the carousel's pool: deciding a
                slide shows Marisol and Theo is a decision you make looking at
                the slide, so picking them here casts them for the carousel
                too rather than sending you to another panel first. As many as
                the frame holds — an empty row is an object shot. */}
            <div className="flex flex-col gap-1.5 border-t-2 border-dashed border-pencil pt-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="micro flex items-center gap-1 text-[0.58rem] font-semibold text-ink-soft">
                  <Users className="h-3 w-3" strokeWidth={2} /> Who is in this picture
                </span>
                {/* Named, not counted. After the AI writes a carousel it has
                    cast every slide for you, and "2 cast" does not tell you
                    who — which is the only thing worth knowing here. */}
                <span className="micro text-[0.55rem] text-ink-faint">
                  {slide.cast.length === 0
                    ? slide.imageUrl
                      ? 'nobody named — whoever is in it, the generator invented'
                      : 'nobody — an object or a place'
                    : slide.cast.join(', ')}
                  {slide.cast.length > MAX_IN_FRAME
                    ? ` — ${MAX_IN_FRAME} of them per picture`
                    : ''}
                </span>
                {slide.cast.length > 0 && (
                  <button
                    type="button"
                    onClick={() => patch(active, { cast: [] })}
                    className="micro text-[0.55rem] font-bold text-ink-faint hover:text-red"
                  >
                    clear
                  </button>
                )}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {roster.map((m) => {
                  const on = slide.cast.some((n) => n.toLowerCase() === m.name.toLowerCase());
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => {
                        patch(active, {
                          cast: on
                            ? slide.cast.filter((n) => n.toLowerCase() !== m.name.toLowerCase())
                            : [...slide.cast, m.name],
                        });
                        // Casting someone on a slide casts them for the
                        // carousel — the pool is what the AI draws from when
                        // it writes the rest, and it should know.
                        if (!on) setPicked((p) => (p.includes(m.id) ? p : [...p, m.id]));
                      }}
                      aria-pressed={on}
                      // Spelled out: the chip's own text is the initials in
                      // the avatar followed by the name, which reads badly.
                      aria-label={`${m.name} — ${on ? 'in this picture' : 'not in this picture'}`}
                      title={`${m.name} — ${m.headline}`}
                      className={cn(
                        'flex items-center gap-1.5 rounded-wobble-sm border-2 py-0.5 pl-0.5 pr-2 transition-colors',
                        on
                          ? 'border-ink bg-yellow text-ink shadow-offset'
                          : 'border-dashed border-pencil text-ink-soft opacity-60 hover:border-ink hover:text-ink hover:opacity-100',
                      )}
                    >
                      <span
                        className={cn(
                          'flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-full border-2 bg-paper-2 font-heading text-[0.5rem] font-bold text-ink',
                          on ? 'border-ink ring-2 ring-ink' : 'border-pencil',
                        )}
                      >
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
                      <span className="micro text-[0.58rem] font-bold">{m.name}</span>
                      {on && <Check className="h-3 w-3 shrink-0" strokeWidth={3} />}
                    </button>
                  );
                })}
                {/* Somebody the AI named who is not on the roster — shown
                    rather than dropped, so a cast that silently means nothing
                    to the generator is visible instead of invisible. */}
                {slide.cast
                  .filter((n) => !roster.some((m) => m.name.toLowerCase() === n.toLowerCase()))
                  .map((n) => (
                    <button
                      key={`ghost-${n}`}
                      type="button"
                      onClick={() =>
                        patch(active, { cast: slide.cast.filter((x) => x !== n) })
                      }
                      title={`${n} isn't one of your models — the generator has no description for them. Click to remove.`}
                      className="micro flex items-center gap-1 rounded-wobble-sm border-2 border-dashed border-red px-2 py-0.5 text-[0.58rem] font-bold text-red"
                    >
                      {n} <Trash2 className="h-3 w-3" strokeWidth={2} />
                    </button>
                  ))}
              </div>
              <p className="micro text-[0.55rem] text-ink-faint">
                Everyone chosen here is in the picture — the generator is told how many people to
                fit and held to it, so two names means two faces, both looking like themselves.
                Past {MAX_IN_FRAME} it draws {MAX_IN_FRAME} of them at random, because more than
                that in one frame is where a generator starts blending faces. Say who is in the
                shot in the brief above too, then redraw.
              </p>
            </div>
            </>
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

          {/* the soundtrack */}
          {section === 'music' && (
          <SketchCard className="flex flex-col gap-3 p-5">
            <span className="micro flex items-center gap-1.5 text-[0.6rem] font-semibold text-ink-soft">
              <Music className="h-3.5 w-3.5" strokeWidth={2} /> Music under the carousel
            </span>
            <textarea
              value={musicPrompt}
              onChange={(e) => setMusicPrompt(e.target.value)}
              rows={2}
              aria-label="Music brief"
              placeholder="What should it sound like? e.g. warm lo-fi beat, soft rhodes, unhurried"
              className="w-full resize-y rounded-wobble-sm border-2 border-ink bg-paper-3 px-3 py-2 text-sm text-ink shadow-offset outline-none placeholder:text-ink-faint focus:border-blue"
            />
            <div className="flex flex-wrap items-center gap-2">
              {/* Free, and no AI: the carousel already says what it is about. */}
              <button
                type="button"
                disabled={topic.trim().length < 3}
                onClick={() =>
                  setMusicPrompt(
                    `An instrumental bed for a short ${TEMPLATE_META[category].label.toLowerCase()} post about ${topic.trim()}. Warm, modern, understated — it sits under the pictures rather than competing with them.`,
                  )
                }
                className="micro rounded-wobble-sm border-2 border-dashed border-pencil px-2 py-1 text-[0.6rem] font-bold text-ink-soft hover:border-ink hover:text-ink disabled:opacity-40"
              >
                Use the carousel's subject
              </button>
              <label className="micro flex items-center gap-1.5 text-[0.6rem] font-semibold text-ink-soft">
                Length
                <select
                  value={musicSeconds}
                  onChange={(e) => setMusicSeconds(Number(e.target.value))}
                  aria-label="Music length"
                  className="rounded-wobble-sm border-2 border-ink bg-paper-3 px-2 py-1 text-[0.7rem] text-ink shadow-offset outline-none focus:border-blue"
                >
                  {[10, 15, 20, 30, 45, 60].map((s) => (
                    <option key={s} value={s}>
                      {s}s
                    </option>
                  ))}
                </select>
              </label>
              <SketchButton
                variant="secondary"
                loading={composing}
                disabled={musicPrompt.trim().length < 3}
                onClick={() => void composeMusic()}
              >
                <Music className="h-4 w-4" strokeWidth={2} />
                {music ? 'Compose again' : 'Compose'}
                {musicCost != null ? ` — ${musicCost} 🪙` : ''}
              </SketchButton>
            </div>
            {music && (
              <div className="flex flex-wrap items-center gap-2 border-t-2 border-dashed border-pencil pt-3">
                <audio
                  src={music.url}
                  controls
                  loop
                  aria-label="The post's music"
                  className="min-w-[220px] flex-1"
                />
                <a
                  href={music.url}
                  download="sketchlearn-post-music.mp3"
                  className="micro rounded-wobble-sm border-2 border-dashed border-pencil px-2 py-1 text-[0.6rem] font-bold text-ink-soft hover:border-ink hover:text-ink"
                >
                  <Download className="mr-1 inline h-3 w-3" strokeWidth={2} /> Download
                </a>
                <button
                  type="button"
                  onClick={() => setMusic(null)}
                  aria-label="Remove the music"
                  className="micro rounded-wobble-sm border-2 border-dashed border-pencil px-2 py-1 text-[0.6rem] font-bold text-ink-soft hover:border-red hover:text-red"
                >
                  <Trash2 className="mr-1 inline h-3 w-3" strokeWidth={2} /> Remove
                </button>
              </div>
            )}
            <p className="micro text-[0.58rem] text-ink-faint">
              Written by ElevenLabs from that brief and posted with the carousel, where it loops
              under the pictures — muted until someone turns it on, which is the only way a
              browser will let a feed make noise. Optional: a post without music simply has none.
              {musicCost != null
                ? ` ${musicSeconds}s costs ${musicCost} 🪙, and it is charged the same to everyone.`
                : ''}
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
              {/* Who it is for. Three states rather than a public switch,
                  because "not public" means two different things: a draft
                  only you see, and something made for particular people. */}
              <div className="flex flex-col gap-2 rounded-wobble-sm border-2 border-dashed border-pencil p-2.5">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="micro flex items-center gap-1 text-[0.58rem] font-semibold text-ink-soft">
                    <Eye className="h-3 w-3" strokeWidth={2} /> Who sees it
                  </span>
                  {POST_VISIBILITY.map((v) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setWho(v)}
                      aria-pressed={who === v}
                      // Named in full: on its own, "Private" is also what a
                      // word in the caption might say.
                      aria-label={`Who sees it: ${VISIBILITY_LABEL[v]}`}
                      title={VISIBILITY_BRIEF[v]}
                      className={cn(
                        'micro rounded-wobble-sm border-2 px-2.5 py-1 text-[0.6rem] font-bold transition-colors',
                        who === v
                          ? 'border-ink bg-yellow text-ink shadow-offset'
                          : 'border-dashed border-pencil text-ink-soft hover:border-ink hover:text-ink',
                      )}
                    >
                      {VISIBILITY_LABEL[v]}
                    </button>
                  ))}
                  <span className="micro text-[0.55rem] text-ink-faint">
                    {VISIBILITY_BRIEF[who]}
                  </span>
                </div>
                {/* Sending is a separate question from being on the feed.
                    Private and sent to one person means only that person and
                    you; public and sent to them puts it in front of them
                    without taking it off the feed. */}
                <div className="flex flex-col gap-1.5 border-t-2 border-dashed border-pencil pt-2">
                  <button
                    type="button"
                    onClick={() => setSending((s) => !s)}
                    aria-expanded={sending}
                    className="micro flex w-fit items-center gap-1.5 text-[0.58rem] font-semibold text-ink-soft hover:text-ink"
                  >
                    <UserPlus className="h-3 w-3" strokeWidth={2} />
                    Also send it to particular people
                    {sendTo.length > 0 ? ` — ${sendTo.length}` : ''}
                    <ChevronRight
                      className={cn('h-3 w-3 transition-transform', sending && 'rotate-90')}
                      strokeWidth={2.5}
                    />
                  </button>
                </div>
                {sending && (
                  <div className="flex flex-col gap-1.5 border-t-2 border-dashed border-pencil pt-2">
                    <input
                      value={userQuery}
                      onChange={(e) => setUserQuery(e.target.value)}
                      aria-label="Find a user"
                      placeholder="Find someone by name"
                      className="w-full rounded-wobble-sm border-2 border-ink bg-paper-3 px-3 py-1.5 text-sm text-ink shadow-offset outline-none placeholder:text-ink-faint focus:border-blue"
                    />
                    <div className="flex max-h-44 flex-wrap gap-1.5 overflow-y-auto">
                      {(directory.data ?? []).map((u) => {
                        const on = sendTo.includes(u.id);
                        return (
                          <button
                            key={u.id}
                            type="button"
                            onClick={() =>
                              setSendTo((s) =>
                                on ? s.filter((x) => x !== u.id) : [...s, u.id],
                              )
                            }
                            aria-pressed={on}
                            className={cn(
                              'flex items-center gap-1.5 rounded-wobble-sm border-2 py-0.5 pl-0.5 pr-2 transition-colors',
                              on
                                ? 'border-ink bg-yellow text-ink shadow-offset'
                                : 'border-dashed border-pencil text-ink-soft hover:border-ink hover:text-ink',
                            )}
                          >
                            <span className="flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-ink bg-paper-2 font-heading text-[0.5rem] font-bold text-ink">
                              {u.avatarUrl ? (
                                <img src={u.avatarUrl} alt="" className="h-full w-full object-cover" />
                              ) : (
                                u.name.slice(0, 1).toUpperCase()
                              )}
                            </span>
                            <span className="micro text-[0.58rem] font-bold">{u.name}</span>
                          </button>
                        );
                      })}
                      {directory.data?.length === 0 && (
                        <span className="micro text-[0.58rem] text-ink-faint">
                          Nobody by that name.
                        </span>
                      )}
                    </div>
                    <p className="micro text-[0.55rem] text-ink-faint">
                      {sendTo.length === 0
                        ? 'Nobody picked — this changes nothing on its own.'
                        : who === 'private'
                          ? `It shows on ${sendTo.length === 1 ? 'their' : 'those'} feed${sendTo.length === 1 ? '' : 's'} and yours, and nowhere else.`
                          : `On the feed for everyone, and put in front of ${sendTo.length} ${sendTo.length === 1 ? 'person' : 'people'} as well.`}
                    </p>
                  </div>
                )}
              </div>
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
                  Filed under {TEMPLATE_META[category].label}
                  {music ? `, with ${music.seconds}s of music` : ''},{' '}
                  {VISIBILITY_LABEL[who].toLowerCase()}
                  {sendTo.length > 0
                    ? `, sent to ${sendTo.length} ${sendTo.length === 1 ? 'person' : 'people'}`
                    : ''}
                  . Publishing is free — the pictures are already paid for.
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
