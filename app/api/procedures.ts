import { TRPCError } from "@trpc/server";
import { publicQuery } from "./middleware.js";

/**
 * Role-gated procedures, built on top of the graft's `publicQuery`
 * (api/middleware.ts stays untouched). `ctx.user` is attached by
 * api/context.ts when a valid Bearer JWT is present.
 */

export const authedProcedure = publicQuery.use(({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Sign in to continue" });
  }
  return next({ ctx: { ...ctx, user: ctx.user } });
});

export const moderatorProcedure = authedProcedure.use(({ ctx, next }) => {
  if (ctx.user.role !== "moderator" && ctx.user.role !== "admin") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Moderator access required" });
  }
  return next({ ctx });
});

export const adminProcedure = authedProcedure.use(({ ctx, next }) => {
  if (ctx.user.role !== "admin") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Admin access required" });
  }
  return next({ ctx });
});
