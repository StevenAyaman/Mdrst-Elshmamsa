import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { mapRole } from "@/lib/code-mapper";
import { decodeSessionFromCookie, getActivePeriod, getUserByCode, normalizeRole } from "@/lib/session";

type ResultsSettingsDoc = {
  allowedTeacherCodes?: string[];
  currentTerm?: "term1" | "term2";
  availableSubjects?: Record<string, { term1?: string[]; term2?: string[] }>;
};

type SubjectLimitDoc = {
  minScore?: number;
  maxScore?: number;
  classworkMinScore?: number;
  classworkMaxScore?: number;
};

function normalizeSubjectKey(subject: string) {
  return subject.replace(/[^\p{L}\p{N}]+/gu, "-");
}

function makeResultDocId(periodId: string, term: string, classId: string, subject: string, studentCode: string) {
  return `${periodId}__${term}__${classId}__${normalizeSubjectKey(subject)}__${studentCode}`;
}

function makeLimitDocId(periodId: string, term: string, classId: string, subject: string) {
  return `${periodId}__${term}__${classId}__${normalizeSubjectKey(subject)}`;
}

function asNumber(value: unknown) {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const t = value.trim();
    if (!t) return NaN;
    return Number(t);
  }
  return NaN;
}

async function getAccess(request: Request) {
  const session = decodeSessionFromCookie(request);
  if (!session?.code || !session?.role) return { ok: false as const, status: 401 };
  const actorDoc = await getUserByCode(session.code);
  if (!actorDoc?.exists) return { ok: false as const, status: 404 };
  const actorData = actorDoc.data() as { role?: string; classes?: string[]; subjects?: string[] };
  const role = normalizeRole(String(actorData.role ?? session.role).trim().toLowerCase());
  const classes = Array.isArray(actorData.classes) ? actorData.classes.map((c) => String(c).trim()).filter(Boolean) : [];
  const subjects = Array.isArray(actorData.subjects) ? actorData.subjects.map((s) => String(s).trim()).filter(Boolean) : [];
  const period = await getActivePeriod();
  if (!period) return { ok: false as const, status: 400 };

  const db = getAdminDb();
  const settingsSnap = await db.collection("results_settings").doc(period.id).get();
  const settings = (settingsSnap.data() ?? {}) as ResultsSettingsDoc;
  const currentTerm =
    settings.currentTerm === "term2"
      ? "term2"
      : settings.currentTerm === "term1"
        ? "term1"
        : period.activeTerm === "term2"
          ? "term2"
          : "term1";

  if (role === "admin") {
    return {
      ok: true as const,
      role,
      code: session.code,
      classes,
      subjects,
      periodId: period.id,
      currentTerm,
      availableSubjects: settings.availableSubjects ?? {},
    };
  }
  if (role !== "teacher") return { ok: false as const, status: 403 };

  const allowed = Array.isArray(settings.allowedTeacherCodes)
    ? settings.allowedTeacherCodes.map((v) => String(v).trim()).includes(session.code)
    : false;
  if (!allowed) return { ok: false as const, status: 403 };

  return {
    ok: true as const,
    role,
    code: session.code,
    classes,
    subjects,
    periodId: period.id,
    currentTerm,
    availableSubjects: settings.availableSubjects ?? {},
  };
}

function isSubjectAvailableFor(
  map: Record<string, { term1?: string[]; term2?: string[] }> | undefined,
  classId: string,
  subject: string,
  term: "term1" | "term2"
) {
  if (!map) return false;
  const year = String(classId ?? "").trim().toUpperCase().charAt(0);
  if (!year) return false;
  const list = Array.isArray(map?.[year]?.[term]) ? map?.[year]?.[term] ?? [] : [];
  return list.map((v) => String(v).trim()).includes(subject);
}

function parseBody(body: unknown) {
  const b = (body ?? {}) as Record<string, unknown>;
  return {
    classId: String(b.classId ?? "").trim(),
    subject: String(b.subject ?? "").trim(),
    studentCode: String(b.studentCode ?? "").trim(),
    classworkScore: asNumber(b.classworkScore),
    examScore: asNumber(b.examScore),
    notes: String(b.notes ?? "").trim(),
    term: String(b.term ?? "").trim(),
  };
}

