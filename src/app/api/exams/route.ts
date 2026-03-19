import { NextResponse } from "next/server";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";
import { getAdminDb } from "@/lib/firebase/admin";

export const runtime = "nodejs";

type SessionPayload = { code?: string; role?: string } | null;

const SUBJECTS = new Set(["طقس", "اجبيه", "قطمارس", "الحان", "قبطي"]);

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

function splitChunks<T>(arr: T[], size: number) {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

async function loadUser(db: ReturnType<typeof getAdminDb>, code: string) {
  const directDoc = await db.collection("users").doc(code).get();
  if (directDoc.exists) {
    return directDoc.data() as {
      role?: string;
      name?: string;
      classes?: string[];
      childrenCodes?: string[];
      subjects?: string[];
    };
  }
  const snapshot = await db.collection("users").where("code", "==", code).limit(1).get();
  if (snapshot.empty) return null;
  return snapshot.docs[0].data() as {
    role?: string;
    name?: string;
    classes?: string[];
    childrenCodes?: string[];
    subjects?: string[];
  };
}

async function getClassesForActor(
  db: ReturnType<typeof getAdminDb>,
  role: string,
  actor: { classes?: string[]; childrenCodes?: string[] },
) {
  if (role === "student") {
    return normalizeList(actor.classes, true);
  }
  if (role === "parent") {
    const childCodes = normalizeList(actor.childrenCodes);
    const classSet = new Set<string>();
    for (const code of childCodes) {
      const childDoc = await db.collection("users").doc(code).get();
      let child: { classes?: string[] } | null = null;
      if (childDoc.exists) {
        child = childDoc.data() as { classes?: string[] };
      } else {
        const snap = await db.collection("users").where("code", "==", code).limit(1).get();
        if (!snap.empty) {
          child = snap.docs[0].data() as { classes?: string[] };
        }
      }
      if (!child) continue;
      normalizeList(child.classes, true).forEach((cls) => classSet.add(cls));
    }
    return Array.from(classSet);
  }
  return [];
}

function classMatches(classId: string, target: string) {
  return normalizeClassId(classId) === normalizeClassId(target);
}

export async function GET(request: Request) {
  const session = decodeSessionFromCookie(request);
  const actorCode = String(session?.code ?? "").trim();
  const role = normalizeRole(String(session?.role ?? "").trim());
  if (!actorCode || !role) {
    return NextResponse.json({ ok: false, message: "Unauthorized." }, { status: 401 });
  }

  const db = getAdminDb();
  const actor = await loadUser(db, actorCode);
  if (!actor) {
    return NextResponse.json({ ok: false, message: "User not found." }, { status: 404 });
  }

  const url = new URL(request.url);
  const subjectFilter = String(url.searchParams.get("subject") ?? "").trim();
  const classFilter = String(url.searchParams.get("classId") ?? "").trim();

  const examsSnap = await db.collection("exams").orderBy("createdAt", "desc").get();
  const allExams = examsSnap.docs.map((doc) => ({ id: doc.id, ...(doc.data() as Record<string, unknown>) }));

  let filtered = allExams;
  if (subjectFilter) {
    filtered = filtered.filter((item) => String(item.subject ?? "") === subjectFilter);
  }
  if (classFilter) {
    filtered = filtered.filter((item) => classMatches(String(item.classId ?? ""), classFilter));
  }

  if (role === "teacher") {
    const subjects = normalizeList(actor.subjects);
    filtered = filtered.filter((item) => subjects.includes(String(item.subject ?? "")));
  }
  if (role === "student" || role === "parent") {
    const classes = await getClassesForActor(db, role, actor);
    filtered = filtered.filter((item) =>
      classes.some((cls) => classMatches(cls, String(item.classId ?? ""))),
    );
    filtered = filtered.filter((item) => String(item.status ?? "published") !== "draft");
  }

  if (role === "student") {
    const submissionsSnap = await db
      .collection("exam_submissions")
      .where("studentCode", "==", actorCode)
      .get();
    const submissionMap = new Map<string, Record<string, unknown>>();
    submissionsSnap.docs.forEach((doc) => {
      const data = doc.data() as Record<string, unknown>;
      const examId = String(data.examId ?? "");
      if (examId) submissionMap.set(examId, data);
    });
    filtered = filtered.map((exam) => {
      const submission = submissionMap.get(String(exam.id));
      return {
        ...exam,
        submissionStatus: submission?.finished ? "finished" : submission ? "in_progress" : "new",
        score: submission?.score ?? null,
        pendingCount: submission?.pendingCount ?? 0,
      };
    });
  }

  return NextResponse.json({ ok: true, data: filtered });
}

export async function POST(request: Request) {
  const session = decodeSessionFromCookie(request);
  const actorCode = String(session?.code ?? "").trim();
  const role = normalizeRole(String(session?.role ?? "").trim());
  if (!actorCode || !role || !["admin", "teacher"].includes(role)) {
    return NextResponse.json({ ok: false, message: "Unauthorized." }, { status: 401 });
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
  const actor = await loadUser(db, actorCode);
  if (!actor) {
    return NextResponse.json({ ok: false, message: "User not found." }, { status: 404 });
  }

  if (role === "teacher") {
    const subjects = normalizeList(actor.subjects);
    if (!subjects.includes(subject)) {
      return NextResponse.json({ ok: false, message: "غير مسموح بإنشاء امتحان لهذه المادة." }, { status: 403 });
    }
    const classes = normalizeList(actor.classes, true);
    if (classes.length && !classes.includes(classId)) {
      return NextResponse.json({ ok: false, message: "غير مسموح بإنشاء امتحان لهذا الفصل." }, { status: 403 });
    }
  }

  const now = new Date().toISOString();
  const examRef = await db.collection("exams").add({
    title,
    subject,
    classId,
    startAt,
    endAt,
    showAnswers,
    showScores,
    examRules,
    status,
    createdBy: {
      code: actorCode,
      name: String(actor.name ?? ""),
      role,
    },
    createdAt: now,
    questionCount: questions.length,
    submissionsCount: 0,
  });

  const batch = db.batch();
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
        examId: examRef.id,
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
        examId: examRef.id,
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
        examId: examRef.id,
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
        examId: examRef.id,
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
        examId: examRef.id,
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

  await batch.commit();
  await examRef.update({ updatedAt: FieldValue.serverTimestamp() });

  if (status === "published") {
    const notifyTitle = "اختبار جديد";
    const notifyBody = `${title}${subject ? ` - ${subject}` : ""} | الفصل: ${classId}`;
    const createdAt = Timestamp.now();
    try {
      await db.collection("notifications").add({
        title: notifyTitle,
        body: notifyBody,
        createdAt,
        createdBy: { name: String(actor.name ?? ""), code: actorCode, role },
        audience: { type: "class", classId, className: classId },
        data: { type: "exam", examId: examRef.id, classId },
      });
    } catch (notifyError) {
      console.error("Exam notification doc failed:", notifyError);
    }

    try {
      const tokensSnapshot = await db
        .collection("pushTokens")
        .where("classIds", "array-contains", classId)
        .get();
      const tokens = tokensSnapshot.docs
        .map((d) => (d.data() as { token?: string }).token)
        .filter(Boolean) as string[];
      if (tokens.length) {
        const messaging = getMessaging();
        for (const chunk of splitChunks(tokens, 500)) {
          await messaging.sendEachForMulticast({
            tokens: chunk,
            notification: { title: notifyTitle, body: notifyBody },
            data: { type: "exam", examId: examRef.id, classId },
          });
        }
      }
    } catch (pushError) {
      console.error("Exam notification push failed:", pushError);
    }
  }

  return NextResponse.json({ ok: true, data: { id: examRef.id } });
}
