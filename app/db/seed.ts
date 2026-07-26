import { getDb } from "../api/queries/connection";
import {
  users,
  repos,
  units,
  lessons,
  slideTools,
  runs,
  lessonLogs,
  settings,
  tokenLedger,
} from "./schema";
import { eq } from "drizzle-orm";
import { hashPassword } from "../api/auth-utils";
import { repoRef } from "../api/ai/prompts";
import { DEFAULT_SETTINGS, SETTINGS_KEY } from "../api/settings";
import type { LessonLogSlide, Level } from "../contracts/types";

/* ------------------------------------------------------------------ */
/* SketchLearn seed — users, settings, two demo repos with linked slide */
/* tools, units/lessons/objectives, and completed runs + lesson logs so */
/* the cross-lesson memory loop is demonstrable.                        */
/* ------------------------------------------------------------------ */

async function upsertUser(
  email: string,
  password: string,
  name: string,
  role: "user" | "moderator" | "admin",
  tokenBalance: number,
) {
  const db = getDb();
  const existing = await db.query.users.findFirst({ where: eq(users.email, email) });
  if (existing) {
    console.log(`  user ${email} exists (id ${existing.id}) — skipping`);
    return existing.id;
  }
  const [{ id }] = await db
    .insert(users)
    .values({ email, name, passwordHash: hashPassword(password), role, tokenBalance })
    .returning({ id: users.id });
  await db.insert(tokenLedger).values({
    userId: id,
    delta: tokenBalance,
    reason: "welcome bonus",
    balanceAfter: tokenBalance,
  });
  console.log(`  created ${role} ${email} (id ${id})`);
  return id;
}

interface LessonSpec {
  title: string;
  objective: string;
  sub?: { title: string; objective: string }[];
}
interface UnitSpec {
  title: string;
  lessons: LessonSpec[];
}

async function seedRepo(opts: {
  slug: string;
  title: string;
  description: string;
  template: "course" | "restaurant" | "service" | "shop" | "other";
  ownerId: number;
  toolName: string;
  toolTopic: string;
  toolInstructions: string;
  defaultLevel: Level;
  units: UnitSpec[];
}) {
  const db = getDb();
  const existing = await db.query.repos.findFirst({ where: eq(repos.slug, opts.slug) });
  if (existing) {
    console.log(`  repo ${opts.slug} exists — skipping`);
    return { repoId: existing.id, lessonIds: [] as { id: number; globalSeq: number; title: string }[] };
  }

  await db.insert(slideTools).values({
    slug: `${opts.slug}-studio`,
    name: opts.toolName,
    description: opts.description,
    ownerId: opts.ownerId,
    topic: opts.toolTopic,
    instructions: opts.toolInstructions,
    defaultLevel: opts.defaultLevel,
    defaultSlideCount: 8,
    defaultImageStyle: "sketch",
    isPublic: true,
  });

  const [{ repoId }] = await db
    .insert(repos)
    .values({
      slug: opts.slug,
      ref: repoRef(opts.slug),
      title: opts.title,
      description: opts.description,
      template: opts.template,
      ownerId: opts.ownerId,
      studyToolSlug: `${opts.slug}-studio`,
      isPublic: true,
    })
    .returning({ repoId: repos.id });

  const lessonIds: { id: number; globalSeq: number; title: string }[] = [];
  let seq = 0;
  for (let u = 0; u < opts.units.length; u++) {
    const unit = opts.units[u];
    const [{ unitId }] = await db
      .insert(units)
      .values({ repoId, title: unit.title, orderIndex: u })
      .returning({ unitId: units.id });
    for (let l = 0; l < unit.lessons.length; l++) {
      seq += 1;
      const spec = unit.lessons[l];
      const [{ lessonId }] = await db
        .insert(lessons)
        .values({
          unitId,
          title: spec.title,
          objective: spec.objective,
          orderIndex: l,
          globalSeq: seq,
        })
        .returning({ lessonId: lessons.id });
      lessonIds.push({ id: lessonId, globalSeq: seq, title: spec.title });
      // sub-lessons share the unit, hang off the parent, and don't advance globalSeq
      if (spec.sub) {
        for (let s = 0; s < spec.sub.length; s++) {
          await db.insert(lessons).values({
            unitId,
            parentLessonId: lessonId,
            title: spec.sub[s].title,
            objective: spec.sub[s].objective,
            orderIndex: unit.lessons.length + s,
            globalSeq: seq,
          });
        }
      }
    }
  }
  console.log(`  created repo ${opts.slug} (#${repoRef(opts.slug)}) with ${seq} lessons`);
  return { repoId, lessonIds };
}

