import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { asc, eq, inArray, sql } from "drizzle-orm";
import { createRouter } from "../middleware.js";
import { authedProcedure } from "../procedures.js";
import { getDb } from "../queries/connection.js";
import { lessons, repos, slideImages, unitImages, units, type Repo, type User } from "../../db/schema.js";
import { generateImage } from "../ai/provider.js";
import { applyTokenDelta } from "../tokens.js";
import { getSettings } from "../settings.js";
import { IMAGE_URL_PREFIX } from "../deck-images.js";

/** Largest upload accepted, measured on the decoded bytes. */
const MAX_UPLOAD_BYTES = 6 * 1024 * 1024;
const ALLOWED_MIME = ["image/png", "image/jpeg", "image/webp", "image/gif", "image/svg+xml"];

/**
 * Where a unit image actually ends up: a strip as wide as a lesson card and
 * half as tall — roughly 6:1, cropped vertically to fit. Every AI generation
 * for a unit goes through this directive, because a generator that doesn't
 * know the shape puts a portrait in a letterbox: heads cut off, the subject
 * out of frame. Told the truth about the strip, it can compose FOR it.
 */
const UNIT_BANNER_DIRECTIVE =
  "This image is a decorative unit banner displayed as an ultra-wide horizontal strip, " +
  "about 6:1 (very short for its width) — it will be cropped top and bottom to fit; " +
  "compose for exactly that frame. Style, strictly: professional ADVERTISING imagery — " +
  "the polished marketing campaign a company would run to promote this exact subject at " +
  "this level (a language academy's ad for a language unit, a culinary promo for a menu " +
  "unit, and so on). The audience is ADULTS — mostly young adults — never children: no " +
  "childish decoration, no kids. Show a diverse, multiracial mix of people. CRITICAL " +
  "framing: every face and head fully inside the vertical middle band of the strip, never " +
  "cropped by the edges; nothing important near the top or bottom. Realistic photographic " +
  "quality, NOT a sketch, NOT a collage, NOT cartoon. No text, no logos.";

async function unitContext(unitId: number): Promise<{ repo: Repo; unitId: number }> {
  const db = getDb();
  const unit = await db.query.units.findFirst({ where: eq(units.id, unitId) });
  if (!unit) throw new TRPCError({ code: "NOT_FOUND", message: "Unit not found" });
  const repo = await db.query.repos.findFirst({ where: eq(repos.id, unit.repoId) });
  if (!repo) throw new TRPCError({ code: "NOT_FOUND", message: "Repository not found" });
  return { repo, unitId: unit.id };
}

function assertCanEdit(repo: Repo, user: User) {
  if (repo.ownerId !== user.id && user.role !== "admin") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Only the repo's owner can edit it" });
  }
}

/**
 * Next position in the unit. Lessons and images share one sequence, so a new
 * item goes after whichever kind currently sits last — otherwise "added at the
 * end" would mean the end of its own kind, and a new image would appear halfway
 * up the list.
 */
async function nextOrderIndex(unitId: number): Promise<number> {
  const db = getDb();
  const [l] = await db
    .select({ max: sql<number | null>`max(${lessons.orderIndex})` })
    .from(lessons)
    .where(eq(lessons.unitId, unitId));
  const [i] = await db
    .select({ max: sql<number | null>`max(${unitImages.orderIndex})` })
    .from(unitImages)
    .where(eq(unitImages.unitId, unitId));
  return Math.max(l?.max ?? -1, i?.max ?? -1) + 1;
}

/** Store bytes in slideImages and return the row id. */
async function storeBytes(mime: string, base64: string, ownerId: number | null): Promise<number> {
  const [row] = await getDb()
    .insert(slideImages)
    .values({ ownerId, mime, data: base64 })
    .returning({ id: slideImages.id });
  return row.id;
}

