import { ChartColumnBig, FolderKanban, Gauge, Landmark, Megaphone } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import Chip from '@/components/sketch/Chip';
import AdminGate from '@/components/admin/AdminGate';
import { PanelTileCard, type PanelTile } from '@/components/admin/PanelTiles';
import { say } from '@/lib/i18n';

/* The admin "Home". Statistics → the at-a-glance numbers; Controls → every
 * operational page; Projects → the shelf of built-for-the-site tools; and
 * Finance directly, because it is the one that gets opened daily and going
 * Home → Projects → Finance to read today's costs is two doors too many. It
 * still lives on the Projects shelf; this is a shortcut, not a move. */

function HomeBody() {
  const { role } = useAuth();

  const allTiles: PanelTile[] = [
    {
      to: '/admin/stats',
      icon: ChartColumnBig,
      tone: 'blue',
      title: 'Statistics',
      blurb: 'Users, repos, slides, runs & tokens at a glance',
    },
    {
      to: '/admin/controls',
      icon: Gauge,
      tone: 'yellow',
      title: 'Controls',
      blurb: 'Payments, flags, users, templates & platform',
    },
    {
      to: '/admin/projects',
      icon: FolderKanban,
      tone: 'purple',
      title: 'Projects',
      blurb: 'Tools built for the site — Finance lives here',
      adminOnly: true,
    },
    {
      to: '/admin/projects/finance',
      icon: Landmark,
      tone: 'green',
      title: 'Finance',
      blurb: 'Model costs, coin prices, receipts & API spend',
      adminOnly: true,
    },
    {
      to: '/admin/projects/marketing',
      icon: Megaphone,
      tone: 'purple',
      title: 'Marketing',
      blurb: 'Compose 9:16 posts with a caption band you can colour',
      adminOnly: true,
    },
  ];
  const tiles = allTiles.filter((t) => role === 'admin' || !t.adminOnly);

  return (
    <div className="mx-auto flex w-full max-w-content flex-col gap-8 px-4 py-8 lg:px-8">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="font-display text-4xl font-bold text-ink">{say("Home")}</h2>
        <Chip kind={role === 'admin' ? 'admin' : 'moderator'}>{role}</Chip>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {tiles.map((tile, i) => (
          <PanelTileCard key={tile.to} tile={tile} index={i} />
        ))}
      </div>
    </div>
  );
}

export default function AdminDashboard() {
  return (
    <AdminGate minRole="moderator">
      <HomeBody />
    </AdminGate>
  );
}
