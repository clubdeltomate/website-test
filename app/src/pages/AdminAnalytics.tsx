import { useMemo } from 'react';
import { Link } from 'react-router';
import { ArrowLeft } from 'lucide-react';
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
import SketchButton from '@/components/sketch/SketchButton';
import SketchCard from '@/components/sketch/SketchCard';
import AdminGate from '@/components/admin/AdminGate';
import { SkeletonBlock } from '@/components/admin/controls';
import { errMsg } from '@/components/admin/utils';
import { say } from '@/lib/i18n';

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

function AnalyticsBody() {
  const dashboard = trpc.admin.dashboard.useQuery();
  const data = dashboard.data;

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
        <SkeletonBlock lines={4} status="Sketching the graphs…" />
      </div>
    );
  }

  if (dashboard.isError || !data) {
    return (
      <div className="mx-auto w-full max-w-content px-4 py-16 text-center lg:px-8">
        <p className="font-display text-3xl text-ink">{say("The graphs smudged themselves.")}</p>
        <p className="mt-1 text-sm text-ink-soft">{errMsg(dashboard.error)}</p>
        <SketchButton className="mt-4" onClick={() => dashboard.refetch()}>
          
          {say("Try again")}
        </SketchButton>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-content flex-col gap-6 px-4 py-8 lg:px-8">
      <div>
        <Link
          to="/admin/controls"
          className="inline-flex items-center gap-1.5 font-heading text-sm font-semibold text-blue no-underline hover:underline"
        >
          <ArrowLeft className="h-4 w-4" strokeWidth={2.5} />  {say("Controls")}
        </Link>
        <h2 className="mt-1 font-display text-4xl font-bold text-ink">{say("Analytics")}</h2>
        <p className="text-sm text-ink-soft">{say("Token movement and finished runs, at a glance.")}</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <SketchCard index={1} className="lg:col-span-3">
          <h3 className="mb-2 font-heading text-lg font-semibold text-ink">
            
            {say("Tokens over time")} <span className="text-sm font-normal text-ink-faint">{say("(30 days, ledger deltas)")}</span>
          </h3>
          {tokensSeries.length === 0 ? (
            <p className="py-8 text-center font-display text-2xl text-ink-faint">
              
              {say("No token movement yet 🪙")}
            </p>
          ) : (
            <div className="h-64">
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
            
            {say("Recent runs")} <span className="text-sm font-normal text-ink-faint">{say("(last 10, by day)")}</span>
          </h3>
          {runsByDay.length === 0 ? (
            <p className="py-8 text-center font-display text-2xl text-ink-faint">
              
              {say("No runs finished yet 🏁")}
            </p>
          ) : (
            <div className="h-64">
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
    </div>
  );
}

export default function AdminAnalytics() {
  return (
    <AdminGate minRole="moderator">
      <AnalyticsBody />
    </AdminGate>
  );
}
