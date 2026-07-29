import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { desc, eq } from "drizzle-orm";
import { createRouter } from "../middleware.js";
import { authedProcedure, moderatorProcedure } from "../procedures.js";
import { getDb } from "../queries/connection.js";
import { payments, users, type Payment } from "../../db/schema.js";
import { getSettings } from "../settings.js";
import { applyTokenDelta } from "../tokens.js";
import type { PaymentRow } from "../../contracts/types.js";

async function toPaymentRow(db: ReturnType<typeof getDb>, p: Payment): Promise<PaymentRow> {
  const user = await db.query.users.findFirst({ where: eq(users.id, p.userId) });
  return {
    id: p.id,
    userId: p.userId,
    userName: user?.name ?? null,
    userEmail: user?.email ?? null,
    packId: p.packId,
    packTokens: p.packTokens,
    amountCents: p.amountCents,
    note: p.note,
    status: p.status,
    createdAt: p.createdAt,
    resolvedAt: p.resolvedAt,
  };
}

export const paymentsRouter = createRouter({
  /** "I've paid" note → pending row (manual payment flow, design §8). */
  submitPaidNote: authedProcedure
    .input(z.object({ packId: z.string().min(1).max(64), note: z.string().max(2000).default("") }))
    .mutation(async ({ ctx, input }) => {
      const settings = await getSettings();
      const pack = settings.tokenPacks.find((p) => p.id === input.packId);
      if (!pack) throw new TRPCError({ code: "BAD_REQUEST", message: "Unknown token pack" });
      const db = getDb();
      const [{ id }] = await db
        .insert(payments)
        .values({
          userId: ctx.user.id,
          packId: pack.id,
          packTokens: pack.tokens,
          amountCents: pack.priceCents,
          note: input.note,
          status: "pending",
        })
        .returning({ id: payments.id });
      return { id, status: "pending" as const };
    }),

  mine: authedProcedure.query(async ({ ctx }) => {
    const db = getDb();
    const rows = await db
      .select()
      .from(payments)
      .where(eq(payments.userId, ctx.user.id))
      .orderBy(desc(payments.createdAt))
      .limit(50);
    return Promise.all(rows.map((p) => toPaymentRow(db, p)));
  }),

  pending: moderatorProcedure.query(async () => {
    const db = getDb();
    const rows = await db
      .select()
      .from(payments)
      .where(eq(payments.status, "pending"))
      .orderBy(payments.createdAt)
      .limit(200);
    return Promise.all(rows.map((p) => toPaymentRow(db, p)));
  }),

  /** Credit the pack's tokens, ledger entry, status → credited. */
  approve: moderatorProcedure
    .input(z.object({ paymentId: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const payment = await db.query.payments.findFirst({ where: eq(payments.id, input.paymentId) });
      if (!payment) throw new TRPCError({ code: "NOT_FOUND", message: "Payment not found" });
      if (payment.status !== "pending") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Payment already resolved" });
      }
      // Read the role BEFORE crediting, so the promotion can be reported.
      const before = await db.query.users.findFirst({ where: eq(users.id, payment.userId) });
      const wasPlainUser = before?.role === "user";
      const balance = await applyTokenDelta(
        payment.userId,
        payment.packTokens,
        `payment #${payment.id} approved (${payment.packId})`,
      );
      // applyTokenDelta already did the promotion — holding credits is what
      // makes a moderator, whichever path delivered the coins. This only has to
      // REPORT whether it happened, so the caller can say so; doing it again
      // here would be a second write of a role that is already correct.
      const buyer = await db.query.users.findFirst({ where: eq(users.id, payment.userId) });
      const promoted = wasPlainUser && buyer?.role === "moderator";
      await db
        .update(payments)
        .set({ status: "credited", resolvedBy: ctx.user.id, resolvedAt: new Date() })
        .where(eq(payments.id, payment.id));
      return { ok: true as const, balance, promoted };
    }),

  reject: moderatorProcedure
    .input(z.object({ paymentId: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const payment = await db.query.payments.findFirst({ where: eq(payments.id, input.paymentId) });
      if (!payment) throw new TRPCError({ code: "NOT_FOUND", message: "Payment not found" });
      if (payment.status !== "pending") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Payment already resolved" });
      }
      await db
        .update(payments)
        .set({ status: "rejected", resolvedBy: ctx.user.id, resolvedAt: new Date() })
        .where(eq(payments.id, payment.id));
      return { ok: true as const };
    }),
});
