import { useEffect } from 'react';
import { Link, NavLink, useLocation } from 'react-router';
import {
  Images,
  Rows3,
  MessageCircle,
  Presentation,
  LibraryBig,
  Info,
  CreditCard,
  LayoutDashboard,
  Users,
  Settings,
  X,
} from 'lucide-react';
import { LogOut } from 'lucide-react';
import { cn } from '@/lib/utils';
import TokenMeter from './sketch/TokenMeter';
import { DoodleArrow } from './sketch/DoodleIcons';
import { useAuth } from '@/hooks/useAuth';
import { say } from '@/lib/i18n';
import LanguagePicker from '@/components/LanguagePicker';
import { SITE } from '@contracts/site';

const ROLE_CHIP: Record<string, string> = {
  user: 'bg-blue-soft text-ink',
  moderator: 'bg-purple-soft text-ink',
  admin: 'bg-purple text-paper-3',
};

// Note: Lesson Path has no nav shortcut — it's reached via "New repository"
// on the Repos page (the repo builder). The /lesson-path route still exists.
const NAV_ITEMS = [
  { to: '/', label: 'Feed', icon: Rows3, end: true },
  { to: '/repos', label: 'Repos', icon: LibraryBig },
  { to: '/slides', label: 'Slides', icon: Presentation },
  { to: '/gallery', label: 'Gallery', icon: Images },
  { to: '/users', label: 'Users', icon: Users },
  { to: '/card', label: 'Card', icon: CreditCard },
  { to: '/about', label: 'About', icon: Info },
];

/* The Dashboard is ADMIN only — a moderator has no control panel. Their own
   pages (the flag queue, the runs) keep their moderator gates and stay
   reachable, but the hub that lists everything is not theirs. */
// Staff-only. The Dashboard is a control panel: every other staff page
// (Manage users, Moderators, Presentation runs, Slide templates, Platform,
// Analytics, Payments, Flags) is reached from its launcher tiles, so the
// rail keeps a single entry.
const ADMIN_ITEMS = [
  // no `end` — stays highlighted on /admin/* sub-pages, EXCEPT the marketing
  // tool: that is reached from the feed's "New post" and belongs to the feed,
  // whatever its address happens to be.
  { to: '/admin', label: 'Dashboard', icon: LayoutDashboard, notUnder: '/admin/projects/marketing' },
];

function RailLink({
  to,
  label,
  icon: Icon,
  end,
  notUnder,
}: {
  to: string;
  label: string;
  icon: typeof MessageCircle;
  end?: boolean;
  /** a sub-path that belongs somewhere else, so this entry stays unlit on it */
  notUnder?: string;
}) {
  const here = useLocation().pathname;
  const exiled = notUnder != null && here.startsWith(notUnder);
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        cn(
          'group relative flex items-center gap-2.5 rounded-wobble-sm border-2 px-3 py-2 font-heading text-[0.95rem] no-underline transition-all duration-150',
          isActive && !exiled
            ? 'border-ink bg-yellow/70 text-ink shadow-offset'
            : 'border-transparent text-ink-soft hover:border-dashed hover:border-ink hover:text-ink',
        )
      }
    >
      {({ isActive }) => (
        <>
          <Icon
            className="h-[18px] w-[18px] shrink-0 transition-transform duration-300 group-hover:rotate-2"
            strokeWidth={2}
          />
          <span className="flex-1">{say(label)}</span>
          {isActive && (
            <DoodleArrow className="h-4 w-6 -scale-x-100 text-ink" />
          )}
        </>
      )}
    </NavLink>
  );
}

