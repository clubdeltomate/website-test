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
 * What a ticket is being spent on. A repo customization names the repo; a
 * slide-tool deck names nothing, because it belongs to no repo.
 */
export type TicketJob = { repoId: number } | { repoId: null };

/**
 * The user's unused tickets, best candidate for this job first.
 *
 * Preference is what keeps the two ticket kinds from cannibalising each other.
 * Customizing repo X spends a ticket issued for X before a general one, so the
 * general ticket stays available for anything. A slide-tool deck spends a
 * general ticket before a repo-scoped one, so a ticket someone was given for a
 * specific repo is the last thing taken for an unrelated deck. Both still fall
 * through to the other kind, because a ticket is a ticket to the person
 * holding it and refusing one they own would be a technicality.
 */
async function spendable(userId: number, job: TicketJob) {
  const rows = await getDb()
    .select({ id: tickets.id, repoId: tickets.repoId })
    .from(tickets)
    .where(and(eq(tickets.holderId, userId), eq(tickets.consumed, false)));
  const rank = (repoId: number | null) =>
    job.repoId === null ? (repoId === null ? 0 : 1) : repoId === job.repoId ? 0 : 1;
  return rows.sort((a, b) => rank(a.repoId) - rank(b.repoId) || a.id - b.id);
}

/** How many tickets the user could spend on this job. */
export async function countSpendable(userId: number, job: TicketJob): Promise<number> {
  return (await spendable(userId, job)).length;
}

/**
 * Spend ONE unused ticket the user can use for this job. Returns true if a
 * ticket was consumed, false if the user had none. Atomic: the row is claimed
 * inside a transaction with a consumed=false guard, so two concurrent
 * generations can't double-spend the same ticket.
 */
export async function consumeOne(userId: number, job: TicketJob): Promise<boolean> {
  const candidates = await spendable(userId, job);
  const db = getDb();
  for (const candidate of candidates) {
    const claimed = await db.transaction(async (tx) => {
      const rows = await tx
        .update(tickets)
        .set({ consumed: true, consumedAt: new Date() })
        .where(and(eq(tickets.id, candidate.id), eq(tickets.consumed, false)))
        .returning({ id: tickets.id });
      return rows.length > 0;
    });
    if (claimed) return true;
  }
  return false;
}

/**
 * A moderator gifts `count` tickets to a user, drawn from the moderator's
 * ticket pool. `repoId` scopes them to one repo; null issues general tickets
 * the holder can spend on the slide tool. Throws if the pool is too small.
 */
export async function grantToUser(
  moderatorId: number,
  repoId: number | null,
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

/**
 * Add tickets to someone's pool without charging for them — the admin handing
 * tickets over rather than selling them. Deliberately separate from
 * sellToModerator: that one debits coins and writes a coin-ledger row, and a
 * free grant must not pretend money moved.
 */
export async function grantFreeTickets(
  userId: number,
  count: number,
): Promise<{ ticketBalance: number; userName: string }> {
  const db = getDb();
  return db.transaction(async (tx) => {
    const target = await tx.query.users.findFirst({ where: eq(users.id, userId) });
    if (!target) throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
    if (target.role !== "moderator" && target.role !== "admin") {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Only moderators hold customization tickets — credit ${target.name} some coins first and they become one`,
      });
    }
    const next = target.ticketBalance + count;
    await tx.update(users).set({ ticketBalance: next }).where(eq(users.id, userId));
    return { ticketBalance: next, userName: target.name };
  });
}

/**
 * Move tickets from one holder to another. Moderators trade among themselves;
 * the sender must actually have them, checked inside the transaction so two
 * simultaneous sends cannot both pass on the same last ticket.
 */
export async function transferTickets(
  fromUserId: number,
  toUserId: number,
  count: number,
): Promise<{ senderBalance: number; recipientName: string }> {
  if (fromUserId === toUserId) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "That is your own profile" });
  }
  const db = getDb();
  return db.transaction(async (tx) => {
    const from = await tx.query.users.findFirst({ where: eq(users.id, fromUserId) });
    const to = await tx.query.users.findFirst({ where: eq(users.id, toUserId) });
    if (!from || !to) throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
    if (to.role !== "moderator" && to.role !== "admin") {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Only moderators hold customization tickets — ${to.name} is not one yet`,
      });
    }
    if (from.ticketBalance < count) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: `You hold ${from.ticketBalance} ticket${from.ticketBalance === 1 ? "" : "s"} — not enough to send ${count}`,
      });
    }
    await tx
      .update(users)
      .set({ ticketBalance: from.ticketBalance - count })
      .where(eq(users.id, fromUserId));
    await tx
      .update(users)
      .set({ ticketBalance: to.ticketBalance + count })
      .where(eq(users.id, toUserId));
    return { senderBalance: from.ticketBalance - count, recipientName: to.name };
  });
}
