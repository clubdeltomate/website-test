import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { createRouter } from "../middleware.js";
import { adminProcedure } from "../procedures.js";
import { getDb } from "../queries/connection.js";
import { marketingProfiles, slideImages } from "../../db/schema.js";
import {
  type AspectRatio,
  MUSIC_MAX_SECONDS,
  MUSIC_MIN_SECONDS,
  completeText,
  generateImage,
  generateMusic,
} from "../ai/provider.js";
import { extractJson } from "../ai/prompts.js";
import { applyTokenDelta } from "../tokens.js";
import { getSettings } from "../settings.js";
import { IMAGE_URL_PREFIX } from "../deck-images.js";
import { SITE, siteBrief } from "../../contracts/site.js";
import { MAX_IN_FRAME, castDirective, castRoster, pickForFrame } from "../../contracts/cast.js";
import { CATEGORY_BRIEF, POST_CATEGORIES } from "../../contracts/post.js";
import { LANGUAGE_CODES, languageRule } from "../../contracts/languages.js";

/** What one storyboard costs. Text-only, so a flat small fee like the other
 *  short AI writes (grading, recalibration) rather than an image price. */
const STORYBOARD_COST = 2;

/** Picking out the words worth colouring is a much smaller read than writing
 *  the whole carousel, so it is priced below one. */
const HIGHLIGHT_COST = 1;

/**
 * What a music bed costs, in coins.
 *
 * Priced by the second off the settings figure for thirty of them, because
 * that is how ElevenLabs bills it — a minute of music is twice the work of
 * half a minute, and a flat fee would either overcharge the short ones or
 * lose money on the long ones. Everyone pays it: an admin generating a
 * soundtrack is spending the same API call as anybody else.
 */
export function musicCost(perMusic: number, seconds: number): number {
  return Math.max(1, Math.ceil((perMusic * seconds) / 30));
}

/** Aspect the backdrop is composed for — the post formats the editor offers. */
const FORMAT_SHAPE: Record<string, string> = {
  "9:16": "a vertical 9:16 story frame (portrait, much taller than wide)",
  "4:5": "a 4:5 portrait feed post (taller than wide)",
  "1:1": "a square 1:1 feed post",
};

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
    /** which of the selected models this slide's picture should show */
    cast: z.array(z.string().max(120)).max(6).default([]),
  })
  .merge(keywordsSchema);

/** A model as the editor sends it — the sheet is the part that matters. */
const castMemberSchema = z.object({
  name: z.string().max(120),
  headline: z.string().max(200).default(""),
  sheet: z.string().max(2000),
});

/** The two lines of the closing follow card the AI is allowed to write. The
 *  rest of that card — handle, counts, logo — is the user's to set. */
const endCardSchema = z.object({
  headline: z.string().max(200).default(""),
  bio: z.string().max(200).default(""),
});

/**
 * How the storyboard is told about the cast.
 *
 * Deliberately permissive: the selection is a pool to draw from, not a
 * checklist to satisfy. Ten chosen models with three actually used across a
 * carousel is the right outcome if that is what the story wants — forcing all
 * of them in would make the posts worse, which is the opposite of the point.
 */
