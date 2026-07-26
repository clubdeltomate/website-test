import { Client } from "pg";

/**
 * Idempotently migrate the `sketchlearn.level` Postgres enum from the old
 * 3-tier scale (beginner/intermediate/advanced) to CEFR (A0…C2), preserving
 * existing rows by RENAMING (beginner→A1, intermediate→B1, advanced→C1) then
 * ADDING the remaining CEFR values.
 *
 * Runs best-effort at server boot so a database that predates the CEFR change
 * starts accepting CEFR level values without a manual step — without this,
 * every new run/deck insert (which now carries a CEFR level) is rejected by
 * the old enum and silently fails to save. Safe to call repeatedly.
 */
export async function ensureCefrLevelEnum(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return;

  const client = new Client({ connectionString });
  await client.connect();
  try {
    const { rows } = await client.query<{ label: string }>(
      `SELECT e.enumlabel AS label
         FROM pg_enum e
         JOIN pg_type t ON t.oid = e.enumtypid
         JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE t.typname = 'level' AND n.nspname = 'sketchlearn'`,
    );
    const labels = new Set(rows.map((r) => r.label));
    if (labels.size === 0) return; // enum not created yet — fresh init will create it as CEFR

    // already migrated? (has CEFR values and none of the old ones)
    const cefr = ["A0", "A1", "A2", "B1", "B2", "C1", "C2"];
    const hasOld = labels.has("beginner") || labels.has("intermediate") || labels.has("advanced");
    if (!hasOld && cefr.every((v) => labels.has(v))) return;

    const rename = async (from: string, to: string) => {
      if (labels.has(from) && !labels.has(to)) {
        await client.query(`ALTER TYPE sketchlearn.level RENAME VALUE '${from}' TO '${to}'`);
        labels.delete(from);
        labels.add(to);
      }
    };
    await rename("beginner", "A1");
    await rename("intermediate", "B1");
    await rename("advanced", "C1");
    for (const v of cefr) {
      if (!labels.has(v)) {
        await client.query(`ALTER TYPE sketchlearn.level ADD VALUE IF NOT EXISTS '${v}'`);
        labels.add(v);
      }
    }
    console.log("[migrate] level enum migrated to CEFR:", [...labels].sort().join(", "));
  } finally {
    await client.end();
  }
}
