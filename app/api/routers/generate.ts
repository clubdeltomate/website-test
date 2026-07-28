import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { createRouter, publicQuery } from "../middleware.js";
import { authedProcedure, moderatorProcedure } from "../procedures.js";
import { getDb } from "../queries/connection.js";
import { lessons, repos, slideTools, units, users, type Repo } from "../../db/schema.js";
import { completeText, completeVision, generateImage, generateImageDetailed, resolveProviderName, textKeyIdPool, userHasKey, webResearch, type VisionImage } from "../ai/provider.js";
import { mockCoachReply, mockDeck, mockLessonPath } from "../ai/mock.js";
import {
  buildLessonPathPrompt,
  buildSlidesSystemPrompt,
  COACH_SYSTEM_PROMPT,
  coachResponseSchema,
  extractJson,
  imageStyleSchema,
  lessonPathSchema,
  ensureExplanatoryProse,
  shuffleQuizAnswers,
  levelSchema,
  repairDeckDraft,
  repoRef,
  slideDeckSchema,
  slugify,
  templateSchema,
  toneSchema,
} from "../ai/prompts.js";
import { estimateCost } from "../cost.js";
import { applyTokenDelta, refundTokens } from "../tokens.js";
import { consumeOne, countAvailable } from "../tickets.js";
import { buildPreviouslyTaught } from "../memory.js";
import { loadTemplateCatalog } from "./templates.js";
import {
  templatesForContext,
  slideConformsToAny,
  slideConformsToTemplate,
  bestMatchingTemplate,
  GRADABLE_TYPES,
  TEMPLATE_COMPONENT_LABELS,
  LESSON_PACKETS,
} from "../../contracts/slide-templates.js";
import { isStemTopic } from "../../contracts/stem.js";
import { typedOverlapCorrect } from "../../contracts/grade.js";
import { repoPurpose, templateFilterPurpose, type CoachReply, type SlideDeck } from "../../contracts/types.js";

export const GUEST_MAX_SLIDES = 6;
const MAX_SLIDES = 15;
/** Token fee for one AI vision review of a handwritten worked solution. */
const VISION_GRADE_COST = 6;
/** Token fee a moderator pays to recalibrate one slide's explanation length
 *  (admins are not charged; bringing your own text key makes it free). */
const RECALIBRATE_COST = 2;

/**
 * Offline demo content (mock decks/lesson paths) is opt-in. By default a
 * failed or unconfigured AI provider is a hard error: nothing is created,
 * tokens are refunded, and the client shows what went wrong — instead of
 * silently saving placeholder content that looks like a real plan.
 */
const mockAiAllowed = () => process.env.SKETCHLEARN_ALLOW_MOCK_AI === "1";

const AI_UNAVAILABLE_MSG =
  "AI_UNAVAILABLE: no AI provider produced content — nothing was saved and any tokens were refunded. Check the server .env AI keys (e.g. GEMINI_API_KEY) or add your own key in Settings → API Keys, then try again.";

/**
 * Name the providers that were actually tried and why each one refused. Without
 * this the banner says only "no AI provider produced content", which is true of
 * a missing key, an expired key, a rate limit and a model that cannot fit the
 * prompt alike — four very different fixes.
 */
function aiUnavailableMessage(providerErrors: string[]): string {
  if (providerErrors.length === 0) return AI_UNAVAILABLE_MSG;
  return `${AI_UNAVAILABLE_MSG}\n\nProviders tried — ${providerErrors.join(" | ")}`;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/** Naive in-memory rate limiter (per key, per window) — for the public coach. */
const buckets = new Map<string, { count: number; resetAt: number }>();
function rateLimit(key: string, limit: number, windowMs: number) {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }
  b.count += 1;
  if (b.count > limit) {
    throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Slow down a little ✏️" });
  }
}

function clientKey(req: Request): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "anon"
  );
}

/** Find a unique slug for repos/slideTools (append -2, -3, … on collision). */
async function uniqueSlug(table: "repos" | "slideTools", base: string): Promise<string> {
  const db = getDb();
  let candidate = base;
  for (let i = 2; ; i++) {
    const found =
      table === "repos"
        ? await db.query.repos.findFirst({ where: eq(repos.slug, candidate) })
        : await db.query.slideTools.findFirst({ where: eq(slideTools.slug, candidate) });
    if (!found) return candidate;
    candidate = `${base}-${i}`;
  }
}

/** Solved step-by-step results, keyed by normalized query — replays and other
 *  viewers of the same slide hit the cache instead of a fresh AI call. */
type MathStepsResult = {
  title: string;
  pages: { title: string; steps: { text: string; latex?: string }[] }[];
  answer: { text?: string; latex?: string };
  provider: import("../../contracts/types.js").AiProvider;
  providerId: string;
  providerPool: number;
};
const MATH_STEPS_CACHE = new Map<string, MathStepsResult>();

