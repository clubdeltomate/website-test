import { sql } from "drizzle-orm";
import { createRouter, publicQuery } from "./middleware.js";
import { env } from "./lib/env.js";
import { getDb } from "./queries/connection.js";
import { authRouter } from "./routers/auth.js";
import { generateRouter, coachChatProcedure } from "./routers/generate.js";
import { reposRouter } from "./routers/repos.js";
import { slideToolsRouter } from "./routers/slideTools.js";
import { runsRouter } from "./routers/runs.js";
import { lessonsRouter, unitsRouter } from "./routers/lessons.js";
import { unitImagesRouter } from "./routers/unitImages.js";
import { assignmentsRouter } from "./routers/assignments.js";
import { keysRouter } from "./routers/keys.js";
import { tokensRouter } from "./routers/tokens.js";
import { paymentsRouter } from "./routers/payments.js";
import { usersRouter } from "./routers/users.js";
import { adminRouter } from "./routers/admin.js";
import { financeRouter } from "./routers/finance.js";
import { templatesRouter } from "./routers/templates.js";
import { ordersRouter } from "./routers/orders.js";
import { ticketsRouter } from "./routers/tickets.js";
import { ttsRouter } from "./routers/tts.js";

export const appRouter = createRouter({
  ping: publicQuery.query(() => ({ ok: true, ts: Date.now() })),

  // Deployment diagnostics — open /api/trpc/health in a browser. Tells you
  // whether the running function can see DATABASE_URL and reach the database,
  // without leaking any secret (the connection string itself is never returned).
  health: publicQuery.query(async () => {
    const hasDatabaseUrl = !!env.databaseUrl;
    let db: "ok" | "error" = "error";
    let dbHost: string | null = null;
    let dbName: string | null = null;
    let dbSslMode: string | null = null;
    if (hasDatabaseUrl) {
      try {
        const parsed = new URL(env.databaseUrl);
        dbHost = parsed.hostname || null;
        dbName = parsed.pathname?.replace(/^\//, "") || null;
        dbSslMode = parsed.searchParams.get("sslmode");
      } catch {
        dbHost = "invalid-url";
      }
    }
    if (hasDatabaseUrl) {
      try {
        await getDb().execute(sql`select 1`);
        db = "ok";
      } catch {
        db = "error";
      }
    }
    return { ok: true, hasDatabaseUrl, db, dbHost, dbName, dbSslMode, node: process.version };
  }),

  auth: authRouter,
  generate: generateRouter,
  coach: createRouter({ chat: coachChatProcedure }),
  repos: reposRouter,
  slideTools: slideToolsRouter,
  runs: runsRouter,
  units: unitsRouter,
  lessons: lessonsRouter,
  unitImages: unitImagesRouter,
  assignments: assignmentsRouter,
  keys: keysRouter,
  tokens: tokensRouter,
  payments: paymentsRouter,
  users: usersRouter,
  admin: adminRouter,
  finance: financeRouter,
  templates: templatesRouter,
  orders: ordersRouter,
  tickets: ticketsRouter,
  tts: ttsRouter,
});

export type AppRouter = typeof appRouter;
