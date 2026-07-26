import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { createRouter, publicQuery } from "../middleware.js";
import { authedProcedure } from "../procedures.js";
import { getDb } from "../queries/connection.js";
import { orders, repos } from "../../db/schema.js";
import type { OrderLead } from "../../contracts/types.js";

/**
 * Leads from commercial (menu/service/shop) presentations: a viewer taps
 * "I'm interested" at the end of a showcase and the repo owner gets a lead.
 * No payment — just a signal + the viewer's note, so the seller can follow up.
 */
export const ordersRouter = createRouter({
  /** Record interest from a showcase's finish screen (viewer may be a guest). */
  create: publicQuery
    .input(
      z.object({
        repoSlug: z.string().min(1),
        lessonSeq: z.number().int().optional(),
        itemTitle: z.string().max(255).optional(),
        buyerName: z.string().max(255).optional(),
        note: z.string().max(1000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }): Promise<{ ok: true }> => {
      const db = getDb();
      const repo = await db.query.repos.findFirst({ where: eq(repos.slug, input.repoSlug) });
      if (!repo) return { ok: true }; // silently ignore unknown repos
      await db.insert(orders).values({
        repoId: repo.id,
        ownerId: repo.ownerId ?? null,
        buyerUserId: ctx.user?.id ?? null,
        buyerName: input.buyerName?.trim() || ctx.user?.name || "Guest",
        itemTitle: input.itemTitle?.slice(0, 255) ?? null,
        note: input.note?.slice(0, 1000) ?? null,
      });
      return { ok: true };
    }),

  /** Leads for the signed-in owner, newest first. */
  listMine: authedProcedure
    .input(z.object({ limit: z.number().int().min(1).max(100).default(50) }).optional())
    .query(async ({ ctx, input }): Promise<OrderLead[]> => {
      const db = getDb();
      const rows = await db
        .select()
        .from(orders)
        .where(eq(orders.ownerId, ctx.user.id))
        .orderBy(desc(orders.createdAt))
        .limit(input?.limit ?? 50);
      const repoRows = await db.select().from(repos).where(eq(repos.ownerId, ctx.user.id));
      const slugById = new Map(repoRows.map((r) => [r.id, r.slug]));
      return rows.map((o) => ({
        id: o.id,
        repoSlug: slugById.get(o.repoId) ?? null,
        itemTitle: o.itemTitle,
        buyerName: o.buyerName,
        note: o.note,
        seen: o.seen,
        createdAt: o.createdAt,
      }));
    }),

  /** Count of unseen leads (for a nav badge). */
  unseenCount: authedProcedure.query(async ({ ctx }): Promise<number> => {
    const db = getDb();
    const rows = await db
      .select({ id: orders.id })
      .from(orders)
      .where(and(eq(orders.ownerId, ctx.user.id), eq(orders.seen, false)));
    return rows.length;
  }),

  /** Mark all of the owner's leads as seen. */
  markAllSeen: authedProcedure.mutation(async ({ ctx }): Promise<{ ok: true }> => {
    const db = getDb();
    await db.update(orders).set({ seen: true }).where(eq(orders.ownerId, ctx.user.id));
    return { ok: true };
  }),
});
