/* One-off verification: register the admin's existing Gemini key as an   */
/* image-capability BYOK key, then exercise generateImage end-to-end.     */
import { getDb } from "../api/queries/connection";
import { apiKeys } from "../db/schema";
import { and, eq } from "drizzle-orm";
import { generateImage } from "../api/ai/provider";

async function main() {
  const db = getDb();
  const textKey = await db.query.apiKeys.findFirst({
    where: and(eq(apiKeys.provider, "gemini"), eq(apiKeys.capability, "text")),
  });
  if (!textKey) throw new Error("no gemini key in apiKeys");

  const existing = await db.query.apiKeys.findFirst({
    where: and(
      eq(apiKeys.userId, textKey.userId),
      eq(apiKeys.provider, "gemini"),
      eq(apiKeys.capability, "image"),
    ),
  });
  if (existing) {
    await db.update(apiKeys).set({ apiKey: textKey.apiKey }).where(eq(apiKeys.id, existing.id));
    console.log(`updated image BYOK key (id ${existing.id}) for user ${textKey.userId}`);
  } else {
    const [{ id }] = await db
      .insert(apiKeys)
      .values({
        userId: textKey.userId,
        provider: "gemini",
        capability: "image",
        apiKey: textKey.apiKey,
      })
      .returning({ id: apiKeys.id });
    console.log(`inserted image BYOK key (id ${id}) for user ${textKey.userId}`);
  }

  const dataUri = await generateImage({
    userId: textKey.userId,
    prompt: "A friendly pencil mascot drawing a lightbulb on a chalkboard",
    style: "sketch",
  });
  if (!dataUri) throw new Error("generateImage returned null");
  const head = dataUri.slice(0, 40);
  console.log(`generateImage OK: ${head}… (length ${dataUri.length} chars)`);
  if (!/^data:image\/[a-z]+;base64,/.test(dataUri)) throw new Error("not a data URI");
  process.exit(0);
}

main().catch((err) => {
  console.error("FAILED:", err instanceof Error ? err.message : err);
  process.exit(1);
});
