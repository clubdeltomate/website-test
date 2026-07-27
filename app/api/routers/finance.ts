import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { desc, eq } from "drizzle-orm";
import { createRouter } from "../middleware.js";
import { adminProcedure } from "../procedures.js";
import { getDb } from "../queries/connection.js";
import { payments, users } from "../../db/schema.js";
import { applyTokenDelta } from "../tokens.js";
import { getSettings } from "../settings.js";
import {
  estimateUsd,
  getBudgets,
  getPricing,
  getUsage,
  priceForUsage,
  refreshPricingFromWeb,
  saveBudgets,
} from "../finance.js";

/** One receipt = one credited payments row (packId "manual-grant" marks the
 *  grants issued from the Finance desk; sheet-verified purchases keep their
 *  pack ids and show up in the same revenue history). */
async function receiptRow(db: ReturnType<typeof getDb>, p: typeof payments.$inferSelect) {
  const user = await db.query.users.findFirst({ where: eq(users.id, p.userId) });
  const issuer = p.resolvedBy
    ? await db.query.users.findFirst({ where: eq(users.id, p.resolvedBy) })
    : null;
  return {
    receiptNo: p.id,
    userName: user?.name ?? "Deleted user",
    userEmail: user?.email ?? "—",
    tokens: p.packTokens,
    amountCents: p.amountCents,
    note: p.note,
    issuedBy: issuer?.name ?? null,
    isGrant: p.packId === "manual-grant",
    createdAt: p.resolvedAt ?? p.createdAt,
  };
}

export const financeRouter = createRouter({
  /** Everything the Finance page shows, in one query. */
  overview: adminProcedure.query(async () => {
    const db = getDb();
    const [pricing, usageMap, budgets, settings] = await Promise.all([
      getPricing(),
      getUsage(),
      getBudgets(),
      getSettings(),
    ]);

    const usage = Object.values(usageMap).map((u) => {
      const price = priceForUsage(pricing, u);
      return { ...u, priceId: price?.id ?? null, estUsd: estimateUsd(u, price) };
    });

    // Per-provider budget status: spend counted from the budget's baseline
    const providers = Object.entries(budgets).map(([providerId, b]) => {
      let spentUsd = 0;
      for (const u of Object.values(usageMap)) {
        if (u.providerId !== providerId) continue;
        const base = b.baseline[`${u.providerId}|${u.model}`];
        const delta = {
          inputTokens: Math.max(0, u.inputTokens - (base?.inputTokens ?? 0)),
          outputTokens: Math.max(0, u.outputTokens - (base?.outputTokens ?? 0)),
        };
        spentUsd += estimateUsd(delta, priceForUsage(pricing, u));
      }
      return { providerId, amountUsd: b.amountUsd, setAt: b.setAt, spentUsd };
    });

    const credited = await db
      .select()
      .from(payments)
      .where(eq(payments.status, "credited"))
      .orderBy(desc(payments.id));
    const revenueCents = credited.reduce((n, p) => n + p.amountCents, 0);
    const recentReceipts = await Promise.all(credited.slice(0, 12).map((p) => receiptRow(db, p)));

    return {
      pricing,
      usage,
      providers,
      packs: settings.tokenPacks,
      revenueCents,
      recentReceipts,
    };
  }),

  /** Re-fetch model prices from the maintained public feed (LiteLLM). */
  refreshPricing: adminProcedure.mutation(async () => {
    try {
      return await refreshPricingFromWeb();
    } catch (err) {
      throw new TRPCError({
        code: "BAD_GATEWAY",
        message: `Couldn't reach the price feed — ${err instanceof Error ? err.message : "network error"}`,
      });
    }
  }),

  /**
   * Enter what's currently loaded on a provider account. Spend is estimated
   * from this moment on (the current usage totals become the baseline), so
   * the remaining figure can be compared against the provider's own console.
   */
  setBudget: adminProcedure
    .input(
      z.object({
        providerId: z.string().min(1).max(40),
        amountUsd: z.number().min(0).max(1000000).nullable(),
      }),
    )
    .mutation(async ({ input }) => {
      const budgets = await getBudgets();
      if (input.amountUsd == null) {
        delete budgets[input.providerId];
      } else {
        const usage = await getUsage();
        const baseline: Record<string, { inputTokens: number; outputTokens: number }> = {};
        for (const [key, u] of Object.entries(usage)) {
          if (u.providerId === input.providerId) {
            baseline[key] = { inputTokens: u.inputTokens, outputTokens: u.outputTokens };
          }
        }
        budgets[input.providerId] = {
          amountUsd: input.amountUsd,
          setAt: new Date().toISOString(),
          baseline,
        };
      }
      await saveBudgets(budgets);
      return { ok: true as const };
    }),

  /**
   * Credit coins to a user against a real payment, producing a receipt: the
   * grant is recorded as a credited payments row (the revenue ledger) AND a
   * token-ledger credit, then returned for printing.
   */
  grantTokens: adminProcedure
    .input(
      z.object({
        userId: z.number().int(),
        tokens: z.number().int().min(1).max(100000),
        amountCents: z.number().int().min(0).max(1000000),
        note: z.string().max(500).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const user = await db.query.users.findFirst({ where: eq(users.id, input.userId) });
      if (!user) throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
      const [row] = await db
        .insert(payments)
        .values({
          userId: input.userId,
          packId: "manual-grant",
          packTokens: input.tokens,
          amountCents: input.amountCents,
          note: input.note ?? null,
          status: "credited",
          resolvedBy: ctx.user.id,
          resolvedAt: new Date(),
        })
        .returning();
      await applyTokenDelta(
        input.userId,
        input.tokens,
        `token purchase — receipt #${row.id} (issued by ${ctx.user.email})`,
      );
      return receiptRow(db, row);
    }),

  /** One past receipt, for re-printing from the history list. */
  receipt: adminProcedure
    .input(z.object({ receiptNo: z.number().int() }))
    .query(async ({ input }) => {
      const db = getDb();
      const row = await db.query.payments.findFirst({ where: eq(payments.id, input.receiptNo) });
      if (!row || row.status !== "credited") {
        throw new TRPCError({ code: "NOT_FOUND", message: "Receipt not found" });
      }
      return receiptRow(db, row);
    }),
});
