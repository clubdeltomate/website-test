import "dotenv/config";
import { ensureAccountRules } from "../api/lib/migrate-accounts";

/**
 * One-time (idempotent) catch-up for accounts that predate two rules: usernames
 * are one word, and holding credits makes you a moderator. Boot migrations run
 * this too when they're enabled; this script is for running it by hand.
 *
 * Run: npx tsx scripts/migrate-accounts.ts
 */
async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const { renamed, promoted } = await ensureAccountRules();
  console.log(`Accounts updated — ${renamed} renamed, ${promoted} promoted to moderator.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