export const generateRouter = createRouter({
  /* ---------------- cost estimate (design §8) ---------------- */
  estimate: publicQuery
    .input(
      z.object({
        slideCount: z.number().int().min(1).max(MAX_SLIDES),
        imageStyle: imageStyleSchema,
        withTts: z.boolean().default(false),
        level: levelSchema,
        useOwnKey: z.boolean().default(false),
      }),
    )
    .query(async ({ ctx, input }) => {
      const usingOwnKey =
        input.useOwnKey && ctx.user ? await userHasKey(ctx.user.id, "text") : false;
      return estimateCost({
        slideCount: input.slideCount,
        imageStyle: input.imageStyle,
        withTts: input.withTts,
        level: input.level,
        usingOwnKey,
      });
    }),

  /* ---------------- lesson path: repo + tool, one action ------- */
  lessonPath: authedProcedure
    .input(
      z.object({
        description: z.string().min(3).max(2000),
        template: templateSchema,
        level: levelSchema,
        slideCount: z.number().int().min(3).max(MAX_SLIDES).default(8),
        imageStyle: imageStyleSchema.default("sketch"),
        unitCount: z.number().int().min(1).max(8).default(4),
        lessonsPerUnit: z.number().int().min(1).max(6).default(3),
        // Uploaded reference material the AI should build the repo from: text
        // pulled from text files, plus images (menus, catalogs) it reads.
        referenceText: z.string().max(20000).optional(),
        referenceImages: z
          .array(z.object({ mime: z.string().max(120), b64: z.string().max(8_000_000) }))
          .max(3)
          .optional(),
        // Search the web for current facts about the subject first.
        webSearch: z.boolean().default(false),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const usingOwnKey = await userHasKey(ctx.user.id, "text");
      // Scope proxy: one "deck's worth" per lesson of structure.
      const scopeSlides = Math.min(
        MAX_SLIDES,
        Math.max(3, Math.ceil((input.unitCount * input.lessonsPerUnit) / 2)),
      );
      const cost = await estimateCost({
        slideCount: scopeSlides,
        imageStyle: input.imageStyle,
        withTts: false,
        level: input.level,
        usingOwnKey,
      });
      if (ctx.user.tokenBalance < cost.total) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: `INSUFFICIENT_TOKENS: this plan needs ${cost.total} 🪙, you have ${ctx.user.tokenBalance} 🪙`,
        });
      }
      const reason = `lesson-path: ${input.description.slice(0, 60)}`;
      await applyTokenDelta(ctx.user.id, -cost.total, reason);

      let draft: import("../ai/prompts.js").LessonPathDraft;
      let usedMock = false;
      try {
        // Fold any uploaded attachment into reference material: text files
        // directly, and images (menus, catalogs) read out via vision.
        let reference = (input.referenceText ?? "").trim();
        if (input.webSearch) {
          const r = await webResearch(ctx.user.id, input.description);
          if (r?.text) reference = `${reference}\n\n[Current web-verified facts]\n${r.text}`.trim();
        }
        if (input.referenceImages && input.referenceImages.length > 0) {
          try {
            const vision = await completeVision({
              userId: ctx.user.id,
              system:
                "You transcribe attached documents (menus, catalogs, syllabi, notes, photos) into plain text so a structured repository can be built from them. List every readable item, section, name, price and detail. No commentary.",
              userText: `Attachment(s) for: ${input.description.slice(0, 200)}`,
              images: input.referenceImages,
              maxTokens: 1500,
            });
            if (vision?.text) {
              reference = `${reference}\n\n[Read from attached image(s)]\n${vision.text}`.trim();
            }
          } catch (err) {
            console.warn("[generate.lessonPath] attachment vision failed:", err);
          }
        }
        const prompt = buildLessonPathPrompt({
          description: input.description,
          template: input.template,
          unitCount: input.unitCount,
          lessonsPerUnit: input.lessonsPerUnit,
          reference: reference || undefined,
        });
        let parsed: import("../ai/prompts.js").LessonPathDraft | null = null;
        const providerErrors: string[] = [];
        for (let attempt = 0; attempt < 2 && parsed === null; attempt++) {
          try {
            const result = await completeText({
              userId: ctx.user.id,
              collectErrors: providerErrors,
              messages: [
                { role: "system", content: prompt },
                {
                  role: "user",
                  content:
                    attempt === 0
                      ? input.description
                      : `${input.description}\n\nReminder: STRICT JSON ONLY, exactly the requested shape.`,
                },
              ],
              maxTokens: 4096,
            });
            if (!result) break; // no key → mock below
            parsed = lessonPathSchema.parse(JSON.parse(extractJson(result.text)));
          } catch (err) {
            console.warn(`[generate.lessonPath] LLM parse attempt ${attempt + 1} failed:`, err);
          }
        }
        usedMock = parsed === null;
        if (parsed === null && !mockAiAllowed()) {
          await refundTokens(ctx.user.id, cost.total, `refund: ${reason}`);
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: aiUnavailableMessage(providerErrors),
          });
        }
        draft = parsed ?? mockLessonPath({
          description: input.description,
          template: input.template,
          unitCount: input.unitCount,
          lessonsPerUnit: input.lessonsPerUnit,
        });
      } catch (err) {
        if (err instanceof TRPCError) throw err; // already refunded above
        await refundTokens(ctx.user.id, cost.total, `refund: ${reason}`);
        console.error("[generate.lessonPath] generation failed, refunded:", err);
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Generation failed — tokens refunded" });
      }

      try {
        const db = getDb();
        const toolSlug = await uniqueSlug("slideTools", slugify(draft.toolName));
        const repoSlug = await uniqueSlug("repos", slugify(draft.title));
        const totalLessons = draft.units.reduce((n, u) => n + u.lessons.length, 0);
        if (totalLessons === 0) throw new Error("Draft contains no lessons");

        await db.transaction(async (tx) => {
          const [{ id: newToolId }] = await tx
            .insert(slideTools)
            .values({
              slug: toolSlug,
              name: draft.toolName,
              description: draft.description,
              ownerId: ctx.user.id,
              topic: draft.toolTopic,
              instructions: draft.toolInstructions,
              defaultLevel: input.level,
              defaultSlideCount: input.slideCount,
              defaultImageStyle: input.imageStyle,
              isPublic: true,
            })
            .returning({ id: slideTools.id });
          void newToolId;
          const [{ id: newRepoId }] = await tx
            .insert(repos)
            .values({
              slug: repoSlug,
              ref: repoRef(repoSlug),
              title: draft.title,
              description: draft.description,
              template: input.template,
              ownerId: ctx.user.id,
              studyToolSlug: toolSlug,
              isPublic: true,
            })
            .returning({ id: repos.id });
          let seq = 0;
          for (let u = 0; u < draft.units.length; u++) {
            const unit = draft.units[u];
            const [{ id: unitId }] = await tx
              .insert(units)
              .values({ repoId: newRepoId, title: unit.title, orderIndex: u })
              .returning({ id: units.id });
            for (let l = 0; l < unit.lessons.length; l++) {
              seq += 1;
              await tx.insert(lessons).values({
                unitId,
                title: unit.lessons[l].title,
                objective: unit.lessons[l].objective,
                orderIndex: l,
                globalSeq: seq,
              });
            }
          }
        });

        const fresh = await getDb().query.users.findFirst({ where: eq(users.id, ctx.user.id) });
        return {
          repoSlug,
          toolSlug,
          ref: repoRef(repoSlug),
          cost: cost.total,
          balance: fresh?.tokenBalance ?? ctx.user.tokenBalance - cost.total,
          usedMock,
        };
      } catch (err) {
        await refundTokens(ctx.user.id, cost.total, `refund: ${reason}`);
        console.error("[generate.lessonPath] persistence failed, refunded:", err);
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Could not save the notebook — tokens refunded" });
      }
    }),

  /* ---------------- slide deck generation ---------------------- */
  slides: publicQuery
    .input(
      z.object({
        toolSlug: z.string().min(1),
        topic: z.string().max(2000).optional(),
        instructions: z.string().max(4000).optional(),
        level: levelSchema,
        slideCount: z.number().int().min(1).max(MAX_SLIDES),
        imageStyle: imageStyleSchema,
        // Advanced: teaching tone / voice for the whole deck (register + how
        // much field terminology). Independent of the CEFR reading level.
        tone: toneSchema.default("neutral"),
        // Purpose override from the tool page's category selector. Commercial =
        // a product/menu/service showcase (no evaluations).
        purpose: z.enum(["education", "commercial", "walkthrough", "news"]).optional(),
        // How much explanatory text each slide carries (advanced setting).
        textDensity: z.enum(["minimal", "brief", "standard", "detailed"]).default("standard"),
        // Subject override for template filtering: "auto" detects from the
        // topic; "stem"/"humanities" force the catalog the author chose.
        subject: z.enum(["auto", "stem", "humanities"]).default("auto"),
        // News decks only: the moment in time the briefing reports from.
        newsPeriod: z.string().max(200).optional(),
        // Search the web for current facts about the topic first (accuracy for
        // real products / news / anything time-sensitive).
        webSearch: z.boolean().default(false),
        // Advanced: pin a specific layout template per slide (by template
        // name). null / missing entry = let the AI choose. Index i → slide i+1.
        templatePlan: z.array(z.string().max(120).nullable()).max(MAX_SLIDES).optional(),
        seed: z
          .object({
            repoSlug: z.string(),
            repoRef: z.string(),
            unitTitle: z.string(),
            lessonTitle: z.string(),
            lessonIndex: z.number().int(),
            lessonCount: z.number().int(),
            lessonSeq: z.number().int(),
            lessonSeqTotal: z.number().int(),
          })
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }): Promise<{
      deck: SlideDeck;
      usedMock: boolean;
      cost: number;
      balance: number | null;
      previouslyTaught: string | null;
      slidePlan: import("../../contracts/types.js").SlidePlanInfo[];
      commercial: import("../../contracts/types.js").CommercialInfo | null;
      walkthrough: import("../../contracts/types.js").WalkthroughInfo | null;
      author: { ownerId: number | null; name: string } | null;
    }> => {
      const db = getDb();
      const tool = await db.query.slideTools.findFirst({
        where: eq(slideTools.slug, input.toolSlug),
      });
      if (!tool) throw new TRPCError({ code: "NOT_FOUND", message: "Slide tool not found" });

      // No anonymous AI: every generation belongs to a signed-in user and is
      // paid for from that user's balance (or a gifted ticket) below.
      if (!ctx.user) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "Sign in to generate slides — every generation is charged to your account." });
      }
      const slideCount = input.slideCount;

      // Resolve topic/instructions: explicit input > lesson objective (seed) > tool defaults
      // Fall back to the tool's NAME when there's no explicit topic, so a tool
      // simply titled "Aura Ring" showcases the Aura Ring — not random items.
      let topic = input.topic?.trim() || tool.topic?.trim() || tool.name;
      let instructions = input.instructions ?? tool.instructions;
      let previouslyTaught: string | null = null;
      // Base purpose from the tool's own category (course = education,
      // restaurant/service/shop = commercial); a seed repo or an explicit
      // override refine it below.
      let purpose: import("../../contracts/types.js").RepoPurpose = repoPurpose(tool.template);
      let commercial: import("../../contracts/types.js").CommercialInfo | null = null;
      let walkthrough: import("../../contracts/types.js").WalkthroughInfo | null = null;
      let seedRepo: Repo | null = null;
      if (input.seed) {
        const repo = await db.query.repos.findFirst({ where: eq(repos.slug, input.seed.repoSlug) });
        if (repo) {
          seedRepo = repo;
          purpose = repoPurpose(repo.template);
          if (purpose === "commercial" && repo.ownerId) {
            const owner = await db.query.users.findFirst({ where: eq(users.id, repo.ownerId) });
            if (owner) {
              commercial = {
                owner: {
                  ownerId: owner.id,
                  name: owner.name,
                  whatsapp: owner.whatsapp ?? null,
                  socials: Array.isArray(owner.socials) ? (owner.socials as string[]) : [],
                  contactNote: owner.contactNote ?? null,
                },
                itemTitle: input.seed.lessonTitle || repo.title,
                repoSlug: input.seed.repoSlug,
                lessonSeq: input.seed.lessonSeq,
              };
            }
          }
          const repoUnits = await db.select().from(units).where(eq(units.repoId, repo.id));
          const unitIds = repoUnits.map((u) => u.id);
          for (const unitId of unitIds) {
            const lesson = await db.query.lessons.findFirst({
              where: (l, { and, eq: e }) => and(e(l.unitId, unitId), e(l.globalSeq, input.seed!.lessonSeq)),
            });
            if (lesson) {
              if (!input.topic) topic = lesson.objective;
              if (!input.instructions) instructions = lesson.objective;
              break;
            }
          }
          previouslyTaught = await buildPreviouslyTaught(repo.id, input.seed.lessonSeq, ctx.user?.id);
        }
      }
      // The tool page's category selector wins (client is authoritative for a
      // standalone tool while its saved category catches up).
      if (input.purpose) purpose = input.purpose;
      // Standalone commercial tool → contact screen from the tool's owner.
      if (purpose === "commercial" && !commercial && !input.seed && tool.ownerId) {
        const owner = await db.query.users.findFirst({ where: eq(users.id, tool.ownerId) });
        if (owner) {
          commercial = {
            owner: {
              ownerId: owner.id,
                  name: owner.name,
              whatsapp: owner.whatsapp ?? null,
              socials: Array.isArray(owner.socials) ? (owner.socials as string[]) : [],
              contactNote: owner.contactNote ?? null,
            },
            itemTitle: (input.topic?.trim() || tool.name).slice(0, 255),
            repoSlug: null,
            lessonSeq: null,
          };
        }
      }
      // Walkthrough and news decks read straight through and end on an
      // author/back screen — resolve the author (the seed repo's owner, or the
      // standalone tool's owner) so the finish can link their profile. A null
      // owner just omits the profile link.
      if (purpose === "walkthrough" || purpose === "news") {
        const ownerId = seedRepo?.ownerId ?? (!input.seed ? tool.ownerId : null);
        const owner = ownerId
          ? await db.query.users.findFirst({ where: eq(users.id, ownerId) })
          : null;
        walkthrough = {
          ownerId: owner?.id ?? null,
          ownerName: owner?.name ?? "",
          itemTitle: (input.seed?.lessonTitle || input.topic?.trim() || tool.name).slice(0, 255),
          kind: purpose === "news" ? "news" : "walkthrough",
        };
      }

      // Token gate — signed-in users only; guests get the free limited path.
      // Two paid paths:
      //  • OWNER builds their own repo (or a standalone tool): charged in
      //    credits, as usual — owners buy credits from the admin.
      //  • A NON-OWNER customizing someone's repo spends a customization
      //    TICKET the owner gifted them; personal credits are never charged
      //    for repo customization. The ticket is priced to cover the most
      //    expensive possible deck, so it always fully covers this one.
      let cost = 0;
      let reason = "";
      let spendTicketOnRepo: number | null = null;
      if (ctx.user) {
        const isRepoOwner = seedRepo
          ? seedRepo.ownerId === ctx.user.id || ctx.user.role === "admin"
          : false;
        if (seedRepo && !isRepoOwner) {
          const available = await countAvailable(ctx.user.id, seedRepo.id);
          if (available < 1) {
            throw new TRPCError({
              code: "FORBIDDEN",
              message:
                "NEED_TICKET: customizing this repo needs a ticket from its owner. You can still watch the free version.",
            });
          }
          // Consumed on success (below) so a failed generation costs nothing.
          spendTicketOnRepo = seedRepo.id;
          reason = `slides: ${tool.slug} (ticket · ${slideCount} slides)`;
        } else {
          const usingOwnKey = await userHasKey(ctx.user.id, "text");
          const estimate = await estimateCost({
            slideCount,
            imageStyle: input.imageStyle,
            withTts: false,
            level: input.level,
            usingOwnKey,
          });
          if (ctx.user.tokenBalance < estimate.total) {
            throw new TRPCError({
              code: "FORBIDDEN",
              message: `INSUFFICIENT_TOKENS: this deck needs ${estimate.total} 🪙, you have ${ctx.user.tokenBalance} 🪙`,
            });
          }
          cost = estimate.total;
          reason = `slides: ${tool.slug} (${slideCount} slides)`;
          await applyTokenDelta(ctx.user.id, -cost, reason);
        }
      }

      // Offer the AI only the layouts that fit this topic's subject area AND
      // this deck's difficulty level (beginner=lighter text, advanced=denser).
      // The same filtered set is used to VALIDATE that each generated slide
      // conforms to an approved configuration (so text is guaranteed because
      // every template pairs its visuals with a text step).
      const catalog = await loadTemplateCatalog();
      // The author's explicit subject choice beats detection — a derivatives
      // lesson misread as humanities must still get the STEM catalog.
      const stemActive =
        input.subject === "stem" ? true : input.subject === "humanities" ? false : isStemTopic(topic);
      let allowedTemplates = templatesForContext(catalog, {
        purpose: templateFilterPurpose(purpose),
        stem: stemActive,
        level: input.level,
      });
      // A news briefing reads like a newspaper: give it the image-forward
      // showcase layouts too (photo + prose + optional table), on top of the
      // explanatory ones, so every story can be a headline + photo + summary
      // with the occasional table/chart.
      if (purpose === "news") {
        const imageForward = templatesForContext(catalog, {
          purpose: "commercial",
          stem: stemActive,
          level: input.level,
        });
        const seen = new Set(allowedTemplates.map((t) => t.name));
        allowedTemplates = [...allowedTemplates, ...imageForward.filter((t) => !seen.has(t.name))];
      }
      // Minimum distinct body paragraphs a teaching slide must carry at this
      // CEFR band — a C1 deck must not ship slides with a single short line.
      // Mirrors the PARAGRAPH FLOOR stated in the system prompt.
      const baseParaFloor = ["C1", "C2"].includes(input.level)
        ? 4
        : ["B1", "B2"].includes(input.level)
          ? 3
          : input.level === "A2"
            ? 2
            : 1;
      // A walkthrough is an explanation, so it must carry written text even at
      // low levels — at least two paragraphs per content slide.
      const purposeParaFloor = purpose === "walkthrough" ? Math.max(2, baseParaFloor) : baseParaFloor;
      // The advanced "text amount" setting shifts the floor up or down.
      const densityDelta =
        input.textDensity === "minimal" ? -99 : input.textDensity === "brief" ? -1 : input.textDensity === "detailed" ? 2 : 0;
      const paraFloor = Math.max(1, purposeParaFloor + densityDelta);
      // News summaries stay concise unless "detailed" is chosen.
      const newsMinParas = input.textDensity === "detailed" ? 2 : 1;
      const layoutTemplates = allowedTemplates.map((t) => ({
        name: t.name,
        tags: t.tags,
        components: t.components.map((c) => TEMPLATE_COMPONENT_LABELS[c]),
      }));

      // Advanced: a per-slide pinned template (chosen in the UI). Matched by
      // name against the FULL catalog so the user can pin any layout. When a
      // slide is pinned, its output must conform to exactly that template.
      const pinnedPlan: (typeof catalog[number] | null)[] = (input.templatePlan ?? [])
        .slice(0, slideCount)
        .map((name) =>
          name ? catalog.find((t) => t.name === name) ?? null : null,
        );
      const planLines = pinnedPlan
        .map((t, i) => {
          if (!t) return null;
          // spell out the exact deck component types the slide's JSON must
          // contain, and name the non-text pieces that must NOT be dropped
          const content = t.components.filter((c) => !GRADABLE_TYPES.includes(c));
          const hasEval = t.components.some((c) => GRADABLE_TYPES.includes(c));
          const mustInclude = content
            .filter((c) => c !== "prose")
            .map((c) => `a ${c} component (${TEMPLATE_COMPONENT_LABELS[c]})`);
          const proseCount = content.filter((c) => c === "prose").length;
          const typeArray = `[${content.map((c) => `"${c}"`).join(", ")}]`;
          // This layout expects N SEPARATE text blocks (each its own "prose"
          // component, rendered as its own row) — the player lays them out in
          // document order, so two paragraphs must be two prose components, not
          // one long block, or the "text → table → text" shape collapses.
          const proseRule =
            proseCount >= 2
              ? ` This layout has ${proseCount} separate text sections: emit ${proseCount} distinct "prose" components (each a real paragraph in its own array slot, in the order shown) — do NOT merge them into one.`
              : "";
          return `  • Slide ${i + 1} — layout "${t.name}": the slide's "components" array MUST contain these types, in this order: ${typeArray}${hasEval ? ', and the slide MUST have a "quiz"' : ""}.${mustInclude.length ? ` You MUST actually build ${mustInclude.join(" and ")} with real content on this slide — do NOT omit ${mustInclude.length > 1 ? "them" : "it"} or replace ${mustInclude.length > 1 ? "them" : "it"} with more paragraphs.` : ""}${proseRule}`;
        })
        .filter(Boolean);

      const systemPrompt = buildSlidesSystemPrompt({
        level: input.level,
        imageStyle: input.imageStyle,
        tone: input.tone,
        purpose,
        textDensity: input.textDensity,
        newsPeriod: purpose === "news" ? input.newsPeriod?.trim() || undefined : undefined,
        subject: topic,
        previouslyTaught,
        layoutTemplates,
      });
      // Optional web search first, so the deck is built on current facts.
      let webNotes: string | null = null;
      if (input.webSearch) {
        const r = await webResearch(ctx.user?.id, `${topic}${instructions && instructions !== topic ? ` — ${instructions}` : ""}`);
        webNotes = r?.text ?? null;
      }
      const userPrompt = [
        `TOPIC: ${topic}`,
        instructions && instructions !== topic ? `INSTRUCTIONS: ${instructions}` : null,
        webNotes
          ? `CURRENT, WEB-VERIFIED FACTS (use these as the source of truth; do NOT contradict them or invent capabilities beyond them):\n${webNotes.slice(0, 4000)}`
          : null,
        `Write exactly ${slideCount} slides.`,
        planLines.length > 0
          ? `SLIDE PLAN (MANDATORY) — the user has PINNED an exact layout for the slides listed below. This overrides your own layout choice for those slides: you MUST build each listed slide with exactly the component types shown, including every table/chart/image/code/formula/diagram called for (with real content about the topic — e.g. a topic-relevant table even if the layout name mentions grammar). For any slide number NOT listed, choose a fitting layout from the catalog.\n${planLines.join("\n")}`
          : null,
        input.seed
          ? `This is lesson ${input.seed.lessonSeq} of ${input.seed.lessonSeqTotal} ("${input.seed.lessonTitle}", unit "${input.seed.unitTitle}") in the repository "${input.seed.repoSlug}".`
          : null,
      ]
        .filter(Boolean)
        .join("\n");

      // Why each provider refused — so a total failure names the cause
      // instead of the useless "no provider produced content".
      const providerErrors: string[] = [];
      let deck: SlideDeck | null = null;
      let lastAttempt: SlideDeck | null = null; // best non-conforming try, as a fallback
      let usedMock = false;
      let textProvider: import("../../contracts/types.js").AiProvider | null = null;
      // A pinned SLIDE PLAN is an explicit user request, so give the model
      // more chances to honor it exactly before we accept a miss.
      const hasPlan = pinnedPlan.some(Boolean);
      const maxAttempts = hasPlan ? 3 : 2;
      /**
       * One deadline for the whole request. vercel.json caps the invocation at
       * 60s, and everything past this point — retries, the inline first image,
       * saving the run — has to fit inside what the deck attempt leaves behind.
       * Measured from real usage, a deck is ~5.5k output tokens, which a
       * provider takes 35-55s to write, so the deck attempt legitimately needs
       * most of the budget and the rest must yield to it rather than compete.
       */
      const startedAt = Date.now();
      const HARD_CEILING_MS = 60_000;
      const elapsed = () => Date.now() - startedAt;
      const remaining = () => HARD_CEILING_MS - elapsed();
      try {
        for (let attempt = 0; attempt < maxAttempts && deck === null; attempt++) {
          // A retry is only worth starting if a reply could still arrive.
          if (attempt > 0 && remaining() < 15_000) {
            console.warn(
              `[generate.slides] skipping attempt ${attempt + 1}: ${Math.round(remaining() / 1000)}s left`,
            );
            break;
          }
          try {
            const result = await completeText({
              userId: ctx.user?.id,
              // completeText orders candidates so these hit DIFFERENT services
              // — otherwise a platform key and an env key for the same API eat
              // both slots and the other providers, healthy and configured,
              // are never asked.
              //
              // budgetMs is a ceiling for BOTH tries together, not a slice
              // each. That distinction is the whole fix: a deck needs 35-55s
              // to write, so splitting the budget in half guaranteed two
              // timeouts where one longer attempt would have succeeded. The
              // first candidate may now use nearly all of it, and only a
              // candidate that fails FAST leaves the rest to the next one.
              maxCandidates: 2,
              timeoutMs: 45_000,
              budgetMs: Math.max(10_000, remaining() - 8_000),
              collectErrors: providerErrors,
              messages: [
                { role: "system", content: systemPrompt },
                {
                  role: "user",
                  content:
                    attempt === 0
                      ? userPrompt
                      : `${userPrompt}\n\nReminder: STRICT JSON ONLY, exactly the requested shape. Return EXACTLY ${slideCount} slides — no fewer. EVERY slide MUST follow one of the SLIDE LAYOUT TEMPLATES exactly — include all of its steps, so any image/chart/table/diagram/formula/code is paired with the text that explains it. Never a slide that is only a visual and a question.${hasPlan ? " Your previous attempt did NOT honor the MANDATORY SLIDE PLAN — for each pinned slide, the 'components' array MUST include the exact table/chart/image/code/formula/diagram it lists, built with real content. Do not drop them." : ""}`,
                },
              ],
              // A full deck is a large JSON; leave generous headroom so the
              // model's output is never truncated mid-object (providers clamp
              // this to their own per-model maximums).
              maxTokens: 16384,
            });
            if (!result) break; // no key configured → mock
            textProvider = result.provider;
            const repaired = repairDeckDraft(JSON.parse(extractJson(result.text)), {
              level: input.level,
              imageStyle: input.imageStyle,
              topic,
            });
            const parsedDeck = slideDeckSchema.parse(repaired);
            // Each slide must conform to one of the approved layout templates
            // (a text-less visual+question slide matches none of them). Give
            // the model one more attempt to follow the catalog before we
            // accept the deck (final safety net fills any gap below).
            const nonConforming =
              allowedTemplates.length > 0 &&
              parsedDeck.slides.some((s, i) => {
                const shape = {
                  componentTypes: s.components.map((c) => c.type),
                  hasQuiz: !!s.quiz,
                };
                const pinned = pinnedPlan[i];
                // a pinned slide must match its chosen template EXACTLY (strict
                // prose count, so every text block it lists is produced);
                // others just need to match any allowed layout
                const structOk = pinned
                  ? slideConformsToTemplate(shape, pinned, true)
                  : slideConformsToAny(shape, allowedTemplates);
                // A "solve" slide is a problem statement, and commercial
                // showcase slides are listing copy — both should be as long as
                // they need, so they're exempt from the CEFR paragraph floor.
                if (purpose === "commercial" || s.quiz?.kind === "solve") return !structOk;
                // Otherwise a teaching slide must carry the CEFR paragraph floor
                // of distinct body paragraphs, so a C1 slide can't ship as one
                // short line. Count paragraphs across every prose component.
                const paraCount = s.components.reduce(
                  (n, c) => n + (c.type === "prose" ? c.paragraphs.length : 0),
                  0,
                );
                // A news slide is a newspaper clipping: it must carry a written
                // summary AND (unless images are off) a photo — never a bare
                // headline, and never a headline with only a picture.
                if (purpose === "news") {
                  const hasImage = s.components.some((c) => c.type === "image");
                  const needsImage = input.imageStyle !== "none";
                  return !structOk || paraCount < newsMinParas || (needsImage && !hasImage);
                }
                // "Detailed" is a promise of a real READING activity: enforce
                // a hard word floor per teaching slide so the setting visibly
                // changes the output instead of being advisory.
                const proseWords = s.components.reduce(
                  (n, c) =>
                    n + (c.type === "prose" ? c.paragraphs.join(" ").split(/\s+/).filter(Boolean).length : 0),
                  0,
                );
                const wordFloor =
                  input.textDensity === "detailed" ? 220 : input.textDensity === "standard" ? 110 : 0;
                return !structOk || paraCount < paraFloor || proseWords < wordFloor;
              });
            // The model sometimes under-delivers (e.g. 3 slides when 8 were
            // asked). Retry (up to maxAttempts) before accepting a miss.
            const tooFewSlides = parsedDeck.slides.length < slideCount;
            if (attempt < maxAttempts - 1 && (nonConforming || tooFewSlides)) {
              console.warn(
                tooFewSlides
                  ? `[generate.slides] model returned ${parsedDeck.slides.length}/${slideCount} slides — retry ${attempt + 1}/${maxAttempts - 1}`
                  : `[generate.slides] a slide did not match its ${hasPlan ? "pinned" : "approved"} template — retry ${attempt + 1}/${maxAttempts - 1}`,
              );
              // keep the fullest attempt so far as a fallback
              if (!lastAttempt || parsedDeck.slides.length > lastAttempt.slides.length) {
                lastAttempt = parsedDeck;
              }
              continue;
            }
            deck = parsedDeck;
          } catch (err) {
            const detail =
              err instanceof z.ZodError
                ? JSON.stringify(err.issues.slice(0, 5))
                : err instanceof Error
                  ? err.message
                  : String(err);
            console.warn(`[generate.slides] LLM parse attempt ${attempt + 1} failed:`, detail);
          }
        }
      } catch (err) {
        console.error("[generate.slides] provider error:", err);
      }

      // Both attempts under-delivered but the model did return usable slides —
      // ship its best try rather than falling through to mock/error.
      if (!deck && lastAttempt) {
        console.warn(
          `[generate.slides] accepting best attempt with ${lastAttempt.slides.length}/${slideCount} slides`,
        );
        deck = lastAttempt;
      }

      if (!deck) {
        if (!mockAiAllowed()) {
          if (ctx.user && cost > 0) await refundTokens(ctx.user.id, cost, `refund: ${reason}`);
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: aiUnavailableMessage(providerErrors),
          });
        }
        usedMock = true;
        deck = mockDeck({
          topic,
          level: input.level,
          slideCount,
          imageStyle: input.imageStyle,
          previouslyTaught,
        });
      }
      // Enforce the requested slide count even if the model drifted
      const imageProvider =
        !usedMock && input.imageStyle !== "none"
          ? await resolveProviderName(ctx.user?.id, "image")
          : null;
      deck = {
        ...deck,
        slides: deck.slides.slice(0, slideCount),
        level: input.level,
        imageStyle: input.imageStyle,
        provider: usedMock ? null : textProvider,
        imageProvider,
      };
      // Commercial showcases and walkthroughs never carry an evaluation —
      // strip any quiz the model (or the mock) produced. Only true education
      // decks keep quizzes.
      if (purpose !== "education") {
        deck = { ...deck, slides: deck.slides.map((s) => ({ ...s, quiz: undefined })) };
      }
      // Guarantee every slide has explanatory text — no image-only slides ship
      deck = ensureExplanatoryProse(deck, purpose, topic);
      // Randomize each quiz's correct-answer position (models almost always
      // put the answer first, so otherwise every question is "A").
      deck = shuffleQuizAnswers(deck);

      // AI naming: a tool created without a name stays "Untitled …" until its
      // first successful generation, then takes its identity from the AI's own
      // deck — the opening slide's title (a headline, for news) becomes the
      // name and the first written paragraph becomes the description. A
      // custom name/description typed in the tool's settings is never touched.
      if (/^untitled\b/i.test(tool.name.trim())) {
        const firstParagraph = deck.slides
          .flatMap((s) => s.components)
          .map((c) => (c.type === "prose" ? c.paragraphs?.[0] : null))
          .find((p): p is string => !!p?.trim());
        const autoName = (
          purpose === "news" && input.newsPeriod?.trim()
            ? `${(input.topic?.trim() || topic).replace(/\s+news$/i, "")} News — ${input.newsPeriod.trim()}`
            : deck.slides[0]?.title?.trim() || topic
        ).slice(0, 255);
        const set: { name: string; description?: string } = { name: autoName };
        if (!tool.description?.trim() && firstParagraph) {
          set.description = firstParagraph.slice(0, 500);
        }
        try {
          await db.update(slideTools).set(set).where(eq(slideTools.id, tool.id));
        } catch (err) {
          console.warn("[generate.slides] auto-naming failed (deck unaffected):", err instanceof Error ? err.message : err);
        }
      }

      // Eagerly generate ONLY the first slide's image inline so slide 1 opens
      // with its picture already in place (no visible wait on the opening
      // slide). Every other slide's image still streams in lazily in the
      // player. Costs one image's latency, not the whole deck's.
      //
      // It is a nicety, so it yields: when the deck took most of the budget
      // there is no room for a picture that can take tens of seconds, and
      // spending the remainder on it would lose the finished deck to the
      // platform's timeout. The player fetches this image lazily anyway — the
      // only cost of skipping is a brief placeholder on slide 1.
      const IMAGE_NEEDS_MS = 20_000;
      if (input.imageStyle !== "none" && remaining() < IMAGE_NEEDS_MS) {
        console.warn(
          `[generate.slides] skipping the inline first image: ${Math.round(remaining() / 1000)}s left — the player will fetch it`,
        );
      } else if (input.imageStyle !== "none" && deck.slides.length > 0) {
        const firstImg = deck.slides[0].components.find((c) => c.type === "image");
        if (firstImg && firstImg.type === "image" && !firstImg.imageUrl) {
          try {
            const made = await generateImageDetailed({
              userId: ctx.user?.id,
              prompt: firstImg.prompt,
              style: input.imageStyle,
            });
            if (made) {
              firstImg.imageUrl = made.url;
              // Credit whoever actually SERVED the picture, not whoever sat at
              // the top of the candidate list. With a fallback chain those are
              // routinely different, and crediting Gemini for an Unsplash
              // photograph would be a false claim about its origin.
              deck = { ...deck, imageProvider: made.provider };
            }
          } catch (err) {
            console.warn(
              "[generate.slides] first-slide image failed (player will lazy-load it):",
              err instanceof Error ? err.message : err,
            );
          }
        }
      }

      // NOTE: images are NOT generated here. Generating up to N images inline
      // (each up to 60s) was the dominant cause of the long "dealing your
      // deck" wait. The deck now returns as soon as the text is ready, and the
      // player lazily fetches each slide's image via generate.slideImage as
      // the learner advances (current + next prefetched). Until an image
      // arrives the player shows the style thumbnail, so nothing looks broken.

      // Per-slide layout info for the admin diagnostic badge: the pinned
      // template (what the AI was told to use) or the best-matching layout the
      // AI actually produced.
      const slidePlan = deck.slides.map((s, i) => {
        const shape = { componentTypes: s.components.map((c) => c.type), hasQuiz: !!s.quiz };
        const pinned = pinnedPlan[i];
        if (pinned) {
          return { template: pinned.name, pinned: true, components: pinned.components as string[] };
        }
        const match = bestMatchingTemplate(shape, allowedTemplates);
        // Show the slide's ACTUAL component sequence (not the matched
        // template's ideal one) so the badge never claims more text sections
        // than the slide really has. Append the real quiz kind as its step.
        const quizStep =
          s.quiz &&
          ({ mcq: "quiz", mcq2: "mcq2", fillblank: "fillblank", typed: "shortanswer", solve: "solve" }[
            s.quiz.kind ?? "mcq"
          ] as string);
        const realComponents = [
          ...s.components.map((c) => c.type),
          ...(quizStep ? [quizStep] : []),
        ];
        return {
          template: match?.name ?? null,
          pinned: false,
          components: realComponents,
        };
      });

      // The customization succeeded — spend the ticket now (skip mock decks,
      // which cost nothing to make).
      if (spendTicketOnRepo != null && ctx.user && !usedMock) {
        await consumeOne(ctx.user.id, spendTicketOnRepo);
      }

      let balance: number | null = null;
      if (ctx.user) {
        const fresh = await db.query.users.findFirst({ where: eq(users.id, ctx.user.id) });
        balance = fresh?.tokenBalance ?? null;
      }
      // Every ending shows who made the deck: resolve the author for lesson
      // decks too (commercial/walkthrough/news already carry their owner).
      let author: { ownerId: number | null; name: string } | null = null;
      if (walkthrough) {
        author = { ownerId: walkthrough.ownerId, name: walkthrough.ownerName };
      } else if (commercial) {
        author = { ownerId: commercial.owner.ownerId ?? null, name: commercial.owner.name };
      } else {
        const authorId = seedRepo?.ownerId ?? (!input.seed ? tool.ownerId : null);
        const owner = authorId
          ? await db.query.users.findFirst({ where: eq(users.id, authorId) })
          : null;
        if (owner) author = { ownerId: owner.id, name: owner.name };
      }
      return { deck, usedMock, cost, balance, previouslyTaught, slidePlan, commercial, walkthrough, author };
    }),

  /**
   * Admin/moderator: recalibrate the LENGTH of one slide's explanation without
   * changing its meaning or reading level. "longer" expands the same point
   * (reinforcing it from a fresh angle or a closely-related supporting idea
   * when there's nothing genuinely new to add); "shorter" compresses it to
   * fewer words while keeping the core idea. Returns the rewritten paragraphs.
   * Admins use it free; moderators are charged a small fee (waived when they
   * bring their own text key).
   */
  recalibrateProse: moderatorProcedure
    .input(
      z.object({
        paragraphs: z.array(z.string().max(4000)).min(1).max(12),
        direction: z.enum(["shorter", "longer"]),
        level: levelSchema,
        subject: z.string().max(500).optional(),
        slideTitle: z.string().max(300).optional(),
      }),
    )
    .mutation(async ({ ctx, input }): Promise<{ paragraphs: string[] }> => {
      const original = input.paragraphs.map((p) => p.trim()).filter(Boolean);
      if (original.length === 0) return { paragraphs: input.paragraphs };

      // Moderators pay a small fee for this AI edit; admins don't, and a BYOK
      // text key waives it. Refunded below if the provider produced nothing.
      let charged = 0;
      if (ctx.user.role === "moderator") {
        const usingOwnKey = await userHasKey(ctx.user.id, "text");
        if (!usingOwnKey) {
          if (ctx.user.tokenBalance < RECALIBRATE_COST) {
            throw new TRPCError({
              code: "FORBIDDEN",
              message: `INSUFFICIENT_TOKENS: this needs ${RECALIBRATE_COST} 🪙, you have ${ctx.user.tokenBalance} 🪙`,
            });
          }
          await applyTokenDelta(ctx.user.id, -RECALIBRATE_COST, "slide text recalibration");
          charged = RECALIBRATE_COST;
        }
      }

      const longer = input.direction === "longer";
      const system = `You are an editor recalibrating the LENGTH of one slide's explanation for a CEFR level "${input.level}" reader. You output ONLY JSON: {"paragraphs": string[]}.

RULES (non-negotiable):
- Keep the SAME core idea(s) and the SAME reading level "${input.level}" — do NOT make the language harder or easier, only ${longer ? "longer" : "shorter"}.
- ${
        longer
          ? `MAKE IT ~20% LONGER — a GENTLE step up, NOT a big jump. Add roughly one-fifth more words than the current text: go a little deeper on the SAME idea, or reference/relate a supporting idea that cements the current point, or restate a key part more fully — never pad with filler or repeat sentences verbatim. Think of it as steeping one notch deeper into the topic, not rewriting it.`
          : `MAKE IT ~20% SHORTER — a GENTLE step down, NOT a big cut. Remove roughly one-fifth of the words: trim redundancy and the least-essential detail while keeping the core idea and its supporting points intact.`
      }
- Do NOT add questions, quizzes, headings, markdown, or meta-commentary. Return plain prose paragraphs only.
- Keep the paragraph structure close to the current text (a similar number of paragraphs); this is a small adjustment, not a rewrite. Return between 1 and ${longer ? original.length + 1 : Math.max(1, original.length)} paragraphs.`;

      const userPrompt = [
        input.slideTitle ? `SLIDE TITLE: ${input.slideTitle}` : null,
        input.subject ? `TOPIC: ${input.subject}` : null,
        `CURRENT EXPLANATION (${original.length} paragraph${original.length === 1 ? "" : "s"}):`,
        original.map((p, i) => `[${i + 1}] ${p}`).join("\n\n"),
        `Rewrite it ${longer ? "LONGER" : "SHORTER"} per the rules. Output JSON {"paragraphs": [...]}.`,
      ]
        .filter(Boolean)
        .join("\n\n");

      const result = await completeText({
        userId: ctx.user.id,
        messages: [
          { role: "system", content: system },
          { role: "user", content: userPrompt },
        ],
        maxTokens: longer ? 2000 : 1200,
      });
      if (!result) {
        if (charged) await refundTokens(ctx.user.id, charged, "refund: slide text recalibration");
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: AI_UNAVAILABLE_MSG });
      }
      try {
        const parsed = JSON.parse(extractJson(result.text)) as { paragraphs?: unknown };
        const out = Array.isArray(parsed.paragraphs)
          ? parsed.paragraphs.map((p) => String(p).trim()).filter(Boolean)
          : [];
        if (out.length === 0) return { paragraphs: original };
        return { paragraphs: out.slice(0, 6) };
      } catch {
        return { paragraphs: original };
      }
    }),

  /**
   * Admin/moderator, news decks: re-report ONE story as it stood in a different
   * time period — returns a fresh headline + summary. Web-grounded when a
   * web-capable key is available. Same charge rules as recalibrateProse.
   */
  retimeNewsSlide: moderatorProcedure
    .input(
      z.object({
        title: z.string().max(300),
        paragraphs: z.array(z.string().max(4000)).min(1).max(12),
        timePeriod: z.string().min(1).max(200),
        level: levelSchema,
        subject: z.string().max(500).optional(),
      }),
    )
    .mutation(async ({ ctx, input }): Promise<{ title: string; paragraphs: string[] }> => {
      let charged = 0;
      if (ctx.user.role === "moderator") {
        const usingOwnKey = await userHasKey(ctx.user.id, "text");
        if (!usingOwnKey) {
          if (ctx.user.tokenBalance < RECALIBRATE_COST) {
            throw new TRPCError({
              code: "FORBIDDEN",
              message: `INSUFFICIENT_TOKENS: this needs ${RECALIBRATE_COST} 🪙, you have ${ctx.user.tokenBalance} 🪙`,
            });
          }
          await applyTokenDelta(ctx.user.id, -RECALIBRATE_COST, "news re-time");
          charged = RECALIBRATE_COST;
        }
      }

      // Ground the re-timed story in facts for that period when possible.
      const web = await webResearch(
        ctx.user.id,
        `${input.subject ?? input.title} — news around ${input.timePeriod}`,
      ).catch(() => null);

      const system = `You are a news editor re-reporting ONE story for a DIFFERENT time period. Output ONLY JSON: {"title": string, "paragraphs": string[]}.
RULES:
- Report this beat AS IT STOOD during "${input.timePeriod}" — the headline and a 2-4 sentence summary must reflect what was happening THEN, not now, and must not include later developments.
- Keep it a factual news brief at CEFR reading level "${input.level}": a headline (the title) + a written summary covering what happened, who is involved, where/when, and why it mattered.
- If you lack specific facts for that period, describe the general state of this beat at that time in careful, non-committal terms; NEVER invent specific quotes, statistics, outlets, or events you are unsure of.
- Plain prose only — no markdown, no questions, no meta-commentary.`;
      const userPrompt = [
        input.subject ? `BEAT / TOPIC: ${input.subject}` : null,
        `ORIGINAL HEADLINE: ${input.title}`,
        `ORIGINAL SUMMARY:\n${input.paragraphs.join("\n\n")}`,
        web?.text
          ? `WEB-VERIFIED FACTS for ${input.timePeriod} (use as the source of truth, do not contradict):\n${web.text.slice(0, 3000)}`
          : null,
        `Re-report this as a news brief for "${input.timePeriod}". Output JSON {"title": "...", "paragraphs": ["...", ...]}.`,
      ]
        .filter(Boolean)
        .join("\n\n");

      const result = await completeText({
        userId: ctx.user.id,
        messages: [
          { role: "system", content: system },
          { role: "user", content: userPrompt },
        ],
        maxTokens: 1500,
      });
      if (!result) {
        if (charged) await refundTokens(ctx.user.id, charged, "refund: news re-time");
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: AI_UNAVAILABLE_MSG });
      }
      try {
        const parsed = JSON.parse(extractJson(result.text)) as { title?: unknown; paragraphs?: unknown };
        const title =
          typeof parsed.title === "string" && parsed.title.trim() ? parsed.title.trim() : input.title;
        const paragraphs = Array.isArray(parsed.paragraphs)
          ? parsed.paragraphs.map((p) => String(p).trim()).filter(Boolean)
          : [];
        return {
          title,
          paragraphs: paragraphs.length ? paragraphs.slice(0, 6) : input.paragraphs,
        };
      } catch {
        return { title: input.title, paragraphs: input.paragraphs };
      }
    }),

  /**
   * Generate ONE slide image on demand. The deck's image cost is already paid
   * at generation time, so this is not charged again — it just turns a slide's
   * image prompt into a data URI. The player calls it lazily per slide (current
   * + next prefetch) so the deck can open immediately instead of waiting for
   * every image up front. Returns null when no image key is configured or the
   * provider fails, and the player keeps the style-thumbnail fallback.
   */
  slideImage: publicQuery
    .input(
      z.object({
        prompt: z.string().min(1).max(2000),
        style: imageStyleSchema,
      }),
    )
    .mutation(async ({ ctx, input }): Promise<{ imageUrl: string | null }> => {
      if (input.style === "none") return { imageUrl: null };
      const imageUrl = await generateImage({
        userId: ctx.user?.id,
        prompt: input.prompt,
        style: input.style,
      });
      return { imageUrl };
    }),

  /**
   * Grade a typed free-text answer against the question's reference answer.
   * Uses the AI when a text key is configured; otherwise falls back to a
   * lenient token-overlap check so typed questions still work keyless.
   */
  gradeTyped: publicQuery
    .input(
      z.object({
        question: z.string().min(1).max(2000),
        reference: z.string().min(1).max(2000),
        answer: z.string().max(4000),
      }),
    )
    .mutation(async ({ ctx, input }): Promise<{ correct: boolean; feedback: string }> => {
      const student = input.answer.trim();
      if (!student) return { correct: false, feedback: "No answer was entered." };

      try {
        const result = await completeText({
          userId: ctx.user?.id,
          messages: [
            {
              role: "system",
              content:
                'You grade a student\'s typed answer against a reference answer. Judge MEANING: reward the right idea even with different wording, minor spelling slips, or imprecise terminology. BUT be strict about actual correctness — mark it WRONG if the answer is empty, random characters/gibberish, off-topic, or gives a different value/result than the reference (for a numeric or procedural answer the value must essentially match). Do NOT pass an answer just because it is non-empty. Reply STRICT JSON ONLY: {"correct":true|false,"feedback":"one short sentence of why"}.',
            },
            {
              role: "user",
              content: `QUESTION: ${input.question}\nREFERENCE ANSWER: ${input.reference}\nSTUDENT ANSWER: ${student}\n\nIs the student's answer correct in meaning? Reply JSON only.`,
            },
          ],
          maxTokens: 200,
        });
        if (result) {
          const parsed = JSON.parse(extractJson(result.text)) as {
            correct?: boolean;
            feedback?: string;
          };
          if (typeof parsed.correct === "boolean") {
            return {
              correct: parsed.correct,
              feedback:
                (parsed.feedback && String(parsed.feedback).slice(0, 300)) ||
                (parsed.correct ? "Correct." : "Not quite."),
            };
          }
        }
      } catch (err) {
        console.warn("[gradeTyped] AI grading failed, using overlap fallback:", err instanceof Error ? err.message : err);
      }

      // fallback: token overlap with the reference
      const correct = typedOverlapCorrect(student, input.reference);
      return {
        correct,
        feedback: correct
          ? "Looks right — you covered the key idea."
          : "Missing the key idea — compare with the explanation.",
      };
    }),

  /**
   * Grade a HANDWRITTEN worked solution: the student's scratchpad pages are
   * sent as images to a vision model, which reads the work across all pages
   * and judges whether the problem was solved correctly. Charges a small
   * token fee up front (refunded if the check can't run), since a vision
   * review costs more than a text one.
   */
  gradeVisual: publicQuery
    .input(
      z.object({
        question: z.string().min(1).max(2000),
        reference: z.string().min(1).max(2000),
        explanation: z.string().max(4000).default(""),
        // scratchpad pages as data URIs (data:image/png;base64,...)
        images: z.array(z.string().max(4_000_000)).min(1).max(8),
      }),
    )
    .mutation(async ({ ctx, input }): Promise<{ correct: boolean; feedback: string; charged: number }> => {
      // parse the data URIs into { mime, b64 }
      const images: VisionImage[] = [];
      for (const uri of input.images) {
        const m = uri.match(/^data:(.+?);base64,(.+)$/);
        if (m) images.push({ mime: m[1], b64: m[2] });
      }
      if (images.length === 0) {
        return { correct: false, feedback: "No worked solution was captured.", charged: 0 };
      }

      // charge a small fee up front (signed-in only) for the AI vision review
      let charged = 0;
      const reason = `grade-visual: ${input.question.slice(0, 40)}`;
      if (ctx.user) {
        try {
          await applyTokenDelta(ctx.user.id, -VISION_GRADE_COST, reason);
          charged = VISION_GRADE_COST;
        } catch {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: `INSUFFICIENT_TOKENS: an AI check of your work costs ${VISION_GRADE_COST} 🪙, and your balance is too low.`,
          });
        }
      }

      try {
        const result = await completeVision({
          userId: ctx.user?.id,
          system:
            'You grade a student\'s HANDWRITTEN worked solution, shown as one or more scratchpad page images (in order). Read all the pages, follow the working, and judge whether the PROBLEM WAS SOLVED CORRECTLY — the method may differ from the reference as long as the reasoning is valid and the final result matches. Mark it WRONG if the pages are blank, illegible scribbles, off-topic, or reach an incorrect result. Reply STRICT JSON ONLY: {"correct":true|false,"feedback":"one short sentence on what was right or where it went wrong"}.',
          userText: `PROBLEM: ${input.question}\nCORRECT FINAL ANSWER: ${input.reference}\nWORKED SOLUTION (reference): ${input.explanation}\n\nThe images are the student's ${images.length} scratchpad page(s), in order. Did the student solve it correctly? Reply JSON only.`,
          images,
          maxTokens: 400,
        });
        if (result) {
          const parsed = JSON.parse(extractJson(result.text)) as {
            correct?: boolean;
            feedback?: string;
          };
          if (typeof parsed.correct === "boolean") {
            return {
              correct: parsed.correct,
              feedback:
                (parsed.feedback && String(parsed.feedback).slice(0, 300)) ||
                (parsed.correct ? "Correct working." : "Not quite — check your steps."),
              charged,
            };
          }
        }
        // vision unavailable / unparseable → refund and let them proceed
        if (charged && ctx.user) {
          await refundTokens(ctx.user.id, charged, `refund: ${reason}`);
          charged = 0;
        }
        return {
          correct: false,
          feedback: "Couldn't read your work automatically — make sure it's legible, or move on.",
          charged,
        };
      } catch (err) {
        if (charged && ctx.user) {
          await refundTokens(ctx.user.id, charged, `refund: ${reason}`);
          charged = 0;
        }
        console.warn("[gradeVisual] failed:", err instanceof Error ? err.message : err);
        return {
          correct: false,
          feedback: "Couldn't check your work right now — please try again.",
          charged,
        };
      }
    }),

  /**
   * Auto-tune: read the author's prompt and recommend every generation
   * setting — level, slide count, image style, text density, and a full
   * per-slide template plan chosen from the real catalog (packets are 4
   * slides; for longer decks the AI fills every slide). Falls back to a
   * sensible heuristic when no AI provider answers, so the button always
   * does something useful.
   */
  tuneSettings: publicQuery
    .input(
      z.object({
        topic: z.string().min(3).max(2000),
        purpose: z.enum(["education", "commercial", "walkthrough", "news"]).default("education"),
        newsPeriod: z.string().max(200).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      rateLimit(clientKey(ctx.req), 10, 60_000);
      if (!ctx.user) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "Sign in to auto-tune settings." });
      }
      const catalog = await loadTemplateCatalog();
      const evalFree = input.purpose !== "education";
      // Only offer layouts that fit the purpose (news/walkthrough/commercial
      // never pin an evaluation-bearing layout the mode would then skip).
      const allowed = catalog.filter((t) =>
        evalFree ? t.tags.includes("commercial") || !t.components.some((c) => GRADABLE_TYPES.includes(c)) : true,
      );
      const names = allowed.map((t) => t.name);
      const recSchema = z.object({
        level: z.enum(["A0", "A1", "A2", "B1", "B2", "C1", "C2"]),
        slideCount: z.number().int().min(3).max(15),
        imageStyle: z.enum(["sketch", "watercolor", "flat", "photo", "none"]),
        textDensity: z.enum(["minimal", "brief", "standard", "detailed"]),
        templatePlan: z.array(z.string()).min(3).max(15),
      });
      const system = `You configure a slide-presentation generator. Reply with ONLY JSON: {"level":"A0..C2","slideCount":3-15,"imageStyle":"sketch|watercolor|flat|photo|none","textDensity":"minimal|brief|standard|detailed","templatePlan":[exactly slideCount layout names]}. Purpose of this deck: ${input.purpose}${input.newsPeriod ? ` (news from "${input.newsPeriod}")` : ""}. Choose settings that BEST fit the user's prompt: reading level from the implied audience, slide count from the scope, photo style for food/products, more images for menus/shops, denser text for scholarly topics. Every templatePlan entry MUST be exactly one of: ${names.join(" · ")}. Vary layouts; order them to open strong (image-led) and close with synthesis.`;
      try {
        const result = await completeText({
          userId: ctx.user?.id,
          messages: [
            { role: "system", content: system },
            { role: "user", content: `PROMPT: ${input.topic}` },
          ],
          maxTokens: 600,
          timeoutMs: 12_000,
          maxCandidates: 2,
        });
        if (result) {
          const rec = recSchema.parse(JSON.parse(extractJson(result.text)));
          const valid = new Set(names);
          const templatePlan = rec.templatePlan
            .slice(0, rec.slideCount)
            .map((n) => (valid.has(n) ? n : null));
          while (templatePlan.length < rec.slideCount) templatePlan.push(null);
          return { ...rec, templatePlan, source: "ai" as const };
        }
      } catch (err) {
        console.warn("[tuneSettings] AI recommendation failed, using heuristic:", err instanceof Error ? err.message : err);
      }
      // Heuristic fallback: purpose-shaped defaults + the first fitting packet.
      const packet = LESSON_PACKETS.find((p) => p.purpose === input.purpose);
      const slideCount = input.purpose === "commercial" ? 4 : 6;
      const plan: (string | null)[] = Array.from({ length: slideCount }, (_, i) => {
        const name = packet?.templates[i % (packet.templates.length || 1)] ?? null;
        return name && names.includes(name) ? name : null;
      });
      return {
        level: "B1" as const,
        slideCount,
        imageStyle: (input.purpose === "commercial" ? "photo" : "sketch") as "photo" | "sketch",
        textDensity: (input.purpose === "commercial" ? "brief" : "standard") as "brief" | "standard",
        templatePlan: plan,
        source: "heuristic" as const,
      };
    }),

  /**
   * AI step-by-step solver — the Wolfram|Alpha replacement. Produces a
   * paginated, KaTeX-ready worked solution (calculus, algebra, matrices,
   * chemistry balancing via mhchem, thermodynamics, physics) through the
   * normal provider cascade (Gemini → Anthropic → OpenAI → Grok → DeepSeek →
   * OpenRouter → Kimi). Results are cached by query so replays are free; a
   * null return tells the player to fall back to the Wolfram image card.
   */
  mathSteps: publicQuery
    .input(
      z.object({
        query: z.string().min(2).max(300),
        // providers already used in this rotation — the next call picks a
        // different one; when every provider has been used, pass [] to restart
        exclude: z.array(z.string().max(200)).max(16).default([]),
      }),
    )
    .query(async ({ ctx, input }) => {
      const key = input.query.trim().toLowerCase();
      // only the first, un-rotated request may serve from cache — a
      // regeneration explicitly wants a FRESH take from another provider
      if (input.exclude.length === 0) {
        const hit = MATH_STEPS_CACHE.get(key);
        if (hit) return hit;
      }
      rateLimit(clientKey(ctx.req), 20, 60_000);
      const stepsSchema = z.object({
        title: z.string().max(200),
        pages: z
          .array(
            z.object({
              title: z.string().max(200),
              steps: z
                .array(
                  z.object({
                    text: z.string().max(700),
                    latex: z.string().max(600).optional(),
                  }),
                )
                .min(1)
                .max(8),
            }),
          )
          .min(1)
          .max(14),
        answer: z.object({
          text: z.string().max(400).optional(),
          latex: z.string().max(600).optional(),
        }),
      });
      const system = `You are a rigorous step-by-step solver (like Wolfram|Alpha Pro's "show steps"). Solve the given problem COMPLETELY and show every step of the working. Output ONLY JSON, exactly this shape:
{"title": string, "pages": [{"title": string, "steps": [{"text": string, "latex"?: string}]}], "answer": {"text"?: string, "latex"?: string}}
RULES:
- Domains: calculus (derivatives, integrals, limits, series), algebra, linear algebra (matrices, determinants, systems), chemistry (balancing equations, stoichiometry), thermodynamics, physics. If the input is not a solvable problem, treat it as "explain and compute the key quantity of" that topic.
- PAGES: split the working into logical pages, each a coherent phase ("Set up", "Apply the quotient rule", "Simplify", "Check"). 2-6 steps per page; use as many pages as the problem genuinely needs (a long integral may need 5+; a short one 2).
- Each STEP: "text" is ONE plain-language sentence saying what is done and why; "latex" is the resulting expression/equation for that step.
- LATEX must be KaTeX-compatible, RAW (no $ or \\[ delimiters): \\dfrac, \\int, \\lim_{x \\to a}, \\sum; matrices with \\begin{pmatrix}...\\end{pmatrix}; multi-line derivations with \\begin{aligned}...\\end{aligned}; chemistry with \\ce{2H2 + O2 -> 2H2O} (mhchem). NEVER use \\begin{align}, \\text with special chars unescaped, or packages beyond core KaTeX + mhchem.
- The final page ends with the result; also put it in "answer" (latex preferred).
- Be mathematically correct — verify the final answer by a quick independent check before writing it.`;
      try {
        const result = await completeText({
          userId: ctx.user?.id,
          messages: [
            { role: "system", content: system },
            { role: "user", content: `PROBLEM: ${input.query}` },
          ],
          maxTokens: 3500,
          timeoutMs: 60_000,
          maxCandidates: 3,
          shuffleProviders: true,
          excludeKeyIds: input.exclude,
        });
        if (result) {
          const parsed = stepsSchema.parse(JSON.parse(extractJson(result.text)));
          const pool = await textKeyIdPool(ctx.user?.id);
          const out = {
            ...parsed,
            provider: result.provider,
            providerId: result.keyId ?? result.provider,
            providerPool: Math.max(1, pool.length),
          };
          if (MATH_STEPS_CACHE.size > 400) MATH_STEPS_CACHE.clear();
          MATH_STEPS_CACHE.set(key, out);
          return out;
        }
      } catch (err) {
        console.warn("[mathSteps] solver failed, player will fall back to Wolfram:", err instanceof Error ? err.message : err);
      }
      return null;
    }),

})

