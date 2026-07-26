import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";

/**
 * Email/password auth helpers. The signing secret comes from JWT_SECRET;
 * falls back to APP_SECRET (graft env) so a missing JWT_SECRET never crashes dev.
 */
function secret(): string {
  const s = process.env.JWT_SECRET || process.env.APP_SECRET;
  if (!s) {
    throw new Error("JWT_SECRET (or APP_SECRET) must be set for auth");
  }
  return s;
}

export interface AuthTokenPayload {
  sub: number; // user id
  email: string;
}

export function hashPassword(plain: string): string {
  return bcrypt.hashSync(plain, 10);
}

export function verifyPassword(plain: string, hash: string): boolean {
  return bcrypt.compareSync(plain, hash);
}

export function signAuthToken(payload: AuthTokenPayload): string {
  return jwt.sign(payload, secret(), { expiresIn: "30d" });
}

export function verifyAuthToken(token: string): AuthTokenPayload | null {
  try {
    const decoded = jwt.verify(token, secret());
    if (
      typeof decoded === "object" &&
      decoded !== null &&
      typeof (decoded as { sub?: unknown }).sub === "number"
    ) {
      return decoded as unknown as AuthTokenPayload;
    }
    return null;
  } catch {
    return null;
  }
}

/** Mask an API key for display: first 6 + … + last 4 */
export function maskApiKey(key: string): string {
  if (key.length <= 10) return key.slice(0, 2) + "…" + key.slice(-2);
  return `${key.slice(0, 6)}…${key.slice(-4)}`;
}
