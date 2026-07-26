import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, eq, like, or, desc } from "drizzle-orm";
import { createRouter, publicQuery } from "../middleware.js";
import { authedProcedure } from "../procedures.js";
import { getDb } from "../queries/connection.js";
import { favorites, runs, slideTools, users, type SlideTool, type User } from "../../db/schema.js";
import { imageStyleSchema, levelSchema, slugify, templateSchema } from "../ai/prompts.js";
import { TONES, repoPurpose } from "../../contracts/types.js";
import type { RepoTemplate, SlideDeck, SlideToolSummary, Tone } from "../../contracts/types.js";

const toneSchema = z.string().refine((t) => (TONES as string[]).includes(t), "unknown tone");

export async function toSummary(tool: SlideTool, userId: number | undefined): Promise<SlideToolSummary> {
  const db = getDb();
  const toolRuns = await db.select({ id: runs.id }).from(runs).where(eq(runs.slideToolId, tool.id));
  let favorite = false;
  if (userId) {
    const fav = await db.query.favorites.findFirst({
      where: and(
        eq(favorites.userId, userId),
        eq(favorites.targetType, "slideTool"),
        eq(favorites.targetSlug, tool.slug),
      ),
    });
    favorite = !!fav;
  }
  let ownerName: string | null = null;
  if (tool.ownerId) {
    const owner = await db.query.users.findFirst({ where: eq(users.id, tool.ownerId) });
    ownerName = owner?.name ?? null;
  }
  return {
    slug: tool.slug,
    name: tool.name,
    description: tool.description,
    topic: tool.topic,
    instructions: tool.instructions,
    defaultLevel: tool.defaultLevel,
    defaultSlideCount: tool.defaultSlideCount,
    defaultImageStyle: tool.defaultImageStyle,
    template: (tool.template ?? "course") as RepoTemplate,
    defaultTone: ((tool.defaultTone as Tone) ?? "neutral") as Tone,
    source: tool.source === "human" ? "human" : "ai",
    hasDeck: tool.deckJson != null,
    deckSlideCount:
      tool.deckJson != null && Array.isArray((tool.deckJson as SlideDeck).slides)
        ? (tool.deckJson as SlideDeck).slides.length
        : null,
    isPublic: tool.isPublic,
    favorite,
    runCount: toolRuns.length,
    ownerName,
    createdAt: tool.createdAt,
  };
}

function canEdit(tool: SlideTool, user: User) {
  return tool.ownerId === user.id || user.role === "admin";
}

