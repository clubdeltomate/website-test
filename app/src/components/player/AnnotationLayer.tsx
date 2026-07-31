import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { SlideAnnotation, AnnStroke, AnnText } from '@contracts/types';
import { say } from '@/lib/i18n';

export type AnnTool = 'pen' | 'eraser' | 'text';

/** Turn a flat point list into an SVG path (rounded polyline). */
function toPath(points: number[]): string {
  if (points.length < 2) return '';
  let d = `M ${points[0]} ${points[1]}`;
  for (let i = 2; i < points.length; i += 2) d += ` L ${points[i]} ${points[i + 1]}`;
  return d;
}

/**
 * A drawing overlay anchored to the slide content it sits on top of, so
 * strokes and text notes scroll with the slide and stay where they were put.
 *
 * Editable mode (player): captures pointer input for pen/eraser/text and
 * reports changes via onChange. Read-only mode (replay): renders the saved
 * annotations, scaled proportionally from the width they were captured at.
 */
export default function AnnotationLayer({
  annotations,
  editable,
  active = false,
  tool = 'pen',
  color = '#2E2820',
  width = 3,
  captureWidth = null,
  onChange,
  onReportWidth,
}: {
  annotations: SlideAnnotation[];
  editable: boolean;
  /** when true (editable only) the overlay captures pointer input */
  active?: boolean;
  tool?: AnnTool;
  color?: string;
  width?: number;
  /** read-only: the width the annotations were drawn at, for scaling */
  captureWidth?: number | null;
  onChange?: (next: SlideAnnotation[]) => void;
  /** editable: report the overlay's live pixel width (capture width) */
  onReportWidth?: (w: number) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [liveW, setLiveW] = useState(0);
  const [draft, setDraft] = useState<number[] | null>(null);
  const drawing = useRef(false);
  // id of the text note being edited (index into annotations)
  const [editingText, setEditingText] = useState<number | null>(null);

  // Measure the overlay so read-only mode can scale, and editable mode can
  // report its capture width.
  useLayoutEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const measure = () => {
      const w = el.getBoundingClientRect().width;
      setLiveW(w);
      if (editable) onReportWidth?.(w);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [editable, onReportWidth]);

  // read-only scale factor (draw space → current space)
  const scale = !editable && captureWidth && captureWidth > 0 && liveW > 0 ? liveW / captureWidth : 1;

  const localPoint = (e: React.PointerEvent): [number, number] => {
    const r = hostRef.current!.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };

  const commit = (next: SlideAnnotation[]) => onChange?.(next);

  const eraseAt = (x: number, y: number) => {
    const R = Math.max(12, width * 3);
    const next = annotations.filter((a) => {
      if (a.kind === 'text') {
        // erase a text note if the cursor is near its anchor
        return !(Math.abs(a.x - x) < 40 && Math.abs(a.y - y) < 24);
      }
      for (let i = 0; i < a.points.length; i += 2) {
        if (Math.hypot(a.points[i] - x, a.points[i + 1] - y) < R) return false;
      }
      return true;
    });
    if (next.length !== annotations.length) commit(next);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (!editable || !active) return;
    // Keep the event from reaching an ancestor drag handler (the slide's
    // swipe-to-navigate) — otherwise dragging to draw slides the whole page.
    e.stopPropagation();
    if (editingText !== null) return; // let the textarea handle it
    const [x, y] = localPoint(e);
    if (tool === 'text') {
      const note: AnnText = { kind: 'text', color, size: 18, x, y, text: '' };
      const next = [...annotations, note];
      commit(next);
      setEditingText(next.length - 1);
      return;
    }
    (e.target as Element).setPointerCapture?.(e.pointerId);
    drawing.current = true;
    if (tool === 'eraser') {
      eraseAt(x, y);
    } else {
      setDraft([x, y]);
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!editable || !active || !drawing.current) return;
    e.stopPropagation();
    const [x, y] = localPoint(e);
    if (tool === 'eraser') {
      eraseAt(x, y);
    } else {
      setDraft((d) => (d ? [...d, x, y] : [x, y]));
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (!editable || !active) return;
    e.stopPropagation();
    drawing.current = false;
    if (tool === 'pen' && draft && draft.length >= 4) {
      const stroke: AnnStroke = { kind: 'stroke', color, width, points: draft };
      commit([...annotations, stroke]);
    }
    setDraft(null);
  };

  // commit / cleanup an empty text note when editing ends
  const finishText = (idx: number, value: string) => {
    const trimmed = value.replace(/\s+$/,'');
    const next = annotations
      .map((a, i) => (i === idx && a.kind === 'text' ? { ...a, text: trimmed } : a))
      .filter((a) => !(a.kind === 'text' && a.text.trim() === ''));
    commit(next);
    setEditingText(null);
  };

  useEffect(() => {
    // exiting edit/active mode drops any half-drawn stroke
    if (!active) {
      drawing.current = false;
      setDraft(null);
    }
  }, [active]);

  const strokes = annotations.filter((a): a is AnnStroke => a.kind === 'stroke');
  const texts = annotations
    .map((a, i) => ({ a, i }))
    .filter((e): e is { a: AnnText; i: number } => e.a.kind === 'text');

  return (
    <div
      ref={hostRef}
      className={cn(
        'absolute inset-0 z-20',
        editable && active ? 'cursor-crosshair touch-none' : 'pointer-events-none',
      )}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerUp}
      style={{ transformOrigin: 'top left' }}
    >
      <svg
        className="absolute inset-0 h-full w-full overflow-visible"
        style={editable ? undefined : { transform: `scale(${scale})`, transformOrigin: 'top left' }}
      >
        {strokes.map((s, i) => (
          <path
            key={i}
            d={toPath(s.points)}
            fill="none"
            stroke={s.color}
            strokeWidth={s.width}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
        {draft && draft.length >= 2 && (
          <path
            d={toPath(draft)}
            fill="none"
            stroke={color}
            strokeWidth={width}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}
      </svg>

      {/* text notes */}
      {texts.map(({ a, i }) => {
        const editingThis = editable && editingText === i;
        const posStyle = editable
          ? { left: a.x, top: a.y }
          : { left: a.x * scale, top: a.y * scale };
        return (
          <div
            key={i}
            className={cn('absolute', editable && active ? 'pointer-events-auto' : 'pointer-events-none')}
            style={posStyle}
          >
            {editingThis ? (
              <div className="relative">
                <textarea
                  autoFocus
                  defaultValue={a.text}
                  onBlur={(e) => finishText(i, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') (e.target as HTMLTextAreaElement).blur();
                  }}
                  rows={2}
                  className="min-w-[160px] resize rounded-wobble-sm border-2 border-dashed border-ink bg-paper/95 px-2 py-1 font-heading text-sm shadow-offset outline-none"
                  style={{ color: a.color, fontSize: a.size }}
                  placeholder={say("Type a note…")}
                />
              </div>
            ) : (
              <div className="group relative">
                <p
                  className="whitespace-pre-wrap font-heading font-semibold leading-snug"
                  style={{ color: a.color, fontSize: editable ? a.size : a.size * scale }}
                  onDoubleClick={editable && active ? () => setEditingText(i) : undefined}
                >
                  {a.text}
                </p>
                {editable && active && (
                  <button
                    type="button"
                    onClick={() => commit(annotations.filter((_, j) => j !== i))}
                    aria-label={say("Delete note")}
                    className="absolute -right-5 -top-2 rounded-full border border-ink bg-paper p-0.5 text-ink-soft opacity-0 transition-opacity group-hover:opacity-100 hover:text-red"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
