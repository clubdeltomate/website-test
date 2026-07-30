import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createRouter } from "../middleware.js";
import { adminProcedure } from "../procedures.js";
import { getDb } from "../queries/connection.js";
import { slideImages } from "../../db/schema.js";
import { generateImage } from "../ai/provider.js";
import { applyTokenDelta } from "../tokens.js";
import { getSettings } from "../settings.js";
import { IMAGE_URL_PREFIX } from "../deck-images.js";

/**
 * The backdrop of a social post: a tall 9:16 frame. The generator is told the
 * shape AND that a caption band may cover the bottom third, so it puts the
 * subject high enough to survive it — the same "compose for the real frame"
 * rule the banners follow, turned upright.
 */
const POST_DIRECTIVE =
  "A vertical 9:16 social media post image (portrait, much taller than wide). " +
  "Hyper-realistic photographic quality, natural light, professional advertising " +
  "polish — NOT an illustration, NOT cartoon, NOT digital art. Keep the subject in " +
  "the UPPER TWO THIRDS of the frame and leave the bottom third visually calm: a " +
  "caption band is laid over it. People shown must be adults; show a diverse, " +
  "multiracial mix. No text, no logos, no watermarks anywhere in the image.";

export const marketingRouter = createRouter({
  /** What one post backdrop costs — quoted on the Generate button. */
  quote: adminProcedure.query(async (): Promise<{ cost: number }> => {
    const { prices } = await getSettings();
    return { cost: Math.max(1, Math.ceil(prices.perImageSlide)) };
  }),

  /**
   * Draw a post backdrop from the admin's own prompt. Charged like every
   * other image here, and only once the picture actually exists.
   */
  generate: adminProcedure
    .input(z.object({ prompt: z.string().min(3).max(1000) }))
    .mutation(async ({ ctx, input }): Promise<{ url: string; cost: number }> => {
      const { prices } = await getSettings();
      const cost = Math.max(1, Math.ceil(prices.perImageSlide));
      if (ctx.user.tokenBalance < cost) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: `INSUFFICIENT_TOKENS: a post image costs ${cost} 🪙, you have ${ctx.user.tokenBalance} 🪙`,
        });
      }
      const url = await generateImage({
        userId: ctx.user.id,
        prompt: `${input.prompt}\n\n${POST_DIRECTIVE}`,
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
      await applyTokenDelta(ctx.user.id, -cost, `marketing post: ${input.prompt.slice(0, 55)}`);
      const [row] = await getDb()
        .insert(slideImages)
        .values({ ownerId: ctx.user.id, mime: m[1], data: m[2] })
        .returning({ id: slideImages.id });
      return { url: `${IMAGE_URL_PREFIX}${row.id}`, cost };
    }),
});