export const slideToolsRouter = createRouter({
  list: publicQuery
    .input(
      z
        .object({
          q: z.string().max(200).optional(),
          limit: z.number().int().min(1).max(100).default(50),
          /** only the signed-in user's own tools (personal shelf) */
          mine: z.boolean().default(false),
        })
        .optional(),
    )
    .query(async ({ ctx, input }): Promise<SlideToolSummary[]> => {
      const db = getDb();
      if (input?.mine && !ctx.user) return []; // a guest owns nothing
      const conds = [];
      if (input?.mine && ctx.user) conds.push(eq(slideTools.ownerId, ctx.user.id));
      if (!ctx.user || ctx.user.role === "user") conds.push(eq(slideTools.isPublic, true));
      if (input?.q) {
        const q = `%${input.q}%`;
        conds.push(or(like(slideTools.name, q), like(slideTools.description, q), like(slideTools.topic, q))!);
      }
      const rows = await db
        .select()
        .from(slideTools)
        .where(conds.length ? and(...conds) : undefined)
        .orderBy(desc(slideTools.createdAt))
        .limit(input?.limit ?? 50);
      const summaries = await Promise.all(rows.map((t) => toSummary(t, ctx.user?.id)));
      // Drafts (no deck generated, never played) are private to their owner:
      // everyone else browsing the gallery only sees finished, playable tools.
      // Admins keep full visibility for moderation.
      const visible = summaries.filter((s, i) => {
        const isDraft = !s.hasDeck && s.runCount === 0;
        if (!isDraft) return true;
        return !!ctx.user && (rows[i].ownerId === ctx.user.id || ctx.user.role === "admin");
      });
      return visible.sort((a, b) => Number(b.favorite) - Number(a.favorite));
    }),

  getBySlug: publicQuery
    .input(z.object({ slug: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const db = getDb();
      const tool = await db.query.slideTools.findFirst({ where: eq(slideTools.slug, input.slug) });
      if (!tool) throw new TRPCError({ code: "NOT_FOUND", message: "Slide tool not found" });
      if (!tool.isPublic && (!ctx.user || !canEdit(tool, ctx.user))) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Slide tool not found" });
      }
      return toSummary(tool, ctx.user?.id);
    }),

  create: authedProcedure
    .input(
      z.object({
        name: z.string().min(3).max(255),
        description: z.string().max(4000).default(""),
        topic: z.string().max(2000).default(""),
        instructions: z.string().max(4000).default(""),
        defaultLevel: levelSchema.default("A1"),
        defaultSlideCount: z.number().int().min(1).max(15).default(8),
        defaultImageStyle: imageStyleSchema.default("sketch"),
        defaultTone: toneSchema.default("neutral"),
        template: templateSchema.default("course"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const base = slugify(input.name);
      let slug = base;
      for (let i = 2; await db.query.slideTools.findFirst({ where: eq(slideTools.slug, slug) }); i++) {
        slug = `${base}-${i}`;
      }
      await db.insert(slideTools).values({ ...input, slug, ownerId: ctx.user.id, isPublic: true });
      return { slug };
    }),

  /**
   * Create a HAND-BUILT presentation (source = "human"). Stores the deck the
   * user built by hand; its card plays directly with no AI generation.
   */
  createManual: authedProcedure
    .input(
      z.object({
        name: z.string().min(3).max(255),
        description: z.string().max(4000).default(""),
        deck: z.unknown(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const base = slugify(input.name);
      let slug = base;
      for (let i = 2; await db.query.slideTools.findFirst({ where: eq(slideTools.slug, slug) }); i++) {
        slug = `${base}-${i}`;
      }
      const deck = input.deck as SlideDeck;
      await db.insert(slideTools).values({
        slug,
        name: input.name,
        description: input.description,
        topic: deck?.topic ?? input.name,
        instructions: "",
        ownerId: ctx.user.id,
        isPublic: true,
        source: "human",
        deckJson: deck,
        defaultLevel: deck?.level ?? "B1",
        defaultImageStyle: deck?.imageStyle ?? "none",
      });
      return { slug };
    }),

  /**
   * Owner/admin saves the hand-built deck for a tool. Source is NOT changed on
   * edit — a thing is "human" only if it was HAND-BUILT from scratch (see
   * createManual); merely editing an AI deck keeps it "ai".
   */
  saveDeck: authedProcedure
    .input(z.object({ slug: z.string().min(1), deck: z.unknown() }))
    .mutation(async ({ ctx, input }): Promise<{ ok: true }> => {
      const db = getDb();
      const tool = await db.query.slideTools.findFirst({ where: eq(slideTools.slug, input.slug) });
      if (!tool) throw new TRPCError({ code: "NOT_FOUND", message: "Slide tool not found" });
      if (!canEdit(tool, ctx.user)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only the owner can edit this presentation" });
      }
      await db
        .update(slideTools)
        .set({ deckJson: input.deck as SlideDeck, updatedAt: new Date() })
        .where(eq(slideTools.id, tool.id));
      return { ok: true };
    }),

  /**
   * Load a tool's saved deck to play it (no generation, no charge) — a
   * hand-built presentation or a saved AI generation. Resolves the tool's
   * purpose (from its category) + owner so the player ends on the right screen:
   * commercial → contact, walkthrough/news → author-profile/back.
   */
  deck: publicQuery
    .input(z.object({ slug: z.string().min(1) }))
    .query(
      async ({
        ctx,
        input,
      }): Promise<{
        deck: SlideDeck;
        name: string;
        commercial: import("../../contracts/types.js").CommercialInfo | null;
        walkthrough: import("../../contracts/types.js").WalkthroughInfo | null;
      } | null> => {
        const db = getDb();
        const tool = await db.query.slideTools.findFirst({ where: eq(slideTools.slug, input.slug) });
        if (!tool || tool.deckJson == null) return null;
        if (!tool.isPublic && (!ctx.user || !canEdit(tool, ctx.user))) return null;

        const purpose = repoPurpose((tool.template ?? "course") as RepoTemplate);
        let commercial: import("../../contracts/types.js").CommercialInfo | null = null;
        let walkthrough: import("../../contracts/types.js").WalkthroughInfo | null = null;
        if (purpose !== "education" && tool.ownerId) {
          const owner = await db.query.users.findFirst({ where: eq(users.id, tool.ownerId) });
          if (owner && purpose === "commercial") {
            commercial = {
              owner: {
                ownerId: owner.id,
                name: owner.name,
                whatsapp: owner.whatsapp ?? null,
                socials: Array.isArray(owner.socials) ? (owner.socials as string[]) : [],
                contactNote: owner.contactNote ?? null,
              },
              itemTitle: tool.name,
              repoSlug: null,
              lessonSeq: null,
            };
          } else if (purpose === "walkthrough" || purpose === "news") {
            walkthrough = {
              ownerId: owner?.id ?? null,
              ownerName: owner?.name ?? "",
              itemTitle: tool.name,
              kind: purpose === "news" ? "news" : "walkthrough",
            };
          }
        }
        return { deck: tool.deckJson as SlideDeck, name: tool.name, commercial, walkthrough };
      },
    ),

  update: authedProcedure
    .input(
      z.object({
        slug: z.string().min(1),
        name: z.string().min(3).max(255).optional(),
        description: z.string().max(4000).optional(),
        topic: z.string().max(2000).optional(),
        instructions: z.string().max(4000).optional(),
        defaultLevel: levelSchema.optional(),
        defaultSlideCount: z.number().int().min(1).max(15).optional(),
        defaultImageStyle: imageStyleSchema.optional(),
        defaultTone: toneSchema.optional(),
        template: templateSchema.optional(),
        isPublic: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const tool = await db.query.slideTools.findFirst({ where: eq(slideTools.slug, input.slug) });
      if (!tool) throw new TRPCError({ code: "NOT_FOUND", message: "Slide tool not found" });
      if (!canEdit(tool, ctx.user)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only the owner or an admin can edit" });
      }
      const { slug: _slug, ...set } = input;
      const clean = Object.fromEntries(Object.entries(set).filter(([, v]) => v !== undefined));
      if (Object.keys(clean).length > 0) {
        await db.update(slideTools).set(clean).where(eq(slideTools.id, tool.id));
      }
      return { ok: true as const };
    }),

  delete: authedProcedure
    .input(z.object({ slug: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const tool = await db.query.slideTools.findFirst({ where: eq(slideTools.slug, input.slug) });
      if (!tool) throw new TRPCError({ code: "NOT_FOUND", message: "Slide tool not found" });
      if (!canEdit(tool, ctx.user)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only the owner or an admin can delete" });
      }
      await db.delete(slideTools).where(eq(slideTools.id, tool.id));
      return { ok: true as const };
    }),

  toggleFavorite: authedProcedure
    .input(z.object({ slug: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const existing = await db.query.favorites.findFirst({
        where: and(
          eq(favorites.userId, ctx.user.id),
          eq(favorites.targetType, "slideTool"),
          eq(favorites.targetSlug, input.slug),
        ),
      });
      if (existing) {
        await db.delete(favorites).where(eq(favorites.id, existing.id));
        return { favorite: false };
      }
      await db.insert(favorites).values({
        userId: ctx.user.id,
        targetType: "slideTool",
        targetSlug: input.slug,
      });
      return { favorite: true };
    }),
});
