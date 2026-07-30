import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createRouter } from "../middleware.js";
import { adminProcedure } from "../procedures.js";
import { getDb } from "../queries/connection.js";
import { slideImages } from "../../db/schema.js";
import { completeText, generateImage } from "../ai/provider.js";
import { extractJson } from "../ai/prompts.js";
import { applyTokenDelta } from "../tokens.js";
import { getSettings } from "../settings.js";
import { IMAGE_URL_PREFIX } from "../deck-images.js";

/** What one storyboard costs. Text-only, so a flat small fee like the other
 *  short AI writes (grading, recalibration) rather than an image price. */
const STORYBOARD_COST = 2;

/** Picking out the words worth colouring is a much smaller read than writing
 *  the whole carousel, so it is priced below one. */
const HIGHLIGHT_COST = 1;

/** Aspect the backdrop is composed for — the post formats the editor offers. */
const FORMAT_SHAPE: Record<string, string> = {
  "9:16": "a vertical 9:16 story frame (portrait, much taller than wide)",
  "4:5": "a 4:5 portrait feed post (taller than wide)",
  "1:1": "a square 1:1 feed post",
};

/**
 * The backdrop of one carousel slide. The generator is told the frame AND
 * that a caption band may cover the lower part, so it puts the subject where
 * the band won't eat it — the same "compose for the real frame" rule the
 * banners follow.
 */
function postDirective(format: string): string {
  const shape = FORMAT_SHAPE[format] ?? FORMAT_SHAPE["9:16"];
  return (
    `This image is ${shape} for a social media marketing carousel. ` +
    "Hyper-realistic photographic quality, natural light, professional advertising " +
    "polish — NOT an illustration, NOT cartoon, NOT digital art. Keep the subject in " +
    "the UPPER portion of the frame and leave the bottom third visually calm: a " +
    "caption band is laid over it. People shown must be adults; show a diverse, " +
    "multiracial mix. No text, no logos, no watermarks anywhere in the image."
  );
}

/** The words the AI thinks carry the meaning of a line. Returned as words
 *  rather than positions because models count words unreliably — the editor
 *  matches them back onto the text it is actually showing. */
const keywordsSchema = z.object({
  titleKeywords: z.array(z.string().max(60)).max(12).default([]),
  subtitleKeywords: z.array(z.string().max(60)).max(12).default([]),
});

const slideSchema = z
  .object({
    title: z.string().max(120).default(""),
    subtitle: z.string().max(300).default(""),
    imagePrompt: z.string().max(600).default(""),
  })
  .merge(keywordsSchema);

/** How the keyword half of a reply is asked for, shared by both endpoints so
 *  a story write and a later re-highlight pick words the same way. */
const KEYWORD_RULE =
  "Also pick out the words worth colouring — the ones that carry the meaning and " +
  "should catch the eye when someone scrolls past. titleKeywords: 1 to 2 words from " +
  "the title, copied EXACTLY as they appear there. subtitleKeywords: 2 to 4 words from " +
  "the subtitle, again copied exactly. Never the whole line, never filler like " +
  '"the", "your", "and" — nouns and verbs that matter.';

