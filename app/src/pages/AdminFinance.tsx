import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Landmark, Printer, ReceiptText, RefreshCw, Scale } from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '../../api/router';
import type { Level } from '@contracts/types';
import { trpc } from '@/providers/trpc';
import SketchButton from '@/components/sketch/SketchButton';
import SketchCard from '@/components/sketch/SketchCard';
import Chip from '@/components/sketch/Chip';
import AdminGate from '@/components/admin/AdminGate';
import SketchToaster from '@/components/admin/SketchToaster';
import { HubHeader } from '@/components/admin/PanelTiles';
import { SketchModal } from '@/components/admin/overlays';
import { LabeledField, SketchInput, SketchSelect, SkeletonBlock } from '@/components/admin/controls';
import { errMsg, formatMoney, formatRelative } from '@/components/admin/utils';

/* ------------------------------------------------------------------ */
/* Types inferred from the finance router                              */
/* ------------------------------------------------------------------ */

type Overview = inferRouterOutputs<AppRouter>['finance']['overview'];
type Receipt = Overview['recentReceipts'][number];

const PROVIDER_LABEL: Record<string, string> = {
  gemini: 'Google Gemini',
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  grok: 'xAI Grok',
  deepseek: 'DeepSeek',
  openrouter: 'OpenRouter',
  kimi: 'Moonshot Kimi',
};

