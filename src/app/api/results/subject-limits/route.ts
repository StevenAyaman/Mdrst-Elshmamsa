import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";
import { decodeSessionFromCookie, getActivePeriod, getUserByCode, normalizeRole } from "@/lib/session";

export const runtime = "nodejs";

type LimitDoc = {
  classId?: string;
  subject?: string;
  term?: "term1" | "term2";
  minScore?: number;
  maxScore?: number;
  classworkMinScore?: number;
  classworkMaxScore?: number;
  updatedAt?: string;
};

function makeDocId(periodId: string, term: string, classId: string, subject: string) {
  const safe = subject.replace(/[^\p{L}\p{N}]+/gu, "-");
  return `${periodId}__${term}__${classId}__${safe}`;
}

async function ensureAdmin(request: Request) {
  const session = decodeSessionFromCookie(request);
  if (!session?.code || !session?.role) return { ok: false as const, status: 401 };
  const doc = await getUserByCode(session.code);
  if (!doc?.exists) return { ok: false as const, status: 404 };
  const role = normalizeRole(String((doc.data() as { role?: string }).role ?? session.role).trim().toLowerCase());
  if (role !== "admin") return { ok: false as const, status: 403 };
  return { ok: true as const, code: session.code };
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

    const url = new URL(request.url);
    const termParam = String(url.searchParams.get("term") ?? "").trim();
    const activeTerm = period.activeTerm === "term2" ? "term2" : "term1";
    const termToUse = termParam === "term2" || termParam === "term1" ? termParam : activeTerm;

    const db = getAdminDb();
    const snap = await db
      .collection("results_subject_limits")
      .where("periodId", "==", period.id)
      .where("term", "==", termToUse)
      .get();
    const legacySnap = snap.empty
      ? await db.collection("results_subject_limits").where("periodId", "==", period.id).get()
      : null;
    const sourceDocs = snap.empty && legacySnap ? legacySnap.docs : snap.docs;
    const data = sourceDocs
      .map((doc) => {
        const d = doc.data() as LimitDoc;
        const docTerm = d.term === "term2" ? "term2" : d.term === "term1" ? "term1" : termToUse;
        if (docTerm !== termToUse) return null;
        return {
          id: doc.id,
          classId: String(d.classId ?? "").trim(),
          subject: String(d.subject ?? "").trim(),
          term: docTerm as "term1" | "term2",
          minScore: Number(d.minScore ?? 0),
          maxScore: Number(d.maxScore ?? 20),
          classworkMinScore: Number(d.classworkMinScore ?? 0),
          classworkMaxScore: Number(d.classworkMaxScore ?? 20),
          updatedAt: String(d.updatedAt ?? ""),
        };
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item))
      .filter((item) => item.classId && item.subject)
      .sort((a, b) => {
        const at = Date.parse(a.updatedAt || "");
        const bt = Date.parse(b.updatedAt || "");
        if (!Number.isNaN(at) && !Number.isNaN(bt) && bt !== at) return bt - at;
        return a.classId === b.classId ? a.subject.localeCompare(b.subject, "ar") : a.classId.localeCompare(b.classId, "ar");
      });

    return NextResponse.json({ ok: true, data: { period, limits: data } });
  } catch (error) {
    console.error("GET /api/results/subject-limits error:", error);
    return NextResponse.json({ ok: false, message: "Failed to load subject limits." }, { status: 500 });
  }
}

type UpsertPayload = {
  classId?: string;
  subject?: string;
  minScore?: number;
  maxScore?: number;
  classworkMinScore?: number;
  classworkMaxScore?: number;
};

export async function PATCH(request: Request) {
  try {
    const auth = await ensureAdmin(request);
    if (!auth.ok) {
      const map: Record<number, string> = { 401: "Unauthorized.", 403: "Not allowed.", 404: "User not found." };
      return NextResponse.json({ ok: false, message: map[auth.status] ?? "Not allowed." }, { status: auth.status });
    }

    const period = await getActivePeriod();
    if (!period) {
      return NextResponse.json({ ok: false, message: "لا توجد فترة فعالة حالياً." }, { status: 400 });
    }

    const body = (await request.json()) as UpsertPayload & { term?: "term1" | "term2" };
    const classId = String(body.classId ?? "").trim();
    const subject = String(body.subject ?? "").trim();
    const term = body.term === "term2" ? "term2" : "term1";
    const minScore = Number(body.minScore);
    const maxScore = Number(body.maxScore);
    const classworkMinScore = Number(body.classworkMinScore);
    const classworkMaxScore = Number(body.classworkMaxScore);

    if (
      !classId ||
      !subject ||
      Number.isNaN(minScore) ||
      Number.isNaN(maxScore) ||
      Number.isNaN(classworkMinScore) ||
      Number.isNaN(classworkMaxScore) ||
      minScore < 0 ||
      maxScore <= 0 ||
      minScore > maxScore ||
      classworkMinScore < 0 ||
      classworkMaxScore <= 0 ||
      classworkMinScore > classworkMaxScore
    ) {
      return NextResponse.json({ ok: false, message: "بيانات الدرجات غير صحيحة." }, { status: 400 });
    }

    const db = getAdminDb();
    const id = makeDocId(period.id, term, classId, subject);
    await db.collection("results_subject_limits").doc(id).set({
      periodId: period.id,
      term,
      classId,
      subject,
      minScore,
      maxScore,
      classworkMinScore,
      classworkMaxScore,
      updatedAt: new Date().toISOString(),
      updatedBy: auth.code,
      touchedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("PATCH /api/results/subject-limits error:", error);
    return NextResponse.json({ ok: false, message: "Failed to save subject limits." }, { status: 500 });
  }
}
