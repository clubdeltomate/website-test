import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation } from 'react-router';
import { Eraser, Pencil, Trash2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/hooks/useAuth';
import { say } from '@/lib/i18n';
import { ANN_COLORS, ANN_WIDTHS } from '@/components/player/AnnotationToolbar';

/* Draw on any page.
 *
 * A pencil in the corner that turns the whole page into something you can
 * write on — for pointing at a thing in a screenshot, marking what is wrong
 * with a layout, working through a number in front of somebody. Admin only.
 *
 * Deliberately temporary. Marks live in this component's state and nowhere
 * else: reload and they are gone, navigate and they are gone. That is what
 * makes it safe to scribble anything at all over a live page — nobody can
 * accidentally leave a note on production for a user to find, and there is
 * no store to migrate, moderate or clean up. It is a whiteboard, not a
 * document.
 *
 * Putting the pencil down is not the same as rubbing the marks out. They
 * stay, and stop catching the mouse, so you can keep using the page you just
 * annotated with the annotation still on it. Only the bin and leaving the
 * page clear them.
 *
 * Not offered on the presentation player. That already has an annotation
 * layer, one that belongs to the slide and gets saved with the run, and two
 * pencils in two corners doing different things is worse than one.
 */

/** Routes that mount the deck player, which brings its own annotation. */
const PLAYER_ROUTES = [
  /^\/runs\/[^/]+\/replay$/,
  /^\/repos\/[^/]+\/play(\/|$)/,
  /^\/slides\/show(\/|$)/,
  // /slides/:slug is the tool page, which plays a deck inline. /slides/build
  // is the hand builder, which does not.
  /^\/slides\/(?!build(\/|$))[^/]+$/,
];

interface Stroke {
  colour: string;
  width: number;
  /** flat x,y pairs in document space */
  points: number[];
}

const toPath = (points: number[]): string => {
  if (points.length < 2) return '';
  let d = `M ${points[0]} ${points[1]}`;
  for (let i = 2; i < points.length; i += 2) d += ` L ${points[i]} ${points[i + 1]}`;
  return d;
};

export default function PageAnnotator() {
  const { role } = useAuth();
  const { pathname } = useLocation();

  if (role !== 'admin') return null;
  if (PLAYER_ROUTES.some((r) => r.test(pathname))) return null;
  /* Keyed by the path: navigating remounts, which is what wipes the marks.
     No effect to forget, no cleanup to get wrong. */
  return <Annotator key={pathname} />;
}

function Annotator() {
  const [open, setOpen] = useState(false);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [draft, setDraft] = useState<number[] | null>(null);
  const [erasing, setErasing] = useState(false);
  const [colour, setColour] = useState(ANN_COLORS[0]);
  const [width, setWidth] = useState(ANN_WIDTHS[1]);
  const [docH, setDocH] = useState(0);
  const host = useRef<SVGSVGElement>(null);
  const drawing = useRef(false);

  /* The sheet has to cover the whole scrollable document, not the window, so
     a mark stays on the paragraph it was drawn beside rather than floating
     over whatever scrolls underneath it. */
  const showing = open || strokes.length > 0;
  useLayoutEffect(() => {
    if (!showing) return;
    const measure = () =>
      setDocH(Math.max(document.body.scrollHeight, document.documentElement.scrollHeight));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(document.body);
    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [showing]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const at = (e: React.PointerEvent): [number, number] => {
    const r = host.current!.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };

  const eraseAt = (x: number, y: number) => {
    const reach = Math.max(14, width * 3);
    setStrokes((all) =>
      all.filter((s) => {
        for (let i = 0; i < s.points.length; i += 2) {
          if (Math.hypot(s.points[i] - x, s.points[i + 1] - y) < reach) return false;
        }
        return true;
      }),
    );
  };

  const down = (e: React.PointerEvent) => {
    // Only the primary button draws; right-click stays the browser's.
    if (e.button !== 0) return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    drawing.current = true;
    const [x, y] = at(e);
    if (erasing) eraseAt(x, y);
    else setDraft([x, y]);
  };

  const move = (e: React.PointerEvent) => {
    if (!drawing.current) return;
    const [x, y] = at(e);
    if (erasing) eraseAt(x, y);
    else setDraft((d) => (d ? [...d, x, y] : [x, y]));
  };

  const up = () => {
    drawing.current = false;
    if (draft && draft.length >= 4) setStrokes((all) => [...all, { colour, width, points: draft }]);
    setDraft(null);
  };

  const swatch = (c: string) => (
    <button
      key={c}
      type="button"
      onClick={() => {
        setColour(c);
        setErasing(false);
      }}
      aria-label={c}
      aria-pressed={!erasing && colour === c}
      style={{ background: c }}
      className={cn(
        'h-5 w-5 rounded-full border-2',
        !erasing && colour === c ? 'border-ink shadow-offset' : 'border-pencil',
      )}
    />
  );

  return createPortal(
    <>
      {/* The sheet. Pointer drags draw; the wheel is left alone, so the page
          still scrolls and you can annotate below the fold. With the pencil
          down it keeps showing the marks but stops taking the mouse, so the
          page underneath is usable again with the notes still on it. */}
      {(open || strokes.length > 0) && (
      <svg
        ref={host}
        onPointerDown={open ? down : undefined}
        onPointerMove={open ? move : undefined}
        onPointerUp={open ? up : undefined}
        onPointerCancel={open ? up : undefined}
        aria-label={say('Drawing layer')}
        className={cn(
          'absolute left-0 top-0 z-[75] w-full',
          open ? 'touch-none' : 'pointer-events-none',
        )}
        style={{ height: docH || '100%', cursor: erasing ? 'cell' : 'crosshair' }}
      >
        {strokes.map((s, i) => (
          <path
            key={i}
            d={toPath(s.points)}
            fill="none"
            stroke={s.colour}
            strokeWidth={s.width}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
        {draft && (
          <path
            d={toPath(draft)}
            fill="none"
            stroke={colour}
            strokeWidth={width}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}
      </svg>
      )}

      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={say('Draw on this page')}
          title={say('Draw on this page')}
          className="fixed bottom-4 right-4 z-[76] flex h-11 w-11 items-center justify-center rounded-full border-2 border-ink bg-yellow text-ink shadow-offset transition-transform hover:-translate-y-0.5"
        >
          <Pencil className="h-5 w-5" strokeWidth={2.5} />
          {/* A dot when there are marks resting under the page, so putting
              the pencil down never looks like losing the work. */}
          {strokes.length > 0 && (
            <span className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full border-2 border-ink bg-red" />
          )}
        </button>
      )}

      {open && (
      <div className="fixed bottom-4 right-4 z-[76] flex items-center gap-2 rounded-wobble-2 border-2 border-ink bg-paper-3 px-2.5 py-2 shadow-offset">
        <button
          type="button"
          onClick={() => setErasing(false)}
          aria-label={say('Pencil')}
          aria-pressed={!erasing}
          title={say('Pencil')}
          className={cn(
            'flex h-8 w-8 items-center justify-center rounded-wobble-sm border-2 transition-colors',
            !erasing
              ? 'border-ink bg-yellow text-ink shadow-offset'
              : 'border-transparent text-ink-soft hover:border-dashed hover:border-ink hover:text-ink',
          )}
        >
          <Pencil className="h-4 w-4" strokeWidth={2} />
        </button>
        <button
          type="button"
          onClick={() => setErasing(true)}
          aria-label={say('Eraser')}
          aria-pressed={erasing}
          title={say('Eraser')}
          className={cn(
            'flex h-8 w-8 items-center justify-center rounded-wobble-sm border-2 transition-colors',
            erasing
              ? 'border-ink bg-yellow text-ink shadow-offset'
              : 'border-transparent text-ink-soft hover:border-dashed hover:border-ink hover:text-ink',
          )}
        >
          <Eraser className="h-4 w-4" strokeWidth={2} />
        </button>

        <span className="flex items-center gap-1 border-l-2 border-dashed border-pencil pl-2">
          {ANN_COLORS.map(swatch)}
        </span>

        <span className="flex items-center gap-1 border-l-2 border-dashed border-pencil pl-2">
          {ANN_WIDTHS.map((w) => (
            <button
              key={w}
              type="button"
              onClick={() => setWidth(w)}
              aria-label={`${w}px`}
              aria-pressed={width === w}
              className={cn(
                'flex h-6 w-6 items-center justify-center rounded-wobble-sm border-2',
                width === w ? 'border-ink bg-yellow shadow-offset' : 'border-transparent',
              )}
            >
              <span className="rounded-full bg-ink" style={{ width: w + 2, height: w + 2 }} />
            </button>
          ))}
        </span>

        <button
          type="button"
          onClick={() => setStrokes([])}
          disabled={strokes.length === 0}
          aria-label={say('Clear the page')}
          title={say('Clear the page')}
          className="flex h-8 w-8 items-center justify-center rounded-wobble-sm border-2 border-transparent text-ink-soft transition-colors hover:border-dashed hover:border-red hover:text-red disabled:opacity-30"
        >
          <Trash2 className="h-4 w-4" strokeWidth={2} />
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label={say('Put the pencil down')}
          title={say('Put the pencil down')}
          className="flex h-8 w-8 items-center justify-center rounded-wobble-sm border-2 border-transparent text-ink-soft transition-colors hover:border-dashed hover:border-ink hover:text-ink"
        >
          <X className="h-4 w-4" strokeWidth={2} />
        </button>
      </div>
      )}
    </>,
    document.body,
  );
}
