import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  Coins,
  Landmark,
  Printer,
  ReceiptText,
  RefreshCw,
  Wallet,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '../../api/router';
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

const fmtUsd = (v: number) =>
  v >= 0.01 || v === 0 ? `$${v.toFixed(2)}` : `$${v.toFixed(4)}`;

const AXIS_TICK = { fill: '#5C5347', fontFamily: 'Caveat, cursive', fontSize: 15 };
const AXIS_LINE = { stroke: '#2E2820', strokeWidth: 2 };

/* ------------------------------------------------------------------ */
/* Model-cost chart tooltip (sticky-note style, both series)           */
/* ------------------------------------------------------------------ */

function CostTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { name?: string; value?: number }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="-rotate-1 rounded-wobble-sm border-2 border-ink bg-yellow px-3 py-1.5 shadow-offset">
      <p className="font-display text-lg leading-none text-ink">{label}</p>
      {payload.map((p) => (
        <p key={p.name} className="font-mono text-xs font-bold text-ink">
          {p.name}: ${p.value?.toFixed(2)} / 1M
        </p>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Printable receipt                                                   */
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
/* Grant coins form                                                    */
/* ------------------------------------------------------------------ */

function GrantForm({ onReceipt }: { onReceipt: (r: Receipt) => void }) {
  const utils = trpc.useUtils();
  const usersList = trpc.users.list.useQuery({ limit: 200 });
  const [userId, setUserId] = useState<number | ''>('');
  const [tokens, setTokens] = useState(100);
  const [amount, setAmount] = useState('5.00');
  const [note, setNote] = useState('');

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

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
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
        <SketchInput value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="5.00" />
      </LabeledField>
      <LabeledField label="Note (on the receipt)">
        <SketchInput value={note} onChange={(e) => setNote(e.target.value)} placeholder="Bank transfer ref…" />
      </LabeledField>
      <div className="flex items-end">
        <SketchButton variant="accent" loading={grant.isPending} onClick={submit} className="w-full">
          <ReceiptText className="h-4 w-4" strokeWidth={2} /> Credit + receipt
        </SketchButton>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Provider wallet (budget vs estimated spend)                         */
/* ------------------------------------------------------------------ */

function WalletRow({
  providerId,
  budget,
  onSaved,
}: {
  providerId: string;
  budget?: { amountUsd: number; setAt: string; spentUsd: number };
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(budget ? String(budget.amountUsd) : '');

  const setBudget = trpc.finance.setBudget.useMutation({
    onSuccess: () => {
      toast.success(`${PROVIDER_LABEL[providerId] ?? providerId} wallet updated`);
      setEditing(false);
      onSaved();
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  const remaining = budget ? budget.amountUsd - budget.spentUsd : 0;
  const pct = budget && budget.amountUsd > 0 ? Math.min(100, (budget.spentUsd / budget.amountUsd) * 100) : 0;

  return (
    <div className="flex flex-wrap items-center gap-3 border-b-2 border-dashed border-pencil py-3 last:border-b-0">
      <span className="w-36 shrink-0 font-heading font-semibold text-ink">
        {PROVIDER_LABEL[providerId] ?? providerId}
      </span>
      {budget && !editing ? (
        <>
          <div className="min-w-[160px] flex-1">
            <div className="relative h-3 overflow-hidden rounded-full border-2 border-ink bg-paper-2">
              <div
                className={pct > 85 ? 'h-full bg-red' : 'h-full bg-green'}
                style={{ width: `${pct}%` }}
              />
            </div>
            <p className="micro mt-1 text-ink-faint">
              ~{fmtUsd(budget.spentUsd)} spent since {formatRelative(new Date(budget.setAt))} ·{' '}
              <span className={remaining < 0 ? 'font-bold text-red' : 'font-bold text-green'}>
                {fmtUsd(Math.max(0, remaining))} left
              </span>{' '}
              of {fmtUsd(budget.amountUsd)}
            </p>
          </div>
          <SketchButton variant="ghost" size="sm" onClick={() => { setValue(String(budget.amountUsd)); setEditing(true); }}>
            Re-enter balance
          </SketchButton>
        </>
      ) : (
        <>
          <SketchInput
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Balance in USD, e.g. 20"
            className="max-w-[180px]"
          />
          <SketchButton
            size="sm"
            loading={setBudget.isPending}
            onClick={() => {
              const v = Number(value);
              if (!Number.isFinite(v) || v < 0) return toast.error('That balance looks smudged');
              setBudget.mutate({ providerId, amountUsd: v });
            }}
          >
            <Wallet className="h-4 w-4" strokeWidth={2} /> Set
          </SketchButton>
          {budget && (
            <SketchButton variant="ghost" size="sm" onClick={() => setEditing(false)}>
              Cancel
            </SketchButton>
          )}
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

function FinanceBody() {
  const utils = trpc.useUtils();
  const overview = trpc.finance.overview.useQuery();
  const [receipt, setReceipt] = useState<Receipt | null>(null);

  const refresh = trpc.finance.refreshPricing.useMutation({
    onSuccess: () => {
      toast.success('Model prices refreshed from the live feed ✓');
      void utils.finance.overview.invalidate();
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  const data = overview.data;

  const chartData = useMemo(
    () =>
      (data?.pricing.models ?? []).map((m) => ({
        name: m.label,
        Input: m.inPerM,
        Output: m.outPerM,
      })),
    [data],
  );

  const totalEstUsd = useMemo(
    () => (data?.usage ?? []).reduce((n, u) => n + u.estUsd, 0),
    [data],
  );

  if (overview.isLoading) {
    return (
      <div className="mx-auto w-full max-w-content px-4 py-8 lg:px-8">
        <SkeletonBlock lines={5} status="Balancing the books…" />
      </div>
    );
  }

  if (overview.isError || !data) {
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

  const pricingAge = formatRelative(new Date(data.pricing.updatedAt));

  return (
    <div className="mx-auto flex w-full max-w-content flex-col gap-8 px-4 py-8 lg:px-8">
      <HubHeader
        backTo="/admin/projects"
        backLabel="Projects"
        title="Finance"
        blurb="What the AI models cost, what the coins earn, and where your API money goes."
        chip={
          <span className="flex h-9 w-9 items-center justify-center rounded-full border-2 border-ink bg-green-soft">
            <Landmark className="h-4 w-4 text-ink" strokeWidth={2} />
          </span>
        }
      />

      {/* 1 — money in vs money out */}
      <div className="grid gap-4 sm:grid-cols-3">
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
      </div>

      {/* 2 — model costs */}
      <SketchCard borderStyle="solid" className="p-0">
        <div className="flex flex-wrap items-center gap-3 border-b-2 border-ink bg-yellow px-4 py-3">
          <h3 className="font-heading text-lg font-semibold text-ink">
            What each model costs <span className="text-sm font-normal">(USD per 1M tokens)</span>
          </h3>
          <Chip kind="neutral" className="border-ink bg-paper-3">
            {data.pricing.source === 'web' ? `refreshed ${pricingAge}` : `seed prices · ${pricingAge}`}
          </Chip>
          <SketchButton
            variant="secondary"
            size="sm"
            className="ml-auto"
            loading={refresh.isPending}
            onClick={() => refresh.mutate()}
          >
            <RefreshCw className="h-3.5 w-3.5" strokeWidth={2} /> Refresh from the web
          </SketchButton>
        </div>
        <div className="p-4">
          <div style={{ height: chartData.length * 44 + 60 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} layout="vertical" margin={{ top: 4, right: 24, bottom: 0, left: 8 }} barGap={2}>
                <CartesianGrid stroke="#C9BFA9" strokeDasharray="4 6" horizontal={false} />
                <XAxis type="number" tick={AXIS_TICK} axisLine={AXIS_LINE} tickLine={false} unit="$" />
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
      </SketchCard>

      {/* 3 — coin prices */}
      <section>
        <h3 className="mb-3 flex items-center gap-2 font-heading text-xl font-semibold text-ink">
          <Coins className="h-5 w-5 text-orange" strokeWidth={2} />
          What the coins sell for
        </h3>
        <div className="grid gap-4 sm:grid-cols-3">
          {data.packs.map((p, i) => (
            <SketchCard key={p.id} index={i} className="p-4 text-center">
              <p className="font-display text-3xl font-bold text-orange">{p.tokens} 🪙</p>
              <p className="font-heading text-lg text-ink">{formatMoney(p.priceCents)}</p>
              <p className="micro mt-1 text-ink-faint">
                {(p.priceCents / p.tokens).toFixed(1)}¢ per coin
              </p>
            </SketchCard>
          ))}
        </div>
        <p className="micro mt-2 text-ink-faint">
          Pack prices are set in Controls → Platform; this is what buyers currently pay.
        </p>
      </section>

      {/* 4 — usage & estimated spend */}
      <section>
        <h3 className="mb-3 font-heading text-xl font-semibold text-ink">
          Where the API money goes
        </h3>
        {data.usage.length === 0 ? (
          <div className="rounded-wobble-sm border-2 border-dashed border-pencil bg-paper-3 px-4 py-4">
            <p className="font-heading text-ink">No AI calls metered yet.</p>
            <p className="text-sm text-ink-soft">
              From now on every text generation records the tokens the provider reports, priced
              with the table above. Generate a deck and this fills in.
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

      {/* 5 — provider wallets */}
      <SketchCard borderStyle="solid" className="p-0">
        <div className="border-b-2 border-ink bg-green-soft px-4 py-3">
          <h3 className="font-heading text-lg font-semibold text-ink">Provider wallets</h3>
          <p className="text-xs text-ink-soft">
            Enter what's loaded on each API account. Spend is estimated from that moment, so when
            generation switches providers or stops, you can check the "left" figure against the
            provider's own balance and see whether they coincide.
          </p>
        </div>
        <div className="px-4 py-1">
          {Object.keys(PROVIDER_LABEL).map((pid) => {
            const b = data.providers.find((p) => p.providerId === pid);
            return (
              <WalletRow
                key={pid}
                providerId={pid}
                budget={b ? { amountUsd: b.amountUsd, setAt: b.setAt, spentUsd: b.spentUsd } : undefined}
                onSaved={() => void utils.finance.overview.invalidate()}
              />
            );
          })}
        </div>
      </SketchCard>

      {/* 6 — grant coins with a receipt */}
      <SketchCard borderStyle="solid" className="p-0">
        <div className="border-b-2 border-ink bg-yellow px-4 py-3">
          <h3 className="font-heading text-lg font-semibold text-ink">
            Credit coins — always with a receipt
          </h3>
          <p className="text-xs text-ink-soft">
            When someone pays you for tokens, credit them here: the coins land on their balance,
            the sale is recorded as revenue, and a printable receipt comes out.
          </p>
        </div>
        <div className="p-4">
          <GrantForm onReceipt={setReceipt} />

          <h4 className="mb-2 mt-6 font-heading font-semibold text-ink">Receipt history</h4>
          {data.recentReceipts.length === 0 ? (
            <p className="text-sm text-ink-faint">No credited sales yet.</p>
          ) : (
            <ul className="divide-y divide-dashed divide-pencil">
              {data.recentReceipts.map((r) => (
                <li key={r.receiptNo} className="flex flex-wrap items-center gap-3 py-2">
                  <span className="font-mono text-xs text-ink-faint">
                    #{String(r.receiptNo).padStart(5, '0')}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-heading font-semibold text-ink">
                    {r.userName}
                    {r.isGrant ? '' : ' · sheet purchase'}
                  </span>
                  <span className="font-mono text-sm font-bold text-orange">{r.tokens} 🪙</span>
                  <span className="font-mono text-sm text-ink">{formatMoney(r.amountCents)}</span>
                  <span className="font-mono text-xs text-ink-faint">
                    {formatRelative(new Date(r.createdAt))}
                  </span>
                  <SketchButton variant="ghost" size="sm" onClick={() => setReceipt(r)}>
                    <ReceiptText className="h-3.5 w-3.5" strokeWidth={2} /> Receipt
                  </SketchButton>
                </li>
              ))}
            </ul>
          )}
        </div>
      </SketchCard>

      {receipt && <ReceiptModal receipt={receipt} onClose={() => setReceipt(null)} />}
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
