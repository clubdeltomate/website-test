import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, inArray, or } from "drizzle-orm";
import { createRouter, publicQuery } from "../middleware.js";
import { adminProcedure, authedProcedure } from "../procedures.js";
import { getDb } from "../queries/connection.js";
import { assignments, favorites, posts, slideImages, users } from "../../db/schema.js";
import { favoriteSlugs } from "./repos.js";
import { IMAGE_URL_PREFIX } from "../deck-images.js";
import {
  POST_CATEGORIES,
  POST_VISIBILITY,
  type PostSummary,
  type PostVisibility,
} from "../../contracts/post.js";

/* Published carousels — the feed.
 *
 * Reading is open to everyone, because the feed is the front door. Publishing
 * is admin-only, which is not a separate policy so much as the same one: the
 * marketing tool that produces a post is behind the same gate, so this just
 * agrees with it rather than leaving a back way in. */

/** Which posts this viewer was given by name. Empty for a guest. */
async function assignedToViewer(viewerId: number | undefined): Promise<Set<string>> {
  if (viewerId == null) return new Set();
  try {
    const rows = await getDb()
      .select({ slug: assignments.targetSlug })
      .from(assignments)
      .where(and(eq(assignments.userId, viewerId), eq(assignments.targetType, "post")));
    return new Set(rows.map((r) => r.slug));
  } catch (err) {
    // A missing assignments table must hide assigned posts, never break the
    // feed — the public half of it has nothing to do with this.
    console.warn("[posts] assignments unavailable:", err instanceof Error ? err.message : err);
    return new Set();
  }
}

/**
 * May this viewer see this post?
 *
 * Public is public. Everything else is yours or sent to you — and that is
 * true of admins too: "private" would not mean much if it meant "private
 * unless someone has the admin flag". Taking a post down is a separate power
 * and lives on `remove`.
 */
export function canSee(
  post: { visibility: string; ownerId: number; slug: string },
  viewerId: number | undefined,
  given: Set<string>,
): boolean {
  if (post.visibility === "public") return true;
  if (viewerId == null) return false; // a guest sees only the public feed
  if (post.ownerId === viewerId) return true;
  return given.has(post.slug);
}

const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "post";

