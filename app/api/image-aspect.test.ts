import { describe, expect, it } from "vitest";
import {
  DALLE_SIZES,
  LEONARDO_SIZES,
  OPENAI_SIZES,
  type AspectRatio,
} from "./ai/provider.js";

/* The bug these guard against is quiet: transpose a width and a height and
 * every 9:16 slide gets a landscape picture again, which looks like a
 * generation problem rather than a table problem. */

const RATIOS: AspectRatio[] = ["1:1", "4:5", "9:16", "16:9"];
const wanted = (a: AspectRatio) => {
  const [w, h] = a.split(":").map(Number);
  return w / h;
};
const parse = (s: string) => {
  const [w, h] = s.split("x").map(Number);
  return { w, h, ratio: w / h };
};

describe("provider image sizes", () => {
  it("covers every ratio the marketing tool can ask for", () => {
    for (const a of RATIOS) {
      expect(OPENAI_SIZES[a], a).toBeTruthy();
      expect(DALLE_SIZES[a], a).toBeTruthy();
      expect(LEONARDO_SIZES[a], a).toBeTruthy();
    }
  });

  it("keeps portrait portrait and landscape landscape", () => {
    for (const a of RATIOS) {
      const want = wanted(a);
      const openai = parse(OPENAI_SIZES[a]);
      const dalle = parse(DALLE_SIZES[a]);
      const leo = LEONARDO_SIZES[a].width / LEONARDO_SIZES[a].height;
      // Not exact — the providers only offer a few shapes — but never flipped.
      expect(Math.sign(openai.ratio - 1), `openai ${a}`).toBe(Math.sign(want - 1));
      expect(Math.sign(dalle.ratio - 1), `dalle ${a}`).toBe(Math.sign(want - 1));
      expect(Math.sign(leo - 1), `leonardo ${a}`).toBe(Math.sign(want - 1));
    }
  });

  it("gives Leonardo the ratio it was asked for, at sizes it accepts", () => {
    for (const a of RATIOS) {
      const { width, height } = LEONARDO_SIZES[a];
      expect(width % 8, `${a} width`).toBe(0);
      expect(height % 8, `${a} height`).toBe(0);
      // Leonardo takes pixels, so it can hit the ratio properly — within 3%.
      expect(Math.abs(width / height - wanted(a)) / wanted(a), a).toBeLessThan(0.03);
    }
  });

  it("never asks a provider for a square when the slide is tall", () => {
    for (const a of ["4:5", "9:16"] as AspectRatio[]) {
      expect(parse(OPENAI_SIZES[a]).ratio, a).toBeLessThan(1);
      expect(parse(DALLE_SIZES[a]).ratio, a).toBeLessThan(1);
      expect(LEONARDO_SIZES[a].width, a).toBeLessThan(LEONARDO_SIZES[a].height);
    }
  });
});
