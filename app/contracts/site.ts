/* ------------------------------------------------------------------ */
/* What this site is — one description, shared.                         */
/* ------------------------------------------------------------------ */

/**
 * The About page and the marketing tool were both describing SketchLearn, and
 * both were drifting. They now read the same object, so a change to what the
 * product is gets written once: the About page renders it, and the marketing
 * carousel's follow card prefills from it without anyone retyping the name,
 * the handle or the bio.
 */
export const SITE = {
  name: "SketchLearn",
  handle: "sketchlearn",
  /** One line, the way the follow card wants it. */
  tagline: "A notebook that teaches, and remembers",
  /** The two-ish lines under the name on a profile card. */
  bio: ["AI decks, quizzes and lesson paths — in pencil", "Hello – hello@sketchlearn.app"],
  contact: "hello@sketchlearn.app",

  /**
   * What the place actually does, in the order someone meets it. Read by the
   * About page and handed to the AI whenever it has to write in the site's
   * own voice.
   */
  what: [
    "SketchLearn turns a subject into a repository of units and lessons, then teaches each lesson as a slide deck that quizzes as it goes.",
    "Decks are generated, played, graded and remembered: a finished play writes a lesson log back to the repo, and the next generation reads it, so later lessons build on earlier ones instead of repeating them.",
    "The same loop runs a classroom, a restaurant menu, a service catalog or a shop collection — only the labels change.",
  ],

  /** The surfaces someone can actually click, for the About page's tour. */
  surfaces: [
    { label: "Repos", body: "The front door. Every notebook on the shelf, with its units, lessons and progress." },
    { label: "Slides", body: "Single decks and the presets mirrored out of a repo's lessons, ready to customize and play." },
    { label: "Gallery", body: "Finished work, public: decks other people built and the runs they scored." },
    { label: "Users", body: "Who is here, what they made, and the badges that say a moderator is vouched for." },
  ],
} as const;

/**
 * The site described as a paragraph an AI can read. Used to brief the model
 * when it writes a carousel's follow card — that is what "it knows about the
 * website" comes from.
 */
export function siteBrief(): string {
  return [
    `${SITE.name} (@${SITE.handle}) — ${SITE.tagline}.`,
    ...SITE.what,
    `Contact: ${SITE.contact}.`,
  ].join(" ");
}
