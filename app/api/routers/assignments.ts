import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { createRouter } from "../middleware.js";
import { authedProcedure } from "../procedures.js";
import { getDb } from "../queries/connection.js";
import { assignments, repos, slideTools, users } from "../../db/schema.js";

const targetSchema = z.object({
  targetType: z.enum(["slideTool", "repo"]),
  slug: z.string().min(1),
  userId: z.number().int(),
});

/**
 * Handing a slide tool or repo to a specific user: the item then shows up on
 * the assignee's own shelf, tagged "assigned". A pointer, not a copy — the
 * owner keeps the only editable original, the assignee gets it in reach.
 *
 * Who may hand things over: the item's owner, or a moderator/admin. A plain
 * user can't push their work onto someone else's shelf.
 */
export const assignmentsRouter = createRouter({
  assign: authedProcedure
    .input(targetSchema)
    .mutation(async ({ ctx, input }): Promise<{ ok: true; alreadyAssigned: boolean }> => {
      const db = getDb();
      const target =
        input.targetType === "slideTool"
          ? await db.query.slideTools.findFirst({ where: eq(slideTools.slug, input.slug) })
          : await db.query.repos.findFirst({ where: eq(repos.slug, input.slug) });
      if (!target) throw new TRPCError({ code: "NOT_FOUND", message: "Item not found" });
      const isOwner = target.ownerId === ctx.user.id;
      const isStaff = ctx.user.role === "moderator" || ctx.user.role === "admin";
      if (!isOwner && !isStaff) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only the owner or a moderator can assign this" });
      }
      const assignee = await db.query.users.findFirst({ where: eq(users.id, input.userId) });
      if (!assignee) throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
      if (assignee.id === target.ownerId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "That's the owner — it's already on their shelf" });
      }
      const existing = await db.query.assignments.findFirst({
        where: and(
          eq(assignments.targetType, input.targetType),
          eq(assignments.targetSlug, input.slug),
          eq(assignments.userId, input.userId),
        ),
      });
      if (existing) return { ok: true as const, alreadyAssigned: true };
      await db.insert(assignments).values({
        targetType: input.targetType,
        targetSlug: input.slug,
        userId: input.userId,
        assignedBy: ctx.user.id,
      });
      return { ok: true as const, alreadyAssigned: false };
    }),

  /** The assigner (or staff) can take it back; the assignee can clear their own shelf. */
  unassign: authedProcedure
    .input(targetSchema)
    .mutation(async ({ ctx, input }): Promise<{ ok: true }> => {
      const db = getDb();
      const row = await db.query.assignments.findFirst({
        where: and(
          eq(assignments.targetType, input.targetType),
          eq(assignments.targetSlug, input.slug),
          eq(assignments.userId, input.userId),
        ),
      });
      if (!row) return { ok: true as const };
      const isStaff = ctx.user.role === "moderator" || ctx.user.role === "admin";
      if (row.userId !== ctx.user.id && row.assignedBy !== ctx.user.id && !isStaff) {
        throw new TRPCError({ code: "FORBIDDEN", message: "This assignment isn't yours to remove" });
      }
      await db.delete(assignments).where(eq(assignments.id, row.id));
      return { ok: true as const };
    }),
});

/** Slugs of the given type assigned to this user — shelf queries merge them in. */
export async function assignedSlugs(userId: number, targetType: "slideTool" | "repo"): Promise<string[]> {
  try {
    const rows = await getDb()
      .select({ slug: assignments.targetSlug })
      .from(assignments)
      .where(and(eq(assignments.userId, userId), eq(assignments.targetType, targetType)));
    return rows.map((r) => r.slug);
  } catch (err) {
    console.warn("[assignments] unavailable:", err instanceof Error ? err.message : err);
    return [];
  }
}
