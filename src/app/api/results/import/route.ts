import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";
import { decodeSessionFromCookie, getActivePeriod, getUserByCode, normalizeRole } from "@/lib/session";
import { mapRole } from "@/lib/code-mapper";

export const runtime = "nodejs";

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

async function getAccess(request: Request) {
  const session = decodeSessionFromCookie(request);
  if (!session?.code || !session?.role) return { ok: false as const, status: 401 };
  const db = getAdminDb();
  const actorDoc = await getUserByCode(session.code);
  if (!actorDoc?.exists) return { ok: false as const, status: 404 };
  const actorData = actorDoc.data() as { role?: string; classes?: string[]; subjects?: string[] };
  const role = normalizeRole(String(actorData.role ?? session.role).trim().toLowerCase());

  const period = await getActivePeriod();
  if (!period) return { ok: false as const, status: 400 };

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
    const classesSnap = await db.collection("classes").get();
    const allClasses = classesSnap.docs.map((d) => String(d.id).trim()).filter(Boolean);
    return {
      ok: true as const,
      role,
      code: session.code,
      classes: allClasses,
      subjects: [] as string[],
      periodId: period.id,
      periodName: period.name,
      currentTerm,
      availableSubjects: settings.availableSubjects ?? {},
    };
  }

  if (role !== "teacher") return { ok: false as const, status: 403 };

  const allowed = Array.isArray(settings.allowedTeacherCodes)
    ? settings.allowedTeacherCodes.map((v) => String(v).trim()).includes(session.code)
    : false;

  const classes = Array.isArray(actorData.classes)
    ? actorData.classes.map((c) => String(c).trim()).filter(Boolean)
    : [];
  const subjects = Array.isArray(actorData.subjects)
    ? actorData.subjects.map((s) => String(s).trim()).filter(Boolean)
    : [];

  if (!allowed) return { ok: false as const, status: 403 };
  return {
    ok: true as const,
    role,
    code: session.code,
    classes,
    subjects,
    periodId: period.id,
    periodName: period.name,
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

function asNumber(value: unknown) {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const t = value.trim();
    if (!t) return NaN;
    return Number(t);
  }
  return NaN;
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

    const form = await request.formData();
    const classId = String(form.get("classId") ?? "").trim();
    const subject = String(form.get("subject") ?? "").trim();
    const file = form.get("file");
    const termParam = String(form.get("term") ?? "").trim();

    if (!classId || !subject || !(file instanceof File)) {
      return NextResponse.json({ ok: false, message: "Missing class, subject or file." }, { status: 400 });
    }
    if (!access.classes.includes(classId)) {
      return NextResponse.json({ ok: false, message: "Not allowed for this class." }, { status: 403 });
    }
    if (access.role === "teacher" && !access.subjects.includes(subject)) {
      return NextResponse.json({ ok: false, message: "Not allowed for this subject." }, { status: 403 });
    }

    const termToUse =
      access.role === "admin" && (termParam === "term1" || termParam === "term2") ? termParam : access.currentTerm;
    if (!isSubjectAvailableFor(access.availableSubjects, classId, subject, termToUse)) {
      return NextResponse.json({ ok: false, message: "لا يوجد درجات لهذه المادة لهذا الفصل." }, { status: 400 });
    }

    const bytes = await file.arrayBuffer();
    const workbook = XLSX.read(Buffer.from(bytes), { type: "buffer" });
    const firstSheetName = workbook.SheetNames[0];
    if (!firstSheetName) {
      return NextResponse.json({ ok: false, message: "الملف فارغ." }, { status: 400 });
    }
    const sheet = workbook.Sheets[firstSheetName];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "" });

    if (rows.length < 2) {
      return NextResponse.json({ ok: false, message: "الملف لا يحتوي على بيانات كافية." }, { status: 400 });
    }

    const db = getAdminDb();
    const studentsSnap = await db.collection("users").where("classes", "array-contains", classId).get();
    const studentMap = new Map<string, { code: string; name: string; classes: string[] }>();
    for (const doc of studentsSnap.docs) {
      const d = doc.data() as { code?: string; name?: string; classes?: string[]; role?: string };
      const normalizedRole = mapRole(String(d.role ?? "").trim().toLowerCase());
      if (normalizedRole !== "student") continue;
      const code = String(d.code ?? doc.id).trim();
      if (!code) continue;
      studentMap.set(code, {
        code,
        name: String(d.name ?? "").trim(),
        classes: Array.isArray(d.classes) ? d.classes.map((c) => String(c).trim()) : [],
      });
    }

    const limitDocId = makeLimitDocId(access.periodId, termToUse, classId, subject);
    const limitSnap = await db.collection("results_subject_limits").doc(limitDocId).get();
    let limitData = limitSnap.data() as SubjectLimitDoc | undefined;
    if (!limitSnap.exists) {
      const legacyId = `${access.periodId}__${classId}__${normalizeSubjectKey(subject)}`;
      const legacySnap = await db.collection("results_subject_limits").doc(legacyId).get();
      limitData = legacySnap.data() as SubjectLimitDoc | undefined;
    }
    const minScore = Number(limitData?.minScore ?? 0);
    const maxScore = Number(limitData?.maxScore ?? 20);
    const classworkMinScore = Number(limitData?.classworkMinScore ?? 0);
    const classworkMaxScore = Number(limitData?.classworkMaxScore ?? 20);

    let updated = 0;
    const skipped: string[] = [];
    let batch = db.batch();
    let pending = 0;

    for (let i = 1; i < rows.length; i += 1) {
      const row = rows[i] as unknown[];
      const studentCode = String(row?.[0] ?? "").trim();
      if (!studentCode) continue;
      const student = studentMap.get(studentCode);
      if (!student) {
        skipped.push(`Row ${i + 1}: student not found in class`);
        continue;
      }

      const classwork = asNumber(row?.[2]);
      const exam = asNumber(row?.[3]);
      if (Number.isNaN(classwork) || Number.isNaN(exam)) {
        skipped.push(`Row ${i + 1}: invalid grades`);
        continue;
      }
      if (classwork < 0 || exam < 0) {
        skipped.push(`Row ${i + 1}: negative grade`);
        continue;
      }
      // Teacher can enter any non-negative score up to max.
      // Minimum score is used for pass/fail logic, not as an input blocker.
      if (classwork > classworkMaxScore) {
        skipped.push(`Row ${i + 1}: classwork above max`);
        continue;
      }
      if (exam > maxScore) {
        skipped.push(`Row ${i + 1}: exam above max`);
        continue;
      }

      const total = classwork + exam;
      const notesFromFile = String(row?.[5] ?? "").trim();
      const notes = total < minScore ? "رسوب" : notesFromFile;

      const ref = db
        .collection("results_scores")
        .doc(makeResultDocId(access.periodId, termToUse, classId, subject, studentCode));
      batch.set(
        ref,
        {
          periodId: access.periodId,
          periodName: access.periodName,
          term: termToUse,
          classId,
          subject,
          studentCode,
          studentName: student.name,
          classworkScore: classwork,
          examScore: exam,
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
      pending += 1;
      updated += 1;

      if (pending >= 350) {
        await batch.commit();
        batch = db.batch();
        pending = 0;
      }
    }

    if (pending > 0) {
      await batch.commit();
    }

    return NextResponse.json({
      ok: true,
      data: { updated, skipped, minScore, maxScore, classworkMinScore, classworkMaxScore },
    });
  } catch (error) {
    console.error("POST /api/results/import error:", error);
    return NextResponse.json({ ok: false, message: "Failed to import grades." }, { status: 500 });
  }
}
