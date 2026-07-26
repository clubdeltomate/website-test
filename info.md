# SketchLearn — Product Specification (from the attached engineered build prompt PDF)

## Product
"SketchLearn" — a hand-drawn-styled, AI-powered learning platform. It is BOTH a curricular learning tool (courses, lesson plans) AND a multi-purpose presentation engine that works for restaurants (menu categories as units, dishes as lessons), handyman services, small shop product catalogs, etc. The same repo⇄slide-tool⇄lesson-log loop powers every use case.

## Visual identity (MANDATORY)
Warm paper background, dashed/dotted borders, a "sketch" pencil aesthetic, yellow-header tables, rounded cards with soft offset shadows. Hand-drawn feel throughout — like a beautifully kept notebook/sketchbook.

## Core object types
1. **Coach chat** (home page) — conversational assistant that helps a user decide what to make and hands off to a builder. Can create a repository, a slide tool, or open an existing one to play.
2. **Repository (repo)** — nested cards organizing a course: UNIT → LESSON → OBJECTIVE/PROMPT. A syllabus/gallery, not slides. Identified by a STABLE SLUG; a short "repo ref" code (5-char hash, e.g. #K7J2A) derived from the slug is shown in tables. Renaming never breaks links.
3. **Slide tool (presentation generator)** — REUSABLE. Inputs: topic + custom instructions + level + slide count (max 15) + image style. Generates a playable slide presentation. Every completed play is recorded.

## The Lesson Path (key flow)
From Coach chat (or a "Lesson Path" composer), ONE action generates BOTH a repository AND a linked slide tool at once. Repo is pre-linked to the slide tool via a stable `studyToolSlug`. Each lesson's OBJECTIVE is the PROMPT the slide tool uses. After "Generate both", land the user on the REPOSITORY.

## Repo structure
- UNIT card contains LESSON cards; each LESSON card contains a PROMPT card. Sub-lessons nest further.
- Every lesson has a global COURSE ORDER (lesson N of M across the repo) and belongs to a unit.
- Clicking a lesson's 🎬 study button opens the linked slide tool with the lesson's objective PROMPT preset, plus a seed: repoSlug, repoRef, unitTitle, lessonTitle, lessonIndex, lessonCount, lessonSeq, lessonSeqTotal.

## Cross-lesson memory (THE most important feature)
- When a repo-launched lesson FINISHES, save a "lesson log" to the repo: who played, when, level, score, time-per-slide, and PER SLIDE — title, summary of what it taught, visuals shown, question asked, option chosen (correct/incorrect).
- When the NEXT lesson is generated, READ earlier logs and fold them into generation instructions: "PREVIOUSLY TAUGHT in this course — build on this like a later chapter; assume the learner already knows it; do NOT re-explain it."
- Result: Lesson 2 never re-teaches Lesson 1 — references it in one clause, spends all depth on the new topic.

## Slide generation rules (the teaching engine)
- No greeting/welcome — start teaching immediately.
- Each slide = distinct prose paragraphs building introduce → develop → apply, never restating.
- Cohesion: deck reads as ONE continuous piece; at most a light one-clause stitch to previous idea.
- Components per concept: chart, latex formula, svg diagram, table (compact, yellow header), sticky note (one highlight/mnemonic/warning), generated image, code snippet.
- Subject gating: formulas/code ONLY for math/STEM; humanities use prose+images+tables+diagrams+sticky notes.
- Max ONE latex formula per slide. Formula order: (1) formula, (2) its graph/diagram, (3) short "why this is on the page" text.
- QUIZ per slide: MCQ with 4 options, answerable ONLY from this slide's content + everyday knowledge. Small nudge one step past the text.
- Text-to-speech "read aloud" button narrates the whole slide.

## Presentation runs
Page listing every completed play: slide-tool name, student, played-at, elapsed, repo ref (or "Direct"), course order, level, image style, slide count, score. Per-repo "lesson runs" table too. Save a run ONLY on full completion.

## Galleries & nav
Slides gallery + Repos gallery (search, favorites, card/table views). Left side-rail: Chat, Slides, Repos, Presentation runs, About; admin adds: Moderators, Users, Settings, Dashboard. Mobile: rail closed by default, collapses after navigation; desktop: stays open. Thin top progress bar during fetches; hovering a gallery card prefetches its data.

## Roles & economy
- Guests browse; signed-in users create/play; moderators/admins manage.
- Generation costs tokens: pre-generation cost estimate + affordability gate.
- Moderators/admins manage tokens and prices; dashboard shows usage.
- Payment system is MANUAL: user is redirected to a Google Sheet (simple), then admin manually credits tokens.
- Users can input their own AI API keys (BYOK) in Settings — pluggable AI provider layer (text, images, TTS).

## Pages needed
Home/Coach chat, Lesson Path composer, Repository detail (nested unit/lesson/prompt cards, 🎬 play buttons, lesson-runs table), Repos gallery, Slide tool page + player (deck with paragraphs, chart/latex/svg/table/sticky-note/image/code components, per-slide quiz, read-aloud, progress bar, finish → score), Slides gallery, Presentation runs (global table), About, Settings (API keys, token balance, manual payment → Google Sheet redirect), Admin: Dashboard, Users, Moderators, Settings/prices.
