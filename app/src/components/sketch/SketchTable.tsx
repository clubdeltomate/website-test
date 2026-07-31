import { useState } from 'react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { say } from '@/lib/i18n';

export interface SketchColumn<T> {
  key: string;
  header: ReactNode;
  /** Render a cell from the row */
  render: (row: T, rowIndex: number) => ReactNode;
  /** Optional accessor used for sorting; omit to make the column unsortable */
  sortValue?: (row: T) => string | number;
  mono?: boolean;
  className?: string;
}

export interface SketchTableProps<T> {
  columns: SketchColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  emptyState?: ReactNode;
  className?: string;
}

/** The yellow-header table — brand signature (design.md §7.5) */
export default function SketchTable<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  emptyState,
  className,
}: SketchTableProps<T>) {
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);

  const sorted = (() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col?.sortValue) return rows;
    const get = col.sortValue;
    return [...rows].sort((a, b) => {
      const va = get(a);
      const vb = get(b);
      if (va === vb) return 0;
      return (va > vb ? 1 : -1) * sort.dir;
    });
  })();

  const toggleSort = (key: string) => {
    setSort((s) =>
      s?.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: 1 },
    );
  };

  return (
    <div
      className={cn(
        'overflow-x-auto rounded-wobble-sm border-2 border-ink bg-paper-3 shadow-offset',
        className,
      )}
    >
      <table className="w-full border-collapse text-left text-sm">
        <thead>
          <tr className="bg-yellow">
            {columns.map((col) => (
              <th
                key={col.key}
                className={cn(
                  'micro border-2 border-ink px-3 py-2.5 text-ink first:border-l-0 last:border-r-0',
                  col.sortValue && 'cursor-pointer select-none hover:bg-[#ffd05c]',
                  col.className,
                )}
                onClick={col.sortValue ? () => toggleSort(col.key) : undefined}
                aria-sort={
                  sort?.key === col.key
                    ? sort.dir === 1
                      ? 'ascending'
                      : 'descending'
                    : undefined
                }
              >
                <span className="inline-flex items-center gap-1">
                  {col.header}
                  {col.sortValue && (
                    <svg
                      viewBox="0 0 10 12"
                      className={cn(
                        'h-3 w-3 transition-transform duration-200',
                        sort?.key === col.key && sort.dir === -1 && 'rotate-180',
                        sort?.key !== col.key && 'opacity-35',
                      )}
                      fill="none"
                      aria-hidden="true"
                    >
                      {/* hand-drawn caret */}
                      <path
                        d="M1.5 8.5C3.5 6 5 4 5.2 2.2c.4 1.6 1.6 4 3.3 6.3"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                      />
                    </svg>
                  )}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.length === 0 && (
            <tr>
              <td colSpan={columns.length} className="px-3 py-10 text-center">
                {emptyState ?? (
                  <span className="font-display text-2xl text-ink-faint">
                    
                    {say("Nothing here yet — let's sketch something!")}
                  </span>
                )}
              </td>
            </tr>
          )}
          {sorted.map((row, i) => (
            <tr
              key={rowKey(row)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={cn(
                'border-t-2 border-dashed border-pencil transition-colors duration-150',
                'hover:bg-paper-2',
                onRowClick && 'cursor-pointer',
              )}
            >
              {columns.map((col) => (
                <td
                  key={col.key}
                  className={cn(
                    'px-3 py-2.5 align-middle',
                    col.mono && 'font-mono text-[0.875rem]',
                    col.className,
                  )}
                >
                  {col.render(row, i)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
