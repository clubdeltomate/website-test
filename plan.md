# SketchLearn — Full-Stack Build Plan

## Product summary
"SketchLearn" — hand-drawn (sketch/pencil) styled AI learning platform.
- **Coach chat** home page → helps user decide, hands off to builders.
- **Repository** = nested syllabus cards: UNIT → LESSON → OBJECTIVE/PROMPT, stable slug, short repo-ref hash, global course order (L#/M).
- **Slide tool** = reusable generator (topic + instructions + level + slide count ≤15 + image style) → playable quiz-per-slide presentation.
- **Lesson Path** composer: one action generates BOTH repo + linked slide tool (`studyToolSlug`). Land on repo after generation.
- **Cross-lesson memory**: finished plays write per-slide lesson logs back to the repo; next lesson generation reads logs → "previously taught, do not re-explain".
- **Slide rules**: no greeting; introduce→develop→apply paragraphs; max ONE formula per slide; formula→graph→why ordering; subject gating (STEM vs humanities); per-slide MCQ answerable from slide alone; TTS read-aloud.
- **Presentation runs**: global table + per-repo lesson runs; saved only on full completion.
- **Galleries**: Slides + Repos (search, favorites, card/table). Left side-rail nav (Chat, Slides, Repos, Runs, About; admin: Moderators, Users, Settings, Dashboard). Mobile rail closed by default. Top progress bar on fetches. Hover prefetch.
- **Roles & economy**: guest browse / user create+play / moderator+admin manage. Token costs, pre-generation estimate, affordability gate. Manual payment → redirect to Google Sheet + admin credit tokens. User-provided AI API keys (BYOK) stored per-user, pluggable provider layer (text/image/TTS).

## Stack (per artifact-skill constraints, overriding PDF's Next.js suggestion)
- Frontend: React + Vite + TypeScript + Tailwind + shadcn/ui (webapp-building-swarm)
- Backend: Hono + tRPC + Drizzle ORM + MySQL (backend-building-swarm), JWT sessions, role guards
- Delivery: mshtools-website_version_manager (dynamic, Dockerfile)

## Stages

### Stage 0 — Workspace & skill load
Load `swarm-workspace`, `vibecoding-webapp-swarm`. Create shared repo + worktrees.

### Stage 1 — Architecture & design system (Orchestrator)
- DB schema: users, sessions, apiKeys, repos, units, lessons, slideTools, runs, lessonLogs, tokenLedger, prices/settings, favorites, payments(manual requests).
- Design tokens: warm paper bg (#f7f3ea-ish), dashed/dotted borders, pencil-sketch aesthetic, yellow-header tables, rounded cards w/ soft offset shadows, hand-drawn font pairing.
- API surface (tRPC routers): auth, users, keys, repos, slideTools, generate (lessonPath, slides), runs, tokens, admin, payments.
- AI provider layer: OpenAI-compatible chat completions via user's stored key (server-side proxy), JSON-schema slide output; image generation hook + TTS hook (graceful fallback to browser SpeechSynthesis).

### Stage 2 — Backend swarm (backend-building-swarm)
Implement full tRPC+Drizzle backend on backend branch: auth (register/login/JWT, roles guest/user/moderator/admin), BYOK key storage, repo/tool CRUD, generation endpoints (lesson-path → repo+tool; slides w/ cross-lesson memory prompt assembly), runs + lesson logs, token economy (estimate, gate, deduct, ledger), admin (users, moderators, prices, dashboard stats), manual payment flow (create request → Google Sheet URL redirect → admin approve credits tokens). Seed admin.

### Stage 3 — Frontend swarm (webapp-building-swarm)
Pages: Coach chat home, Lesson Path composer, Repo detail (nested unit/lesson/prompt cards, 🎬 play buttons, lesson runs table), Repos gallery, Slide tool player (generated deck: paragraphs, components chart/latex/svg/table/stickynote/image/code, per-slide quiz, read-aloud, progress, finish→score), Slides gallery, Presentation runs (global), About, Settings (API keys, tokens, payment redirect), Admin (Dashboard, Users, Moderators, Settings/prices). Side-rail + top progress bar + prefetch-on-hover. Sketch design system.

### Stage 4 — Integration & generation engine polish
Wire frontend↔backend, verify cross-lesson memory loop end-to-end, affordability gate, role gating, TTS, build.

### Stage 5 — Verify & deliver
Production build, Dockerfile check, reviewer subagent pass, `website_version_manager build_version` (type: dynamic).

## Subagent assignments
- backend-builder (coder) — Stage 2
- frontend-builder ×N (coder) — Stage 3 (scoped page groups, main agent owns design system + shared components)
- reviewer/verifier — Stage 5
