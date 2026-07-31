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
