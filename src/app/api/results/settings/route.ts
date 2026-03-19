import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";
import {
  decodeSessionFromCookie,
  getActivePeriod,
  getUserByCode,
  normalizeRole,
} from "@/lib/session";

export const runtime = "nodejs";

type GradeScaleItem = {
  id: string;
  name: string;
  min: number;
  max: number;
};

type ResultsSettingsDoc = {
  published?: boolean;
  allowedTeacherCodes?: string[];
  gradeScale?: GradeScaleItem[];
  currentTerm?: "term1" | "term2";
  term1SeasonalSubject?: "taks" | "katamars";
  term2SeasonalSubject?: "taks" | "katamars";
  availableSubjects?: Record<string, { term1?: string[]; term2?: string[] }>;
  copticYearLabel?: string;
  updatedAt?: string;
  updatedBy?: string;
};

function defaultGradeScale(): GradeScaleItem[] {
  return [
    { id: "excellent", name: "امتياز", min: 90, max: 100 },
    { id: "very-good", name: "جيد جدا", min: 80, max: 89.99 },
    { id: "good", name: "جيد", min: 65, max: 79.99 },
    { id: "acceptable", name: "مقبول", min: 50, max: 64.99 },
    { id: "fail", name: "راسب", min: 0, max: 49.99 },
  ];
}

function normalizeScale(items: unknown): GradeScaleItem[] {
  if (!Array.isArray(items)) return defaultGradeScale();
  const out: GradeScaleItem[] = [];
  for (const raw of items) {
    const item = raw as { id?: unknown; name?: unknown; min?: unknown; max?: unknown };
    const name = String(item.name ?? "").trim();
    const min = Number(item.min);
    const max = Number(item.max);
    if (!name || Number.isNaN(min) || Number.isNaN(max)) continue;
    out.push({
      id: String(item.id ?? `${name}-${min}-${max}`).trim() || `${name}-${min}-${max}`,
      name,
      min,
      max,
    });
  }
  if (!out.length) return defaultGradeScale();
  return out
    .sort((a, b) => b.max - a.max)
    .map((item, idx) => ({ ...item, id: item.id || `scale-${idx + 1}` }));
}

function normalizeAvailableSubjects(input: unknown) {
  const out: Record<string, { term1?: string[]; term2?: string[] }> = {};
  if (!input || typeof input !== "object") return out;
  const raw = input as Record<string, unknown>;
  for (const [yearKey, value] of Object.entries(raw)) {
    const year = String(yearKey ?? "").trim();
    if (!year) continue;
    const entry = (value ?? {}) as Record<string, unknown>;
    const term1Raw = Array.isArray(entry.term1) ? entry.term1 : [];
    const term2Raw = Array.isArray(entry.term2) ? entry.term2 : [];
    const term1 = term1Raw.map((v) => String(v ?? "").trim()).filter(Boolean);
    const term2 = term2Raw.map((v) => String(v ?? "").trim()).filter(Boolean);
    out[year] = {
      term1: Array.from(new Set(term1)),
      term2: Array.from(new Set(term2)),
    };
  }
  return out;
}

async function loadSettings(periodId: string) {
  const db = getAdminDb();
  const ref = db.collection("results_settings").doc(periodId);
  const snap = await ref.get();
  if (!snap.exists) {
    const created: ResultsSettingsDoc = {
      published: false,
      allowedTeacherCodes: [],
      gradeScale: defaultGradeScale(),
      currentTerm: "term1",
      term1SeasonalSubject: "taks",
      term2SeasonalSubject: "katamars",
      availableSubjects: {},
      copticYearLabel: "",
      updatedAt: new Date().toISOString(),
      updatedBy: "system",
    };
    await ref.set(created);
    return created;
  }
  const data = snap.data() as ResultsSettingsDoc;
  return {
    published: Boolean(data.published),
    allowedTeacherCodes: Array.isArray(data.allowedTeacherCodes)
      ? data.allowedTeacherCodes.map((v) => String(v).trim()).filter(Boolean)
      : [],
    gradeScale: normalizeScale(data.gradeScale),
    currentTerm: data.currentTerm === "term2" ? "term2" : "term1",
    term1SeasonalSubject: data.term1SeasonalSubject === "katamars" ? "katamars" : "taks",
    term2SeasonalSubject: data.term2SeasonalSubject === "taks" ? "taks" : "katamars",
    availableSubjects: normalizeAvailableSubjects(data.availableSubjects),
    copticYearLabel: String(data.copticYearLabel ?? "").trim(),
    updatedAt: String(data.updatedAt ?? ""),
    updatedBy: String(data.updatedBy ?? ""),
  };
}

