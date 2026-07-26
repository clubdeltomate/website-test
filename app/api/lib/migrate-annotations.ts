import { Client } from "pg";

/**
 * Idempotently add the `runs.annotationsJson` column on databases that predate
 * the slide-annotation feature. Without it, completing a play that carries
 * freehand marks would fail to save. Safe to call repeatedly; best-effort at
 * server boot (never blocks startup).
 */
export async function ensureRunAnnotationsColumn(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return;

  const client = new Client({ connectionString });
  await client.connect();
  try {
    // Only act if the runs table already exists (fresh installs create it with
    // the column from the schema).
    const { rows } = await client.query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.tables
          WHERE table_schema = 'sketchlearn' AND table_name = 'runs'
       ) AS exists`,
    );
    if (!rows[0]?.exists) return;
    await client.query(
      `ALTER TABLE sketchlearn.runs ADD COLUMN IF NOT EXISTS "annotationsJson" json`,
    );
  } finally {
    await client.end();
  }
}

/**
 * Idempotently add the commercial-marketplace pieces on older databases: the
 * public contact columns on users, and the orders (interest) table. Best-effort
 * at boot; safe to call repeatedly.
 */
export async function ensureCommercialSchema(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return;
  const client = new Client({ connectionString });
  await client.connect();
  try {
    const { rows } = await client.query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.tables
          WHERE table_schema = 'sketchlearn' AND table_name = 'users'
       ) AS exists`,
    );
    if (!rows[0]?.exists) return;
    await client.query(
      `ALTER TABLE sketchlearn.users ADD COLUMN IF NOT EXISTS "whatsapp" varchar(40)`,
    );
    await client.query(
      `ALTER TABLE sketchlearn.users ADD COLUMN IF NOT EXISTS "contactNote" varchar(500)`,
    );
    await client.query(
      `ALTER TABLE sketchlearn.users ADD COLUMN IF NOT EXISTS "socials" json`,
    );
    await client.query(
      `CREATE TABLE IF NOT EXISTS sketchlearn.orders (
         id serial PRIMARY KEY,
         "repoId" integer NOT NULL,
         "lessonId" integer,
         "ownerId" integer,
         "buyerUserId" integer,
         "buyerName" varchar(255) NOT NULL DEFAULT 'Guest',
         "itemTitle" varchar(255),
         note varchar(1000),
         seen boolean NOT NULL DEFAULT false,
         "createdAt" timestamp NOT NULL DEFAULT now()
       )`,
    );
    await client.query(
      `CREATE INDEX IF NOT EXISTS orders_owner_idx ON sketchlearn.orders ("ownerId")`,
    );
    // authoring source on repos (ai / human) — defaults every existing row to ai
    await client.query(
      `ALTER TABLE sketchlearn.repos ADD COLUMN IF NOT EXISTS "source" varchar(16) NOT NULL DEFAULT 'ai'`,
    );
    // preset presentation columns on lessons (generate-once, watch-many)
    await client.query(
      `ALTER TABLE sketchlearn.lessons ADD COLUMN IF NOT EXISTS "presetDeckJson" json`,
    );
    await client.query(
      `ALTER TABLE sketchlearn.lessons ADD COLUMN IF NOT EXISTS "presetAt" timestamp`,
    );
  } finally {
    await client.end();
  }
}

/**
 * Idempotently add the customization-ticket pieces on older databases: the
 * moderator ticket-pool column on users, and the tickets table. Best-effort at
 * boot; safe to call repeatedly.
 */
