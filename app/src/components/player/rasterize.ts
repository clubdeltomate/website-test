import type { SlideAnnotation } from '@contracts/types';

/**
 * Draw a scratchpad page's freehand marks onto a canvas and return a PNG data
 * URI, so the handwritten work can be sent to a vision model for grading.
 * Coordinates are in the same pixel space the strokes were captured in, so
 * pass the live box width/height.
 */
export function rasterizeAnnotations(
  annotations: SlideAnnotation[],
  width: number,
  height: number,
  bg = '#F3ECDD',
): string {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  for (const a of annotations) {
    if (a.kind === 'stroke') {
      if (a.points.length < 2) continue;
      ctx.strokeStyle = a.color;
      ctx.lineWidth = a.width;
      ctx.beginPath();
      for (let i = 0; i < a.points.length; i += 2) {
        const x = a.points[i];
        const y = a.points[i + 1];
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    } else if (a.kind === 'text') {
      ctx.fillStyle = a.color;
      ctx.font = `${a.size}px sans-serif`;
      ctx.textBaseline = 'top';
      a.text.split('\n').forEach((line, li) => {
        ctx.fillText(line, a.x, a.y + li * a.size * 1.2);
      });
    }
  }
  return canvas.toDataURL('image/png');
}

/** True when a page has any drawn content worth grading. */
export function pageHasMarks(page: SlideAnnotation[]): boolean {
  return page.some((a) => (a.kind === 'stroke' ? a.points.length >= 2 : a.text.trim().length > 0));
}
