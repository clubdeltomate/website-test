import { describe, expect, it } from "vitest";
import { findBars } from "./trim-bars";

/* The failure this guards against is subtle to look at and easy to write:
 * a bar left on a backdrop makes the photograph stop just above the caption
 * band, which reads as a layout bug rather than a picture that arrived
 * padded. The other direction matters more, though — cropping a photograph
 * that never had a bar would quietly eat someone's composition, so most of
 * these say "leave it alone". */

const W = 40;
const H = 100;

/** A picture-shaped buffer: every pixel different from its neighbours. */
function photo(w = W, h = H): Uint8ClampedArray {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    d[i * 4] = (i * 7) % 256;
    d[i * 4 + 1] = (i * 13) % 256;
    d[i * 4 + 2] = (i * 29) % 256;
    d[i * 4 + 3] = 255;
  }
  return d;
}

/** Paint rows [from, to) one flat colour, the way padding arrives. */
function bar(d: Uint8ClampedArray, w: number, from: number, to: number, v = 236) {
  for (let y = from; y < to; y++) {
    for (let x = 0; x < w; x++) {
      const p = (y * w + x) * 4;
      d[p] = v;
      d[p + 1] = v;
      d[p + 2] = v;
      d[p + 3] = 255;
    }
  }
}

describe("findBars", () => {
  it("finds a flat bar along the bottom", () => {
    const d = photo();
    bar(d, W, 90, H);
    expect(findBars(d, W, H)).toEqual({ top: 0, bottom: 10, left: 0, right: 0 });
  });

  it("finds bars at the top and the bottom together", () => {
    const d = photo();
    bar(d, W, 0, 8);
    bar(d, W, 88, H, 18);
    expect(findBars(d, W, H)).toEqual({ top: 8, bottom: 12, left: 0, right: 0 });
  });

  it("leaves an ordinary photograph completely alone", () => {
    expect(findBars(photo(), W, H)).toEqual({ top: 0, bottom: 0, left: 0, right: 0 });
  });

  it("ignores a bar too thin to be worth re-saving the picture for", () => {
    const tall = 300;
    const d = photo(W, tall);
    bar(d, W, tall - 2, tall); // two rows of three hundred — under a per cent
    expect(findBars(d, W, tall).bottom).toBe(0);
  });

  it("refuses to crop a flat area big enough to be the picture itself", () => {
    const d = photo();
    bar(d, W, 40, H); // sixty per cent — a sky, a studio wall, a background
    expect(findBars(d, W, H).bottom).toBe(0);
  });

  it("treats a picture that is flat all through as nothing to cut", () => {
    const d = new Uint8ClampedArray(W * H * 4).fill(255);
    expect(findBars(d, W, H)).toEqual({ top: 0, bottom: 0, left: 0, right: 0 });
  });

  it("tolerates the slight unevenness a JPEG leaves in a flat bar", () => {
    const d = photo();
    bar(d, W, 90, H);
    // nudge a few pixels the way compression does
    for (const i of [3610, 3700, 3990]) d[i * 4] = 238;
    expect(findBars(d, W, H).bottom).toBe(10);
  });

  it("finds bars down the sides as well", () => {
    const d = photo(H, W); // 100 wide, 40 tall
    for (let y = 0; y < W; y++) {
      for (let x = 0; x < 9; x++) {
        const p = (y * H + x) * 4;
        d[p] = 12;
        d[p + 1] = 12;
        d[p + 2] = 12;
      }
    }
    expect(findBars(d, H, W).left).toBe(9);
  });
});
