import { z } from "zod";
import { createRouter, publicQuery } from "../middleware.js";
import { listTtsVoices, ttsSpeak, userHasTts, type TtsVoice } from "../ai/provider.js";

/**
 * Text-to-speech read-aloud (ElevenLabs, BYOK). Public procedures: a guest or a
 * user without a key simply gets `available: false` / `null` audio, so the
 * player's speaker button degrades gracefully. Nothing here charges coins or
 * tickets — the user pays ElevenLabs directly with their own key.
 */
export const ttsRouter = createRouter({
  /** Whether the current user has an ElevenLabs key wired up. */
  status: publicQuery.query(async ({ ctx }): Promise<{ available: boolean }> => {
    return { available: await userHasTts(ctx.user?.id) };
  }),

  /** The user's ElevenLabs voices for the settings picker (empty when no key). */
  voices: publicQuery.query(async ({ ctx }): Promise<TtsVoice[]> => {
    return listTtsVoices(ctx.user?.id);
  }),

  /** Synthesize one paragraph to speech; returns null when no key/failure. */
  speak: publicQuery
    .input(
      z.object({
        text: z.string().min(1).max(2500),
        voiceId: z.string().max(191).optional(),
      }),
    )
    .mutation(async ({ ctx, input }): Promise<{ audio: string; mime: string } | null> => {
      return ttsSpeak({ userId: ctx.user?.id, text: input.text, voiceId: input.voiceId });
    }),
});
