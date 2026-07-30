import { Client } from "pg";

/**
 * Schema the running code CANNOT work without, applied unconditionally at boot.
 *
 * The rest of the migrations in this folder are opt-in behind
 * ENABLE_BOOT_MIGRATIONS, because probing every table on a cold start can lock
 * heavily-used ones and starve requests. That was fine while they only added
 * things older databases *might* want. It stopped being fine the moment a
 * shipped query referenced a new column: a deploy without the flag left the
 * repo shelf answering "Couldn't load repositories", because listing repos
 * counts runs and the count filtered on a column that wasn't there.
 *
 * Everything here is deliberately cheap and additive:
 *   - ADD COLUMN IF NOT EXISTS with a constant default, which Postgres applies
 *     without rewriting the table
 *   - CREATE TABLE / INDEX IF NOT EXISTS
 * No backfills, no rewrites, no data movement. Idempotent, so a second cold
 * start does nothing.
 *
 * Add to this only what the current code would break without.
 */
export async function ensureRequiredSchema(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return;
  const client = new Client({ connectionString });
  await client.connect();
  try {
    const { rows } = await client.query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.schemata WHERE schema_name = 'sketchlearn'
       ) AS exists`,
    );
    if (!rows[0]?.exists) return; // fresh install — the schema push creates it all

    // Marks the teacher's answer-key run. repos.list filters on it.
    await client.query(
      `ALTER TABLE sketchlearn.runs ADD COLUMN IF NOT EXISTS "isAnswerKey" boolean NOT NULL DEFAULT false`,
    );
    // Generated images live here instead of inside the deck JSON. Saving a
    // preset writes to it.
    await client.query(
      `CREATE TABLE IF NOT EXISTS sketchlearn."slideImages" (
         id serial PRIMARY KEY,
         "ownerId" integer,
         mime varchar(100) NOT NULL,
         data text NOT NULL,
         "createdAt" timestamp NOT NULL DEFAULT now()
       )`,
    );
    await client.query(
      `CREATE INDEX IF NOT EXISTS "slideImages_owner_idx" ON sketchlearn."slideImages" ("ownerId")`,
    );
    // Pictures placed in a unit next to its lessons.
    await client.query(
      `CREATE TABLE IF NOT EXISTS sketchlearn."unitImages" (
         id serial PRIMARY KEY,
         "unitId" integer NOT NULL,
         "imageId" integer NOT NULL,
         caption varchar(300),
         "orderIndex" integer NOT NULL,
         "createdAt" timestamp NOT NULL DEFAULT now()
       )`,
    );
    await client.query(
      `CREATE INDEX IF NOT EXISTS "unitImages_unit_idx" ON sketchlearn."unitImages" ("unitId", "orderIndex")`,
    );
    // A ticket may belong to no repo (a general ticket for the slide tool).
    await client.query(
      `ALTER TABLE sketchlearn.tickets ALTER COLUMN "repoId" DROP NOT NULL`,
    );
    // Counts answer-key rebuilds per lesson; getBySlug selects the column.
    await client.query(
      `ALTER TABLE sketchlearn.lessons ADD COLUMN IF NOT EXISTS "answerKeyGenerations" integer NOT NULL DEFAULT 0`,
    );
  } finally {
    await client.end();
  }
}