export async function GET(request: Request) {
  try {
    const access = await getAccess(request);
    if (!access.ok) {
      const map: Record<number, string> = {
        400: "لا توجد فترة فعالة حالياً.",
        401: "Unauthorized.",
        403: "للأسف، غير مسموح لك الدخول.",
        404: "User not found.",
      };
      return NextResponse.json({ ok: false, message: map[access.status] ?? "Not allowed." }, { status: access.status });
    }

    const url = new URL(request.url);
    const classId = String(url.searchParams.get("classId") ?? "").trim();
    const subject = String(url.searchParams.get("subject") ?? "").trim();
    const termParam = String(url.searchParams.get("term") ?? "").trim();
    if (!classId || !subject) {
      return NextResponse.json({ ok: false, message: "Missing class or subject." }, { status: 400 });
    }
    const termToUse =
      access.role === "admin" && (termParam === "term1" || termParam === "term2") ? termParam : access.currentTerm;
    if (!isSubjectAvailableFor(access.availableSubjects, classId, subject, termToUse)) {
      return NextResponse.json({ ok: false, message: "لا يوجد درجات لهذه المادة لهذا الفصل." }, { status: 400 });
    }
    if (access.role === "teacher") {
      if (!access.classes.includes(classId)) {
        return NextResponse.json({ ok: false, message: "Not allowed for this class." }, { status: 403 });
      }
      if (!access.subjects.includes(subject)) {
        return NextResponse.json({ ok: false, message: "Not allowed for this subject." }, { status: 403 });
      }
    }

    const db = getAdminDb();
    const studentsSnap = await db.collection("users").where("classes", "array-contains", classId).get();
    const students = studentsSnap.docs
      .map((doc) => {
        const d = doc.data() as { code?: string; name?: string; role?: string };
        const role = mapRole(String(d.role ?? "").trim().toLowerCase());
        if (role !== "student") return null;
        const code = String(d.code ?? doc.id).trim();
        if (!code) return null;
        return { code, name: String(d.name ?? "").trim() };
      })
      .filter((v): v is { code: string; name: string } => Boolean(v))
      .sort((a, b) => a.name.localeCompare(b.name, "ar"));

    const scoresSnap = await db
      .collection("results_scores")
      .where("periodId", "==", access.periodId)
      .where("classId", "==", classId)
      .where("subject", "==", subject)
      .get();
    const scoreMap = new Map<string, { classworkScore: number; examScore: number; notes: string }>();
    for (const doc of scoresSnap.docs) {
      const d = doc.data() as { studentCode?: string; classworkScore?: number; examScore?: number; notes?: string; term?: string };
      const term = String(d.term ?? "").trim();
      if (term && term !== termToUse) continue;
      const code = String(d.studentCode ?? "").trim();
      if (!code) continue;
      scoreMap.set(code, {
        classworkScore: Number(d.classworkScore ?? 0),
        examScore: Number(d.examScore ?? 0),
        notes: String(d.notes ?? "").trim(),
      });
    }

    const list = students.map((s) => {
      const existing = scoreMap.get(s.code);
      return {
        ...s,
        classworkScore: existing?.classworkScore ?? null,
        examScore: existing?.examScore ?? null,
        notes: existing?.notes ?? "",
      };
    });

    return NextResponse.json({ ok: true, data: { students: list } });
  } catch (error) {
    console.error("GET /api/results/manual error:", error);
    return NextResponse.json({ ok: false, message: "Failed to load manual students." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const access = await getAccess(request);
    if (!access.ok) {
      const map: Record<number, string> = {
        400: "لا توجد فترة فعالة حالياً.",
        401: "Unauthorized.",
        403: "للأسف، غير مسموح لك الدخول.",
        404: "User not found.",
      };
      return NextResponse.json({ ok: false, message: map[access.status] ?? "Not allowed." }, { status: access.status });
    }

    const body = parseBody(await request.json());
    if (!body.classId || !body.subject || !body.studentCode || Number.isNaN(body.classworkScore) || Number.isNaN(body.examScore)) {
      return NextResponse.json({ ok: false, message: "بيانات غير مكتملة." }, { status: 400 });
    }
    const termToUse =
      access.role === "admin" && (body.term === "term1" || body.term === "term2") ? body.term : access.currentTerm;
    if (access.role === "teacher") {
      if (!access.classes.includes(body.classId)) {
        return NextResponse.json({ ok: false, message: "Not allowed for this class." }, { status: 403 });
      }
      if (!access.subjects.includes(body.subject)) {
        return NextResponse.json({ ok: false, message: "Not allowed for this subject." }, { status: 403 });
      }
    }
    if (body.classworkScore < 0 || body.examScore < 0) {
      return NextResponse.json({ ok: false, message: "الدرجات لا يمكن أن تكون سالبة." }, { status: 400 });
    }
    if (!isSubjectAvailableFor(access.availableSubjects, body.classId, body.subject, termToUse)) {
      return NextResponse.json({ ok: false, message: "لا يوجد درجات لهذه المادة لهذا الفصل." }, { status: 400 });
    }

    const db = getAdminDb();
    const studentDoc = await getUserByCode(body.studentCode);
    if (!studentDoc?.exists) {
      return NextResponse.json({ ok: false, message: "الطالب غير موجود." }, { status: 404 });
    }
    const studentData = studentDoc.data() as { role?: string; classes?: string[]; name?: string };
    if (mapRole(String(studentData.role ?? "").trim().toLowerCase()) !== "student") {
      return NextResponse.json({ ok: false, message: "الكود ليس لطالب." }, { status: 400 });
    }
    const classes = Array.isArray(studentData.classes) ? studentData.classes.map((c) => String(c).trim()) : [];
    if (!classes.includes(body.classId)) {
      return NextResponse.json({ ok: false, message: "الطالب غير مسجل في هذا الفصل." }, { status: 400 });
    }

    const limitDocId = makeLimitDocId(access.periodId, termToUse, body.classId, body.subject);
    const limitSnap = await db.collection("results_subject_limits").doc(limitDocId).get();
    let limitData = limitSnap.data() as SubjectLimitDoc | undefined;
    if (!limitSnap.exists) {
      const legacyId = `${access.periodId}__${body.classId}__${normalizeSubjectKey(body.subject)}`;
      const legacySnap = await db.collection("results_subject_limits").doc(legacyId).get();
      limitData = legacySnap.data() as SubjectLimitDoc | undefined;
    }
    const minScore = Number(limitData?.minScore ?? 0);
    const maxScore = Number(limitData?.maxScore ?? 20);
    const classworkMinScore = Number(limitData?.classworkMinScore ?? 0);
    const classworkMaxScore = Number(limitData?.classworkMaxScore ?? 20);
    if (body.classworkScore > classworkMaxScore) {
      return NextResponse.json({ ok: false, message: `درجة الأعمال لا تتخطى ${classworkMaxScore}.` }, { status: 400 });
    }
    if (body.examScore > maxScore) {
      return NextResponse.json({ ok: false, message: `درجة الاختبار لا تتخطى ${maxScore}.` }, { status: 400 });
    }

    const total = body.classworkScore + body.examScore;
    const notes = total < minScore ? "رسوب" : body.notes;

    await db
      .collection("results_scores")
      .doc(makeResultDocId(access.periodId, termToUse, body.classId, body.subject, body.studentCode))
      .set(
        {
          periodId: access.periodId,
          term: termToUse,
          classId: body.classId,
          subject: body.subject,
          studentCode: body.studentCode,
          studentName: String(studentData.name ?? "").trim(),
          classworkScore: body.classworkScore,
          examScore: body.examScore,
          totalScore: total,
          minScore,
          maxScore,
          classworkMinScore,
          classworkMaxScore,
          notes,
          teacherCode: access.code,
          updatedAt: new Date().toISOString(),
          touchedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    return NextResponse.json({ ok: true, data: { studentCode: body.studentCode, total } });
  } catch (error) {
    console.error("POST /api/results/manual error:", error);
    return NextResponse.json({ ok: false, message: "Failed to save manual grade." }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const access = await getAccess(request);
    if (!access.ok) {
      const map: Record<number, string> = {
        400: "لا توجد فترة فعالة حالياً.",
        401: "Unauthorized.",
        403: "للأسف، غير مسموح لك الدخول.",
        404: "User not found.",
      };
      return NextResponse.json({ ok: false, message: map[access.status] ?? "Not allowed." }, { status: access.status });
    }

    const url = new URL(request.url);
      let classId = String(url.searchParams.get("classId") ?? "").trim();
      let subject = String(url.searchParams.get("subject") ?? "").trim();
      let studentCode = String(url.searchParams.get("studentCode") ?? "").trim();
      let term = String(url.searchParams.get("term") ?? "").trim();
      if (!classId || !subject) {
        const body = parseBody(await request.json().catch(() => ({})));
        classId = classId || body.classId;
        subject = subject || body.subject;
        studentCode = studentCode || body.studentCode;
        term = term || body.term;
      }
    if (!classId || !subject) {
      return NextResponse.json({ ok: false, message: "Missing class or subject." }, { status: 400 });
    }
    if (access.role === "teacher") {
      if (!access.classes.includes(classId)) {
        return NextResponse.json({ ok: false, message: "Not allowed for this class." }, { status: 403 });
      }
      if (!access.subjects.includes(subject)) {
        return NextResponse.json({ ok: false, message: "Not allowed for this subject." }, { status: 403 });
      }
    }

      const db = getAdminDb();
      const termToUse =
        access.role === "admin" && (term === "term1" || term === "term2") ? term : access.currentTerm;
      if (studentCode) {
        await db
          .collection("results_scores")
          .doc(makeResultDocId(access.periodId, termToUse, classId, subject, studentCode))
          .delete();
        return NextResponse.json({ ok: true, data: { deleted: 1 } });
      }

      const snap = await db
        .collection("results_scores")
        .where("periodId", "==", access.periodId)
        .where("classId", "==", classId)
        .where("subject", "==", subject)
        .get();
      if (snap.empty) return NextResponse.json({ ok: true, data: { deleted: 0 } });
      let batch = db.batch();
      let count = 0;
      let deleted = 0;
      for (const doc of snap.docs) {
        const d = doc.data() as { term?: string };
        const rowTerm = String(d.term ?? "").trim();
        if (rowTerm && rowTerm !== termToUse) continue;
        batch.delete(doc.ref);
        count += 1;
        deleted += 1;
      if (count >= 400) {
        await batch.commit();
        batch = db.batch();
        count = 0;
      }
    }
    if (count > 0) await batch.commit();
    return NextResponse.json({ ok: true, data: { deleted } });
  } catch (error) {
    console.error("DELETE /api/results/manual error:", error);
    return NextResponse.json({ ok: false, message: "Failed to delete grades." }, { status: 500 });
  }
}
