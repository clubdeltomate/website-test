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
const STRIP_SHAPE =
  "This image is a small decorative header strip on a card, displayed ultra-wide and very " +
  "short (about 8:1) — it will be cropped top and bottom. Spread the elements evenly along " +
  "the strip and keep everything in the vertical middle band; nothing important near the " +
  "top or bottom edges, no large single centered subject.";

/**
 * Two looks, deliberately different so the two kinds of cards read apart at
 * a glance: a REPO is a notebook, so its banner is pencil on notebook paper;
 * a SLIDE TOOL is a finished presentation, so its banner is a little
 * watercolor painting.
 */
export const REPO_BANNER_DIRECTIVE =
  `${STRIP_SHAPE} Style, strictly: a student's hand-drawn sketch on a blank sheet of white ` +
  "notebook paper. Loose pencil-and-ink doodles of things from the subject, with a few short " +
  "handwritten words or labels from the lesson scattered between them, like margin notes. " +
  "Sketch lines and paper texture only — NOT a photograph, NOT digital flat design, NOT " +
  "glossy illustration. No faces, no full figures.";

export const TOOL_BANNER_DIRECTIVE =
  `${STRIP_SHAPE} Style, strictly: a HYPER-REALISTIC photograph — as real as it gets. ` +
  "Natural light, true-to-life color, sharp professional-photography detail, shallow depth " +
  "of field where it helps. NOT an illustration, NOT watercolor, NOT cartoon, NOT digital " +
  "art, NOT a painting of any kind. No text, no watermarks.";

/**
 * What each slide-tool banner photographs, by card category. The scene is
 * fixed per category — a course banner is always the aquarium, a restaurant
 * banner always food — so the card kinds read consistently across the shelf.
 */
export const TOOL_BANNER_SCENES: Record<string, string> = {
  course:
    "an aquarium filled with deep blue ocean water: schools of fish swimming past, now and " +
    "then one big fish gliding through, coral, bubbles and soft light rays from above",
  restaurant:
    "beautiful real food: freshly plated dishes, vivid ingredients, a little steam rising, " +
    "restaurant-kitchen energy",
  service:
    "real tradespeople at work — a plumber under a sink, a roofer on shingles, a mower on a " +
    "lawn, a mechanic over an engine — honest tools and working hands",
  shop:
    "people out shopping: storefronts, shopping bags in hand, hands browsing shelves and " +
    "market stalls",
  walkthrough:
    "a bright modern office: people at desks and whiteboards walking a team through screens " +
    "and slides, explainer-video energy",
  news:
    "the news in motion: a broadcast desk, printing presses, fresh newspapers, glowing " +
    "headline tickers",
};

/**
 * Generate one card banner, charged like any other image and only after the
 * picture exists. Returns the stored image row id — the caller writes it
 * onto its own table (repos / slideTools) together with the prompt used.
 */
export async function makeCardBanner(
  user: User,
  subject: string,
  directive: string,
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
    prompt: `${subject}\n\n${directive}`,
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