export const postsRouter = createRouter({
  /** The feed, newest first, optionally narrowed to one category. */
  list: publicQuery
    .input(
      z
        .object({
          category: z.enum(POST_CATEGORIES).optional(),
          /** only the ones this viewer saved */
          saved: z.boolean().default(false),
          limit: z.number().int().min(1).max(60).default(30),
        })
        .default({ limit: 30, saved: false }),
    )
    .query(async ({ ctx, input }): Promise<PostSummary[]> => {
      const saved = await favoriteSlugs(ctx.user?.id, "post");
      // Nobody signed in has saved anything, so the saved shelf is empty
      // rather than "everything".
      if (input.saved && saved.size === 0) return [];
      const given = await assignedToViewer(ctx.user?.id);
      /* Everything public, everything of yours whatever it is set to, and
         anything made out to you by name. Narrowed in SQL rather than after
         the fact so the limit counts posts you can actually see. */
      const audience = or(
        eq(posts.visibility, "public"),
        ctx.user ? eq(posts.ownerId, ctx.user.id) : undefined,
        given.size > 0 ? inArray(posts.slug, [...given]) : undefined,
      );
      const rows = await getDb()
        .select({
          post: posts,
          ownerName: users.name,
          ownerAvatarId: users.avatarImageId,
          ownerVerified: users.verified,
        })
        .from(posts)
        .leftJoin(users, eq(users.id, posts.ownerId))
        .where(
          and(
            audience,
            input.category ? eq(posts.category, input.category) : undefined,
            input.saved ? inArray(posts.slug, [...saved]) : undefined,
          ),
        )
        .orderBy(desc(posts.id))
        .limit(input.limit);
      const counts = await assignedCounts(rows.map((r) => r.post));
      return rows.map((r) => toSummary(r, ctx.user?.id, counts, saved));
    }),

  /** One post, for its own page. */
  bySlug: publicQuery
    .input(z.object({ slug: z.string().max(191) }))
    .query(async ({ ctx, input }): Promise<PostSummary> => {
      const [row] = await getDb()
        .select({
          post: posts,
          ownerName: users.name,
          ownerAvatarId: users.avatarImageId,
          ownerVerified: users.verified,
        })
        .from(posts)
        .leftJoin(users, eq(users.id, posts.ownerId))
        .where(eq(posts.slug, input.slug));
      // "Not here" rather than "not allowed": a private post should not
      // confirm its own existence to someone guessing at addresses.
      if (!row || !canSee(row.post, ctx.user?.id, await assignedToViewer(ctx.user?.id))) {
        throw new TRPCError({ code: "NOT_FOUND", message: "That post isn't here" });
      }
      return toSummary(
        row,
        ctx.user?.id,
        await assignedCounts([row.post]),
        await favoriteSlugs(ctx.user?.id, "post"),
      );
    }),

  /**
   * Park one rendered slide. Called once per slide rather than all at once:
   * a carousel of six 1080-wide PNGs is comfortably past the request cap in
   * one body, and nowhere near it one at a time.
   */
  uploadSlide: adminProcedure
    .input(z.object({ image: z.string().min(32).max(4_000_000) }))
    .mutation(async ({ ctx, input }): Promise<{ id: number }> => {
      const m = /^data:(image\/[a-z+.-]+);base64,(.+)$/s.exec(input.image.trim());
      if (!m) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "That isn't an image we can store" });
      }
      const [row] = await getDb()
        .insert(slideImages)
        .values({ ownerId: ctx.user.id, mime: m[1], data: m[2] })
        .returning({ id: slideImages.id });
      return { id: row.id };
    }),

  /** Publish the uploaded slides as one post. */
  create: adminProcedure
    .input(
      z.object({
        caption: z.string().max(2200).default(""),
        category: z.enum(POST_CATEGORIES).default("course"),
        imageIds: z.array(z.number().int().positive()).min(1).max(20),
        width: z.number().int().min(1).max(4000).default(1080),
        height: z.number().int().min(1).max(8000).default(1350),
        /** the music bed, already generated and stored */
        audioId: z.number().int().positive().nullable().default(null),
        visibility: z.enum(POST_VISIBILITY).default("public"),
        /** who it is made out to; only read when visibility is "assigned" */
        assignedUserIds: z.array(z.number().int().positive()).max(200).default([]),
      }),
    )
    .mutation(async ({ ctx, input }): Promise<{ slug: string }> => {
      // Only images this account actually uploaded — otherwise a post could
      // be stitched together from anyone's pictures by id. The music bed goes
      // through the same check, for the same reason.
      const wanted =
        input.audioId == null ? input.imageIds : [...input.imageIds, input.audioId];
      const owned = await getDb()
        .select({ id: slideImages.id })
        .from(slideImages)
        .where(and(inArray(slideImages.id, wanted), eq(slideImages.ownerId, ctx.user.id)));
      const mine = new Set(owned.map((o) => o.id));
      const audioId = input.audioId != null && mine.has(input.audioId) ? input.audioId : null;
      const imageIds = input.imageIds.filter((id) => mine.has(id));
      if (imageIds.length === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "None of those slides belong to you",
        });
      }
      const base = slugify(input.caption.split("\n")[0] || "post");
      let slug = base;
      for (let n = 2; n < 200; n++) {
        const [clash] = await getDb()
          .select({ id: posts.id })
          .from(posts)
          .where(eq(posts.slug, slug));
        if (!clash) break;
        slug = `${base}-${n}`;
      }
      /* Who it is sent to — real accounts only, so an id typed by hand never
         becomes a row that quietly matches nobody. Independent of whether it
         is public: sending a public post to someone puts it in front of them
         without taking it off the feed, and sending a private one is the only
         way anybody but the owner ever sees it. */
      const named = [...new Set(input.assignedUserIds)].filter((id) => id !== ctx.user.id);
      const recipients =
        named.length > 0
          ? (
              await getDb().select({ id: users.id }).from(users).where(inArray(users.id, named))
            ).map((u) => u.id)
          : [];
      const visibility: PostVisibility = input.visibility;
      await getDb()
        .insert(posts)
        .values({
          slug,
          ownerId: ctx.user.id,
          caption: input.caption,
          category: input.category,
          imageIds,
          width: input.width,
          height: input.height,
          audioId,
          visibility,
          // Kept in step with visibility so anything still reading the older
          // flag is never wrong, only less specific.
          isPublic: visibility === "public",
        });
      if (recipients.length > 0) {
        await getDb()
          .insert(assignments)
          .values(
            recipients.map((id) => ({
              targetType: "post",
              targetSlug: slug,
              userId: id,
              assignedBy: ctx.user.id,
            })),
          );
      }
      return { slug };
    }),

  /**
   * Save a post, or un-save it — the same shelf repos and people use, so the
   * heart means one thing across the site. Only on a post you can see, so
   * saving cannot be used to find out whether a private one exists.
   */
  toggleSaved: authedProcedure
    .input(z.object({ slug: z.string().max(191) }))
    .mutation(async ({ ctx, input }): Promise<{ saved: boolean }> => {
      const db = getDb();
      const [row] = await db.select().from(posts).where(eq(posts.slug, input.slug));
      if (!row || !canSee(row, ctx.user.id, await assignedToViewer(ctx.user.id))) {
        throw new TRPCError({ code: "NOT_FOUND", message: "That post isn't here" });
      }
      const [existing] = await db
        .select({ id: favorites.id })
        .from(favorites)
        .where(
          and(
            eq(favorites.userId, ctx.user.id),
            eq(favorites.targetType, "post"),
            eq(favorites.targetSlug, input.slug),
          ),
        );
      if (existing) {
        await db.delete(favorites).where(eq(favorites.id, existing.id));
        return { saved: false };
      }
      await db
        .insert(favorites)
        .values({ userId: ctx.user.id, targetType: "post", targetSlug: input.slug });
      return { saved: true };
    }),

  /** Take a post down. Yours, or anyone's if you are an admin. */
  remove: authedProcedure
    .input(z.object({ slug: z.string().max(191) }))
    .mutation(async ({ ctx, input }): Promise<{ ok: true }> => {
      const [row] = await getDb().select().from(posts).where(eq(posts.slug, input.slug));
      if (!row) return { ok: true };
      if (row.ownerId !== ctx.user.id && ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "That post isn't yours" });
      }
      await getDb().delete(posts).where(eq(posts.id, row.id));
      // The slug is free to be reused, so its old audience must not linger.
      await getDb()
        .delete(assignments)
        .where(and(eq(assignments.targetType, "post"), eq(assignments.targetSlug, row.slug)));
      return { ok: true };
    }),
});

