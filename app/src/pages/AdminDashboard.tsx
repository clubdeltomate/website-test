import { ChartColumnBig, FolderKanban, Gauge } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import Chip from '@/components/sketch/Chip';
import AdminGate from '@/components/admin/AdminGate';
import { PanelTileCard, type PanelTile } from '@/components/admin/PanelTiles';

/* The admin "Home": a three-door hub. Statistics → the at-a-glance
 * numbers; Controls → every operational page; Projects → the growing
 * shelf of built-for-the-site tools (Finance first). */

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
  ];
  const tiles = allTiles.filter((t) => role === 'admin' || !t.adminOnly);

  return (
    <div className="mx-auto flex w-full max-w-content flex-col gap-8 px-4 py-8 lg:px-8">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="font-display text-4xl font-bold text-ink">Home</h2>
        <Chip kind={role === 'admin' ? 'admin' : 'moderator'}>{role}</Chip>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
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
