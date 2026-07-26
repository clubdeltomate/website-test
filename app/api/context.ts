import type { FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";
import { getDb } from "./queries/connection.js";
import { users, type User } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { verifyAuthToken } from "./auth-utils.js";

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export type TrpcContext = {
  req: Request;
  resHeaders: Headers;
  /** Present when a valid `Authorization: Bearer <jwt>` was supplied */
  user?: User;
};

export async function createContext(
  opts: FetchCreateContextFnOptions,
): Promise<TrpcContext> {
  const ctx: TrpcContext = { req: opts.req, resHeaders: opts.resHeaders };

  // auth.login/register do not need session hydration; skipping it avoids
  // a potentially slow DB read before the mutation itself runs.
  const path = new URL(opts.req.url).pathname;
  if (path.endsWith("/auth.login") || path.endsWith("/auth.register")) {
    return ctx;
  }

  const header = opts.req.headers.get("authorization");
  if (header?.toLowerCase().startsWith("bearer ")) {
    const payload = verifyAuthToken(header.slice(7).trim());
    if (payload) {
      try {
        const user = await withTimeout(
          getDb().query.users.findFirst({
            where: eq(users.id, payload.sub),
          }),
          3000,
        );
        if (user) ctx.user = user;
      } catch (err) {
        console.error("[auth] failed to load user from token:", err);
      }
    }
  }

  return ctx;
}
