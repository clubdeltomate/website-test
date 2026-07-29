import { TICKET_DECK_LIMITS } from "../contracts/types.js";
import type { CostEstimate, ImageStyle, Level } from "../contracts/types.js";
import { getSettings } from "./settings.js";

/**
 * The largest number of slides a single customization can request. A ticket is
 * priced to cover the most expensive customization possible, so it always
 * fully covers any in-bounds generation — a cheaper deck simply uses less of
 * that ceiling. Taken from the shared cap rather than restated, so the price
 * and the entitlement can never disagree about how big a deck can be.
 */
export const TICKET_MAX_SLIDES = TICKET_DECK_LIMITS.maxSlides;

/** The automatic ticket price for a given price config: the cost of the most
 *  expensive customization — MAX_SLIDES slides, an image on every slide, at
 *  the highest level multiplier. */
export function autoTicketPrice(prices: {
  perSlideBase: number;
  perImageSlide: number;
  levelMultiplier: Record<string, number>;
}): number {
  const mults = Object.values(prices.levelMultiplier);
  const maxMult = mults.length ? Math.max(...mults) : 1;
  const perSlide = prices.perSlideBase + prices.perImageSlide;
  return Math.max(1, Math.ceil(perSlide * TICKET_MAX_SLIDES * maxMult));
}

/**
 * Credit price of ONE customization ticket. The admin can pin an exact price
 * from Finance → Set prices; otherwise it's the auto price above. Moderators
 * pay this (in credits) to the admin per ticket. Computed from live settings
 * so it tracks any price change.
 */
export async function ticketPrice(): Promise<number> {
  const { prices } = await getSettings();
  if (prices.ticketPriceOverride && prices.ticketPriceOverride > 0) {
    return Math.ceil(prices.ticketPriceOverride);
  }
  return autoTicketPrice(prices);
}

/**
 * Token cost estimate (design.md §8):
 * base perSlideBase × count (text portion — zeroed with a BYOK text key)
 * + perImageSlide per slide when an image style is active
 * + perTts per slide when TTS is requested
 * × level multiplier, rounded up.
 */
export async function estimateCost(opts: {
  slideCount: number;
  imageStyle: ImageStyle;
  withTts: boolean;
  level: Level;
  usingOwnKey: boolean;
}): Promise<CostEstimate> {
  const { prices } = await getSettings();
  const baseCost = opts.usingOwnKey ? 0 : prices.perSlideBase * opts.slideCount;
  const imageCost = opts.imageStyle !== "none" ? prices.perImageSlide * opts.slideCount : 0;
  const ttsCost = opts.withTts ? prices.perTts * opts.slideCount : 0;
  const levelMultiplier = prices.levelMultiplier[opts.level] ?? 1;
  const total = Math.max(0, Math.ceil((baseCost + imageCost + ttsCost) * levelMultiplier));

  const breakdown: string[] = [];
  breakdown.push(
    opts.usingOwnKey
      ? `Text: ${opts.slideCount} slides — using your key, 0 🪙`
      : `Text: ${prices.perSlideBase} 🪙 × ${opts.slideCount} slides = ${baseCost} 🪙`,
  );
  if (imageCost > 0)
    breakdown.push(`Images: ${prices.perImageSlide} 🪙 × ${opts.slideCount} slides = ${imageCost} 🪙`);
  if (ttsCost > 0)
    breakdown.push(`Read-aloud: ${prices.perTts} 🪙 × ${opts.slideCount} slides = ${ttsCost} 🪙`);
  if (levelMultiplier !== 1)
    breakdown.push(`Level (${opts.level}) × ${levelMultiplier}`);

  return {
    slideCount: opts.slideCount,
    baseCost,
    imageCost,
    ttsCost,
    levelMultiplier,
    usingOwnKey: opts.usingOwnKey,
    total,
    breakdown,
  };
}
