import { eq } from "drizzle-orm";
import { getDb } from "./queries/connection.js";
import { settings } from "../db/schema.js";

/* ------------------------------------------------------------------ */
/* Durable generation trace.                                           */
/*                                                                     */
/* When a serverless invocation is killed for running too long it      */
/* returns nothing at all: no error, no logs the owner can reach, just */
/* a dropped connection in the browser. Anything held in memory dies   */
/* with it. So each phase of a generation is written to the database   */
/* as it happens — whatever phase is last in the record is the one     */
/* that never came back, which is exactly the fact needed to fix it.   */
/* ------------------------------------------------------------------ */

const TRACE_KEY = "debug.lastGeneration";

export interface TracePhase {
  name: string;
  atMs: number;
  detail?: string;
}

export interface GenerationTrace {
  startedAtIso: string;
  toolSlug: string;
  userId: number | null;
  slideCount: number;
  imageStyle: string;
  webSearch: boolean;
  phases: TracePhase[];
  /** set only when the request finished on its own terms */
  outcome?: "deck" | "error";
  totalMs?: number;
}

export class GenTrace {
  private phases: TracePhase[] = [];
  private base: Omit<GenerationTrace, "phases">;
  private startedAt: number;

  constructor(
    startedAt: number,
    meta: { toolSlug: string; userId: number | null; slideCount: number; imageStyle: string; webSearch: boolean },
  ) {
    this.startedAt = startedAt;
    this.base = { startedAtIso: new Date(startedAt).toISOString(), ...meta };
  }

  /** Record a phase and persist immediately — the persistence IS the point. */
  async mark(name: string, detail?: string): Promise<void> {
    this.phases.push({ name, atMs: Date.now() - this.startedAt, detail });
    await this.flush();
  }

  async finish(outcome: "deck" | "error", detail?: string): Promise<void> {
    this.phases.push({ name: `finished:${outcome}`, atMs: Date.now() - this.startedAt, detail });
    this.base.outcome = outcome;
    this.base.totalMs = Date.now() - this.startedAt;
    await this.flush();
  }

  private async flush(): Promise<void> {
    try {
      const value: GenerationTrace = { ...this.base, phases: this.phases };
      const write = getDb()
        .insert(settings)
        .values({ key: TRACE_KEY, valueJson: value })
        .onConflictDoUpdate({ target: settings.key, set: { valueJson: value } });
      // Capped for the same reason the generation itself is: a diagnostic
      // write must never be what holds a request open until it is killed.
      await Promise.race([
        write,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("trace write timed out")), 1_500).unref?.(),
        ),
      ]);
    } catch (err) {
      // Diagnostics must never be the reason a generation fails.
      console.warn("[trace] could not persist:", err instanceof Error ? err.message : err);
    }
  }
}

export async function readGenerationTrace(): Promise<GenerationTrace | null> {
  try {
    const row = await getDb().query.settings.findFirst({ where: eq(settings.key, TRACE_KEY) });
    return row ? (row.valueJson as GenerationTrace) : null;
  } catch {
    return null;
  }
}
