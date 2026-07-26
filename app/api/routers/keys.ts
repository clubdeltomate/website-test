import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { createRouter } from "../middleware.js";
import { authedProcedure } from "../procedures.js";
import { getDb } from "../queries/connection.js";
import { apiKeys } from "../../db/schema.js";
import { maskApiKey } from "../auth-utils.js";
import { testKey } from "../ai/provider.js";
import type { ApiKeyRow } from "../../contracts/types.js";

const providerSchema = z.enum(["openai", "anthropic", "gemini", "elevenlabs"]);
const capabilitySchema = z.enum(["text", "image", "tts"]);

export const keysRouter = createRouter({
  /** List the user's BYOK keys — always masked (first 6 + … + last 4). */
  list: authedProcedure.query(async ({ ctx }): Promise<ApiKeyRow[]> => {
    const rows = await getDb()
      .select()
      .from(apiKeys)
      .where(eq(apiKeys.userId, ctx.user.id));
    return rows.map((k) => ({
      id: k.id,
      provider: k.provider,
      capability: k.capability,
      maskedKey: maskApiKey(k.apiKey),
      createdAt: k.createdAt,
    }));
  }),

  upsert: authedProcedure
    .input(
      z.object({
        provider: providerSchema,
        capability: capabilitySchema,
        apiKey: z.string().min(8).max(512),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const existing = await db.query.apiKeys.findFirst({
        where: and(
          eq(apiKeys.userId, ctx.user.id),
          eq(apiKeys.provider, input.provider),
          eq(apiKeys.capability, input.capability),
        ),
      });
      if (existing) {
        await db.update(apiKeys).set({ apiKey: input.apiKey }).where(eq(apiKeys.id, existing.id));
        return { id: existing.id, maskedKey: maskApiKey(input.apiKey) };
      }
      const [{ id }] = await db
        .insert(apiKeys)
        .values({ userId: ctx.user.id, ...input })
        .returning({ id: apiKeys.id });
      return { id, maskedKey: maskApiKey(input.apiKey) };
    }),

  remove: authedProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      await db
        .delete(apiKeys)
        .where(and(eq(apiKeys.id, input.id), eq(apiKeys.userId, ctx.user.id)));
      return { ok: true as const };
    }),

  /** Minimal provider ping against a stored key — green/red. */
  test: authedProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const key = await db.query.apiKeys.findFirst({
        where: and(eq(apiKeys.id, input.id), eq(apiKeys.userId, ctx.user.id)),
      });
      if (!key) throw new TRPCError({ code: "NOT_FOUND", message: "Key not found" });
      try {
        await testKey(key.provider, key.apiKey, undefined, key.capability);
        return { ok: true as const, message: "Key works ✓" };
      } catch (err) {
        return {
          ok: false as const,
          message: err instanceof Error ? err.message.slice(0, 200) : "Provider rejected the key",
        };
      }
    }),
});
