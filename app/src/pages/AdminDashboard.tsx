import { Link } from 'react-router';
import { motion } from 'framer-motion';
import type { LucideIcon } from 'lucide-react';
import {
  Users,
  LibraryBig,
  Presentation,
  Coins,
  HandCoins,
  Check,
  ShieldAlert,
  ShieldCheck,
  ChartSpline,
  PlayCircle,
  LayoutTemplate,
  SlidersHorizontal,
  ArrowRight,
} from 'lucide-react';
import { trpc } from '@/providers/trpc';
import { useAuth } from '@/hooks/useAuth';
import { cn } from '@/lib/utils';
import SketchButton from '@/components/sketch/SketchButton';
import SketchCard from '@/components/sketch/SketchCard';
import Chip from '@/components/sketch/Chip';
import AdminGate from '@/components/admin/AdminGate';
import StatCard from '@/components/admin/StatCard';
import { SkeletonBlock } from '@/components/admin/controls';
import { errMsg } from '@/components/admin/utils';

/* ------------------------------------------------------------------ */
/* Control-panel launcher tile                                         */
/* ------------------------------------------------------------------ */

const TILE_TONES = {
  yellow: 'bg-yellow-soft',
  orange: 'bg-orange/20',
  purple: 'bg-purple-soft',
  blue: 'bg-blue-soft',
  green: 'bg-green-soft',
  red: 'bg-red/15',
} as const;

interface PanelTile {
  to: string;
  icon: LucideIcon;
  tone: keyof typeof TILE_TONES;
  title: string;
  blurb: string;
  /** show a count badge (only rendered when defined) */
  count?: number;
  /** highlight the badge when the count needs attention */
  urgent?: boolean;
  adminOnly?: boolean;
}

function PanelTileCard({ tile, index }: { tile: PanelTile; index: number }) {
  const Icon = tile.icon;
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: index * 0.06, ease: [0.22, 1, 0.36, 1] }}
    >
      <Link to={tile.to} className="group block no-underline">
        <SketchCard
          index={index}
          className="flex h-full items-center gap-4 p-4 transition-transform duration-150 group-hover:-translate-y-1"
        >
          <span
            className={cn(
              'flex h-12 w-12 shrink-0 items-center justify-center rounded-full border-2 border-ink',
              TILE_TONES[tile.tone],
            )}
          >
            <Icon className="h-5 w-5 text-ink" strokeWidth={2} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2">
              <span className="truncate font-heading text-lg font-semibold text-ink">
                {tile.title}
              </span>
              {tile.count !== undefined && (
                <span
                  className={cn(
                    'rounded-full border-2 border-ink px-2 font-mono text-xs font-bold',
                    tile.urgent && tile.count > 0 ? 'bg-orange text-ink' : 'bg-paper-3 text-ink',
                  )}
                >
                  {tile.count}
                </span>
              )}
            </span>
            <span className="mt-0.5 block truncate text-xs text-ink-soft">{tile.blurb}</span>
          </span>
          <ArrowRight
            className="h-5 w-5 shrink-0 text-ink-faint transition-all duration-150 group-hover:translate-x-1 group-hover:text-ink"
            strokeWidth={2.5}
          />
        </SketchCard>
      </Link>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

function DashboardBody() {
  const { role } = useAuth();
  const dashboard = trpc.admin.dashboard.useQuery();
  const data = dashboard.data;

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

  const allTiles: PanelTile[] = [
    {
      to: '/admin/analytics',
      icon: ChartSpline,
      tone: 'yellow',
      title: 'Analytics',
      blurb: 'Tokens over time & runs per day',
    },
    {
      to: '/admin/payments',
      icon: HandCoins,
      tone: 'orange',
      title: 'Pending payments',
      blurb: 'Credit or reject payment notes',
      count: t.pendingPayments,
      urgent: true,
    },
    {
      to: '/admin/flags',
      icon: ShieldAlert,
      tone: 'red',
      title: 'Flagged runs',
      blurb: 'Runs marked for a second look',
      count: t.flaggedRuns,
      urgent: true,
    },
    {
      to: '/runs',
      icon: PlayCircle,
      tone: 'green',
      title: 'Presentation runs',
      blurb: 'Every run, scores & replays',
      adminOnly: true,
    },
    {
      to: '/admin/users',
      icon: Users,
      tone: 'blue',
      title: 'Manage users',
      blurb: 'Accounts, roles & token balances',
    },
    {
      to: '/admin/moderators',
      icon: ShieldCheck,
      tone: 'purple',
      title: 'Moderators',
      blurb: 'Promote & demote the mod team',
      adminOnly: true,
    },
    {
      to: '/templates',
      icon: LayoutTemplate,
      tone: 'purple',
      title: 'Slide templates',
      blurb: 'The template & packet catalog',
      adminOnly: true,
    },
    {
      to: '/admin/settings',
      icon: SlidersHorizontal,
      tone: 'yellow',
      title: 'Platform',
      blurb: 'Token packs, AI keys & config',
      adminOnly: true,
    },
  ];
  const tiles = allTiles.filter((tile) => role === 'admin' || !tile.adminOnly);

  return (
    <div className="mx-auto flex w-full max-w-content flex-col gap-8 px-4 py-8 lg:px-8">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="font-display text-4xl font-bold text-ink">Dashboard</h2>
        <Chip kind={role === 'admin' ? 'admin' : 'moderator'}>{role}</Chip>
      </div>

      {/* At-a-glance numbers */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6">
        <StatCard icon={Users} label="Users" value={t.users} index={0} tone="blue" />
        <StatCard icon={LibraryBig} label="Repositories" value={t.repos} index={1} tone="yellow" />
        <StatCard icon={Presentation} label="Slide tools" value={t.slideTools} index={2} tone="purple" />
        <StatCard icon={Check} label="Completed runs" value={t.runs} index={3} tone="green" />
        <StatCard icon={Coins} label="Tokens issued" value={t.tokensIssued} index={4} tone="orange" />
        <StatCard icon={HandCoins} label="Pending payments" value={t.pendingPayments} index={5} tone="orange" />
      </div>

      {/* Control panel — every admin corner, one click away */}
      <section>
        <h3 className="mb-3 font-heading text-xl font-semibold text-ink">Control panel</h3>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {tiles.map((tile, i) => (
            <PanelTileCard key={tile.to} tile={tile} index={i} />
          ))}
        </div>
      </section>
    </div>
  );
}

export default function AdminDashboard() {
  return (
    <AdminGate minRole="moderator">
      <DashboardBody />
    </AdminGate>
  );
}
