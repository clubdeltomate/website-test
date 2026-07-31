import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, inArray } from "drizzle-orm";
import { createRouter, publicQuery } from "../middleware.js";
import { adminProcedure, authedProcedure } from "../procedures.js";
import { getDb } from "../queries/connection.js";
import { posts, slideImages, users } from "../../db/schema.js";
import { IMAGE_URL_PREFIX } from "../deck-images.js";
import { POST_CATEGORIES, type PostSummary } from "../../contracts/post.js";

/* Published carousels — the feed.
 *
 * Reading is open to everyone, because the feed is the front door. Publishing
 * is admin-only, which is not a separate policy so much as the same one: the
 * marketing tool that produces a post is behind the same gate, so this just
 * agrees with it rather than leaving a back way in. */

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
          limit: z.number().int().min(1).max(60).default(30),
        })
        .default({ limit: 30 }),
    )
    .query(async ({ ctx, input }): Promise<PostSummary[]> => {
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
          input.category
            ? and(eq(posts.isPublic, true), eq(posts.category, input.category))
            : eq(posts.isPublic, true),
        )
        .orderBy(desc(posts.id))
        .limit(input.limit);
      return rows.map((r) => toSummary(r, ctx.user?.id));
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
      if (!row || (!row.post.isPublic && row.post.ownerId !== ctx.user?.id)) {
        throw new TRPCError({ code: "NOT_FOUND", message: "That post isn't here" });
      }
      return toSummary(row, ctx.user?.id);
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
      }),
    )
    .mutation(async ({ ctx, input }): Promise<{ slug: string }> => {
      // Only images this account actually uploaded — otherwise a post could
      // be stitched together from anyone's pictures by id.
      const owned = await getDb()
        .select({ id: slideImages.id })
        .from(slideImages)
        .where(and(inArray(slideImages.id, input.imageIds), eq(slideImages.ownerId, ctx.user.id)));
      const mine = new Set(owned.map((o) => o.id));
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
        });
      return { slug };
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
      return { ok: true };
    }),
});

function toSummary(
  r: {
    post: typeof posts.$inferSelect;
    ownerName: string | null;
    ownerAvatarId: number | null;
    ownerVerified: boolean | null;
  },
  viewerId: number | undefined,
): PostSummary {
  return {
    slug: r.post.slug,
    caption: r.post.caption,
    category: r.post.category,
    imageUrls: (r.post.imageIds ?? []).map((id) => `${IMAGE_URL_PREFIX}${id}`),
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
