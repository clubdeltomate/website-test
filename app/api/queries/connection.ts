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
    // Serverless keeps this small so many concurrent instances don't exhaust
    // the database's connection limit (this database is shared). It was 2,
    // which left no headroom once bookkeeping (usage metering, generation
    // tracing) started sharing the pool with the request's own queries: one
    // blocked write held half the pool, and a request could sit waiting for a
    // connection until the platform killed it. Three gives that headroom
    // while staying modest per instance.
    const max = Number(process.env.PG_POOL_MAX ?? (process.env.VERCEL ? 3 : 10));
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
