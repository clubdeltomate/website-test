/**
 * Full economic-cycle integration test — runs ONLY when DATABASE_URL is set
 * (see scripts/run-cycle-test.sh, which spins up a throwaway Postgres). It
 * drives the real tRPC router end-to-end to prove the coins ↔ tickets economy:
 *
 *   1. A plain user requests to buy credits; the admin approves → they are
 *      credited AND promoted to moderator.
 *   2. The moderator builds slides for a lesson (charged coins) and saves a
 *      free preset.
 *   3. A guest / free user plays that preset with no credits and no tickets.
 *   4. The admin sells customization tickets to the moderator (moderator's
 *      credits debited at the ticket price, ticket pool grows).
 *   5. The moderator gifts tickets to the user for that repo.
 *   6. The user (who had none) is blocked from customizing until they hold a
 *      ticket, then spends exactly one per custom generation and can't
 *      double-spend.
 *   7. A general ticket pays for a standalone slide-tool deck, and coins pay
 *      for a customization when the user holds no ticket — the two currencies
 *      are interchangeable in both directions.
 *   8. Draining a moderator's credits demotes them back to a user.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { eq } from "drizzle-orm";
import { appRouter } from "./router.js";
import { getDb } from "./queries/connection.js";
import { customizations, users, slideTools, type User } from "@db/schema";
import { autoTicketPrice, estimateCost, ticketPrice, TICKET_MAX_SLIDES } from "./cost.js";
import { getSettings } from "./settings.js";
import { consumeOne, countAvailable, countSpendable } from "./tickets.js";
import { applyTokenDelta } from "./tokens.js";
import { LEVELS, TICKET_DECK_LIMITS } from "../contracts/types.js";

const HAS_DB = !!process.env.DATABASE_URL;

type Ctx = { req: Request; resHeaders: Headers; user?: User };
const ctxFor = (user?: User): Ctx => ({
  req: new Request("http://cycle.test"),
  resHeaders: new Headers(),
  user,
});
const call = (user?: User) => appRouter.createCaller(ctxFor(user));

async function reload(id: number): Promise<User> {
  const u = await getDb().query.users.findFirst({ where: eq(users.id, id) });
  if (!u) throw new Error(`user ${id} vanished`);
  return u;
}

let admin: User;
let moderator: User;
let student: User;
let toolSlug: string;

describe.runIf(HAS_DB)("full coins ↔ tickets cycle", () => {
  beforeAll(async () => {
    const db = getDb();
    // A helper slide tool so generation has something to seed from.
    const [tool] = await db
      .insert(slideTools)
      .values({
        slug: `tool-${Date.now()}`,
        name: "Cycle Tool",
        description: "test",
        topic: "Photosynthesis",
        instructions: "Teach it",
      })
      .returning();
    toolSlug = tool.slug;

    // Register three accounts through the real auth router.
    // Names double as unique usernames, so they have to be per-run too —
    // otherwise a second run of this suite collides with the first one's users.
    const stamp = Date.now();
    const a = await call().auth.register({ name: `Ada Admin ${stamp}`, email: `admin-${stamp}@t.co`, password: "pw123456" });
    const m = await call().auth.register({ name: `Mo Mod ${stamp}`, email: `mod-${stamp}@t.co`, password: "pw123456" });
    const s = await call().auth.register({ name: `Sam Student ${stamp}`, email: `stu-${stamp}@t.co`, password: "pw123456" });
    // Promote the admin (bootstrap — normally the first user / manual grant).
    await db.update(users).set({ role: "admin" }).where(eq(users.id, a.user.id));
    admin = await reload(a.user.id);
    moderator = await reload(m.user.id);
    student = await reload(s.user.id);
  });

  it("1) buying credits promotes a user to moderator", async () => {
    expect(moderator.role).toBe("user");
    const startBal = moderator.tokenBalance;
    // moderator-to-be requests to buy the 800 pack
    const { id } = await call(moderator).payments.submitPaidNote({ packId: "pack-800", note: "paid via wa" });
    // admin approves
    const res = await call(admin).payments.approve({ paymentId: id });
    expect(res.promoted).toBe(true);
    expect(res.balance).toBe(startBal + 800);
    moderator = await reload(moderator.id);
    expect(moderator.role).toBe("moderator");
    expect(moderator.tokenBalance).toBe(startBal + 800);
  });

  it("2) moderator builds a lesson (charged coins) and saves a free preset", async () => {
    const before = (await reload(moderator.id)).tokenBalance;
    // create repo + unit + lesson
    const repo = await call(moderator).repos.create({ title: "Bio Basics", template: "course", studyToolSlug: toolSlug });
    const unit = await call(moderator).units.create({ repoSlug: repo.slug, title: "Cells" });
    await call(moderator).lessons.create({ unitId: unit.unitId, title: "Photosynthesis", objective: "Explain photosynthesis" });

    const detail = await call(moderator).repos.getBySlug({ slug: repo.slug });
    const lesson = detail!.units[0].lessons[0];

    // build slides as the owner — charged coins (mock AI allowed in the harness)
    const gen = await call(moderator).generate.slides({
      toolSlug,
      level: "B1",
      slideCount: 4,
      imageStyle: "none",
      seed: {
        repoSlug: repo.slug,
        repoRef: detail!.ref,
        unitTitle: "Cells",
        lessonTitle: lesson.title,
        lessonIndex: 1,
        lessonCount: 1,
        lessonSeq: lesson.globalSeq,
        lessonSeqTotal: detail!.lessonCount,
      },
    });
    expect(gen.deck.slides.length).toBeGreaterThan(0);
    const afterBuild = (await reload(moderator.id)).tokenBalance;
    expect(afterBuild).toBeLessThan(before); // coins were spent to build

    // save the generated deck as the free preset
    await call(moderator).repos.setLessonPreset({
      repoSlug: repo.slug,
      lessonSeq: lesson.globalSeq,
      deck: gen.deck,
    });

    // stash for later steps
    (globalThis as Record<string, unknown>).__repoSlug = repo.slug;
    (globalThis as Record<string, unknown>).__repoRef = detail!.ref;
    (globalThis as Record<string, unknown>).__lessonSeq = lesson.globalSeq;
  });

  it("2b) the owner can edit the saved preset inline; a non-owner cannot", async () => {
    const repoSlug = (globalThis as Record<string, unknown>).__repoSlug as string;
    const lessonSeq = (globalThis as Record<string, unknown>).__lessonSeq as number;
    const current = await call().repos.lessonPreset({ repoSlug, lessonSeq });
    const deck = current!.deck;
    const edited = {
      ...deck,
      slides: deck.slides.map((s, i) => (i === 0 ? { ...s, title: "EDITED BY OWNER" } : s)),
    };
    // a non-owner student cannot edit someone else's preset
    await expect(
      call(student).repos.updateLessonPreset({ repoSlug, lessonSeq, deck: edited }),
    ).rejects.toThrow(/Only the owner/);
    // the owner can
    await call(moderator).repos.updateLessonPreset({ repoSlug, lessonSeq, deck: edited });
    const after = await call().repos.lessonPreset({ repoSlug, lessonSeq });
    expect(after!.deck.slides[0].title).toBe("EDITED BY OWNER");
  });

  it("2c) manual build: publishing a hand-made deck on a lesson with no preset", async () => {
    const repoSlug = (globalThis as Record<string, unknown>).__repoSlug as string;
    const detail = await call(moderator).repos.getBySlug({ slug: repoSlug });
    const unit = detail!.units[0];
    // a fresh lesson with no preset
    await call(moderator).lessons.create({ unitId: unit.id, title: "Hand-made lesson", objective: "By hand" });
    const fresh = (await call(moderator).repos.getBySlug({ slug: repoSlug }))!
      .units.flatMap((u) => u.lessons)
      .find((l) => l.title === "Hand-made lesson")!;
    expect(fresh.hasPreset).toBe(false);

    const manualDeck = {
      level: "B1",
      imageStyle: "none",
      topic: "manual",
      slides: [{ title: "Made by hand", components: [{ type: "prose", paragraphs: ["Typed it myself"] }] }],
    };
    await call(moderator).repos.updateLessonPreset({
      repoSlug,
      lessonSeq: fresh.globalSeq,
      deck: manualDeck,
    });
    // it becomes a free preset anyone can play
    const preset = await call().repos.lessonPreset({ repoSlug, lessonSeq: fresh.globalSeq });
    expect(preset!.deck.slides[0].title).toBe("Made by hand");
    const after = (await call(moderator).repos.getBySlug({ slug: repoSlug }))!
      .units.flatMap((u) => u.lessons)
      .find((l) => l.globalSeq === fresh.globalSeq)!;
    expect(after.hasPreset).toBe(true);
  });

  it("3) a free user plays the preset with no credits and no tickets", async () => {
    const repoSlug = (globalThis as Record<string, unknown>).__repoSlug as string;
    const lessonSeq = (globalThis as Record<string, unknown>).__lessonSeq as number;
    // student has starter credits but spends NONE fetching a preset; guests work too
    const asGuest = await call().repos.lessonPreset({ repoSlug, lessonSeq });
    expect(asGuest).not.toBeNull();
    expect(asGuest!.deck.slides.length).toBeGreaterThan(0);
    const asStudent = await call(student).repos.lessonPreset({ repoSlug, lessonSeq });
    expect(asStudent).not.toBeNull();
  });

  it("4) admin sells tickets to the moderator (credits → ticket pool)", async () => {
    const price = await ticketPrice();
    expect(price).toBeGreaterThan(0);
    const before = await reload(moderator.id);
    const res = await call(admin).tickets.sellToModerator({ userId: moderator.id, count: 3 });
    expect(res.unitPrice).toBe(price);
    expect(res.tokenBalance).toBe(before.tokenBalance - price * 3);
    expect(res.ticketBalance).toBe(before.ticketBalance + 3);
    moderator = await reload(moderator.id);
    expect(moderator.ticketBalance).toBe(before.ticketBalance + 3);
  });

  it("5) the student can't customize until the moderator gifts a ticket", async () => {
    const repoSlug = (globalThis as Record<string, unknown>).__repoSlug as string;
    const repoRef = (globalThis as Record<string, unknown>).__repoRef as string;
    const lessonSeq = (globalThis as Record<string, unknown>).__lessonSeq as number;
    const seed = {
      repoSlug,
      repoRef,
      unitTitle: "Cells",
      lessonTitle: "Photosynthesis",
      lessonIndex: 1,
      lessonCount: 1,
      lessonSeq,
      lessonSeqTotal: 1,
    };

    // No ticket and no coins → blocked, and the refusal names the other door
    // (a ticket) rather than only the one they're standing at.
    await expect(
      call(student).generate.slides({ toolSlug, level: "B1", slideCount: 4, imageStyle: "none", seed }),
    ).rejects.toThrow(/INSUFFICIENT_TOKENS.*ticket would cover/s);

    // moderator gifts 2 tickets by email
    const poolBefore = (await reload(moderator.id)).ticketBalance;
    const grant = await call(moderator).tickets.grantToUser({
      repoSlug,
      userEmail: student.email,
      count: 2,
    });
    expect(grant.remaining).toBe(poolBefore - 2);
    const avail = await call(student).tickets.availableFor({ repoSlug });
    expect(avail.count).toBe(2);
  });

  it("6) spending a ticket decrements the balance and can't be double-spent", async () => {
    const db = getDb();
    const repoSlug = (globalThis as Record<string, unknown>).__repoSlug as string;
    const repo = await db.query.repos.findFirst({ where: (r, { eq: e }) => e(r.slug, repoSlug) });
    const repoId = repo!.id;

    expect(await countAvailable(student.id, repoId)).toBe(2);
    // consumeOne is exactly what generate.slides calls on a successful custom build
    expect(await consumeOne(student.id, { repoId })).toBe(true);
    expect(await countAvailable(student.id, repoId)).toBe(1);
    expect(await consumeOne(student.id, { repoId })).toBe(true);
    expect(await countAvailable(student.id, repoId)).toBe(0);
    // out of tickets → cannot spend a third
    expect(await consumeOne(student.id, { repoId })).toBe(false);
  });

  it("7) the creator appears in the public directory & profile; can be favorited", async () => {
    const repoSlug = (globalThis as Record<string, unknown>).__repoSlug as string;
    // student favorites the creator
    const fav = await call(student).users.toggleFavorite({ userId: moderator.id });
    expect(fav.favorite).toBe(true);

    // directory (as the student) lists the creator, marked favorite
    const dir = await call(student).users.directory({});
    const entry = dir.find((u) => u.id === moderator.id);
    expect(entry).toBeTruthy();
    expect(entry!.repoCount).toBeGreaterThanOrEqual(1);
    expect(entry!.favorite).toBe(true);

    // profile returns their public repo (savable/browsable catalog) + slide tools
    const prof = await call(student).users.profile({ userId: moderator.id });
    expect(prof.favorite).toBe(true);
    expect(prof.repos.some((r) => r.slug === repoSlug)).toBe(true);
    expect(Array.isArray(prof.slideTools)).toBe(true);

    // the directory lists EVERY user now — including the student (0 repos)
    const stu = dir.find((u) => u.id === student.id);
    expect(stu).toBeTruthy();
    expect(stu!.repoCount).toBe(0);
    // and the creator's entry carries its repo categories for topic filtering
    expect(entry!.templates).toContain("course");
  });

  it("8) a student requests tickets and the owner grants from the request queue", async () => {
    const db = getDb();
    const repoSlug = (globalThis as Record<string, unknown>).__repoSlug as string;
    const repo = await db.query.repos.findFirst({ where: (r, { eq: e }) => e(r.slug, repoSlug) });
    const repoId = repo!.id;

    // student submits a pull request for 1 ticket
    await call(student).tickets.request({ repoSlug, count: 1, note: "want it in Spanish" });
    const incoming = await call(moderator).tickets.incoming();
    expect(incoming.length).toBe(1);
    expect(incoming[0].requesterEmail).toBe(student.email);

    const before = await countAvailable(student.id, repoId);
    await call(moderator).tickets.resolveRequest({ requestId: incoming[0].id, approve: true });
    expect(await countAvailable(student.id, repoId)).toBe(before + 1);
    // queue is now empty
    expect((await call(moderator).tickets.incoming()).length).toBe(0);
  });

  it("8b) a student's ticket customization is saved as their own and is per-user", async () => {
    const db = getDb();
    const repoSlug = (globalThis as Record<string, unknown>).__repoSlug as string;
    const lessonSeq = (globalThis as Record<string, unknown>).__lessonSeq as number;
    const repo = await db.query.repos.findFirst({ where: (r, { eq: e }) => e(r.slug, repoSlug) });

    // no customization yet
    expect(await call(student).repos.myCustomization({ repoSlug, lessonSeq })).toBeNull();

    // save one (this is what the slide tool does after a ticket generation)
    const customDeck = { level: "B1", imageStyle: "none", topic: "custom", slides: [{ title: "MY CUSTOM SLIDE", components: [] }] };
    await call(student).repos.saveMyCustomization({ repoSlug, lessonSeq, deck: customDeck });

    const mine = await call(student).repos.myCustomization({ repoSlug, lessonSeq });
    expect(mine!.deck.slides[0].title).toBe("MY CUSTOM SLIDE");

    // it shows on the student's repo view but NOT the moderator's (per-user)
    const stuView = await call(student).repos.getBySlug({ slug: repoSlug });
    const modView = await call(moderator).repos.getBySlug({ slug: repoSlug });
    const stuLesson = stuView!.units.flatMap((u) => u.lessons).find((l) => l.globalSeq === lessonSeq);
    const modLesson = modView!.units.flatMap((u) => u.lessons).find((l) => l.globalSeq === lessonSeq);
    expect(stuLesson!.myHasCustomization).toBe(true);
    expect(modLesson!.myHasCustomization).toBe(false);

    // regenerating replaces in place — still exactly one row for this student
    void repo;
    const deck2 = { ...customDeck, slides: [{ title: "REPLACED", components: [] }] };
    await call(student).repos.saveMyCustomization({ repoSlug, lessonSeq, deck: deck2 });
    const after = await call(student).repos.myCustomization({ repoSlug, lessonSeq });
    expect(after!.deck.slides[0].title).toBe("REPLACED");
    const rows = await db
      .select()
      .from(customizations)
      .where(eq(customizations.userId, student.id));
    expect(rows.length).toBe(1);
  });

  it("8c) hand-built (human) slide tool: create, play deck, badge source", async () => {
    const deck = {
      level: "B1",
      imageStyle: "none",
      topic: "By hand",
      slides: [{ title: "Handmade", components: [{ type: "prose", paragraphs: ["No AI here"] }] }],
    };
    const { slug } = await call(moderator).slideTools.createManual({
      name: `Manual Deck ${Date.now()}`,
      deck,
    });
    // deck plays directly (public, no charge)
    const played = await call().slideTools.deck({ slug });
    expect(played!.deck.slides[0].title).toBe("Handmade");
    // summary marks it human-authored with a saved deck
    const summary = await call().slideTools.getBySlug({ slug });
    expect(summary.source).toBe("human");
    expect(summary.hasDeck).toBe(true);
    // a plain AI tool reports source "ai" and no deck
    const aiSummary = await call().slideTools.getBySlug({ slug: toolSlug });
    expect(aiSummary.source).toBe("ai");
    expect(aiSummary.hasDeck).toBe(false);
    // editing the deck is owner-gated
    await expect(
      call(student).slideTools.saveDeck({ slug, deck }),
    ).rejects.toThrow(/Only the owner/);
    // editing does NOT change classification — a hand-built tool stays "human",
    // and (the rule) merely editing never turns an "ai" tool "human".
    await call(moderator).slideTools.saveDeck({
      slug,
      deck: { ...deck, slides: [{ title: "edited", components: [] }] },
    });
    expect((await call().slideTools.getBySlug({ slug })).source).toBe("human");
  });

  it("8d) hand-laid repo is marked source \"human\"; generator repo is \"ai\"", async () => {
    const human = await call(moderator).repos.create({
      title: `Hand Repo ${Date.now()}`,
      description: "by hand",
      template: "course",
      source: "human",
    });
    const humanDetail = await call(moderator).repos.getBySlug({ slug: human.slug });
    expect(humanDetail!.source).toBe("human");
    // the earlier AI-built repo defaults to "ai"
    const aiSlug = (globalThis as Record<string, unknown>).__repoSlug as string;
    const aiDetail = await call(moderator).repos.getBySlug({ slug: aiSlug });
    expect(aiDetail!.source).toBe("ai");
  });

  it("8e) a slide tool carries a category; commercial generation adds no quiz", async () => {
    // create a product (shop) tool via the create endpoint
    const { slug } = await call(moderator).slideTools.create({
      name: `Aura Ring ${Date.now()}`,
      template: "shop",
    });
    const summary = await call().slideTools.getBySlug({ slug });
    expect(summary.template).toBe("shop");

    // generating from it (mock deck in the harness) yields a commercial deck
    // with NO quizzes on any slide
    const gen = await call(moderator).generate.slides({
      toolSlug: slug,
      level: "B1",
      slideCount: 4,
      imageStyle: "none",
    });
    expect(gen.deck.slides.length).toBeGreaterThan(0);
    expect(gen.deck.slides.every((s) => s.quiz == null)).toBe(true);
    // and a standalone commercial deck surfaces the owner's contact screen
    expect(gen.commercial).not.toBeNull();
    expect(gen.commercial!.repoSlug).toBeNull();
  });

  it("9) a general ticket pays for a standalone slide-tool deck instead of coins", async () => {
    // The student has no coins at all — if the deck generates, only a ticket
    // could have paid for it. Earlier steps left them holding repo-scoped
    // tickets, and those are spendable on the slide tool too, so burn them
    // first or this proves nothing.
    student = await reload(student.id);
    expect(student.tokenBalance).toBe(0);
    while (await consumeOne(student.id, { repoId: null })) {
      /* drain */
    }

    // A standalone deck (no seed) is refused with nothing to pay with...
    await expect(
      call(student).generate.slides({ toolSlug, level: "B1", slideCount: 4, imageStyle: "none" }),
    ).rejects.toThrow(/INSUFFICIENT_TOKENS/);

    // ...so the moderator gifts a GENERAL ticket — no repoSlug, so it belongs
    // to no repo and is spendable on the slide tool.
    await call(admin).tickets.grantFree({ userId: moderator.id, count: 2 });
    await call(moderator).tickets.grantToUser({ userEmail: student.email, count: 1 });
    expect(await countSpendable(student.id, { repoId: null })).toBe(1);

    const gen = await call(student).generate.slides({
      toolSlug,
      level: "B1",
      slideCount: 4,
      imageStyle: "none",
    });
    // The same request that was refused a moment ago now succeeds, and the
    // balance is still zero — the ticket is the only thing that can have paid.
    expect(gen.deck.slides.length).toBeGreaterThan(0);
    expect((await reload(student.id)).tokenBalance).toBe(0);
    // Spending itself is asserted in step 6: this harness runs on mock AI, and
    // a mock deck deliberately consumes nothing (a deck that cost nothing to
    // make must not cost the holder a ticket).
  });

  it("9b) the ticket entitlement matches what a ticket is priced to cover", async () => {
    // These are one constant precisely so they cannot drift; if the deck
    // ceiling ever moves without the ticket price following, tickets start
    // selling below cost. Guarding it here is cheaper than discovering it in
    // the ledger.
    expect(TICKET_DECK_LIMITS.maxSlides).toBe(TICKET_MAX_SLIDES);
    expect(TICKET_DECK_LIMITS.maxLevel).toBe(LEVELS[LEVELS.length - 1]);
    // And the AUTO price covers the biggest deck a ticket can buy. Deliberately
    // the auto price, not the live one: Finance lets the admin pin a ticket
    // price below cost on purpose (a promotion, a giveaway), so asserting on
    // the live price would fail on a business decision rather than a bug.
    const { prices } = await getSettings();
    const worst = await estimateCost({
      slideCount: TICKET_DECK_LIMITS.maxSlides,
      imageStyle: "sketch",
      withTts: false,
      level: TICKET_DECK_LIMITS.maxLevel,
      usingOwnKey: false,
    });
    expect(autoTicketPrice(prices)).toBeGreaterThanOrEqual(worst.total);
  });

  it("9c) coins customize a repo when the user holds no ticket", async () => {
    const repoSlug = (globalThis as Record<string, unknown>).__repoSlug as string;
    const repoRef = (globalThis as Record<string, unknown>).__repoRef as string;
    const lessonSeq = (globalThis as Record<string, unknown>).__lessonSeq as number;
    const db = getDb();
    const repo = await db.query.repos.findFirst({ where: (r, { eq: e }) => e(r.slug, repoSlug) });

    // Burn the general ticket left over from 9b so only coins remain.
    await consumeOne(student.id, { repoId: null });
    expect(await countSpendable(student.id, { repoId: repo!.id })).toBe(0);

    await applyTokenDelta(student.id, 400, "coins for the customization test");
    // The caller context carries a SNAPSHOT of the user, and the balance check
    // reads it — so the credit has to be reloaded into `student` or the router
    // still sees the old zero.
    student = await reload(student.id);
    const before = student.tokenBalance;

    const gen = await call(student).generate.slides({
      toolSlug,
      level: "B1",
      slideCount: 4,
      imageStyle: "none",
      seed: {
        repoSlug,
        repoRef,
        unitTitle: "Cells",
        lessonTitle: "Photosynthesis",
        lessonIndex: 1,
        lessonCount: 1,
        lessonSeq,
        lessonSeqTotal: 1,
      },
    });
    expect(gen.deck.slides.length).toBeGreaterThan(0);
    // Charged in coins — the path that used to be ticket-or-nothing.
    expect((await reload(student.id)).tokenBalance).toBeLessThan(before);

    // Drain them again so test 10's demotion check starts where it expects.
    const left = (await reload(student.id)).tokenBalance;
    if (left > 0) await applyTokenDelta(student.id, -left, "drain after customization test");
  });

  it("10) draining a moderator's credits demotes them to a user", async () => {
    const m = await reload(moderator.id);
    expect(m.role).toBe("moderator");
    await applyTokenDelta(m.id, -m.tokenBalance, "drain for test");
    const after = await reload(moderator.id);
    expect(after.tokenBalance).toBe(0);
    expect(after.role).toBe("user");
  });
});