/** How many people each of these posts was made out to. */
async function assignedCounts(rows: { slug: string }[]): Promise<Map<string, number>> {
  const slugs = rows.map((r) => r.slug);
  const counts = new Map<string, number>();
  if (slugs.length === 0) return counts;
  try {
    const held = await getDb()
      .select({ slug: assignments.targetSlug })
      .from(assignments)
      .where(and(eq(assignments.targetType, "post"), inArray(assignments.targetSlug, slugs)));
    for (const h of held) counts.set(h.slug, (counts.get(h.slug) ?? 0) + 1);
  } catch (err) {
    console.warn("[posts] assignment counts unavailable:", err instanceof Error ? err.message : err);
  }
  return counts;
}

function toSummary(
  r: {
    post: typeof posts.$inferSelect;
    ownerName: string | null;
    ownerAvatarId: number | null;
    ownerVerified: boolean | null;
  },
  viewerId: number | undefined,
  counts: Map<string, number>,
  saved: Set<string>,
): PostSummary {
  const who = (POST_VISIBILITY as readonly string[]).includes(r.post.visibility)
    ? (r.post.visibility as PostVisibility)
    : "public";
  return {
    who,
    saved: saved.has(r.post.slug),
    assignedCount: counts.get(r.post.slug) ?? 0,
    slug: r.post.slug,
    caption: r.post.caption,
    category: r.post.category,
    imageUrls: (r.post.imageIds ?? []).map((id) => `${IMAGE_URL_PREFIX}${id}`),
    audioUrl: r.post.audioId == null ? null : `${IMAGE_URL_PREFIX}${r.post.audioId}`,
    width: r.post.width,
    height: r.post.height,
    ownerId: r.post.ownerId,
    ownerName: r.ownerName ?? "someone",
    ownerAvatarUrl: r.ownerAvatarId == null ? null : `${IMAGE_URL_PREFIX}${r.ownerAvatarId}`,
    ownerVerified: r.ownerVerified ?? false,
    createdAt: r.post.createdAt,
    mine: viewerId != null && viewerId === r.post.ownerId,
  };
}
