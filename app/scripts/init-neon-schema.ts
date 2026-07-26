import "dotenv/config";
import { Client } from "pg";

async function ensureEnum(
  client: Client,
  schema: string,
  name: string,
  values: string[],
) {
  const sqlValues = values.map((v) => `'${v.replace(/'/g, "''")}'`).join(", ");
  await client.query(
    `DO $$ BEGIN CREATE TYPE ${schema}.\"${name}\" AS ENUM (${sqlValues}); EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
  );
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required");

  const client = new Client({ connectionString });
  await client.connect();

  await client.query("CREATE SCHEMA IF NOT EXISTS sketchlearn");

  await ensureEnum(client, "sketchlearn", "role", ["user", "moderator", "admin"]);
  await ensureEnum(client, "sketchlearn", "provider", ["openai", "anthropic", "gemini"]);
  await ensureEnum(client, "sketchlearn", "capability", ["text", "image", "tts"]);
  await ensureEnum(client, "sketchlearn", "template", ["course", "restaurant", "service", "shop", "other"]);
  await ensureEnum(client, "sketchlearn", "level", ["A0", "A1", "A2", "B1", "B2", "C1", "C2"]);
  await ensureEnum(client, "sketchlearn", "imageStyle", ["sketch", "watercolor", "flat", "photo", "none"]);
  await ensureEnum(client, "sketchlearn", "status", ["pending", "credited", "rejected"]);
  await ensureEnum(client, "sketchlearn", "targetType", ["repo", "slideTool"]);

  await client.end();
  console.log("Neon sketchlearn schema initialized");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
