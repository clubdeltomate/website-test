import { Eraser, Pencil, Trash2, Type, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { AnnTool } from './AnnotationLayer';

/** A small, curated ink palette (not too many colours). */
export const ANN_COLORS = ['#2E2820', '#EF8A3C', '#3F74D6', '#4C9A5C', '#D6455D', '#8566D4'];
/** Three nib thicknesses. */
export const ANN_WIDTHS = [2, 4, 7];

/**
 * Floating annotation toolbar for the slide player. Pen (colour + thickness),
 * eraser, text, clear-this-slide, and a close button. Compact so it doesn't
 * cover the slide.
 */
export default function AnnotationToolbar({
  tool,
  color,
  width,
  onTool,
  onColor,
  onWidth,
  onClear,
  onClose,
  hasMarks,
}: {
  tool: AnnTool;
  color: string;
  width: number;
  onTool: (t: AnnTool) => void;
  onColor: (c: string) => void;
  onWidth: (w: number) => void;
  onClear: () => void;
  /** omit to hide the close button (e.g. an always-on scratchpad toolbar) */
  onClose?: () => void;
  hasMarks: boolean;
}) {
  const toolBtn = (t: AnnTool, Icon: typeof Pencil, label: string) => (
    <button
      type="button"
      onClick={() => onTool(t)}
      aria-label={label}
      aria-pressed={tool === t}
      title={label}
      className={cn(
        'flex h-8 w-8 items-center justify-center rounded-wobble-sm border-2 transition-colors',
        tool === t
          ? 'border-ink bg-yellow text-ink shadow-offset'
          : 'border-transparent text-ink-soft hover:border-dashed hover:border-ink hover:text-ink',
      )}
    >
      <Icon className="h-4 w-4" strokeWidth={2} />
    </button>
  );

  return (
    <div className="pointer-events-auto flex flex-wrap items-center gap-2 rounded-wobble-sm border-2 border-ink bg-paper-3 px-2.5 py-1.5 shadow-offset">
      {toolBtn('pen', Pencil, 'Pencil')}
      {toolBtn('eraser', Eraser, 'Eraser')}
      {toolBtn('text', Type, 'Text note')}

      <span className="mx-0.5 h-6 w-px bg-pencil" />

      {/* colours */}
      <div className="flex items-center gap-1">
        {ANN_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => {
              onColor(c);
              if (tool === 'eraser') onTool('pen');
            }}
            aria-label={`Colour ${c}`}
            aria-pressed={color === c}
            className={cn(
              'h-5 w-5 rounded-full border-2 transition-transform hover:scale-110',
              color === c ? 'border-ink ring-2 ring-ink/30' : 'border-ink/40',
            )}
            style={{ backgroundColor: c }}
          />
        ))}
      </div>

      <span className="mx-0.5 h-6 w-px bg-pencil" />

      {/* nib thickness */}
      <div className="flex items-center gap-1">
        {ANN_WIDTHS.map((w) => (
          <button
            key={w}
            type="button"
            onClick={() => {
              onWidth(w);
              if (tool === 'eraser') onTool('pen');
            }}
            aria-label={`Thickness ${w}`}
            aria-pressed={width === w}
            className={cn(
              'flex h-8 w-8 items-center justify-center rounded-wobble-sm border-2 transition-colors',
              width === w
                ? 'border-ink bg-paper-2 shadow-offset'
                : 'border-transparent hover:border-dashed hover:border-ink',
            )}
          >
            <span className="rounded-full bg-ink" style={{ width: w + 2, height: w + 2 }} />
          </button>
        ))}
      </div>

      <span className="mx-0.5 h-6 w-px bg-pencil" />

      <button
        type="button"
        onClick={onClear}
        disabled={!hasMarks}
        aria-label="Clear this slide's marks"
        title="Clear this slide"
        className={cn(
          'flex h-8 w-8 items-center justify-center rounded-wobble-sm border-2 border-transparent transition-colors',
          hasMarks ? 'text-ink-soft hover:border-dashed hover:border-red hover:text-red' : 'cursor-not-allowed text-pencil',
        )}
      >
        <Trash2 className="h-4 w-4" strokeWidth={2} />
      </button>
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          aria-label="Close annotation tools"
          title="Done"
          className="flex h-8 w-8 items-center justify-center rounded-wobble-sm border-2 border-transparent text-ink-soft transition-colors hover:border-dashed hover:border-ink hover:text-ink"
        >
          <X className="h-4 w-4" strokeWidth={2} />
        </button>
      )}
    </div>
  );
}
