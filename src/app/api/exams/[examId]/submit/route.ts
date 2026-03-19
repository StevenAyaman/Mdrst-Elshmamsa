import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
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

export async function POST(
  request: Request,
  { params }: { params: Promise<{ examId: string }> },
) {
  const resolvedParams = await params;
  const session = decodeSessionFromCookie(request);
  const actorCode = String(session?.code ?? "").trim();
  const role = normalizeRole(String(session?.role ?? "").trim());
  if (!actorCode || role !== "student") {
    return NextResponse.json({ ok: false, message: "Unauthorized." }, { status: 401 });
  }

  const examId = String(resolvedParams.examId ?? "").trim();
  if (!examId) {
    return NextResponse.json({ ok: false, message: "Exam not found." }, { status: 404 });
  }

  const db = getAdminDb();
  const submissionId = `${examId}_${actorCode}`;
  const submissionRef = db.collection("exam_submissions").doc(submissionId);
  const submissionSnap = await submissionRef.get();
  if (!submissionSnap.exists) {
    return NextResponse.json({ ok: false, message: "لا توجد محاولة نشطة." }, { status: 404 });
  }

  const submission = submissionSnap.data() as Record<string, unknown>;
  if (submission.finished) {
    return NextResponse.json({ ok: true, data: submission });
  }

  const answers = (submission.answers ?? {}) as Record<string, { score?: number; pending?: boolean }>;
  let score = 0;
  let pendingCount = 0;
  Object.values(answers).forEach((answer) => {
    if (answer?.pending) pendingCount += 1;
    score += Number(answer?.score ?? 0);
  });

  await submissionRef.update({
    finished: true,
    submittedAt: new Date().toISOString(),
    score,
    pendingCount,
    updatedAt: FieldValue.serverTimestamp(),
  });

  await db.collection("exams").doc(examId).update({
    submissionsCount: FieldValue.increment(1),
    updatedAt: FieldValue.serverTimestamp(),
  });

  return NextResponse.json({ ok: true });
}
