import type { IncomingMessage, ServerResponse } from "node:http";

/**
 * Vercel serverless entry. Vercel's Node runtime invokes the default export
 * with Node's (IncomingMessage, ServerResponse). We load the Hono app LAZILY
 * inside the handler and wrap it in try/catch so that ANY failure — a bad
 * import, a missing env var, a handler crash — is returned as readable JSON
 * instead of Vercel's opaque FUNCTION_INVOCATION_FAILED page.
 *
 * IMPORTANT: Vercel's Node helpers read the request stream BEFORE the handler
 * runs and expose the parsed payload as `req.body`. Piping the (already
 * consumed) stream into a fetch Request therefore yields an empty/never-ending
 * body — every POST (sign-in, chat, generation) breaks while GETs work. So we
 * build the fetch Request ourselves: use `req.body` when the helpers consumed
 * the stream, and fall back to reading the stream when it is still intact
 * (self-hosted/tests). Do not replace this with @hono/node-server's
 * getRequestListener — that is exactly the version that hangs on Vercel.
 *
 * vercel.json rewrites every /api/* request here; the function receives the
 * original URL, so /api/trpc/* still reaches the tRPC handler. Vercel serves
 * the built SPA (dist/public) directly, so this function only handles the API.
 */

type VercelRequest = IncomingMessage & { body?: unknown };

let appPromise: Promise<{ fetch: (req: Request) => Response | Promise<Response> }> | null = null;

async function readBody(req: VercelRequest): Promise<string | Buffer | undefined> {
  if (req.method === "GET" || req.method === "HEAD") return undefined;
  if (req.body !== undefined || req.readableEnded) {
    // Vercel's helpers already consumed the stream; re-serialize their result.
    const b = req.body;
    if (b === undefined || b === null) return undefined;
    if (typeof b === "string") return b;
    if (Buffer.isBuffer(b)) return b;
    return JSON.stringify(b);
  }
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return chunks.length ? Buffer.concat(chunks) : undefined;
}

function toFetchRequest(req: VercelRequest, body: string | Buffer | undefined): Request {
  const proto = (req.headers["x-forwarded-proto"] as string | undefined)?.split(",")[0] ?? "https";
  const host = req.headers.host ?? "localhost";
  const url = `${proto}://${host}${req.url ?? "/"}`;
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) value.forEach((v) => headers.append(key, v));
    else headers.set(key, value);
  }
  // The re-serialized body can differ in length from the original bytes.
  headers.delete("content-length");
  headers.delete("transfer-encoding");
  return new Request(url, { method: req.method ?? "GET", headers, body });
}

export default async function handler(req: VercelRequest, res: ServerResponse) {
  try {
    if (!appPromise) appPromise = import("./app.js").then((m) => m.default);
    const app = await appPromise;
    const body = await readBody(req);
    const response = await app.fetch(toFetchRequest(req, body));

    res.statusCode = response.status;
    response.headers.forEach((value, key) => {
      if (key === "set-cookie") return; // handled below to keep multiple cookies separate
      res.setHeader(key, value);
    });
    const cookies = response.headers.getSetCookie?.() ?? [];
    if (cookies.length) res.setHeader("set-cookie", cookies);
    const payload = Buffer.from(await response.arrayBuffer());
    res.end(payload);
  } catch (err) {
    // a failure here would otherwise be an opaque 500 — surface it instead
    appPromise = null; // let the next request retry a fresh import
    const detail = err instanceof Error ? (err.stack ?? err.message) : String(err);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader("content-type", "application/json");
    }
    res.end(JSON.stringify({ error: "api_handler_failed", detail: detail.slice(0, 4000) }));
  }
}