async function loadTeachers() {
  const db = getAdminDb();
  const snap = await db.collection("users").where("role", "==", "teacher").get();
  return snap.docs
    .map((doc) => {
      const d = doc.data() as { code?: string; name?: string; classes?: string[]; subjects?: string[] };
      return {
        code: String(d.code ?? doc.id),
        name: String(d.name ?? "").trim(),
        classes: Array.isArray(d.classes) ? d.classes.map((c) => String(c).trim()).filter(Boolean) : [],
        subjects: Array.isArray(d.subjects) ? d.subjects.map((s) => String(s).trim()).filter(Boolean) : [],
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "ar"));
}

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

    const userDoc = await getUserByCode(session.code);
    if (!userDoc?.exists) {
      return NextResponse.json({ ok: false, message: "User not found." }, { status: 404 });
    }
    const userData = userDoc.data() as { role?: string };
    const role = normalizeRole(String(userData.role ?? session.role).trim().toLowerCase());

    const current = await loadSettings(period.id);

    if (role === "admin") {
      const teachers = await loadTeachers();
      return NextResponse.json({
        ok: true,
        data: {
          period,
          settings: current,
          teachers,
        },
      });
    }

    if (role === "teacher") {
      return NextResponse.json({
        ok: true,
        data: {
          period,
          settings: {
            published: Boolean(current.published),
            allowed: current.allowedTeacherCodes?.includes(session.code) ?? false,
            currentTerm: current.currentTerm === "term2" ? "term2" : "term1",
            term1SeasonalSubject: current.term1SeasonalSubject,
            term2SeasonalSubject: current.term2SeasonalSubject,
            availableSubjects: current.availableSubjects ?? {},
          },
        },
      });
    }

    if (role === "student" || role === "parent") {
      return NextResponse.json({
        ok: true,
        data: {
          period,
          settings: {
            published: Boolean(current.published),
            currentTerm: current.currentTerm === "term2" ? "term2" : "term1",
            term1SeasonalSubject: current.term1SeasonalSubject,
            term2SeasonalSubject: current.term2SeasonalSubject,
            availableSubjects: current.availableSubjects ?? {},
          },
        },
      });
    }

    return NextResponse.json({ ok: false, message: "Not allowed." }, { status: 403 });
  } catch (error) {
    console.error("GET /api/results/settings error:", error);
    return NextResponse.json({ ok: false, message: "Failed to load results settings." }, { status: 500 });
  }
}

type UpdatePayload = {
  published?: boolean;
  allowedTeacherCodes?: string[];
  gradeScale?: GradeScaleItem[];
  currentTerm?: "term1" | "term2";
  term1SeasonalSubject?: "taks" | "katamars";
  term2SeasonalSubject?: "taks" | "katamars";
  availableSubjects?: Record<string, { term1?: string[]; term2?: string[] }>;
  copticYearLabel?: string;
};

export async function PATCH(request: Request) {
  try {
    const session = decodeSessionFromCookie(request);
    if (!session?.code || !session?.role) {
      return NextResponse.json({ ok: false, message: "Unauthorized." }, { status: 401 });
    }
    const userDoc = await getUserByCode(session.code);
    if (!userDoc?.exists) {
      return NextResponse.json({ ok: false, message: "User not found." }, { status: 404 });
    }
    const role = normalizeRole(String((userDoc.data() as { role?: string }).role ?? session.role).trim().toLowerCase());
    if (role !== "admin") {
      return NextResponse.json({ ok: false, message: "Not allowed." }, { status: 403 });
    }

    const period = await getActivePeriod();
    if (!period) {
      return NextResponse.json({ ok: false, message: "لا توجد فترة فعالة حالياً." }, { status: 400 });
    }

    const body = (await request.json()) as UpdatePayload;
    const nextAllowed = Array.isArray(body.allowedTeacherCodes)
      ? Array.from(new Set(body.allowedTeacherCodes.map((v) => String(v).trim()).filter(Boolean)))
      : undefined;
    const nextScale = body.gradeScale ? normalizeScale(body.gradeScale) : undefined;

    const update: Record<string, unknown> = {
      updatedAt: new Date().toISOString(),
      updatedBy: session.code,
      touchedAt: FieldValue.serverTimestamp(),
    };
    if (typeof body.published === "boolean") update.published = body.published;
    if (nextAllowed) update.allowedTeacherCodes = nextAllowed;
    if (nextScale) update.gradeScale = nextScale;
    if (body.currentTerm === "term1" || body.currentTerm === "term2") update.currentTerm = body.currentTerm;
    if (body.term1SeasonalSubject === "taks" || body.term1SeasonalSubject === "katamars") {
      update.term1SeasonalSubject = body.term1SeasonalSubject;
    }
    if (body.term2SeasonalSubject === "taks" || body.term2SeasonalSubject === "katamars") {
      update.term2SeasonalSubject = body.term2SeasonalSubject;
    }
    if (body.availableSubjects) {
      update.availableSubjects = normalizeAvailableSubjects(body.availableSubjects);
    }
    if (typeof body.copticYearLabel === "string") {
      update.copticYearLabel = body.copticYearLabel.trim();
    }

    const db = getAdminDb();
    await db.collection("results_settings").doc(period.id).set(update, { merge: true });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("PATCH /api/results/settings error:", error);
    return NextResponse.json({ ok: false, message: "Failed to update results settings." }, { status: 500 });
  }
}
