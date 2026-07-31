import { useEffect, useMemo, useRef, useState } from 'react';
import { Download, Image as ImageIcon, Save, Sparkles, Upload, Wand2 } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { trpc } from '@/providers/trpc';
import AdminGate from '@/components/admin/AdminGate';
import SketchToaster from '@/components/admin/SketchToaster';
import SketchButton from '@/components/sketch/SketchButton';
import SketchCard from '@/components/sketch/SketchCard';
import { HubHeader } from '@/components/admin/PanelTiles';
import MarketingTabs from '@/components/marketing/MarketingTabs';
import CostConfirmProvider from '@/components/marketing/CostConfirmProvider';
import { useCostConfirm } from '@/components/marketing/cost-confirm';
import {
  CARD_H,
  CARD_W,
  type BusinessCard,
  type CardText,
  drawBusinessCard,
  emptyBusinessCard,
  layoutBusinessCard,
} from '@/components/marketing/business-card';
import type { PostCategory } from '@contracts/post';
import { measureCtx } from '@/lib/caption-words';

/* The business card.
 *
 * Same idea as the follow card, same machinery: one layout function, walked by
 * the preview and by the canvas that downloads, so the print file is the card
 * that was on screen. The arrangement is fixed on purpose — every word and
 * colour is yours, but where they sit is not, because two cards from the same
 * place should look like it. */

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

/** print px → a share of the frame's width, so the preview scales exactly */
const cq = (px: number) => `${(px / CARD_W) * 100}cqw`;

function Text({ t }: { t: CardText }) {
  return (
    <>
      {t.lines.map((line, i) => (
        <div
          key={i}
          className="absolute whitespace-pre"
          style={{
            left: cq(t.x),
            top: cq(t.y + i * t.lead),
            height: cq(t.lead),
            lineHeight: cq(t.lead),
            fontSize: cq(t.size),
            fontFamily: t.family,
            fontWeight: t.weight,
            color: t.colour,
          }}
        >
          {line}
        </div>
      ))}
    </>
  );
}

function CardPreview({ card }: { card: BusinessCard }) {
  const L = useMemo(() => layoutBusinessCard(card, measureCtx()), [card]);

  return (
    <div
      className="relative w-full overflow-hidden rounded-wobble-sm border-2 border-ink shadow-offset [container-type:inline-size]"
      style={{ aspectRatio: `${CARD_W} / ${CARD_H}`, background: L.bg }}
    >
      <div
        className="absolute"
        style={{ left: 0, top: 0, width: cq(L.stripe.w), height: '100%', background: L.accent }}
      />
      <Text t={L.company} />
      <Text t={L.name} />
      <Text t={L.title} />
      <Text t={L.tagline} />
      <div
        className="absolute"
        style={{
          left: cq(L.rule.x),
          top: cq(L.rule.y),
          width: cq(L.rule.w),
          height: cq(L.rule.h),
          background: L.accent,
        }}
      />
      <Text t={L.details} />
      {L.logo && (
        <div
          className="absolute overflow-hidden rounded-full"
          style={{
            left: cq(L.logo.cx - L.logo.r),
            top: cq(L.logo.cy - L.logo.r),
            width: cq(L.logo.r * 2),
            height: cq(L.logo.r * 2),
            border: `${cq(4)} solid ${L.accent}`,
          }}
        >
          {card.logoUrl && <img src={card.logoUrl} alt="" className="h-full w-full object-cover" />}
        </div>
      )}
    </div>
  );
}

