import {
  ChartSpline,
  HandCoins,
  LayoutTemplate,
  PlayCircle,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  Users,
} from 'lucide-react';
import { trpc } from '@/providers/trpc';
import { useAuth } from '@/hooks/useAuth';
import SketchButton from '@/components/sketch/SketchButton';
import AdminGate from '@/components/admin/AdminGate';
import { HubHeader, PanelTileCard, type PanelTile } from '@/components/admin/PanelTiles';
import { SkeletonBlock } from '@/components/admin/controls';
import { errMsg } from '@/components/admin/utils';
import { say } from '@/lib/i18n';

/* Controls: the operational control panel — every staff page one click
 * away, with live badges on the queues that need attention. */

function ControlsBody() {
  const { role } = useAuth();
  const dashboard = trpc.admin.dashboard.useQuery();

  if (dashboard.isLoading) {
    return (
      <div className="mx-auto w-full max-w-content px-4 py-8 lg:px-8">
        <SkeletonBlock lines={4} status="Laying out the switches…" />
      </div>
    );
  }

  if (dashboard.isError || !dashboard.data) {
    return (
      <div className="mx-auto w-full max-w-content px-4 py-16 text-center lg:px-8">
        <p className="font-display text-3xl text-ink">{say("The control panel smudged itself.")}</p>
        <p className="mt-1 text-sm text-ink-soft">{errMsg(dashboard.error)}</p>
        <SketchButton className="mt-4" onClick={() => dashboard.refetch()}>
          
          {say("Try again")}
        </SketchButton>
      </div>
    );
  }

  const t = dashboard.data.totals;

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
    <div className="mx-auto flex w-full max-w-content flex-col gap-6 px-4 py-8 lg:px-8">
      <HubHeader
        backTo="/admin"
        backLabel="Home"
        title={say("Controls")}
        blurb="Every operational page, one click away."
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {tiles.map((tile, i) => (
          <PanelTileCard key={tile.to} tile={tile} index={i} />
        ))}
      </div>
    </div>
  );
}

export default function AdminControls() {
  return (
    <AdminGate minRole="moderator">
      <ControlsBody />
    </AdminGate>
  );
}
