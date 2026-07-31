import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, desc, eq } from "drizzle-orm";
import { createRouter } from "../middleware.js";
import { adminProcedure } from "../procedures.js";
import { getDb } from "../queries/connection.js";
import { castModels, slideImages } from "../../db/schema.js";
import { completeVision } from "../ai/provider.js";
import { extractJson } from "../ai/prompts.js";
import { applyTokenDelta } from "../tokens.js";
import { IMAGE_URL_PREFIX } from "../deck-images.js";
import { DEFAULT_CAST, type CastModel } from "../../contracts/cast.js";

/** Reading a face out of a photograph is one short vision call. */
const DESCRIBE_COST = 1;

const sheetSchema = z.object({
  name: z.string().min(1).max(120),
  headline: z.string().min(1).max(200),
  sheet: z.string().min(40).max(2000),
});

export const castRouter = createRouter({
  /**
   * The ten that ship with the tool, then anything this account has made.
   * The defaults live in code rather than in a seeded table so a fresh
   * database is never missing them and nobody can delete them by accident.
   */
  list: adminProcedure.query(async ({ ctx }): Promise<CastModel[]> => {
    const rows = await getDb()
      .select()
      .from(castModels)
      .where(eq(castModels.ownerId, ctx.user.id))
      .orderBy(desc(castModels.id));
    return [
      ...DEFAULT_CAST,
      ...rows.map((r) => ({
        id: `own-${r.id}`,
        name: r.name,
        headline: r.headline,
        sheet: r.sheet,
        photoUrl: r.photoId == null ? null : `${IMAGE_URL_PREFIX}${r.photoId}`,
        custom: true,
      })),
    ];
  }),

  /**
   * Turn an uploaded photograph into a cast member.
   *
   * The picture is *read*, not passed on: a vision model writes the same kind
   * of character sheet the built-in ten use, and that text is what reaches
   * the image generator from then on. That is what makes an uploaded person
   * usable in a frame that shows only their hands — and it works on every
   * provider we have, which handing the pixels to an image model would not.
   */
  fromPhoto: adminProcedure
    .input(
      z.object({
        /** data URL of the upload */
        image: z.string().min(32).max(8_000_000),
        /** optional steer, e.g. "call him Sam, he runs the workshop" */
        note: z.string().max(300).default(""),
        /** keep the photograph as the picker's thumbnail */
        keepPhoto: z.boolean().default(true),
      }),
    )
    .mutation(async ({ ctx, input }): Promise<{ model: CastModel; cost: number }> => {
      if (ctx.user.tokenBalance < DESCRIBE_COST) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: `INSUFFICIENT_TOKENS: reading a photo costs ${DESCRIBE_COST} 🪙, you have ${ctx.user.tokenBalance} 🪙`,
        });
      }
      const m = /^data:(image\/[a-z+.-]+);base64,(.+)$/s.exec(input.image.trim());
      if (!m) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "That doesn't look like an image file — try a PNG or a JPEG",
        });
      }
      const system =
        "You write character sheets for a marketing team's recurring cast. Look at the " +
        "photograph and describe the person in it so that an image generator can draw " +
        "SOMEONE WHO LOOKS LIKE THEM, consistently, from words alone. Be specific about what a " +
        "generator actually renders: apparent age band, skin tone AND undertone, hair colour, " +
        "texture and cut, facial hair, face shape, brows, notable features, build and " +
        "proportions, hands and nails, habitual clothing register. Describe only what you can " +
        "see; invent nothing about who they are. If the photograph shows a public figure, " +
        "describe the visible features WITHOUT naming them or referring to their fame. " +
        "Give: name — a plain first and last name for this character (use the note if one is " +
        "given, otherwise invent an ordinary one); headline — under 60 characters, e.g. " +
        '"Mid 30s · broad, outdoorsy, easy grin"; sheet — one paragraph, 60 to 120 words, ' +
        "written like a description handed to an illustrator, starting with the name. " +
        'Reply STRICT JSON ONLY: {"name":"…","headline":"…","sheet":"…"}';
      let parsed: unknown = null;
      for (let attempt = 0; attempt < 2 && parsed === null; attempt++) {
        try {
          const result = await completeVision({
            userId: ctx.user.id,
            system,
            userText:
              (input.note.trim() ? `Note from the user: ${input.note.trim()}\n\n` : "") +
              (attempt === 0
                ? "Describe this person."
                : "Describe this person. STRICT JSON ONLY, exactly the requested shape."),
            images: [{ mime: m[1], b64: m[2] }],
            maxTokens: 700,
          });
          if (!result) break;
          parsed = JSON.parse(extractJson(result.text));
        } catch (err) {
          console.warn(`[cast.fromPhoto] attempt ${attempt + 1} failed:`, err);
        }
      }
      const described = sheetSchema.safeParse(parsed);
      if (!described.success) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "AI_UNAVAILABLE: no AI provider could read that photo — nothing was charged. Check the server AI keys and try again.",
        });
      }
      await applyTokenDelta(ctx.user.id, -DESCRIBE_COST, `cast model: ${described.data.name}`);

      let photoId: number | null = null;
      if (input.keepPhoto) {
        const [img] = await getDb()
          .insert(slideImages)
          .values({ ownerId: ctx.user.id, mime: m[1], data: m[2] })
          .returning({ id: slideImages.id });
        photoId = img.id;
      }
      const [row] = await getDb()
        .insert(castModels)
        .values({ ownerId: ctx.user.id, ...described.data, photoId })
        .returning({ id: castModels.id });
      return {
        model: {
          id: `own-${row.id}`,
          ...described.data,
          photoUrl: photoId == null ? null : `${IMAGE_URL_PREFIX}${photoId}`,
          custom: true,
        },
        cost: DESCRIBE_COST,
      };
    }),

  /** Edit a model you made — the built-in ten are not yours to change. */
  update: adminProcedure
    .input(z.object({ id: z.number().int().positive() }).merge(sheetSchema.partial()))
    .mutation(async ({ ctx, input }): Promise<{ ok: true }> => {
      const { id, ...fields } = input;
      const patch = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
      if (Object.keys(patch).length === 0) return { ok: true };
      const done = await getDb()
        .update(castModels)
        .set(patch)
        .where(and(eq(castModels.id, id), eq(castModels.ownerId, ctx.user.id)))
        .returning({ id: castModels.id });
      if (done.length === 0) {
        throw new TRPCError({ code: "NOT_FOUND", message: "That model isn't yours to edit" });
      }
      return { ok: true };
    }),

  remove: adminProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }): Promise<{ ok: true }> => {
      await getDb()
        .delete(castModels)
        .where(and(eq(castModels.id, input.id), eq(castModels.ownerId, ctx.user.id)));
      return { ok: true };
    }),
});
