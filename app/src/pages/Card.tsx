import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CreditCard,
  Download,
  FileText,
  Image as ImageIcon,
  Palette,
  Printer,
  QrCode,
  Pencil,
  Save,
  RotateCcw,
  Trash2,
  Sparkles,
  Upload,
  UserRound,
  Wand2,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { trpc } from '@/providers/trpc';
import { useAuth } from '@/hooks/useAuth';
import SketchToaster from '@/components/admin/SketchToaster';
import SketchButton from '@/components/sketch/SketchButton';
import SketchCard from '@/components/sketch/SketchCard';
import CostConfirmProvider from '@/components/marketing/CostConfirmProvider';
import { useCostConfirm } from '@/components/marketing/cost-confirm';
import CardPreview from '@/components/marketing/CardPreview';
import {
  BACK_LAYOUTS,
  CARD_H,
  CARD_W,
  type BackLayout,
  type BusinessCard,
  type CardSide,
  type PaymentMethod,
  backLayoutOf,
  drawBusinessCard,
  emptyBusinessCard,
  layoutBusinessCard,
} from '@/components/marketing/business-card';
import {
  cardProofPdf,
  cardSheetPdf,
  perSheet,
  sideBySideCanvas,
  type FlipEdge,
} from '@/components/marketing/card-print';
import { saveBlob } from '@/lib/pdf';
import { PAYMENT_KINDS, kindSpec, paymentFilled, paymentUri } from '@/lib/qr';
import type { PostCategory } from '@contracts/post';
import { measureCtx } from '@/lib/caption-words';
import { say } from '@/lib/i18n';

/* Your card.
 *
 * Two of them, really: the one you hand to somebody, and the one that gets
 * you paid. Neither is posted anywhere — a card is a thing you download and
 * print, or show on your profile, which is why this stopped being a tab of
 * the post tool and became its own page.
 *
 * Same machinery as everything else here: one layout function, walked by the
 * preview and by the canvas that downloads, so the print file is the card
 * that was on screen. */

const KINDS = [
  { id: 'business' as const, label: 'Business', icon: CreditCard },
  { id: 'payment' as const, label: 'Payment', icon: QrCode },
];

const SECTIONS = [
  { id: 'who' as const, label: 'Who it is for', icon: UserRound },
  { id: 'pay' as const, label: 'Payments', icon: QrCode },
  { id: 'back' as const, label: 'The back', icon: RotateCcw },
  { id: 'logo' as const, label: 'Logo', icon: ImageIcon },
  { id: 'colour' as const, label: 'Colour', icon: Palette },
];
type SectionId = (typeof SECTIONS)[number]['id'];

/** What comes down when Download is pressed. */
const FORMATS = [
  { id: 'png' as const, label: 'PNG', icon: ImageIcon },
  { id: 'pdf' as const, label: 'PDF', icon: FileText },
  { id: 'sheet' as const, label: 'Print sheet', icon: Printer },
];
type FormatId = (typeof FORMATS)[number]['id'];

/**
 * What the two back text boxes are called, per layout.
 *
 * The same two fields do different jobs on different backs — the contact
 * back has no use for a quote and puts the note under the name — so they are
 * labelled for the job rather than for the field, and a box a layout never
 * reads is simply not shown.
 */
const BACK_FIELDS: Record<BackLayout, { quote: string | null; note: string }> = {
  quote: {
    quote: 'A quote, a promise, what you actually do — the big line on the back',
    note: 'Anything under it — hours, a site, a second address',
  },
  contact: {
    quote: null,
    note: 'A line under your name — hours, a second address, anything',
  },
  payments: {
    quote: 'A line above the list — optional',
    note: 'Anything under the list — optional',
  },
  badge: {
    quote: 'A line under the logo — optional',
    note: 'Anything along the bottom — optional',
  },
};

/** What the back is showing, said plainly, so an empty-looking face makes sense. */
const BACK_HINTS: Record<BackLayout, string> = {
  quote: 'Your name and contact lines are on the front.',
  contact: 'The same name and contact lines as the front, with room to breathe.',
  payments: 'Every way to pay you that the front had no room for.',
  badge: 'Just the mark and the company. Everything else is on the front.',
};

const SWATCHES = [
  '#FFFDF6',
  '#0B0B0B',
  '#12294B',
  '#1E4A32',
  '#6B1D2B',
  '#43214F',
  '#E8D7AE',
  '#CFE8F7',
];
const ACCENTS = ['#B4471F', '#0F6F86', '#5A6231', '#6B1D2B', '#43214F', '#0B0B0B', '#FFC53D'];

const field =
  'w-full rounded-wobble-sm border-2 border-ink bg-paper-3 px-3 py-2 text-sm text-ink shadow-offset outline-none placeholder:text-ink-faint focus:border-blue';

/**
 * A card out of the database, brought up to the shape the code expects.
 *
 * Payment methods used to be one "value" per rail; they are named fields
 * now. A card saved under the old shape still opens, with whatever it had
 * landing in the address box, rather than throwing on the way in.
 */
