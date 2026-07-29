import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { AnimatePresence, motion } from 'framer-motion';
import { toast } from 'sonner';
import { Coins, Plus, Search, ShieldCheck, Ticket, Trash2, UserCog, X } from 'lucide-react';
import { trpc } from '@/providers/trpc';
import { useAuth } from '@/hooks/useAuth';
import SketchButton from '@/components/sketch/SketchButton';
import SketchCard from '@/components/sketch/SketchCard';
import SketchTable from '@/components/sketch/SketchTable';
import Chip from '@/components/sketch/Chip';
import AdminGate from '@/components/admin/AdminGate';
import SketchToaster from '@/components/admin/SketchToaster';
import CountUp from '@/components/admin/CountUp';
import { SketchDrawer, SketchModal } from '@/components/admin/overlays';
import {
  LabeledField,
  SketchInput,
  SketchSelect,
  SkeletonBlock,
} from '@/components/admin/controls';
import { errMsg, formatDate, formatRelative } from '@/components/admin/utils';
import type { AdminUserRow, Role } from '@contracts/types';

/** Inline "create account" panel for the Manage users toolbar (admin only —
 *  the whole page is behind AdminGate; the endpoint is adminProcedure too). */
function AddUserForm({ onDone }: { onDone: () => void }) {
  const utils = trpc.useUtils();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<Role>('user');
  const [tokens, setTokens] = useState(0);

  const create = trpc.users.createUser.useMutation({
    onSuccess: () => {
      toast.success(`Account created for ${name.trim()} ✦`);
      void utils.users.list.invalidate();
      onDone();
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  const submit = () => {
    if (name.trim().length < 1) return toast.error('Give the user a name');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return toast.error('That email looks smudged');
    if (password.length < 6) return toast.error('Password needs at least 6 characters');
    create.mutate({ name: name.trim(), email: email.trim(), password, role, tokens });
  };

  return (
    <div className="mt-3 rounded-wobble-2 border-2 border-dashed border-blue bg-paper p-4 shadow-offset">
      <p className="micro mb-3 font-semibold text-ink-soft">
        New account — they can sign in right away with this email and password.
      </p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <LabeledField label="Username (unique)">
          <SketchInput value={name} onChange={(e) => setName(e.target.value)} placeholder="Sam Sketcher" />
        </LabeledField>
        <LabeledField label="Email">
          <SketchInput value={email} onChange={(e) => setEmail(e.target.value)} placeholder="sam@example.com" type="email" />
        </LabeledField>
        <LabeledField label="Password">
          <SketchInput value={password} onChange={(e) => setPassword(e.target.value)} placeholder="6+ characters" type="text" />
        </LabeledField>
        <LabeledField label="Role">
          <SketchSelect value={role} onChange={(e) => setRole(e.target.value as Role)}>
            <option value="user">user</option>
            <option value="moderator">moderator</option>
            <option value="admin">admin</option>
          </SketchSelect>
        </LabeledField>
        <LabeledField label="Starting tokens">
          <SketchInput
            value={String(tokens)}
            onChange={(e) => setTokens(Math.max(0, Math.min(100000, Number(e.target.value) || 0)))}
            type="number"
          />
        </LabeledField>
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <SketchButton variant="ghost" size="sm" onClick={onDone}>
          Cancel
        </SketchButton>
        <SketchButton variant="accent" size="sm" loading={create.isPending} onClick={submit}>
          <Plus className="h-4 w-4" strokeWidth={2.5} />
          Create account
        </SketchButton>
      </div>
    </div>
  );
}

const ROLE_FILTERS: { id: Role | 'all'; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'user', label: 'User' },
  { id: 'moderator', label: 'Moderator' },
  { id: 'admin', label: 'Admin' },
];

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

/* ------------------------------------------------------------------ */
/* Adjust tokens modal — add credits or take awarded ones back         */
/* ------------------------------------------------------------------ */

function CreditModal({
  target,
  onClose,
  onCredited,
}: {
  target: AdminUserRow;
  onClose: () => void;
  onCredited: (userId: number, balance: number) => void;
}) {
  const [direction, setDirection] = useState<'credit' | 'deduct'>('credit');
  const [amount, setAmount] = useState(100);
  const [reason, setReason] = useState('manual credit');

  const credit = trpc.users.creditTokens.useMutation({
    onSuccess: (r) => {
      toast.success(
        direction === 'credit'
          ? `Credited ${amount} 🪙 to ${target.name}`
          : `Removed ${amount} 🪙 from ${target.name}`,
      );
      onCredited(target.id, r.balance);
      onClose();
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  const overdraft = direction === 'deduct' && amount > target.tokenBalance;
  const resulting =
    direction === 'credit' ? target.tokenBalance + amount : target.tokenBalance - amount;

  return (
    <SketchModal
      open
      onClose={onClose}
      title={`Adjust ${target.name}'s tokens`}
      maxWidth="max-w-[440px]"
    >
      <div className="flex flex-col gap-4">
        <div className="flex gap-2" role="group" aria-label="Add or remove">
          <button
            onClick={() => {
              setDirection('credit');
              setReason((r) => (r === 'manual deduction' ? 'manual credit' : r));
            }}
            className={
              direction === 'credit'
                ? 'flex-1 rounded-wobble-sm border-2 border-ink bg-green-soft px-3 py-1.5 text-sm font-bold text-ink shadow-offset'
                : 'flex-1 rounded-wobble-sm border-2 border-dashed border-pencil px-3 py-1.5 text-sm font-bold text-ink-soft hover:border-ink hover:text-ink'
            }
          >
            + Add
          </button>
          <button
            onClick={() => {
              setDirection('deduct');
              setReason((r) => (r === 'manual credit' ? 'manual deduction' : r));
            }}
            className={
              direction === 'deduct'
                ? 'flex-1 rounded-wobble-sm border-2 border-ink bg-red-soft px-3 py-1.5 text-sm font-bold text-ink shadow-offset'
                : 'flex-1 rounded-wobble-sm border-2 border-dashed border-pencil px-3 py-1.5 text-sm font-bold text-ink-soft hover:border-ink hover:text-ink'
            }
          >
            − Remove
          </button>
        </div>
        <LabeledField
          label="Amount 🪙"
          helper={
            direction === 'credit'
              ? 'Added to their balance.'
              : `Taken back from their balance (they have ${target.tokenBalance} 🪙).`
          }
        >
          <div className="flex items-center gap-2">
            <SketchButton
              variant="secondary"
              size="icon"
              aria-label="Less"
              onClick={() => setAmount((a) => Math.max(1, a - 50))}
            >
              −
            </SketchButton>
            <SketchInput
              type="number"
              min={1}
              max={100000}
              value={amount}
              onChange={(e) => setAmount(Math.max(1, Number(e.target.value) || 1))}
              className="text-center font-mono font-bold"
            />
            <SketchButton
              variant="secondary"
              size="icon"
              aria-label="More"
              onClick={() => setAmount((a) => Math.min(100000, a + 50))}
            >
              +
            </SketchButton>
          </div>
        </LabeledField>
        <LabeledField label="Reason" helper="Written to their token ledger.">
          <SketchInput value={reason} onChange={(e) => setReason(e.target.value)} />
        </LabeledField>
        <p className={overdraft ? 'text-sm font-bold text-red' : 'text-sm text-ink-soft'}>
          {overdraft
            ? `They only have ${target.tokenBalance} 🪙 — can't remove ${amount}.`
            : `New balance: ${resulting} 🪙`}
        </p>
        <div className="flex gap-2">
          <SketchButton
            variant={direction === 'credit' ? 'accent' : 'danger'}
            loading={credit.isPending}
            disabled={overdraft}
            onClick={() =>
              credit.mutate({
                userId: target.id,
                amount,
                direction,
                reason: reason || (direction === 'credit' ? 'manual credit' : 'manual deduction'),
              })
            }
          >
            <Coins className="h-4 w-4" strokeWidth={2} />{' '}
            {direction === 'credit' ? `Credit ${amount} 🪙` : `Remove ${amount} 🪙`}
          </SketchButton>
          <SketchButton variant="ghost" onClick={onClose}>
            Cancel
          </SketchButton>
        </div>
      </div>
    </SketchModal>
  );
}

/* ------------------------------------------------------------------ */
/* Delete user confirmation (admin only)                               */
/* ------------------------------------------------------------------ */

function DeleteModal({
  target,
  onClose,
  onDeleted,
}: {
  target: AdminUserRow;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const del = trpc.users.deleteUser.useMutation({
    onSuccess: () => {
      toast.success(`${target.name}'s account was deleted`);
      onDeleted();
      onClose();
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  return (
    <SketchModal open onClose={onClose} title={`Delete ${target.name}?`} maxWidth="max-w-[460px]">
      <div className="flex flex-col gap-4">
        <div className="rounded-wobble-sm border-2 border-red bg-red-soft p-3">
          <p className="text-sm font-bold text-red">This can't be undone.</p>
          <p className="mt-1 text-sm text-ink-soft">
            Their account is erased from the platform along with everything they own: slide
            tools, repositories, runs, favorites, tickets, and their token history
            ({target.tokenBalance} 🪙).
          </p>
        </div>
        <div className="flex gap-2">
          <SketchButton
            variant="danger"
            loading={del.isPending}
            onClick={() => del.mutate({ userId: target.id })}
          >
            <Trash2 className="h-4 w-4" strokeWidth={2} /> Delete user forever
          </SketchButton>
          <SketchButton variant="ghost" onClick={onClose}>
            Keep the account
          </SketchButton>
        </div>
      </div>
    </SketchModal>
  );
}

/* ------------------------------------------------------------------ */
/* Sell customization tickets to a moderator (admin only)              */
/* ------------------------------------------------------------------ */

function TicketsModal({
  target,
  onClose,
  onSold,
}: {
  target: AdminUserRow;
  onClose: () => void;
  onSold: () => void;
}) {
  const [count, setCount] = useState(10);
  const priceQ = trpc.tickets.price.useQuery();
  const unit = priceQ.data?.price ?? 0;
  const total = unit * count;

  const sell = trpc.tickets.sellToModerator.useMutation({
    onSuccess: (r) => {
      toast.success(
        `Sold ${count} ticket${count === 1 ? '' : 's'} to ${target.name} — ${r.ticketBalance} in pool, ${r.tokenBalance} 🪙 left`,
      );
      onSold();
      onClose();
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  const tooExpensive = total > target.tokenBalance;

  return (
    <SketchModal open onClose={onClose} title={`Sell tickets to ${target.name}`} maxWidth="max-w-[440px]">
      <div className="flex flex-col gap-4">
        <p className="text-sm text-ink-soft">
          Each customization ticket costs{' '}
          <span className="font-bold text-orange">{unit} 🪙</span> — the price of the most expensive
          slide a customization can produce. The cost is charged to {target.name}'s credit balance
          ({target.tokenBalance} 🪙) and added to their ticket pool.
        </p>
        <LabeledField label="Tickets to sell" helper="They gift these to their students, one per customization.">
          <div className="flex items-center gap-2">
            <SketchButton
              variant="secondary"
              size="icon"
              aria-label="Fewer"
              onClick={() => setCount((c) => Math.max(1, c - 5))}
            >
              −
            </SketchButton>
            <SketchInput
              type="number"
              min={1}
              max={500}
              value={count}
              onChange={(e) => setCount(Math.max(1, Math.min(500, Number(e.target.value) || 1)))}
              className="text-center font-mono font-bold"
            />
            <SketchButton
              variant="secondary"
              size="icon"
              aria-label="More"
              onClick={() => setCount((c) => Math.min(500, c + 5))}
            >
              +
            </SketchButton>
          </div>
        </LabeledField>
        <p className={tooExpensive ? 'text-sm font-bold text-red' : 'text-sm text-ink-soft'}>
          Total: {total} 🪙{tooExpensive && ` — more than ${target.name}'s balance`}
        </p>
        <div className="flex gap-2">
          <SketchButton
            variant="accent"
            loading={sell.isPending}
            disabled={tooExpensive || unit === 0}
            onClick={() => sell.mutate({ userId: target.id, count })}
          >
            <Ticket className="h-4 w-4" strokeWidth={2} /> Sell {count} for {total} 🪙
          </SketchButton>
          <SketchButton variant="ghost" onClick={onClose}>
            Cancel
          </SketchButton>
        </div>
      </div>
    </SketchModal>
  );
}

/* ------------------------------------------------------------------ */
/* Set role (admin only)                                               */
/* ------------------------------------------------------------------ */

function RoleModal({
  target,
  onClose,
  onChanged,
}: {
  target: AdminUserRow;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [role, setRole] = useState<Role>(target.role);

  const setRoleMut = trpc.users.setRole.useMutation({
    onSuccess: () => {
      toast.success(
        role === 'moderator'
          ? `Welcome to the desk, ${target.name} ✦`
          : `${target.name} is now ${role === 'admin' ? 'an admin' : 'a user'}`,
      );
      onChanged();
      onClose();
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  return (
    <SketchModal open onClose={onClose} title={`Change ${target.name}'s role`} maxWidth="max-w-[440px]">
      <LabeledField
        label="New role"
        helper={
          role === 'moderator'
            ? 'Moderators can credit tokens, review flags, and view all runs.'
            : role === 'admin'
              ? 'Admins can do everything, including pricing and platform keys.'
              : 'Users create repos, play decks, and buy tokens.'
        }
      >
        <SketchSelect value={role} onChange={(e) => setRole(e.target.value as Role)}>
          <option value="user">User</option>
          <option value="moderator">Moderator</option>
          <option value="admin">Admin</option>
        </SketchSelect>
      </LabeledField>
      <div className="mt-4 flex gap-2">
        <SketchButton
          loading={setRoleMut.isPending}
          disabled={role === target.role}
          onClick={() => setRoleMut.mutate({ userId: target.id, role })}
        >
          <ShieldCheck className="h-4 w-4" strokeWidth={2} /> Set role
        </SketchButton>
        <SketchButton variant="ghost" onClick={onClose}>
          Cancel
        </SketchButton>
      </div>
    </SketchModal>
  );
}

/* ------------------------------------------------------------------ */
/* User detail drawer                                                  */
/* ------------------------------------------------------------------ */

function UserDrawer({
  userId,
  isAdmin,
  selfId,
  onClose,
  onChanged,
}: {
  userId: number;
  isAdmin: boolean;
  selfId: number;
  onClose: () => void;
  onChanged: () => void;
}) {
  const detail = trpc.users.detail.useQuery({ userId });
  const [crediting, setCrediting] = useState(false);
  const [roleEditing, setRoleEditing] = useState(false);
  const [sellingTickets, setSellingTickets] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const utils = trpc.useUtils();

  const u = detail.data;
  const isModerator = u?.role === 'moderator' || u?.role === 'admin';

  return (
    <SketchDrawer open onClose={onClose} title={u ? u.name : 'User'} width={520}>
      {detail.isLoading || !u ? (
        <SkeletonBlock lines={4} status="Opening their page…" />
      ) : (
        <div className="flex flex-col gap-5">
          <div className="flex items-center gap-4">
            <span className="flex h-16 w-16 items-center justify-center rounded-full border-2 border-ink bg-purple-soft font-display text-3xl text-ink shadow-offset">
              {u.name.charAt(0).toUpperCase()}
            </span>
            <div className="min-w-0">
              <p className="flex flex-wrap items-center gap-2 font-heading text-lg font-semibold text-ink">
                {u.name}
                <Chip kind={u.role}>{u.role}</Chip>
                {u.id === selfId && <Chip kind="neutral">you</Chip>}
              </p>
              <p className="truncate text-sm text-ink-soft">{u.email}</p>
              <p className="micro mt-0.5 text-ink-faint">joined {formatDate(u.createdAt)}</p>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <SketchCard borderStyle="dashed" className="p-3 text-center">
              <p className="font-display text-3xl font-bold text-orange">
                <CountUp value={u.tokenBalance} />
              </p>
              <p className="micro text-ink-faint">tokens</p>
            </SketchCard>
            {isModerator ? (
              <SketchCard borderStyle="dashed" index={1} className="p-3 text-center">
                <p className="font-display text-3xl font-bold text-green">
                  <CountUp value={u.ticketBalance} />
                </p>
                <p className="micro text-ink-faint">tickets</p>
              </SketchCard>
            ) : (
              <SketchCard borderStyle="dashed" index={1} className="p-3 text-center">
                <p className="font-display text-3xl font-bold text-ink">
                  <CountUp value={u.runCount} />
                </p>
                <p className="micro text-ink-faint">runs</p>
              </SketchCard>
            )}
            <SketchCard borderStyle="dashed" index={2} className="p-3 text-center">
              <p className="font-display text-3xl font-bold text-ink">
                {formatRelative(u.createdAt).replace(' ago', '')}
              </p>
              <p className="micro text-ink-faint">member for</p>
            </SketchCard>
          </div>

          <div className="flex flex-wrap gap-2 border-t-2 border-dashed border-pencil pt-4">
            <SketchButton variant="accent" onClick={() => setCrediting(true)}>
              <Coins className="h-4 w-4" strokeWidth={2} /> Adjust tokens
            </SketchButton>
            {isAdmin && isModerator && (
              <SketchButton variant="secondary" onClick={() => setSellingTickets(true)}>
                <Ticket className="h-4 w-4" strokeWidth={2} /> Sell tickets
              </SketchButton>
            )}
            {isAdmin && (
              <SketchButton variant="secondary" onClick={() => setRoleEditing(true)}>
                <UserCog className="h-4 w-4" strokeWidth={2} /> Set role
              </SketchButton>
            )}
            {isAdmin && u.id !== selfId && (
              <SketchButton
                variant="ghost"
                className="text-red hover:border-red"
                onClick={() => setDeleting(true)}
              >
                <Trash2 className="h-4 w-4" strokeWidth={2} /> Delete user
              </SketchButton>
            )}
          </div>

          {crediting && (
            <CreditModal
              target={u}
              onClose={() => setCrediting(false)}
              onCredited={() => {
                void detail.refetch();
                void utils.auth.me.invalidate();
                onChanged();
              }}
            />
          )}
          {roleEditing && (
            <RoleModal
              target={u}
              onClose={() => setRoleEditing(false)}
              onChanged={() => {
                void detail.refetch();
                onChanged();
              }}
            />
          )}
          {sellingTickets && (
            <TicketsModal
              target={u}
              onClose={() => setSellingTickets(false)}
              onSold={() => {
                void detail.refetch();
                void utils.auth.me.invalidate();
                onChanged();
              }}
            />
          )}
          {deleting && (
            <DeleteModal
              target={u}
              onClose={() => setDeleting(false)}
              onDeleted={() => {
                onChanged();
                onClose();
              }}
            />
          )}
        </div>
      )}
    </SketchDrawer>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

function UsersBody() {
  const { user: me, role: myRole } = useAuth();
  const utils = trpc.useUtils();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounced(search, 250);
  const [roleFilter, setRoleFilter] = useState<Role | 'all'>('all');
  const [addOpen, setAddOpen] = useState(false);
  const [drawerId, setDrawerId] = useState<number | null>(null);
  const [crediting, setCrediting] = useState<AdminUserRow | null>(null);
  const [roleEditing, setRoleEditing] = useState<AdminUserRow | null>(null);
  const [deleting, setDeleting] = useState<AdminUserRow | null>(null);

  const isAdmin = myRole === 'admin';

  const list = trpc.users.list.useQuery({
    q: debouncedSearch || undefined,
    role: roleFilter === 'all' ? undefined : roleFilter,
    limit: 100,
  });

  // ?u= deep link opens the drawer (dashboard chart bars link here)
  useEffect(() => {
    const u = params.get('u');
    if (u) {
      const id = Number(u);
      if (Number.isFinite(id)) setDrawerId(id);
    }
  }, [params]);

  const closeDrawer = () => {
    setDrawerId(null);
    setParams((p) => {
      const next = new URLSearchParams(p);
      next.delete('u');
      return next;
    });
  };

  const rows = useMemo(() => list.data ?? [], [list.data]);

  return (
    <div className="mx-auto flex w-full max-w-content flex-col gap-6 px-4 py-8 lg:px-8">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="font-display text-4xl font-bold text-ink">Users</h2>
        <Chip kind="neutral">{rows.length}</Chip>
      </div>

      {/* toolbar */}
      <motion.div
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
      >
        <SketchCard className="flex flex-wrap items-center gap-3 p-3">
          <div className="relative min-w-[220px] flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" strokeWidth={2} />
            <SketchInput
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name or email…"
              className="pl-9"
              aria-label="Search users"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            {ROLE_FILTERS.map((f) => (
              <motion.button
                key={f.id}
                whileTap={{ scale: 0.9 }}
                onClick={() => setRoleFilter(f.id)}
                className={
                  roleFilter === f.id
                    ? 'rounded-wobble-sm border-2 border-ink bg-yellow px-3 py-1 text-xs font-bold uppercase tracking-wider text-ink shadow-offset'
                    : 'rounded-wobble-sm border-2 border-dashed border-pencil px-3 py-1 text-xs font-bold uppercase tracking-wider text-ink-soft hover:border-ink hover:text-ink'
                }
              >
                {f.label}
              </motion.button>
            ))}
          </div>
          <SketchButton
            variant="accent"
            size="sm"
            className="ml-auto"
            onClick={() => setAddOpen((o) => !o)}
          >
            {addOpen ? <X className="h-4 w-4" strokeWidth={2.5} /> : <Plus className="h-4 w-4" strokeWidth={2.5} />}
            {addOpen ? 'Close' : 'Add user'}
          </SketchButton>
        </SketchCard>
      </motion.div>

      <AnimatePresence>
        {addOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="overflow-hidden"
          >
            <AddUserForm onDone={() => setAddOpen(false)} />
          </motion.div>
        )}
      </AnimatePresence>

      {/* table */}
      {list.isLoading ? (
        <SkeletonBlock lines={5} status="Flipping through the yearbook…" />
      ) : list.isError ? (
        <div className="rounded-wobble-sm border-2 border-red bg-red-soft p-4">
          <p className="font-bold text-red">Couldn't load users: {errMsg(list.error)}</p>
          <SketchButton variant="secondary" size="sm" className="mt-2" onClick={() => list.refetch()}>
            Try again
          </SketchButton>
        </div>
      ) : (
        <SketchTable<AdminUserRow>
          rows={rows}
          rowKey={(r) => String(r.id)}
          onRowClick={(r) => setDrawerId(r.id)}
          columns={[
            {
              key: 'user',
              header: 'User',
              sortValue: (r) => r.name.toLowerCase(),
              render: (r) => (
                <span className="flex items-center gap-2.5">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 border-ink bg-blue-soft font-display text-base text-ink">
                    {r.name.charAt(0).toUpperCase()}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate font-heading font-semibold text-ink">
                      {r.name}
                      {r.id === me?.id && (
                        <span className="ml-1.5 text-xs font-normal text-ink-faint">(you)</span>
                      )}
                    </span>
                    <span className="block truncate text-xs text-ink-faint">{r.email}</span>
                  </span>
                </span>
              ),
            },
            {
              key: 'role',
              header: 'Role',
              sortValue: (r) => r.role,
              render: (r) => <Chip kind={r.role}>{r.role}</Chip>,
            },
            {
              key: 'tokens',
              header: 'Tokens',
              mono: true,
              sortValue: (r) => r.tokenBalance,
              render: (r) => (
                <span className="inline-flex items-center gap-2">
                  <span className="font-bold text-orange">{r.tokenBalance} 🪙</span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setCrediting(r);
                    }}
                    className="rounded-wobble-sm border-2 border-dashed border-pencil px-1.5 py-0.5 text-xs font-bold text-ink-soft hover:border-ink hover:text-ink"
                    title="Add or remove tokens"
                  >
                    ± Credit
                  </button>
                </span>
              ),
            },
            {
              key: 'runs',
              header: 'Runs',
              mono: true,
              sortValue: (r) => r.runCount,
              render: (r) => r.runCount,
            },
            {
              key: 'joined',
              header: 'Joined',
              mono: true,
              sortValue: (r) => r.createdAt.getTime(),
              render: (r) => formatDate(r.createdAt),
            },
            {
              key: 'actions',
              header: '',
              render: (r) =>
                isAdmin ? (
                  <span className="inline-flex items-center gap-1.5">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setRoleEditing(r);
                      }}
                      className="rounded-wobble-sm border-2 border-dashed border-pencil px-2 py-1 text-xs font-bold text-ink-soft hover:border-ink hover:text-ink"
                    >
                      Set role
                    </button>
                    {r.id !== me?.id && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeleting(r);
                        }}
                        aria-label={`Delete ${r.name}`}
                        title="Delete user"
                        className="rounded-wobble-sm border-2 border-dashed border-pencil p-1 text-ink-soft hover:border-red hover:text-red"
                      >
                        <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
                      </button>
                    )}
                  </span>
                ) : (
                  <span className="text-xs text-ink-faint">view →</span>
                ),
            },
          ]}
          emptyState={
            <span className="font-display text-2xl text-ink-faint">
              No users match — try clearing the filters 🔍
            </span>
          }
        />
      )}

      {drawerId !== null && (
        <UserDrawer
          userId={drawerId}
          isAdmin={isAdmin}
          selfId={me?.id ?? -1}
          onClose={closeDrawer}
          onChanged={() => void utils.users.list.invalidate()}
        />
      )}
      {crediting && (
        <CreditModal
          target={crediting}
          onClose={() => setCrediting(null)}
          onCredited={() => {
            void utils.users.list.invalidate();
            void utils.auth.me.invalidate();
          }}
        />
      )}
      {roleEditing && (
        <RoleModal
          target={roleEditing}
          onClose={() => setRoleEditing(null)}
          onChanged={() => void utils.users.list.invalidate()}
        />
      )}
      {deleting && (
        <DeleteModal
          target={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={() => {
            if (drawerId === deleting.id) closeDrawer();
            void utils.users.list.invalidate();
          }}
        />
      )}
    </div>
  );
}

export default function AdminUsers() {
  return (
    <AdminGate minRole="moderator">
      <SketchToaster />
      <UsersBody />
    </AdminGate>
  );
}