async function seedRun(opts: {
  toolSlug: string;
  repoId: number;
  lessonId: number;
  lessonTitle: string;
  userId: number;
  playerName: string;
  level: Level;
  perSlide: LessonLogSlide[];
  elapsedSec: number;
  completedAt: Date;
}) {
  const db = getDb();
  const tool = await db.query.slideTools.findFirst({ where: eq(slideTools.slug, opts.toolSlug) });
  if (!tool) throw new Error(`tool ${opts.toolSlug} missing`);
  const answered = opts.perSlide.filter((s) => s.correct !== null);
  const scoreTotal = answered.length;
  const scoreCorrect = answered.filter((s) => s.correct).length;
  const [{ runId }] = await db
    .insert(runs)
    .values({
      slideToolId: tool.id,
      repoId: opts.repoId,
      lessonId: opts.lessonId,
      userId: opts.userId,
      playerName: opts.playerName,
      seedJson: null,
      level: opts.level,
      imageStyle: "sketch",
      slideCount: opts.perSlide.length,
      scoreCorrect,
      scoreTotal,
      elapsedSec: opts.elapsedSec,
      deckJson: null,
      completedAt: opts.completedAt,
    })
    .returning({ runId: runs.id });
  await db.insert(lessonLogs).values({
    repoId: opts.repoId,
    lessonId: opts.lessonId,
    runId,
    userId: opts.userId,
    level: opts.level,
    scoreCorrect,
    scoreTotal,
    elapsedSec: opts.elapsedSec,
    perSlideJson: opts.perSlide,
    createdAt: opts.completedAt,
  });
  console.log(`  run+log: "${opts.lessonTitle}" by ${opts.playerName} — ${scoreCorrect}/${scoreTotal}`);
}

const slidesL1: LessonLogSlide[] = [
  {
    title: "Position: where things are",
    summary:
      "Position is a location relative to a chosen reference point (origin), described with a sign (+/−) along an axis.",
    visuals: ["number-line diagram"],
    question: "A walker stands at x = −3 m. What does the minus sign mean?",
    chosenOption: "They are 3 m on the negative side of the origin",
    correct: true,
  },
  {
    title: "Distance vs displacement",
    summary:
      "Distance is the total path length travelled (always positive); displacement is the straight change in position, final minus initial, with direction.",
    visuals: ["path sketch", "comparison table"],
    question: "You walk 4 m east then 4 m west. Distance and displacement?",
    chosenOption: "8 m and 0 m",
    correct: true,
  },
  {
    title: "Reading position–time tables",
    summary: "Position–time tables let you read displacements between any two instants by subtracting positions.",
    visuals: ["yellow-header table"],
    question: null,
    chosenOption: null,
    correct: null,
  },
];

const slidesL2: LessonLogSlide[] = [
  {
    title: "Speed: how fast the path grows",
    summary: "Average speed is distance divided by elapsed time; it says nothing about direction.",
    visuals: ["formula v = d/t", "bar chart of speeds"],
    question: "A cyclist covers 100 m in 20 s. Average speed?",
    chosenOption: "5 m/s",
    correct: true,
  },
  {
    title: "Velocity: speed with a direction",
    summary:
      "Average velocity is displacement over time and carries a sign; you can move fast yet have zero average velocity on a round trip.",
    visuals: ["arrow diagram"],
    question: "A runner completes one full lap in 60 s. Her average velocity is…",
    chosenOption: "0 m/s, because displacement is zero",
    correct: true,
  },
  {
    title: "Speed vs velocity at a glance",
    summary: "Speed uses distance, velocity uses displacement — they only agree for straight one-way motion.",
    visuals: ["sticky note", "comparison table"],
    question: "When do average speed and average velocity magnitude match?",
    chosenOption: "Only for straight-line motion in one direction",
    correct: false,
  },
];

const slidesL2b: LessonLogSlide[] = [
  {
    title: "Instantaneous velocity",
    summary: "Instantaneous velocity is the limit of average velocity as the time interval shrinks to zero — the slope of the position–time curve at a point.",
    visuals: ["curve with tangent line"],
    question: "On a position–time graph, instantaneous velocity is the…",
    chosenOption: "Slope of the tangent at that point",
    correct: true,
  },
  {
    title: "Reading motion graphs",
    summary: "A steeper position–time curve means faster motion; a horizontal stretch means standing still; curving means changing velocity.",
    visuals: ["three sketch graphs"],
    question: null,
    chosenOption: null,
    correct: null,
  },
];

