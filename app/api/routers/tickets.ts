import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, desc, eq } from "drizzle-orm";
import { createRouter } from "../middleware.js";
import { authedProcedure, moderatorProcedure, adminProcedure } from "../procedures.js";
import { getDb } from "../queries/connection.js";
import { repos, ticketRequests, tickets, users } from "../../db/schema.js";
import { ticketPrice } from "../cost.js";
import {
  countAvailable,
  countSpendable,
  grantToUser,
  sellToModerator,
  grantFreeTickets,
  transferTickets,
} from "../tickets.js";
import type { MyTicketGroup, TicketRequestRow } from "../../contracts/types.js";

export const ticketsRouter = createRouter({
  /** Live credit price of one customization ticket. */
  price: authedProcedure.query(async () => ({ price: await ticketPrice() })),

  /**
   * How many tickets the signed-in user can actually SPEND, across every repo
   * plus the general ones. Distinct from users.ticketBalance, which is a
   * moderator's undistributed pool: someone gifted three tickets holds three
   * spendable ones and a pool of zero, so reading the pool told them they had
   * nothing right up until they used one.
   */
  spendable: authedProcedure.query(async ({ ctx }): Promise<{ count: number }> => {
    return { count: await countSpendable(ctx.user.id, { repoId: null }) };
  }),

  /** How many unused tickets the signed-in user holds for one repo. */
  availableFor: authedProcedure
    .input(z.object({ repoSlug: z.string() }))
    .query(async ({ ctx, input }): Promise<{ count: number }> => {
      const db = getDb();
      const repo = await db.query.repos.findFirst({ where: eq(repos.slug, input.repoSlug) });
      if (!repo) return { count: 0 };
      return { count: await countAvailable(ctx.user.id, repo.id) };
    }),

  /** The signed-in user's unused tickets, grouped by repo. */
  mine: authedProcedure.query(async ({ ctx }): Promise<MyTicketGroup[]> => {
    const db = getDb();
    const rows = await db
      .select()
      .from(tickets)
      .where(and(eq(tickets.holderId, ctx.user.id), eq(tickets.consumed, false)))
      .orderBy(desc(tickets.createdAt));
    // repoId null groups together as the general bucket, listed first — it is
    // the one that works anywhere, so it is the one worth seeing first.
    const byRepo = new Map<number | null, number>();
    for (const t of rows) byRepo.set(t.repoId, (byRepo.get(t.repoId) ?? 0) + 1);
    const out: MyTicketGroup[] = [];
    const general = byRepo.get(null);
    if (general) out.push({ repoSlug: null, repoTitle: "Any slide deck", count: general });
    for (const [repoId, count] of byRepo) {
      if (repoId === null) continue;
      const repo = await db.query.repos.findFirst({ where: eq(repos.id, repoId) });
      if (repo) out.push({ repoSlug: repo.slug, repoTitle: repo.title, count });
    }
    return out;
  }),

  /**
   * A moderator (repo owner) gifts customization tickets to a user for a repo
   * they own. The user is identified by email (what they'd hand the moderator).
   */
  grantToUser: moderatorProcedure
    .input(
      z.object({
        /** Omit to issue GENERAL tickets, spendable on the slide tool. */
        repoSlug: z.string().optional(),
        userEmail: z.string().email(),
        count: z.number().int().min(1).max(50),
      }),
    )
    .mutation(async ({ ctx, input }): Promise<{ ok: true; remaining: number; userName: string }> => {
      const db = getDb();
      let repoId: number | null = null;
      if (input.repoSlug) {
        const repo = await db.query.repos.findFirst({ where: eq(repos.slug, input.repoSlug) });
        if (!repo) throw new TRPCError({ code: "NOT_FOUND", message: "Repository not found" });
        if (repo.ownerId !== ctx.user.id && ctx.user.role !== "admin") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Only the repo's owner can hand out its tickets",
          });
        }
        repoId = repo.id;
      }
      const holder = await db.query.users.findFirst({
        where: eq(users.email, input.userEmail.trim().toLowerCase()),
      });
      if (!holder) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `No user with the email ${input.userEmail} — they need an account first`,
        });
      }
      const { remaining } = await grantToUser(ctx.user.id, repoId, holder.id, input.count);
      return { ok: true as const, remaining, userName: holder.name };
    }),

  /**
   * The admin sells tickets to a moderator (debits the moderator's credits at
   * the live ticket price and grows their ticket pool).
   */
  sellToModerator: adminProcedure
    .input(z.object({ userId: z.number().int(), count: z.number().int().min(1).max(500) }))
    .mutation(async ({ input }) => {
      return sellToModerator(input.userId, input.count);
    }),

  /** The admin hands tickets over for nothing (no coins move). */
  grantFree: adminProcedure
    .input(z.object({ userId: z.number().int(), count: z.number().int().min(1).max(500) }))
    .mutation(async ({ input }) => grantFreeTickets(input.userId, input.count)),

  /** A holder passes tickets to another holder — moderators trading. */
  send: moderatorProcedure
    .input(z.object({ toUserId: z.number().int(), count: z.number().int().min(1).max(500) }))
    .mutation(async ({ ctx, input }) => transferTickets(ctx.user.id, input.toUserId, input.count)),

  /* ------------------------ request (pull) flow ------------------------ */

  /** A user asks a repo's owner for customization tickets. */
  request: authedProcedure
    .input(
      z.object({
        repoSlug: z.string(),
        count: z.number().int().min(1).max(20),
        note: z.string().max(1000).default(""),
      }),
    )
    .mutation(async ({ ctx, input }): Promise<{ ok: true }> => {
      const db = getDb();
      const repo = await db.query.repos.findFirst({ where: eq(repos.slug, input.repoSlug) });
      if (!repo) throw new TRPCError({ code: "NOT_FOUND", message: "Repository not found" });
      if (!repo.ownerId) throw new TRPCError({ code: "BAD_REQUEST", message: "This repo has no owner to ask" });
      if (repo.ownerId === ctx.user.id) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "You own this repo — no ticket needed" });
      }
      await db.insert(ticketRequests).values({
        repoId: repo.id,
        requesterId: ctx.user.id,
        ownerId: repo.ownerId,
        count: input.count,
        note: input.note || null,
      });
      return { ok: true as const };
    }),

  /** The signed-in user's own ticket requests + their status. */
  myRequests: authedProcedure.query(async ({ ctx }): Promise<TicketRequestRow[]> => {
    const db = getDb();
    const rows = await db
      .select()
      .from(ticketRequests)
      .where(eq(ticketRequests.requesterId, ctx.user.id))
      .orderBy(desc(ticketRequests.createdAt))
      .limit(100);
    return Promise.all(rows.map((r) => toRequestRow(db, r, ctx.user.name, ctx.user.email)));
  }),

  /** Pending ticket requests addressed to repos the signed-in user owns. */
  incoming: authedProcedure.query(async ({ ctx }): Promise<TicketRequestRow[]> => {
    const db = getDb();
    const rows = await db
      .select()
      .from(ticketRequests)
      .where(and(eq(ticketRequests.ownerId, ctx.user.id), eq(ticketRequests.status, "pending")))
      .orderBy(desc(ticketRequests.createdAt))
      .limit(200);
    return Promise.all(rows.map((r) => toRequestRow(db, r)));
  }),

  /** The repo owner grants or rejects a pending ticket request. */
  resolveRequest: authedProcedure
    .input(z.object({ requestId: z.number().int(), approve: z.boolean() }))
    .mutation(async ({ ctx, input }): Promise<{ ok: true; remaining?: number }> => {
      const db = getDb();
      const req = await db.query.ticketRequests.findFirst({
        where: eq(ticketRequests.id, input.requestId),
      });
      if (!req) throw new TRPCError({ code: "NOT_FOUND", message: "Request not found" });
      if (req.ownerId !== ctx.user.id && ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only the repo's owner can resolve this" });
      }
      if (req.status !== "pending") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Request already resolved" });
      }
      if (!input.approve) {
        await db
          .update(ticketRequests)
          .set({ status: "rejected", resolvedAt: new Date() })
          .where(eq(ticketRequests.id, req.id));
        return { ok: true as const };
      }
      // grant draws from the owner's pool (throws if too small)
      const { remaining } = await grantToUser(ctx.user.id, req.repoId, req.requesterId, req.count);
      await db
        .update(ticketRequests)
        .set({ status: "credited", resolvedAt: new Date() })
        .where(eq(ticketRequests.id, req.id));
      return { ok: true as const, remaining };
    }),
});

async function toRequestRow(
  db: ReturnType<typeof getDb>,
  r: typeof ticketRequests.$inferSelect,
  requesterName?: string,
  requesterEmail?: string,
): Promise<TicketRequestRow> {
  const repo = await db.query.repos.findFirst({ where: eq(repos.id, r.repoId) });
  let name = requesterName;
  let email = requesterEmail;
  if (!name || !email) {
    const u = await db.query.users.findFirst({ where: eq(users.id, r.requesterId) });
    name = u?.name ?? "Unknown";
    email = u?.email ?? "";
  }
  return {
    id: r.id,
    repoSlug: repo?.slug ?? "",
    repoTitle: repo?.title ?? "(deleted repo)",
    requesterName: name,
    requesterEmail: email,
    count: r.count,
    note: r.note,
    status: r.status,
    createdAt: r.createdAt,
  };
}
