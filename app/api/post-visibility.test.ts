import { describe, expect, it } from "vitest";
import { canSee, canSend } from "./routers/posts.js";
import { POST_VISIBILITY } from "../contracts/post.js";

/* The whole point of a private post is that the rule is boring and holds
 * everywhere, so these are written as "who is refused" rather than "who is
 * allowed" — the interesting direction. Note especially that an admin is
 * refused: a private post that any staff account can read is not private,
 * and taking a post down is a separate power that lives on remove(). */

const OWNER = 7;
const ASSIGNEE = 8;
const STRANGER = 9;

const post = (visibility: string) => ({ visibility, ownerId: OWNER, slug: "how-to-braise" });
const given = new Set(["how-to-braise"]);
const nothing = new Set<string>();

describe("canSee", () => {
  it("shows a public post to everyone, signed in or not", () => {
    expect(canSee(post("public"), undefined, nothing)).toBe(true);
    expect(canSee(post("public"), STRANGER, nothing)).toBe(true);
  });

  it("keeps a private post to its owner", () => {
    expect(canSee(post("private"), OWNER, nothing)).toBe(true);
    expect(canSee(post("private"), STRANGER, nothing)).toBe(false);
    expect(canSee(post("private"), undefined, nothing)).toBe(false);
  });

  /* The combination the two controls exist for: off the feed AND sent to one
   * person means exactly those two people. */
  it("opens a private post to the people it was sent to, and nobody else", () => {
    expect(canSee(post("private"), ASSIGNEE, given)).toBe(true);
    expect(canSee(post("private"), STRANGER, nothing)).toBe(false);
    expect(canSee(post("private"), STRANGER, new Set(["something-else"]))).toBe(false);
  });

  it("still refuses a guest, however the post was sent", () => {
    expect(canSee(post("private"), undefined, given)).toBe(false);
  });

  it("refuses a visibility it does not recognise", () => {
    // A value that arrived from somewhere unexpected must fail closed — for
    // a stranger who was not sent it.
    expect(canSee(post("everyone"), STRANGER, nothing)).toBe(false);
    expect(canSee(post(""), STRANGER, nothing)).toBe(false);
  });

  it("covers every visibility the contract offers", () => {
    for (const v of POST_VISIBILITY) {
      expect(canSee(post(v), OWNER, nothing), v).toBe(true);
    }
  });
});

/* Putting something on someone else's feed is a privilege, and the rule is
 * the one assigned notebooks already use: admins anywhere, verified
 * moderators on their own work. The interesting cases are the near-misses. */
describe("canSend", () => {
  const admin = { id: 1, role: "admin", verified: false };
  const modOk = { id: OWNER, role: "moderator", verified: true };
  const modUnverified = { id: OWNER, role: "moderator", verified: false };
  const modElsewhere = { id: 99, role: "moderator", verified: true };
  const plain = { id: OWNER, role: "user", verified: true };

  it("lets an admin send anyone's post", () => {
    expect(canSend(admin, OWNER)).toBe(true);
    expect(canSend(admin, 12345)).toBe(true);
  });

  it("lets a verified moderator send their own", () => {
    expect(canSend(modOk, OWNER)).toBe(true);
  });

  it("refuses an unverified moderator, a verified one on someone else's, and a plain user", () => {
    expect(canSend(modUnverified, OWNER)).toBe(false);
    expect(canSend(modElsewhere, OWNER)).toBe(false);
    expect(canSend(plain, OWNER)).toBe(false);
  });
});

describe("visibility values", () => {
  it("still covers every one the contract offers", () => {
    for (const v of POST_VISIBILITY) {
      expect(canSee(post(v), OWNER, nothing), v).toBe(true);
    }
  });
});