export const marketingRouter = createRouter({
  /** What a backdrop and a storyboard cost — quoted on their buttons. */
  quote: adminProcedure.query(
    async (): Promise<{ image: number; storyboard: number; highlight: number }> => {
      const { prices } = await getSettings();
      return {
        image: Math.max(1, Math.ceil(prices.perImageSlide)),
        storyboard: STORYBOARD_COST,
        highlight: HIGHLIGHT_COST,
      };
    },
  ),

  /**
   * Write the whole carousel: an opening hook, the steps in between, and a
   * closing card — each with its own title, subtitle and a prompt for the
   * picture behind it. This is the "tell a little story" half of the tool;
   * the editor then lets every word be re-typed, resized and recoloured.
   */
  storyboard: adminProcedure
    .input(
      z.object({
        topic: z.string().min(3).max(500),
        slideCount: z.number().int().min(2).max(10).default(5),
        format: z.enum(["9:16", "4:5", "1:1"]).default("9:16"),
      }),
    )
    .mutation(
      async ({ ctx, input }): Promise<{ slides: z.infer<typeof slideSchema>[]; cost: number }> => {
        if (ctx.user.tokenBalance < STORYBOARD_COST) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: `INSUFFICIENT_TOKENS: a storyboard costs ${STORYBOARD_COST} 🪙, you have ${ctx.user.tokenBalance} 🪙`,
          });
        }
        const system =
          "You write Instagram carousels for a marketing team. Given a subject, plan a " +
          `carousel of exactly ${input.slideCount} slides that tells one small, complete story: ` +
          "slide 1 hooks the reader, the middle slides walk through the steps or ideas one at a " +
          "time in order, and the last slide closes with a takeaway or invitation. " +
          "For EVERY slide give: title — 2 to 6 punchy words, the big line on the card; " +
          "subtitle — one or two short sentences that explain it; imagePrompt — a concrete " +
          "description of a photograph for that slide's backdrop (setting, subject, action, " +
          "light), showing adults, no text in the picture. Write for adults. " +
          KEYWORD_RULE +
          ' Reply STRICT JSON ONLY: {"slides":[{"title":"…","subtitle":"…","imagePrompt":"…",' +
          '"titleKeywords":["…"],"subtitleKeywords":["…"]}]}';
        let parsed: { slides?: unknown } | null = null;
        for (let attempt = 0; attempt < 2 && parsed === null; attempt++) {
          try {
            const result = await completeText({
              userId: ctx.user.id,
              messages: [
                { role: "system", content: system },
                {
                  role: "user",
                  content:
                    attempt === 0
                      ? input.topic
                      : `${input.topic}\n\nReminder: STRICT JSON ONLY, exactly the requested shape.`,
                },
              ],
              maxTokens: 3000,
            });
            if (!result) break;
            parsed = JSON.parse(extractJson(result.text)) as { slides?: unknown };
          } catch (err) {
            console.warn(`[marketing.storyboard] attempt ${attempt + 1} failed:`, err);
          }
        }
        const slides = z.array(slideSchema).min(1).safeParse(parsed?.slides);
        if (!slides.success) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message:
              "AI_UNAVAILABLE: no AI provider wrote the storyboard — nothing was charged. Check the server AI keys and try again.",
          });
        }
        await applyTokenDelta(ctx.user.id, -STORYBOARD_COST, `carousel storyboard: ${input.topic.slice(0, 55)}`);
        return { slides: slides.data.slice(0, input.slideCount), cost: STORYBOARD_COST };
      },
    ),

  /**
   * Re-read cards that are already written — typed by hand, or edited after
   * the storyboard — and say which words to colour. Separate from the write
   * so the highlight can follow the text as it changes.
   */
  highlight: adminProcedure
    .input(
      z.object({
        slides: z
          .array(z.object({ title: z.string().max(120), subtitle: z.string().max(300) }))
          .min(1)
          .max(10),
      }),
    )
    .mutation(
      async ({
        ctx,
        input,
      }): Promise<{ slides: z.infer<typeof keywordsSchema>[]; cost: number }> => {
        if (ctx.user.tokenBalance < HIGHLIGHT_COST) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: `INSUFFICIENT_TOKENS: highlighting costs ${HIGHLIGHT_COST} 🪙, you have ${ctx.user.tokenBalance} 🪙`,
          });
        }
        const system =
          "You are a marketing designer choosing which words on a social card get painted " +
          "a bright accent colour. You are given the cards of one carousel, in order. " +
          KEYWORD_RULE +
          " Return one entry per card, in the same order as given, even if a card is empty " +
          "(use empty arrays then). " +
          'Reply STRICT JSON ONLY: {"slides":[{"titleKeywords":["…"],"subtitleKeywords":["…"]}]}';
        const cards = input.slides
          .map((s, i) => `Card ${i + 1}\nTitle: ${s.title || "(empty)"}\nSubtitle: ${s.subtitle || "(empty)"}`)
          .join("\n\n");
        let parsed: { slides?: unknown } | null = null;
        for (let attempt = 0; attempt < 2 && parsed === null; attempt++) {
          try {
            const result = await completeText({
              userId: ctx.user.id,
              messages: [
                { role: "system", content: system },
                {
                  role: "user",
                  content:
                    attempt === 0
                      ? cards
                      : `${cards}\n\nReminder: STRICT JSON ONLY, exactly ${input.slides.length} entries.`,
                },
              ],
              maxTokens: 1200,
            });
            if (!result) break;
            parsed = JSON.parse(extractJson(result.text)) as { slides?: unknown };
          } catch (err) {
            console.warn(`[marketing.highlight] attempt ${attempt + 1} failed:`, err);
          }
        }
        const picked = z.array(keywordsSchema).min(1).safeParse(parsed?.slides);
        if (!picked.success) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message:
              "AI_UNAVAILABLE: no AI provider picked the keywords — nothing was charged. Check the server AI keys and try again.",
          });
        }
        await applyTokenDelta(ctx.user.id, -HIGHLIGHT_COST, `carousel keywords: ${input.slides.length} cards`);
        // Pad a short reply so slide N of the answer always lines up with slide N
        // of the editor rather than silently sliding onto the wrong card.
        const slides = input.slides.map(
          (_, i) => picked.data[i] ?? { titleKeywords: [], subtitleKeywords: [] },
        );
        return { slides, cost: HIGHLIGHT_COST };
      },
    ),

  /**
   * Draw one slide's backdrop. Charged like every other image here, and only
   * once the picture actually exists.
   */
  generate: adminProcedure
    .input(
      z.object({
        prompt: z.string().min(3).max(1000),
        format: z.enum(["9:16", "4:5", "1:1"]).default("9:16"),
      }),
    )
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
        prompt: `${input.prompt}\n\n${postDirective(input.format)}`,
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
