import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { toast } from 'sonner';
import { Check, Coins, Flag, PlayCircle, ShieldCheck, UserMinus, UserPlus } from 'lucide-react';
import { trpc } from '@/providers/trpc';
import { useAuth } from '@/hooks/useAuth';
import SketchButton from '@/components/sketch/SketchButton';
import SketchCard from '@/components/sketch/SketchCard';
import Chip from '@/components/sketch/Chip';
import StickyNote from '@/components/sketch/StickyNote';
import WashiTape from '@/components/sketch/WashiTape';
import { DoodleCheck } from '@/components/sketch/DoodleIcons';
import AdminGate from '@/components/admin/AdminGate';
import SketchToaster from '@/components/admin/SketchToaster';
import { SketchModal } from '@/components/admin/overlays';
import { LabeledField, SketchInput, SkeletonBlock } from '@/components/admin/controls';
import { errMsg, formatDate } from '@/components/admin/utils';
import type { AdminUserRow } from '@contracts/types';

const MOD_PERMISSIONS = ['Credit tokens', 'Review flags', 'View all runs', 'Suspend users'];

/* ------------------------------------------------------------------ */
/* Moderator card                                                      */
/* ------------------------------------------------------------------ */

function ModeratorCard({
  user,
  index,
  isSelf,
  isAdminRow,
  onRevoke,
}: {
  user: AdminUserRow;
  index: number;
  isSelf: boolean;
  isAdminRow: boolean;
  onRevoke: (u: AdminUserRow) => void;
}) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ delay: index * 0.09, duration: 0.35 }}
    >
      <SketchCard index={index} className="relative flex h-full flex-col gap-3">
        <WashiTape rotate={index % 2 === 0 ? -3 : 2} color={index % 2 === 0 ? 'yellow' : 'blue'} />
        <div className="flex items-center gap-3">
          <span className="flex h-14 w-14 items-center justify-center rounded-full border-2 border-ink bg-purple-soft font-display text-2xl text-ink shadow-offset">
            {user.name.charAt(0).toUpperCase()}
          </span>
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-2 font-heading text-lg font-semibold text-ink">
              {user.name}
              <Chip kind={user.role}>{user.role}</Chip>
            </p>
            <p className="truncate text-xs text-ink-soft">{user.email}</p>
            <p className="micro mt-0.5 text-ink-faint">since {formatDate(user.createdAt)}</p>
          </div>
        </div>

        <div className="flex flex-col gap-1">
          {MOD_PERMISSIONS.map((perm) => (
            <p key={perm} className="flex items-center gap-2 text-sm text-ink">
              <DoodleCheck className="h-4 w-4 text-green" />
              {perm}
            </p>
          ))}
          <p className="mt-1 text-xs italic text-ink-faint">
            Fixed permission set; granularity comes later.
          </p>
        </div>

        <div className="mt-auto flex items-center gap-2 border-t-2 border-dashed border-pencil pt-3">
          {isSelf ? (
            <p className="text-xs text-ink-faint" title="You can't revoke yourself">
              That's you — self-revoking is how notebooks get locked. 🔒
            </p>
          ) : (
            <SketchButton
              variant="ghost"
              size="sm"
              className="text-red hover:border-red"
              onClick={() => onRevoke(user)}
            >
              <UserMinus className="h-4 w-4" strokeWidth={2} />
              {isAdminRow ? 'Demote to moderator' : 'Revoke'}
            </SketchButton>
          )}
        </div>
      </SketchCard>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

