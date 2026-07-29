import { Client } from "pg";
import { normalizeUsername } from "../../contracts/types.js";

/**
 * Bring existing accounts up to two rules that are enforced on every write but
 * were introduced after these rows already existed.
 *
 * 1. A username is one word. Sign-in accepts a bare username, so a name with a
 *    space is an identifier nobody can type reliably. Spaces are closed up
 *    rather than the name rejected — "Sam Sketcher" becomes "SamSketcher".
 * 2. Holding credits makes an account a moderator. The rule fires when a
 *    balance changes, so accounts that were already sitting on credits when it
 *    landed were never promoted and stayed in a state the rest of the app says
 *    cannot exist.
 *
 * Idempotent: a second run finds nothing to do. Never demotes and never
 * touches an admin — this only fills in what the live rules would already have
 * done, and demotion belongs to the code that spends credits.
 */
export async function ensureAccountRules(): Promise<{ renamed: number; promoted: number }> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return { renamed: 0, promoted: 0 };
  const client = new Client({ connectionString });
  await client.connect();
  try {
    const { rows: present } = await client.query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.tables
          WHERE table_schema = 'sketchlearn' AND table_name = 'users'
       ) AS exists`,
    );
    if (!present[0]?.exists) return { renamed: 0, promoted: 0 };

    /* ---- 1. one-word usernames ---- */
    const { rows: all } = await client.query<{ id: number; name: string }>(
      `SELECT id, name FROM sketchlearn.users ORDER BY id`,
    );
    // Squeezing spaces out can collide two accounts ("Sam Sketcher" and
    // "SamSketcher"), so claimed names are tracked as we go and a loser gets a
    // numeric suffix. Lower-cased because the uniqueness check is too.
    const taken = new Set<string>();
    for (const u of all) {
      if (normalizeUsername(u.name) === u.name) taken.add(u.name.toLowerCase());
    }
    let renamed = 0;
    for (const u of all) {
      const base = normalizeUsername(u.name) || `user${u.id}`;
      if (base === u.name) continue;
      let candidate = base;
      let n = 2;
      while (taken.has(candidate.toLowerCase())) candidate = `${base}${n++}`;
      taken.add(candidate.toLowerCase());
      await client.query(`UPDATE sketchlearn.users SET name = $1 WHERE id = $2`, [candidate, u.id]);
      renamed++;
    }

    /* ---- 2. credits imply moderator ---- */
    const { rowCount } = await client.query(
      `UPDATE sketchlearn.users
          SET role = 'moderator'
        WHERE role = 'user' AND "tokenBalance" > 0`,
    );
    return { renamed, promoted: rowCount ?? 0 };
  } finally {
    await client.end();
  }
}
