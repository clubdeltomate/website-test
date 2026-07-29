import { eq } from "drizzle-orm";
import { getDb } from "./queries/connection.js";
import { slideImages } from "../db/schema.js";
import type { SlideDeck } from "../contracts/types.js";

/** Where an externalised image is served from. */
export const IMAGE_URL_PREFIX = "/api/img/";

const DATA_URI = /^data:([^;,]+);base64,(.+)$/s;

/**
 * Move every inline base64 image in a deck into its own row, replacing the data
 * URI with a URL.
 *
 * Image models return a base64 data URI, and those used to be written straight
 * into the deck JSON. An illustrated ten-slide deck is then 10-20 MB living in
 * one column — and that column has to come back WHOLE every time anyone presses
 * Play, past the 4.5 MB response limit of the serverless host this runs on.
 * Externalised, the deck is kilobytes and each image becomes its own request the
 * browser can cache.
 *
 * Best-effort per image: if a row cannot be written the data URI is left alone,
 * because a deck that plays heavily beats a deck missing its pictures.
 */
export async function externalizeDeckImages(
  deck: SlideDeck,
  ownerId: number | null,
): Promise<{ deck: SlideDeck; moved: number }> {
  const db = getDb();
  let moved = 0;

  const rewriteUrl = async (url: unknown): Promise<string | undefined> => {
    if (typeof url !== "string") return undefined;
    const m = DATA_URI.exec(url);
    if (!m) return undefined;
    const [, mime, b64] = m;
    try {
      const [row] = await db
        .insert(slideImages)
        .values({ ownerId, mime, data: b64 })
        .returning({ id: slideImages.id });
      moved++;
      return `${IMAGE_URL_PREFIX}${row.id}`;
    } catch {
      return undefined;
    }
  };

  const slides = await Promise.all(
    deck.slides.map(async (slide) => {
      const components = await Promise.all(
        slide.components.map(async (c) => {
          const next = await rewriteUrl((c as { imageUrl?: unknown }).imageUrl);
          return next ? { ...c, imageUrl: next } : c;
        }),
      );
      return { ...slide, components };
    }),
  );

  return { deck: { ...deck, slides }, moved };
}

/** Fetch a stored image for the serving route. */
export async function loadSlideImage(
  id: number,
): Promise<{ mime: string; bytes: ArrayBuffer } | null> {
  const row = await getDb().query.slideImages.findFirst({ where: eq(slideImages.id, id) });
  if (!row) return null;
  const buf = Buffer.from(row.data, "base64");
  // Copy into a standalone ArrayBuffer: a Buffer can be a view into a shared
  // pool, so handing its buffer straight out could expose neighbouring bytes.
  const out = new ArrayBuffer(buf.byteLength);
  new Uint8Array(out).set(buf);
  return { mime: row.mime, bytes: out };
}