function CardBody() {
  const [card, setCard] = useState<BusinessCard>(emptyBusinessCard);
  const [note, setNote] = useState('');
  const [drawingLogo, setDrawingLogo] = useState(false);
  const confirm = useCostConfirm();
  const utils = trpc.useUtils();
  const quote = trpc.marketing.quote.useQuery();
  const saved = trpc.marketing.card.useQuery();
  const feed = trpc.posts.list.useQuery({ limit: 60 });

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
        ? { ...c, ...(d.saved as Partial<BusinessCard>) }
        : { ...c, name: d.name, company: d.company, details: d.details },
    );
  }, [saved.data]);

  const set = (p: Partial<BusinessCard>) => setCard((c) => ({ ...c, ...p }));

  const save = trpc.marketing.saveCard.useMutation({
    onSuccess: (r) => {
      if (r.logoUrl !== card.logoUrl) set({ logoUrl: r.logoUrl });
      void saved.refetch();
      toast.success('Card saved');
    },
    onError: (e) => toast.error(e.message),
  });

  const draft = trpc.marketing.draftCard.useMutation({
    onSuccess: (r) => {
      set({ title: r.title, tagline: r.tagline });
      toast.success(`Drafted — ${r.cost} 🪙`);
      void utils.auth.me.invalidate();
    },
    onError: (e) => toast.error(e.message),
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
      toast.error(err instanceof Error ? err.message : "That logo couldn't be drawn");
    } finally {
      setDrawingLogo(false);
    }
  };

  const uploadLogo = (file: File) => {
    if (file.size > 6_000_000) return toast.error('That logo is over 6 MB — try a smaller one');
    const reader = new FileReader();
    reader.onload = () => set({ logoUrl: String(reader.result) });
    reader.onerror = () => toast.error("That file couldn't be read");
    reader.readAsDataURL(file);
  };

  const download = async () => {
    const canvas = document.createElement('canvas');
    canvas.width = CARD_W;
    canvas.height = CARD_H;
    const ctx = canvas.getContext('2d');
    if (!ctx) return toast.error('This browser has no canvas to draw on');
    try {
      await drawBusinessCard(ctx, card, layoutBusinessCard(card, measureCtx()));
      const a = document.createElement('a');
      a.href = canvas.toDataURL('image/png');
      a.download = 'sketchlearn-business-card.png';
      a.click();
      toast.success('Card downloaded ✓');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't build the card");
    }
  };

  const field =
    'w-full rounded-wobble-sm border-2 border-ink bg-paper-3 px-3 py-2 text-sm text-ink shadow-offset outline-none placeholder:text-ink-faint focus:border-blue';

  return (
    <div className="mx-auto flex w-full max-w-content flex-col gap-6 px-4 py-8 lg:px-8">
      <SketchToaster />
      <HubHeader
        backTo="/admin/projects"
        backLabel="Projects"
        title="Marketing"
        blurb="A business card built from the same parts as the post's closing card."
      />
      <MarketingTabs />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
        <div className="flex flex-col gap-3">
          <CardPreview card={card} />
          <span className="micro text-[0.58rem] text-ink-faint">
            PNG · {CARD_W} × {CARD_H} — 3.5 × 2in at 300dpi, the size a printer expects
          </span>
        </div>

        <div className="flex flex-col gap-4">
          <SketchCard className="flex flex-col gap-3 p-5">
            <span className="micro flex items-center gap-1.5 text-[0.6rem] font-semibold text-ink-soft">
              <Wand2 className="h-3.5 w-3.5" strokeWidth={2} /> Who it is for
            </span>
            <input
              value={card.company}
              onChange={(e) => set({ company: e.target.value })}
              aria-label="Company"
              placeholder="Company — the small line above the name"
              className={field}
            />
            <input
              value={card.name}
              onChange={(e) => set({ name: e.target.value })}
              aria-label="Name"
              placeholder="Name"
              className={cn(field, 'font-heading text-base font-bold')}
            />
            <input
              value={card.title}
              onChange={(e) => set({ title: e.target.value })}
              aria-label="Role"
              placeholder="Role"
              className={field}
            />
            <textarea
              value={card.tagline}
              onChange={(e) => set({ tagline: e.target.value })}
              rows={2}
              aria-label="Tagline"
              placeholder="One line about what you do for someone"
              className={cn(field, 'resize-y')}
            />
            <textarea
              value={card.details}
              onChange={(e) => set({ details: e.target.value })}
              rows={3}
              aria-label="Contact details"
              placeholder={'One per line\nhello@example.com\n+34 600 000 000'}
              className={cn(field, 'resize-y')}
            />
            <div className="flex flex-wrap items-center gap-2 border-t-2 border-dashed border-pencil pt-3">
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                aria-label="Draft note"
                placeholder="Anything the AI should know?"
                className={cn(field, 'min-w-[180px] flex-1')}
              />
              <SketchButton
                variant="accent"
                loading={draft.isPending}
                onClick={async () => {
                  if (!(await confirm.ask('Drafting the card', quote.data?.highlight))) return;
                  draft.mutate({ note: note.trim(), categories: myCategories });
                }}
              >
                <Sparkles className="h-4 w-4" strokeWidth={2.5} /> Write my role and line
                {quote.data ? ` — ${quote.data.highlight} 🪙` : ''}
              </SketchButton>
            </div>
            <p className="micro text-[0.58rem] text-ink-faint">
              The name, company and contact start from your profile. The AI writes the role and the
              tagline from that plus what you actually post about
              {myCategories.length > 0 ? ` — right now that's ${myCategories.join(', ')}.` : '.'}
            </p>
          </SketchCard>

          <SketchCard className="flex flex-col gap-3 p-5">
            <span className="micro flex items-center gap-1.5 text-[0.6rem] font-semibold text-ink-soft">
              <ImageIcon className="h-3.5 w-3.5" strokeWidth={2} /> Logo and colour
            </span>
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-ink bg-paper-2">
                {card.logoUrl ? (
                  <img src={card.logoUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  <ImageIcon className="h-5 w-5 text-ink-faint" strokeWidth={1.5} />
                )}
              </div>
              <input
                value={card.logoPrompt}
                onChange={(e) => set({ logoPrompt: e.target.value })}
                aria-label="Logo brief"
                placeholder="What should the logo be?"
                className={cn(field, 'min-w-[180px] flex-1')}
              />
              <SketchButton
                variant="secondary"
                loading={drawingLogo}
                disabled={card.logoPrompt.trim().length < 3}
                onClick={() => void drawLogo()}
              >
                <Sparkles className="h-4 w-4" strokeWidth={2} />
                {card.logoUrl ? 'Redraw' : 'Draw'}
                {quote.data ? ` — ${quote.data.logo} 🪙` : ''}
              </SketchButton>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label className="micro cursor-pointer rounded-wobble-sm border-2 border-dashed border-pencil px-2 py-1 text-[0.6rem] font-bold text-ink-soft hover:border-ink hover:text-ink">
                <Upload className="mr-1 inline h-3 w-3" strokeWidth={2} /> Upload a logo
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  aria-label="Upload a card logo"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) uploadLogo(file);
                    e.target.value = '';
                  }}
                />
              </label>
              <button
                type="button"
                disabled={!card.logoUrl}
                onClick={() => set({ logoUrl: null })}
                className="micro rounded-wobble-sm border-2 border-dashed border-pencil px-2 py-1 text-[0.6rem] font-bold text-ink-soft hover:border-red hover:text-red disabled:opacity-30"
              >
                Remove
              </button>
            </div>
            <Row label="Card colour" values={SWATCHES} value={card.bg} onPick={(bg) => set({ bg })} />
            <Row
              label="Accent"
              values={ACCENTS}
              value={card.accent}
              onPick={(accent) => set({ accent })}
            />
            <div className="flex flex-wrap items-center gap-2 border-t-2 border-dashed border-pencil pt-3">
              <SketchButton variant="accent" onClick={() => void download()}>
                <Download className="h-4 w-4" strokeWidth={2.5} /> Download the card
              </SketchButton>
              <SketchButton
                variant="secondary"
                loading={save.isPending}
                onClick={() =>
                  save.mutate({
                    logoUrl: card.logoUrl,
                    card: {
                      name: card.name,
                      title: card.title,
                      company: card.company,
                      tagline: card.tagline,
                      details: card.details,
                      bg: card.bg,
                      accent: card.accent,
                    },
                  })
                }
              >
                <Save className="h-4 w-4" strokeWidth={2} /> Update
              </SketchButton>
            </div>
          </SketchCard>
        </div>
      </div>
    </div>
  );
}

function Row({
  label,
  values,
  value,
  onPick,
}: {
  label: string;
  values: string[];
  value: string;
  onPick: (v: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="micro w-24 shrink-0 text-[0.6rem] text-ink-soft">{label}</span>
      <div className="flex flex-1 flex-wrap items-center gap-1.5">
        {values.map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => onPick(v)}
            aria-label={`${label} ${v}`}
            aria-pressed={value === v}
            className={cn(
              'h-7 w-7 rounded-full border-2 transition-transform hover:scale-110',
              value === v ? 'border-ink ring-2 ring-blue' : 'border-pencil',
            )}
            style={{ backgroundColor: v }}
          />
        ))}
        <label className="flex h-7 cursor-pointer items-center rounded-wobble-sm border-2 border-dashed border-pencil px-1.5">
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

export default function AdminMarketingCard() {
  return (
    <AdminGate minRole="admin">
      <CostConfirmProvider>
        <CardBody />
      </CostConfirmProvider>
    </AdminGate>
  );
}
