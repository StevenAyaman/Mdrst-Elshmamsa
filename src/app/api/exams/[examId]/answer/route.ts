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
  const payload = (await request.json()) as Record<string, unknown>;
  const questionId = String(payload?.questionId ?? "").trim();
  const questionIndex = Number(payload?.questionIndex ?? 0);
  const autoAdvance = Boolean(payload?.autoAdvance ?? false);
  if (!examId || !questionId) {
    return NextResponse.json({ ok: false, message: "بيانات غير مكتملة." }, { status: 400 });
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
    return NextResponse.json({ ok: false, message: "تم تسليم الامتحان بالفعل." }, { status: 403 });
  }
  const existingAnswers =
    submission && typeof submission.answers === "object" && submission.answers
      ? (submission.answers as Record<string, Record<string, unknown>>)
      : {};
  const existingAnswer = existingAnswers[questionId] ?? {};

  const currentIndex = Number(submission.currentIndex ?? 0);
  if (Number.isFinite(questionIndex) && questionIndex !== currentIndex) {
    return NextResponse.json({ ok: false, message: "لا يمكنك الرجوع للسؤال السابق." }, { status: 400 });
  }

  const questionSnap = await db.collection("questions").doc(questionId).get();
  if (!questionSnap.exists) {
    return NextResponse.json({ ok: false, message: "السؤال غير موجود." }, { status: 404 });
  }
  const question = questionSnap.data() as Record<string, unknown>;
  const type = String(question.type ?? "mcq");
  const points = Number(question.points ?? 1);
  const correctOptionsRaw = Array.isArray(question.correctOptions)
    ? question.correctOptions.map((o) => String(o))
    : [];
  const correctOption = String(question.correctOption ?? "");
  const correctOptions = correctOptionsRaw.length ? correctOptionsRaw : correctOption ? [correctOption] : [];

  const answerPayload: Record<string, unknown> = {
    type,
    answeredAt: new Date().toISOString(),
  };
  if (type === "mcq") {
    const selectedOption = String(payload?.selectedOption ?? "");
    const selectedOptions = Array.isArray(payload?.selectedOptions)
      ? (payload.selectedOptions as unknown[])
          .map((o) => String(o))
          .filter(Boolean)
      : selectedOption
        ? [selectedOption]
        : [];
    const normalizedSelected = Array.from(new Set(selectedOptions)).map((opt) => String(opt));
    const normalizedCorrect = Array.from(new Set(correctOptions)).map((opt) => String(opt));
    const isCorrect =
      normalizedSelected.length === normalizedCorrect.length &&
      normalizedSelected.every((opt) => normalizedCorrect.includes(opt));
    answerPayload.selectedOptions = normalizedSelected;
    answerPayload.selectedOption = selectedOption;
    answerPayload.correct = isCorrect;
    answerPayload.score = isCorrect ? (Number.isFinite(points) ? points : 1) : 0;
  } else if (type === "image") {
    const imageUrls = Array.isArray(payload?.imageUrls)
      ? payload.imageUrls.map((u: string) => String(u)).filter(Boolean)
      : [];
    const existingImages = Array.isArray(existingAnswer.imageUrls)
      ? (existingAnswer.imageUrls as string[]).map((u) => String(u)).filter(Boolean)
      : [];
    answerPayload.imageUrls = imageUrls.length ? imageUrls : existingImages;
    answerPayload.pending = true;
    answerPayload.score = 0;
  } else if (type === "text") {
    const answerText = String(payload?.answerText ?? "").trim();
    answerPayload.answerText = answerText;
    answerPayload.pending = true;
    answerPayload.score = 0;
  } else if (type === "order") {
    const orderAnswer = Array.isArray(payload?.orderAnswer)
      ? payload.orderAnswer.map((o: string) => String(o)).filter(Boolean)
      : [];
    answerPayload.orderAnswer = orderAnswer;
    answerPayload.pending = true;
    answerPayload.score = 0;
  } else if (type === "match") {
    const selections = payload?.rowSelections ?? {};
    const rowSelections =
      selections && typeof selections === "object"
        ? Object.fromEntries(
            Object.entries(selections as Record<string, unknown>).map(([row, value]) => [
              String(row),
              String(value ?? ""),
            ]),
          )
        : {};
    const matchRows = Array.isArray(question.matchRows)
      ? question.matchRows.map((r: string) => String(r))
      : [];
    const matchOptions = Array.isArray(question.matchOptions)
      ? question.matchOptions.map((o: string) => String(o))
      : [];
    const matchCorrectIndices = Array.isArray(question.matchCorrectIndices)
      ? question.matchCorrectIndices.map((v: number) => Number(v))
      : [];
    let correctCount = 0;
    matchRows.forEach((row, idx) => {
      const correctIdx = matchCorrectIndices[idx] ?? -1;
      const correctOpt = matchOptions[correctIdx] ?? "";
      if (correctOpt && String(rowSelections[row] ?? "") === String(correctOpt)) {
        correctCount += 1;
      }
    });
    const totalRows = matchRows.length || 1;
    const perQuestion = Number.isFinite(points) ? points : 1;
    const score = Math.round((perQuestion * (correctCount / totalRows)) * 100) / 100;
    answerPayload.rowSelections = rowSelections;
    answerPayload.correctCount = correctCount;
    answerPayload.pending = false;
    answerPayload.score = score;
  } else {
    answerPayload.pending = true;
    answerPayload.score = 0;
  }

  const updates: Record<string, unknown> = {
    [`answers.${questionId}`]: answerPayload,
    updatedAt: FieldValue.serverTimestamp(),
  };

  if (autoAdvance) {
    updates.currentIndex = currentIndex + 1;
  }

  await submissionRef.update(updates);

  return NextResponse.json({ ok: true });
}
