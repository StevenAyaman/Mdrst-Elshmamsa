import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";

export const runtime = "nodejs";

type RoleCount = {
  admin: number;
  system: number;
  teacher: number;
  parent: number;
  notes: number;
  student: number;
  classes: number;
};

async function countRole(role: string) {
  const db = getAdminDb();
  const snapshot = await db.collection("users").where("role", "==", role).count().get();
  return snapshot.data().count ?? 0;
}

function decodeSessionFromCookie(request: Request) {
  const cookieHeader = request.headers.get("cookie") ?? "";
  const pairs = cookieHeader.split(";").map((v) => v.trim());
  const sessionPair = pairs.find((p) => p.startsWith("dsms_session="));
  if (!sessionPair) return null;
  const encoded = sessionPair.slice("dsms_session=".length);
  try {
    const decoded = Buffer.from(encoded, "base64url").toString("utf8");
    const parsed = JSON.parse(decoded) as { code?: string; role?: string };
    return {
      code: String(parsed.code ?? "").trim(),
      role: String(parsed.role ?? "").trim().toLowerCase(),
    };
  } catch {
    return null;
  }
}

async function verifyAdminActor(actorCode: string, actorRole: string) {
  if (actorRole !== "admin") return false;
  const db = getAdminDb();
  const doc = await db.collection("users").doc(actorCode).get();
  if (!doc.exists) return false;
  const data = doc.data() as { role?: string };
  return String(data.role ?? "").trim().toLowerCase() === "admin";
}

export async function GET(request: Request) {
  try {
    const session = decodeSessionFromCookie(request);
    if (!session?.code || !session?.role) {
      return NextResponse.json({ ok: false, message: "Unauthorized." }, { status: 401 });
    }
    const isAdmin = await verifyAdminActor(session.code, session.role);
    if (!isAdmin) {
      return NextResponse.json({ ok: false, message: "Not allowed." }, { status: 403 });
    }
    const [admin, system, teacher, parent, notes, student, nzam, classes] = await Promise.all([
      countRole("admin"),
      countRole("system"),
      countRole("teacher"),
      countRole("parent"),
      countRole("notes"),
      countRole("student"),
      countRole("nzam"),
      getAdminDb().collection("classes").count().get().then((s) => s.data().count ?? 0),
    ]);

    const data: RoleCount = {
      admin,
      system: system + nzam,
      teacher,
      parent,
      notes,
      student,
      classes,
    };
    return NextResponse.json({ ok: true, data });
  } catch (error) {
    console.error("GET /api/stats error:", error);
    return NextResponse.json({ ok: false, message: "Failed to load stats." }, { status: 500 });
  }
}