export const unitImagesRouter = createRouter({
  /**
   * Place a picture in a unit, either uploaded or generated.
   *
   * An upload costs nothing. Generating one costs credits, because it is an AI
   * call like any other — priced from the same per-image figure the slide
   * generator uses, so a picture in a unit and a picture on a slide cost the
   * same thing.
   */
  create: authedProcedure
    .input(
      z.union([
        z.object({
          unitId: z.number().int(),
          source: z.literal("upload"),
          mime: z.string().max(100),
          /** base64 WITHOUT the data: prefix */
          data: z.string().min(1),
          caption: z.string().max(300).optional(),
        }),
        z.object({
          unitId: z.number().int(),
          source: z.literal("generate"),
          prompt: z.string().min(3).max(1000),
          style: z.string().max(40).optional(),
          caption: z.string().max(300).optional(),
        }),
      ]),
    )
    .mutation(async ({ ctx, input }): Promise<{ id: number; url: string; cost: number }> => {
      const db = getDb();
      const { repo, unitId } = await unitContext(input.unitId);
      assertCanEdit(repo, ctx.user);

      let imageId: number;
      let cost = 0;

      if (input.source === "upload") {
        if (!ALLOWED_MIME.includes(input.mime)) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `That file type isn't accepted — use ${ALLOWED_MIME.map((m) => m.replace("image/", "")).join(", ")}`,
          });
        }
        // The base64 is ~4/3 of the real size; check the decoded length so the
        // limit means what it says.
        const bytes = Math.floor((input.data.length * 3) / 4);
        if (bytes > MAX_UPLOAD_BYTES) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `That image is ${(bytes / 1e6).toFixed(1)} MB — the limit is ${MAX_UPLOAD_BYTES / 1e6} MB`,
          });
        }
        imageId = await storeBytes(input.mime, input.data, ctx.user.id);
      } else {
        const { prices } = await getSettings();
        cost = Math.max(1, Math.ceil(prices.perImageSlide));
        if (ctx.user.tokenBalance < cost) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: `INSUFFICIENT_TOKENS: an image costs ${cost} 🪙, you have ${ctx.user.tokenBalance} 🪙`,
          });
        }
        const url = await generateImage({
          userId: ctx.user.id,
          prompt: `${input.prompt}\n\n${UNIT_BANNER_DIRECTIVE}`,
          style: input.style,
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
        // Charged only once the picture actually exists.
        await applyTokenDelta(ctx.user.id, -cost, `unit image: ${input.prompt.slice(0, 60)}`);
        imageId = await storeBytes(m[1], m[2], ctx.user.id);
      }

      const [row] = await db
        .insert(unitImages)
        .values({
          unitId,
          imageId,
          caption: input.caption?.trim() || null,
          orderIndex: await nextOrderIndex(unitId),
        })
        .returning({ id: unitImages.id });
      return { id: row.id, url: `${IMAGE_URL_PREFIX}${imageId}`, cost };
    }),

  /**
   * One AI banner for every unit in the repo that doesn't have an image yet —
   * the follow-up fired right after AI repo creation, and safe to run again
   * later (already-illustrated units are skipped). Each banner leads its unit:
   * everything already in the unit moves down one place.
   *
   * Generated in parallel so the wall-clock cost is one image, not one per
   * unit; each success is charged individually, so a provider failing on unit
   * 3 still leaves units 1 and 2 made, charged, and in place.
   */
  generateBanners: authedProcedure
    .input(z.object({ repoSlug: z.string() }))
    .mutation(async ({ ctx, input }): Promise<{ made: number; failed: number; cost: number }> => {
      const db = getDb();
      const repo = await db.query.repos.findFirst({ where: eq(repos.slug, input.repoSlug) });
      if (!repo) throw new TRPCError({ code: "NOT_FOUND", message: "Repository not found" });
      assertCanEdit(repo, ctx.user);
      const repoUnits = await db
        .select()
        .from(units)
        .where(eq(units.repoId, repo.id))
        .orderBy(asc(units.orderIndex));
      if (repoUnits.length === 0) return { made: 0, failed: 0, cost: 0 };
      const illustrated = new Set(
        (
          await db
            .select({ unitId: unitImages.unitId })
            .from(unitImages)
            .where(inArray(unitImages.unitId, repoUnits.map((u) => u.id)))
        ).map((r) => r.unitId),
      );
      const bare = repoUnits.filter((u) => !illustrated.has(u.id));
      if (bare.length === 0) return { made: 0, failed: 0, cost: 0 };

      const { prices } = await getSettings();
      const per = Math.max(1, Math.ceil(prices.perImageSlide));
      if (ctx.user.tokenBalance < per * bare.length) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: `INSUFFICIENT_TOKENS: ${bare.length} banner${bare.length === 1 ? "" : "s"} cost ${per * bare.length} 🪙, you have ${ctx.user.tokenBalance} 🪙`,
        });
      }

      const results = await Promise.all(
        bare.map(async (u) => {
          const ls = await db
            .select({ title: lessons.title })
            .from(lessons)
            .where(eq(lessons.unitId, u.id))
            .orderBy(asc(lessons.orderIndex));
          const subject =
            `An advertising banner promoting the unit "${u.title}" from "${repo.title}". ` +
            (ls.length > 0
              ? `It covers: ${ls.slice(0, 6).map((l) => l.title).join("; ")}.`
              : "");
          const url = await generateImage({
            userId: ctx.user.id,
            prompt: `${subject}\n\n${UNIT_BANNER_DIRECTIVE}`,
          }).catch(() => null);
          if (!url) return false;
          const m = /^data:([^;,]+);base64,(.+)$/s.exec(url);
          if (!m) return false;
          await applyTokenDelta(ctx.user.id, -per, `unit banner: ${u.title.slice(0, 60)}`);
          const imageId = await storeBytes(m[1], m[2], ctx.user.id);
          await db.transaction(async (tx) => {
            await tx
              .update(lessons)
              .set({ orderIndex: sql`${lessons.orderIndex} + 1` })
              .where(eq(lessons.unitId, u.id));
            await tx
              .update(unitImages)
              .set({ orderIndex: sql`${unitImages.orderIndex} + 1` })
              .where(eq(unitImages.unitId, u.id));
            await tx.insert(unitImages).values({ unitId: u.id, imageId, caption: null, orderIndex: 0 });
          });
          return true;
        }),
      );
      const made = results.filter(Boolean).length;
      return { made, failed: bare.length - made, cost: made * per };
    }),

  /**
   * Swap the picture behind an existing placement — upload a different file,
   * or have the AI redraw it. Position and caption stay put; only the image
   * changes. Regeneration is charged like any generation, and only after the
   * new picture exists.
   */
  replace: authedProcedure
    .input(
      z.union([
        z.object({
          imageId: z.number().int(),
          source: z.literal("upload"),
          mime: z.string().max(100),
          /** base64 WITHOUT the data: prefix */
          data: z.string().min(1),
        }),
        z.object({
          imageId: z.number().int(),
          source: z.literal("generate"),
          /** Omitted → the server writes the prompt from the unit's own
              title and lessons, so one press regenerates in place. */
          prompt: z.string().min(3).max(1000).optional(),
        }),
      ]),
    )
    .mutation(async ({ ctx, input }): Promise<{ url: string; cost: number }> => {
      const db = getDb();
      const row = await db.query.unitImages.findFirst({ where: eq(unitImages.id, input.imageId) });
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Image not found" });
      const { repo } = await unitContext(row.unitId);
      assertCanEdit(repo, ctx.user);

      let newImageId: number;
      let cost = 0;
      if (input.source === "upload") {
        if (!ALLOWED_MIME.includes(input.mime)) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `That file type isn't accepted — use ${ALLOWED_MIME.map((m) => m.replace("image/", "")).join(", ")}`,
          });
        }
        const bytes = Math.floor((input.data.length * 3) / 4);
        if (bytes > MAX_UPLOAD_BYTES) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `That image is ${(bytes / 1e6).toFixed(1)} MB — the limit is ${MAX_UPLOAD_BYTES / 1e6} MB`,
          });
        }
        newImageId = await storeBytes(input.mime, input.data, ctx.user.id);
      } else {
        const { prices } = await getSettings();
        cost = Math.max(1, Math.ceil(prices.perImageSlide));
        if (ctx.user.tokenBalance < cost) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: `INSUFFICIENT_TOKENS: an image costs ${cost} 🪙, you have ${ctx.user.tokenBalance} 🪙`,
          });
        }
        // No prompt given → write it from the unit itself, so a single press
        // of the regenerate button reseeds a banner that reflects exactly
        // what this unit teaches.
        let subject = input.prompt;
        if (!subject) {
          const unit = await db.query.units.findFirst({ where: eq(units.id, row.unitId) });
          const ls = await db
            .select({ title: lessons.title })
            .from(lessons)
            .where(eq(lessons.unitId, row.unitId))
            .orderBy(asc(lessons.orderIndex));
          subject =
            `An advertising banner promoting the unit "${unit?.title ?? repo.title}" from "${repo.title}".` +
            (ls.length > 0 ? ` It covers: ${ls.slice(0, 6).map((l) => l.title).join("; ")}.` : "");
        }
        const url = await generateImage({
          userId: ctx.user.id,
          prompt: `${subject}\n\n${UNIT_BANNER_DIRECTIVE}`,
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
        await applyTokenDelta(ctx.user.id, -cost, `unit image redraw: ${subject.slice(0, 55)}`);
        newImageId = await storeBytes(m[1], m[2], ctx.user.id);
      }
      // Old bytes stay in slideImages — same reasoning as remove.
      await db.update(unitImages).set({ imageId: newImageId }).where(eq(unitImages.id, input.imageId));
      return { url: `${IMAGE_URL_PREFIX}${newImageId}`, cost };
    }),

  remove: authedProcedure
    .input(z.object({ imageId: z.number().int() }))
    .mutation(async ({ ctx, input }): Promise<{ ok: true }> => {
      const db = getDb();
      const row = await db.query.unitImages.findFirst({ where: eq(unitImages.id, input.imageId) });
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Image not found" });
      const { repo } = await unitContext(row.unitId);
      assertCanEdit(repo, ctx.user);
      await db.delete(unitImages).where(eq(unitImages.id, input.imageId));
      // The bytes stay in slideImages: a deck snapshot may reference the same
      // row, and orphan cleanup is a separate job from removing a placement.
      return { ok: true as const };
    }),

  setCaption: authedProcedure
    .input(z.object({ imageId: z.number().int(), caption: z.string().max(300) }))
    .mutation(async ({ ctx, input }): Promise<{ ok: true }> => {
      const db = getDb();
      const row = await db.query.unitImages.findFirst({ where: eq(unitImages.id, input.imageId) });
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Image not found" });
      const { repo } = await unitContext(row.unitId);
      assertCanEdit(repo, ctx.user);
      await db
        .update(unitImages)
        .set({ caption: input.caption.trim() || null })
        .where(eq(unitImages.id, input.imageId));
      return { ok: true as const };
    }),

  /**
   * Move one item one place up or down among everything in the unit.
   *
   * Written as "move this one" rather than "here is the new order" because the
   * buttons are per-item: sending a whole list from the client would race with
   * anyone else editing the unit, and would silently rewrite positions the
   * client had not seen. This reads the current sequence, swaps with the
   * neighbour, and touches only those two rows — whichever table each lives in.
   */
  move: authedProcedure
    .input(
      z.object({
        unitId: z.number().int(),
        kind: z.enum(["lesson", "image"]),
        id: z.number().int(),
        direction: z.enum(["up", "down"]),
      }),
    )
    .mutation(async ({ ctx, input }): Promise<{ moved: boolean }> => {
      const db = getDb();
      const { repo, unitId } = await unitContext(input.unitId);
      assertCanEdit(repo, ctx.user);

      // Only top-level lessons take part: a sub-lesson is positioned inside its
      // parent, so mixing it into the unit's sequence would move it out of it.
      const lessonRows = await db
        .select({ id: lessons.id, orderIndex: lessons.orderIndex, parentLessonId: lessons.parentLessonId })
        .from(lessons)
        .where(eq(lessons.unitId, unitId))
        .orderBy(asc(lessons.orderIndex));
      const imageRows = await db
        .select({ id: unitImages.id, orderIndex: unitImages.orderIndex })
        .from(unitImages)
        .where(eq(unitImages.unitId, unitId))
        .orderBy(asc(unitImages.orderIndex));

      type Item = { kind: "lesson" | "image"; id: number; orderIndex: number };
      const sequence: Item[] = [
        ...lessonRows
          .filter((l) => l.parentLessonId == null)
          .map((l) => ({ kind: "lesson" as const, id: l.id, orderIndex: l.orderIndex })),
        ...imageRows.map((i) => ({ kind: "image" as const, id: i.id, orderIndex: i.orderIndex })),
      ].sort((a, b) => a.orderIndex - b.orderIndex || a.kind.localeCompare(b.kind));

      const at = sequence.findIndex((s) => s.kind === input.kind && s.id === input.id);
      if (at === -1) throw new TRPCError({ code: "NOT_FOUND", message: "Item not found in this unit" });
      const to = input.direction === "up" ? at - 1 : at + 1;
      // Already at the end it is being asked to move towards — nothing to do,
      // and not an error worth interrupting the author for.
      if (to < 0 || to >= sequence.length) return { moved: false };

      // Renumber the whole sequence after the swap. Positions can start out
      // sharing values (a lesson and an image both added as "3"), so swapping
      // two numbers alone would not always change the visible order.
      [sequence[at], sequence[to]] = [sequence[to], sequence[at]];
      await db.transaction(async (tx) => {
        for (let i = 0; i < sequence.length; i++) {
          const item = sequence[i];
          if (item.kind === "lesson") {
            await tx.update(lessons).set({ orderIndex: i }).where(eq(lessons.id, item.id));
          } else {
            await tx.update(unitImages).set({ orderIndex: i }).where(eq(unitImages.id, item.id));
          }
        }
      });
      return { moved: true };
    }),
});