function castRule(cast: { name: string; headline: string }[]): string {
  if (cast.length === 0) return "";
  return (
    `A recurring cast is available for the photographs: ${castRoster(cast)}. ` +
    "For each slide put the names you want in that picture in its cast array — one or two " +
    `usually, never more than ${MAX_IN_FRAME}, and an empty array for a slide that is a ` +
    "close-up of an object or a place with nobody in it. Everyone you name WILL be in that " +
    "picture, so name the ones the moment actually calls for and write the imagePrompt around " +
    "all of them. You do NOT have to use everyone; picking three of them across the whole " +
    "carousel is fine if that serves the story better. Choose whoever fits the moment. Write " +
    "the imagePrompt around the action and the setting and refer to the person by name — their " +
    "appearance is supplied separately, so do not describe their looks yourself. "
  );
}

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
    async (): Promise<{
      image: number;
      storyboard: number;
      highlight: number;
      logo: number;
      /** coins for thirty seconds of music; the editor scales it by length */
      music: number;
    }> => {
      const { prices } = await getSettings();
      const image = Math.max(1, Math.ceil(prices.perImageSlide));
      return {
        image,
        storyboard: STORYBOARD_COST,
        highlight: HIGHLIGHT_COST,
        logo: image,
        music: musicCost(prices.perMusic ?? 20, 30),
      };
    },
  ),

  /**
   * How the closing follow card starts out.
   *
   * Whatever was last saved with Update, if anything — an account's counts and
   * logo do not change post to post, so retyping them every time was the
   * wrong default. Failing that, this site's own name and bio, read from the
   * same description the About page renders, which makes it right rather than
   * guessed. Free and AI-free either way.
   */
  brand: adminProcedure.query(
    async ({
      ctx,
    }): Promise<{
      name: string;
      handle: string;
      headline: string;
      bio: string;
      saved: Record<string, unknown> | null;
    }> => {
      const [row] = await getDb()
        .select({ followCard: marketingProfiles.followCard })
        .from(marketingProfiles)
        .where(eq(marketingProfiles.ownerId, ctx.user.id));
      return {
        name: SITE.name,
        handle: SITE.handle,
        headline: `You will never see this page again unless you follow us right now 👇`,
        bio: SITE.bio.join("\n"),
        saved: (row?.followCard as Record<string, unknown> | null) ?? null,
      };
    },
  ),

  /**
   * Remember this follow card for next time.
   *
   * An uploaded logo arrives as a data URL, which must not go into the row —
   * it would be megabytes of base64 read back on every page load. It is
   * parked in slideImages like every other picture and the card keeps the
   * short URL instead.
   */
  saveBrand: adminProcedure
    .input(
      z.object({
        card: z.record(z.string(), z.unknown()),
        /** a data: URL to store, or an /api/img URL to keep as-is, or null */
        logoUrl: z.string().max(8_000_000).nullable().default(null),
      }),
    )
    .mutation(async ({ ctx, input }): Promise<{ logoUrl: string | null }> => {
      let logoUrl = input.logoUrl;
      const data = logoUrl && /^data:([^;,]+);base64,(.+)$/s.exec(logoUrl);
      if (data) {
        const [row] = await getDb()
          .insert(slideImages)
          .values({ ownerId: ctx.user.id, mime: data[1], data: data[2] })
          .returning({ id: slideImages.id });
        logoUrl = `${IMAGE_URL_PREFIX}${row.id}`;
      }
      const followCard = { ...input.card, logoUrl };
      await getDb()
        .insert(marketingProfiles)
        .values({ ownerId: ctx.user.id, followCard })
        .onConflictDoUpdate({
          target: marketingProfiles.ownerId,
          set: { followCard, updatedAt: new Date() },
        });
      return { logoUrl };
    }),

  /** The business card as last saved, plus what we know to fill a blank one. */
  card: adminProcedure.query(
    async ({
      ctx,
    }): Promise<{
      saved: Record<string, unknown> | null;
      name: string;
      company: string;
      details: string;
    }> => {
      const [row] = await getDb()
        .select({ businessCard: marketingProfiles.businessCard, followCard: marketingProfiles.followCard })
        .from(marketingProfiles)
        .where(eq(marketingProfiles.ownerId, ctx.user.id));
      const follow = (row?.followCard ?? {}) as { name?: string };
      return {
        saved: (row?.businessCard as Record<string, unknown> | null) ?? null,
        name: ctx.user.name,
        // The account name from the follow card is the trading name if there
        // is one; otherwise this site is who you are posting as.
        company: follow.name || SITE.name,
        details: [ctx.user.email, SITE.contact].filter(Boolean).join("\n"),
      };
    },
  ),

  /** Keep this business card. Same logo handling as the follow card. */
  saveCard: adminProcedure
    .input(
      z.object({
        card: z.record(z.string(), z.unknown()),
        logoUrl: z.string().max(8_000_000).nullable().default(null),
      }),
    )
    .mutation(async ({ ctx, input }): Promise<{ logoUrl: string | null }> => {
      let logoUrl = input.logoUrl;
      const data = logoUrl && /^data:([^;,]+);base64,(.+)$/s.exec(logoUrl);
      if (data) {
        const [row] = await getDb()
          .insert(slideImages)
          .values({ ownerId: ctx.user.id, mime: data[1], data: data[2] })
          .returning({ id: slideImages.id });
        logoUrl = `${IMAGE_URL_PREFIX}${row.id}`;
      }
      const businessCard = { ...input.card, logoUrl };
      await getDb()
        .insert(marketingProfiles)
        .values({ ownerId: ctx.user.id, businessCard })
        .onConflictDoUpdate({
          target: marketingProfiles.ownerId,
          set: { businessCard, updatedAt: new Date() },
        });
      return { logoUrl };
    }),

  /**
   * Write the card's words from what this account actually is.
   *
   * Not a blank-page prompt: the AI is given the person's name, the trading
   * name, and — the part that makes it worth asking — the categories they
   * have actually been posting in, so a card for someone whose feed is all
   * restaurant posts reads like a restaurant's card rather than a generic one.
   */
  draftCard: adminProcedure
    .input(
      z.object({
        note: z.string().max(300).default(""),
        categories: z.array(z.enum(POST_CATEGORIES)).max(6).default([]),
      }),
    )
    .mutation(
      async ({
        ctx,
        input,
      }): Promise<{ title: string; tagline: string; cost: number }> => {
        if (ctx.user.tokenBalance < HIGHLIGHT_COST) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: `INSUFFICIENT_TOKENS: drafting costs ${HIGHLIGHT_COST} 🪙, you have ${ctx.user.tokenBalance} 🪙`,
          });
        }
        const doing =
          input.categories.length > 0
            ? input.categories.map((c) => CATEGORY_BRIEF[c]).join("; ")
            : "not posted anything yet, so keep it broad";
        const system =
          "You write the two lines on a business card. Given who someone is and what they " +
          "publish, give: title — their role, 2 to 5 words, no invented seniority; " +
          "tagline — one short line, under 12 words, saying what they do for someone. " +
          "Plain and specific, no slogans about passion or excellence. " +
          'Reply STRICT JSON ONLY: {"title":"…","tagline":"…"}';
        const who = [
          `Name: ${ctx.user.name}`,
          `Posts about: ${doing}`,
          input.note.trim() ? `They add: ${input.note.trim()}` : "",
        ]
          .filter(Boolean)
          .join("\n");
        let parsed: unknown = null;
        for (let attempt = 0; attempt < 2 && parsed === null; attempt++) {
          try {
            const result = await completeText({
              userId: ctx.user.id,
              messages: [
                { role: "system", content: system },
                {
                  role: "user",
                  content:
                    attempt === 0 ? who : `${who}\n\nReminder: STRICT JSON ONLY.`,
                },
              ],
              maxTokens: 300,
            });
            if (!result) break;
            parsed = JSON.parse(extractJson(result.text));
          } catch (err) {
            console.warn(`[marketing.draftCard] attempt ${attempt + 1} failed:`, err);
          }
        }
        const drafted = z
          .object({ title: z.string().max(80), tagline: z.string().max(160) })
          .safeParse(parsed);
        if (!drafted.success) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message:
              "AI_UNAVAILABLE: no AI provider drafted the card — nothing was charged. Check the server AI keys and try again.",
          });
        }
        await applyTokenDelta(ctx.user.id, -HIGHLIGHT_COST, "business card draft");
        return { ...drafted.data, cost: HIGHLIGHT_COST };
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
        /** the models available to cast from; may be empty */
        cast: z.array(castMemberSchema).max(12).default([]),
        /** what kind of thing is being sold, in the shelf's own vocabulary */
        category: z.enum(POST_CATEGORIES).default("course"),
        /** what the reader reads it in; picture briefs stay English */
        language: z.enum(LANGUAGE_CODES).default("en"),
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
          "You write Instagram carousels for a marketing team. The subject is " +
          `${CATEGORY_BRIEF[input.category]}. Given it, plan a ` +
          `carousel of exactly ${input.slideCount} slides that tells one small, complete story: ` +
          "slide 1 hooks the reader, the middle slides walk through the steps or ideas one at a " +
          "time in order, and the last slide closes with a takeaway or invitation. " +
          "For EVERY slide give: title — 2 to 6 punchy words, the big line on the card; " +
          "subtitle — one or two short sentences that explain it; imagePrompt — a concrete " +
          "description of a photograph for that slide's backdrop (setting, subject, action, " +
          "light), showing adults, no text in the picture. Write for adults. " +
          castRule(input.cast) +
          languageRule(input.language) +
          KEYWORD_RULE +
          " The carousel closes with a follow card for the account posting it. Write its two " +
          "lines from the account description below, bent towards this carousel's subject: " +
          "endCard.headline — one short line telling the reader to follow, in the voice of the " +
          "account; endCard.bio — at most two short lines for under the account name, the second " +
          "may be a contact line. " +
          `The account: ${siteBrief()} ` +
          'Reply STRICT JSON ONLY: {"slides":[{"title":"…","subtitle":"…","imagePrompt":"…",' +
          '"titleKeywords":["…"],"subtitleKeywords":["…"],"cast":["…"]}],' +
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
        /** the models this frame shows, so they come back looking the same */
        cast: z.array(castMemberSchema).max(6).default([]),
      }),
    )
    .mutation(async ({ ctx, input }): Promise<{ url: string; cost: number }> =>
      drawAndStore(ctx.user.id, ctx.user.tokenBalance, {
        // Everyone chosen for the slide appears, up to what one frame can
        // carry; past that, four of them at random.
        prompt: [
          input.prompt,
          castDirective(pickForFrame(input.cast)),
          postDirective(input.format),
        ]
          .filter(Boolean)
          .join("\n\n"),
        what: "a post image",
        note: `marketing post: ${input.prompt.slice(0, 55)}`,
        // Ask for the frame the slide actually is, so the generator composes
        // to fill it instead of letterboxing a tall scene inside a square.
        aspect: input.format,
      }),
    ),

  /**
   * Compose the music that plays under a carousel.
   *
   * ElevenLabs writes it from the same kind of brief the pictures get. The
   * clip is parked with the images rather than in a table of its own — it is
   * bytes with a mime type, which is exactly what that table holds — and the
   * post keeps its id.
   */
  music: adminProcedure
    .input(
      z.object({
        prompt: z.string().min(3).max(600),
        seconds: z
          .number()
          .int()
          .min(MUSIC_MIN_SECONDS)
          .max(MUSIC_MAX_SECONDS)
          .default(30),
      }),
    )
    .mutation(
      async ({ ctx, input }): Promise<{ url: string; seconds: number; cost: number }> => {
        const { prices } = await getSettings();
        const cost = musicCost(prices.perMusic ?? 20, input.seconds);
        if (ctx.user.tokenBalance < cost) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: `INSUFFICIENT_TOKENS: ${input.seconds}s of music costs ${cost} 🪙, you have ${ctx.user.tokenBalance} 🪙`,
          });
        }
        const made = await generateMusic({
          userId: ctx.user.id,
          prompt: `${input.prompt.trim()}\n\nAn instrumental background bed for a short social media carousel: no vocals, no lyrics, no sudden silences, even loudness throughout so it can be looped.`,
          seconds: input.seconds,
        });
        if (!made) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message:
              "AI_UNAVAILABLE: no ElevenLabs key answered — nothing was charged. Add an ElevenLabs key under Settings → AI keys and try again.",
          });
        }
        const m = /^data:([^;,]+);base64,(.+)$/s.exec(made.audio);
        if (!m) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "The music came back in a form we can't store",
          });
        }
        await applyTokenDelta(
          ctx.user.id,
          -cost,
          `post music: ${input.seconds}s — ${input.prompt.slice(0, 45)}`,
        );
        const [row] = await getDb()
          .insert(slideImages)
          .values({ ownerId: ctx.user.id, mime: m[1], data: m[2] })
          .returning({ id: slideImages.id });
        return { url: `${IMAGE_URL_PREFIX}${row.id}`, seconds: input.seconds, cost };
      },
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
        // A mark that ends up in a circle wants a square to begin with.
        aspect: "1:1",
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
  opts: { prompt: string; what: string; note: string; aspect: AspectRatio },
): Promise<{ url: string; cost: number }> {
  const { prices } = await getSettings();
  const cost = Math.max(1, Math.ceil(prices.perImageSlide));
  if (balance < cost) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `INSUFFICIENT_TOKENS: ${opts.what} costs ${cost} 🪙, you have ${balance} 🪙`,
    });
  }
  const url = await generateImage({ userId, prompt: opts.prompt, aspect: opts.aspect });
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
