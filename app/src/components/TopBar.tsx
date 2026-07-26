import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { AnimatePresence, motion } from 'framer-motion';
import { Menu, Plus, LibraryBig, Presentation, Route, ChevronDown, LogOut } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/hooks/useAuth';

const ROLE_CHIP: Record<string, string> = {
  user: 'bg-blue-soft text-ink',
  moderator: 'bg-purple-soft text-ink',
  admin: 'bg-purple text-paper-3',
};

const NEW_MENU = [
  { to: '/lesson-path', label: 'Repository', icon: LibraryBig, hint: 'a course, menu, catalog…' },
  { to: '/slides', label: 'Slide tool', icon: Presentation, hint: 'generate a deck' },
  { to: '/lesson-path', label: 'Lesson Path', icon: Route, hint: 'repo + slides in one go' },
];

function useDismiss(onDismiss: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onDismiss();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onDismiss]);
  return ref;
}

export interface TopBarProps {
  onMenuClick: () => void;
}

/** Top bar (design.md §7.1): token pill, + New menu, avatar dropdown — pages
 *  carry their own headings, so the bar shows no page title. */
export default function TopBar({ onMenuClick }: TopBarProps) {
  const [newOpen, setNewOpen] = useState(false);
  const [avatarOpen, setAvatarOpen] = useState(false);
  const newRef = useDismiss(() => setNewOpen(false));
  const avatarRef = useDismiss(() => setAvatarOpen(false));
  const { user, logout } = useAuth();

  return (
    <header className="sticky top-0 z-30 border-b-2 border-dashed border-pencil bg-paper/90 backdrop-blur-sm">
      <div className="mx-auto flex h-16 w-full max-w-content items-center gap-3 px-4 lg:px-8">
        {/* hamburger (mobile / <lg) */}
        <button
          onClick={onMenuClick}
          aria-label="Open menu"
          className="rounded-wobble-sm border-2 border-transparent p-2 text-ink hover:border-dashed hover:border-ink lg:hidden"
        >
          <Menu className="h-5 w-5" strokeWidth={2} />
        </button>

        {/* No page title here — every page carries its own heading; the bar
            keeps only navigation and account controls. */}

        <div className="ml-auto flex items-center gap-2">
          {/* token pill — live balance when signed in */}
          {user ? (
            <Link
              to="/settings?tab=tokens"
              className="flex items-center gap-1.5 rounded-wobble-sm border-2 border-ink bg-orange/20 px-2.5 py-1 font-mono text-sm font-bold text-ink no-underline shadow-offset transition-transform hover:-translate-y-0.5"
              title="Token balance — click to recharge"
            >
              <span aria-hidden="true">🪙</span>
              <span>{user.tokenBalance}</span>
            </Link>
          ) : (
            <Link
              to="/auth"
              className="rounded-wobble-sm border-2 border-ink bg-paper-3 px-3 py-1.5 font-heading text-sm font-semibold text-ink no-underline shadow-offset transition-transform hover:-translate-y-0.5"
            >
              Sign in
            </Link>
          )}

          {/* + New quick-create */}
          <div className="relative" ref={newRef}>
            <button
              onClick={() => setNewOpen((o) => !o)}
              className="flex items-center gap-1.5 rounded-wobble-sm border-2 border-ink bg-yellow px-3 py-1.5 font-heading font-semibold text-ink shadow-offset transition-all hover:-translate-y-0.5 hover:shadow-offset-hover active:translate-x-[2px] active:translate-y-[2px] active:shadow-offset-pressed"
            >
              <Plus className="h-4 w-4" strokeWidth={2.5} />
              New
              <ChevronDown
                className={cn('h-3.5 w-3.5 transition-transform', newOpen && 'rotate-180')}
              />
            </button>
            <AnimatePresence>
              {newOpen && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.96, y: -4 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.96, y: -4 }}
                  transition={{ duration: 0.15 }}
                  className="absolute right-0 top-full z-50 mt-2 w-64 rounded-wobble-sm border-2 border-ink bg-paper-3 p-2 shadow-offset"
                >
                  {NEW_MENU.map((item) => (
                    <Link
                      key={item.label}
                      to={item.to}
                      onClick={() => setNewOpen(false)}
                      className="flex items-start gap-2.5 rounded-wobble-sm px-3 py-2 no-underline hover:bg-paper-2"
                    >
                      <item.icon className="mt-0.5 h-[18px] w-[18px] text-ink" strokeWidth={2} />
                      <span>
                        <span className="block font-heading font-semibold text-ink">
                          {item.label}
                        </span>
                        <span className="block text-xs text-ink-faint">{item.hint}</span>
                      </span>
                    </Link>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* avatar dropdown */}
          <div className="relative" ref={avatarRef}>
            <button
              onClick={() => setAvatarOpen((o) => !o)}
              aria-label="Account"
              className="flex h-10 w-10 items-center justify-center rounded-full border-2 border-ink bg-purple-soft font-display text-xl text-ink shadow-offset transition-transform hover:-translate-y-0.5"
            >
              {user ? user.name.charAt(0).toUpperCase() : '?'}
            </button>
            <AnimatePresence>
              {avatarOpen && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.96, y: -4 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.96, y: -4 }}
                  transition={{ duration: 0.15 }}
                  className="absolute right-0 top-full z-50 mt-2 w-56 rounded-wobble-sm border-2 border-ink bg-paper-3 p-2 shadow-offset"
                >
                  {user ? (
                    <>
                      <div className="border-b-2 border-dashed border-pencil px-3 pb-2 pt-1">
                        <p className="truncate font-heading font-semibold text-ink">{user.name}</p>
                        <p className="truncate text-xs text-ink-faint">{user.email}</p>
                        <span
                          className={cn(
                            'micro mt-1 inline-block rounded-full border border-ink/20 px-1.5 text-[0.6rem]',
                            ROLE_CHIP[user.role],
                          )}
                        >
                          {user.role}
                        </span>
                      </div>
                      <Link
                        to="/settings"
                        onClick={() => setAvatarOpen(false)}
                        className="mt-1 block rounded-wobble-sm px-3 py-2 font-heading font-semibold text-ink no-underline hover:bg-paper-2"
                      >
                        Settings
                      </Link>
                      <button
                        onClick={() => {
                          setAvatarOpen(false);
                          void logout();
                        }}
                        className="flex w-full items-center gap-2 rounded-wobble-sm px-3 py-2 text-left font-heading font-semibold text-red hover:bg-red-soft"
                      >
                        <LogOut className="h-4 w-4" strokeWidth={2} />
                        Sign out
                      </button>
                    </>
                  ) : (
                    <>
                      <Link
                        to="/auth"
                        onClick={() => setAvatarOpen(false)}
                        className="block rounded-wobble-sm px-3 py-2 font-heading font-semibold text-ink no-underline hover:bg-paper-2"
                      >
                        Sign in
                      </Link>
                      <p className="px-3 pb-1 text-xs text-ink-faint">
                        Guests get 3 Coach messages
                      </p>
                    </>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </header>
  );
}
