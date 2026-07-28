import { Landmark, Sparkles } from 'lucide-react';
import AdminGate from '@/components/admin/AdminGate';
import { HubHeader, PanelTileCard, type PanelTile } from '@/components/admin/PanelTiles';

/* Projects: the shelf where new tools for the site get built. Each
 * project gets a tile; Finance is the first. */

const PROJECT_TILES: PanelTile[] = [
  {
    to: '/admin/projects/finance',
    icon: Landmark,
    tone: 'green',
    title: 'Finance',
    blurb: 'Model costs, coin prices, receipts & API spend',
  },
];

function ProjectsBody() {
  return (
    <div className="mx-auto flex w-full max-w-content flex-col gap-6 px-4 py-8 lg:px-8">
      <HubHeader
        backTo="/admin"
        backLabel="Home"
        title="Projects"
        blurb="Tools we build for the site, one tile per project."
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {PROJECT_TILES.map((tile, i) => (
          <PanelTileCard key={tile.to} tile={tile} index={i} />
        ))}
        <div className="flex h-full min-h-[92px] items-center justify-center gap-2 rounded-wobble-2 border-2 border-dashed border-pencil p-4 text-center">
          <Sparkles className="h-4 w-4 text-ink-faint" strokeWidth={2} />
          <p className="font-heading text-sm text-ink-faint">
            The next project sketches itself here soon.
          </p>
        </div>
      </div>
    </div>
  );
}

export default function AdminProjects() {
  return (
    <AdminGate minRole="admin">
      <ProjectsBody />
    </AdminGate>
  );
}
