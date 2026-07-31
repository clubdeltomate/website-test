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
    // Admin-granted verification badge; every users query selects the column.
    await client.query(
      `ALTER TABLE sketchlearn.users ADD COLUMN IF NOT EXISTS "verified" boolean NOT NULL DEFAULT false`,
    );
    // Card banner strips; list queries select both columns on both tables.
    await client.query(
      `ALTER TABLE sketchlearn.repos ADD COLUMN IF NOT EXISTS "bannerImageId" integer`,
    );
    await client.query(
      `ALTER TABLE sketchlearn.repos ADD COLUMN IF NOT EXISTS "bannerPrompt" text`,
    );
    await client.query(
      `ALTER TABLE sketchlearn."slideTools" ADD COLUMN IF NOT EXISTS "bannerImageId" integer`,
    );
    await client.query(
      `ALTER TABLE sketchlearn."slideTools" ADD COLUMN IF NOT EXISTS "bannerPrompt" text`,
    );
    // Profile picture; every users query selects the column.
    await client.query(
      `ALTER TABLE sketchlearn.users ADD COLUMN IF NOT EXISTS "avatarImageId" integer`,
    );
    // Which AI-portrait variant an account drew, so the next one differs.
    await client.query(
      `ALTER TABLE sketchlearn.users ADD COLUMN IF NOT EXISTS "avatarVariant" integer`,
    );
    // A repo lesson's preset mirrored onto the Slides page; list queries
    // select both columns.
    await client.query(
      `ALTER TABLE sketchlearn."slideTools" ADD COLUMN IF NOT EXISTS "repoSlug" varchar(191)`,
    );
    await client.query(
      `ALTER TABLE sketchlearn."slideTools" ADD COLUMN IF NOT EXISTS "repoLessonSeq" integer`,
    );
    await client.query(
      `CREATE INDEX IF NOT EXISTS "slideTools_repo_idx" ON sketchlearn."slideTools" ("repoSlug")`,
    );
    // One-time mirror of presets saved BEFORE mirroring existed, so they show
    // on the Slides page like new ones. An exception to the no-backfill rule
    // above, accepted because it is a bounded INSERT..SELECT over lessons
    // that already hold a preset, and ON CONFLICT makes reruns free.
    await client.query(
      `INSERT INTO sketchlearn."slideTools"
         (slug, name, description, "ownerId", topic, instructions, "defaultLevel",
          template, source, "deckJson", "isPublic", "repoSlug", "repoLessonSeq")
       SELECT left('preset-' || r.slug || '-l' || l."globalSeq", 191),
              left(l.title, 255), left(l.objective, 4000), r."ownerId",
              left(l.title, 2000), '',
              COALESCE(NULLIF(l."presetDeckJson"->>'level', ''), 'A1')::sketchlearn.level,
              r.template, 'ai', l."presetDeckJson", r."isPublic", r.slug, l."globalSeq"
       FROM sketchlearn.lessons l
       JOIN sketchlearn.units u ON u.id = l."unitId"
       JOIN sketchlearn.repos r ON r.id = u."repoId"
       WHERE l."presetDeckJson" IS NOT NULL
       ON CONFLICT (slug) DO NOTHING`,
    );
    // The marketing cast's user-made models; the picker lists them.
    await client.query(
      `CREATE TABLE IF NOT EXISTS sketchlearn."castModels" (
         id serial PRIMARY KEY,
         "ownerId" integer,
         name varchar(120) NOT NULL,
         headline varchar(200) NOT NULL,
         sheet text NOT NULL,
         "photoId" integer,
         "createdAt" timestamp NOT NULL DEFAULT now()
       )`,
    );
    await client.query(
      `CREATE INDEX IF NOT EXISTS "castModels_owner_idx" ON sketchlearn."castModels" ("ownerId")`,
    );
    // Drawn faces for the cast; the picker selects them on every load.
    await client.query(
      `CREATE TABLE IF NOT EXISTS sketchlearn."castPortraits" (
         id serial PRIMARY KEY,
         "ownerId" integer NOT NULL,
         "modelId" varchar(80) NOT NULL,
         "imageId" integer NOT NULL,
         "createdAt" timestamp NOT NULL DEFAULT now()
       )`,
    );
    await client.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "castPortraits_owner_model" ON sketchlearn."castPortraits" ("ownerId", "modelId")`,
    );
    // Published carousels; the feed is the homepage, so this must exist.
    await client.query(
      `CREATE TABLE IF NOT EXISTS sketchlearn.posts (
         id serial PRIMARY KEY,
         slug varchar(191) NOT NULL UNIQUE,
         "ownerId" integer NOT NULL,
         caption varchar(2200) NOT NULL DEFAULT '',
         category sketchlearn.template NOT NULL DEFAULT 'course',
         "imageIds" json NOT NULL,
         width integer NOT NULL DEFAULT 1080,
         height integer NOT NULL DEFAULT 1350,
         "isPublic" boolean NOT NULL DEFAULT true,
         "createdAt" timestamp NOT NULL DEFAULT now()
       )`,
    );
    await client.query(
      `CREATE INDEX IF NOT EXISTS "posts_owner_idx" ON sketchlearn.posts ("ownerId")`,
    );
    await client.query(
      `CREATE INDEX IF NOT EXISTS "posts_category_idx" ON sketchlearn.posts (category)`,
    );
    // The saved follow card / business card the marketing tool starts from.
    await client.query(
      `CREATE TABLE IF NOT EXISTS sketchlearn."marketingProfiles" (
         id serial PRIMARY KEY,
         "ownerId" integer NOT NULL,
         "followCard" json,
         "businessCard" json,
         "updatedAt" timestamp NOT NULL DEFAULT now()
       )`,
    );
    await client.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "marketingProfiles_owner_key" ON sketchlearn."marketingProfiles" ("ownerId")`,
    );
    // Items handed to a user by a moderator; shelf queries read it.
    await client.query(
      `CREATE TABLE IF NOT EXISTS sketchlearn.assignments (
         id serial PRIMARY KEY,
         "targetType" varchar(20) NOT NULL,
         "targetSlug" varchar(191) NOT NULL,
         "userId" integer NOT NULL,
         "assignedBy" integer NOT NULL,
         "createdAt" timestamp NOT NULL DEFAULT now()
       )`,
    );
    await client.query(
      `CREATE INDEX IF NOT EXISTS "assignments_user_idx" ON sketchlearn.assignments ("userId", "targetType")`,
    );
  } finally {
    await client.end();
  }
}
