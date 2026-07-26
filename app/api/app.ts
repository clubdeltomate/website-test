import { Hono } from "hono";
import type { HttpBindings } from "@hono/node-server";
import { cors } from "hono/cors";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { sql } from "drizzle-orm";
import { appRouter } from "./router.js";
import { createContext } from "./context.js";
import { getDb } from "./queries/connection.js";
import { ensureCefrLevelEnum } from "./lib/migrate-levels.js";
import {
  ensureRunAnnotationsColumn,
  ensureCommercialSchema,
  ensureTicketSchema,
  ensureUserFavoriteType,
  ensureCustomizationSchema,
  ensureSlideToolAuthoring,
  ensureElevenLabsProvider,
  ensureWalkthroughTemplate,
} from "./lib/migrate-annotations.js";

/**
 * The tRPC/Hono API app, WITHOUT any host bootstrap. Import this from a host
 * entry: `boot.ts` runs it as a long-lived Node server (self-hosted), and
 * `server.ts` wraps it as a Vercel serverless function. Keeping the app free of
 * `serve()`/static-file side effects means importing it never starts a server.
 */

// Best-effort schema catch-up so an existing database accepts newer enum
// values/columns. Fire-and-forget, idempotent, never blocks a request.
const runMigrations = () => {
  const warn = (label: string) => (err: unknown) =>
    console.warn(`[migrate] ${label} skipped:`, err instanceof Error ? err.message : err);
  void ensureCefrLevelEnum().catch(warn("CEFR level enum"));
  void ensureRunAnnotationsColumn().catch(warn("run annotations column"));
  void ensureCommercialSchema().catch(warn("commercial schema"));
  void ensureTicketSchema().catch(warn("ticket schema"));
  void ensureWalkthroughTemplate().catch(warn("walkthrough/news template enum"));
  void ensureElevenLabsProvider().catch(warn("elevenlabs provider enum"));
  void ensureUserFavoriteType().catch(warn("user-favorite enum"));
  void ensureCustomizationSchema().catch(warn("customization schema"));
  void ensureSlideToolAuthoring().catch(warn("slide-tool authoring"));
};

// Running these probes on every cold start can lock heavily-used tables (e.g.
// users) and starve auth requests. Keep disabled by default everywhere; opt in
// explicitly when you intentionally want boot-time schema catch-up.
const shouldRunBootMigrations = process.env.ENABLE_BOOT_MIGRATIONS === "true";
if (shouldRunBootMigrations) {
  runMigrations();
}

const app = new Hono<{ Bindings: HttpBindings }>();

app.use(
  "/api/*",
  cors({
    origin: (origin) => {
      if (!origin) return origin;
      if (
        origin === "https://test-skills-page-ai.vercel.app" ||
        origin === "https://test-skills-page-ai-git-main-repo-slides-tools.vercel.app"
      ) {
        return origin;
      }
      return origin.endsWith(".vercel.app") ? origin : "";
    },
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  }),
);

/**
 * Deployment diagnostics. Reports whether required env vars are present and
 * whether the database answers, with timings — without leaking any secrets.
 * Every user-facing failure mode (sign-in timeout, empty galleries, silent
 * chat) funnels through the same database, so this endpoint pinpoints where
 * requests are stalling: missing env, unreachable DB, or lock contention on
 * the shared `sketchlearn.users` table.
 */
app.get("/api/health", async (c) => {
  const timeout = <T>(p: Promise<T>, ms: number) =>
    new Promise<T>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
      p.then(
        (v) => (clearTimeout(t), resolve(v)),
        (e) => (clearTimeout(t), reject(e)),
      );
    });

  const started = Date.now();
  const report: Record<string, unknown> = {
    env: {
      DATABASE_URL: Boolean(process.env.DATABASE_URL?.trim()),
      JWT_SECRET: Boolean(process.env.JWT_SECRET?.trim() || process.env.APP_SECRET?.trim()),
      ENABLE_BOOT_MIGRATIONS: process.env.ENABLE_BOOT_MIGRATIONS === "true",
    },
  };
  let ok = false;
  try {
    const db = getDb();

    let t = Date.now();
    await timeout(db.execute(sql`select 1`), 6000);
    report.dbConnectMs = Date.now() - t;

    // Sessions from ANY app on this database currently stuck waiting on a
    // lock — nonzero here while sign-in hangs means another client (e.g. a
    // second website's startup migrations) is blocking shared tables. These
    // probes read pg_stat_activity, which table locks can never block, so
    // they run BEFORE the users-table read that a lock would stall.
    const waiting = await timeout(
      db.execute(sql`
        select count(*)::int as n
        from pg_stat_activity
        where wait_event_type = 'Lock' and datname = current_database()`),
      6000,
    );
    report.queriesWaitingOnLocks = (waiting.rows[0] as { n: number } | undefined)?.n ?? null;

    const conns = await timeout(
      db.execute(sql`
        select count(*)::int as total
        from pg_stat_activity
        where datname = current_database()`),
      6000,
    );
    report.dbConnectionsInUse = (conns.rows[0] as { total: number } | undefined)?.total ?? null;

    t = Date.now();
    const users = await timeout(
      db.execute(sql`select count(*)::int as n from sketchlearn.users`),
      6000,
    );
    report.usersTableMs = Date.now() - t;
    report.userCount = (users.rows[0] as { n: number } | undefined)?.n ?? null;

    ok = true;
  } catch (err) {
    report.error = err instanceof Error ? err.message : String(err);
  }
  report.ok = ok;
  report.totalMs = Date.now() - started;
  return c.json(report, ok ? 200 : 503);
});

/**
 * Wolfram|Alpha proxy for the "wolfram" slide component. The AI emits a
 * computable query; the player loads it as an image through this route so the
 * App ID (WOLFRAM_APP_ID, falling back to the legacy APP_ID slot) never
 * reaches the client. Uses Wolfram's Simple API, themed to the paper palette.
 */
app.get("/api/wolfram", async (c) => {
  const query = c.req.query("i")?.trim();
  const appId = process.env.WOLFRAM_APP_ID?.trim() || process.env.APP_ID?.trim();
  if (!query || query.length > 300) return c.json({ error: "bad_query" }, 400);
  if (!appId) return c.json({ error: "wolfram_not_configured" }, 404);
  try {
    const upstream = await fetch(
      `https://api.wolframalpha.com/v1/simple?appid=${encodeURIComponent(appId)}&i=${encodeURIComponent(query)}&background=F8F3E7&foreground=2B2B2B&width=760&units=metric`,
      { signal: AbortSignal.timeout(15_000) },
    );
    if (!upstream.ok) return c.json({ error: `wolfram_${upstream.status}` }, 502);
    const body = await upstream.arrayBuffer();
    return c.body(body, 200, {
      "content-type": upstream.headers.get("content-type") ?? "image/png",
      "cache-control": "public, max-age=86400",
    });
  } catch {
    return c.json({ error: "wolfram_unreachable" }, 502);
  }
});

app.use("/api/trpc/*", async (c) => {
  return fetchRequestHandler({
    endpoint: "/api/trpc",
    req: c.req.raw,
    router: appRouter,
    createContext,
  });
});
app.all("/api/*", (c) => c.json({ error: "Not Found" }, 404));

export default app;
