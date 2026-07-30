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
 * a glance: a REPO banner is university-catalog photography whose scene
 * deepens with the course's level; a SLIDE TOOL banner is a hyper-real
 * photograph of its category's fixed scene.
 */
export const REPO_BANNER_DIRECTIVE =
  `${STRIP_SHAPE} Style, strictly: the photography of a university course catalog — real ` +
  "people genuinely engaged with the subject, warm natural light, sharp professional " +
  "campus-prospectus quality. A realistic photograph — NOT an illustration, NOT a sketch, " +
  "NOT digital art. No text, no watermarks.";

/**
 * How deep the repo banner's scene goes, by the course's level. A0 shows
 * beginners taking their first steps; each step up shows the subject worked
 * further out in the field, until C2 is fully professional — the same way a
 * restaurant course's meal grows from a small order to a laden table.
 */
export const LEVEL_BANNER_STAGES: Record<string, string> = {
  A0: "absolute beginners at their very first lesson — a welcoming classroom, first steps, everything still new",
  A1: "beginners finding their feet — simple guided practice in the classroom, small early wins",
  A2: "early learners trying the subject out in simple real-life situations for the first time",
  B1: "confident students taking the subject into the world — everyday real settings, growing independence",
  B2: "immersed students handling rich, substantial material — fuller, busier, more generous scenes",
  C1: "advanced students working shoulder to shoulder with professionals — depth, detail, specialist settings",
  C2: "the field practiced at full professional mastery — expert hands, serious settings, the complete picture",
};

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
