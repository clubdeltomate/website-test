import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, inArray, like, or, sql } from "drizzle-orm";
import { createRouter, publicQuery } from "../middleware.js";
import { adminProcedure, authedProcedure, moderatorProcedure } from "../procedures.js";
import { getDb } from "../queries/connection.js";
import {
  apiKeys,
  customizations,
  favorites,
  lessonLogs,
  lessons,
  orders,
  payments,
  repos,
  runs,
  slideImages,
  slideTools,
  ticketRequests,
  tickets,
  tokenLedger,
  units,
  users,
} from "../../db/schema.js";
import { generateImage } from "../ai/provider.js";
import { getSettings } from "../settings.js";
import { IMAGE_URL_PREFIX } from "../deck-images.js";
import { applyTokenDelta } from "../tokens.js";
import { hashPassword } from "../auth-utils.js";
import { favoriteSlugs, repoSummaries } from "./repos.js";
import { toSummary as slideToolSummary } from "./slideTools.js";
import { normalizeUsername } from "../../contracts/types.js";
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
   * follow them, and open their profile. Each entry carries a repo count and
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
          verified: u.verified,
          avatarUrl: u.avatarImageId != null ? `${IMAGE_URL_PREFIX}${u.avatarImageId}` : null,
          repoCount: counts.get(u.id) ?? 0,
          templates: [...(cats.get(u.id) ?? [])] as RepoTemplate[],
          following: favs.has(String(u.id)),
        }))
        .sort(
          (a, b) =>
            Number(b.following) - Number(a.following) ||
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
        verified: user.verified,
        avatarUrl: user.avatarImageId != null ? `${IMAGE_URL_PREFIX}${user.avatarImageId}` : null,
        createdAt: user.createdAt,
        whatsapp: user.whatsapp ?? null,
        socials: Array.isArray(user.socials) ? (user.socials as string[]) : [],
        contactNote: user.contactNote ?? null,
        following: favs.has(String(user.id)),
        repos: summaries,
        slideTools: toolSummaries,
      };
    }),

  /**
   * Follow / unfollow a creator. Stored as a favorites row with targetType
   * "user": following someone and starring them were always the same act, so
   * this is a rename of the concept rather than a second relation beside it.
   */
  toggleFollow: authedProcedure
    .input(z.object({ userId: z.number().int() }))
    .mutation(async ({ ctx, input }): Promise<{ following: boolean }> => {
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
        return { following: false };
      }
      await db.insert(favorites).values({ userId: ctx.user.id, targetType: "user", targetSlug: slug });
      return { following: true };
    }),

  /**
   * Ids of the people the viewer follows. The gallery filters work by owner,
   * and it needs the whole set at once to do that client-side — asking per
   * card would be one query per tile.
   */
  followingIds: publicQuery.query(async ({ ctx }): Promise<number[]> => {
    if (!ctx.user) return [];
    const slugs = await favoriteSlugs(ctx.user.id, "user");
    return [...slugs].map(Number).filter(Number.isFinite);
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
        // Raw input — see the note in auth.register; normalizeUsername is
        // what actually enforces the username rules.
        name: z.string().min(1).max(255),
        email: z.string().email().max(320),
        password: z.string().min(6).max(128),
        role: z.enum(["user", "moderator", "admin"]).default("user"),
        tokens: z.number().int().min(0).max(100000).default(0),
      }),
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      const email = input.email.toLowerCase().trim();
      const existing = await db.query.users.findFirst({ where: eq(users.email, email) });
      if (existing) {
        throw new TRPCError({ code: "CONFLICT", message: "That email already has an account" });
      }
      const name = normalizeUsername(input.name);
      if (!name) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Pick a username with some letters in it" });
      }
      const nameTaken = await db.query.users.findFirst({
        where: sql`LOWER(${users.name}) = ${name.toLowerCase()}`,
      });
      if (nameTaken) {
        throw new TRPCError({ code: "CONFLICT", message: "That username is already used by another user" });
      }
      // Holding credits is what makes someone a moderator, and this insert
      // writes a balance straight into the row rather than going through
      // applyTokenDelta — so the rule has to be applied here too, or an account
      // created as a "user" with coins would sit in a state the rest of the app
      // says cannot exist. Admins keep the role they were given.
      const role =
        input.role === "user" && input.tokens > 0 ? ("moderator" as const) : input.role;
      const [{ id }] = await db
        .insert(users)
        .values({
          email,
          name,
          passwordHash: hashPassword(input.password),
          role,
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

  /**
   * Admin only — correct a user's name or email from the Users table. Both are
   * sign-in identifiers, so both are checked for collisions against every other
   * account; the username is normalized to one word like everywhere else.
   */
  updateIdentity: adminProcedure
    .input(
      z.object({
        userId: z.number().int(),
        name: z.string().min(1).max(255).optional(),
        email: z.string().email().max(320).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      const user = await db.query.users.findFirst({ where: eq(users.id, input.userId) });
      if (!user) throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });

      const set: { name?: string; email?: string } = {};
      if (input.name !== undefined) {
        const name = normalizeUsername(input.name);
        if (!name) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Pick a username with some letters in it" });
        }
        if (name.toLowerCase() !== user.name.toLowerCase()) {
          const taken = await db.query.users.findFirst({
            where: sql`LOWER(${users.name}) = ${name.toLowerCase()}`,
          });
          if (taken && taken.id !== user.id) {
            throw new TRPCError({ code: "CONFLICT", message: `${name} is already taken` });
          }
        }
        set.name = name;
      }
      if (input.email !== undefined) {
        const email = input.email.trim().toLowerCase();
        if (email !== user.email) {
          const taken = await db.query.users.findFirst({ where: eq(users.email, email) });
          if (taken && taken.id !== user.id) {
            throw new TRPCError({ code: "CONFLICT", message: `${email} already has an account` });
          }
        }
        set.email = email;
      }
      if (Object.keys(set).length > 0) {
        await db.update(users).set(set).where(eq(users.id, input.userId));
      }
      const fresh = (await db.query.users.findFirst({ where: eq(users.id, input.userId) }))!;
      return { name: fresh.name, email: fresh.email };
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
      // Verification belongs to moderators and admins only, so demoting to
      // plain user takes the check mark with it.
      await db
        .update(users)
        .set({ role: input.role, ...(input.role === "user" ? { verified: false } : {}) })
        .where(eq(users.id, input.userId));
      return { ok: true as const };
    }),

  /**
   * Set the profile picture: upload a file for free, or have the AI paint
   * one for coins. The AI portrait is always an ANIMAL character — never a
   * human — themed on what this user has actually published; an account
   * with nothing published gets a fresh-notebook, ready-to-start portrait.
   * Charged only after the picture exists, like every image here.
   */
  /** What the AI portrait will cost — quoted in the confirmation popup. */
  avatarQuote: authedProcedure.query(async (): Promise<{ cost: number }> => {
    const { prices } = await getSettings();
    return { cost: Math.max(1, Math.ceil(prices.perImageSlide)) };
  }),

  setAvatar: authedProcedure
    .input(
      z.union([
        z.object({
          source: z.literal("upload"),
          mime: z.string().max(100),
          /** base64 WITHOUT the data: prefix */
          data: z.string().min(1),
        }),
        z.object({ source: z.literal("generate") }),
      ]),
    )
    .mutation(async ({ ctx, input }): Promise<{ url: string; cost: number }> => {
      const db = getDb();
      let mime: string;
      let data: string;
      let cost = 0;

      if (input.source === "upload") {
        const allowed = ["image/png", "image/jpeg", "image/webp", "image/gif"];
        if (!allowed.includes(input.mime)) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `That file type isn't accepted — use ${allowed.map((m) => m.replace("image/", "")).join(", ")}`,
          });
        }
        const bytes = Math.floor((input.data.length * 3) / 4);
        if (bytes > 4 * 1024 * 1024) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `That image is ${(bytes / 1e6).toFixed(1)} MB — the limit is 4 MB`,
          });
        }
        mime = input.mime;
        data = input.data;
      } else {
        const { prices } = await getSettings();
        cost = Math.max(1, Math.ceil(prices.perImageSlide));
        if (ctx.user.tokenBalance < cost) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: `INSUFFICIENT_TOKENS: an AI portrait costs ${cost} 🪙, you have ${ctx.user.tokenBalance} 🪙`,
          });
        }
        // Theme the portrait on what they've published — titles and topics
        // of their repos and slide tools, a few of each.
        const owned = await db
          .select({ title: repos.title })
          .from(repos)
          .where(eq(repos.ownerId, ctx.user.id))
          .limit(4);
        const tools = await db
          .select({ name: slideTools.name, topic: slideTools.topic })
          .from(slideTools)
          .where(eq(slideTools.ownerId, ctx.user.id))
          .limit(4);
        const themes = [
          ...owned.map((r) => r.title),
          ...tools.map((t) => t.topic || t.name),
        ].filter(Boolean);
        const subject =
          themes.length > 0
            ? `A portrait of the teacher behind these creations: ${themes.slice(0, 6).join("; ")}. ` +
              "Decorate the portrait with small motifs from those subjects."
            : "A portrait of a brand-new member holding a blank notebook and a freshly sharpened pencil, ready to make their first lesson.";
        const directive =
          "Square avatar portrait for a learning app. The character MUST be a friendly ANIMAL " +
          "— an owl, fox, elephant, chimp, cat, whatever fits the subject best — NEVER a human. " +
          "Head and shoulders, facing forward, centered, with clear margin all around so it " +
          "crops cleanly into a circle. Warm hand-illustrated style (soft watercolor or colored " +
          "sketch), pretty and characterful. No text.";
        const url = await generateImage({ userId: ctx.user.id, prompt: `${subject}\n\n${directive}` });
        if (!url) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "AI_UNAVAILABLE: no image generator answered — nothing was charged",
          });
        }
        const m = /^data:([^;,]+);base64,(.+)$/s.exec(url);
        if (!m) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "The generator returned an image in a form we can't store",
          });
        }
        await applyTokenDelta(ctx.user.id, -cost, "AI profile portrait");
        mime = m[1];
        data = m[2];
      }

      const [img] = await db
        .insert(slideImages)
        .values({ ownerId: ctx.user.id, mime, data })
        .returning({ id: slideImages.id });
      await db.update(users).set({ avatarImageId: img.id }).where(eq(users.id, ctx.user.id));
      return { url: `${IMAGE_URL_PREFIX}${img.id}`, cost };
    }),

  /**
   * Admin only — grant or withdraw the verification check mark. It vouches
   * for the person behind the account, so it travels with their name: the
   * profile header and every card they publish draw it.
   */
  setVerified: adminProcedure
    .input(z.object({ userId: z.number().int(), verified: z.boolean() }))
    .mutation(async ({ input }): Promise<{ ok: true }> => {
      const db = getDb();
      const user = await db.query.users.findFirst({ where: eq(users.id, input.userId) });
      if (!user) throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
      // Only moderators and admins can hold the check mark — a plain user
      // has no role to vouch for, and losing moderator (demotion, or the
      // balance hitting zero) clears it automatically.
      if (input.verified && user.role === "user") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Only moderators and admins can be verified — credit their account first",
        });
      }
      await db.update(users).set({ verified: input.verified }).where(eq(users.id, input.userId));
      return { ok: true as const };
    }),

  /**
   * Moderator+ manual token adjustment with ledger entry. `direction:
   * "deduct"` removes previously awarded credits (never below zero).
   */
  creditTokens: moderatorProcedure
    .input(
      z.object({
        userId: z.number().int(),
        amount: z.number().int().min(1).max(100000),
        reason: z.string().max(255).default("manual credit"),
        direction: z.enum(["credit", "deduct"]).default("credit"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const user = await db.query.users.findFirst({ where: eq(users.id, input.userId) });
      if (!user) throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
      if (input.direction === "deduct" && input.amount > user.tokenBalance) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `${user.name} only has ${user.tokenBalance} 🪙 — can't remove ${input.amount}`,
        });
      }
      const delta = input.direction === "deduct" ? -input.amount : input.amount;
      const balance = await applyTokenDelta(
        input.userId,
        delta,
        `${input.reason} (by ${ctx.user.email})`,
      );
      return { ok: true as const, balance };
    }),

  /**
   * Admin only — permanently remove an account and everything it owns.
   * The schema has no DB-level FK cascades, so every table that points at
   * the user (or at their repos) is cleaned up here explicitly.
   */
  deleteUser: adminProcedure
    .input(z.object({ userId: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      if (input.userId === ctx.user.id) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "You can't delete your own account" });
      }
      const db = getDb();
      const user = await db.query.users.findFirst({ where: eq(users.id, input.userId) });
      if (!user) throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });

      await db.transaction(async (tx) => {
        // Their repos, plus the course content and ticket economy inside them
        const owned = await tx
          .select({ id: repos.id })
          .from(repos)
          .where(eq(repos.ownerId, user.id));
        const repoIds = owned.map((r) => r.id);
        if (repoIds.length) {
          const repoUnits = await tx
            .select({ id: units.id })
            .from(units)
            .where(inArray(units.repoId, repoIds));
          const unitIds = repoUnits.map((u) => u.id);
          if (unitIds.length) await tx.delete(lessons).where(inArray(lessons.unitId, unitIds));
          await tx.delete(units).where(inArray(units.repoId, repoIds));
          await tx.delete(customizations).where(inArray(customizations.repoId, repoIds));
          await tx.delete(tickets).where(inArray(tickets.repoId, repoIds));
          await tx.delete(ticketRequests).where(inArray(ticketRequests.repoId, repoIds));
          await tx.delete(repos).where(inArray(repos.id, repoIds));
        }
        await tx.delete(slideTools).where(eq(slideTools.ownerId, user.id));

        // Personal rows
        await tx.delete(apiKeys).where(eq(apiKeys.userId, user.id));
        await tx.delete(favorites).where(eq(favorites.userId, user.id));
        await tx.delete(tokenLedger).where(eq(tokenLedger.userId, user.id));
        await tx.delete(payments).where(eq(payments.userId, user.id));
        await tx.delete(customizations).where(eq(customizations.userId, user.id));
        await tx.delete(lessonLogs).where(eq(lessonLogs.userId, user.id));
        await tx.delete(runs).where(eq(runs.userId, user.id));
        await tx.delete(orders).where(eq(orders.ownerId, user.id));
        await tx
          .delete(tickets)
          .where(or(eq(tickets.holderId, user.id), eq(tickets.issuedById, user.id)));
        await tx
          .delete(ticketRequests)
          .where(or(eq(ticketRequests.requesterId, user.id), eq(ticketRequests.ownerId, user.id)));

        // Favorites other people made OF this user
        await tx
          .delete(favorites)
          .where(and(eq(favorites.targetType, "user"), eq(favorites.targetSlug, String(user.id))));

        await tx.delete(users).where(eq(users.id, user.id));
      });

      return { ok: true as const };
    }),
});
