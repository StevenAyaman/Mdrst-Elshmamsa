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

function normalizeClassId(value: string) {
  return String(value ?? "").trim().toUpperCase();
}

function shuffle<T>(items: T[]) {
  const list = [...items];
  for (let i = list.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

async function loadUser(db: ReturnType<typeof getAdminDb>, code: string) {
  const directDoc = await db.collection("users").doc(code).get();
  if (directDoc.exists) return directDoc.data() as { classes?: string[] };
  const snapshot = await db.collection("users").where("code", "==", code).limit(1).get();
  if (snapshot.empty) return null;
  return snapshot.docs[0].data() as { classes?: string[] };
}

function normalizeList(value: unknown) {
  const raw = Array.isArray(value)
    ? value.map((v) => String(v))
    : typeof value === "string"
      ? value.split(/[,،]/).map((v) => String(v).trim())
      : [];
  return raw.map((v) => normalizeClassId(v)).filter(Boolean);
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

  const examId = decodeURIComponent(String(resolvedParams.examId ?? "")).trim();
  if (!examId) {
    return NextResponse.json({ ok: false, message: "Exam not found." }, { status: 404 });
  }

  const db = getAdminDb();
  const examRef = db.collection("exams").doc(examId);
  let examSnap = await examRef.get();
  if (!examSnap.exists) {
    const normalizeId = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, "");
    const fallbackSnap = await db.collection("exams").get();
    const normalizedTarget = normalizeId(examId);
    const matched = fallbackSnap.docs.find(
      (doc) => normalizeId(doc.id) === normalizedTarget,
    );
    if (matched) {
      examSnap = matched;
    }
  }
  if (!examSnap.exists) {
    return NextResponse.json({ ok: false, message: "Exam not found." }, { status: 404 });
  }
  const exam = examSnap.data() as Record<string, unknown>;
  const classId = normalizeClassId(String(exam.classId ?? ""));
  const startAt = String(exam.startAt ?? "").trim();
  const endAt = String(exam.endAt ?? "").trim();

  const actor = await loadUser(db, actorCode);
  if (!actor) {
    return NextResponse.json({ ok: false, message: "User not found." }, { status: 404 });
  }
  const classes = normalizeList(actor.classes);
  if (classId && !classes.includes(classId)) {
    return NextResponse.json({ ok: false, message: "غير مسموح لهذا الفصل." }, { status: 403 });
  }

  const submissionId = `${examId}_${actorCode}`;
  const submissionRef = db.collection("exam_submissions").doc(submissionId);
  const submissionSnap = await submissionRef.get();
  if (submissionSnap.exists) {
    const data = submissionSnap.data() as Record<string, unknown>;
    if (data.finished) {
      return NextResponse.json({ ok: false, message: "تم تسليم الامتحان بالفعل.", finished: true }, { status: 403 });
    }
    const questionOrder = Array.isArray(data.questionOrder)
      ? (data.questionOrder as string[]).map((q) => String(q))
      : [];
    const optionOrder = (data.optionOrder ?? {}) as Record<string, string[]>;
    const questionsSnap = await db
      .collection("questions")
      .where("examId", "==", examId)
      .get();
    const questionMap = new Map<string, Record<string, unknown>>();
    questionsSnap.docs.forEach((doc) => questionMap.set(doc.id, doc.data() as Record<string, unknown>));
    const questions = questionOrder.map((qid) => {
      const q = questionMap.get(qid) ?? {};
      return {
        id: qid,
        type: q.type,
        text: q.text,
        timeLimitSeconds: q.timeLimitSeconds,
        points: q.points ?? 1,
        imageUrl: q.imageUrl ?? "",
        allowMultiple: Boolean(q.allowMultiple ?? false),
        options: optionOrder[qid] ?? q.options ?? [],
        orderItems: optionOrder[qid] ?? q.orderItems ?? [],
        matchRows: q.matchRows ?? [],
        matchOptions: optionOrder[qid] ?? q.matchOptions ?? [],
      };
    });
    return NextResponse.json({ ok: true, data: { exam: { id: examId, ...exam }, submission: data, questions } });
  }

  const nowMs = Date.now();
  if (startAt) {
    const startTs = new Date(startAt).getTime();
    if (Number.isFinite(startTs) && nowMs < startTs) {
      return NextResponse.json({ ok: false, message: "لم يبدأ الامتحان بعد." }, { status: 403 });
    }
  }
  if (endAt) {
    const endTs = new Date(endAt).getTime();
    if (Number.isFinite(endTs) && nowMs > endTs) {
      return NextResponse.json({ ok: false, message: "انتهى وقت الامتحان." }, { status: 403 });
    }
  }

  const questionsSnap = await db.collection("questions").where("examId", "==", examId).get();
  const questionsRaw: Array<Record<string, unknown> & { id: string }> = questionsSnap.docs.map(
    (doc) => ({ id: doc.id, ...(doc.data() as Record<string, unknown>) }),
  );
  const randomized = shuffle(questionsRaw) as Array<Record<string, unknown> & { id: string }>;
  const questionOrder = randomized.map((q) => String(q.id));
  const optionOrder: Record<string, string[]> = {};
  const questions = randomized.map((q) => {
    const qData = q as Record<string, unknown> & { id: string };
    const qId = String(qData.id);
    const type = String(qData.type ?? "mcq");
    const options = Array.isArray(qData.options)
      ? (qData.options as string[]).map((o) => String(o)).filter(Boolean)
      : [];
    const orderItems = Array.isArray(qData.orderItems)
      ? (qData.orderItems as string[]).map((o) => String(o)).filter(Boolean)
      : [];
    const matchOptions = Array.isArray(qData.matchOptions)
      ? (qData.matchOptions as string[]).map((o) => String(o)).filter(Boolean)
      : [];
    const orderedOptions = type === "mcq" ? shuffle(options) : [];
    const orderedItems = type === "order" ? shuffle(orderItems) : [];
    const orderedMatchOptions = type === "match" ? shuffle(matchOptions) : [];
    if (type === "mcq") optionOrder[qId] = orderedOptions;
    if (type === "order") optionOrder[qId] = orderedItems;
    if (type === "match") optionOrder[qId] = orderedMatchOptions;
    return {
      id: q.id,
      type,
      text: q.text,
      timeLimitSeconds: q.timeLimitSeconds,
      points: q.points ?? 1,
      imageUrl: q.imageUrl ?? "",
      allowMultiple: Boolean(q.allowMultiple ?? false),
      options: type === "mcq" ? orderedOptions : [],
      orderItems: type === "order" ? orderedItems : [],
      matchRows: q.matchRows ?? [],
      matchOptions: type === "match" ? orderedMatchOptions : [],
    };
  });

  const now = new Date().toISOString();
  const submission = {
    examId,
    studentCode: actorCode,
    classId,
    createdAt: now,
    updatedAt: now,
    finished: false,
    currentIndex: 0,
    questionOrder,
    optionOrder,
    answers: {},
    totalQuestions: questionOrder.length,
    score: 0,
    pendingCount: 0,
  };
  await submissionRef.set(submission);

  return NextResponse.json({ ok: true, data: { exam: { id: examId, ...exam }, submission, questions } });
}
