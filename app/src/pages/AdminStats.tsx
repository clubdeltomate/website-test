import { Check, Coins, HandCoins, LibraryBig, Presentation, Users } from 'lucide-react';
import { trpc } from '@/providers/trpc';
import SketchButton from '@/components/sketch/SketchButton';
import AdminGate from '@/components/admin/AdminGate';
import StatCard from '@/components/admin/StatCard';
import { HubHeader } from '@/components/admin/PanelTiles';
import { SkeletonBlock } from '@/components/admin/controls';
import { errMsg } from '@/components/admin/utils';
import { say } from '@/lib/i18n';

/* Statistics: just the headline numbers, on their own page — room to
 * grow more cards later. */

function StatsBody() {
  const dashboard = trpc.admin.dashboard.useQuery();

  if (dashboard.isLoading) {
    return (
      <div className="mx-auto w-full max-w-content px-4 py-8 lg:px-8">
        <SkeletonBlock lines={4} status="Tallying the notebook…" />
      </div>
    );
  }

  if (dashboard.isError || !dashboard.data) {
    return (
      <div className="mx-auto w-full max-w-content px-4 py-16 text-center lg:px-8">
        <p className="font-display text-3xl text-ink">{say("The numbers smudged themselves.")}</p>
        <p className="mt-1 text-sm text-ink-soft">{errMsg(dashboard.error)}</p>
        <SketchButton className="mt-4" onClick={() => dashboard.refetch()}>
          
          {say("Try again")}
        </SketchButton>
      </div>
    );
  }

  const t = dashboard.data.totals;

  return (
    <div className="mx-auto flex w-full max-w-content flex-col gap-6 px-4 py-8 lg:px-8">
      <HubHeader
        backTo="/admin"
        backLabel="Home"
        title={say("Statistics")}
        blurb="The platform's headline numbers."
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <StatCard icon={Users} label="Users" value={t.users} index={0} tone="blue" />
        <StatCard icon={LibraryBig} label="Repositories" value={t.repos} index={1} tone="yellow" />
        <StatCard icon={Presentation} label="Slide tools" value={t.slideTools} index={2} tone="purple" />
        <StatCard icon={Check} label="Completed runs" value={t.runs} index={3} tone="green" />
        <StatCard icon={Coins} label="Tokens issued" value={t.tokensIssued} index={4} tone="orange" />
        <StatCard icon={HandCoins} label="Pending payments" value={t.pendingPayments} index={5} tone="orange" />
      </div>
    </div>
  );
}

export default function AdminStats() {
  return (
    <AdminGate minRole="moderator">
      <StatsBody />
    </AdminGate>
  );
}
