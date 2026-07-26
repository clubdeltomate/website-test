import app from "./app.js";
import { env } from "./lib/env.js";

/**
 * Self-hosted entry (`node dist/boot.js`): the single Node process serves BOTH
 * the API and the built SPA. On Vercel this file is not used — `server.ts`
 * wraps the same app as a serverless function and Vercel serves the SPA.
 */
export default app;

if (env.isProduction) {
  const { serve } = await import("@hono/node-server");
  const { serveStaticFiles } = await import("./lib/vite.js");
  serveStaticFiles(app);

  const port = parseInt(process.env.PORT || "3000");
  serve({ fetch: app.fetch, port }, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}
