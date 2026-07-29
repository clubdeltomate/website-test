import "dotenv/config";
import { Client } from "pg";

/**
 * Move base64 images out of already-saved decks and into the slideImages table.
 *
 * Decks written before images were externalised carry every picture inline, so
 * an illustrated ten-slide lesson is 10-20 MB that must be returned whole every
 * time someone presses Play — over the response limit of the serverless host and
 * slow everywhere else. This rewrites the stored decks in place; the images
 * themselves are kept, just moved.
 *
 * Idempotent: a deck with no data URIs left is skipped.
 *
 * Run: npx tsx scripts/externalize-deck-images.ts
 */
const DATA_URI = /^data:([^;,]+);base64,(.+)$/s;

type Deck = { slides?: { components?: { imageUrl?: unknown }[] }[] };

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required");
  const client = new Client({ connectionString });
  await client.connect();

  let movedTotal = 0;
  let decksTotal = 0;
  let bytesSaved = 0;

  // Every column a deck can live in.
  const targets = [
    { table: 'sketchlearn.lessons', col: '"presetDeckJson"', owner: "null" },
    { table: "sketchlearn.customizations", col: '"deckJson"', owner: '"userId"' },
    { table: 'sketchlearn."slideTools"', col: '"deckJson"', owner: '"ownerId"' },
  ];

  for (const t of targets) {
    const { rows } = await client.query(
      `SELECT id, ${t.col} AS deck, ${t.owner} AS owner FROM ${t.table} WHERE ${t.col} IS NOT NULL`,
    );
    for (const row of rows) {
      const deck = row.deck as Deck;
      if (!deck?.slides) continue;
      const before = JSON.stringify(deck).length;
      let moved = 0;
      for (const slide of deck.slides) {
        for (const comp of slide.components ?? []) {
          const url = comp.imageUrl;
          if (typeof url !== "string") continue;
          const m = DATA_URI.exec(url);
          if (!m) continue;
          const [, mime, b64] = m;
          const ins = await client.query(
            `INSERT INTO sketchlearn."slideImages" ("ownerId", mime, data) VALUES ($1, $2, $3) RETURNING id`,
            [row.owner ?? null, mime, b64],
          );
          comp.imageUrl = `/api/img/${ins.rows[0].id}`;
          moved++;
        }
      }
      if (moved === 0) continue;
      const json = JSON.stringify(deck);
      await client.query(`UPDATE ${t.table} SET ${t.col} = $1 WHERE id = $2`, [json, row.id]);
      movedTotal += moved;
      decksTotal++;
      bytesSaved += before - json.length;
    }
  }

  await client.end();
  console.log(
    `Moved ${movedTotal} image(s) out of ${decksTotal} deck(s) — ${(bytesSaved / 1e6).toFixed(1)} MB no longer travels on every play.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
