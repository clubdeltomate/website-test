import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, like, or } from "drizzle-orm";
import { createRouter, publicQuery } from "../middleware.js";
import { adminProcedure, authedProcedure, moderatorProcedure } from "../procedures.js";
import { getDb } from "../queries/connection.js";
import { favorites, repos, runs, slideTools, tokenLedger, users } from "../../db/schema.js";
import { applyTokenDelta } from "../tokens.js";
import { hashPassword } from "../auth-utils.js";
import { favoriteSlugs, repoSummaries } from "./repos.js";
import { toSummary as slideToolSummary } from "./slideTools.js";
import type { AdminUserRow, DirectoryUser, RepoTemplate, UserProfile } from "../../contracts/types.js";

async function toRow(db: ReturnType<typeof getDb>, u: typeof users.$inferSelect): Promise<AdminUserRow> {
  const userRuns = await db.select({ id: runs.id }).from(runs).where(eq(runs.userId, u.id));
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    tokenBalance: u.tokenBalance,
    ticketBalance: u.ticketBalance,
    runCount: userRuns.length,
    createdAt: u.createdAt,
  };
}

export const usersRouter = createRouter({
  /**
   * Public user directory — anyone (including guests) can browse EVERY user,
   * favorite them, and open their profile. Each entry carries a repo count and
   * the categories of their public repos for filtering.
   */
  directory: publicQuery
    .input(z.object({ q: z.string().max(200).optional() }).optional())
    .query(async ({ ctx, input }): Promise<DirectoryUser[]> => {
      const db = getDb();
      const publicRepos = await db
        .select({ ownerId: repos.ownerId, template: repos.template })
        .from(repos)
        .where(eq(repos.isPublic, true));
      const counts = new Map<number, number>();
      const cats = new Map<number, Set<string>>();
      for (const r of publicRepos) {
        if (r.ownerId == null) continue;
        counts.set(r.ownerId, (counts.get(r.ownerId) ?? 0) + 1);
        const s = cats.get(r.ownerId) ?? new Set<string>();
        s.add(r.template);
        cats.set(r.ownerId, s);
      }
      const rows = await db.select().from(users);
      const favs = await favoriteSlugs(ctx.user?.id, "user");
      const q = input?.q?.trim().toLowerCase();
      return rows
        .filter((u) => !q || u.name.toLowerCase().includes(q))
        .map((u) => ({
          id: u.id,
          name: u.name,
          role: u.role,
          repoCount: counts.get(u.id) ?? 0,
          templates: [...(cats.get(u.id) ?? [])] as RepoTemplate[],
          favorite: favs.has(String(u.id)),
        }))
        .sort(
          (a, b) =>
            Number(b.favorite) - Number(a.favorite) ||
            b.repoCount - a.repoCount ||
            a.name.localeCompare(b.name),
        );
    }),

  /** A user's public profile: the public repos + slide tools they own + contact. */
  profile: publicQuery
    .input(z.object({ userId: z.number().int() }))
    .query(async ({ ctx, input }): Promise<UserProfile> => {
      const db = getDb();
      const user = await db.query.users.findFirst({ where: eq(users.id, input.userId) });
      if (!user) throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
      const ownedPublic = await db
        .select()
        .from(repos)
        .where(and(eq(repos.ownerId, user.id), eq(repos.isPublic, true)))
        .orderBy(desc(repos.createdAt));
      const ownedTools = await db
        .select()
        .from(slideTools)
        .where(and(eq(slideTools.ownerId, user.id), eq(slideTools.isPublic, true)))
        .orderBy(desc(slideTools.createdAt));
      const summaries = await repoSummaries(ownedPublic, ctx.user?.id);
      const toolSummaries = await Promise.all(ownedTools.map((t) => slideToolSummary(t, ctx.user?.id)));
      const favs = await favoriteSlugs(ctx.user?.id, "user");
      return {
        id: user.id,
        name: user.name,
        role: user.role,
        createdAt: user.createdAt,
        whatsapp: user.whatsapp ?? null,
        socials: Array.isArray(user.socials) ? (user.socials as string[]) : [],
        contactNote: user.contactNote ?? null,
        favorite: favs.has(String(user.id)),
        repos: summaries,
        slideTools: toolSummaries,
      };
    }),

  /** Favorite / unfavorite a creator (targetType "user"). */
  toggleFavorite: authedProcedure
    .input(z.object({ userId: z.number().int() }))
    .mutation(async ({ ctx, input }): Promise<{ favorite: boolean }> => {
      const db = getDb();
      const slug = String(input.userId);
      const existing = await db.query.favorites.findFirst({
        where: and(
          eq(favorites.userId, ctx.user.id),
          eq(favorites.targetType, "user"),
          eq(favorites.targetSlug, slug),
        ),
      });
      if (existing) {
        await db.delete(favorites).where(eq(favorites.id, existing.id));
        return { favorite: false };
      }
      await db.insert(favorites).values({ userId: ctx.user.id, targetType: "user", targetSlug: slug });
      return { favorite: true };
    }),

  list: moderatorProcedure
    .input(
      z
        .object({
          q: z.string().max(200).optional(),
          role: z.enum(["user", "moderator", "admin"]).optional(),
          limit: z.number().int().min(1).max(200).default(100),
        })
        .optional(),
    )
    .query(async ({ input }) => {
      const db = getDb();
      const conds = [];
      if (input?.role) conds.push(eq(users.role, input.role));
      if (input?.q) {
        const q = `%${input.q}%`;
        conds.push(or(like(users.email, q), like(users.name, q))!);
      }
      const rows = await db
        .select()
        .from(users)
        .where(conds.length ? and(...conds) : undefined)
        .orderBy(desc(users.createdAt))
        .limit(input?.limit ?? 100);
      return Promise.all(rows.map((u) => toRow(db, u)));
    }),

  detail: moderatorProcedure
    .input(z.object({ userId: z.number().int() }))
    .query(async ({ input }) => {
      const db = getDb();
      const user = await db.query.users.findFirst({ where: eq(users.id, input.userId) });
      if (!user) throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
      return toRow(db, user);
    }),

  /** Admin only — create an account directly from the Manage users page. */
  createUser: adminProcedure
    .input(
      z.object({
        name: z.string().min(1).max(255),
        email: z.string().email().max(320),
        password: z.string().min(6).max(128),
        role: z.enum(["user", "moderator", "admin"]).default("user"),
        tokens: z.number().int().min(0).max(100000).default(50),
      }),
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      const email = input.email.toLowerCase().trim();
      const existing = await db.query.users.findFirst({ where: eq(users.email, email) });
      if (existing) {
        throw new TRPCError({ code: "CONFLICT", message: "That email already has an account" });
      }
      const [{ id }] = await db
        .insert(users)
        .values({
          email,
          name: input.name.trim(),
          passwordHash: hashPassword(input.password),
          role: input.role,
          tokenBalance: input.tokens,
        })
        .returning({ id: users.id });
      if (input.tokens > 0) {
        await db.insert(tokenLedger).values({
          userId: id,
          delta: input.tokens,
          reason: "starting balance (admin-created account)",
          balanceAfter: input.tokens,
        });
      }
      return { id };
    }),

  /** Admin only — role assignment. */
  setRole: adminProcedure
    .input(z.object({ userId: z.number().int(), role: z.enum(["user", "moderator", "admin"]) }))
    .mutation(async ({ ctx, input }) => {
      if (input.userId === ctx.user.id && input.role !== "admin") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "You can't demote yourself" });
      }
      const db = getDb();
      const user = await db.query.users.findFirst({ where: eq(users.id, input.userId) });
      if (!user) throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
      await db.update(users).set({ role: input.role }).where(eq(users.id, input.userId));
      return { ok: true as const };
    }),

  /** Moderator+ manual token credit with ledger entry. */
  creditTokens: moderatorProcedure
    .input(
      z.object({
        userId: z.number().int(),
        amount: z.number().int().min(1).max(100000),
        reason: z.string().max(255).default("manual credit"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const user = await db.query.users.findFirst({ where: eq(users.id, input.userId) });
      if (!user) throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
      const balance = await applyTokenDelta(
        input.userId,
        input.amount,
        `${input.reason} (by ${ctx.user.email})`,
      );
      return { ok: true as const, balance };
    }),
});