function RailContent({ onClose }: { onClose?: () => void }) {
  const { user, role, logout } = useAuth();
  const isStaff = role === 'admin';
  const staffItems = ADMIN_ITEMS;

  return (
    <div className="flex h-full flex-col gap-1 p-4">
      {/* logo */}
      <div className="mb-3 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2 no-underline">
          <img src="/logo.svg" alt={`${SITE.name} logo`} className="h-9 w-9 shrink-0" />
          {/* Sized to the name rather than to a number: "Modular-Start" is
              long enough that the old 3xl broke it across two lines inside a
              240px rail, and a wrapped wordmark reads as two words. */}
          <span className="font-display text-[1.6rem] font-bold leading-none text-ink">
            {SITE.name}
          </span>
        </Link>
        {onClose && (
          <button
            onClick={onClose}
            aria-label={say("Close menu")}
            className="rounded-wobble-sm p-1.5 text-ink-soft hover:bg-paper-2 hover:text-ink lg:hidden"
          >
            <X className="h-5 w-5" />
          </button>
        )}
      </div>

      {/* primary nav */}
      <nav className="flex flex-col gap-1">
        {NAV_ITEMS.map((item) => (
          <RailLink key={item.to} {...item} />
        ))}
      </nav>

      {/* role-gated staff section */}
      {isStaff && (
        <>
          <p className="micro mt-4 px-3 text-ink-faint">
            {say('Admin')}
          </p>
          <nav className="flex flex-col gap-1">
            {staffItems.map((item) => (
              <RailLink key={item.to} {...item} />
            ))}
          </nav>
        </>
      )}

      {/* bottom: language + token meter + settings + auth */}
      <div className="mt-auto flex flex-col gap-3 border-t-2 border-dashed border-pencil pt-4">
        <LanguagePicker full />
        {user && <TokenMeter tokens={user.tokenBalance} />}
        <NavLink
          to="/settings"
          className={({ isActive }) =>
            cn(
              'flex items-center gap-2.5 rounded-wobble-sm border-2 px-3 py-2 font-heading text-[0.95rem] no-underline transition-colors',
              isActive
                ? 'border-ink bg-yellow/70 text-ink'
                : 'border-transparent text-ink-soft hover:border-dashed hover:border-ink hover:text-ink',
            )
          }
        >
          <Settings className="h-[18px] w-[18px]" strokeWidth={2} />
          
          {say("Settings")}
        </NavLink>
        {user ? (
          <div className="flex items-center gap-2.5 rounded-wobble-sm border-2 border-ink bg-paper-3 px-3 py-2 shadow-offset">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 border-ink bg-purple-soft font-display text-lg text-ink">
              {user.name.charAt(0).toUpperCase()}
            </span>
            <span className="flex min-w-0 flex-1 flex-col leading-tight">
              <span className="truncate font-heading text-sm text-ink">{user.name}</span>
              <span
                className={cn(
                  'micro mt-0.5 inline-block w-fit rounded-full border border-ink/20 px-1.5 text-[0.6rem]',
                  ROLE_CHIP[user.role],
                )}
              >
                {user.role}
              </span>
            </span>
            <button
              onClick={() => void logout()}
              aria-label={say("Sign out")}
              title={say("Sign out")}
              className="rounded-wobble-sm p-1.5 text-ink-soft transition-colors hover:bg-paper-2 hover:text-red"
            >
              <LogOut className="h-4 w-4" strokeWidth={2} />
            </button>
          </div>
        ) : (
          <Link
            to="/auth"
            className="flex items-center gap-2.5 rounded-wobble-sm border-2 border-ink bg-paper-3 px-3 py-2 font-heading no-underline shadow-offset transition-all hover:-translate-y-0.5 hover:shadow-offset-hover"
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-ink bg-purple-soft font-display text-lg text-ink">
              ?
            </span>
            <span className="text-ink">{say("Sign in")}</span>
          </Link>
        )}
      </div>
    </div>
  );
}

export interface SideRailProps {
  /** Mobile drawer state (owned by Layout) */
  open: boolean;
  onClose: () => void;
}

/**
 * Left side-rail (design.md §7.1).
 * Desktop (≥1024px): fixed 240px rail. Mobile (<1024px): off-canvas drawer over a scrim,
 * closed by default, auto-closes after navigation.
 */
export default function SideRail({ open, onClose }: SideRailProps) {
  const location = useLocation();

  // Auto-close the drawer after any navigation
  useEffect(() => {
    onClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  return (
    <>
      {/* Desktop rail */}
      <aside className="fixed left-0 top-0 z-40 hidden h-full w-[240px] border-r-2 border-ink bg-paper-3 lg:block">
        <RailContent />
      </aside>

      {/* Mobile drawer + scrim */}
      <div
        className={cn(
          'fixed inset-0 z-50 bg-ink/30 transition-opacity duration-200 lg:hidden',
          open ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        className={cn(
          'fixed left-0 top-0 z-[60] h-full w-[260px] border-r-2 border-ink bg-paper-3 shadow-offset transition-transform duration-300 ease-out lg:hidden',
          open ? 'translate-x-0' : '-translate-x-full',
        )}
        aria-hidden={!open}
      >
        <RailContent onClose={onClose} />
      </aside>
    </>
  );
}
