import { getDb } from "./queries/connection.js";
import { users, tokenLedger } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

export class InsufficientTokensError extends TRPCError {
  needed: number;
  constructor(balance: number, needed: number) {
    super({
      code: "FORBIDDEN",
      message: `INSUFFICIENT_TOKENS: balance ${balance}, needs ${needed}`,
    });
    this.needed = needed;
  }
}

/**
 * Credit (positive delta) or debit (negative delta) tokens with a ledger row,
 * atomically in a transaction. Debits throw InsufficientTokensError when the
 * balance cannot cover them.
 */
export async function applyTokenDelta(
  userId: number,
  delta: number,
  reason: string,
): Promise<number> {
  const db = getDb();
  return db.transaction(async (tx) => {
    const user = await tx.query.users.findFirst({ where: eq(users.id, userId) });
    if (!user) throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
    const next = user.tokenBalance + delta;
    if (next < 0) throw new InsufficientTokensError(user.tokenBalance, -delta);
    // Being a moderator requires available credits. A moderator whose balance
    // runs out is automatically demoted back to a regular user. Admins are
    // never demoted this way.
    const demote = user.role === "moderator" && next <= 0;
    await tx
      .update(users)
      .set({ tokenBalance: next, ...(demote ? { role: "user" as const } : {}) })
      .where(eq(users.id, userId));
    await tx
      .insert(tokenLedger)
      .values({ userId, delta, reason, balanceAfter: next });
    if (demote) {
      console.warn(`[tokens] moderator ${userId} ran out of credits — demoted to user`);
    }
    return next;
  });
}

/** Refund helper — always a credit, never throws on balance. */
export async function refundTokens(userId: number, amount: number, reason: string) {
  if (amount <= 0) return;
  await applyTokenDelta(userId, amount, reason);
}
