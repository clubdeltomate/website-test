/* One-off: set the seeded admin's password to 123456 and verify through   */
/* the real auth.login procedure (including bare-username "admin" login).  */
/* Run: npx tsx scripts/set-admin-pw.ts                                    */
import { getDb } from "../api/queries/connection";
import { users } from "../db/schema";
import { eq } from "drizzle-orm";
import { hashPassword } from "../api/auth-utils";
import { appRouter } from "../api/router";

async function main() {
  const db = getDb();
  const admin = await db.query.users.findFirst({
    where: eq(users.email, "admin@sketchlearn.app"),
  });
  if (!admin) throw new Error("admin@sketchlearn.app not found — run the seed first");

  await db
    .update(users)
    .set({ passwordHash: hashPassword("123456") })
    .where(eq(users.id, admin.id));
  console.log(`updated password for ${admin.email} (id ${admin.id})`);

  // Verify through the REAL auth.login procedure — by email and by bare username.
  const caller = appRouter.createCaller({
    req: new Request("http://localhost/api/trpc"),
    resHeaders: new Headers(),
  });
  const byEmail = await caller.auth.login({ email: "admin@sketchlearn.app", password: "123456" });
  console.log(`login by email OK: ${byEmail.user.name} (${byEmail.user.role}), token issued: ${!!byEmail.token}`);
  const byName = await caller.auth.login({ email: "admin", password: "123456" });
  console.log(`login by username "admin" OK: ${byName.user.name} (${byName.user.email})`);

  // wrong password must still fail with the generic message
  try {
    await caller.auth.login({ email: "admin", password: "wrong-password" });
    throw new Error("UNEXPECTED: wrong password logged in");
  } catch (err) {
    console.log(`wrong password rejected: ${(err as Error).message}`);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
