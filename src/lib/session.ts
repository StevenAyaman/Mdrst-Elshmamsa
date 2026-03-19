import { getAdminDb } from "@/lib/firebase/admin";

export type SessionUser = {
  code: string;
  role: string;
};

export function normalizeRole(role: string) {
  return role === "nzam" ? "system" : role;
}

export function decodeSessionFromCookie(request: Request): SessionUser | null {
  const cookieHeader = request.headers.get("cookie") ?? "";
  const pairs = cookieHeader.split(";").map((v) => v.trim());
  const sessionPair = pairs.find((p) => p.startsWith("dsms_session="));
  if (!sessionPair) return null;
  const encoded = sessionPair.slice("dsms_session=".length);
  try {
    const decoded = Buffer.from(encoded, "base64url").toString("utf8");
    const parsed = JSON.parse(decoded) as { code?: string; role?: string };
    const code = String(parsed.code ?? "").trim();
    const role = normalizeRole(String(parsed.role ?? "").trim().toLowerCase());
    if (!code || !role) return null;
    return { code, role };
  } catch {
    return null;
  }
}

export async function getUserByCode(code: string) {
  const db = getAdminDb();
  const direct = await db.collection("users").doc(code).get();
  if (direct.exists) return direct;
  const byCode = await db.collection("users").where("code", "==", code).limit(1).get();
  if (byCode.empty) return null;
  return byCode.docs[0];
}

export async function getActivePeriod() {
  const db = getAdminDb();
  const snap = await db
    .collection("service_periods")
    .where("active", "==", true)
    .limit(1)
    .get();
  if (snap.empty) return null;
  const doc = snap.docs[0];
  const data = doc.data() as {
    name?: string;
    startDate?: string;
    endDate?: string;
    term1Name?: string;
    term2Name?: string;
    activeTerm?: string;
    term1Start?: string;
    term1End?: string;
    term2Start?: string;
    term2End?: string;
  };
  return {
    id: doc.id,
    name: String(data.name ?? "").trim(),
    startDate: String(data.startDate ?? "").trim(),
    endDate: String(data.endDate ?? "").trim(),
    term1Name: String(data.term1Name ?? "").trim(),
    term2Name: String(data.term2Name ?? "").trim(),
    activeTerm: data.activeTerm === "term2" ? "term2" : "term1",
    term1Start: String(data.term1Start ?? "").trim(),
    term1End: String(data.term1End ?? "").trim(),
    term2Start: String(data.term2Start ?? "").trim(),
    term2End: String(data.term2End ?? "").trim(),
  };
}

export function isIsoDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function toDayBounds(dateIso: string) {
  return {
    start: new Date(`${dateIso}T00:00:00.000Z`),
    end: new Date(`${dateIso}T23:59:59.999Z`),
  };
}
