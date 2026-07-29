import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq, sql } from "drizzle-orm";
import { createRouter, publicQuery } from "../middleware.js";
import { authedProcedure } from "../procedures.js";
import { getDb } from "../queries/connection.js";
import { users, tokenLedger, type User } from "../../db/schema.js";
import { hashPassword, verifyPassword, signAuthToken } from "../auth-utils.js";
import type { SessionUser } from "../../contracts/types.js";

function toSessionUser(u: User): SessionUser {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    tokenBalance: u.tokenBalance,
    ticketBalance: u.ticketBalance,
    createdAt: u.createdAt,
    whatsapp: u.whatsapp ?? null,
    socials: Array.isArray(u.socials) ? (u.socials as string[]) : [],
    contactNote: u.contactNote ?? null,
  };
}

/**
 * Zero, not 50. Holding credits is now what makes an account a moderator, so a
 * free starting balance would promote every new signup the moment it landed
 * and empty the role of meaning. A new account starts with nothing and becomes
 * a moderator when someone actually credits it.
 */
const STARTER_TOKENS = 0;

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new TRPCError({ code: "INTERNAL_SERVER_ERROR", message }));
    }, ms);
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

export const authRouter = createRouter({
  register: publicQuery
    .input(
      z.object({
        email: z.string().email().max(320),
        password: z.string().min(8, "Password must be at least 8 characters").max(128),
        name: z.string().min(1).max(255),
      }),
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      const email = input.email.toLowerCase().trim();
      const existing = await db.query.users.findFirst({ where: eq(users.email, email) });
      if (existing) {
        throw new TRPCError({ code: "CONFLICT", message: "That email already has a notebook" });
      }
      // The display name doubles as the unique USERNAME (bare-username sign-in
      // matches it), so it can't repeat — case-insensitively.
      const nameTaken = await db.query.users.findFirst({
        where: sql`LOWER(${users.name}) = ${input.name.trim().toLowerCase()}`,
      });
      if (nameTaken) {
        throw new TRPCError({ code: "CONFLICT", message: "That username is taken — pick another" });
      }
      const [{ id }] = await db
        .insert(users)
        .values({
          email,
          name: input.name.trim(),
          passwordHash: hashPassword(input.password),
          role: "user",
          tokenBalance: STARTER_TOKENS,
        })
        .returning({ id: users.id });
      // No row for a zero bonus — an empty movement is noise in the ledger.
      if (STARTER_TOKENS > 0) {
        await db.insert(tokenLedger).values({
          userId: id,
          delta: STARTER_TOKENS,
          reason: "welcome bonus",
          balanceAfter: STARTER_TOKENS,
        });
      }
      const user = (await db.query.users.findFirst({ where: eq(users.id, id) }))!;
      return { token: signAuthToken({ sub: user.id, email: user.email }), user: toSessionUser(user) };
    }),

  login: publicQuery
    // `email` accepts a plain identifier too: bare usernames resolve to a user
    // (special-case "admin" → the seeded admin account, or a case-insensitive
    // exact name match). Same error either way — no user enumeration.
    .input(
      z.object({
        email: z.string().min(1).max(320),
        password: z.string().min(1).max(128),
      }),
    )
    .mutation(async ({ input }) => {
      return withTimeout(
        (async () => {
          const db = getDb();
          const identifier = input.email.trim();
          const lowered = identifier.toLowerCase();
          let user: User | undefined;
          if (identifier.includes("@")) {
            user = await withTimeout(
              db.query.users.findFirst({ where: eq(users.email, lowered) }),
              8000,
              "Sign-in is taking too long. Please try again.",
            );
          } else if (lowered === "admin") {
            user = await withTimeout(
              db.query.users.findFirst({ where: eq(users.email, "admin@sketchlearn.app") }),
              8000,
              "Sign-in is taking too long. Please try again.",
            );
          } else {
            user = await withTimeout(
              db.query.users.findFirst({
                where: sql`LOWER(${users.name}) = ${lowered}`,
              }),
              8000,
              "Sign-in is taking too long. Please try again.",
            );
          }
          if (!user || !verifyPassword(input.password, user.passwordHash)) {
            throw new TRPCError({ code: "UNAUTHORIZED", message: "Email or password doesn't match" });
          }
          return { token: signAuthToken({ sub: user.id, email: user.email }), user: toSessionUser(user) };
        })(),
        10000,
        "Sign-in is taking too long. Please try again.",
      );
    }),

  me: publicQuery.query(({ ctx }) => {
    return ctx.user ? toSessionUser(ctx.user) : null;
  }),

  logout: authedProcedure.mutation(() => {
    // JWT is stateless — the client discards the token. Endpoint exists for symmetry.
    return { ok: true as const };
  }),

  updateProfile: authedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(255).optional(),
        currentPassword: z.string().min(1).optional(),
        newPassword: z.string().min(8).max(128).optional(),
        // public contact for commercial showcases
        whatsapp: z.string().max(40).optional(),
        contactNote: z.string().max(500).optional(),
        socials: z.array(z.string().max(200)).max(6).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const set: Partial<Pick<User, "name" | "passwordHash" | "whatsapp" | "contactNote" | "socials">> = {};
      if (input.name && input.name.trim().toLowerCase() !== ctx.user.name.toLowerCase()) {
        const taken = await db.query.users.findFirst({
          where: sql`LOWER(${users.name}) = ${input.name.trim().toLowerCase()}`,
        });
        if (taken && taken.id !== ctx.user.id) {
          throw new TRPCError({ code: "CONFLICT", message: "That username is taken — pick another" });
        }
      }
      if (input.name) set.name = input.name.trim();
      if (input.whatsapp !== undefined) set.whatsapp = input.whatsapp.trim() || null;
      if (input.contactNote !== undefined) set.contactNote = input.contactNote.trim() || null;
      if (input.socials !== undefined) set.socials = input.socials.map((s) => s.trim()).filter(Boolean);
      if (input.newPassword) {
        if (!input.currentPassword || !verifyPassword(input.currentPassword, ctx.user.passwordHash)) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Current password doesn't match" });
        }
        set.passwordHash = hashPassword(input.newPassword);
      }
      if (Object.keys(set).length > 0) {
        await db.update(users).set(set).where(eq(users.id, ctx.user.id));
      }
      const fresh = (await db.query.users.findFirst({ where: eq(users.id, ctx.user.id) }))!;
      return toSessionUser(fresh);
    }),
});
