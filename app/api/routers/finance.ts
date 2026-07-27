import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { desc, eq, sql } from "drizzle-orm";
import { createRouter } from "../middleware.js";
import { adminProcedure } from "../procedures.js";
import { getDb } from "../queries/connection.js";
import { payments, tokenLedger, users } from "../../db/schema.js";
import { applyTokenDelta } from "../tokens.js";
import { getSettings } from "../settings.js";
import { ticketPrice } from "../cost.js";
import {
  estimateUsd,
  getPricing,
  getUsage,
  priceForUsage,
  refreshPricingFromWeb,
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
    const [pricing, usageMap, settings, ticketPriceCoins] = await Promise.all([
      getPricing(),
      getUsage(),
      getSettings(),
      ticketPrice(),
    ]);

    const usage = Object.values(usageMap).map((u) => {
      const price = priceForUsage(pricing, u);
      return { ...u, priceId: price?.id ?? null, estUsd: estimateUsd(u, price) };
    });

    // Income: every credited sale, plus revenue grouped by month
    const credited = await db
      .select()
      .from(payments)
      .where(eq(payments.status, "credited"))
      .orderBy(desc(payments.id));
    const revenueCents = credited.reduce((n, p) => n + p.amountCents, 0);
    const purchasedTokens = credited.reduce((n, p) => n + p.packTokens, 0);
    const monthly = new Map<string, number>();
    for (const p of credited) {
      const key = (p.resolvedAt ?? p.createdAt).toISOString().slice(0, 7);
      monthly.set(key, (monthly.get(key) ?? 0) + p.amountCents);
    }
    const monthlyRevenue = [...monthly.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, cents]) => ({ month, cents }));
    const recentReceipts = await Promise.all(credited.slice(0, 12).map((p) => receiptRow(db, p)));

    // What one coin is worth: the real blended sale rate when there are
    // credited sales, else the blend of the configured packs.
    const packs = settings.tokenPacks;
    const packTokens = packs.reduce((n, p) => n + p.tokens, 0);
    const packBlendCents = packTokens > 0 ? packs.reduce((n, p) => n + p.priceCents, 0) / packTokens : 4;
    const centsPerCoin = purchasedTokens > 0 ? revenueCents / purchasedTokens : packBlendCents;

    // Credits ledger, coarse-grained by the reason strings this codebase
    // writes — the accountability view: what entered circulation (and
    // whether money backed it) and what burned out of it.
    const [led] = await db
      .select({
        purchased: sql<string>`COALESCE(SUM(CASE WHEN ${tokenLedger.delta} > 0 AND (${tokenLedger.reason} ILIKE '%receipt%' OR ${tokenLedger.reason} ILIKE 'payment #%') THEN ${tokenLedger.delta} ELSE 0 END), 0)`,
        adminGranted: sql<string>`COALESCE(SUM(CASE WHEN ${tokenLedger.delta} > 0 AND ${tokenLedger.reason} ILIKE 'manual %' THEN ${tokenLedger.delta} ELSE 0 END), 0)`,
        starting: sql<string>`COALESCE(SUM(CASE WHEN ${tokenLedger.delta} > 0 AND ${tokenLedger.reason} ILIKE '%starting balance%' THEN ${tokenLedger.delta} ELSE 0 END), 0)`,
        refunds: sql<string>`COALESCE(SUM(CASE WHEN ${tokenLedger.delta} > 0 AND ${tokenLedger.reason} ILIKE '%refund%' THEN ${tokenLedger.delta} ELSE 0 END), 0)`,
        otherCredits: sql<string>`COALESCE(SUM(CASE WHEN ${tokenLedger.delta} > 0 AND NOT (${tokenLedger.reason} ILIKE '%receipt%' OR ${tokenLedger.reason} ILIKE 'payment #%' OR ${tokenLedger.reason} ILIKE 'manual %' OR ${tokenLedger.reason} ILIKE '%starting balance%' OR ${tokenLedger.reason} ILIKE '%refund%') THEN ${tokenLedger.delta} ELSE 0 END), 0)`,
        spentOnGenerations: sql<string>`COALESCE(SUM(CASE WHEN ${tokenLedger.delta} < 0 AND NOT (${tokenLedger.reason} ILIKE 'manual %' OR ${tokenLedger.reason} ILIKE 'bought %ticket%') THEN -${tokenLedger.delta} ELSE 0 END), 0)`,
        ticketCoins: sql<string>`COALESCE(SUM(CASE WHEN ${tokenLedger.delta} < 0 AND ${tokenLedger.reason} ILIKE 'bought %ticket%' THEN -${tokenLedger.delta} ELSE 0 END), 0)`,
        adminRemoved: sql<string>`COALESCE(SUM(CASE WHEN ${tokenLedger.delta} < 0 AND ${tokenLedger.reason} ILIKE 'manual %' THEN -${tokenLedger.delta} ELSE 0 END), 0)`,
      })
      .from(tokenLedger);
    const ledger = {
      purchased: Number(led.purchased),
      adminGranted: Number(led.adminGranted),
      starting: Number(led.starting),
      refunds: Number(led.refunds),
      otherCredits: Number(led.otherCredits),
      spentOnGenerations: Number(led.spentOnGenerations),
      ticketCoins: Number(led.ticketCoins),
      adminRemoved: Number(led.adminRemoved),
    };

    const [circ] = await db
      .select({ total: sql<string>`COALESCE(SUM(${users.tokenBalance}), 0)` })
      .from(users);

    return {
      pricing,
      usage,
      packs,
      prices: settings.prices,
      ticketPriceCoins,
      centsPerCoin,
      revenueCents,
      purchasedTokens,
      monthlyRevenue,
      recentReceipts,
      circulationTokens: Number(circ.total),
      ledger,
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
