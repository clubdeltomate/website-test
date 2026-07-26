import "dotenv/config";

/**
 * Read an env var. NEVER throws — throwing here runs at import time and would
 * crash the entire serverless function with an opaque 500 ("A server error has
 * occurred") for every request. Instead we warn; a genuinely missing
 * DATABASE_URL then surfaces as a normal (JSON) database error the client can
 * read, rather than taking the whole API down.
 */
function read(name: string, requiredInProd = false): string {
  const value = process.env[name]?.trim() ?? "";
  if (!value && requiredInProd && process.env.NODE_ENV === "production") {
    console.error(
      `[env] Missing required environment variable: ${name} — set it in your host's environment ` +
        `(e.g. Vercel → Project → Settings → Environment Variables) and redeploy.`,
    );
  }
  return value;
}

export const env = {
  // APP_ID is unused; APP_SECRET is only read directly in auth-utils as a JWT
  // fallback. Neither is required to boot, so they must never crash the API.
  appId: read("APP_ID"),
  appSecret: read("APP_SECRET"),
  isProduction: process.env.NODE_ENV === "production",
  databaseUrl: read("DATABASE_URL", true),
};
