import { createHash, randomBytes } from "node:crypto";

/** Raw token goes in the email link; only its hash is stored. */
export function newInviteToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashInviteToken(token) };
}

export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
