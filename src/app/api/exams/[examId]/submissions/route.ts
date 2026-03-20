import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";

export const runtime = "nodejs";

type SessionPayload = { code?: string; role?: string } | null;

function decodeSessionFromCookie(request: Request): SessionPayload {
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

export async function GET(
  request: Request,
  { params }: { params: Promise<{ examId: string }> },
) {
  const resolvedParams = await params;
  const session = decodeSessionFromCookie(request);
  const role = normalizeRole(String(session?.role ?? "").trim());
  if (!role || !["admin", "teacher"].includes(role)) {
    return NextResponse.json({ ok: false, message: "Unauthorized." }, { status: 401 });
  }

  const examId = decodeURIComponent(String(resolvedParams.examId ?? "")).trim();
  if (!examId) {
    return NextResponse.json({ ok: false, message: "Exam not found." }, { status: 404 });
  }

  const db = getAdminDb();
  const submissionsSnap = await db
    .collection("exam_submissions")
    .where("examId", "==", examId)
    .get();
  const submissions: Array<Record<string, unknown> & { id: string; studentCode?: string }> =
    submissionsSnap.docs.map((doc) => ({
      id: doc.id,
      ...(doc.data() as Record<string, unknown>),
    }));

  const studentCodes = submissions
    .map((item) => String(item.studentCode ?? ""))
    .filter(Boolean);
  const studentMap = new Map<string, { name?: string; classes?: string[] }>();
  for (const code of studentCodes) {
    const directDoc = await db.collection("users").doc(code).get();
    if (directDoc.exists) {
      studentMap.set(code, directDoc.data() as { name?: string; classes?: string[] });
      continue;
    }
    const snap = await db.collection("users").where("code", "==", code).limit(1).get();
    if (!snap.empty) {
      studentMap.set(code, snap.docs[0].data() as { name?: string; classes?: string[] });
    }
  }

  const enriched = submissions.map((item) => {
    const code = String(item.studentCode ?? "");
    const student = studentMap.get(code);
    return {
      ...item,
      studentName: student?.name ?? "",
      studentClass: Array.isArray(student?.classes) ? String(student?.classes[0] ?? "") : "",
    };
  });

  return NextResponse.json({ ok: true, data: enriched });
}
