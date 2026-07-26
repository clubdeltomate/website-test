import "dotenv/config";
import { ensureCefrLevelEnum } from "../api/lib/migrate-levels";

/**
 * One-time (idempotent) migration of the `level` enum to CEFR (A0…C2),
 * preserving existing rows (beginner→A1, intermediate→B1, advanced→C1).
 * The server also runs this automatically on boot; this script is for
 * running it manually.
 *
 * Run: npx tsx scripts/migrate-cefr-levels.ts
 */
async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  await ensureCefrLevelEnum();
  console.log("CEFR level migration complete.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
