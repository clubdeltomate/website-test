import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { env } from "../lib/env.js";
import * as schema from "../../db/schema.js";
import * as relations from "../../db/relations.js";

const fullSchema = { ...schema, ...relations };

let instance: ReturnType<typeof drizzle<typeof fullSchema>>;
let pool: Pool;

export function getDb() {
  if (!instance) {
    const max = Number(process.env.PG_POOL_MAX ?? (process.env.VERCEL ? 2 : 10));
    const connectionTimeoutMillis = Number(process.env.PG_CONNECTION_TIMEOUT_MS ?? 8000);
    const idleTimeoutMillis = Number(process.env.PG_IDLE_TIMEOUT_MS ?? 30000);
    pool = new Pool({
      connectionString: env.databaseUrl,
      max,
      connectionTimeoutMillis,
      idleTimeoutMillis,
    });
    instance = drizzle(pool, {
      schema: fullSchema,
    });
  }
  return instance;
}
