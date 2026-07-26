import { Hono } from "hono";
import type { HttpBindings } from "@hono/node-server";
import { cors } from "hono/cors";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "./router.js";
import { createContext } from "./context.js";
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
