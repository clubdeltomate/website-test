/* ------------------------------------------------------------------ */
/* Cutting the padding off a generated picture.                         */
/* ------------------------------------------------------------------ */

/**
 * Some image generators answer a 9:16 request with a picture that is 9:16 in
 * file size but not in composition: the scene is drawn smaller and the rest
 * of the canvas is filled with a flat bar, usually along the bottom. Cover-
 * fitting that into a slide keeps the bar, and the bar lands exactly where
 * the caption band starts — so the photograph appears to stop short of the
 * band instead of running underneath it, whatever height the band is.
 *
 * There is nothing to be done about it in the prompt, so it is cut off here:
 * a bar is a run of rows (or columns) at an edge that are flat and all the
 * same colour. Photographs do not have those — even a plain white wall has a
 * gradient across it — so the test is safe to run on every picture, and on
 * one that has no bar it finds nothing and changes nothing.
 */

/** How far two channel values may differ and still count as the same colour. */
const TOLERANCE = 5;

/** Below this, a bar is not worth an extra round trip. */
const MIN_FRACTION = 0.01;

/** Above this we are looking at the picture, not at padding — leave it be. */
const MAX_FRACTION = 0.25;

export interface Bars {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

const NO_BARS: Bars = { top: 0, bottom: 0, left: 0, right: 0 };

/** Is every pixel in this line within TOLERANCE of the reference colour? */
function flatLine(
  data: ArrayLike<number>,
  start: number,
  step: number,
  count: number,
  ref: [number, number, number],
): boolean {
  for (let i = 0; i < count; i++) {
    const p = (start + i * step) * 4;
    if (
      Math.abs(data[p] - ref[0]) > TOLERANCE ||
      Math.abs(data[p + 1] - ref[1]) > TOLERANCE ||
      Math.abs(data[p + 2] - ref[2]) > TOLERANCE
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Measure the flat bars around the edges of RGBA pixel data — the arithmetic
 * half, kept separate from the canvas so it can be tested on a buffer.
 *
 * Bars smaller than MIN_FRACTION are reported as none (not worth re-saving);
 * bars larger than MAX_FRACTION are too, because at that size the flat area
 * is far more likely to be the picture than padding around it.
 */
export function findBars(data: ArrayLike<number>, w: number, h: number): Bars {
  if (w < 2 || h < 2 || data.length < w * h * 4) return NO_BARS;
  const at = (x: number, y: number): [number, number, number] => {
    const p = (y * w + x) * 4;
    return [data[p], data[p + 1], data[p + 2]];
  };

  let top = 0;
  while (top < h && flatLine(data, top * w, 1, w, at(0, top))) top++;
  // A picture flat all the way down is a blank, not a bar around something.
  if (top >= h) return NO_BARS;

  let bottom = 0;
  while (bottom < h - top && flatLine(data, (h - 1 - bottom) * w, 1, w, at(0, h - 1 - bottom)))
    bottom++;
  let left = 0;
  while (left < w && flatLine(data, left, w, h, at(left, 0))) left++;
  if (left >= w) return NO_BARS;
  let right = 0;
  while (right < w - left && flatLine(data, w - 1 - right, w, h, at(w - 1 - right, 0))) right++;

  const keep = (edge: number, span: number) => {
    const f = edge / span;
    return f >= MIN_FRACTION && f <= MAX_FRACTION ? edge : 0;
  };
  return {
    top: keep(top, h),
    bottom: keep(bottom, h),
    left: keep(left, w),
    right: keep(right, w),
  };
}

export interface Trimmed {
  /** the picture with any flat edge bars removed */
  canvas: HTMLCanvasElement;
  /** false when it was already clean, so nothing needs re-saving */
  trimmed: boolean;
}

/**
 * Load a picture and cut any flat bars off its edges.
 *
 * Same-origin only, which every stored picture is — a tainted canvas cannot
 * be read back, so a cross-origin URL returns null rather than misleading.
 */
export async function trimBars(url: string): Promise<Trimmed | null> {
  const img = new Image();
  img.src = url;
  try {
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('load failed'));
    });
  } catch {
    return null;
  }
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  if (!w || !h) return null;

  const src = document.createElement('canvas');
  src.width = w;
  src.height = h;
  const sctx = src.getContext('2d', { willReadFrequently: true });
  if (!sctx) return null;
  sctx.drawImage(img, 0, 0);

  let bars: Bars;
  try {
    bars = findBars(sctx.getImageData(0, 0, w, h).data, w, h);
  } catch {
    return null; // tainted canvas — not ours to read
  }

  if (bars.top + bars.bottom + bars.left + bars.right === 0) {
    return { canvas: src, trimmed: false };
  }

  const cw = w - bars.left - bars.right;
  const ch = h - bars.top - bars.bottom;
  const out = document.createElement('canvas');
  out.width = cw;
  out.height = ch;
  const octx = out.getContext('2d');
  if (!octx) return null;
  octx.drawImage(src, bars.left, bars.top, cw, ch, 0, 0, cw, ch);
  return { canvas: out, trimmed: true };
}
