import { and, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { getDb } from "./queries/connection.js";
import { tickets, tokenLedger, users } from "../db/schema.js";
import { ticketPrice } from "./cost.js";

/** How many unused tickets a user holds for one repo. */
export async function countAvailable(userId: number, repoId: number): Promise<number> {
  const rows = await getDb()
    .select({ id: tickets.id })
    .from(tickets)
    .where(
      and(eq(tickets.holderId, userId), eq(tickets.repoId, repoId), eq(tickets.consumed, false)),
    );
  return rows.length;
}

/**
 * Spend ONE unused ticket the user holds for this repo. Returns true if a
 * ticket was consumed, false if the user had none. Atomic: the row is claimed
 * inside a transaction so two concurrent generations can't double-spend it.
 */
export async function consumeOne(userId: number, repoId: number): Promise<boolean> {
  const db = getDb();
  return db.transaction(async (tx) => {
    const row = await tx.query.tickets.findFirst({
      where: and(
        eq(tickets.holderId, userId),
        eq(tickets.repoId, repoId),
        eq(tickets.consumed, false),
      ),
    });
    if (!row) return false;
    await tx
      .update(tickets)
      .set({ consumed: true, consumedAt: new Date() })
      .where(eq(tickets.id, row.id));
    return true;
  });
}

/**
 * A moderator gifts `count` tickets to a user for a repo they own, drawn from
 * the moderator's ticket pool. Throws if the pool is too small.
 */
export async function grantToUser(
  moderatorId: number,
  repoId: number,
  holderId: number,
  count: number,
): Promise<{ remaining: number }> {
  const db = getDb();
  return db.transaction(async (tx) => {
    const mod = await tx.query.users.findFirst({ where: eq(users.id, moderatorId) });
    if (!mod) throw new TRPCError({ code: "NOT_FOUND", message: "Moderator not found" });
    if (mod.ticketBalance < count) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: `NOT_ENOUGH_TICKETS: you hold ${mod.ticketBalance} ticket${mod.ticketBalance === 1 ? "" : "s"}, tried to give ${count}. Buy more from the admin.`,
      });
    }
    await tx
      .update(users)
      .set({ ticketBalance: mod.ticketBalance - count })
      .where(eq(users.id, moderatorId));
    await tx.insert(tickets).values(
      Array.from({ length: count }, () => ({
        repoId,
        holderId,
        issuedById: moderatorId,
      })),
    );
    return { remaining: mod.ticketBalance - count };
  });
}

/**
 * The admin sells `count` tickets to a moderator: debits the moderator's
 * credits at the live ticket price and grows their ticket pool. Throws if the
 * moderator can't cover the cost.
 */
export async function sellToModerator(
  moderatorId: number,
  count: number,
): Promise<{ ticketBalance: number; tokenBalance: number; unitPrice: number }> {
  const unitPrice = await ticketPrice();
  const totalCost = unitPrice * count;
  const db = getDb();
  return db.transaction(async (tx) => {
    const mod = await tx.query.users.findFirst({ where: eq(users.id, moderatorId) });
    if (!mod) throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
    if (mod.role !== "moderator" && mod.role !== "admin") {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Only moderators can hold customization tickets",
      });
    }
    const nextTokens = mod.tokenBalance - totalCost;
    if (nextTokens < 0) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: `INSUFFICIENT_TOKENS: ${count} ticket${count === 1 ? "" : "s"} cost ${totalCost} 🪙, this moderator has ${mod.tokenBalance} 🪙`,
      });
    }
    const nextTickets = mod.ticketBalance + count;
    await tx
      .update(users)
      .set({ tokenBalance: nextTokens, ticketBalance: nextTickets })
      .where(eq(users.id, moderatorId));
    await tx.insert(tokenLedger).values({
      userId: moderatorId,
      delta: -totalCost,
      reason: `bought ${count} customization ticket${count === 1 ? "" : "s"} @ ${unitPrice} 🪙`,
      balanceAfter: nextTokens,
    });
    return { ticketBalance: nextTickets, tokenBalance: nextTokens, unitPrice };
  });
}
