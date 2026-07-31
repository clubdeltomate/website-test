import { getDb } from "./queries/connection.js";
import { settings } from "../db/schema.js";
import { eq } from "drizzle-orm";
import type { AppSettings } from "../contracts/types.js";

export const SETTINGS_KEY = "app";

export const DEFAULT_SETTINGS: AppSettings = {
  tokenPacks: [
    { id: "pack-100", tokens: 100, priceCents: 500, label: "100 tokens — $5" },
    { id: "pack-300", tokens: 300, priceCents: 1200, label: "300 tokens — $12" },
    { id: "pack-800", tokens: 800, priceCents: 2500, label: "800 tokens — $25" },
  ],
  prices: {
    perSlideBase: 2,
    perImageSlide: 2,
    perTts: 1,
    perMusic: 20,
    levelMultiplier: { A0: 1.0, A1: 1.0, A2: 1.1, B1: 1.2, B2: 1.3, C1: 1.4, C2: 1.5 },
  },
  googleSheetUrl: "https://docs.google.com/spreadsheets/d/REPLACE_ME",
  platformAiKeys: {},
  featureFlags: { coachEnabled: true, guestDemo: true },
};

/** Read app settings, merged over defaults (missing keys → defaults). */
export async function getSettings(): Promise<AppSettings> {
  try {
    const row = await getDb().query.settings.findFirst({
      where: eq(settings.key, SETTINGS_KEY),
    });
    if (!row) return DEFAULT_SETTINGS;
    const value = row.valueJson as Partial<AppSettings>;
    return {
      ...DEFAULT_SETTINGS,
      ...value,
      prices: {
        ...DEFAULT_SETTINGS.prices,
        ...(value.prices ?? {}),
        // deep-merge so every CEFR level always has a multiplier even if the
        // stored settings predate the CEFR migration (old keys linger harmlessly)
        levelMultiplier: {
          ...DEFAULT_SETTINGS.prices.levelMultiplier,
          ...(value.prices?.levelMultiplier ?? {}),
        },
      },
      platformAiKeys: { ...(value.platformAiKeys ?? {}) },
      featureFlags: { ...DEFAULT_SETTINGS.featureFlags, ...(value.featureFlags ?? {}) },
    };
  } catch (err) {
    console.error("[settings] failed to read, using defaults:", err);
    return DEFAULT_SETTINGS;
  }
}

export async function saveSettings(value: AppSettings): Promise<void> {
  await getDb()
    .insert(settings)
    .values({ key: SETTINGS_KEY, valueJson: value })
    .onConflictDoUpdate({ target: settings.key, set: { valueJson: value } });
}
