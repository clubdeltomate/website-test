import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { createRouter, publicQuery } from "../middleware.js";
import { authedProcedure, moderatorProcedure } from "../procedures.js";
import { getDb } from "../queries/connection.js";
import { lessons, repos, slideTools, units, users, type Repo } from "../../db/schema.js";
import { completeText, completeVision, generateImage, resolveProviderName, userHasKey, webResearch, type VisionImage } from "../ai/provider.js";
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
} from "../../contracts/slide-templates.js";
import { isStemTopic } from "../../contracts/stem.js";
import { typedOverlapCorrect } from "../../contracts/grade.js";
import { repoPurpose, templateFilterPurpose, type CoachReply, type SlideDeck } from "../../contracts/types.js";

const GUEST_MAX_SLIDES = 6;
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
        for (let attempt = 0; attempt < 2 && parsed === null; attempt++) {
          try {
            const result = await completeText({
              userId: ctx.user.id,
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
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: AI_UNAVAILABLE_MSG });
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
        textDensity: z.enum(["brief", "standard", "detailed"]).default("standard"),
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
    }> => {
      const db = getDb();
      const tool = await db.query.slideTools.findFirst({
        where: eq(slideTools.slug, input.toolSlug),
      });
      if (!tool) throw new TRPCError({ code: "NOT_FOUND", message: "Slide tool not found" });

      const isGuest = !ctx.user;
      if (isGuest) rateLimit(clientKey(ctx.req), 10, 60_000);
      const slideCount = isGuest ? Math.min(input.slideCount, GUEST_MAX_SLIDES) : input.slideCount;

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
      let allowedTemplates = templatesForContext(catalog, {
        purpose: templateFilterPurpose(purpose),
        stem: isStemTopic(topic),
        level: input.level,
      });
      // A news briefing reads like a newspaper: give it the image-forward
      // showcase layouts too (photo + prose + optional table), on top of the
      // explanatory ones, so every story can be a headline + photo + summary
      // with the occasional table/chart.
      if (purpose === "news") {
        const imageForward = templatesForContext(catalog, {
          purpose: "commercial",
          stem: isStemTopic(topic),
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
        input.textDensity === "brief" ? -1 : input.textDensity === "detailed" ? 2 : 0;
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

      let deck: SlideDeck | null = null;
      let lastAttempt: SlideDeck | null = null; // best non-conforming try, as a fallback
      let usedMock = false;
      let textProvider: import("../../contracts/types.js").AiProvider | null = null;
      // A pinned SLIDE PLAN is an explicit user request, so give the model
      // more chances to honor it exactly before we accept a miss.
      const hasPlan = pinnedPlan.some(Boolean);
      const maxAttempts = hasPlan ? 3 : 2;
      try {
        for (let attempt = 0; attempt < maxAttempts && deck === null; attempt++) {
          try {
            const result = await completeText({
              userId: ctx.user?.id,
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
                return !structOk || paraCount < paraFloor;
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
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: AI_UNAVAILABLE_MSG });
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
      deck = ensureExplanatoryProse(deck, purpose);
      // Randomize each quiz's correct-answer position (models almost always
      // put the answer first, so otherwise every question is "A").
      deck = shuffleQuizAnswers(deck);

      // Eagerly generate ONLY the first slide's image inline so slide 1 opens
      // with its picture already in place (no visible wait on the opening
      // slide). Every other slide's image still streams in lazily in the
      // player. Costs one image's latency, not the whole deck's.
      if (input.imageStyle !== "none" && deck.slides.length > 0) {
        const firstImg = deck.slides[0].components.find((c) => c.type === "image");
        if (firstImg && firstImg.type === "image" && !firstImg.imageUrl) {
          try {
            const url = await generateImage({
              userId: ctx.user?.id,
              prompt: firstImg.prompt,
              style: input.imageStyle,
            });
            if (url) firstImg.imageUrl = url;
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
      return { deck, usedMock, cost, balance, previouslyTaught, slidePlan, commercial, walkthrough };
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
