import bcrypt from "bcryptjs";

const SALT_ROUNDS = 10;

export async function hashPassword(raw: string) {
  const normalized = raw.trim();
  return bcrypt.hash(normalized, SALT_ROUNDS);
}

export async function verifyPassword(raw: string, hash: string) {
  const normalized = raw.trim();
  return bcrypt.compare(normalized, hash);
}
