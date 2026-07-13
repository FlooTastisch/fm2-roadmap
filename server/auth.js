import crypto from "node:crypto";

const SCRYPT_KEYLEN = 64;

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, SCRYPT_KEYLEN);
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

export function verifyPassword(password, stored) {
  const [saltHex, hashHex] = stored.split(":");
  if (!saltHex || !hashHex) return false;
  const salt = Buffer.from(saltHex, "hex");
  const hash = Buffer.from(hashHex, "hex");
  const test = crypto.scryptSync(password, salt, SCRYPT_KEYLEN);
  if (hash.length !== test.length) return false;
  return crypto.timingSafeEqual(hash, test);
}

export const ROLES = ["admin", "editor", "observer", "viewer"];

export function canWrite(role) {
  return role === "admin" || role === "editor";
}

export function isAdmin(role) {
  return role === "admin";
}

/** Sieht die komplette Roadmap ohne Sichtfenster-Begrenzung
 *  (Admin sowie Beobachter – Letzterer ohne Schreib-/Admin-Rechte). */
export function canSeeAll(role) {
  return role === "admin" || role === "observer";
}
