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
import { SITE, siteBrief } from "../../contracts/site.js";

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
/**
 * A logo mark, not a photograph — the one image here that is deliberately flat
 * and graphic, because it ends up inside a small circle on the follow card and
 * a photo would turn to mud at that size.
 */
const LOGO_DIRECTIVE =
  "Design this as a LOGO MARK: a single centred emblem on a plain solid " +
  "background, flat vector look, clean bold shapes, high contrast, generous " +
  "empty margin around the mark. It will be shown small inside a circle, so no " +
  "fine detail, no photographic texture, no gradients, no drop shadows, no " +
  "mockup, no business card, and absolutely no lettering or words unless the " +
  "brief asks for a specific letter.";

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

/** The two lines of the closing follow card the AI is allowed to write. The
 *  rest of that card — handle, counts, logo — is the user's to set. */
const endCardSchema = z.object({
  headline: z.string().max(200).default(""),
  bio: z.string().max(200).default(""),
});

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
    async (): Promise<{ image: number; storyboard: number; highlight: number; logo: number }> => {
      const { prices } = await getSettings();
      const image = Math.max(1, Math.ceil(prices.perImageSlide));
      return { image, storyboard: STORYBOARD_COST, highlight: HIGHLIGHT_COST, logo: image };
    },
  ),

  /**
   * How the closing follow card starts out: this site's own name, handle and
   * bio, so the card is already correct before anyone types. Free and
   * AI-free — it reads the same description the About page renders, which is
   * what makes it right rather than guessed.
   */
  brand: adminProcedure.query(
    (): { name: string; handle: string; headline: string; bio: string } => ({
      name: SITE.name,
      handle: SITE.handle,
      headline: `You will never see this page again unless you follow us right now 👇`,
      bio: SITE.bio.join("\n"),
    }),
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
      async ({
        ctx,
        input,
      }): Promise<{
        slides: z.infer<typeof slideSchema>[];
        endCard: z.infer<typeof endCardSchema> | null;
        cost: number;
      }> => {
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
          " The carousel closes with a follow card for the account posting it. Write its two " +
          "lines from the account description below, bent towards this carousel's subject: " +
          "endCard.headline — one short line telling the reader to follow, in the voice of the " +
          "account; endCard.bio — at most two short lines for under the account name, the second " +
          "may be a contact line. " +
          `The account: ${siteBrief()} ` +
          'Reply STRICT JSON ONLY: {"slides":[{"title":"…","subtitle":"…","imagePrompt":"…",' +
          '"titleKeywords":["…"],"subtitleKeywords":["…"]}],' +
          '"endCard":{"headline":"…","bio":"…"}}';
        let parsed: { slides?: unknown; endCard?: unknown } | null = null;
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
            parsed = JSON.parse(extractJson(result.text)) as {
              slides?: unknown;
              endCard?: unknown;
            };
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
        // The follow card is a bonus, not the deliverable — a model that skips
        // it must not cost the user a written carousel.
        const endCard = endCardSchema.safeParse(parsed?.endCard);
        return {
          slides: slides.data.slice(0, input.slideCount),
          endCard: endCard.success ? endCard.data : null,
          cost: STORYBOARD_COST,
        };
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
          .max(20),
        /** which half of the card to repaint — the other is left alone */
        scope: z.enum(["title", "subtitle", "both"]).default("both"),
      }),
    )
    .mutation(
      async ({
        ctx,
        input,
      }): Promise<{
        slides: z.infer<typeof keywordsSchema>[];
        scope: "title" | "subtitle" | "both";
        cost: number;
      }> => {
        if (ctx.user.tokenBalance < HIGHLIGHT_COST) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: `INSUFFICIENT_TOKENS: highlighting costs ${HIGHLIGHT_COST} 🪙, you have ${ctx.user.tokenBalance} 🪙`,
          });
        }
        const only =
          input.scope === "title"
            ? " Only the title matters this time: always return subtitleKeywords as an empty array."
            : input.scope === "subtitle"
              ? " Only the subtitle matters this time: always return titleKeywords as an empty array."
              : "";
        const system =
          "You are a marketing designer choosing which words on a social card get painted " +
          "a bright accent colour. You are given the cards of one carousel, in order. " +
          KEYWORD_RULE +
          only +
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
        // of the editor rather than silently sliding onto the wrong card, and
        // hold the model to the scope — asking for the title only must never
        // come back and repaint the subtitle.
        const slides = input.slides.map((_, i) => {
          const k = picked.data[i] ?? { titleKeywords: [], subtitleKeywords: [] };
          return {
            titleKeywords: input.scope === "subtitle" ? [] : k.titleKeywords,
            subtitleKeywords: input.scope === "title" ? [] : k.subtitleKeywords,
          };
        });
        return { slides, scope: input.scope, cost: HIGHLIGHT_COST };
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
    .mutation(async ({ ctx, input }): Promise<{ url: string; cost: number }> =>
      drawAndStore(ctx.user.id, ctx.user.tokenBalance, {
        prompt: `${input.prompt}\n\n${postDirective(input.format)}`,
        what: "a post image",
        note: `marketing post: ${input.prompt.slice(0, 55)}`,
      }),
    ),

  /**
   * Draw the logo that sits in the follow card's circle. Same price and same
   * path as a backdrop — only the art direction differs, because a photograph
   * shrunk into that circle reads as a smudge.
   */
  logo: adminProcedure
    .input(z.object({ prompt: z.string().min(3).max(600) }))
    .mutation(async ({ ctx, input }): Promise<{ url: string; cost: number }> =>
      drawAndStore(ctx.user.id, ctx.user.tokenBalance, {
        prompt: `Logo brief: ${input.prompt}\n\n${LOGO_DIRECTIVE}`,
        what: "a logo",
        note: `marketing logo: ${input.prompt.slice(0, 55)}`,
      }),
    ),
});

/**
 * Charge for a picture, draw it, and park it in slideImages so the page gets a
 * URL instead of a megabyte of base64. Nothing is charged unless a generator
 * actually answered.
 */
async function drawAndStore(
  userId: number,
  balance: number,
  opts: { prompt: string; what: string; note: string },
): Promise<{ url: string; cost: number }> {
  const { prices } = await getSettings();
  const cost = Math.max(1, Math.ceil(prices.perImageSlide));
  if (balance < cost) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `INSUFFICIENT_TOKENS: ${opts.what} costs ${cost} 🪙, you have ${balance} 🪙`,
    });
  }
  const url = await generateImage({ userId, prompt: opts.prompt });
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
  await applyTokenDelta(userId, -cost, opts.note);
  const [row] = await getDb()
    .insert(slideImages)
    .values({ ownerId: userId, mime: m[1], data: m[2] })
    .returning({ id: slideImages.id });
  return { url: `${IMAGE_URL_PREFIX}${row.id}`, cost };
}
