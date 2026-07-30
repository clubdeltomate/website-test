import { TRPCError } from "@trpc/server";
import { getDb } from "./queries/connection.js";
import { slideImages, type User } from "../db/schema.js";
import { generateImage } from "./ai/provider.js";
import { applyTokenDelta } from "./tokens.js";
import { getSettings } from "./settings.js";

/**
 * The strip a card banner is displayed in: as wide as the card, about as
 * tall as a toolbar button — roughly 8:1, cropped vertically. The generator
 * is told this truthfully for the same reason the unit banners are: an AI
 * that thinks it is painting a poster puts the subject where the crop will
 * eat it.
 */
export const CARD_BANNER_DIRECTIVE =
  "This image is a small decorative header strip on a card, displayed ultra-wide and very " +
  "short (about 8:1) — it will be cropped top and bottom. Compose an abstract, pattern-like " +
  "arrangement of small objects, symbols or motifs drawn from the subject, spread evenly " +
  "across a pleasant softly-colored background. Keep everything in the vertical middle band; " +
  "no faces, no full figures, no large single subject, no text.";

/**
 * Generate one card banner, charged like any other image and only after the
 * picture exists. Returns the stored image row id — the caller writes it
 * onto its own table (repos / slideTools) together with the prompt used.
 */
export async function makeCardBanner(
  user: User,
  subject: string,
): Promise<{ imageId: number; cost: number }> {
  const { prices } = await getSettings();
  const cost = Math.max(1, Math.ceil(prices.perImageSlide));
  if (user.tokenBalance < cost) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `INSUFFICIENT_TOKENS: a banner costs ${cost} 🪙, you have ${user.tokenBalance} 🪙`,
    });
  }
  const url = await generateImage({
    userId: user.id,
    prompt: `${subject}\n\n${CARD_BANNER_DIRECTIVE}`,
  });
  if (!url) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "AI_UNAVAILABLE: no image generator answered — nothing was charged",
    });
  }
  const m = /^data:([^;,]+);base64,(.+)$/s.exec(url);
  if (!m) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "The generator returned an image in a form we can't store",
    });
  }
  await applyTokenDelta(user.id, -cost, `card banner: ${subject.slice(0, 55)}`);
  const [row] = await getDb()
    .insert(slideImages)
    .values({ ownerId: user.id, mime: m[1], data: m[2] })
    .returning({ id: slideImages.id });
  return { imageId: row.id, cost };
}
