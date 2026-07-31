import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CreditCard,
  Download,
  Image as ImageIcon,
  Palette,
  QrCode,
  Save,
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
  CARD_H,
  CARD_W,
  type BusinessCard,
  type PaymentMethod,
  drawBusinessCard,
  emptyBusinessCard,
  layoutBusinessCard,
} from '@/components/marketing/business-card';
import { PAYMENT_KINDS, paymentUri } from '@/lib/qr';
import type { PostCategory } from '@contracts/post';
import { measureCtx } from '@/lib/caption-words';

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
  { id: 'logo' as const, label: 'Logo', icon: ImageIcon },
  { id: 'colour' as const, label: 'Colour', icon: Palette },
];
type SectionId = (typeof SECTIONS)[number]['id'];

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

function CardBody() {
  const [card, setCard] = useState<BusinessCard>(emptyBusinessCard);
  const [section, setSection] = useState<SectionId>('who');
  const [note, setNote] = useState('');
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
        ? { ...c, ...(d.saved as Partial<BusinessCard>) }
        : { ...c, name: d.name, company: d.company, details: d.details },
    );
  }, [saved.data]);

  const set = (p: Partial<BusinessCard>) => setCard((c) => ({ ...c, ...p }));
  const pay = card.kind === 'payment';

  const save = trpc.marketing.saveCard.useMutation({
    onSuccess: (r) => {
      if (r.logoUrl !== card.logoUrl) set({ logoUrl: r.logoUrl });
      void saved.refetch();
      void utils.users.paymentCard.invalidate();
      toast.success(card.shared ? 'Saved — and on your profile' : 'Card saved');
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
      a.download = pay ? 'sketchlearn-payment-card.png' : 'sketchlearn-business-card.png';
      a.click();
      toast.success('Card downloaded ✓');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't build the card");
    }
  };

  const addMethod = () =>
    set({
      payments: [
        ...card.payments,
        { id: `m${Date.now().toString(36)}`, kind: 'bitcoin', value: '' },
      ],
    });
  const patchMethod = (id: string, p: Partial<PaymentMethod>) =>
    set({ payments: card.payments.map((m) => (m.id === id ? { ...m, ...p } : m)) });

  return (
    <div className="mx-auto flex w-full max-w-content flex-col gap-3 px-4 py-4 lg:h-full lg:min-h-0 lg:px-8">
      <SketchToaster />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl text-ink">Card</h1>
          <p className="micro text-[0.62rem] text-ink-faint">
            Yours to download and print, or to show on your profile — nothing here is posted.
          </p>
        </div>
        <div className="flex overflow-hidden rounded-wobble-sm border-2 border-ink shadow-offset">
          {KINDS.map((k) => (
            <button
              key={k.id}
              type="button"
              onClick={() => {
                set({ kind: k.id });
                setSection(k.id === 'payment' ? 'pay' : 'who');
              }}
              aria-pressed={card.kind === k.id}
              className={cn(
                'micro flex items-center gap-1.5 px-3 py-1.5 text-[0.62rem] font-bold transition-colors',
                card.kind === k.id ? 'bg-yellow text-ink' : 'bg-paper-3 text-ink-soft hover:text-ink',
              )}
            >
              <k.icon className="h-3.5 w-3.5" strokeWidth={2} />
              {k.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-6 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
        <div className="flex flex-col gap-3 lg:min-h-0">
          <CardPreview card={card} />
          <span className="micro text-[0.58rem] text-ink-faint">
            PNG · {CARD_W} × {CARD_H} — 3.5 × 2in at 300dpi, the size a printer expects
          </span>
          <div className="flex flex-wrap items-center gap-2">
            <SketchButton variant="accent" onClick={() => void download()}>
              <Download className="h-4 w-4" strokeWidth={2.5} /> Download
            </SketchButton>
            <SketchButton
              variant="secondary"
              loading={save.isPending}
              onClick={() => save.mutate({ card: { ...card }, logoUrl: card.logoUrl })}
            >
              <Save className="h-4 w-4" strokeWidth={2} /> Save
            </SketchButton>
          </div>
        </div>

        <div className="flex flex-col gap-3 lg:min-h-0">
          <div className="flex flex-wrap items-center gap-1.5">
            {SECTIONS.filter((s) => (s.id === 'pay' ? pay : s.id === 'logo' ? !pay : true)).map(
              (sec) => (
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
                {!pay && (
                  <input
                    value={card.title}
                    onChange={(e) => set({ title: e.target.value })}
                    aria-label="Role"
                    placeholder="Role"
                    className={field}
                  />
                )}
                {!pay && (
                  <textarea
                    value={card.tagline}
                    onChange={(e) => set({ tagline: e.target.value })}
                    rows={2}
                    aria-label="Tagline"
                    placeholder="One line about what you do for someone"
                    className={cn(field, 'resize-y')}
                  />
                )}
                <textarea
                  value={card.details}
                  onChange={(e) => set({ details: e.target.value })}
                  rows={3}
                  aria-label="Contact details"
                  placeholder={'Contact — one per line\nyou@example.com\n+1 555 0100'}
                  className={cn(field, 'resize-y')}
                />
                {!pay && (
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      aria-label="Note for the AI"
                      placeholder="Anything the AI should know?"
                      className={cn(field, 'min-w-[180px] flex-1')}
                    />
                    <SketchButton
                      variant="accent"
                      loading={draft.isPending}
                      onClick={() =>
                        draft.mutate({ note: note.trim(), categories: myCategories })
                      }
                    >
                      <Sparkles className="h-4 w-4" strokeWidth={2.5} /> Write my role and line
                      {quote.data ? ` — ${quote.data.highlight} 🪙` : ''}
                    </SketchButton>
                  </div>
                )}
                <p className="micro text-[0.58rem] text-ink-faint">
                  The name, company and contact start from your profile, and every one of them is
                  yours to change — the card does not have to say what the site says.
                </p>
              </SketchCard>
            )}

            {section === 'pay' && pay && (
              <SketchCard className="flex flex-col gap-3 p-5">
                <span className="micro flex items-center gap-1.5 text-[0.6rem] font-semibold text-ink-soft">
                  <QrCode className="h-3.5 w-3.5" strokeWidth={2} /> How you get paid
                </span>
                {card.payments.length === 0 && (
                  <p className="micro text-[0.58rem] text-ink-faint">
                    Nothing yet. Add an address and the card grows a code for it.
                  </p>
                )}
                {card.payments.map((m) => (
                  <div key={m.id} className="flex flex-wrap items-center gap-2">
                    <select
                      value={m.kind}
                      onChange={(e) => patchMethod(m.id, { kind: e.target.value })}
                      aria-label="Payment method"
                      className="rounded-wobble-sm border-2 border-ink bg-paper-3 px-2 py-2 text-sm text-ink shadow-offset outline-none focus:border-blue"
                    >
                      {PAYMENT_KINDS.map((k) => (
                        <option key={k.id} value={k.id}>
                          {k.label}
                        </option>
                      ))}
                    </select>
                    <input
                      value={m.value}
                      onChange={(e) => patchMethod(m.id, { value: e.target.value })}
                      aria-label={`${m.kind} address`}
                      placeholder={PAYMENT_KINDS.find((k) => k.id === m.kind)?.hint ?? 'address'}
                      className={cn(field, 'min-w-[180px] flex-1')}
                    />
                    <button
                      type="button"
                      onClick={() => set({ qrOf: m.id })}
                      aria-pressed={card.qrOf === m.id}
                      title="Put this one in the QR code"
                      className={cn(
                        'micro rounded-wobble-sm border-2 px-2 py-1.5 text-[0.58rem] font-bold transition-colors',
                        card.qrOf === m.id
                          ? 'border-ink bg-yellow text-ink shadow-offset'
                          : 'border-dashed border-pencil text-ink-soft hover:border-ink hover:text-ink',
                      )}
                    >
                      QR
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        set({ payments: card.payments.filter((x) => x.id !== m.id) })
                      }
                      aria-label={`Remove ${m.kind}`}
                      className="micro rounded-wobble-sm border-2 border-dashed border-pencil px-2 py-1.5 text-[0.58rem] font-bold text-ink-soft hover:border-red hover:text-red"
                    >
                      Remove
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={addMethod}
                  className="micro w-fit rounded-wobble-sm border-2 border-dashed border-pencil px-2 py-1 text-[0.6rem] font-bold text-ink-soft hover:border-ink hover:text-ink"
                >
                  + Add a way to pay
                </button>

                <label className="flex items-center gap-2 border-t-2 border-dashed border-pencil pt-3">
                  <input
                    type="checkbox"
                    checked={card.shared}
                    onChange={(e) => set({ shared: e.target.checked })}
                    className="h-4 w-4 accent-yellow"
                  />
                  <span className="text-sm font-bold text-ink">Show it on my profile</span>
                </label>
                <p className="micro text-[0.58rem] text-ink-faint">
                  A "How to pay me" button appears on your profile; anyone who presses it sees
                  these details and your contact lines. Save to apply it. The QR encodes{' '}
                  {(() => {
                    const chosen =
                      card.payments.find((m) => m.id === card.qrOf && m.value.trim()) ??
                      card.payments.find((m) => m.value.trim());
                    return chosen ? paymentUri(chosen.kind, chosen.value) : 'nothing yet';
                  })()}
                  .
                </p>
              </SketchCard>
            )}

            {section === 'logo' && !pay && (
              <SketchCard className="flex flex-col gap-3 p-5">
                <span className="micro flex items-center gap-1.5 text-[0.6rem] font-semibold text-ink-soft">
                  <ImageIcon className="h-3.5 w-3.5" strokeWidth={2} /> Logo
                </span>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    value={card.logoPrompt}
                    onChange={(e) => set({ logoPrompt: e.target.value })}
                    aria-label="Logo brief"
                    placeholder="Describe a mark — e.g. a folded paper crane, one colour"
                    className={cn(field, 'min-w-[200px] flex-1')}
                  />
                  <SketchButton
                    variant="secondary"
                    loading={drawingLogo}
                    disabled={card.logoPrompt.trim().length < 3}
                    onClick={() => void drawLogo()}
                  >
                    <Sparkles className="h-4 w-4" strokeWidth={2} /> Draw
                    {quote.data ? ` — ${quote.data.logo} 🪙` : ''}
                  </SketchButton>
                  <label className="micro cursor-pointer rounded-wobble-sm border-2 border-dashed border-pencil px-2 py-1.5 text-[0.6rem] font-bold text-ink-soft hover:border-ink hover:text-ink">
                    <Upload className="mr-1 inline h-3 w-3" strokeWidth={2} /> Upload
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      aria-label="Upload a logo"
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
                      onClick={() => set({ logoUrl: null })}
                      className="micro rounded-wobble-sm border-2 border-dashed border-pencil px-2 py-1.5 text-[0.6rem] font-bold text-ink-soft hover:border-red hover:text-red"
                    >
                      Remove
                    </button>
                  )}
                </div>
              </SketchCard>
            )}

            {section === 'colour' && (
              <SketchCard className="flex flex-col gap-3 p-5">
                <span className="micro flex items-center gap-1.5 text-[0.6rem] font-semibold text-ink-soft">
                  <Palette className="h-3.5 w-3.5" strokeWidth={2} /> Colour
                </span>
                <span className="micro text-[0.58rem] text-ink-soft">Card</span>
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
                    aria-label="Mix a card colour"
                    className="h-7 w-10 cursor-pointer rounded-wobble-sm border-2 border-pencil bg-transparent"
                  />
                </div>
                <span className="micro text-[0.58rem] text-ink-soft">Accent</span>
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
                    aria-label="Mix an accent"
                    className="h-7 w-10 cursor-pointer rounded-wobble-sm border-2 border-pencil bg-transparent"
                  />
                </div>
              </SketchCard>
            )}
          </div>
        </div>
      </div>
      {!user && (
        <p className="micro text-[0.6rem] text-ink-faint">Sign in to keep a card.</p>
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
