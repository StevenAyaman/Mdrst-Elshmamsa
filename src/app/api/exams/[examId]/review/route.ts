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
  const actorCode = String(session?.code ?? "").trim();
  const role = normalizeRole(String(session?.role ?? "").trim());
  if (!actorCode || role !== "student") {
    return NextResponse.json({ ok: false, message: "Unauthorized." }, { status: 401 });
  }

  const examId = decodeURIComponent(String(resolvedParams.examId ?? "")).trim();
  if (!examId) {
    return NextResponse.json({ ok: false, message: "Exam not found." }, { status: 404 });
  }

  const db = getAdminDb();
  const examSnap = await db.collection("exams").doc(examId).get();
  if (!examSnap.exists) {
    return NextResponse.json({ ok: false, message: "Exam not found." }, { status: 404 });
  }
  const exam = examSnap.data() as Record<string, unknown>;
  const allowShowAnswers = Boolean(exam.showAnswers);
  const allowShowScores = Boolean(exam.showScores);

  const submissionId = `${examId}_${actorCode}`;
  const submissionSnap = await db.collection("exam_submissions").doc(submissionId).get();
  if (!submissionSnap.exists) {
    return NextResponse.json({ ok: false, message: "لا توجد محاولة." }, { status: 404 });
  }
  const submission = submissionSnap.data() as Record<string, unknown>;
  if (!submission.finished) {
    return NextResponse.json({ ok: false, message: "لم يتم تسليم الامتحان بعد." }, { status: 403 });
  }

  const questionsSnap = await db.collection("questions").where("examId", "==", examId).get();
  const questionMap = new Map<string, Record<string, unknown>>();
  questionsSnap.docs.forEach((doc) => questionMap.set(doc.id, doc.data() as Record<string, unknown>));

  const order = Array.isArray(submission.questionOrder)
    ? (submission.questionOrder as string[]).map((q) => String(q))
    : questionsSnap.docs.map((doc) => doc.id);
  const optionOrder = (submission.optionOrder ?? {}) as Record<string, string[]>;
  const correctMap: Record<string, string[]> = {};
  const matchCorrectMap: Record<string, Record<string, string>> = {};
  const pointsMap: Record<string, number> = {};
  const questions = order.map((qid) => {
    const q = questionMap.get(qid) ?? {};
    const options = optionOrder[qid] ?? (Array.isArray(q.options) ? q.options : []);
    const correctOptions = Array.isArray(q.correctOptions)
      ? q.correctOptions.map((o: string) => String(o))
      : q.correctOption
        ? [String(q.correctOption)]
        : [];
    correctMap[qid] = allowShowAnswers ? correctOptions : [];
    pointsMap[qid] = allowShowScores ? Number(q.points ?? 1) : 0;
    if (String(q.type) === "match") {
      const matchRows = Array.isArray(q.matchRows) ? q.matchRows.map((r: string) => String(r)) : [];
      const matchOptions = optionOrder[qid] ?? (Array.isArray(q.matchOptions) ? q.matchOptions : []);
      const matchCorrectIndices = Array.isArray(q.matchCorrectIndices)
        ? q.matchCorrectIndices.map((v: number) => Number(v))
        : [];
      const mapped: Record<string, string> = {};
      matchRows.forEach((row, idx) => {
        const optIndex = matchCorrectIndices[idx] ?? 0;
        mapped[String(row)] = String(matchOptions?.[optIndex] ?? "");
      });
      matchCorrectMap[qid] = allowShowAnswers ? mapped : {};
    }
    return {
      id: qid,
      type: q.type,
      text: q.text,
      options,
      allowMultiple: Boolean(q.allowMultiple ?? false),
      orderItems: optionOrder[qid] ?? q.orderItems ?? [],
      matchRows: q.matchRows ?? [],
      matchOptions: optionOrder[qid] ?? q.matchOptions ?? [],
      imageUrl: q.imageUrl ?? "",
    };
  });

  const answers = (submission.answers ?? {}) as Record<string, unknown>;

  return NextResponse.json({
    ok: true,
    data: {
      questions,
      answers,
      correctMap,
      matchCorrectMap,
      pointsMap,
      showAnswers: allowShowAnswers,
      showScores: allowShowScores,
    },
  });
}
