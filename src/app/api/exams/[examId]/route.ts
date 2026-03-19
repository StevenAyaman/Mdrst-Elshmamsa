import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { FieldValue } from "firebase-admin/firestore";

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

const SUBJECTS = new Set(["طقس", "اجبيه", "قطمارس", "الحان", "قبطي"]);

function normalizeClassId(value: string) {
  return String(value ?? "").trim().toUpperCase();
}

function normalizeList(value: unknown, upper = false) {
  const raw = Array.isArray(value)
    ? value.map((v) => String(v))
    : typeof value === "string"
      ? value.split(/[,،]/).map((v) => String(v).trim())
      : [];
  return raw
    .map((v) => (upper ? normalizeClassId(v) : String(v).trim()))
    .filter(Boolean);
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
    if (process.env.NODE_ENV !== "production") {
      const listSnap = await db.collection("exams").limit(10).get();
      const ids = listSnap.docs.map((doc) => doc.id);
      return NextResponse.json(
        { ok: false, message: "Exam not found.", debugIds: ids, debugAsked: examId },
        { status: 404 },
      );
    }
    return NextResponse.json({ ok: false, message: "Exam not found." }, { status: 404 });
  }

  const questionsSnap = await db.collection("questions").where("examId", "==", examId).get();
  const questions = questionsSnap.docs.map((doc) => ({
    id: doc.id,
    ...(doc.data() as Record<string, unknown>),
  }));

  return NextResponse.json({
    ok: true,
    data: { exam: { id: examId, ...examSnap.data() }, questions },
  });
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ examId: string }> },
) {
  const resolvedParams = await params;
  const session = decodeSessionFromCookie(request);
  const role = normalizeRole(String(session?.role ?? "").trim());
  const actorCode = String(session?.code ?? "").trim();
  if (!role || !actorCode || !["admin", "teacher"].includes(role)) {
    return NextResponse.json({ ok: false, message: "Unauthorized." }, { status: 401 });
  }

  const examId = decodeURIComponent(String(resolvedParams.examId ?? "")).trim();
  if (!examId) {
    return NextResponse.json({ ok: false, message: "Exam not found." }, { status: 404 });
  }

  const body = await request.json();
  const title = String(body?.title ?? "").trim();
  const subject = String(body?.subject ?? "").trim();
  const classId = normalizeClassId(body?.classId ?? "");
  const startAt = String(body?.startAt ?? "").trim();
  const endAt = String(body?.endAt ?? "").trim();
  const showAnswers = Boolean(body?.showAnswers ?? false);
  const showScores = Boolean(body?.showScores ?? false);
  const examRules = String(body?.examRules ?? "").trim();
  const questions = Array.isArray(body?.questions) ? body.questions : [];
  const status = String(body?.status ?? "published").trim() === "draft" ? "draft" : "published";

  if (!title || !subject || !classId) {
    return NextResponse.json({ ok: false, message: "بيانات الامتحان غير مكتملة." }, { status: 400 });
  }
  if (status === "published" && questions.length === 0) {
    return NextResponse.json({ ok: false, message: "برجاء إضافة أسئلة للامتحان." }, { status: 400 });
  }
  if (status === "published" && !startAt) {
    return NextResponse.json({ ok: false, message: "برجاء إدخال وقت بداية الامتحان." }, { status: 400 });
  }
  if (status === "published" && !endAt) {
    return NextResponse.json({ ok: false, message: "برجاء إدخال وقت نهاية الامتحان." }, { status: 400 });
  }
  if (status === "published" && !examRules) {
    return NextResponse.json({ ok: false, message: "برجاء إدخال لائحة الاختبار." }, { status: 400 });
  }
  if (status === "published" && new Date(startAt).getTime() >= new Date(endAt).getTime()) {
    return NextResponse.json({ ok: false, message: "وقت نهاية الامتحان يجب أن يكون بعد البداية." }, { status: 400 });
  }
  if (!SUBJECTS.has(subject)) {
    return NextResponse.json({ ok: false, message: "المادة غير معروفة." }, { status: 400 });
  }

  const db = getAdminDb();
  const examRef = db.collection("exams").doc(examId);
  const examSnap = await examRef.get();
  if (!examSnap.exists) {
    return NextResponse.json({ ok: false, message: "Exam not found." }, { status: 404 });
  }

  const actorSnap = await db.collection("users").doc(actorCode).get();
  const actor = actorSnap.exists ? (actorSnap.data() as { subjects?: string[]; classes?: string[] }) : null;
  if (!actor) {
    return NextResponse.json({ ok: false, message: "User not found." }, { status: 404 });
  }

  if (role === "teacher") {
    const subjects = normalizeList(actor.subjects);
    if (!subjects.includes(subject)) {
      return NextResponse.json({ ok: false, message: "غير مسموح بتعديل هذا الامتحان." }, { status: 403 });
    }
    const classes = normalizeList(actor.classes, true);
    if (classes.length && !classes.includes(classId)) {
      return NextResponse.json({ ok: false, message: "غير مسموح بتعديل هذا الفصل." }, { status: 403 });
    }
    const currentStatus = String(examSnap.data()?.status ?? "published");
    if (currentStatus !== "draft") {
      return NextResponse.json({ ok: false, message: "يمكن تعديل المسودات فقط." }, { status: 403 });
    }
  }

  const now = new Date().toISOString();
  const batch = db.batch();
  const questionsSnap = await db.collection("questions").where("examId", "==", examId).get();
  questionsSnap.docs.forEach((doc) => batch.delete(doc.ref));

  questions.forEach((q: Record<string, unknown>, index: number) => {
    const type = String(q.type ?? "").trim();
    const text = String(q.text ?? "").trim();
    const timeLimitSeconds = Number(q.timeLimitSeconds ?? 0);
    const imageUrl = String(q.imageUrl ?? "").trim();
    const points = Number(q.points ?? 1);
    if (!type || !text || !Number.isFinite(timeLimitSeconds) || timeLimitSeconds <= 0) {
      return;
    }
    const questionRef = db.collection("questions").doc();
    if (type === "mcq") {
      const options = Array.isArray(q.options) ? q.options.map((o) => String(o ?? "").trim()).filter(Boolean) : [];
      const correctIndices = Array.isArray(q.correctIndices)
        ? q.correctIndices.map((v) => Number(v)).filter((v) => Number.isFinite(v))
        : [];
      if (options.length < 2 || options.length > 5 || correctIndices.length === 0) return;
      const correctOptions = correctIndices
        .filter((idx) => idx >= 0 && idx < options.length)
        .map((idx) => options[idx]);
      if (correctOptions.length === 0) return;
      batch.set(questionRef, {
        examId,
        type,
        text,
        options,
        correctOptions,
        allowMultiple: correctOptions.length > 1,
        imageUrl,
        timeLimitSeconds,
        points: Number.isFinite(points) && points > 0 ? points : 1,
        order: index,
        createdAt: now,
      });
    } else if (type === "order") {
      const orderItems = Array.isArray(q.orderItems)
        ? q.orderItems.map((o) => String(o ?? "").trim()).filter(Boolean)
        : [];
      if (orderItems.length < 2) return;
      batch.set(questionRef, {
        examId,
        type: "order",
        text,
        orderItems,
        options: [],
        imageUrl,
        timeLimitSeconds,
        points: Number.isFinite(points) && points > 0 ? points : 1,
        order: index,
        createdAt: now,
      });
    } else if (type === "match") {
      const matchRows = Array.isArray(q.matchRows)
        ? q.matchRows.map((r) => String(r ?? "").trim()).filter(Boolean)
        : [];
      const matchOptions = Array.isArray(q.matchOptions)
        ? q.matchOptions.map((c) => String(c ?? "").trim()).filter(Boolean)
        : [];
      const matchCorrectIndices = Array.isArray(q.matchCorrectIndices)
        ? q.matchCorrectIndices.map((v) => Number(v)).filter((v) => Number.isFinite(v))
        : [];
      if (matchRows.length < 2 || matchOptions.length < 2) return;
      if (matchCorrectIndices.length !== matchRows.length) return;
      batch.set(questionRef, {
        examId,
        type: "match",
        text,
        matchRows,
        matchOptions,
        matchCorrectIndices,
        options: [],
        imageUrl,
        timeLimitSeconds,
        points: Number.isFinite(points) && points > 0 ? points : 1,
        order: index,
        createdAt: now,
      });
    } else if (type === "text") {
      batch.set(questionRef, {
        examId,
        type: "text",
        text,
        options: [],
        imageUrl,
        timeLimitSeconds,
        points: Number.isFinite(points) && points > 0 ? points : 1,
        order: index,
        createdAt: now,
      });
    } else {
      batch.set(questionRef, {
        examId,
        type: "image",
        text,
        options: [],
        imageUrl,
        timeLimitSeconds,
        points: Number.isFinite(points) && points > 0 ? points : 1,
        order: index,
        createdAt: now,
      });
    }
  });

  batch.update(examRef, {
    title,
    subject,
    classId,
    startAt,
    endAt,
    showAnswers,
    showScores,
    examRules,
    status,
    questionCount: questions.length,
    updatedAt: FieldValue.serverTimestamp(),
  });

  await batch.commit();

  return NextResponse.json({ ok: true, data: { id: examId } });
}

export async function DELETE(
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
  const examRef = db.collection("exams").doc(examId);
  const examSnap = await examRef.get();
  if (!examSnap.exists) {
    return NextResponse.json({ ok: false, message: "Exam not found." }, { status: 404 });
  }

  const questionsSnap = await db.collection("questions").where("examId", "==", examId).get();
  const submissionsSnap = await db.collection("exam_submissions").where("examId", "==", examId).get();

  const batch = db.batch();
  questionsSnap.docs.forEach((doc) => batch.delete(doc.ref));
  submissionsSnap.docs.forEach((doc) => batch.delete(doc.ref));
  batch.delete(examRef);
  await batch.commit();

  return NextResponse.json({ ok: true });
}
