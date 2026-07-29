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
    // Role follows credits, in both directions. Holding credits IS what makes
    // someone a moderator, so any credit promotes and running the balance down
    // to nothing demotes — whichever path moved the coins, since every credit
    // and debit in the app comes through here.
    //
    // Admins are exempt in both directions: an admin who spends their last
    // coin stays an admin, and one is never "promoted" to a lesser role.
    const promote = user.role === "user" && next > 0;
    const demote = user.role === "moderator" && next <= 0;
    const role = promote ? ("moderator" as const) : demote ? ("user" as const) : null;
    await tx
      .update(users)
      .set({ tokenBalance: next, ...(role ? { role } : {}) })
      .where(eq(users.id, userId));
    await tx
      .insert(tokenLedger)
      .values({ userId, delta, reason, balanceAfter: next });
    if (promote) {
      console.info(`[tokens] user ${userId} holds credits — promoted to moderator`);
    }
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
