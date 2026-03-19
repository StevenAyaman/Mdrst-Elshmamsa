import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { decodeSessionFromCookie, getActivePeriod, getUserByCode, normalizeRole } from "@/lib/session";

export const runtime = "nodejs";

type ResultsSettingsDoc = {
  allowedTeacherCodes?: string[];
  published?: boolean;
  gradeScale?: Array<{ id?: string; name?: string; min?: number; max?: number }>;
  currentTerm?: "term1" | "term2";
  term1SeasonalSubject?: "taks" | "katamars";
  term2SeasonalSubject?: "taks" | "katamars";
  availableSubjects?: Record<string, { term1?: string[]; term2?: string[] }>;
  copticYearLabel?: string;
};

type ScoreDoc = {
  studentCode?: string;
  studentName?: string;
  classId?: string;
  subject?: string;
  minScore?: number;
  maxScore?: number;
  classworkScore?: number;
  examScore?: number;
  totalScore?: number;
  notes?: string;
};

export async function GET(request: Request) {
  try {
    const session = decodeSessionFromCookie(request);
    if (!session?.code || !session?.role) {
      return NextResponse.json({ ok: false, message: "Unauthorized." }, { status: 401 });
    }

    const period = await getActivePeriod();
    if (!period) {
      return NextResponse.json({ ok: false, message: "لا توجد فترة فعالة حالياً." }, { status: 400 });
    }

    const db = getAdminDb();
    const userDoc = await getUserByCode(session.code);
    if (!userDoc?.exists) {
      return NextResponse.json({ ok: false, message: "User not found." }, { status: 404 });
    }
    const userData = userDoc.data() as { role?: string; classes?: string[]; subjects?: string[]; childrenCodes?: string[] };
    const role = normalizeRole(String(userData.role ?? session.role).trim().toLowerCase());

    const settingsSnap = await db.collection("results_settings").doc(period.id).get();
    const settings = (settingsSnap.data() ?? {}) as ResultsSettingsDoc;
    const published = Boolean(settings.published);
    const currentTerm =
      settings.currentTerm === "term2"
        ? "term2"
        : settings.currentTerm === "term1"
          ? "term1"
          : period.activeTerm === "term2"
            ? "term2"
            : "term1";

    if (role === "teacher") {
      const allowed = Array.isArray(settings.allowedTeacherCodes)
        ? settings.allowedTeacherCodes.map((v) => String(v).trim()).includes(session.code)
        : false;
      const classes = Array.isArray(userData.classes) ? userData.classes.map((v) => String(v).trim()).filter(Boolean) : [];
      const subjects = Array.isArray(userData.subjects) ? userData.subjects.map((v) => String(v).trim()).filter(Boolean) : [];
      return NextResponse.json({
        ok: true,
        data: {
          role,
          period,
          allowed,
          published,
          classes,
          subjects,
          settings: {
            currentTerm,
            term1SeasonalSubject: settings.term1SeasonalSubject === "katamars" ? "katamars" : "taks",
            term2SeasonalSubject: settings.term2SeasonalSubject === "taks" ? "taks" : "katamars",
            availableSubjects: settings.availableSubjects ?? {},
            copticYearLabel: String(settings.copticYearLabel ?? "").trim(),
          },
        },
      });
    }

    if (role === "student") {
      if (!published) {
        return NextResponse.json({
          ok: true,
          data: {
            role,
            period,
            published: false,
            rows: [],
            settings: { copticYearLabel: String(settings.copticYearLabel ?? "").trim() },
          },
        });
      }
      const rowsSnap = await db
        .collection("results_scores")
        .where("periodId", "==", period.id)
        .where("studentCode", "==", session.code)
        .get();
      const rows = rowsSnap.docs
        .map((doc) => doc.data() as ScoreDoc & { term?: string })
        .map((d) => ({
          subject: String(d.subject ?? "").trim(),
          classId: String(d.classId ?? "").trim(),
          studentName: String(d.studentName ?? "").trim(),
          minScore: Number(d.minScore ?? 0),
          maxScore: Number(d.maxScore ?? 20),
          classworkScore: Number(d.classworkScore ?? 0),
          examScore: Number(d.examScore ?? 0),
          totalScore: Number(d.totalScore ?? Number(d.classworkScore ?? 0) + Number(d.examScore ?? 0)),
          notes: String(d.notes ?? "").trim(),
          term: String(d.term ?? "").trim(),
        }))
        .sort((a, b) => a.subject.localeCompare(b.subject, "ar"));
      const rowsTerm1 = rows.filter((r) => (r.term ? r.term === "term1" : currentTerm === "term1"));
      const rowsTerm2 = rows.filter((r) => (r.term ? r.term === "term2" : currentTerm === "term2"));
      return NextResponse.json({
        ok: true,
        data: {
          role,
          period,
          published,
          rowsTerm1,
          rowsTerm2,
          settings: { copticYearLabel: String(settings.copticYearLabel ?? "").trim() },
        },
      });
    }

    if (role === "parent") {
      const childrenCodes = Array.isArray(userData.childrenCodes)
        ? userData.childrenCodes.map((v) => String(v).trim()).filter(Boolean)
        : [];
      const url = new URL(request.url);
      const requestedCode = String(url.searchParams.get("studentCode") ?? "").trim();
      if (requestedCode) {
        if (!childrenCodes.includes(requestedCode)) {
          return NextResponse.json({ ok: false, message: "Not allowed." }, { status: 403 });
        }
        if (!published) {
          return NextResponse.json({
            ok: true,
            data: {
              role,
              period,
              published: false,
              rowsTerm1: [],
              rowsTerm2: [],
              settings: { copticYearLabel: String(settings.copticYearLabel ?? "").trim() },
            },
          });
        }
        const rowsSnap = await db
          .collection("results_scores")
          .where("periodId", "==", period.id)
          .where("studentCode", "==", requestedCode)
          .get();
        const rows = rowsSnap.docs
          .map((doc) => doc.data() as ScoreDoc & { term?: string })
          .map((d) => ({
            subject: String(d.subject ?? "").trim(),
            classId: String(d.classId ?? "").trim(),
            studentName: String(d.studentName ?? "").trim(),
            minScore: Number(d.minScore ?? 0),
            maxScore: Number(d.maxScore ?? 20),
            classworkScore: Number(d.classworkScore ?? 0),
            examScore: Number(d.examScore ?? 0),
            totalScore: Number(d.totalScore ?? Number(d.classworkScore ?? 0) + Number(d.examScore ?? 0)),
            notes: String(d.notes ?? "").trim(),
            term: String(d.term ?? "").trim(),
          }))
          .sort((a, b) => a.subject.localeCompare(b.subject, "ar"));
        const rowsTerm1 = rows.filter((r) => (r.term ? r.term === "term1" : currentTerm === "term1"));
        const rowsTerm2 = rows.filter((r) => (r.term ? r.term === "term2" : currentTerm === "term2"));
        return NextResponse.json({
          ok: true,
          data: {
            role,
            period,
            published,
            rowsTerm1,
            rowsTerm2,
            settings: { copticYearLabel: String(settings.copticYearLabel ?? "").trim() },
          },
        });
      }
      return NextResponse.json({
        ok: true,
        data: {
          role,
          period,
          published,
          childrenCodes,
          settings: { copticYearLabel: String(settings.copticYearLabel ?? "").trim() },
        },
      });
    }

    if (role === "admin") {
      const teachersSnap = await db.collection("users").where("role", "==", "teacher").get();
      const teachers = teachersSnap.docs
        .map((doc) => {
          const d = doc.data() as { code?: string; name?: string; classes?: string[]; subjects?: string[] };
          return {
            code: String(d.code ?? doc.id),
            name: String(d.name ?? "").trim(),
            classes: Array.isArray(d.classes) ? d.classes.map((v) => String(v).trim()).filter(Boolean) : [],
            subjects: Array.isArray(d.subjects) ? d.subjects.map((v) => String(v).trim()).filter(Boolean) : [],
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name, "ar"));

      const classesSnap = await db.collection("classes").get();
      const classes = classesSnap.docs
        .map((doc) => ({ id: doc.id, name: String((doc.data() as { name?: string }).name ?? doc.id).trim() || doc.id }))
        .sort((a, b) => a.name.localeCompare(b.name, "ar"));

      return NextResponse.json({
        ok: true,
        data: {
          role,
          period,
          published,
          settings: {
            allowedTeacherCodes: Array.isArray(settings.allowedTeacherCodes)
              ? settings.allowedTeacherCodes.map((v) => String(v).trim()).filter(Boolean)
              : [],
            gradeScale: Array.isArray(settings.gradeScale) ? settings.gradeScale : [],
            currentTerm,
            term1SeasonalSubject: settings.term1SeasonalSubject === "katamars" ? "katamars" : "taks",
            term2SeasonalSubject: settings.term2SeasonalSubject === "taks" ? "taks" : "katamars",
            availableSubjects: settings.availableSubjects ?? {},
            copticYearLabel: String(settings.copticYearLabel ?? "").trim(),
          },
          teachers,
          classes,
        },
      });
    }

    return NextResponse.json({ ok: false, message: "Not allowed." }, { status: 403 });
  } catch (error) {
    console.error("GET /api/results/records error:", error);
    return NextResponse.json({ ok: false, message: "Failed to load results data." }, { status: 500 });
  }
}
