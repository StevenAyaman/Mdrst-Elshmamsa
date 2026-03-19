import { NextResponse } from "next/server";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";
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

function splitChunks<T>(arr: T[], size: number) {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ examId: string }> },
) {
  const resolvedParams = await params;
  const session = decodeSessionFromCookie(request);
  const role = normalizeRole(String(session?.role ?? "").trim());
  if (!role || !["admin", "teacher"].includes(role)) {
    return NextResponse.json({ ok: false, message: "Unauthorized." }, { status: 401 });
  }

  const examId = String(resolvedParams.examId ?? "").trim();
  const body = await request.json();
  const studentCode = String(body?.studentCode ?? "").trim();
  const questionId = String(body?.questionId ?? "").trim();
  const score = Number(body?.score ?? 0);
  if (!examId || !studentCode || !questionId) {
    return NextResponse.json({ ok: false, message: "بيانات غير مكتملة." }, { status: 400 });
  }

  const db = getAdminDb();
  const questionSnap = await db.collection("questions").doc(questionId).get();
  const question = questionSnap.exists ? (questionSnap.data() as Record<string, unknown>) : null;
  const maxPoints = Number(question?.points ?? 0);
  const submissionId = `${examId}_${studentCode}`;
  const submissionRef = db.collection("exam_submissions").doc(submissionId);
  const submissionSnap = await submissionRef.get();
  if (!submissionSnap.exists) {
    return NextResponse.json({ ok: false, message: "لا توجد محاولة لهذا الطالب." }, { status: 404 });
  }
  const submission = submissionSnap.data() as Record<string, unknown>;
  const answers = (submission.answers ?? {}) as Record<
    string,
    { score?: number; pending?: boolean; reviewedAt?: string }
  >;
  if (!answers[questionId]) {
    return NextResponse.json({ ok: false, message: "الإجابة غير موجودة." }, { status: 404 });
  }

  answers[questionId] = {
    ...answers[questionId],
    score: Number.isFinite(score)
      ? maxPoints > 0
        ? Math.min(score, maxPoints)
        : score
      : 0,
    pending: false,
    reviewedAt: new Date().toISOString(),
  };

  let totalScore = 0;
  let pendingCount = 0;
  Object.values(answers).forEach((answer) => {
    if (answer?.pending) pendingCount += 1;
    totalScore += Number(answer?.score ?? 0);
  });

  await submissionRef.update({
    [`answers.${questionId}`]: answers[questionId],
    pendingCount,
    score: totalScore,
    updatedAt: FieldValue.serverTimestamp(),
  });

  try {
    const examSnap = await db.collection("exams").doc(examId).get();
    const examTitle = examSnap.exists
      ? String((examSnap.data() as { title?: string }).title ?? "اختبار")
      : "اختبار";

    const studentDoc = await db.collection("users").doc(studentCode).get();
    const studentData = studentDoc.exists
      ? (studentDoc.data() as { name?: string; parentCodes?: string[] })
      : {};
    const studentName = String(studentData?.name ?? studentCode).trim();
    const parentCodes = Array.isArray(studentData?.parentCodes)
      ? studentData.parentCodes.map((code) => String(code).trim()).filter(Boolean)
      : [];
    const targetCodes = Array.from(new Set([studentCode, ...parentCodes]));

    if (targetCodes.length) {
      const notifyTitle = "تحديث درجة الامتحان";
      const notifyBody = `${examTitle} | ${studentName} | الدرجة: ${Number(answers[questionId]?.score ?? 0)}`;
      await db.collection("notifications").add({
        title: notifyTitle,
        body: notifyBody,
        createdAt: Timestamp.now(),
        createdBy: { name: "نظام التصحيح", code: "system", role: "system" },
        audience: { type: "users", userCodes: targetCodes },
        data: { type: "exam_grade", examId, questionId, studentCode },
      });

      const tokenSet = new Set<string>();
      for (const codesChunk of splitChunks(targetCodes, 10)) {
        const tokensSnapshot = await db
          .collection("pushTokens")
          .where("userCode", "in", codesChunk)
          .get();
        for (const tokenDoc of tokensSnapshot.docs) {
          const token = String((tokenDoc.data() as { token?: string }).token ?? "").trim();
          if (token) tokenSet.add(token);
        }
      }
      const tokens = Array.from(tokenSet);
      if (tokens.length) {
        const messaging = getMessaging();
        for (const tokenChunk of splitChunks(tokens, 500)) {
          await messaging.sendEachForMulticast({
            tokens: tokenChunk,
            notification: { title: notifyTitle, body: notifyBody },
            data: { type: "exam_grade", examId, questionId, studentCode },
          });
        }
      }
    }
  } catch (notifyError) {
    console.error("Exam grade notification failed:", notifyError);
  }

  return NextResponse.json({ ok: true });
}
