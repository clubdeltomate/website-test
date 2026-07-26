import { z } from "zod";
import { desc, eq } from "drizzle-orm";
import { createRouter, publicQuery } from "../middleware.js";
import { authedProcedure } from "../procedures.js";
import { getDb } from "../queries/connection.js";
import { tokenLedger } from "../../db/schema.js";
import { getSettings } from "../settings.js";
import type { TokenLedgerRow } from "../../contracts/types.js";

export const tokensRouter = createRouter({
  /** Current balance + recent ledger entries. */
  balance: authedProcedure
    .input(z.object({ limit: z.number().int().min(1).max(200).default(50) }).optional())
    .query(async ({ ctx, input }) => {
      const rows = await getDb()
        .select()
        .from(tokenLedger)
        .where(eq(tokenLedger.userId, ctx.user.id))
        .orderBy(desc(tokenLedger.createdAt))
        .limit(input?.limit ?? 50);
      const ledger: TokenLedgerRow[] = rows.map((r) => ({
        id: r.id,
        delta: r.delta,
        reason: r.reason,
        balanceAfter: r.balanceAfter,
        createdAt: r.createdAt,
      }));
      return { balance: ctx.user.tokenBalance, ledger };
    }),

  /** Public token packs from settings (Settings › Tokens). */
  packs: publicQuery.query(async () => {
    const settings = await getSettings();
    return { packs: settings.tokenPacks, googleSheetUrl: settings.googleSheetUrl };
  }),
});
