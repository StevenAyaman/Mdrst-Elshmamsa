import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";

export const runtime = "nodejs";

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

function normalizeRole(role: string) {
  return role === "nzam" ? "system" : role;
}

async function verifyAdminActor(actorCode: string, actorRole: string) {
  if (normalizeRole(actorRole) !== "admin") return false;
  const db = getAdminDb();
  const doc = await db.collection("users").doc(actorCode).get();
  if (!doc.exists) return false;
  const data = doc.data() as { role?: string };
  return normalizeRole(String(data.role ?? "").trim().toLowerCase()) === "admin";
}

export async function POST(request: Request) {
  try {
    const session = decodeSessionFromCookie(request);
    if (!session?.code || !session?.role) {
      return NextResponse.json({ ok: false, message: "Unauthorized." }, { status: 401 });
    }

    const body = (await request.json()) as {
      actorCode?: string;
      actorRole?: string;
      teacherCode?: string;
      classId?: string;
    };

    const actorCode = String(body.actorCode ?? "").trim();
    const actorRole = String(body.actorRole ?? "").trim().toLowerCase();
    const teacherCode = String(body.teacherCode ?? "").trim();
    const classId = String(body.classId ?? "").trim().toUpperCase();

    if (!actorCode || !actorRole || !teacherCode || !classId) {
      return NextResponse.json({ ok: false, message: "Missing required fields." }, { status: 400 });
    }

    const sessionRole = normalizeRole(session.role);
    if (session.code !== actorCode || sessionRole !== normalizeRole(actorRole)) {
      return NextResponse.json({ ok: false, message: "Session mismatch." }, { status: 401 });
    }

    const canEdit = await verifyAdminActor(actorCode, actorRole);
    if (!canEdit) {
      return NextResponse.json({ ok: false, message: "Not allowed." }, { status: 403 });
    }

    const db = getAdminDb();
    const classDoc = await db.collection("classes").doc(classId).get();
    if (!classDoc.exists) {
      return NextResponse.json({ ok: false, message: "Class not found." }, { status: 404 });
    }

    const teacherRef = db.collection("users").doc(teacherCode);
    const teacherDoc = await teacherRef.get();
    if (!teacherDoc.exists) {
      return NextResponse.json({ ok: false, message: "Teacher not found." }, { status: 404 });
    }
    const teacher = teacherDoc.data() as { role?: string };
    if (normalizeRole(String(teacher.role ?? "").trim().toLowerCase()) !== "teacher") {
      return NextResponse.json({ ok: false, message: "Target user is not teacher." }, { status: 400 });
    }

    await teacherRef.update({
      classes: FieldValue.arrayUnion(classId),
      updatedAt: new Date().toISOString(),
    });

    return NextResponse.json({ ok: true, data: { teacherCode, classId } });
  } catch (error) {
    console.error("POST /api/users/classes error:", error);
    return NextResponse.json({ ok: false, message: "Failed to update teacher classes." }, { status: 500 });
  }
}
