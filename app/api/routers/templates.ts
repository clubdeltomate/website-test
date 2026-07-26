import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { createRouter, publicQuery } from "../middleware.js";
import { authedProcedure } from "../procedures.js";
import { getDb } from "../queries/connection.js";
import { slideTemplates, users } from "../../db/schema.js";
import {
  BUILTIN_SLIDE_TEMPLATES,
  GRADABLE_TYPES,
  TEMPLATE_COMPONENT_TYPES,
  TEMPLATE_LEVELS,
  type SlideTemplate,
  type TemplateLevel,
} from "../../contracts/slide-templates.js";

const componentSchema = z.enum(TEMPLATE_COMPONENT_TYPES);
const levelSchema = z.enum(TEMPLATE_LEVELS as [TemplateLevel, ...TemplateLevel[]]);

/**
 * Full catalog: built-ins (code) + user-added rows (DB). Used by the
 * Templates page AND by slide generation. A DB hiccup (e.g. the table not
 * pushed yet) degrades to built-ins only instead of failing generation.
 */
export async function loadTemplateCatalog(): Promise<SlideTemplate[]> {
  const out: SlideTemplate[] = [...BUILTIN_SLIDE_TEMPLATES];
  try {
    const db = getDb();
    const rows = await db.select().from(slideTemplates);
    for (const row of rows) {
      const components = (Array.isArray(row.componentsJson) ? row.componentsJson : []).filter(
        (c): c is (typeof TEMPLATE_COMPONENT_TYPES)[number] =>
          componentSchema.safeParse(c).success,
      );
      if (components.length === 0) continue;
      let createdByName: string | null = null;
      if (row.createdBy) {
        const u = await db.query.users.findFirst({ where: eq(users.id, row.createdBy) });
        createdByName = u?.name ?? null;
      }
      out.push({
        id: row.id,
        name: row.name,
        level: (row.level ?? "A1") as TemplateLevel,
        components,
        tags: (Array.isArray(row.tagsJson) ? row.tagsJson : []).filter(
          (t): t is string => typeof t === "string",
        ),
        builtin: false,
        createdById: row.createdBy,
        createdByName,
      });
    }
  } catch (err) {
    console.warn(
      "[templates] could not load custom templates (run `npm run db:push`?), using built-ins:",
      err instanceof Error ? err.message : err,
    );
  }
  return out;
}

/** A template is either scoreable (has a gradable step) or an explicit
 *  read-through carrying real content (a Text or Wolfram step). */
function assertScorableOrReadThrough(components: (typeof TEMPLATE_COMPONENT_TYPES)[number][]) {
  const gradable = components.some((c) => GRADABLE_TYPES.includes(c));
  const readThrough = components.includes("prose") || components.includes("wolfram");
  if (!gradable && !readThrough) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "A template needs a gradable step (Multiple choice, 2-option, Fill blank, Typed answer, Solve) — or, for a read-through, at least a Text or Wolfram step.",
    });
  }
}

function normalizeTags(tags: string[]): string[] {
  return [...new Set(tags.map((t) => t.toLowerCase().replace(/^#/, "").trim()))].filter(Boolean);
}

export const templatesRouter = createRouter({
  list: publicQuery.query(async (): Promise<SlideTemplate[]> => loadTemplateCatalog()),

  create: authedProcedure
    .input(
      z.object({
        name: z.string().min(3).max(120),
        level: levelSchema.default("A1"),
        components: z.array(componentSchema).min(1).max(8),
        tags: z.array(z.string().min(1).max(24)).max(6).default([]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      assertScorableOrReadThrough(input.components);
      const tags = normalizeTags(input.tags);
      const [{ id }] = await getDb()
        .insert(slideTemplates)
        .values({
          name: input.name.trim(),
          level: input.level,
          componentsJson: input.components,
          tagsJson: tags,
          createdBy: ctx.user.id,
        })
        .returning({ id: slideTemplates.id });
      return { id };
    }),

  update: authedProcedure
    .input(
      z.object({
        id: z.number().int(),
        name: z.string().min(3).max(120),
        level: levelSchema,
        components: z.array(componentSchema).min(1).max(8),
        tags: z.array(z.string().min(1).max(24)).max(6).default([]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const row = await db.query.slideTemplates.findFirst({
        where: eq(slideTemplates.id, input.id),
      });
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Template not found" });
      const allowed =
        row.createdBy === ctx.user.id ||
        ctx.user.role === "moderator" ||
        ctx.user.role === "admin";
      if (!allowed) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only the creator, a moderator, or an admin can edit a template",
        });
      }
      assertScorableOrReadThrough(input.components);
      await db
        .update(slideTemplates)
        .set({
          name: input.name.trim(),
          level: input.level,
          componentsJson: input.components,
          tagsJson: normalizeTags(input.tags),
        })
        .where(eq(slideTemplates.id, input.id));
      return { ok: true as const };
    }),

  delete: authedProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const row = await db.query.slideTemplates.findFirst({
        where: eq(slideTemplates.id, input.id),
      });
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Template not found" });
      const allowed =
        row.createdBy === ctx.user.id ||
        ctx.user.role === "moderator" ||
        ctx.user.role === "admin";
      if (!allowed) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only the creator, a moderator, or an admin can delete a template",
        });
      }
      await db.delete(slideTemplates).where(eq(slideTemplates.id, input.id));
      return { ok: true as const };
    }),
});
