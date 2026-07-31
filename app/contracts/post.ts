/* ------------------------------------------------------------------ */
/* Marketing posts: the categories they file under.                     */
/* ------------------------------------------------------------------ */

/**
 * The same six the notebook shelf and the slide tools use.
 *
 * Deliberately the same list rather than a parallel one: a post is
 * advertising for the kind of thing this site already organises, so the
 * filter on the feed reads like the filter on the shelf, and someone who
 * runs a restaurant sees "Restaurant" in both places.
 */
export const POST_CATEGORIES = [
  "course",
  "restaurant",
  "service",
  "shop",
  "walkthrough",
  "news",
] as const;

export type PostCategory = (typeof POST_CATEGORIES)[number];

/** What each category means to the AI writing the carousel. */
export const CATEGORY_BRIEF: Record<PostCategory, string> = {
  course: "a course or a piece of teaching — the reader should want to learn it",
  restaurant: "a restaurant, a dish or a menu — the reader should want to eat it",
  service: "a service or a trade — the reader should want to hire them",
  shop: "a shop, a product or a collection — the reader should want to buy it",
  walkthrough: "a walkthrough or a how-to — the reader should want to follow along",
  news: "a piece of news or an announcement — the reader should want to know",
};

/**
 * Who a post is for.
 *
 * Three states rather than the boolean this started as, because "not public"
 * turned out to mean two different things: a draft nobody but you should see,
 * and something made for particular people. The middle case is the one that
 * needed saying — a post written for one customer does not belong on
 * everybody's feed, and hiding it entirely would make it useless.
 */
export const POST_VISIBILITY = ["public", "private", "assigned"] as const;
export type PostVisibility = (typeof POST_VISIBILITY)[number];

export const VISIBILITY_LABEL: Record<PostVisibility, string> = {
  public: "Public",
  private: "Private",
  assigned: "Assigned",
};

export const VISIBILITY_BRIEF: Record<PostVisibility, string> = {
  public: "On the feed for everyone, signed in or not.",
  private: "Only you see it — it stays on your own feed.",
  assigned: "Only the people you pick see it, on their feed.",
};

/**
 * A published post as the feed reads it. Declared here rather than beside the
 * router so the page and the endpoint agree on one shape.
 */
export interface PostSummary {
  slug: string;
  caption: string;
  category: string;
  /** every slide, in carousel order */
  imageUrls: string[];
  /** the music bed under it, if one was made */
  audioUrl: string | null;
  width: number;
  height: number;
  ownerId: number;
  ownerName: string;
  ownerAvatarUrl: string | null;
  ownerVerified: boolean;
  createdAt: Date;
  /** the viewer made this one */
  mine: boolean;
  who: PostVisibility;
  /** how many people it was assigned to; 0 unless `who` is "assigned" */
  assignedCount: number;
}
