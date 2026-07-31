import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router';
import { cn } from '@/lib/utils';
import { AnimatePresence, motion } from 'framer-motion';
import { useIsFetching, useIsMutating } from '@tanstack/react-query';
import Lenis from 'lenis';
import SideRail from './SideRail';
import TopBar from './TopBar';
import Footer from './Footer';

/** Site-wide Lenis smooth scroll (design.md §6). Containers marked
 *  `data-lenis-prevent` (chat thread, slide player) keep native scrolling. */
function useLenis() {
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const lenis = new Lenis({ lerp: 0.1 });
    let raf = requestAnimationFrame(function loop(time) {
      lenis.raf(time);
      raf = requestAnimationFrame(loop);
    });
    return () => {
      cancelAnimationFrame(raf);
      lenis.destroy();
    };
  }, []);
}

/**
 * Top progress bar (design.md §6): a 3px bar fixed to the viewport top.
 * - Runs a determinate ink→yellow sweep on every route change.
 * - While ANY query/mutation is in flight, a light "beam" repeatedly slides
 *   left→right across the top so the page reads as actively loading.
 */
export function TopProgressBar() {
  const location = useLocation();
  const [runKey, setRunKey] = useState(0);
  // Non-zero whenever data is loading anywhere in the app.
  const busy = useIsFetching() + useIsMutating() > 0;

  useEffect(() => {
    setRunKey((k) => k + 1);
  }, [location.pathname]);

  return (
    <div className="pointer-events-none fixed left-0 right-0 top-0 z-[80] h-[3px] overflow-hidden">
      {/* route-change sweep */}
      <AnimatePresence>
        {runKey > 0 && (
          <motion.div
            key={runKey}
            className="absolute inset-y-0 left-0 bg-gradient-to-r from-ink via-ink to-yellow"
            initial={{ width: '0%', opacity: 1 }}
            animate={{ width: '100%', opacity: [1, 1, 0] }}
            transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          />
        )}
      </AnimatePresence>

      {/* loading beam — a light streak that keeps crossing while busy */}
      <AnimatePresence>
        {busy && (
          <motion.div
            key="beam"
            className="absolute inset-y-0 w-1/4 rounded-full bg-gradient-to-r from-transparent via-yellow to-transparent"
            initial={{ left: '-25%', opacity: 0 }}
            animate={{ left: ['-25%', '100%'], opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{
              left: { duration: 1.1, repeat: Infinity, repeatDelay: 0.15, ease: 'easeInOut' },
              opacity: { duration: 0.2 },
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

/**
 * App shell (design.md §7.1): fixed left SideRail + TopBar + content slot (<Outlet/>)
 * + top progress bar + footer. Footer is omitted on the slide-player route
 * (/slides/:slug) so the player can use a focus mode.
 */
export default function Layout() {
  const [railOpen, setRailOpen] = useState(false);
  const location = useLocation();
  const isPlayerFocus = /^\/slides\/.+/.test(location.pathname);
  /* The feed runs edge to edge: a post should have the whole window's height,
     the way TikTok gives a video the whole window. On a wide screen that means
     no top bar and no footer — the rail already carries the account, the token
     meter and the settings, so nothing is lost by dropping the bar. Below lg
     the bar stays, because the hamburger inside it is the only way to open the
     rail on a phone. */
  const isFeedFocus = location.pathname === '/' || location.pathname === '/feed';
  /* The marketing tool is a workbench, not a document: the preview on the
     left has to stay in sight of the panel on the right, and scrolling the
     page moves one away from the other. So it gets the window's height and
     scrolls inside itself instead — the top bar stays, because the coin
     balance beside every price is part of using the thing. */
  const isFitToWindow = location.pathname === '/admin/projects/marketing';
  useLenis();

  return (
    <div className="paper-grain min-h-[100dvh]">
      <TopProgressBar />
      <SideRail open={railOpen} onClose={() => setRailOpen(false)} />

      <div
        className={cn(
          'flex flex-col lg:pl-[240px]',
          isFeedFocus || isFitToWindow ? 'min-h-[100dvh] lg:h-[100dvh]' : 'min-h-[100dvh]',
        )}
      >
        <div className={cn(isFeedFocus && 'lg:hidden')}>
          <TopBar onMenuClick={() => setRailOpen(true)} />
        </div>
        <main className={cn('flex-1', (isFeedFocus || isFitToWindow) && 'lg:min-h-0')}>
          <Outlet />
        </main>
        {!isPlayerFocus && !isFeedFocus && !isFitToWindow && <Footer />}
      </div>
    </div>
  );
}
