import { describe, it, expect } from "vitest";
import { externalizeDeckImages, loadSlideImage, IMAGE_URL_PREFIX } from "./deck-images.js";
import { stripInlineImages } from "../contracts/types.js";
import type { SlideDeck } from "../contracts/types.js";

const HAS_DB = !!process.env.DATABASE_URL;

/** A 1x1 PNG, so the bytes that come back can be compared exactly. */
const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==";

function deckWith(imageUrls: (string | undefined)[]): SlideDeck {
  return {
    level: "A1",
    imageStyle: "sketch",
    topic: "t",
    slides: imageUrls.map((url, i) => ({
      title: `Slide ${i + 1}`,
      components: [
        { type: "prose", text: "words" },
        ...(url ? [{ type: "image", prompt: "p", imageUrl: url }] : []),
      ],
    })),
  } as unknown as SlideDeck;
}

describe.runIf(HAS_DB)("externalizeDeckImages", () => {
  it("replaces inline base64 with a URL and shrinks the deck enormously", async () => {
    // What a real generation hands back: an image model returns a data URI, and
    // ten of them is the 10-20 MB that has to travel on every single play.
    const big = `data:image/png;base64,${"A".repeat(1_200_000)}`;
    const before = deckWith(Array.from({ length: 10 }, () => big));
    const beforeBytes = JSON.stringify(before).length;
    expect(beforeBytes).toBeGreaterThan(10_000_000);

    const { deck, moved } = await externalizeDeckImages(before, null);
    expect(moved).toBe(10);
    const afterBytes = JSON.stringify(deck).length;
    // The whole point: what Play has to download is now kilobytes.
    expect(afterBytes).toBeLessThan(10_000);
    for (const slide of deck.slides) {
      for (const c of slide.components) {
        const url = (c as { imageUrl?: string }).imageUrl;
        if (url) expect(url.startsWith(IMAGE_URL_PREFIX)).toBe(true);
      }
    }
  });

  it("stores the real bytes, so the image still serves", async () => {
    const { deck } = await externalizeDeckImages(
      deckWith([`data:image/png;base64,${PNG_B64}`]),
      null,
    );
    const url = (deck.slides[0].components.find((c) => c.type === "image") as { imageUrl: string })
      .imageUrl;
    const id = Number(url.slice(IMAGE_URL_PREFIX.length));
    const img = await loadSlideImage(id);
    expect(img).toBeTruthy();
    expect(img!.mime).toBe("image/png");
    expect(Buffer.from(img!.bytes).toString("base64")).toBe(PNG_B64);
  });

  it("leaves an already-externalised deck alone, so a backfill is idempotent", async () => {
    const already = deckWith([`${IMAGE_URL_PREFIX}42`, undefined]);
    const { deck, moved } = await externalizeDeckImages(already, null);
    expect(moved).toBe(0);
    expect(JSON.stringify(deck)).toBe(JSON.stringify(already));
  });

  it("returns null for an id that isn't there rather than throwing", async () => {
    expect(await loadSlideImage(2_000_000_000)).toBeNull();
  });
});

describe("stripInlineImages", () => {
  it("drops data URIs and keeps everything else, so a play can be posted", () => {
    const deck = deckWith([`data:image/png;base64,${PNG_B64}`, `${IMAGE_URL_PREFIX}7`]);
    const lean = stripInlineImages(deck);
    const urls = lean.slides.flatMap((s) =>
      s.components.map((c) => (c as { imageUrl?: string }).imageUrl),
    );
    // the data URI is gone, the real URL survives
    expect(urls).toContain(undefined);
    expect(urls).toContain(`${IMAGE_URL_PREFIX}7`);
    // prose and titles are untouched
    expect(lean.slides[0].title).toBe("Slide 1");
    expect(lean.slides[0].components[0]).toEqual({ type: "prose", text: "words" });
  });

  it("turns an unpostable snapshot into a small one", () => {
    // What made a finished play fail: the upload was over the request-body limit
    // and came back as plain text the client tried to read as JSON.
    const big = `data:image/png;base64,${"A".repeat(1_400_000)}`;
    const deck = deckWith(Array.from({ length: 4 }, () => big));
    expect(JSON.stringify(deck).length).toBeGreaterThan(5_000_000);
    expect(JSON.stringify(stripInlineImages(deck)).length).toBeLessThan(5_000);
  });

  it("leaves a deck with no images alone", () => {
    const deck = deckWith([undefined, undefined]);
    expect(JSON.stringify(stripInlineImages(deck))).toBe(JSON.stringify(deck));
  });
});
