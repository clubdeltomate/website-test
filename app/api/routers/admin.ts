import { z } from "zod";
import { desc, eq, gte } from "drizzle-orm";
import { createRouter } from "../middleware.js";
import { adminProcedure, moderatorProcedure } from "../procedures.js";
import { getDb } from "../queries/connection.js";
import { payments, repos, runs, slideTools, tokenLedger, users } from "../../db/schema.js";
import { getSettings, saveSettings } from "../settings.js";
import { diagnoseTextProviders } from "../ai/provider.js";
import { readGenerationTrace } from "../generation-trace.js";
import type { AdminDashboard, AiProvider, AppSettings, RunRow } from "../../contracts/types.js";

const settingsSchema = z.object({
  tokenPacks: z
    .array(
      z.object({
        id: z.string().min(1).max(64),
        tokens: z.number().int().min(1),
        priceCents: z.number().int().min(0),
        label: z.string().min(1).max(255),
      }),
    )
    .min(1),
  prices: z.object({
    perSlideBase: z.number().min(0),
    perImageSlide: z.number().min(0),
    perTts: z.number().min(0),
    levelMultiplier: z.object({
      A0: z.number().min(0),
      A1: z.number().min(0),
      A2: z.number().min(0),
      B1: z.number().min(0),
      B2: z.number().min(0),
      C1: z.number().min(0),
      C2: z.number().min(0),
    }),
    // carried through so a Platform-page save never drops the Finance-set
    // ticket price (null/absent = automatic pricing)
    ticketPriceOverride: z.number().int().min(1).max(1000000).nullable().optional(),
  }),
  googleSheetUrl: z.string().max(500),
  platformAiKeys: z.object({
    text: z
      .object({
        provider: z.enum(["openai", "anthropic", "gemini", "elevenlabs"]),
        apiKey: z.string().max(512),
        baseUrl: z.string().max(500).optional(),
      })
      .optional(),
    image: z
      .object({
        provider: z.enum(["openai", "anthropic", "gemini", "elevenlabs"]),
        apiKey: z.string().max(512),
        baseUrl: z.string().max(500).optional(),
      })
      .optional(),
    tts: z
      .object({
        provider: z.enum(["openai", "anthropic", "gemini", "elevenlabs"]),
        apiKey: z.string().max(512),
        baseUrl: z.string().max(500).optional(),
      })
      .optional(),
  }),
  featureFlags: z.object({ coachEnabled: z.boolean(), guestDemo: z.boolean() }).catchall(z.boolean()),
});

/** Mask platform keys so getSettings never leaks full secrets to the client. */
function maskedSettings(s: AppSettings): AppSettings {
  const mask = (k?: { provider: AiProvider; apiKey: string; baseUrl?: string }) =>
    k && k.apiKey
      ? { ...k, apiKey: `${k.apiKey.slice(0, 6)}…${k.apiKey.slice(-4)}` }
      : k;
  return {
    ...s,
    platformAiKeys: {
      text: mask(s.platformAiKeys.text),
      image: mask(s.platformAiKeys.image),
      tts: mask(s.platformAiKeys.tts),
    },
  };
}

export const adminRouter = createRouter({
  dashboard: moderatorProcedure.query(async (): Promise<AdminDashboard> => {
    const db = getDb();
    const [allUsers, allRepos, allTools, allRuns, ledgerRows, pendingRows] = await Promise.all([
      db.select({ id: users.id }).from(users),
      db.select({ id: repos.id }).from(repos),
      db.select({ id: slideTools.id }).from(slideTools),
      db.select().from(runs).orderBy(desc(runs.completedAt)).limit(10),
      db.select().from(tokenLedger).where(gte(tokenLedger.createdAt, new Date(Date.now() - 30 * 86400_000))),
      db.select().from(payments).where(eq(payments.status, "pending")),
    ]);
    const allRunIds = await db.select({ id: runs.id, flagged: runs.flagged }).from(runs);
    const positiveLedger = await db.select({ delta: tokenLedger.delta }).from(tokenLedger);
    const tokensIssued = positiveLedger.filter((l) => l.delta > 0).reduce((n, l) => n + l.delta, 0);

    // tokens over time: sum ledger deltas per day (last 30 days)
    const byDay = new Map<string, number>();
    for (const l of ledgerRows) {
      const day = l.createdAt.toISOString().slice(0, 10);
      byDay.set(day, (byDay.get(day) ?? 0) + l.delta);
    }
    const tokensOverTime = [...byDay.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, delta]) => ({ date, delta }));

    const recentRuns: RunRow[] = [];
    for (const r of allRuns) {
      const tool = await db.query.slideTools.findFirst({ where: eq(slideTools.id, r.slideToolId) });
      recentRuns.push({
        id: r.id,
        toolSlug: tool?.slug ?? "unknown",
        toolName: tool?.name ?? "Unknown tool",
        repoSlug: null,
        repoRef: null,
        lessonTitle: null,
        playerName: r.playerName,
        level: r.level,
        imageStyle: r.imageStyle,
        slideCount: r.slideCount,
        scoreCorrect: r.scoreCorrect,
        scoreTotal: r.scoreTotal,
        elapsedSec: r.elapsedSec,
        flagged: r.flagged,
        completedAt: r.completedAt,
      });
    }

    return {
      totals: {
        users: allUsers.length,
        repos: allRepos.length,
        slideTools: allTools.length,
        runs: allRunIds.length,
        tokensIssued,
        pendingPayments: pendingRows.length,
        flaggedRuns: allRunIds.filter((r) => r.flagged).length,
      },
      recentRuns,
      tokensOverTime,
      pendingPayments: await Promise.all(
        pendingRows.slice(0, 20).map(async (p) => {
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
        }),
      ),
    };
  }),

  /** Settings — platform keys are masked in the response. */
  /**
   * Ping every text provider the server would actually use, in the order it
   * would use them. Answers "generation says no AI provider produced content
   * — which one is broken?" without needing hosting logs.
   */
  aiStatus: adminProcedure.mutation(async ({ ctx }) => {
    const results = await diagnoseTextProviders(ctx.user.id);
    return { results, checkedAt: new Date() };
  }),

  /**
   * The phase-by-phase record of the most recent slide generation, written to
   * the database as it ran. If the invocation was killed, the last phase here
   * is the step that never returned.
   */
  lastGenerationTrace: adminProcedure.query(async () => {
    return { trace: await readGenerationTrace() };
  }),

  getSettings: adminProcedure.query(async () => {
    return maskedSettings(await getSettings());
  }),

  /**
   * Update settings (admin only). A masked platform key value (contains "…")
   * means "keep the stored key" — it is not overwritten.
   */
  updateSettings: adminProcedure
    .input(settingsSchema)
    .mutation(async ({ input }) => {
      const current = await getSettings();
      const merged: AppSettings = {
        tokenPacks: input.tokenPacks,
        prices: input.prices,
        googleSheetUrl: input.googleSheetUrl,
        featureFlags: input.featureFlags,
        platformAiKeys: { ...input.platformAiKeys },
      };
      for (const cap of ["text", "image", "tts"] as const) {
        const nextKey = input.platformAiKeys[cap];
        if (nextKey && nextKey.apiKey.includes("…")) {
          const kept = current.platformAiKeys[cap];
          if (kept) merged.platformAiKeys[cap] = { ...nextKey, apiKey: kept.apiKey };
        }
      }
      await saveSettings(merged);
      return { ok: true as const };
    }),
});