/* ---------------- coach chat --------------------------------- */
export const coachChatProcedure = publicQuery
    .input(
      z.object({
        messages: z
          .array(
            z.object({
              role: z.enum(["user", "coach"]),
              content: z.string().min(1).max(4000),
            }),
          )
          .min(1)
          .max(40),
      }),
    )
    .mutation(async ({ ctx, input }): Promise<CoachReply> => {
      rateLimit(clientKey(ctx.req), 20, 60_000);
      // Chat is a paid, signed-in feature: 1 🪙 per message, charged up front.
      if (!ctx.user) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "Sign in to chat with the Coach." });
      }
      if (ctx.user.tokenBalance < 1) {
        throw new TRPCError({ code: "FORBIDDEN", message: "INSUFFICIENT_TOKENS: a Coach message costs 1 🪙 — top up to keep chatting." });
      }
      await applyTokenDelta(ctx.user.id, -1, "coach chat message");
      const lastUser = [...input.messages].reverse().find((m) => m.role === "user");
      const history = input.messages.slice(-12).map((m) => ({
        role: (m.role === "coach" ? "assistant" : "user") as "assistant" | "user",
        content: m.content,
      }));
      try {
        const result = await withTimeout(
          completeText({
            userId: ctx.user?.id,
            messages: [{ role: "system", content: COACH_SYSTEM_PROMPT }, ...history],
            maxTokens: 1024,
            timeoutMs: 8_000,
            maxCandidates: 2,
          }),
          12_000,
        );
        if (result) {
          try {
            return coachResponseSchema.parse(JSON.parse(extractJson(result.text)));
          } catch (err) {
            console.warn("[coach.chat] parse failed, falling back to mock:", err);
          }
        }
      } catch (err) {
        console.error("[coach.chat] provider error, falling back to mock:", err);
      }
      return mockCoachReply(lastUser?.content ?? "hello");
    });