function normaliseCard(saved: Partial<BusinessCard>): Partial<BusinessCard> {
  const payments = (saved.payments ?? []).map((m) => {
    const legacy = m as PaymentMethod & { value?: string };
    return {
      ...m,
      values: m.values ?? (legacy.value ? { address: legacy.value } : {}),
      qrImage: m.qrImage ?? null,
    };
  });
  return { ...saved, payments };
}

function CardBody() {
  const [card, setCard] = useState<BusinessCard>(emptyBusinessCard);
  const [section, setSection] = useState<SectionId>('who');
  const [side, setSide] = useState<CardSide>('front');
  const [format, setFormat] = useState<FormatId>('png');
  const [flip, setFlip] = useState<FlipEdge>('long');
  const [note, setNote] = useState('');
  const [building, setBuilding] = useState(false);
  const [drawingLogo, setDrawingLogo] = useState(false);
  const { user } = useAuth();
  const confirm = useCostConfirm();
  const utils = trpc.useUtils();
  const quote = trpc.marketing.quote.useQuery();
  const saved = trpc.marketing.card.useQuery();
  const feed = trpc.posts.list.useQuery({ scope: 'all', limit: 60 });

  /** What this account actually posts about — the AI drafts against it. */
  const myCategories = useMemo(() => {
    const seen = new Set<PostCategory>();
    for (const p of feed.data ?? []) if (p.mine) seen.add(p.category as PostCategory);
    return [...seen];
  }, [feed.data]);

  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || !saved.data) return;
    seeded.current = true;
    const d = saved.data;
    setCard((c) =>
      d.saved
        ? { ...c, ...normaliseCard(d.saved as Partial<BusinessCard>) }
        : { ...c, name: d.name, company: d.company, details: d.details },
    );
  }, [saved.data]);

  const set = (p: Partial<BusinessCard>) => setCard((c) => ({ ...c, ...p }));
  const pay = card.kind === 'payment';

  /* Which saved version is open, so Save overwrites it instead of piling up
     a new row every time you nudge a colour. "New version" clears it. */
  const [openVersion, setOpenVersion] = useState<number | null>(null);
  const [renaming, setRenaming] = useState<number | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const versions = trpc.marketing.cardVersions.useQuery();

  const keepVersion = trpc.marketing.saveCardVersion.useMutation({
    onSuccess: (r) => {
      if (r.logoUrl !== card.logoUrl) set({ logoUrl: r.logoUrl });
      setOpenVersion(r.id);
      void versions.refetch();
    },
    onError: (e) => toast.error(say(e.message)),
  });
  const renameVersion = trpc.marketing.renameCardVersion.useMutation({
    onSuccess: () => {
      setRenaming(null);
      void versions.refetch();
    },
    onError: (e) => toast.error(say(e.message)),
  });
  const dropVersion = trpc.marketing.deleteCardVersion.useMutation({
    onSuccess: (_r, v) => {
      if (openVersion === v.id) setOpenVersion(null);
      void versions.refetch();
      toast.success(say('Version deleted'));
    },
    onError: (e) => toast.error(say(e.message)),
  });

  const save = trpc.marketing.saveCard.useMutation({
    onSuccess: (r) => {
      if (r.logoUrl !== card.logoUrl) set({ logoUrl: r.logoUrl });
      void saved.refetch();
      void utils.users.paymentCard.invalidate();
      /* Saving keeps a version as well as updating the working card, because
         "Save" that leaves no trace on the shelf below is the bug this page
         was reported for. */
      keepVersion.mutate({ id: openVersion, name: '', card: { ...card }, logoUrl: card.logoUrl });
      toast.success(card.shared ? say('Saved — and on your profile') : say('Card saved'));
    },
    onError: (e) => toast.error(say(e.message)),
  });

  const draft = trpc.marketing.draftCard.useMutation({
    onSuccess: (r) => {
      set({ title: r.title, tagline: r.tagline });
      toast.success(`Drafted — ${r.cost} 🪙`);
      void utils.auth.me.invalidate();
    },
    onError: (e) => toast.error(say(e.message)),
  });

  const drawLogo = async () => {
    const prompt = card.logoPrompt.trim();
    if (prompt.length < 3) return;
    if (!(await confirm.ask('Drawing the logo', quote.data?.logo))) return;
    setDrawingLogo(true);
    try {
      const r = await utils.client.marketing.logo.mutate({ prompt });
      set({ logoUrl: r.url });
      toast.success(`Logo drawn — ${r.cost} 🪙`);
      void utils.auth.me.invalidate();
    } catch (err) {
      toast.error(say(err instanceof Error ? err.message : "That logo couldn't be drawn"));
    } finally {
      setDrawingLogo(false);
    }
  };

  const uploadLogo = (file: File) => {
    if (file.size > 6_000_000) return toast.error(say("That logo is over 6 MB — try a smaller one"));
    const reader = new FileReader();
    reader.onload = () => set({ logoUrl: String(reader.result) });
    reader.onerror = () => toast.error(say("That file couldn't be read"));
    reader.readAsDataURL(file);
  };

  /** One side as a PNG at print size. */
  const renderSide = async (which: CardSide): Promise<HTMLCanvasElement> => {
    const canvas = document.createElement('canvas');
    canvas.width = CARD_W;
    canvas.height = CARD_H;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('This browser has no canvas to draw on');
    await drawBusinessCard(ctx, card, layoutBusinessCard(card, measureCtx(), which));
    return canvas;
  };

  const download = async () => {
    const stem = pay ? 'sketchlearn-payment-card' : 'sketchlearn-business-card';
    setBuilding(true);
    try {
      /* Both faces are drawn either way — the front alone is the odd case, not
         the normal one, and a back nobody asked for costs one canvas. */
      const front = await renderSide('front');
      const back = card.backOn ? await renderSide('back') : null;
      if (format === 'png') {
        const a = document.createElement('a');
        a.href = sideBySideCanvas(front, back).toDataURL('image/png');
        a.download = `${stem}.png`;
        a.click();
        toast.success(back ? 'PNG downloaded — front and back side by side ✓' : 'PNG downloaded ✓');
      } else if (format === 'pdf') {
        saveBlob(await cardProofPdf(front, back), `${stem}.pdf`);
        toast.success(back ? 'PDF downloaded — front and back side by side ✓' : 'PDF downloaded ✓');
      } else {
        saveBlob(await cardSheetPdf(front, back, flip), `${stem}-sheet.pdf`);
        toast.success(
          back
            ? `Sheet downloaded — ${perSheet()} per page, two pages to print double-sided ✓`
            : `Sheet downloaded — ${perSheet()} on one page ✓`,
        );
      }
    } catch (err) {
      toast.error(say(err instanceof Error ? err.message : "Couldn't build the card"));
    } finally {
      setBuilding(false);
    }
  };

  /**
   * Move to a section, and show the face that section is about.
   *
   * Editing the name while the preview shows a back that has no name on it
   * looks exactly like a name that did not save. The preview follows the
   * work; the switch under it is still there to override.
   */
  const goTo = (id: SectionId) => {
    setSection(id);
    if (id === 'back' && card.backOn) setSide('back');
    else if (id === 'who' || id === 'pay') setSide('front');
  };

  /**
   * The logo on its own, as a PNG.
   *
   * Fetched and re-encoded rather than linked: the drawn logo lives behind
   * /api/img/:id with no filename and no extension, so a plain link saves
   * something the operating system does not recognise as a picture. Drawing
   * it through a canvas also normalises an uploaded JPEG or WebP to the one
   * format everything can open.
   */
  const downloadLogo = async () => {
    if (!card.logoUrl) return;
    try {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.src = card.logoUrl;
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error("That logo couldn't be read back"));
      });
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth || 512;
      canvas.height = img.naturalHeight || 512;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('This browser has no canvas to draw on');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const a = document.createElement('a');
      a.href = canvas.toDataURL('image/png');
      a.download = 'logo.png';
      a.click();
      toast.success(say('Logo downloaded ✓'));
    } catch (err) {
      toast.error(err instanceof Error ? say(err.message) : say("That logo couldn't be read back"));
    }
  };

  const addMethod = () =>
    set({
      payments: [
        ...card.payments,
        { id: `m${Date.now().toString(36)}`, kind: 'binance', values: {}, qrImage: null },
      ],
    });
  const patchMethod = (id: string, p: Partial<PaymentMethod>) =>
    set({ payments: card.payments.map((m) => (m.id === id ? { ...m, ...p } : m)) });
  const setField = (m: PaymentMethod, key: string, v: string) =>
    patchMethod(m.id, { values: { ...m.values, [key]: v } });

  /** A QR the exchange gave you, used instead of one we generate. */
  const uploadQr = (m: PaymentMethod, file: File) => {
    if (file.size > 3_000_000) return toast.error(say("That image is over 3 MB — try a smaller one"));
    const reader = new FileReader();
    reader.onload = () => patchMethod(m.id, { qrImage: String(reader.result) });
    reader.onerror = () => toast.error(say("That file couldn't be read"));
    reader.readAsDataURL(file);
  };

  return (
    <div className="mx-auto flex w-full max-w-content flex-col gap-3 px-4 py-4 lg:h-full lg:min-h-0 lg:px-8">
      <SketchToaster />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl text-ink">{say("Card")}</h1>
          <p className="micro text-[0.62rem] text-ink-faint">
            
            {say("Yours to download and print, or to show on your profile — nothing here is posted.")}
          </p>
        </div>
        <div className="flex overflow-hidden rounded-wobble-sm border-2 border-ink shadow-offset">
          {KINDS.map((k) => (
            <button
              key={k.id}
              type="button"
              onClick={() => {
                set({ kind: k.id });
                goTo(k.id === 'payment' ? 'pay' : 'who');
              }}
              aria-pressed={card.kind === k.id}
              className={cn(
                'micro flex items-center gap-1.5 px-3 py-1.5 text-[0.62rem] font-bold transition-colors',
                card.kind === k.id ? 'bg-yellow text-ink' : 'bg-paper-3 text-ink-soft hover:text-ink',
              )}
            >
              <k.icon className="h-3.5 w-3.5" strokeWidth={2} />
              {say(k.label)}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-6 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
        <div className="flex flex-col gap-3 lg:min-h-0">
          <CardPreview card={card} side={side} />
          {card.backOn && (
            <div className="flex w-fit overflow-hidden rounded-wobble-sm border-2 border-ink shadow-offset">
              {(['front', 'back'] as CardSide[]).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setSide(f)}
                  aria-pressed={side === f}
                  className={cn(
                    'micro px-3 py-1 text-[0.6rem] font-bold capitalize transition-colors',
                    side === f ? 'bg-yellow text-ink' : 'bg-paper-3 text-ink-soft hover:text-ink',
                  )}
                >
                  {f}
                </button>
              ))}
            </div>
          )}
          {card.backOn && side === 'back' && (
            <span className="micro text-[0.58rem] text-ink-faint">
              
              {say("Showing the back —")} {BACK_LAYOUTS.find((l) => l.id === backLayoutOf(card))?.label}.{' '}
              {BACK_HINTS[backLayoutOf(card)]}
            </span>
          )}
          <div className="flex w-fit overflow-hidden rounded-wobble-sm border-2 border-ink shadow-offset">
            {FORMATS.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setFormat(f.id)}
                aria-pressed={format === f.id}
                className={cn(
                  'micro flex items-center gap-1.5 px-2.5 py-1 text-[0.6rem] font-bold transition-colors',
                  format === f.id ? 'bg-yellow text-ink' : 'bg-paper-3 text-ink-soft hover:text-ink',
                )}
              >
                <f.icon className="h-3 w-3" strokeWidth={2} />
                {say(f.label)}
              </button>
            ))}
          </div>
          <span className="micro text-[0.58rem] text-ink-faint">
            {format === 'png'
              ? `${CARD_W} × ${CARD_H} at 300dpi${card.backOn ? ' — both faces in one picture, side by side' : ''}`
              : format === 'pdf'
                ? `One page trimmed to the card${card.backOn ? ', front and back side by side' : ''}`
                : `${perSheet()} cards on a US Letter page with crop marks${
                    card.backOn ? ' — two pages, the backs mirrored to line up' : ''
                  }`}
          </span>
          {format === 'sheet' && card.backOn && (
            <label className="micro flex flex-wrap items-center gap-2 text-[0.58rem] text-ink-soft">
              
              {say("Your printer turns the paper over on its")}
              <select
                value={flip}
                onChange={(e) => setFlip(e.target.value as FlipEdge)}
                aria-label={say("Duplex flip edge")}
                className="rounded-wobble-sm border-2 border-ink bg-paper-3 px-2 py-1 text-[0.62rem] text-ink shadow-offset outline-none focus:border-blue"
              >
                <option value="long">{say("long edge (the usual)")}</option>
                <option value="short">{say("short edge")}</option>
              </select>
            </label>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <SketchButton variant="accent" loading={building} onClick={() => void download()}>
              <Download className="h-4 w-4" strokeWidth={2.5} />  {say("Download")}
            </SketchButton>
            <SketchButton
              variant="secondary"
              loading={save.isPending}
              onClick={() => save.mutate({ card: { ...card }, logoUrl: card.logoUrl })}
            >
              <Save className="h-4 w-4" strokeWidth={2} />  {say("Save")}
            </SketchButton>
            {openVersion != null && (
              <SketchButton variant="secondary" onClick={() => setOpenVersion(null)}>
                {say('New version')}
              </SketchButton>
            )}
          </div>

          {/* The shelf of kept cards. It belongs under the design rather than
              on some other page: a version is a design, and choosing one is
              the same act as choosing a colour. */}
          <div className="flex flex-col gap-1.5">
            <span className="micro text-[0.6rem] font-semibold text-ink-soft">
              {say('Saved versions')}
            </span>
            {(versions.data ?? []).length === 0 ? (
              <p className="micro text-[0.58rem] text-ink-faint">
                {say('None yet — Save keeps the card here, and you can come back to it.')}
              </p>
            ) : (
              <ul className="flex flex-col gap-1">
                {(versions.data ?? []).map((v) => (
                  <li
                    key={v.id}
                    className={cn(
                      'flex items-center gap-2 rounded-wobble-sm border-2 px-2 py-1.5',
                      openVersion === v.id
                        ? 'border-ink bg-yellow/50 shadow-offset'
                        : 'border-dashed border-pencil',
                    )}
                  >
                    {renaming === v.id ? (
                      <input
                        value={renameDraft}
                        autoFocus
                        onChange={(e) => setRenameDraft(e.target.value)}
                        onBlur={() =>
                          renameDraft.trim()
                            ? renameVersion.mutate({ id: v.id, name: renameDraft.trim() })
                            : setRenaming(null)
                        }
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') e.currentTarget.blur();
                          if (e.key === 'Escape') setRenaming(null);
                        }}
                        aria-label={say('Name this version')}
                        className="min-w-0 flex-1 rounded-wobble-sm border-2 border-ink bg-paper-3 px-1.5 py-0.5 text-sm text-ink outline-none"
                      />
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          /* Opening a version IS the design changing — the
                             preview, the panels and the download all follow
                             from this one piece of state. */
                          setCard((c) => ({
                            ...c,
                            ...normaliseCard(v.card as Partial<BusinessCard>),
                          }));
                          setOpenVersion(v.id);
                          setSide('front');
                          toast.success(say('Opened'));
                        }}
                        className="min-w-0 flex-1 text-left"
                      >
                        <span className="block truncate font-heading text-sm font-bold text-ink">
                          {v.name}
                        </span>
                        <span className="micro block text-[0.55rem] text-ink-faint">
                          {v.kind === 'payment' ? say('Payment') : say('Business')} ·{' '}
                          {new Date(v.updatedAt).toLocaleDateString()}
                        </span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setRenaming(v.id);
                        setRenameDraft(v.name);
                      }}
                      aria-label={say('Rename')}
                      title={say('Rename')}
                      className="shrink-0 text-ink-faint hover:text-ink"
                    >
                      <Pencil className="h-3.5 w-3.5" strokeWidth={2} />
                    </button>
                    <button
                      type="button"
                      onClick={() => dropVersion.mutate({ id: v.id })}
                      aria-label={say('Delete')}
                      title={say('Delete')}
                      className="shrink-0 text-ink-faint hover:text-red"
                    >
                      <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-3 lg:min-h-0">
          <div className="flex flex-wrap items-center gap-1.5">
            {/* Payments is a payment card's whole point, but a business card
                whose back lists ways to pay needs somewhere to enter them
                too — otherwise that layout has nothing to show and no way to
                give it anything. */}
            {SECTIONS.filter((s) =>
              s.id === 'pay' ? pay || backLayoutOf(card) === 'payments' : true,
            ).map(
              (sec) => (
                <button
                  key={sec.id}
                  type="button"
                  onClick={() => goTo(sec.id)}
                  aria-pressed={section === sec.id}
                  className={cn(
                    'micro flex items-center gap-1.5 rounded-wobble-sm border-2 px-2.5 py-1.5 text-[0.6rem] font-bold transition-colors',
                    section === sec.id
                      ? 'border-ink bg-yellow text-ink shadow-offset'
                      : 'border-dashed border-pencil text-ink-soft hover:border-ink hover:text-ink',
                  )}
                >
                  <sec.icon className="h-3.5 w-3.5" strokeWidth={2} />
                  {say(sec.label)}
                </button>
              ),
            )}
          </div>

          <div
            data-lenis-prevent
            className="flex flex-col gap-4 lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:pb-1 lg:pr-1"
          >
            {section === 'who' && (
              <SketchCard className="flex flex-col gap-3 p-5">
                <span className="micro flex items-center gap-1.5 text-[0.6rem] font-semibold text-ink-soft">
                  <Wand2 className="h-3.5 w-3.5" strokeWidth={2} />  {say("Who it is for")}
                </span>
                <input
                  value={card.company}
                  onChange={(e) => set({ company: e.target.value })}
                  aria-label={say("Company")}
                  placeholder={say("Company — the small line above the name")}
                  className={field}
                />
                <input
                  value={card.name}
                  onChange={(e) => set({ name: e.target.value })}
                  aria-label={say("Name")}
                  placeholder={say("Name")}
                  className={cn(field, 'font-heading text-base font-bold')}
                />
                {!pay && (
                  <input
                    value={card.title}
                    onChange={(e) => set({ title: e.target.value })}
                    aria-label={say("Role")}
                    placeholder={say("Role")}
                    className={field}
                  />
                )}
                {!pay && (
                  <textarea
                    value={card.tagline}
                    onChange={(e) => set({ tagline: e.target.value })}
                    rows={2}
                    aria-label={say("Tagline")}
                    placeholder={say("One line about what you do for someone")}
                    className={cn(field, 'resize-y')}
                  />
                )}
                <textarea
                  value={card.details}
                  onChange={(e) => set({ details: e.target.value })}
                  rows={3}
                  aria-label={say("Contact details")}
                  placeholder={'Contact — one per line\nyou@example.com\n+1 555 0100'}
                  className={cn(field, 'resize-y')}
                />
                {!pay && (
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      aria-label={say("Note for the AI")}
                      placeholder={say("Anything the AI should know?")}
                      className={cn(field, 'min-w-[180px] flex-1')}
                    />
                    <SketchButton
                      variant="accent"
                      loading={draft.isPending}
                      onClick={() =>
                        draft.mutate({ note: note.trim(), categories: myCategories })
                      }
                    >
                      <Sparkles className="h-4 w-4" strokeWidth={2.5} />  {say("Write my role and line")}
                      {quote.data ? ` — ${quote.data.highlight} 🪙` : ''}
                    </SketchButton>
                  </div>
                )}
                <p className="micro text-[0.58rem] text-ink-faint">
                  
                  {say("The name, company and contact start from your profile, and every one of them is yours to change — the card does not have to say what the site says.")}
                </p>
              </SketchCard>
            )}

            {section === 'pay' && (pay || backLayoutOf(card) === 'payments') && (
              <SketchCard className="flex flex-col gap-3 p-5">
                <span className="micro flex items-center gap-1.5 text-[0.6rem] font-semibold text-ink-soft">
                  <QrCode className="h-3.5 w-3.5" strokeWidth={2} />  {say("How you get paid")}
                </span>
                {card.payments.length === 0 && (
                  <p className="micro text-[0.58rem] text-ink-faint">
                    
                    {say("Nothing yet. Add an address and the card grows a code for it.")}
                  </p>
                )}
                {card.payments.map((m) => {
                  const spec = kindSpec(m.kind);
                  return (
                    <div
                      key={m.id}
                      className="flex flex-col gap-2 rounded-wobble-sm border-2 border-dashed border-pencil p-2.5"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <select
                          value={m.kind}
                          onChange={(e) => patchMethod(m.id, { kind: e.target.value })}
                          aria-label={say("Payment method")}
                          className="rounded-wobble-sm border-2 border-ink bg-paper-3 px-2 py-1.5 text-sm text-ink shadow-offset outline-none focus:border-blue"
                        >
                          {PAYMENT_KINDS.map((k) => (
                            <option key={k.id} value={k.id}>
                              {k.label}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => set({ qrOf: m.id })}
                          aria-pressed={card.qrOf === m.id}
                          title={say("Put this one in the QR code")}
                          className={cn(
                            'micro rounded-wobble-sm border-2 px-2 py-1.5 text-[0.58rem] font-bold transition-colors',
                            card.qrOf === m.id
                              ? 'border-ink bg-yellow text-ink shadow-offset'
                              : 'border-dashed border-pencil text-ink-soft hover:border-ink hover:text-ink',
                          )}
                        >
                          
                          {say("QR")}
                        </button>
                        <label className="micro cursor-pointer rounded-wobble-sm border-2 border-dashed border-pencil px-2 py-1.5 text-[0.58rem] font-bold text-ink-soft hover:border-ink hover:text-ink">
                          <Upload className="mr-1 inline h-3 w-3" strokeWidth={2} />
                          {m.qrImage ? 'Replace code' : 'Upload their code'}
                          <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            aria-label={`Upload a QR code for ${m.kind}`}
                            onChange={(e) => {
                              const f = e.target.files?.[0];
                              if (f) uploadQr(m, f);
                              e.target.value = '';
                            }}
                          />
                        </label>
                        {m.qrImage && (
                          <button
                            type="button"
                            onClick={() => patchMethod(m.id, { qrImage: null })}
                            className="micro rounded-wobble-sm border-2 border-dashed border-pencil px-2 py-1.5 text-[0.58rem] font-bold text-ink-soft hover:border-red hover:text-red"
                          >
                            
                            {say("Use a generated code")}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() =>
                            set({ payments: card.payments.filter((x) => x.id !== m.id) })
                          }
                          aria-label={`Remove ${m.kind}`}
                          className="micro ml-auto rounded-wobble-sm border-2 border-dashed border-pencil px-2 py-1.5 text-[0.58rem] font-bold text-ink-soft hover:border-red hover:text-red"
                        >
                          
                          {say("Remove")}
                        </button>
                      </div>
                      {/* Every rail asks for what it actually needs — a Pago
                          Móvil is a name, a cédula, a phone and a bank, not
                          "an address". */}
                      <div className="grid gap-2 sm:grid-cols-2">
                        {(spec?.fields ?? []).map((f) => (
                          <label key={f.key} className="flex flex-col gap-1">
                            <span className="micro text-[0.55rem] text-ink-soft">{f.label}</span>
                            <input
                              value={m.values[f.key] ?? ''}
                              onChange={(e) => setField(m, f.key, e.target.value)}
                              aria-label={`${spec?.label ?? m.kind} — ${f.label}`}
                              placeholder={f.hint ?? ''}
                              className={field}
                            />
                          </label>
                        ))}
                      </div>
                      {spec?.note && (
                        <p className="micro text-[0.55rem] text-ink-faint">{spec.note}</p>
                      )}
                    </div>
                  );
                })}
                <button
                  type="button"
                  onClick={addMethod}
                  className="micro w-fit rounded-wobble-sm border-2 border-dashed border-pencil px-2 py-1 text-[0.6rem] font-bold text-ink-soft hover:border-ink hover:text-ink"
                >
                  
                  {say("+ Add a way to pay")}
                </button>

                {/* The profile popover is a payment card's feature — a
                    business card that happens to list a wallet is not one. */}
                {pay && (
                  <label className="flex items-center gap-2 border-t-2 border-dashed border-pencil pt-3">
                    <input
                      type="checkbox"
                      checked={card.shared}
                      onChange={(e) => set({ shared: e.target.checked })}
                      className="h-4 w-4 accent-yellow"
                    />
                    <span className="text-sm font-bold text-ink">{say("Show it on my profile")}</span>
                  </label>
                )}
                {pay && (
                <p className="micro text-[0.58rem] text-ink-faint">
                  
                  {say("A \"How to pay me\" button appears on your profile; anyone who presses it sees these details and your contact lines. Save to apply it. The QR encodes")}{' '}
                  {(() => {
                    const chosen =
                      card.payments.find((m) => m.id === card.qrOf && paymentFilled(m.values)) ??
                      card.payments.find((m) => paymentFilled(m.values) || m.qrImage);
                    if (!chosen) return 'nothing yet';
                    if (chosen.qrImage) return 'the code you uploaded';
                    return paymentUri(chosen.kind, chosen.values) || 'nothing scannable yet';
                  })()}
                  .
                </p>
                )}
              </SketchCard>
            )}

            {section === 'back' && (
              <SketchCard className="flex flex-col gap-3 p-5">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={card.backOn}
                    onChange={(e) => {
                      const on = e.target.checked;
                      /* A payment card with rails on it almost certainly wants
                         them listed; anything else starts on the quote, which
                         is what the only back used to be. */
                      const wantsList = pay && card.payments.some((m) => paymentFilled(m.values));
                      set({
                        backOn: on,
                        ...(on && wantsList && !card.backLayout
                          ? { backLayout: 'payments' as BackLayout }
                          : {}),
                      });
                      setSide(on ? 'back' : 'front');
                    }}
                    className="h-4 w-4 accent-yellow"
                  />
                  <span className="text-sm font-bold text-ink">{say("Give it a back")}</span>
                </label>

                <span className="micro text-[0.6rem] font-semibold text-ink-soft">
                  
                  {say("What the back is for")}
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {BACK_LAYOUTS.map((l) => (
                    <button
                      key={l.id}
                      type="button"
                      disabled={!card.backOn}
                      onClick={() => {
                        set({ backLayout: l.id });
                        setSide('back');
                      }}
                      aria-pressed={backLayoutOf(card) === l.id}
                      className={cn(
                        'micro rounded-wobble-sm border-2 px-2.5 py-1.5 text-[0.6rem] font-bold transition-colors disabled:opacity-40',
                        backLayoutOf(card) === l.id
                          ? 'border-ink bg-yellow text-ink shadow-offset'
                          : 'border-dashed border-pencil text-ink-soft hover:border-ink hover:text-ink',
                      )}
                    >
                      {l.label}
                    </button>
                  ))}
                </div>
                <p className="micro text-[0.58rem] text-ink-faint">
                  {BACK_LAYOUTS.find((l) => l.id === backLayoutOf(card))?.blurb}
                </p>

                {BACK_FIELDS[backLayoutOf(card)].quote !== null && (
                  <textarea
                    value={card.quote}
                    onChange={(e) => set({ quote: e.target.value })}
                    rows={3}
                    disabled={!card.backOn}
                    aria-label={say("The back's big line")}
                    placeholder={BACK_FIELDS[backLayoutOf(card)].quote ?? ''}
                    className={cn(field, 'resize-y disabled:opacity-50')}
                  />
                )}
                <textarea
                  value={card.backNote}
                  onChange={(e) => set({ backNote: e.target.value })}
                  rows={2}
                  disabled={!card.backOn}
                  aria-label={say("The back's small lines")}
                  placeholder={say(BACK_FIELDS[backLayoutOf(card)].note)}
                  className={cn(field, 'resize-y disabled:opacity-50')}
                />
                {backLayoutOf(card) === 'payments' &&
                  !card.payments.some((m) => paymentFilled(m.values)) && (
                    <p className="micro text-[0.58rem] font-bold text-red">
                      
                      {say("Nothing to list yet — add a way to pay under Payments and it lands here.")}
                    </p>
                  )}
                <p className="micro text-[0.58rem] text-ink-faint">
                  {backLayoutOf(card) === 'payments'
                    ? 'Every method with something in it goes on the back — the one the QR is for stays on the front. Past nine lines the list runs in two columns, so you can keep adding ways to pay.'
                    : 'The back keeps the same colours, stripe and logo as the front. Download gives you both faces side by side.'}
                </p>
              </SketchCard>
            )}

            {section === 'logo' && (
              <SketchCard className="flex flex-col gap-3 p-5">
                <span className="micro flex items-center gap-1.5 text-[0.6rem] font-semibold text-ink-soft">
                  <ImageIcon className="h-3.5 w-3.5" strokeWidth={2} />  {say("Logo")}
                </span>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    value={card.logoPrompt}
                    onChange={(e) => set({ logoPrompt: e.target.value })}
                    aria-label={say("Logo brief")}
                    placeholder={say("Describe a mark — e.g. a folded paper crane, one colour")}
                    className={cn(field, 'min-w-[200px] flex-1')}
                  />
                  <SketchButton
                    variant="secondary"
                    loading={drawingLogo}
                    disabled={card.logoPrompt.trim().length < 3}
                    onClick={() => void drawLogo()}
                  >
                    <Sparkles className="h-4 w-4" strokeWidth={2} />  {say("Draw")}
                    {quote.data ? ` — ${quote.data.logo} 🪙` : ''}
                  </SketchButton>
                  <label className="micro cursor-pointer rounded-wobble-sm border-2 border-dashed border-pencil px-2 py-1.5 text-[0.6rem] font-bold text-ink-soft hover:border-ink hover:text-ink">
                    <Upload className="mr-1 inline h-3 w-3" strokeWidth={2} />  {say("Upload")}
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      aria-label={say("Upload a logo")}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) uploadLogo(f);
                        e.target.value = '';
                      }}
                    />
                  </label>
                  {card.logoUrl && (
                    <button
                      type="button"
                      onClick={() => void downloadLogo()}
                      className="micro rounded-wobble-sm border-2 border-dashed border-pencil px-2 py-1.5 text-[0.6rem] font-bold text-ink-soft hover:border-ink hover:text-ink"
                    >
                      <Download className="mr-1 inline h-3 w-3" strokeWidth={2} />
                      {say("Download the logo")}
                    </button>
                  )}
                  {card.logoUrl && (
                    <button
                      type="button"
                      onClick={() => set({ logoUrl: null })}
                      className="micro rounded-wobble-sm border-2 border-dashed border-pencil px-2 py-1.5 text-[0.6rem] font-bold text-ink-soft hover:border-red hover:text-red"
                    >
                      
                      {say("Remove")}
                    </button>
                  )}
                </div>
              </SketchCard>
            )}

            {section === 'colour' && (
              <SketchCard className="flex flex-col gap-3 p-5">
                <span className="micro flex items-center gap-1.5 text-[0.6rem] font-semibold text-ink-soft">
                  <Palette className="h-3.5 w-3.5" strokeWidth={2} />  {say("Colour")}
                </span>
                <span className="micro text-[0.58rem] text-ink-soft">{say("Card")}</span>
                <div className="flex flex-wrap gap-1.5">
                  {SWATCHES.map((hex) => (
                    <button
                      key={hex}
                      type="button"
                      onClick={() => set({ bg: hex })}
                      aria-label={`Card ${hex}`}
                      aria-pressed={card.bg === hex}
                      style={{ background: hex }}
                      className={cn(
                        'h-7 w-7 rounded-wobble-sm border-2',
                        card.bg === hex ? 'border-ink shadow-offset' : 'border-pencil',
                      )}
                    />
                  ))}
                  <input
                    type="color"
                    value={card.bg}
                    onChange={(e) => set({ bg: e.target.value })}
                    aria-label={say("Mix a card colour")}
                    className="h-7 w-10 cursor-pointer rounded-wobble-sm border-2 border-pencil bg-transparent"
                  />
                </div>
                <span className="micro text-[0.58rem] text-ink-soft">{say("Accent")}</span>
                <div className="flex flex-wrap gap-1.5">
                  {ACCENTS.map((hex) => (
                    <button
                      key={hex}
                      type="button"
                      onClick={() => set({ accent: hex })}
                      aria-label={`Accent ${hex}`}
                      aria-pressed={card.accent === hex}
                      style={{ background: hex }}
                      className={cn(
                        'h-7 w-7 rounded-wobble-sm border-2',
                        card.accent === hex ? 'border-ink shadow-offset' : 'border-pencil',
                      )}
                    />
                  ))}
                  <input
                    type="color"
                    value={card.accent}
                    onChange={(e) => set({ accent: e.target.value })}
                    aria-label={say("Mix an accent")}
                    className="h-7 w-10 cursor-pointer rounded-wobble-sm border-2 border-pencil bg-transparent"
                  />
                </div>
              </SketchCard>
            )}
          </div>
        </div>
      </div>
      {!user && (
        <p className="micro text-[0.6rem] text-ink-faint">{say("Sign in to keep a card.")}</p>
      )}
    </div>
  );
}

export default function CardPage() {
  return (
    <CostConfirmProvider>
      <CardBody />
    </CostConfirmProvider>
  );
}