async function seed() {
  const db = getDb();
  console.log("Seeding SketchLearn…");

  // ── settings ──────────────────────────────────────────────────────
  const existingSettings = await db.query.settings.findFirst({
    where: eq(settings.key, SETTINGS_KEY),
  });
  if (!existingSettings) {
    await db.insert(settings).values({ key: SETTINGS_KEY, valueJson: DEFAULT_SETTINGS });
    console.log("  wrote default app settings");
  } else {
    console.log("  settings exist — skipping");
  }

  // ── users ─────────────────────────────────────────────────────────
  // Seed users are exempt from the ≥8-char password rule (register enforces it, seeds don't).
  const adminId = await upsertUser("admin@sketchlearn.app", "123456", "Ada Admin", "admin", 500);
  await upsertUser("mod@sketchlearn.app", "sketch-mod-2026", "Moe Moderator", "moderator", 200);
  const samId = await upsertUser("sam@sketchlearn.app", "sketch-demo-2026", "Sam Sketcher", "user", 50);

  // ── repo (a): FS1111 physics ──────────────────────────────────────
  const physics = await seedRepo({
    slug: "physics-fs1111-motion",
    title: "FS1111 — Foundations of Physics: Motion & Forces",
    description:
      "A first-semester physics course covering kinematics, dynamics, energy and momentum — nine lessons that build on each other like chapters.",
    template: "course",
    ownerId: adminId,
    toolName: "FS1111 Study Studio",
    toolTopic: "Foundations of physics: motion, forces, energy and momentum",
    toolInstructions:
      "Teach first-semester physics with concrete everyday examples first, then the formula, then a quick graph. One formula per slide, always followed by its picture and a why-it-matters note.",
    defaultLevel: "A1",
    units: [
      {
        title: "Unit 1 — Kinematics",
        lessons: [
          {
            title: "Position, distance & displacement",
            objective:
              "Teach position as a signed location relative to an origin, then contrast distance (total path) with displacement (straight change with direction). Use a number line, a small walk example, and end with the learner reading displacements off a position–time table.",
          },
          {
            title: "Speed & velocity",
            objective:
              "Teach average speed as distance over time and average velocity as displacement over time. Show with a lap example why a fast round trip has zero average velocity, and finish with when speed and velocity magnitude agree.",
          },
          {
            title: "Acceleration",
            objective:
              "Teach acceleration as the rate of change of velocity: speeding up, slowing down (deceleration) and changing direction all count. Use a car pulling away from a traffic light and braking for a dog as the two anchor examples.",
            sub: [
              {
                title: "Subtopic — instantaneous acceleration & graphs",
                objective:
                  "Extend acceleration to its instantaneous form as the slope of the velocity–time curve, and practice reading speeding-up vs slowing-down regions on motion graphs.",
              },
            ],
          },
        ],
      },
      {
        title: "Unit 2 — Dynamics",
        lessons: [
          {
            title: "Newton's First Law — inertia",
            objective:
              "Teach inertia: objects keep their state of motion unless a net force acts. Use the tablecloth trick and the lurching bus, and dismantle the misconception that motion needs a force to continue.",
          },
          {
            title: "Newton's Second Law — F = ma",
            objective:
              "Teach F = ma as the working law of dynamics: net force produces acceleration in proportion to mass. One worked example with numbers, one graph of force vs acceleration, and a sanity-check table of everyday forces.",
          },
        ],
      },
      {
        title: "Unit 3 — Energy",
        lessons: [
          {
            title: "Work & kinetic energy",
            objective:
              "Teach work as force applied along a displacement and kinetic energy as the energy of motion (½mv²). Connect them through the work–energy idea with a pushed sled example.",
          },
          {
            title: "Potential energy & conservation",
            objective:
              "Teach gravitational potential energy and the conservation of mechanical energy using a roller-coaster: energy trades height for speed and back, with friction as the party spoiler.",
          },
        ],
      },
      {
        title: "Unit 4 — Momentum",
        lessons: [
          {
            title: "Momentum & impulse",
            objective:
              "Teach momentum p = mv and impulse as force × time changing momentum. Use catching an egg (soft hands) vs a wall to show why extending time saves the egg.",
          },
          {
            title: "Collisions & conservation of momentum",
            objective:
              "Teach conservation of momentum in collisions: total momentum before equals total after. Work one head-on cart collision with numbers and contrast elastic vs inelastic outcomes.",
          },
        ],
      },
    ],
  });

  // ── repo (b): Casa Azul ───────────────────────────────────────────
  await seedRepo({
    slug: "casa-azul-menu",
    title: "Casa Azul — Mexican Kitchen",
    description:
      "Our menu as a little course: each category is a unit and every dish is a lesson that tells its story — perfect for training the team and delighting curious guests.",
    template: "restaurant",
    ownerId: adminId,
    toolName: "Casa Azul Menu Studio",
    toolTopic: "The dishes of Casa Azul, a Mexican kitchen",
    toolInstructions:
      "Present each dish as a warm story: where it comes from, what goes into it, how our kitchen prepares it, and how to enjoy it. No formulas — prose, images, tables and sticky notes only.",
    defaultLevel: "A1",
    units: [
      {
        title: "Breakfast",
        lessons: [
          {
            title: "Chilaquiles",
            objective:
              "Present the story of chilaquiles: yesterday's tortillas reborn in salsa, red vs green camps, the toppings (crema, queso fresco, onion), and why the tortilla should stay a little crisp. End with how we serve it at Casa Azul with a fried egg on top.",
          },
          {
            title: "Huevos Rancheros",
            objective:
              "Present huevos rancheros as the rancher's breakfast: fried eggs on lightly crisped tortillas under a warm tomato-chile salsa. Cover its farmhouse origins, the role of beans on the side, and the moment the yolk breaks into the salsa.",
          },
          {
            title: "Pancakes (hot cakes)",
            objective:
              "Present Mexican-style hot cakes: fluffy, vanilla-scented, served with cajeta or condensed milk and fruit. Tell how they became a Sunday morning staple at family fondas, and how ours get their golden edges on the comal.",
          },
        ],
      },
      {
        title: "Lunch",
        lessons: [
          {
            title: "Tacos al pastor",
            objective:
              "Present tacos al pastor: the trompo's story from Lebanese shawarma to Mexico City streets, the achiote-pineapple marinade, the taquero's flick of pineapple, and why two small tortillas matter. Make the learner smell the charcoal.",
          },
          {
            title: "Pozole",
            objective:
              "Present pozole as a celebration soup: hominy corn, slow pork, and the ritual of garnishing at the table with radish, lettuce, oregano and lime. Cover red, white and green regional styles and when pozole is served in Mexico.",
          },
        ],
      },
      {
        title: "Dinner",
        lessons: [
          {
            title: "Mole Poblano",
            objective:
              "Present mole poblano as Mexico's most layered sauce: chiles, chocolate, spices, and the legend of the convent of Puebla. Explain the patience it takes, why chocolate is only one of twenty voices, and how we serve it over chicken with sesame seeds.",
          },
          {
            title: "Chiles en Nogada",
            objective:
              "Present chiles en nogada as the patriotic dish: a stuffed poblano in a walnut cream sauce with pomegranate seeds — green, white and red on a plate. Tell its August-season story tied to Mexican independence and why the nogada must be silky, not sweet.",
          },
        ],
      },
    ],
  });

  // ── completed runs + lesson logs on physics L1 & L2 (memory loop) ──
  const existingRuns = await db.select({ id: runs.id }).from(runs);
  if (existingRuns.length === 0 && physics.lessonIds.length > 0) {
    const l1 = physics.lessonIds.find((l) => l.globalSeq === 1)!;
    const l2 = physics.lessonIds.find((l) => l.globalSeq === 2)!;
    const day = 86400_000;
    await seedRun({
      toolSlug: "physics-fs1111-motion-studio",
      repoId: physics.repoId,
      lessonId: l1.id,
      lessonTitle: l1.title,
      userId: samId,
      playerName: "Sam Sketcher",
      level: "A1",
      perSlide: slidesL1,
      elapsedSec: 420,
      completedAt: new Date(Date.now() - 3 * day),
    });
    await seedRun({
      toolSlug: "physics-fs1111-motion-studio",
      repoId: physics.repoId,
      lessonId: l2.id,
      lessonTitle: l2.title,
      userId: samId,
      playerName: "Sam Sketcher",
      level: "A1",
      perSlide: slidesL2,
      elapsedSec: 510,
      completedAt: new Date(Date.now() - 2 * day),
    });
    await seedRun({
      toolSlug: "physics-fs1111-motion-studio",
      repoId: physics.repoId,
      lessonId: l2.id,
      lessonTitle: l2.title,
      userId: adminId,
      playerName: "Ada Admin",
      level: "B1",
      perSlide: slidesL2b,
      elapsedSec: 380,
      completedAt: new Date(Date.now() - 1 * day),
    });
  } else {
    console.log("  runs exist or physics repo pre-existed — skipping demo runs");
  }

  console.log("Done.");
  process.exit(0);
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
