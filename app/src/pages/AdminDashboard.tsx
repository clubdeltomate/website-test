import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { AnimatePresence, motion } from 'framer-motion';
import { toast } from 'sonner';
import {
  Users,
  LibraryBig,
  Presentation,
  Flag,
  Coins,
  HandCoins,
  ExternalLink,
  Check,
  X as XIcon,
  ShieldAlert,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { trpc } from '@/providers/trpc';
import { useAuth } from '@/hooks/useAuth';
import SketchButton from '@/components/sketch/SketchButton';
import SketchCard from '@/components/sketch/SketchCard';
import SketchTable from '@/components/sketch/SketchTable';
import Chip from '@/components/sketch/Chip';
import AdminGate from '@/components/admin/AdminGate';
import StatCard from '@/components/admin/StatCard';
import SketchToaster from '@/components/admin/SketchToaster';
import { SketchModal } from '@/components/admin/overlays';
import { LabeledField, SketchInput, SkeletonBlock } from '@/components/admin/controls';
import { errMsg, formatMoney, formatRelative } from '@/components/admin/utils';
import type { PaymentRow, RunRow } from '@contracts/types';

/* ------------------------------------------------------------------ */
/* Sketch-styled chart tooltip (mini sticky note)                      */
/* ------------------------------------------------------------------ */

function StickyTooltip({
  active,
  payload,
  label,
  unit,
}: {
  active?: boolean;
  payload?: { value?: number }[];
  label?: string;
  unit: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="-rotate-1 rounded-wobble-sm border-2 border-ink bg-yellow px-3 py-1.5 shadow-offset">
      <p className="font-display text-lg leading-none text-ink">{label}</p>
      <p className="font-mono text-sm font-bold text-ink">
        {payload[0]?.value} {unit}
      </p>
    </div>
  );
}

const AXIS_TICK = { fill: '#5C5347', fontFamily: 'Caveat, cursive', fontSize: 16 };
const AXIS_LINE = { stroke: '#2E2820', strokeWidth: 2 };

/* ------------------------------------------------------------------ */
/* Pending payments queue                                              */
/* ------------------------------------------------------------------ */

function PaymentsQueue({
  payments,
  sheetUrl,
  onChanged,
}: {
  payments: PaymentRow[];
  sheetUrl: string;
  onChanged: () => void;
}) {
  const [rejecting, setRejecting] = useState<PaymentRow | null>(null);
  const [reason, setReason] = useState('');
  const [leaving, setLeaving] = useState<number[]>([]);

  const approve = trpc.payments.approve.useMutation({
    onSuccess: (_r, vars) => {
      const p = payments.find((x) => x.id === vars.paymentId);
      toast.success(`Credited ${p?.packTokens ?? ''} 🪙 to ${p?.userName ?? 'user'}`);
      animateOut(vars.paymentId);
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  const reject = trpc.payments.reject.useMutation({
    onSuccess: (_r, vars) => {
      toast.success('Payment rejected');
      setRejecting(null);
      setReason('');
      animateOut(vars.paymentId);
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  const animateOut = (id: number) => {
    setLeaving((l) => [...l, id]);
    window.setTimeout(onChanged, 320);
  };

  const visible = payments.filter((p) => !leaving.includes(p.id));

  return (
    <SketchCard borderStyle="solid" className="relative overflow-hidden p-0">
      <div className="flex flex-wrap items-center gap-3 border-b-2 border-ink bg-yellow px-4 py-3">
        <HandCoins className="h-5 w-5 text-ink" strokeWidth={2} />
        <h3 className="font-heading text-lg font-semibold text-ink">
          Pending payments — credit after checking the sheet
        </h3>
        <Chip kind="neutral" className="border-ink bg-paper-3">
          {visible.length}
        </Chip>
        {sheetUrl && (
          <a href={sheetUrl} target="_blank" rel="noreferrer" className="ml-auto no-underline">
            <SketchButton variant="secondary" size="sm">
              Open payment sheet <ExternalLink className="h-3.5 w-3.5" strokeWidth={2} />
            </SketchButton>
          </a>
        )}
      </div>

      {visible.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
          <svg viewBox="0 0 48 48" className="h-12 w-12" fill="none" aria-hidden="true">
            <path
              d="M8 34c6-2 10-8 10-14 4 4 4 10 2 14m4-16c8-4 14-2 16 4M12 40h24"
              stroke="#C9BFA9"
              strokeWidth="2.5"
              strokeLinecap="round"
            />
            <path d="M34 8l1.4 3.4L39 13l-3.6 1.6L34 18l-1.4-3.4L29 13l3.6-1.6z" fill="#8566D4" />
          </svg>
          <p className="font-display text-3xl text-ink">All caught up ✓</p>
          <p className="text-sm text-ink-faint">The pencil is sleeping. No payments waiting.</p>
        </div>
      ) : (
        <ul className="divide-y-2 divide-dashed divide-pencil">
          <AnimatePresence initial={false}>
            {visible.map((p) => (
              <motion.li
                key={p.id}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.3 }}
                className="overflow-hidden border-l-4 border-orange"
              >
                <div className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-full border-2 border-ink bg-blue-soft font-display text-lg text-ink">
                    {(p.userName ?? '?').charAt(0).toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-heading font-semibold text-ink">
                      {p.userName ?? 'Unknown'}
                      <span className="ml-2 font-mono text-xs font-normal text-ink-faint">
                        {p.userEmail}
                      </span>
                    </p>
                    <p className="text-xs text-ink-soft">
                      <span className="font-mono font-bold text-orange">
                        {p.packTokens} 🪙 · {formatMoney(p.amountCents)}
                      </span>
                      {' · '}
                      <span className="font-mono">{formatRelative(p.createdAt)}</span>
                      {p.note && (
                        <span className="block truncate italic" title={p.note}>
                          “{p.note.split('\n')[0]}”
                        </span>
                      )}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <SketchButton
                      variant="accent"
                      size="sm"
                      loading={approve.isPending && approve.variables?.paymentId === p.id}
                      onClick={() => approve.mutate({ paymentId: p.id })}
                    >
                      <Check className="h-4 w-4" strokeWidth={2.5} /> Credit
                    </SketchButton>
                    <SketchButton
                      variant="ghost"
                      size="sm"
                      className="text-red hover:border-red"
                      onClick={() => {
                        setRejecting(p);
                        setReason('');
                      }}
                    >
                      <XIcon className="h-4 w-4" strokeWidth={2.5} /> Reject
                    </SketchButton>
                  </div>
                </div>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}

      <SketchModal
        open={!!rejecting}
        onClose={() => setRejecting(null)}
        title="Reject this payment?"
        maxWidth="max-w-[440px]"
      >
        <p className="mb-3 text-sm text-ink-soft">
          {rejecting?.userName}'s note for {rejecting?.packTokens} 🪙 will be marked
          Rejected in their history.
        </p>
        <LabeledField label="Reason (one line)">
          <SketchInput
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Couldn't find this row in the sheet…"
          />
        </LabeledField>
        <div className="mt-4 flex gap-2">
          <SketchButton
            variant="danger"
            loading={reject.isPending}
            onClick={() => rejecting && reject.mutate({ paymentId: rejecting.id })}
          >
            Reject payment
          </SketchButton>
          <SketchButton variant="ghost" onClick={() => setRejecting(null)}>
            Keep it pending
          </SketchButton>
        </div>
      </SketchModal>
    </SketchCard>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

function DashboardBody() {
  const { role } = useAuth();
  const utils = trpc.useUtils();
  const dashboard = trpc.admin.dashboard.useQuery();
  const packs = trpc.tokens.packs.useQuery();

  const unflag = trpc.runs.setFlagged.useMutation({
    onSuccess: () => {
      toast.success('Flag dismissed ✓');
      void utils.admin.dashboard.invalidate();
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  const data = dashboard.data;
  const flagged = useMemo(
    () => (data?.recentRuns ?? []).filter((r) => r.flagged),
    [data],
  );

  const runsByDay = useMemo(() => {
    const byDay = new Map<string, number>();
    for (const r of data?.recentRuns ?? []) {
      const day = r.completedAt.toISOString().slice(5, 10);
      byDay.set(day, (byDay.get(day) ?? 0) + 1);
    }
    return [...byDay.entries()].map(([date, runs]) => ({ date, runs }));
  }, [data]);

  const tokensSeries = useMemo(
    () =>
      (data?.tokensOverTime ?? []).map((t) => ({
        date: t.date.slice(5),
        tokens: t.delta,
      })),
    [data],
  );

  if (dashboard.isLoading) {
    return (
      <div className="mx-auto w-full max-w-content px-4 py-8 lg:px-8">
        <SkeletonBlock lines={4} status="Tallying the notebook…" />
      </div>
    );
  }

  if (dashboard.isError || !data) {
    return (
      <div className="mx-auto w-full max-w-content px-4 py-16 text-center lg:px-8">
        <p className="font-display text-3xl text-ink">The dashboard smudged itself.</p>
        <p className="mt-1 text-sm text-ink-soft">{errMsg(dashboard.error)}</p>
        <SketchButton className="mt-4" onClick={() => dashboard.refetch()}>
          Try again
        </SketchButton>
      </div>
    );
  }

  const t = data.totals;

  return (
    <div className="mx-auto flex w-full max-w-content flex-col gap-8 px-4 py-8 lg:px-8">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="font-display text-4xl font-bold text-ink">Dashboard</h2>
        <Chip kind={role === 'admin' ? 'admin' : 'moderator'}>{role}</Chip>
      </div>

      {/* Section 1 — stat cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6">
        <StatCard icon={Users} label="Users" value={t.users} index={0} tone="blue" />
        <StatCard icon={LibraryBig} label="Repositories" value={t.repos} index={1} tone="yellow" />
        <StatCard icon={Presentation} label="Slide tools" value={t.slideTools} index={2} tone="purple" />
        <StatCard icon={Check} label="Completed runs" value={t.runs} index={3} tone="green" />
        <StatCard icon={Coins} label="Tokens issued" value={t.tokensIssued} index={4} tone="orange" />
        <StatCard icon={HandCoins} label="Pending payments" value={t.pendingPayments} index={5} tone="orange" />
      </div>

      {/* Section 2 — charts */}
      <div className="grid gap-4 lg:grid-cols-5">
        <SketchCard index={1} className="lg:col-span-3">
          <h3 className="mb-2 font-heading text-lg font-semibold text-ink">
            Tokens over time <span className="text-sm font-normal text-ink-faint">(30 days, ledger deltas)</span>
          </h3>
          {tokensSeries.length === 0 ? (
            <p className="py-8 text-center font-display text-2xl text-ink-faint">
              No token movement yet 🪙
            </p>
          ) : (
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={tokensSeries} margin={{ top: 8, right: 12, bottom: 0, left: -18 }}>
                  <CartesianGrid stroke="#C9BFA9" strokeDasharray="4 6" vertical={false} />
                  <XAxis dataKey="date" tick={AXIS_TICK} axisLine={AXIS_LINE} tickLine={false} />
                  <YAxis tick={AXIS_TICK} axisLine={AXIS_LINE} tickLine={false} allowDecimals={false} />
                  <Tooltip content={<StickyTooltip unit="🪙" />} cursor={{ stroke: '#2E2820', strokeDasharray: '4 4' }} />
                  <Area
                    type="monotone"
                    dataKey="tokens"
                    stroke="#2E2820"
                    strokeWidth={2.5}
                    fill="#FFC53D"
                    fillOpacity={0.55}
                    dot={{ r: 3.5, fill: '#FFFDF6', stroke: '#2E2820', strokeWidth: 2 }}
                    activeDot={{ r: 5, fill: '#FFC53D', stroke: '#2E2820', strokeWidth: 2 }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </SketchCard>

        <SketchCard index={2} className="lg:col-span-2">
          <h3 className="mb-2 font-heading text-lg font-semibold text-ink">
            Recent runs <span className="text-sm font-normal text-ink-faint">(last 10, by day)</span>
          </h3>
          {runsByDay.length === 0 ? (
            <p className="py-8 text-center font-display text-2xl text-ink-faint">
              No runs finished yet 🏁
            </p>
          ) : (
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={runsByDay} margin={{ top: 8, right: 12, bottom: 0, left: -22 }}>
                  <CartesianGrid stroke="#C9BFA9" strokeDasharray="4 6" vertical={false} />
                  <XAxis dataKey="date" tick={AXIS_TICK} axisLine={AXIS_LINE} tickLine={false} />
                  <YAxis tick={AXIS_TICK} axisLine={AXIS_LINE} tickLine={false} allowDecimals={false} />
                  <Tooltip content={<StickyTooltip unit="runs" />} cursor={{ fill: '#F4EBD6' }} />
                  <Bar dataKey="runs" radius={[6, 6, 0, 0]}>
                    {runsByDay.map((_, i) => (
                      <Cell key={i} fill="#3F74D6" fillOpacity={0.75} stroke="#2E2820" strokeWidth={2} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </SketchCard>
      </div>

      {/* Section 3 — pending payments */}
      <PaymentsQueue
        payments={data.pendingPayments}
        sheetUrl={packs.data?.googleSheetUrl ?? ''}
        onChanged={() => void utils.admin.dashboard.invalidate()}
      />

      {/* Section 4 — moderation flags */}
      <section>
        <h3 className="mb-3 flex items-center gap-2 font-heading text-xl font-semibold text-ink">
          <ShieldAlert className="h-5 w-5 text-red" strokeWidth={2} />
          Flagged runs
          <Chip kind="neutral">{t.flaggedRuns}</Chip>
        </h3>
        {flagged.length === 0 ? (
          <div className="flex items-center gap-3 rounded-wobble-sm border-2 border-dashed border-pencil bg-paper-3 px-4 py-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-ink bg-green-soft">
              <Check className="h-4 w-4 text-green" strokeWidth={2.5} />
            </span>
            <p className="font-heading text-ink">Nothing flagged. Nice.</p>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {flagged.map((r, i) => (
              <motion.div
                key={r.id}
                initial={{ opacity: 0, x: -16 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.06, duration: 0.3 }}
              >
                <SketchCard index={i} className="flex items-center gap-3 p-4">
                  <Flag className="h-5 w-5 shrink-0 text-red" strokeWidth={2} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-heading font-semibold text-ink">{r.toolName}</p>
                    <p className="text-xs text-ink-soft">
                      {r.playerName} · score {r.scoreCorrect}/{r.scoreTotal} ·{' '}
                      <span className="font-mono">{formatRelative(r.completedAt)}</span>
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Link to="/runs" className="no-underline">
                      <SketchButton variant="secondary" size="sm">
                        View
                      </SketchButton>
                    </Link>
                    <SketchButton
                      variant="ghost"
                      size="sm"
                      loading={unflag.isPending && unflag.variables?.runId === r.id}
                      onClick={() => unflag.mutate({ runId: r.id, flagged: false })}
                    >
                      Dismiss
                    </SketchButton>
                  </div>
                </SketchCard>
              </motion.div>
            ))}
          </div>
        )}
      </section>

      {/* Section 5 — recent runs */}
      <section>
        <h3 className="mb-3 font-heading text-xl font-semibold text-ink">Recent runs</h3>
        <SketchTable<RunRow>
          rows={data.recentRuns}
          rowKey={(r) => String(r.id)}
          columns={[
            {
              key: 'tool',
              header: 'Tool',
              render: (r) => <span className="font-heading font-semibold text-ink">{r.toolName}</span>,
            },
            { key: 'student', header: 'Student', render: (r) => r.playerName },
            {
              key: 'repo',
              header: 'Repo',
              render: (r) =>
                r.repoRef ? <Chip kind="repo-ref">{r.repoRef}</Chip> : <span className="text-ink-faint">Direct</span>,
            },
            {
              key: 'score',
              header: 'Score',
              sortValue: (r) => (r.scoreTotal ? r.scoreCorrect / r.scoreTotal : 0),
              render: (r) => {
                const pct = r.scoreTotal ? (r.scoreCorrect / r.scoreTotal) * 100 : 0;
                return (
                  <span className="flex items-center gap-2">
                    <span className="relative block h-2.5 w-20 overflow-hidden rounded-full border-2 border-ink bg-paper-2">
                      <span className="block h-full bg-ink" style={{ width: `${pct}%` }} />
                    </span>
                    <span className="font-mono text-xs">
                      {r.scoreCorrect}/{r.scoreTotal}
                    </span>
                  </span>
                );
              },
            },
            {
              key: 'when',
              header: 'Played',
              mono: true,
              sortValue: (r) => r.completedAt.getTime(),
              render: (r) => formatRelative(r.completedAt),
            },
          ]}
          emptyState={
            <span className="font-display text-2xl text-ink-faint">
              No runs yet — the clipboard is empty 💤
            </span>
          }
        />
        <div className="mt-3 text-right">
          <Link to="/runs" className="font-heading font-semibold text-blue">
            All presentation runs →
          </Link>
        </div>
      </section>
    </div>
  );
}

export default function AdminDashboard() {
  return (
    <AdminGate minRole="moderator">
      <SketchToaster />
      <DashboardBody />
    </AdminGate>
  );
}