function ModeratorsBody() {
  const { user: me } = useAuth();
  const utils = trpc.useUtils();
  const moderators = trpc.users.list.useQuery({ role: 'moderator', limit: 100 });
  const admins = trpc.users.list.useQuery({ role: 'admin', limit: 100 });
  const dashboard = trpc.admin.dashboard.useQuery();

  const [revoking, setRevoking] = useState<AdminUserRow | null>(null);
  const [search, setSearch] = useState('');
  const candidates = trpc.users.list.useQuery(
    { q: search || undefined, role: 'user', limit: 8 },
    { enabled: true },
  );
  const [promoting, setPromoting] = useState<AdminUserRow | null>(null);

  const setRole = trpc.users.setRole.useMutation({
    onSuccess: (_r, vars) => {
      if (vars.role === 'moderator') {
        toast.success(`Welcome to the desk, ${promoting?.name ?? 'moderator'} ✦`);
      } else {
        toast.success('Role updated');
      }
      setPromoting(null);
      setRevoking(null);
      setSearch('');
      void utils.users.list.invalidate();
      void utils.admin.dashboard.invalidate();
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  const staff = useMemo(() => {
    const rows = [...(admins.data ?? []), ...(moderators.data ?? [])];
    return rows.sort((a, b) => (a.role === b.role ? a.name.localeCompare(b.name) : a.role === 'admin' ? -1 : 1));
  }, [admins.data, moderators.data]);

  const totals = dashboard.data?.totals;
  const loading = moderators.isLoading || admins.isLoading;

  return (
    <div className="mx-auto flex w-full max-w-[1080px] flex-col gap-8 px-4 py-8 lg:px-8">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="font-display text-4xl font-bold text-ink">Moderators</h2>
        <Chip kind="neutral">{staff.length}</Chip>
        <Chip kind="admin">admin only</Chip>
      </div>

      {/* explainer notes */}
      <div className="grid gap-5 sm:grid-cols-2">
        <motion.div
          initial={{ rotate: 6, opacity: 0 }}
          animate={{ rotate: -1, opacity: 1 }}
          transition={{ duration: 0.4 }}
        >
          <StickyNote rotate={0} className="h-full">
            <p className="mb-2 font-heading text-lg font-semibold">Moderators can</p>
            <ul className="flex flex-col gap-1 text-[0.95rem]">
              <li>· credit tokens after manual payments</li>
              <li>· review &amp; clear flagged runs</li>
              <li>· view all users and runs</li>
              <li>· suspend regular users</li>
            </ul>
          </StickyNote>
        </motion.div>
        <motion.div
          initial={{ rotate: -6, opacity: 0 }}
          animate={{ rotate: 1, opacity: 1 }}
          transition={{ duration: 0.4, delay: 0.15 }}
        >
          <div className="h-full -rotate-1 rounded-wobble-2 border-2 border-ink bg-purple-soft p-4 pt-5 font-heading text-[1.05rem] leading-snug text-ink shadow-offset">
            <p className="mb-2 font-heading text-lg font-semibold">Only admins can</p>
            <ul className="flex flex-col gap-1 text-[0.95rem]">
              <li>· appoint &amp; revoke moderators</li>
              <li>· change token prices &amp; packs</li>
              <li>· manage system AI keys &amp; feature flags</li>
              <li>· edit the payment sheet link</li>
            </ul>
          </div>
        </motion.div>
      </div>

      {/* activity summary (platform-wide; per-moderator audit arrives with the audit API) */}
      <div className="grid gap-4 sm:grid-cols-3">
        <SketchCard borderStyle="dashed" className="flex items-center gap-3 p-4">
          <span className="flex h-10 w-10 items-center justify-center rounded-full border-2 border-ink bg-orange/20">
            <Coins className="h-5 w-5 text-ink" strokeWidth={2} />
          </span>
          <div>
            <p className="font-display text-2xl font-bold text-ink">{totals?.pendingPayments ?? 0}</p>
            <p className="micro text-ink-faint">payments awaiting credit</p>
          </div>
        </SketchCard>
        <SketchCard borderStyle="dashed" index={1} className="flex items-center gap-3 p-4">
          <span className="flex h-10 w-10 items-center justify-center rounded-full border-2 border-ink bg-red-soft">
            <Flag className="h-5 w-5 text-ink" strokeWidth={2} />
          </span>
          <div>
            <p className="font-display text-2xl font-bold text-ink">{totals?.flaggedRuns ?? 0}</p>
            <p className="micro text-ink-faint">runs flagged</p>
          </div>
        </SketchCard>
        <SketchCard borderStyle="dashed" index={2} className="flex items-center gap-3 p-4">
          <span className="flex h-10 w-10 items-center justify-center rounded-full border-2 border-ink bg-green-soft">
            <PlayCircle className="h-5 w-5 text-ink" strokeWidth={2} />
          </span>
          <div>
            <p className="font-display text-2xl font-bold text-ink">{totals?.runs ?? 0}</p>
            <p className="micro text-ink-faint">runs overseen</p>
          </div>
        </SketchCard>
      </div>

      {/* moderator cards */}
      <section>
        <h3 className="mb-3 flex items-center gap-2 font-heading text-xl font-semibold text-ink">
          <ShieldCheck className="h-5 w-5 text-purple" strokeWidth={2} /> The desk
        </h3>
        {loading ? (
          <SkeletonBlock lines={3} status="Gathering the staff…" />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <AnimatePresence initial={false}>
              {staff.map((u, i) => (
                <ModeratorCard
                  key={u.id}
                  user={u}
                  index={i}
                  isSelf={u.id === me?.id}
                  isAdminRow={u.role === 'admin'}
                  onRevoke={setRevoking}
                />
              ))}
            </AnimatePresence>
          </div>
        )}
      </section>

      {/* appoint a moderator */}
      <SketchCard borderStyle="dashed" className="relative">
        <WashiTape rotate={-2} />
        <h3 className="mb-1 font-heading text-lg font-semibold text-ink">Appoint a moderator</h3>
        <p className="mb-4 text-sm text-ink-soft">
          Search active users; promoting hands them the fixed permission set above.
        </p>
        <LabeledField label="Find a user">
          <SketchInput
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Type a name or email…"
          />
        </LabeledField>
        {search.trim() && (
          <div className="mt-3 flex flex-col gap-2">
            {(candidates.data ?? [])
              .filter((c) => c.role === 'user')
              .map((c) => (
                <motion.div
                  key={c.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex items-center gap-3 rounded-wobble-sm border-2 border-dashed border-pencil bg-paper-2 px-3 py-2"
                >
                  <span className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-ink bg-blue-soft font-display text-base text-ink">
                    {c.name.charAt(0).toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-heading font-semibold text-ink">{c.name}</span>
                    <span className="block truncate text-xs text-ink-faint">{c.email}</span>
                  </span>
                  <SketchButton variant="accent" size="sm" onClick={() => setPromoting(c)}>
                    <UserPlus className="h-4 w-4" strokeWidth={2} /> Promote
                  </SketchButton>
                </motion.div>
              ))}
            {candidates.data?.filter((c) => c.role === 'user').length === 0 && (
              <p className="py-2 font-display text-xl text-ink-faint">
                No plain users match that search.
              </p>
            )}
          </div>
        )}
      </SketchCard>

      {/* confirm promote */}
      <SketchModal
        open={!!promoting}
        onClose={() => setPromoting(null)}
        title={`Promote ${promoting?.name}?`}
        maxWidth="max-w-[440px]"
      >
        <p className="mb-3 text-sm text-ink-soft">
          They'll be able to credit tokens, review flags, view all runs, and suspend
          regular users — effective immediately.
        </p>
        <div className="flex flex-col gap-1 pb-3">
          {MOD_PERMISSIONS.map((perm) => (
            <p key={perm} className="flex items-center gap-2 text-sm text-ink">
              <Check className="h-4 w-4 text-green" strokeWidth={2.5} />
              {perm}
            </p>
          ))}
        </div>
        <div className="flex gap-2">
          <SketchButton
            variant="accent"
            loading={setRole.isPending}
            onClick={() => promoting && setRole.mutate({ userId: promoting.id, role: 'moderator' })}
          >
            Promote to moderator
          </SketchButton>
          <SketchButton variant="ghost" onClick={() => setPromoting(null)}>
            Cancel
          </SketchButton>
        </div>
      </SketchModal>

      {/* confirm revoke / demote */}
      <SketchModal
        open={!!revoking}
        onClose={() => setRevoking(null)}
        title={
          revoking?.role === 'admin'
            ? `Demote ${revoking.name} to moderator?`
            : `Revoke ${revoking?.name}?`
        }
        maxWidth="max-w-[440px]"
      >
        <p className="mb-4 text-sm text-ink-soft">
          {revoking?.role === 'admin'
            ? 'They keep moderation powers but lose access to pricing, platform keys, and this page.'
            : "They return to a regular User role; anything in their queues becomes unassigned. This can't remove the last admin's powers."}
        </p>
        <div className="flex gap-2">
          <SketchButton
            variant="danger"
            loading={setRole.isPending}
            onClick={() =>
              revoking &&
              setRole.mutate({
                userId: revoking.id,
                role: revoking.role === 'admin' ? 'moderator' : 'user',
              })
            }
          >
            {revoking?.role === 'admin' ? 'Demote' : 'Revoke access'}
          </SketchButton>
          <SketchButton variant="ghost" onClick={() => setRevoking(null)}>
            Keep them
          </SketchButton>
        </div>
      </SketchModal>
    </div>
  );
}

export default function AdminModerators() {
  return (
    <AdminGate minRole="admin">
      <SketchToaster />
      <ModeratorsBody />
    </AdminGate>
  );
}