const LEVELS: Level[] = ['A0', 'A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

const fmtUsd = (v: number) =>
  v >= 0.01 || v === 0 ? `$${v.toFixed(2)}` : `$${v.toFixed(4)}`;

const AXIS_TICK = { fill: '#5C5347', fontFamily: 'Caveat, cursive', fontSize: 15 };
const AXIS_LINE = { stroke: '#2E2820', strokeWidth: 2 };

/* ------------------------------------------------------------------ */
/* Sticky-note chart tooltip (any number of series)                    */
/* ------------------------------------------------------------------ */

function CostTooltip({
  active,
  payload,
  label,
  unit,
}: {
  active?: boolean;
  payload?: { name?: string; value?: number }[];
  label?: string;
  unit?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="-rotate-1 rounded-wobble-sm border-2 border-ink bg-yellow px-3 py-1.5 shadow-offset">
      <p className="font-display text-lg leading-none text-ink">{label}</p>
      {payload.map((p) => (
        <p key={p.name} className="font-mono text-xs font-bold text-ink">
          {p.name}: {unit === '$' ? fmtUsd(p.value ?? 0) : `$${p.value?.toFixed(2)} / 1M`}
        </p>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Printable receipt (unchanged behavior)                              */
/* ------------------------------------------------------------------ */

function printReceipt(r: Receipt) {
  const w = window.open('', '_blank', 'width=420,height=640');
  if (!w) return;
  const date = new Date(r.createdAt).toLocaleString();
  w.document.write(`<!doctype html><html><head><title>Receipt #${r.receiptNo}</title>
<style>
  body { font-family: Georgia, serif; color: #2E2820; background: #FFFDF6; margin: 0; padding: 28px; }
  .box { border: 2px solid #2E2820; border-radius: 10px; padding: 20px 24px; max-width: 360px; margin: 0 auto; }
  h1 { font-size: 20px; margin: 0 0 2px; } .muted { color: #8B8071; font-size: 12px; }
  hr { border: none; border-top: 2px dashed #C9BFA9; margin: 14px 0; }
  table { width: 100%; font-size: 14px; border-collapse: collapse; }
  td { padding: 3px 0; } td:last-child { text-align: right; font-weight: bold; }
  .total td { font-size: 17px; padding-top: 8px; }
  .note { font-style: italic; font-size: 12px; color: #5C5347; margin-top: 10px; }
</style></head><body><div class="box">
  <h1>SketchLearn ✎</h1>
  <p class="muted">Token receipt · #${String(r.receiptNo).padStart(5, '0')} · ${date}</p>
  <hr/>
  <table>
    <tr><td>Billed to</td><td>${r.userName}</td></tr>
    <tr><td class="muted">${r.userEmail}</td><td></td></tr>
    <tr><td>Coins credited</td><td>${r.tokens} 🪙</td></tr>
    <tr class="total"><td>Total paid</td><td>${(r.amountCents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })}</td></tr>
  </table>
  ${r.note ? `<p class="note">“${r.note.replace(/</g, '&lt;')}”</p>` : ''}
  <hr/>
  <p class="muted">Issued by ${r.issuedBy ?? 'SketchLearn'} · thank you for sketching with us</p>
</div><script>window.print()</script></body></html>`);
  w.document.close();
}

function ReceiptModal({ receipt, onClose }: { receipt: Receipt; onClose: () => void }) {
  return (
    <SketchModal
      open
      onClose={onClose}
      title={`Receipt #${String(receipt.receiptNo).padStart(5, '0')}`}
      maxWidth="max-w-[420px]"
    >
      <div className="rounded-wobble-sm border-2 border-ink bg-paper-3 p-4">
        <p className="font-display text-2xl text-ink">SketchLearn ✎</p>
        <p className="micro text-ink-faint">
          Token receipt · {new Date(receipt.createdAt).toLocaleString()}
        </p>
        <div className="my-3 border-t-2 border-dashed border-pencil" />
        <dl className="space-y-1 text-sm text-ink">
          <div className="flex justify-between">
            <dt>Billed to</dt>
            <dd className="font-bold">{receipt.userName}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-ink-faint">{receipt.userEmail}</dt>
            <dd />
          </div>
          <div className="flex justify-between">
            <dt>Coins credited</dt>
            <dd className="font-bold text-orange">{receipt.tokens} 🪙</dd>
          </div>
          <div className="flex justify-between pt-2 font-heading text-lg">
            <dt>Total paid</dt>
            <dd className="font-bold">{formatMoney(receipt.amountCents)}</dd>
          </div>
        </dl>
        {receipt.note && <p className="mt-2 text-xs italic text-ink-soft">“{receipt.note}”</p>}
        <div className="my-3 border-t-2 border-dashed border-pencil" />
        <p className="micro text-ink-faint">Issued by {receipt.issuedBy ?? 'SketchLearn'}</p>
      </div>
      <div className="mt-4 flex gap-2">
        <SketchButton onClick={() => printReceipt(receipt)}>
          <Printer className="h-4 w-4" strokeWidth={2} /> Print / save PDF
        </SketchButton>
        <SketchButton variant="ghost" onClick={onClose}>
          Close
        </SketchButton>
      </div>
    </SketchModal>
  );
}

/* ------------------------------------------------------------------ */
/* Grant coins form (unchanged behavior)                               */
/* ------------------------------------------------------------------ */

function GrantForm({
  onReceipt,
  costPerCoinUsd,
  centsPerCoin,
}: {
  onReceipt: (r: Receipt) => void;
  costPerCoinUsd: number;
  /** the live sale price set on the Per-generation tab */
  centsPerCoin: number;
}) {
  const utils = trpc.useUtils();
  const usersList = trpc.users.list.useQuery({ limit: 200 });
  const [userId, setUserId] = useState<number | ''>('');
  const [tokens, setTokens] = useState(100);
  const [note, setNote] = useState('');
  /**
   * What those coins cost at the price set on the Per-generation tab. The
   * amount was a free-text box defaulting to $5.00, which meant every sale had
   * to be worked out by hand and disagreed with the price the rest of the page
   * is built on.
   */
  const listPrice = (tokens * centsPerCoin) / 100;
  /** Typing in the box takes it off the list price — a discount, a rounded
   *  bank transfer, whatever actually landed — and the reset puts it back. */
  const [override, setOverride] = useState<string | null>(null);
  const amount = override ?? listPrice.toFixed(2);
  const setAmount = (v: string) => setOverride(v);
  const offList = override != null && Math.abs(Number(override) - listPrice) > 0.005;

  const grant = trpc.finance.grantTokens.useMutation({
    onSuccess: (r) => {
      toast.success(`Credited ${r.tokens} 🪙 to ${r.userName} — receipt #${r.receiptNo}`);
      void utils.finance.overview.invalidate();
      void utils.users.list.invalidate();
      setNote('');
      onReceipt(r);
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  const submit = () => {
    if (userId === '') return toast.error('Pick who paid');
    const cents = Math.round(Number(amount) * 100);
    if (!Number.isFinite(cents) || cents < 0) return toast.error('That amount looks smudged');
    grant.mutate({ userId, tokens, amountCents: cents, note: note.trim() || undefined });
  };

  const estCost = tokens * costPerCoinUsd;
  const estProfit = (Number(amount) || 0) - estCost;

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <LabeledField label="Who paid">
        <SketchSelect
          value={String(userId)}
          onChange={(e) => setUserId(e.target.value ? Number(e.target.value) : '')}
        >
          <option value="">Pick a user…</option>
          {(usersList.data ?? []).map((u) => (
            <option key={u.id} value={u.id}>
              {u.name} — {u.email}
            </option>
          ))}
        </SketchSelect>
      </LabeledField>
      <LabeledField label="Coins to credit">
        <SketchInput
          type="number"
          min={1}
          max={100000}
          value={String(tokens)}
          onChange={(e) => setTokens(Math.max(1, Math.min(100000, Number(e.target.value) || 1)))}
        />
      </LabeledField>
      <LabeledField label="Amount paid (USD)">
        <div className="flex items-center gap-2">
          <SketchInput
            className="min-w-0 flex-1"
            aria-label="Amount paid in dollars"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder={listPrice.toFixed(2)}
          />
          {offList && (
            <button
              type="button"
              onClick={() => setOverride(null)}
              title={`Back to the list price for ${tokens} coins`}
              className="shrink-0 rounded-wobble-sm border-2 border-dashed border-pencil px-2 py-1 text-[0.65rem] font-bold text-ink-soft hover:border-ink hover:text-ink"
            >
              ${listPrice.toFixed(2)}
            </button>
          )}
        </div>
      </LabeledField>
      <LabeledField label="Note (on the receipt)">
        <SketchInput value={note} onChange={(e) => setNote(e.target.value)} placeholder="Bank transfer ref…" />
      </LabeledField>
      <p className="self-end pb-1 text-xs text-ink-faint">
        {tokens} 🪙 at {centsPerCoin.toFixed(2)}¢ = {fmtUsd(listPrice)}
        {offList && <span className="text-orange"> · charging {fmtUsd(Number(amount) || 0)}</span>}
        <br />
        those coins cost you ~{fmtUsd(estCost)} to honor →{' '}
        <span className={estProfit >= 0 ? 'font-bold text-green' : 'font-bold text-red'}>
          {fmtUsd(estProfit)} profit
        </span>{' '}
        (private)
      </p>
      <div className="flex items-end">
        <SketchButton variant="accent" loading={grant.isPending} onClick={submit} className="w-full">
          <ReceiptText className="h-4 w-4" strokeWidth={2} /> Credit + receipt
        </SketchButton>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Quick balance fix — remove (or add) credits, ledger adapts          */
/* ------------------------------------------------------------------ */

function BalanceFixForm() {
  const utils = trpc.useUtils();
  const usersList = trpc.users.list.useQuery({ limit: 200 });
  const [userId, setUserId] = useState<number | ''>('');
  const [direction, setDirection] = useState<'credit' | 'deduct'>('deduct');
  const [amount, setAmount] = useState(100);
  const [reason, setReason] = useState('balance correction');

  const adjust = trpc.users.creditTokens.useMutation({
    onSuccess: () => {
      toast.success(direction === 'deduct' ? `Removed ${amount} 🪙 — ledger updated` : `Added ${amount} 🪙 — ledger updated`);
      void utils.finance.overview.invalidate();
      void utils.users.list.invalidate();
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  const target = (usersList.data ?? []).find((u) => u.id === userId);

  return (
    <div className="mt-4 rounded-wobble-sm border-2 border-dashed border-pencil bg-paper p-4">
      <p className="mb-1 font-heading font-semibold text-ink">Fix a balance</p>
      <p className="mb-3 text-xs text-ink-soft">
        Handed out too many coins (even to yourself)? Take them back here — circulation, the
        liability figure, and the ledger above adapt immediately, so your gains and losses stay honest.
      </p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <LabeledField label="Whose balance">
          <SketchSelect
            value={String(userId)}
            onChange={(e) => setUserId(e.target.value ? Number(e.target.value) : '')}
          >
            <option value="">Pick a user…</option>
            {(usersList.data ?? []).map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} — {u.tokenBalance} 🪙
              </option>
            ))}
          </SketchSelect>
        </LabeledField>
        <LabeledField label="Direction">
          <SketchSelect
            value={direction}
            onChange={(e) => setDirection(e.target.value as 'credit' | 'deduct')}
          >
            <option value="deduct">− Remove coins</option>
            <option value="credit">+ Add coins</option>
          </SketchSelect>
        </LabeledField>
        <LabeledField label="Amount 🪙">
          <SketchInput
            type="number"
            min={1}
            value={String(amount)}
            onChange={(e) => setAmount(Math.max(1, Math.min(100000, Number(e.target.value) || 1)))}
          />
        </LabeledField>
        <LabeledField label="Reason (ledger)">
          <SketchInput value={reason} onChange={(e) => setReason(e.target.value)} />
        </LabeledField>
        <div className="flex items-end">
          <SketchButton
            variant={direction === 'deduct' ? 'danger' : 'accent'}
            className="w-full"
            loading={adjust.isPending}
            disabled={userId === '' || (direction === 'deduct' && !!target && amount > target.tokenBalance)}
            onClick={() =>
              userId !== '' &&
              adjust.mutate({ userId, amount, direction, reason: reason || 'balance correction' })
            }
          >
            <Scale className="h-4 w-4" strokeWidth={2} />
            {direction === 'deduct' ? `Remove ${amount}` : `Add ${amount}`} 🪙
          </SketchButton>
        </div>
      </div>
      {direction === 'deduct' && target && amount > target.tokenBalance && (
        <p className="mt-2 text-xs font-bold text-red">
          {target.name} only holds {target.tokenBalance} 🪙.
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

const TABS = [
  { id: 'generation', label: 'Per generation' },
  { id: 'sales', label: 'Sales desk' },
  { id: 'models', label: 'Model prices' },
  { id: 'income', label: 'Income' },
  { id: 'credits', label: 'Credits ledger' },
  { id: 'pricing', label: 'Set prices' },
] as const;
type TabId = (typeof TABS)[number]['id'];

type TicketSale = Overview['ticketSales'][number];

/* ------------------------------------------------------------------ */
/* Ticket receipt — what the moderator gets; never shows your cost     */
/* ------------------------------------------------------------------ */

function printTicketReceipt(s: TicketSale) {
  const w = window.open('', '_blank', 'width=420,height=640');
  if (!w) return;
  const date = new Date(s.createdAt).toLocaleString();
  w.document.write(`<!doctype html><html><head><title>Ticket receipt T-${s.ledgerId}</title>
<style>
  body { font-family: Georgia, serif; color: #2E2820; background: #FFFDF6; margin: 0; padding: 28px; }
  .box { border: 2px solid #2E2820; border-radius: 10px; padding: 20px 24px; max-width: 360px; margin: 0 auto; }
  h1 { font-size: 20px; margin: 0 0 2px; } .muted { color: #8B8071; font-size: 12px; }
  hr { border: none; border-top: 2px dashed #C9BFA9; margin: 14px 0; }
  table { width: 100%; font-size: 14px; border-collapse: collapse; }
  td { padding: 3px 0; } td:last-child { text-align: right; font-weight: bold; }
  .total td { font-size: 17px; padding-top: 8px; }
</style></head><body><div class="box">
  <h1>SketchLearn ✎</h1>
  <p class="muted">Ticket receipt · T-${String(s.ledgerId).padStart(5, '0')} · ${date}</p>
  <hr/>
  <table>
    <tr><td>Billed to</td><td>${s.userName}</td></tr>
    <tr><td class="muted">${s.userEmail}</td><td></td></tr>
    <tr><td>Customization tickets</td><td>${s.tickets}</td></tr>
    <tr class="total"><td>Total paid</td><td>${s.coinsPaid} 🪙</td></tr>
  </table>
  <hr/>
  <p class="muted">One ticket = one custom generation on the issuing repo · thank you for sketching with us</p>
</div><script>window.print()</script></body></html>`);
  w.document.close();
}

function TicketReceiptModal({ sale, onClose }: { sale: TicketSale; onClose: () => void }) {
  return (
    <SketchModal
      open
      onClose={onClose}
      title={`Ticket receipt T-${String(sale.ledgerId).padStart(5, '0')}`}
      maxWidth="max-w-[420px]"
    >
      <div className="rounded-wobble-sm border-2 border-ink bg-paper-3 p-4">
        <p className="font-display text-2xl text-ink">SketchLearn ✎</p>
        <p className="micro text-ink-faint">
          Ticket receipt · {new Date(sale.createdAt).toLocaleString()}
        </p>
        <div className="my-3 border-t-2 border-dashed border-pencil" />
        <dl className="space-y-1 text-sm text-ink">
          <div className="flex justify-between">
            <dt>Billed to</dt>
            <dd className="font-bold">{sale.userName}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-ink-faint">{sale.userEmail}</dt>
            <dd />
          </div>
          <div className="flex justify-between">
            <dt>Customization tickets</dt>
            <dd className="font-bold text-green">{sale.tickets}</dd>
          </div>
          <div className="flex justify-between pt-2 font-heading text-lg">
            <dt>Total paid</dt>
            <dd className="font-bold text-orange">{sale.coinsPaid} 🪙</dd>
          </div>
        </dl>
        <div className="my-3 border-t-2 border-dashed border-pencil" />
        <p className="micro text-ink-faint">One ticket = one custom generation on the issuing repo</p>
      </div>
      <div className="mt-4 flex gap-2">
        <SketchButton onClick={() => printTicketReceipt(sale)}>
          <Printer className="h-4 w-4" strokeWidth={2} /> Print / save PDF
        </SketchButton>
        <SketchButton variant="ghost" onClick={onClose}>
          Close
        </SketchButton>
      </div>
    </SketchModal>
  );
}

/* ------------------------------------------------------------------ */
/* Sell tickets to a moderator (with a private profit preview)         */
/* ------------------------------------------------------------------ */

function SellTicketsForm({
  ticketPriceCoins,
  packRate,
  estCostPerTicket,
  onReceipt,
}: {
  ticketPriceCoins: number;
  packRate: number;
  estCostPerTicket: number;
  /** hand the completed sale up so its receipt opens straight away */
  onReceipt: (sale: TicketSale) => void;
}) {
  const utils = trpc.useUtils();
  const usersList = trpc.users.list.useQuery({ limit: 200 });
  const [userId, setUserId] = useState<number | ''>('');
  const [count, setCount] = useState(5);

  const sell = trpc.tickets.sellToModerator.useMutation({
    onSuccess: async (r) => {
      toast.success(`Sold ${count} ticket${count === 1 ? '' : 's'} — ${r.tokenBalance} 🪙 left on their balance`);
      const email = target?.email;
      await utils.finance.overview.invalidate();
      void utils.users.list.invalidate();
      // A ticket sale already produced a receipt, but the only way to it was to
      // find the row in Transfers afterwards. Open it here, the way the coin
      // desk does — the sale is read back from the refreshed overview because
      // its ledger id is the server's to assign, not ours to guess.
      try {
        const fresh = await utils.finance.overview.fetch();
        const mine = fresh.ticketSales.filter((sale) => sale.userEmail === email);
        const newest = mine.reduce<TicketSale | null>(
          (best, sale) =>
            !best || new Date(sale.createdAt) > new Date(best.createdAt) ? sale : best,
          null,
        );
        if (newest) onReceipt(newest);
      } catch {
        // The sale itself went through; the receipt is still in Transfers.
      }
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  const mods = (usersList.data ?? []).filter((u) => u.role === 'moderator' || u.role === 'admin');
  const target = mods.find((u) => u.id === userId);
  const totalCoins = count * ticketPriceCoins;
  const valueUsd = (totalCoins * packRate) / 100;
  const estProfit = valueUsd - count * estCostPerTicket;
  const short = !!target && totalCoins > target.tokenBalance;

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <LabeledField label="Moderator">
        <SketchSelect
          value={String(userId)}
          onChange={(e) => setUserId(e.target.value ? Number(e.target.value) : '')}
        >
          <option value="">Pick a moderator…</option>
          {mods.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name} — {u.tokenBalance} 🪙
            </option>
          ))}
        </SketchSelect>
      </LabeledField>
      <LabeledField label="Tickets">
        <SketchInput
          type="number"
          min={1}
          max={500}
          value={String(count)}
          onChange={(e) => setCount(Math.max(1, Math.min(500, Number(e.target.value) || 1)))}
        />
      </LabeledField>
      <div className="flex flex-col justify-end pb-1 text-sm text-ink">
        <p>
          They pay <span className="font-bold text-orange">{totalCoins} 🪙</span> ≈ {fmtUsd(valueUsd)}
        </p>
        <p className="text-xs text-ink-faint">
          your est. profit: <span className={estProfit >= 0 ? 'font-bold text-green' : 'font-bold text-red'}>{fmtUsd(estProfit)}</span> (private)
        </p>
      </div>
      <div className="flex items-end">
        <SketchButton
          variant="accent"
          className="w-full"
          loading={sell.isPending}
          disabled={userId === '' || short}
          onClick={() => userId !== '' && sell.mutate({ userId, count })}
        >
          <ReceiptText className="h-4 w-4" strokeWidth={2} /> Sell {count} ticket
          {count === 1 ? '' : 's'} + receipt
        </SketchButton>
      </div>
      {short && (
        <p className="col-span-full -mt-2 text-xs font-bold text-red">
          {target?.name} only holds {target?.tokenBalance} 🪙 — that's not enough for {totalCoins} 🪙 of tickets.
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Set prices: coin packs + ticket price                               */
/* ------------------------------------------------------------------ */

function PricingEditor({
  packs,
  autoPrice,
  override,
}: {
  packs: { tokens: number; priceCents: number }[];
  autoPrice: number;
  override: number | null;
}) {
  const utils = trpc.useUtils();
  const [rows, setRows] = useState(
    packs.map((p) => ({ tokens: String(p.tokens), price: (p.priceCents / 100).toFixed(2) })),
  );
  const [mode, setMode] = useState<'auto' | 'custom'>(override ? 'custom' : 'auto');
  const [ticket, setTicket] = useState(String(override ?? autoPrice));

  const save = trpc.finance.setPricing.useMutation({
    onSuccess: (r) => {
      toast.success(`Prices saved — a ticket now sells for ${r.ticketPriceCoins} 🪙`);
      void utils.finance.overview.invalidate();
      void utils.tokens.packs.invalidate();
      void utils.tickets.price.invalidate();
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  const parsed = rows.map((r) => ({
    tokens: Math.round(Number(r.tokens)),
    priceCents: Math.round(Number(r.price) * 100),
  }));
  const rowsValid = parsed.every(
    (p) => Number.isFinite(p.tokens) && p.tokens >= 1 && Number.isFinite(p.priceCents) && p.priceCents >= 0,
  );
  const ticketValid = mode === 'auto' || (Number.isFinite(Number(ticket)) && Number(ticket) >= 1);

  /** The blended rate the current packs work out to, in cents per coin. */
  const rateFromPacks = (() => {
    const tokens = parsed.reduce((n, p) => n + p.tokens, 0);
    const cents = parsed.reduce((n, p) => n + p.priceCents, 0);
    return tokens > 0 ? cents / tokens : 0;
  })();
  const [perCoin, setPerCoin] = useState(() => rateFromPacks.toFixed(1));

  /** Put every pack on one rate, keeping each pack's coin count. */
  const applyPerCoin = (cents: number) => {
    setRows((rs) =>
      rs.map((r) => {
        const tokens = Number(r.tokens);
        return Number.isFinite(tokens) && tokens > 0
          ? { ...r, price: ((tokens * cents) / 100).toFixed(2) }
          : r;
      }),
    );
  };

  return (
    <div className="p-4">
      <h3 className="mb-1 font-heading text-lg font-semibold text-ink">What you charge</h3>
      <p className="mb-4 text-xs text-ink-soft">
        These are live prices: packs are what buyers pay for coins, and the ticket price is what
        a moderator pays (in coins) for one customization. Every chart on this page recalculates
        from what you set here.
      </p>

      {/* The packs ARE the coin price, but only indirectly — to make a coin
          cheaper you had to work out new dollar figures for every pack by
          hand. This sets the rate directly and rescales the packs to match,
          which is how the question is actually asked: "what should a coin
          cost?" */}
      <h4 className="mb-2 font-heading font-semibold text-ink">Price per coin</h4>
      <div className="mb-5 flex flex-wrap items-center gap-2 rounded-wobble-sm border-2 border-dashed border-pencil p-3">
        <SketchInput
          type="number"
          min={0}
          step="0.1"
          className="w-24"
          aria-label="Price per coin in cents"
          value={perCoin}
          onChange={(e) => {
            setPerCoin(e.target.value);
            const c = Number(e.target.value);
            if (Number.isFinite(c) && c >= 0) applyPerCoin(c);
          }}
        />
        <span className="text-sm text-ink-soft">¢ per 🪙</span>
        <span className="font-mono text-xs text-ink-faint">
          = ${((Number(perCoin || 0) * 100) / 100).toFixed(2)} per 100 🪙
          {Math.abs(Number(perCoin || 0) - rateFromPacks) > 0.05 && (
            <span className="ml-2 text-orange">was {rateFromPacks.toFixed(1)}¢</span>
          )}
        </span>
        <span className="ml-auto text-xs text-ink-faint">
          Every pack below rescales to this rate. Edit a pack afterwards to give it its own deal.
        </span>
      </div>

      <h4 className="mb-2 font-heading font-semibold text-ink">Coin packs</h4>
      <div className="flex flex-col gap-2">
        {rows.map((r, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <SketchInput
              type="number"
              min={1}
              className="w-28"
              value={r.tokens}
              onChange={(e) => setRows((rs) => rs.map((x, j) => (j === i ? { ...x, tokens: e.target.value } : x)))}
            />
            <span className="text-sm text-ink-soft">🪙 for $</span>
            <SketchInput
              className="w-24"
              value={r.price}
              onChange={(e) => setRows((rs) => rs.map((x, j) => (j === i ? { ...x, price: e.target.value } : x)))}
            />
            <span className="font-mono text-xs text-ink-faint">
              {Number(r.tokens) > 0 && Number(r.price) >= 0
                ? `= ${((Number(r.price) * 100) / Number(r.tokens)).toFixed(1)}¢ per coin`
                : ''}
            </span>
            {rows.length > 1 && (
              <button
                onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}
                className="rounded-wobble-sm border-2 border-dashed border-pencil px-2 py-0.5 text-xs font-bold text-ink-soft hover:border-red hover:text-red"
              >
                Remove
              </button>
            )}
          </div>
        ))}
      </div>
      {rows.length < 6 && (
        <button
          onClick={() => setRows((rs) => [...rs, { tokens: '100', price: '5.00' }])}
          className="mt-2 rounded-wobble-sm border-2 border-dashed border-pencil px-2 py-1 text-xs font-bold text-ink-soft hover:border-ink hover:text-ink"
        >
          + Add pack
        </button>
      )}

      <h4 className="mb-2 mt-5 font-heading font-semibold text-ink">Ticket price</h4>
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm text-ink">
          <input
            type="radio"
            name="ticket-mode"
            checked={mode === 'auto'}
            onChange={() => setMode('auto')}
          />
          Automatic — always covers the priciest deck (currently {autoPrice} 🪙)
        </label>
        <label className="flex items-center gap-2 text-sm text-ink">
          <input
            type="radio"
            name="ticket-mode"
            checked={mode === 'custom'}
            onChange={() => setMode('custom')}
          />
          Fixed:
        </label>
        <SketchInput
          type="number"
          min={1}
          className="w-24"
          aria-label="Ticket price in coins"
          value={ticket}
          disabled={mode === 'auto'}
          onChange={(e) => setTicket(e.target.value)}
        />
        <span className="text-sm text-ink-soft">🪙</span>
      </div>
      {mode === 'custom' && Number(ticket) < autoPrice && (
        <p className="mt-1 text-xs font-bold text-orange">
          Below the automatic price ({autoPrice} 🪙) a maxed-out deck earns you less than a
          coin-paid one would — check the Per-generation tab's guarantee after saving.
        </p>
      )}

      <div className="mt-4">
        <SketchButton
          variant="accent"
          loading={save.isPending}
          disabled={!rowsValid || !ticketValid}
          onClick={() =>
            save.mutate({
              packs: parsed,
              ticketPriceOverride: mode === 'auto' ? null : Math.round(Number(ticket)),
            })
          }
        >
          Save prices
        </SketchButton>
      </div>
    </div>
  );
}

/**
 * Prices, on the page where their consequences are drawn.
 *
 * The "Set prices" tab has the same two numbers, but changing them there means
 * leaving the chart that shows whether the change was a good idea. Here the
 * bars, the guarantee and the margin all redraw from what is typed.
 *
 * The margin field works backwards from the answer: given what this deck costs
 * to generate, it solves for the coin price that leaves the requested share as
 * profit — which is how the question is usually posed ("I want 90% margin"),
 * rather than guessing a rate and reading the margin off afterwards.
 */
function PerGenerationPrices({
  packs,
  ticketPriceCoins,
  ticketPriceOverride,
  deckCoins,
  deckCostUsd,
}: {
  packs: { tokens: number; priceCents: number }[];
  ticketPriceCoins: number;
  ticketPriceOverride: number | null | undefined;
  /** coins the configured deck charges a learner */
  deckCoins: number;
  /** what that deck costs in AI fees on an average model */
  deckCostUsd: number;
}) {
  const utils = trpc.useUtils();
  const currentRate = (() => {
    const t = packs.reduce((n, p) => n + p.tokens, 0);
    return t > 0 ? packs.reduce((n, p) => n + p.priceCents, 0) / t : 4;
  })();
  const [rate, setRate] = useState(currentRate.toFixed(2));
  const [ticket, setTicket] = useState(String(ticketPriceCoins));
  const [auto, setAuto] = useState(ticketPriceOverride == null);

  const save = trpc.finance.setPricing.useMutation({
    onSuccess: async () => {
      await utils.finance.overview.invalidate();
      void utils.tokens.packs.invalidate();
      toast.success('Prices saved');
    },
    onError: (e) => toast.error(e.message),
  });

  const rateNum = Number(rate);
  const valid = Number.isFinite(rateNum) && rateNum >= 0 && (auto || Number(ticket) >= 1);
  const incomeUsd = (deckCoins * rateNum) / 100;
  const marginPct = incomeUsd > 0 ? ((incomeUsd - deckCostUsd) / incomeUsd) * 100 : 0;

  /** Coin price that leaves `pct` of the sale as profit on THIS deck. */
  const rateForMargin = (pct: number) => {
    if (pct >= 100 || deckCoins <= 0) return null;
    const needUsd = deckCostUsd / (1 - pct / 100);
    return (needUsd * 100) / deckCoins;
  };

  return (
    <div className="mb-4 flex flex-wrap items-end gap-3 rounded-wobble-sm border-2 border-dashed border-pencil bg-paper p-3">
      <LabeledField label="Per coin">
        <div className="flex items-center gap-1">
          <SketchInput
            type="number"
            min={0}
            step="0.01"
            className="w-24"
            aria-label="Price per coin in cents"
            value={rate}
            onChange={(e) => setRate(e.target.value)}
          />
          <span className="text-sm text-ink-soft">¢</span>
        </div>
      </LabeledField>

      <LabeledField label="Ticket">
        <div className="flex items-center gap-1.5">
          <SketchInput
            type="number"
            min={1}
            className="w-20"
            aria-label="Ticket price in coins"
            value={auto ? String(ticketPriceCoins) : ticket}
            disabled={auto}
            onChange={(e) => setTicket(e.target.value)}
          />
          <span className="text-sm text-ink-soft">🪙</span>
          <label className="flex items-center gap-1 text-xs text-ink-soft">
            <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
            auto
          </label>
        </div>
      </LabeledField>

      <LabeledField label="Target margin">
        <div className="flex items-center gap-1">
          <SketchInput
            type="number"
            min={0}
            max={99}
            className="w-20"
            aria-label="Target profit margin percent"
            defaultValue={Math.round(marginPct)}
            onChange={(e) => {
              // Three decimals, not two: at low coin prices a hundredth of a
              // cent is a couple of margin points, so rounding harder made the
              // field miss the number that was just typed into it.
              const next = rateForMargin(Number(e.target.value));
              if (next != null && Number.isFinite(next)) setRate(next.toFixed(3));
            }}
          />
          <span className="text-sm text-ink-soft">%</span>
        </div>
      </LabeledField>

      <p className="pb-1 text-sm text-ink">
        This deck earns <span className="font-bold">{fmtUsd(incomeUsd)}</span>, costs{' '}
        <span className="font-bold text-red">~{fmtUsd(deckCostUsd)}</span> →{' '}
        <span className={`font-bold ${marginPct >= 0 ? 'text-green' : 'text-red'}`}>
          {marginPct.toFixed(1)}% margin
        </span>
        {Math.abs(rateNum - currentRate) > 0.005 && (
          <span className="text-ink-faint"> · unsaved, was {currentRate.toFixed(2)}¢</span>
        )}
      </p>

      <SketchButton
        variant="accent"
        size="sm"
        className="mb-0.5"
        loading={save.isPending}
        disabled={!valid}
        onClick={() =>
          save.mutate({
            // Every pack keeps its coin count and moves to the new rate.
            packs: packs.map((p) => ({
              tokens: p.tokens,
              priceCents: Math.round(p.tokens * rateNum),
            })),
            ticketPriceOverride: auto ? null : Math.round(Number(ticket)),
          })
        }
      >
        Save prices
      </SketchButton>
    </div>
  );
}

/**
 * The cost calculator's three inputs, kept between visits.
 *
 * They describe which deck you are pricing, and that rarely changes from one
 * visit to the next — someone checking margins on a 15-slide C2 deck wants the
 * same deck next time, not a reset to the 8-slide B1 default. Stored locally
 * rather than on the account: it is a view preference, not a platform setting,
 * and nothing else needs to know about it.
 */
const CALC_KEY = 'sketchlearn:finance:calc';

function loadCalc(): { slides: number; images: boolean; level: Level } {
  const base = { slides: 8, images: true, level: 'B1' as Level };
  if (typeof window === 'undefined') return base;
  try {
    const raw = window.localStorage.getItem(CALC_KEY);
    if (!raw) return base;
    const p = JSON.parse(raw) as Partial<{ slides: number; images: boolean; level: Level }>;
    return {
      slides:
        typeof p.slides === 'number' ? Math.min(15, Math.max(1, p.slides)) : base.slides,
      images: typeof p.images === 'boolean' ? p.images : base.images,
      level: p.level && LEVELS.includes(p.level) ? p.level : base.level,
    };
  } catch {
    return base;
  }
}

function saveCalc(next: { slides: number; images: boolean; level: Level }): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(CALC_KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable — the calculator still works, it just forgets */
  }
}

function FinanceBody() {
  const utils = trpc.useUtils();
  const overview = trpc.finance.overview.useQuery();
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [ticketReceipt, setTicketReceipt] = useState<TicketSale | null>(null);
  const [tab, setTab] = useState<TabId>('generation');

  // per-generation calculator
  const rememberedCalc = useMemo(() => loadCalc(), []);
  const [calcSlides, setCalcSlides] = useState(rememberedCalc.slides);
  const [calcImages, setCalcImages] = useState(rememberedCalc.images);
  const [calcLevel, setCalcLevel] = useState<Level>(rememberedCalc.level);

  // Written on every change rather than on leaving the page, so a reload or a
  // closed tab keeps the last thing that was actually typed.
  useEffect(() => {
    saveCalc({ slides: calcSlides, images: calcImages, level: calcLevel });
  }, [calcSlides, calcImages, calcLevel]);
  // "sell N coins" what-if
  const [sellCoins, setSellCoins] = useState(100);

  const refresh = trpc.finance.refreshPricing.useMutation({
    onSuccess: () => {
      toast.success('Model prices refreshed from the live feed ✓');
      void utils.finance.overview.invalidate();
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  const data = overview.data;

  const totalEstUsd = useMemo(
    () => (data?.usage ?? []).reduce((n, u) => n + u.estUsd, 0),
    [data],
  );

  // What one deck with the calculator's settings charges the user, in coins
  // (mirrors api/cost.ts estimateCost) and in dollars at TODAY'S pack prices
  // — forward-looking, so editing prices in "Set prices" moves these numbers.
  const packRate = useMemo(() => {
    if (!data) return 4;
    const t = data.packs.reduce((n, p) => n + p.tokens, 0);
    return t > 0 ? data.packs.reduce((n, p) => n + p.priceCents, 0) / t : 4;
  }, [data]);

  const calc = useMemo(() => {
    if (!data) return null;
    const mult = data.prices.levelMultiplier[calcLevel] ?? 1;
    const coins = Math.max(
      0,
      Math.ceil(
        (data.prices.perSlideBase * calcSlides +
          (calcImages ? data.prices.perImageSlide * calcSlides : 0)) *
          mult,
      ),
    );
    const chargeUsd = (coins * packRate) / 100;
    const ticketUsd = (data.ticketPriceCoins * packRate) / 100;
    return { coins, chargeUsd, ticketUsd };
  }, [data, packRate, calcSlides, calcImages, calcLevel]);

  // Estimated dollar cost of generating ONE deck's text on a model —
  // measured average tokens per call when we have real usage, else a
  // typical 8-slide deck (4k prompt + 6k written). The written half scales
  // with the slide count, so "Max deck" shows the true 15-slide cost.
  const modelCostAt = useMemo(() => {
    return (m: { id: string; inPerM: number; outPerM: number }, slides: number) => {
      const u = data?.usage.find((x) => x.priceId === m.id && x.calls > 0);
      const inTok = u ? u.inputTokens / u.calls : 4000;
      const outTok = ((u ? u.outputTokens / u.calls : 6000) * slides) / 8;
      return {
        costUsd: (inTok / 1e6) * m.inPerM + (outTok / 1e6) * m.outPerM,
        tokens: Math.round(inTok + outTok),
        measured: !!u,
      };
    };
  }, [data]);

  const perModel = useMemo(() => {
    if (!data) return [];
    return data.pricing.models.map((m) => {
      const c = modelCostAt(m, calcSlides);
      return {
        name: m.label,
        provider: m.provider,
        measured: c.measured,
        tokensPerDeck: c.tokens,
        costUsd: c.costUsd,
        // the ceiling reference: the biggest deck a ticket has to cover
        maxDeckUsd: modelCostAt(m, 15).costUsd,
      };
    });
  }, [data, modelCostAt, calcSlides]);

  // Private cost bases for the Sales desk: the average model cost of a
  // reference deck (8 slides, images, B1) spread over its coin charge, and
  // the average cost of the maxed-out deck a ticket must cover.
  /** What the deck configured above costs on an average model. */
  const avgDeckCostUsd = useMemo(() => {
    if (!data || data.pricing.models.length === 0) return 0;
    return (
      data.pricing.models.reduce((n, m) => n + modelCostAt(m, calcSlides).costUsd, 0) /
      data.pricing.models.length
    );
  }, [data, modelCostAt, calcSlides]);

  const salesBasis = useMemo(() => {
    if (!data || data.pricing.models.length === 0) return null;
    const avgAt = (slides: number) =>
      data.pricing.models.reduce((n, m) => n + modelCostAt(m, slides).costUsd, 0) /
      data.pricing.models.length;
    const multB1 = data.prices.levelMultiplier.B1 ?? 1;
    const refCoins = Math.max(
      1,
      Math.ceil((data.prices.perSlideBase * 8 + data.prices.perImageSlide * 8) * multB1),
    );
    return {
      costPerCoinUsd: avgAt(8) / refCoins,
      maxDeckCostUsd: avgAt(15),
    };
  }, [data, modelCostAt]);

  // Guarantee check: the most expensive possible deck (what a ticket must
  // cover) on the priciest model, with a conservative output-token bound.
  const worstCase = useMemo(() => {
    if (!data) return null;
    const cost = (m: { inPerM: number; outPerM: number }) =>
      (6000 / 1e6) * m.inPerM + (14000 / 1e6) * m.outPerM;
    const priciest = [...data.pricing.models].sort((a, b) => cost(b) - cost(a))[0];
    if (!priciest) return null;
    const ticketUsd = (data.ticketPriceCoins * packRate) / 100;
    return { model: priciest.label, costUsd: cost(priciest), profit: ticketUsd - cost(priciest) };
  }, [data, packRate]);

  if (overview.isLoading) {
    return (
      <div className="mx-auto w-full max-w-content px-4 py-8 lg:px-8">
        <SkeletonBlock lines={5} status="Balancing the books…" />
      </div>
    );
  }

  if (overview.isError || !data || !calc) {
    return (
      <div className="mx-auto w-full max-w-content px-4 py-16 text-center lg:px-8">
        <p className="font-display text-3xl text-ink">The ledger smudged itself.</p>
        <p className="mt-1 text-sm text-ink-soft">{errMsg(overview.error)}</p>
        <SketchButton className="mt-4" onClick={() => overview.refetch()}>
          Try again
        </SketchButton>
      </div>
    );
  }

  // One list of every transfer — coin sales and ticket sales together, with
  // the private cost/profit basis attached to each row.
  const transfers = salesBasis
    ? [
        ...data.recentReceipts.map((r) => {
          const costUsd = r.tokens * salesBasis.costPerCoinUsd;
          return {
            key: `c${r.receiptNo}`,
            ref: `#${String(r.receiptNo).padStart(5, '0')}`,
            kind: 'coins' as const,
            userName: r.userName,
            what: `${r.tokens} 🪙 coins`,
            soldFor: formatMoney(r.amountCents),
            costUsd,
            profitUsd: r.amountCents / 100 - costUsd,
            createdAt: r.createdAt,
            openReceipt: () => setReceipt(r),
          };
        }),
        ...data.ticketSales.map((s) => {
          const costUsd = s.tickets * salesBasis.maxDeckCostUsd;
          return {
            key: `t${s.ledgerId}`,
            ref: `T-${String(s.ledgerId).padStart(5, '0')}`,
            kind: 'tickets' as const,
            userName: s.userName,
            what: `${s.tickets} ticket${s.tickets === 1 ? '' : 's'}`,
            soldFor: `${s.coinsPaid} 🪙`,
            costUsd,
            profitUsd: (s.coinsPaid * packRate) / 100 - costUsd,
            createdAt: s.createdAt,
            openReceipt: () => setTicketReceipt(s),
          };
        }),
      ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    : [];

  // Chart reference values: average AI cost of the configured deck, what the
  // user pays for it, one ticket, and a 100-coin sale. The log axis spans
  // from just under the cheapest bar to just over the highest line.
  const avgCostUsd = perModel.length
    ? perModel.reduce((n, m) => n + m.costUsd, 0) / perModel.length
    : 0;
  const hundredCoinsUsd = (100 * packRate) / 100;
  const perGenMargin = calc.chargeUsd - avgCostUsd;
  const decksPer100 = calc.coins > 0 ? Math.floor(100 / calc.coins) : 0;
  const costOf100Coins = decksPer100 * avgCostUsd;
  const minCostUsd = perModel.length ? Math.min(...perModel.map((m) => m.costUsd)) : 0.001;
  const chartFloor = Math.max(0.0005, Number((minCostUsd / 2).toPrecision(1)));
  const chartCeiling = Math.max(calc.chargeUsd, calc.ticketUsd, hundredCoinsUsd) * 1.8;

  // Reference lines, lowest first. Lines that land on (nearly) the same value
  // — e.g. a maxed-out deck charges exactly the auto ticket price — are drawn
  // once with a combined label, and remaining close neighbours get their
  // labels nudged apart so nothing overlaps.
  const refLines = (() => {
    const raw = [
      { key: 'avg', value: avgCostUsd, color: '#5C5347', dash: '3 4', label: `avg cost ${fmtUsd(avgCostUsd)}` },
      { key: 'coin', value: calc.chargeUsd, color: '#3F74D6', dash: '7 4', label: `user pays ${calc.coins} 🪙 = ${fmtUsd(calc.chargeUsd)}` },
      { key: 'ticket', value: calc.ticketUsd, color: '#4C9A5C', dash: '7 4', label: `1 ticket = ${fmtUsd(calc.ticketUsd)}` },
      { key: 'c100', value: hundredCoinsUsd, color: '#8566D4', dash: '7 4', label: `100 🪙 sold = ${fmtUsd(hundredCoinsUsd)}` },
    ]
      .filter((l) => l.value > 0)
      .sort((a, b) => a.value - b.value);

    const merged: (typeof raw[number] & { dy: number })[] = [];
    for (const line of raw) {
      const prev = merged[merged.length - 1];
      if (prev && Math.abs(prev.value - line.value) / line.value < 0.02) {
        // same height — one line, both names, neutral ink so neither colour lies
        prev.label = `${prev.label.replace(/ = \$[\d.]+$/, '')} / ${line.label.replace(/^1 /, '')}`;
        prev.color = '#2E2820';
        continue;
      }
      const tooClose = prev && line.value / prev.value < 1.7;
      merged.push({ ...line, dy: tooClose ? prev.dy - 13 : 0 });
    }
    return merged;
  })();

  const pricingAge = formatRelative(new Date(data.pricing.updatedAt));
  const liabilityUsd = (data.circulationTokens * data.centsPerCoin) / 100;
  const led = data.ledger;
  const ledgerRows = [
    { label: 'Purchased (money in)', coins: led.purchased, dir: 'in' as const },
    { label: 'Admin-granted (free)', coins: led.adminGranted, dir: 'in' as const },
    { label: 'Starting balances', coins: led.starting, dir: 'in' as const },
    { label: 'Refunds', coins: led.refunds, dir: 'in' as const },
    { label: 'Other credits', coins: led.otherCredits, dir: 'in' as const },
    { label: 'Spent on generations', coins: led.spentOnGenerations, dir: 'out' as const },
    { label: 'Spent on tickets', coins: led.ticketCoins, dir: 'out' as const },
    { label: 'Admin-removed', coins: led.adminRemoved, dir: 'out' as const },
  ].filter((r) => r.coins > 0);
  const ledgerMax = Math.max(1, ...ledgerRows.map((r) => r.coins));

  return (
    <div className="mx-auto flex w-full max-w-content flex-col gap-8 px-4 py-8 lg:px-8">
      {/* Back to Home, not to Projects. Finance has its own tile on the hub
          now, so Projects is no longer the way in and sending people there on
          the way out drops them on a shelf holding the one thing they just
          left. Every other admin page goes back to Home too. */}
      <HubHeader
        backTo="/admin"
        backLabel="Home"
        title="Finance"
        blurb="Your income, your expenses, and what every generation really costs."
        chip={
          <span className="flex h-9 w-9 items-center justify-center rounded-full border-2 border-ink bg-green-soft">
            <Landmark className="h-4 w-4 text-ink" strokeWidth={2} />
          </span>
        }
      />

      {/* headline: money in, money out, margin, outstanding promise */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <SketchCard borderStyle="dashed" className="p-4 text-center">
          <p className="font-display text-3xl font-bold text-green">{formatMoney(data.revenueCents)}</p>
          <p className="micro text-ink-faint">collected from coin sales</p>
        </SketchCard>
        <SketchCard borderStyle="dashed" index={1} className="p-4 text-center">
          <p className="font-display text-3xl font-bold text-red">~{fmtUsd(totalEstUsd)}</p>
          <p className="micro text-ink-faint">estimated API cost (all time)</p>
        </SketchCard>
        <SketchCard borderStyle="dashed" index={2} className="p-4 text-center">
          <p className="font-display text-3xl font-bold text-ink">
            {fmtUsd(data.revenueCents / 100 - totalEstUsd)}
          </p>
          <p className="micro text-ink-faint">margin so far</p>
        </SketchCard>
        <SketchCard borderStyle="dashed" index={3} className="p-4 text-center">
          <p className="font-display text-3xl font-bold text-orange">
            {data.circulationTokens.toLocaleString()} 🪙
          </p>
          <p className="micro text-ink-faint">in circulation ≈ {fmtUsd(liabilityUsd)} of unused generations</p>
        </SketchCard>
      </div>

      {/* paginated analytics */}
      <SketchCard borderStyle="solid" className="p-0">
        <div className="flex flex-wrap items-center gap-2 border-b-2 border-ink bg-yellow px-4 py-3">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={
                tab === t.id
                  ? 'rounded-wobble-sm border-2 border-ink bg-paper-3 px-3 py-1 text-xs font-bold uppercase tracking-wider text-ink shadow-offset'
                  : 'rounded-wobble-sm border-2 border-dashed border-ink/40 px-3 py-1 text-xs font-bold uppercase tracking-wider text-ink/70 hover:border-ink hover:text-ink'
              }
            >
              {t.label}
            </button>
          ))}
          <SketchButton
            variant="secondary"
            size="sm"
            className="ml-auto"
            loading={refresh.isPending}
            onClick={() => refresh.mutate()}
          >
            <RefreshCw className="h-3.5 w-3.5" strokeWidth={2} /> Refresh prices
          </SketchButton>
        </div>

        {/* ---------------- tab 1: per generation ---------------- */}
        {tab === 'generation' && (
          <div className="p-4">
            <h3 className="font-heading text-lg font-semibold text-ink">
              What a presentation costs you vs what it earns
            </h3>
            <p className="mb-3 text-xs text-ink-soft">
              Orange bars: what each model charges YOU in AI fees to generate the deck configured
              below. The dotted lines are money coming in — every line above the bars is profit.
              Set what you charge in the second row and everything here redraws before you save.
            </p>

            {/* calculator */}
            <div className="mb-4 flex flex-wrap items-end gap-3 rounded-wobble-sm border-2 border-dashed border-pencil bg-paper p-3">
              <LabeledField label="Slides">
                <SketchInput
                  type="number"
                  min={1}
                  max={15}
                  className="w-20"
                  value={String(calcSlides)}
                  onChange={(e) => setCalcSlides(Math.max(1, Math.min(15, Number(e.target.value) || 1)))}
                />
              </LabeledField>
              <LabeledField label="Images">
                <SketchSelect value={calcImages ? 'yes' : 'no'} onChange={(e) => setCalcImages(e.target.value === 'yes')}>
                  <option value="yes">With images</option>
                  <option value="no">Text only</option>
                </SketchSelect>
              </LabeledField>
              <LabeledField label="Level">
                <SketchSelect value={calcLevel} onChange={(e) => setCalcLevel(e.target.value as Level)}>
                  {LEVELS.map((l) => (
                    <option key={l} value={l}>{l}</option>
                  ))}
                </SketchSelect>
              </LabeledField>
              <SketchButton
                variant="secondary"
                size="sm"
                className="mb-0.5"
                onClick={() => {
                  setCalcSlides(15);
                  setCalcImages(true);
                  setCalcLevel('C2');
                }}
              >
                Max deck (what a ticket covers)
              </SketchButton>
              <p className="pb-1 text-sm text-ink">
                This deck charges{' '}
                <span className="font-bold text-orange">{calc.coins} 🪙</span> ≈{' '}
                <span className="font-bold">{fmtUsd(calc.chargeUsd)}</span>
                <span className="text-ink-faint"> · one ticket sells for </span>
                <span className="font-bold text-green">{data.ticketPriceCoins} 🪙 ≈ {fmtUsd(calc.ticketUsd)}</span>
              </p>
            </div>

            <PerGenerationPrices
              packs={data.packs}
              ticketPriceCoins={data.ticketPriceCoins}
              ticketPriceOverride={data.ticketPriceOverride}
              deckCoins={calc.coins}
              deckCostUsd={avgDeckCostUsd}
            />

            {/* ticket guarantee */}
            {worstCase && (
              <div
                className={`mb-4 rounded-wobble-sm border-2 px-4 py-2.5 ${
                  worstCase.profit >= 0 ? 'border-green bg-green-soft' : 'border-red bg-red-soft'
                }`}
              >
                <p className="text-sm text-ink">
                  <span className="font-heading font-bold">
                    {worstCase.profit >= 0 ? 'Ticket guarantee holds ✓' : 'Ticket guarantee BROKEN ✗'}
                  </span>{' '}
                  The biggest deck we offer (15 slides, images, top level) on the priciest model
                  ({worstCase.model}, generously estimated at ~{fmtUsd(worstCase.costUsd)}) vs a
                  ticket at {fmtUsd(calc.ticketUsd)} →{' '}
                  <span className={`font-bold ${worstCase.profit >= 0 ? 'text-green' : 'text-red'}`}>
                    {worstCase.profit >= 0 ? 'at least ' : ''}
                    {fmtUsd(worstCase.profit)} {worstCase.profit >= 0 ? 'profit per ticket' : 'LOSS per ticket'}
                  </span>
                  {worstCase.profit < 0 && ' — raise the ticket price in "Set prices".'}
                </p>
              </div>
            )}

            <div className="h-[420px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={perModel.map((m) => ({
                    name: m.name.replace(' (via OpenRouter)', ' (OR)'),
                    'AI cost': Number(m.costUsd.toFixed(4)),
                  }))}
                  margin={{ top: 10, right: 196, bottom: 62, left: 4 }}
                >
                  <CartesianGrid stroke="#C9BFA9" strokeDasharray="4 6" vertical={false} />
                  <XAxis
                    dataKey="name"
                    interval={0}
                    angle={-28}
                    textAnchor="end"
                    height={64}
                    tick={{ ...AXIS_TICK, fontSize: 12, fontFamily: 'inherit' }}
                    axisLine={AXIS_LINE}
                    tickLine={false}
                  />
                  <YAxis
                    // log scale: your revenue is 20-100x one deck's AI bill, so a
                    // linear axis would flatten every bar to nothing
                    scale="log"
                    domain={[chartFloor, chartCeiling]}
                    allowDataOverflow
                    tick={AXIS_TICK}
                    axisLine={AXIS_LINE}
                    tickLine={false}
                    width={62}
                    tickFormatter={(v: number) => (v >= 1 ? `$${v}` : `$${v}`)}
                  />
                  <Tooltip content={<CostTooltip unit="$" />} cursor={{ fill: '#F4EBD6' }} />
                  <Bar dataKey="AI cost" fill="#EF8A3C" fillOpacity={0.9} stroke="#2E2820" strokeWidth={1.5} radius={[4, 4, 0, 0]}>
                    <LabelList
                      dataKey="AI cost"
                      position="top"
                      formatter={(v: number) => fmtUsd(v)}
                      style={{ fill: '#5C5347', fontSize: 10, fontFamily: 'monospace' }}
                    />
                  </Bar>
                  {refLines.map((l) => (
                    <ReferenceLine
                      key={l.key}
                      y={Number(l.value.toFixed(4))}
                      stroke={l.color}
                      strokeWidth={2}
                      strokeDasharray={l.dash}
                      label={{
                        value: l.label,
                        position: 'right',
                        fill: l.color,
                        fontSize: 11,
                        dy: l.dy,
                      }}
                    />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
            <p className="micro mt-1 text-center text-ink-faint">
              Vertical scale is logarithmic — each gridline is 10× the one below, so cent-sized
              costs and dollar-sized income both stay visible.
            </p>

            {/* the two readings: per generation, and per 100 coins */}
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div className="rounded-wobble-sm border-2 border-dashed border-blue bg-blue-soft/40 p-3">
                <p className="font-heading font-semibold text-ink">Average per generation</p>
                <p className="mt-1 text-sm text-ink">
                  This deck costs you <span className="font-bold text-red">~{fmtUsd(avgCostUsd)}</span> on
                  an average model and the user pays{' '}
                  <span className="font-bold text-orange">{calc.coins} 🪙</span> ={' '}
                  <span className="font-bold">{fmtUsd(calc.chargeUsd)}</span> →{' '}
                  <span className={perGenMargin >= 0 ? 'font-bold text-green' : 'font-bold text-red'}>
                    {fmtUsd(perGenMargin)} kept
                  </span>
                  {perGenMargin > 0 && avgCostUsd > 0 && (
                    <span className="text-ink-faint"> ({(calc.chargeUsd / avgCostUsd).toFixed(0)}× what it cost)</span>
                  )}
                </p>
              </div>
              <div className="rounded-wobble-sm border-2 border-dashed border-purple bg-purple-soft/40 p-3">
                <p className="font-heading font-semibold text-ink">Per 100 coins sold</p>
                <p className="mt-1 text-sm text-ink">
                  100 🪙 sell for <span className="font-bold text-green">{fmtUsd(hundredCoinsUsd)}</span> and
                  buy <span className="font-bold">{decksPer100}</span> deck
                  {decksPer100 === 1 ? '' : 's'} this size, costing you{' '}
                  <span className="font-bold text-red">~{fmtUsd(costOf100Coins)}</span> →{' '}
                  <span className={hundredCoinsUsd - costOf100Coins >= 0 ? 'font-bold text-green' : 'font-bold text-red'}>
                    {fmtUsd(hundredCoinsUsd - costOf100Coins)} kept
                  </span>
                  {calc.coins > 0 && (
                    <span className="text-ink-faint">
                      {' '}
                      · {calc.coins} 🪙 per generation, ~{(calc.coins / calcSlides).toFixed(1)} 🪙 per slide
                    </span>
                  )}
                </p>
              </div>
            </div>

            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b-2 border-ink text-left font-heading text-xs uppercase tracking-wider text-ink-soft">
                    <th className="py-1.5 pr-3">Model</th>
                    <th className="py-1.5 pr-3 text-right">Tokens / deck</th>
                    <th className="py-1.5 pr-3 text-right">Costs you ({calcSlides} sl.)</th>
                    <th className="py-1.5 pr-3 text-right">Max deck (15 sl.)</th>
                    <th className="py-1.5 pr-3 text-right">Margin (coin-paid)</th>
                    <th className="py-1.5 text-right">Margin (ticketed)</th>
                  </tr>
                </thead>
                <tbody>
                  {perModel.map((m) => (
                    <tr key={m.name} className="border-b border-dashed border-pencil text-ink">
                      <td className="py-1.5 pr-3">
                        <span className="font-heading font-semibold">{m.name}</span>{' '}
                        <span className="text-xs text-ink-faint">
                          {m.provider}
                          {m.measured ? ' · measured' : ' · typical deck'}
                        </span>
                      </td>
                      <td className="py-1.5 pr-3 text-right font-mono">{m.tokensPerDeck.toLocaleString()}</td>
                      <td className="py-1.5 pr-3 text-right font-mono">~{fmtUsd(m.costUsd)}</td>
                      <td className="py-1.5 pr-3 text-right font-mono text-ink-soft">~{fmtUsd(m.maxDeckUsd)}</td>
                      <td className={`py-1.5 pr-3 text-right font-mono font-bold ${calc.chargeUsd - m.costUsd >= 0 ? 'text-green' : 'text-red'}`}>
                        {fmtUsd(calc.chargeUsd - m.costUsd)}
                      </td>
                      <td className={`py-1.5 text-right font-mono font-bold ${calc.ticketUsd - m.costUsd >= 0 ? 'text-green' : 'text-red'}`}>
                        {fmtUsd(calc.ticketUsd - m.costUsd)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="micro mt-2 text-ink-faint">
              Text cost only — image generation isn't metered yet, so decks with images cost a
              little more than shown. Coin value uses today's pack prices
              ({packRate.toFixed(1)}¢ per coin).
            </p>

            {/* what-if: sell N coins */}
            <div className="mt-5 rounded-wobble-sm border-2 border-dashed border-pencil bg-paper p-4">
              <p className="mb-1 font-heading font-semibold text-ink">What if I sell…</p>
              <div className="flex flex-wrap items-center gap-2">
                <SketchInput
                  type="number"
                  min={1}
                  className="w-28"
                  value={String(sellCoins)}
                  onChange={(e) => setSellCoins(Math.max(1, Math.min(1000000, Number(e.target.value) || 1)))}
                />
                <span className="text-sm text-ink">
                  coins — and every one of them gets spent on decks like the one above?
                </span>
              </div>
              {(() => {
                const revenue = (sellCoins * packRate) / 100;
                const decks = calc.coins > 0 ? Math.floor(sellCoins / calc.coins) : 0;
                const costs = perModel.map((m) => m.costUsd);
                const cheap = decks * Math.min(...costs);
                const dear = decks * Math.max(...costs);
                const bestProfit = revenue - cheap;
                const worstProfit = revenue - dear;
                return (
                  <p className="mt-2 text-sm text-ink">
                    You collect <span className="font-bold text-green">{fmtUsd(revenue)}</span>. Those
                    coins buy <span className="font-bold">{decks}</span> generations, costing you{' '}
                    {fmtUsd(cheap)}–{fmtUsd(dear)} depending on which model answers →{' '}
                    <span className={`font-bold ${worstProfit >= 0 ? 'text-green' : 'text-red'}`}>
                      {worstProfit >= 0
                        ? `${fmtUsd(worstProfit)}–${fmtUsd(bestProfit)} profit`
                        : `between ${fmtUsd(worstProfit)} and ${fmtUsd(bestProfit)} — you'd be at a loss on pricier models`}
                    </span>
                    . Every unspent coin is pure margin.
                  </p>
                );
              })()}
            </div>
          </div>
        )}

        {/* ---------------- tab 2: model prices ---------------- */}
        {tab === 'models' && (
          <div className="p-4">
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <h3 className="font-heading text-lg font-semibold text-ink">
                Raw model prices <span className="text-sm font-normal text-ink-faint">(USD per 1M tokens)</span>
              </h3>
              <Chip kind="neutral" className="border-ink bg-paper-3">
                {data.pricing.source === 'web' ? `refreshed ${pricingAge}` : `seed prices · ${pricingAge}`}
              </Chip>
            </div>
            <p className="mb-3 text-xs text-ink-soft">
              "Input" is the prompt we send the model; "output" is the text it writes back.
              Prices are per one million tokens (≈ 750,000 words) — one deck uses only a tiny
              slice of that; see the Per-generation tab for what a single deck costs.
            </p>
            <div style={{ height: data.pricing.models.length * 44 + 60 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={data.pricing.models.map((m) => ({ name: m.label, Input: m.inPerM, Output: m.outPerM }))}
                  layout="vertical"
                  margin={{ top: 4, right: 24, bottom: 0, left: 8 }}
                  barGap={2}
                >
                  <CartesianGrid stroke="#C9BFA9" strokeDasharray="4 6" horizontal={false} />
                  <XAxis type="number" tick={AXIS_TICK} axisLine={AXIS_LINE} tickLine={false} tickFormatter={(v: number) => `$${v}`} />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={170}
                    tick={{ ...AXIS_TICK, fontSize: 14, fontFamily: 'inherit' }}
                    axisLine={AXIS_LINE}
                    tickLine={false}
                  />
                  <Tooltip content={<CostTooltip />} cursor={{ fill: '#F4EBD6' }} />
                  <Legend wrapperStyle={{ fontSize: 13 }} />
                  <Bar dataKey="Input" fill="#EF8A3C" fillOpacity={0.8} stroke="#2E2820" strokeWidth={2} radius={[0, 4, 4, 0]} />
                  <Bar dataKey="Output" fill="#3F74D6" fillOpacity={0.8} stroke="#2E2820" strokeWidth={2} radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b-2 border-ink text-left font-heading text-xs uppercase tracking-wider text-ink-soft">
                    <th className="py-1.5 pr-3">Model</th>
                    <th className="py-1.5 pr-3">Provider</th>
                    <th className="py-1.5 pr-3 text-right">Input / 1M</th>
                    <th className="py-1.5 text-right">Output / 1M</th>
                  </tr>
                </thead>
                <tbody>
                  {data.pricing.models.map((m) => (
                    <tr key={m.id} className="border-b border-dashed border-pencil text-ink">
                      <td className="py-1.5 pr-3 font-heading font-semibold">{m.label}</td>
                      <td className="py-1.5 pr-3 text-ink-soft">{m.provider}</td>
                      <td className="py-1.5 pr-3 text-right font-mono">${m.inPerM.toFixed(2)}</td>
                      <td className="py-1.5 text-right font-mono">${m.outPerM.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ---------------- tab 3: income ---------------- */}
        {tab === 'income' && (
          <div className="p-4">
            <h3 className="mb-3 font-heading text-lg font-semibold text-ink">Money coming in</h3>
            <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
              <SketchCard borderStyle="dashed" className="p-3 text-center">
                <p className="font-display text-2xl font-bold text-green">{formatMoney(data.revenueCents)}</p>
                <p className="micro text-ink-faint">from coin sales</p>
              </SketchCard>
              <SketchCard borderStyle="dashed" index={1} className="p-3 text-center">
                <p className="font-display text-2xl font-bold text-orange">{data.purchasedTokens.toLocaleString()} 🪙</p>
                <p className="micro text-ink-faint">coins sold</p>
              </SketchCard>
              <SketchCard borderStyle="dashed" index={2} className="p-3 text-center">
                <p className="font-display text-2xl font-bold text-ink">{led.ticketCoins.toLocaleString()} 🪙</p>
                <p className="micro text-ink-faint">
                  collected from tickets ≈ {fmtUsd((led.ticketCoins * data.centsPerCoin) / 100)}
                </p>
              </SketchCard>
              <SketchCard borderStyle="dashed" index={3} className="p-3 text-center">
                <p className="font-display text-2xl font-bold text-ink">{data.recentReceipts.length}</p>
                <p className="micro text-ink-faint">recent receipts (below)</p>
              </SketchCard>
            </div>
            {data.monthlyRevenue.length === 0 ? (
              <p className="py-6 text-center font-display text-2xl text-ink-faint">No credited sales yet 🪙</p>
            ) : (
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={data.monthlyRevenue.map((m) => ({ month: m.month, USD: m.cents / 100 }))}
                    margin={{ top: 8, right: 12, bottom: 0, left: -14 }}
                  >
                    <CartesianGrid stroke="#C9BFA9" strokeDasharray="4 6" vertical={false} />
                    <XAxis dataKey="month" tick={AXIS_TICK} axisLine={AXIS_LINE} tickLine={false} />
                    <YAxis tick={AXIS_TICK} axisLine={AXIS_LINE} tickLine={false} tickFormatter={(v: number) => `$${v}`} />
                    <Tooltip content={<CostTooltip unit="$" />} cursor={{ fill: '#F4EBD6' }} />
                    <Bar dataKey="USD" fill="#4C9A5C" fillOpacity={0.75} stroke="#2E2820" strokeWidth={2} radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
            <p className="micro mt-2 text-ink-faint">
              Coin sales are real dollars (credited payments + Finance receipts). Ticket income is
              collected in coins moderators already bought, valued at your blended sale rate — it's
              not counted twice as dollars.
            </p>
          </div>
        )}

        {/* ---------------- tab 4: credits ledger ---------------- */}
        {tab === 'credits' && (
          <div className="p-4">
            <h3 className="mb-1 font-heading text-lg font-semibold text-ink">
              Every coin, accounted for
            </h3>
            <p className="mb-4 text-xs text-ink-soft">
              {data.circulationTokens.toLocaleString()} 🪙 are sitting in user balances right now —
              about {fmtUsd(liabilityUsd)} of generations you've promised but not yet paid API costs
              for. Coins granted free (including to yourself) create that obligation without
              matching income, so they're tracked separately below.
            </p>
            <div className="flex flex-col gap-2">
              {ledgerRows.map((r) => (
                <div key={r.label} className="flex items-center gap-3">
                  <span className="w-48 shrink-0 text-sm font-heading font-semibold text-ink">
                    {r.label}
                  </span>
                  <div className="h-5 flex-1 overflow-hidden rounded-full border-2 border-ink bg-paper-2">
                    <div
                      className={r.dir === 'in' ? 'h-full bg-green/70' : 'h-full bg-orange/80'}
                      style={{ width: `${Math.max(2, (r.coins / ledgerMax) * 100)}%` }}
                    />
                  </div>
                  <span className="w-40 shrink-0 text-right font-mono text-sm text-ink">
                    {r.coins.toLocaleString()} 🪙
                    <span className="text-xs text-ink-faint"> ≈ {fmtUsd((r.coins * data.centsPerCoin) / 100)}</span>
                  </span>
                </div>
              ))}
            </div>
            <div className="mt-3 flex gap-4 text-xs text-ink-soft">
              <span className="flex items-center gap-1.5">
                <span className="h-3 w-3 rounded-full border-2 border-ink bg-green/70" /> coins entering circulation
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-3 w-3 rounded-full border-2 border-ink bg-orange/80" /> coins leaving circulation
              </span>
            </div>
            <BalanceFixForm />
          </div>
        )}

        {/* ---------------- tab 2: sales desk ---------------- */}
        {tab === 'sales' && salesBasis && (
          <div className="p-4">
            <h3 className="font-heading text-lg font-semibold text-ink">
              Sales desk — coins and tickets
            </h3>
            <p className="mb-4 text-xs text-ink-soft">
              Every transfer you've made, what it cost you, and what you kept. The cost and profit
              columns are yours alone — a receipt printed from any row shows the buyer only what
              they bought and what they paid.
            </p>

            {/* the two things you can sell */}
            <div className="mb-5 grid gap-4 lg:grid-cols-2">
              <div className="rounded-wobble-sm border-2 border-dashed border-pencil bg-paper p-3">
                <p className="mb-2 font-heading font-semibold text-ink">Sell coins (against a payment)</p>
                <GrantForm
                  onReceipt={setReceipt}
                  costPerCoinUsd={salesBasis.costPerCoinUsd}
                  centsPerCoin={packRate}
                />
              </div>
              <div className="rounded-wobble-sm border-2 border-dashed border-pencil bg-paper p-3">
                <p className="mb-2 font-heading font-semibold text-ink">
                  Sell tickets{' '}
                  <span className="text-xs font-normal text-ink-soft">
                    (paid from the moderator's coins, {data.ticketPriceCoins} 🪙 each)
                  </span>
                </p>
                <SellTicketsForm
                  ticketPriceCoins={data.ticketPriceCoins}
                  packRate={packRate}
                  estCostPerTicket={salesBasis.maxDeckCostUsd}
                  onReceipt={setTicketReceipt}
                />
              </div>
            </div>

            {/* one table of every transfer */}
            <h4 className="mb-2 font-heading font-semibold text-ink">Transfers</h4>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b-2 border-ink text-left font-heading text-xs uppercase tracking-wider text-ink-soft">
                    <th className="py-1.5 pr-3">Ref</th>
                    <th className="py-1.5 pr-3">Buyer</th>
                    <th className="py-1.5 pr-3">What</th>
                    <th className="py-1.5 pr-3 text-right">Sold for</th>
                    <th className="py-1.5 pr-3 text-right">Cost to me</th>
                    <th className="py-1.5 pr-3 text-right">I earned</th>
                    <th className="py-1.5 pr-3 text-right">When</th>
                    <th className="py-1.5 text-right">Receipt</th>
                  </tr>
                </thead>
                <tbody>
                  {transfers.length === 0 && (
                    <tr>
                      <td colSpan={8} className="py-4 text-center font-display text-2xl text-ink-faint">
                        No transfers yet 🧾
                      </td>
                    </tr>
                  )}
                  {transfers.map((t) => (
                    <tr key={t.key} className="border-b border-dashed border-pencil text-ink">
                      <td className="py-1.5 pr-3 font-mono text-xs text-ink-faint">{t.ref}</td>
                      <td className="py-1.5 pr-3 font-heading font-semibold">{t.userName}</td>
                      <td className="py-1.5 pr-3">
                        <Chip kind={t.kind === 'coins' ? 'neutral' : 'moderator'}>{t.what}</Chip>
                      </td>
                      <td className="py-1.5 pr-3 text-right font-mono">{t.soldFor}</td>
                      <td className="py-1.5 pr-3 text-right font-mono text-red">~{fmtUsd(t.costUsd)}</td>
                      <td
                        className={`py-1.5 pr-3 text-right font-mono font-bold ${
                          t.profitUsd >= 0 ? 'text-green' : 'text-red'
                        }`}
                      >
                        {fmtUsd(t.profitUsd)}
                      </td>
                      <td className="py-1.5 pr-3 text-right font-mono text-xs text-ink-faint">
                        {formatRelative(new Date(t.createdAt))}
                      </td>
                      <td className="py-1.5 text-right">
                        <SketchButton variant="ghost" size="sm" onClick={t.openReceipt}>
                          <ReceiptText className="h-3.5 w-3.5" strokeWidth={2} /> Receipt
                        </SketchButton>
                      </td>
                    </tr>
                  ))}
                  {transfers.length > 0 && (
                    <tr className="text-ink">
                      <td className="pt-2 font-heading font-bold" colSpan={4}>
                        Total
                      </td>
                      <td className="pt-2 text-right font-mono font-bold text-red">
                        ~{fmtUsd(transfers.reduce((n, t) => n + t.costUsd, 0))}
                      </td>
                      <td className="pt-2 text-right font-mono font-bold text-green">
                        {fmtUsd(transfers.reduce((n, t) => n + t.profitUsd, 0))}
                      </td>
                      <td colSpan={2} />
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <p className="micro mt-2 text-ink-faint">
              Cost basis: a coin is costed at {(salesBasis.costPerCoinUsd * 100).toFixed(3)}¢ — the
              average model's AI bill for a reference deck spread over what that deck charges. A
              ticket is costed at ~{fmtUsd(salesBasis.maxDeckCostUsd)}, the average model's bill for
              the biggest deck it must cover (15 slides, images, top level). Both move with the
              live model prices.
            </p>
          </div>
        )}

        {/* ---------------- tab 6: set prices ---------------- */}
        {tab === 'pricing' && (
          <PricingEditor
            key={`${JSON.stringify(data.packs)}|${String(data.ticketPriceOverride)}`}
            packs={data.packs}
            autoPrice={data.ticketAutoPrice}
            override={data.ticketPriceOverride}
          />
        )}
      </SketchCard>

      {/* usage detail (the expense receipts) */}
      <section>
        <h3 className="mb-3 font-heading text-xl font-semibold text-ink">
          Where the API money goes
        </h3>
        {data.usage.length === 0 ? (
          <div className="rounded-wobble-sm border-2 border-dashed border-pencil bg-paper-3 px-4 py-4">
            <p className="font-heading text-ink">No AI calls metered yet.</p>
            <p className="text-sm text-ink-soft">
              From now on every text generation records the tokens the provider reports, priced
              with the current table. Generate a deck and this fills in.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-wobble-sm border-2 border-ink bg-paper-3 p-4">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b-2 border-ink text-left font-heading text-xs uppercase tracking-wider text-ink-soft">
                  <th className="py-1.5 pr-3">Model</th>
                  <th className="py-1.5 pr-3 text-right">Calls</th>
                  <th className="py-1.5 pr-3 text-right">Tokens in</th>
                  <th className="py-1.5 pr-3 text-right">Tokens out</th>
                  <th className="py-1.5 pr-3 text-right">Est. cost</th>
                  <th className="py-1.5 text-right">Last used</th>
                </tr>
              </thead>
              <tbody>
                {[...data.usage]
                  .sort((a, b) => b.estUsd - a.estUsd)
                  .map((u) => (
                    <tr key={`${u.providerId}|${u.model}`} className="border-b border-dashed border-pencil text-ink">
                      <td className="py-1.5 pr-3">
                        <span className="font-heading font-semibold">{u.model}</span>{' '}
                        <span className="text-xs text-ink-faint">{PROVIDER_LABEL[u.providerId] ?? u.providerId}</span>
                      </td>
                      <td className="py-1.5 pr-3 text-right font-mono">{u.calls}</td>
                      <td className="py-1.5 pr-3 text-right font-mono">{u.inputTokens.toLocaleString()}</td>
                      <td className="py-1.5 pr-3 text-right font-mono">{u.outputTokens.toLocaleString()}</td>
                      <td className="py-1.5 pr-3 text-right font-mono font-bold">~{fmtUsd(u.estUsd)}</td>
                      <td className="py-1.5 text-right font-mono text-xs">{formatRelative(new Date(u.lastAt))}</td>
                    </tr>
                  ))}
                <tr className="text-ink">
                  <td className="pt-2 font-heading font-bold">Total</td>
                  <td colSpan={3} />
                  <td className="pt-2 text-right font-mono font-bold">~{fmtUsd(totalEstUsd)}</td>
                  <td />
                </tr>
              </tbody>
            </table>
          </div>
        )}
        <p className="micro mt-2 text-ink-faint">
          Counted from what each API reports per call — text generations only for now (images and
          speech aren't metered yet). Estimates, not invoices: check them against each provider's
          own console.
        </p>
      </section>

      {receipt && <ReceiptModal receipt={receipt} onClose={() => setReceipt(null)} />}
      {ticketReceipt && (
        <TicketReceiptModal sale={ticketReceipt} onClose={() => setTicketReceipt(null)} />
      )}
    </div>
  );
}

export default function AdminFinance() {
  return (
    <AdminGate minRole="admin">
      <SketchToaster />
      <FinanceBody />
    </AdminGate>
  );
}