export async function ensureTicketSchema(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return;
  const client = new Client({ connectionString });
  await client.connect();
  try {
    const { rows } = await client.query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.tables
          WHERE table_schema = 'sketchlearn' AND table_name = 'users'
       ) AS exists`,
    );
    if (!rows[0]?.exists) return;
    await client.query(
      `ALTER TABLE sketchlearn.users ADD COLUMN IF NOT EXISTS "ticketBalance" integer NOT NULL DEFAULT 0`,
    );
    await client.query(
      `CREATE TABLE IF NOT EXISTS sketchlearn.tickets (
         id serial PRIMARY KEY,
         "repoId" integer NOT NULL,
         "holderId" integer NOT NULL,
         "issuedById" integer NOT NULL,
         consumed boolean NOT NULL DEFAULT false,
         "consumedAt" timestamp,
         "createdAt" timestamp NOT NULL DEFAULT now()
       )`,
    );
    await client.query(
      `CREATE INDEX IF NOT EXISTS tickets_holder_repo_idx ON sketchlearn.tickets ("holderId", "repoId", consumed)`,
    );
    await client.query(
      `CREATE INDEX IF NOT EXISTS tickets_issuer_idx ON sketchlearn.tickets ("issuedById")`,
    );
    await client.query(
      `CREATE TABLE IF NOT EXISTS sketchlearn."ticketRequests" (
         id serial PRIMARY KEY,
         "repoId" integer NOT NULL,
         "requesterId" integer NOT NULL,
         "ownerId" integer NOT NULL,
         count integer NOT NULL DEFAULT 1,
         note varchar(1000),
         status sketchlearn."status" NOT NULL DEFAULT 'pending',
         "resolvedAt" timestamp,
         "createdAt" timestamp NOT NULL DEFAULT now()
       )`,
    );
    await client.query(
      `CREATE INDEX IF NOT EXISTS "ticketRequests_owner_idx" ON sketchlearn."ticketRequests" ("ownerId", status)`,
    );
    await client.query(
      `CREATE INDEX IF NOT EXISTS "ticketRequests_requester_idx" ON sketchlearn."ticketRequests" ("requesterId")`,
    );
  } finally {
    await client.end();
  }
}

/**
 * Idempotently add the per-user customizations table (a user's saved custom
 * generation of a lesson). Best-effort at boot; safe to call repeatedly.
 */
export async function ensureCustomizationSchema(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return;
  const client = new Client({ connectionString });
  await client.connect();
  try {
    const { rows } = await client.query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.tables
          WHERE table_schema = 'sketchlearn' AND table_name = 'lessons'
       ) AS exists`,
    );
    if (!rows[0]?.exists) return;
    await client.query(
      `CREATE TABLE IF NOT EXISTS sketchlearn.customizations (
         id serial PRIMARY KEY,
         "lessonId" integer NOT NULL,
         "repoId" integer NOT NULL,
         "userId" integer NOT NULL,
         "toolSlug" varchar(191),
         "deckJson" json NOT NULL,
         "seedJson" json,
         "createdAt" timestamp NOT NULL DEFAULT now(),
         "updatedAt" timestamp NOT NULL DEFAULT now()
       )`,
    );
    await client.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS customizations_user_lesson ON sketchlearn.customizations ("userId", "lessonId")`,
    );
  } finally {
    await client.end();
  }
}

/**
 * Idempotently add the slide-tool authoring columns (defaultTone, source,
 * deckJson) so tools can be hand-built presentations, not only AI generators.
 * Best-effort at boot; safe to call repeatedly.
 */
export async function ensureSlideToolAuthoring(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return;
  const client = new Client({ connectionString });
  await client.connect();
  try {
    const { rows } = await client.query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.tables
          WHERE table_schema = 'sketchlearn' AND table_name = 'slideTools'
       ) AS exists`,
    );
    if (!rows[0]?.exists) return;
    await client.query(
      `ALTER TABLE sketchlearn."slideTools" ADD COLUMN IF NOT EXISTS "defaultTone" varchar(24) NOT NULL DEFAULT 'neutral'`,
    );
    await client.query(
      `ALTER TABLE sketchlearn."slideTools" ADD COLUMN IF NOT EXISTS "template" sketchlearn."template" NOT NULL DEFAULT 'course'`,
    );
    await client.query(
      `ALTER TABLE sketchlearn."slideTools" ADD COLUMN IF NOT EXISTS "source" varchar(16) NOT NULL DEFAULT 'ai'`,
    );
    await client.query(
      `ALTER TABLE sketchlearn."slideTools" ADD COLUMN IF NOT EXISTS "deckJson" json`,
    );
  } finally {
    await client.end();
  }
}

/**
 * Idempotently allow the "walkthrough" and "news" repo/tool templates
 * (read-through decks with no quiz) by adding them to the template enum on
 * older databases. Best-effort at boot.
 */
export async function ensureWalkthroughTemplate(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return;
  const client = new Client({ connectionString });
  await client.connect();
  try {
    const { rows } = await client.query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM pg_type t
           JOIN pg_namespace n ON n.oid = t.typnamespace
          WHERE n.nspname = 'sketchlearn' AND t.typname = 'template'
       ) AS exists`,
    );
    if (!rows[0]?.exists) return;
    await client.query(`ALTER TYPE sketchlearn."template" ADD VALUE IF NOT EXISTS 'walkthrough'`);
    await client.query(`ALTER TYPE sketchlearn."template" ADD VALUE IF NOT EXISTS 'news'`);
  } finally {
    await client.end();
  }
}

/**
 * Idempotently allow storing an ElevenLabs API key: add the "elevenlabs" value
 * to the provider enum on older databases so text-to-speech keys can be saved.
 * Best-effort at boot.
 */
export async function ensureElevenLabsProvider(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return;
  const client = new Client({ connectionString });
  await client.connect();
  try {
    const { rows } = await client.query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM pg_type t
           JOIN pg_namespace n ON n.oid = t.typnamespace
          WHERE n.nspname = 'sketchlearn' AND t.typname = 'provider'
       ) AS exists`,
    );
    if (!rows[0]?.exists) return;
    await client.query(`ALTER TYPE sketchlearn."provider" ADD VALUE IF NOT EXISTS 'elevenlabs'`);
  } finally {
    await client.end();
  }
}

/**
 * Idempotently allow favoriting users: add the "user" value to the favorites
 * targetType enum on older databases. Best-effort at boot.
 */
export async function ensureUserFavoriteType(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return;
  const client = new Client({ connectionString });
  await client.connect();
  try {
    const { rows } = await client.query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM pg_type t
           JOIN pg_namespace n ON n.oid = t.typnamespace
          WHERE n.nspname = 'sketchlearn' AND t.typname = 'targetType'
       ) AS exists`,
    );
    if (!rows[0]?.exists) return;
    await client.query(`ALTER TYPE sketchlearn."targetType" ADD VALUE IF NOT EXISTS 'user'`);
  } finally {
    await client.end();
  }
}
