import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { getAdminDb } from "@/lib/firebase/admin";
import { decodeSessionFromCookie, getActivePeriod, getUserByCode, normalizeRole } from "@/lib/session";
import { mapRole } from "@/lib/code-mapper";

export const runtime = "nodejs";

type ResultsSettingsDoc = {
  allowedTeacherCodes?: string[];
  currentTerm?: "term1" | "term2";
  availableSubjects?: Record<string, { term1?: string[]; term2?: string[] }>;
};

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
    const classes = classesSnap.docs.map((d) => String(d.id).trim()).filter(Boolean);
    return {
      ok: true as const,
      role,
      code: session.code,
      classes,
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
    if (!access.classes.includes(classId)) {
      return NextResponse.json({ ok: false, message: "Not allowed for this class." }, { status: 403 });
    }
    if (access.role === "teacher" && !access.subjects.includes(subject)) {
      return NextResponse.json({ ok: false, message: "Not allowed for this subject." }, { status: 403 });
    }
    const termToUse: "term1" | "term2" =
      access.role === "admin" && (termParam === "term1" || termParam === "term2")
        ? termParam
        : access.currentTerm === "term2"
          ? "term2"
          : "term1";
    if (!isSubjectAvailableFor(access.availableSubjects, classId, subject, termToUse)) {
      return NextResponse.json({ ok: false, message: "لا يوجد درجات لهذه المادة لهذا الفصل." }, { status: 400 });
    }

    const db = getAdminDb();
    const studentsSnap = await db.collection("users").where("classes", "array-contains", classId).get();

    const students = studentsSnap.docs
      .map((doc) => {
        const d = doc.data() as { code?: string; name?: string; classes?: string[]; role?: string };
        const normalizedRole = mapRole(String(d.role ?? "").trim().toLowerCase());
        if (normalizedRole !== "student") return null;
        const code = String(d.code ?? doc.id).trim();
        const name = String(d.name ?? "").trim();
        const classes = Array.isArray(d.classes) ? d.classes.map((c) => String(c).trim()) : [];
        return { code, name, classes };
      })
      .filter((item): item is { code: string; name: string; classes: string[] } => Boolean(item))
      .filter((s) => s.code)
      .sort((a, b) => a.name.localeCompare(b.name, "ar"));

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("الدرجات");
    sheet.views = [{ rightToLeft: true }];

    const label = classId.toUpperCase().includes("G") ? "درجة الطالبة" : "درجة الطالب";

    sheet.columns = [
      { header: "كود الطالب", key: "code", width: 16 },
      { header: "اسم الطالب", key: "name", width: 28 },
      { header: "درجة الأعمال", key: "classwork", width: 16 },
      { header: "درجة الاختبار", key: "exam", width: 16 },
      { header: label, key: "total", width: 18 },
      { header: "ملاحظات", key: "notes", width: 24 },
    ];

    const headerRow = sheet.getRow(1);
    headerRow.height = 26;
    headerRow.eachCell((cell) => {
      cell.font = { name: "Calibri", size: 12, bold: true, color: { argb: "FFFFFFFF" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E3A5F" } };
      cell.alignment = { horizontal: "center", vertical: "middle" };
      cell.border = {
        top: { style: "thin", color: { argb: "FFBFBFBF" } },
        left: { style: "thin", color: { argb: "FFBFBFBF" } },
        bottom: { style: "thin", color: { argb: "FFBFBFBF" } },
        right: { style: "thin", color: { argb: "FFBFBFBF" } },
      };
    });

    let rowIndex = 2;
    for (const student of students) {
      const row = sheet.getRow(rowIndex);
      row.getCell(1).value = student.code;
      row.getCell(2).value = student.name;
      row.getCell(3).value = null;
      row.getCell(4).value = null;
      row.getCell(5).value = { formula: `C${rowIndex}+D${rowIndex}` };
      row.getCell(6).value = "";
      row.height = 22;
      for (let c = 1; c <= 6; c += 1) {
        const cell = row.getCell(c);
        cell.border = {
          top: { style: "thin", color: { argb: "FFD0D0D0" } },
          left: { style: "thin", color: { argb: "FFD0D0D0" } },
          bottom: { style: "thin", color: { argb: "FFD0D0D0" } },
          right: { style: "thin", color: { argb: "FFD0D0D0" } },
        };
        cell.alignment = { horizontal: c === 2 ? "right" : "center", vertical: "middle" };
      }
      rowIndex += 1;
    }

    const meta = workbook.addWorksheet("meta");
    meta.state = "hidden";
    meta.getCell("A1").value = "periodId";
    meta.getCell("B1").value = access.periodId ?? "";
    meta.getCell("A2").value = "classId";
    meta.getCell("B2").value = classId;
    meta.getCell("A3").value = "subject";
    meta.getCell("B3").value = subject;

    const buffer = await workbook.xlsx.writeBuffer();
    const bytes = new Uint8Array(buffer as ArrayBuffer);
    const fileName = `نموذج درجات ${subject} ${classId}.xlsx`;
    const encoded = encodeURIComponent(fileName);

    return new NextResponse(bytes, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="results-template.xlsx"; filename*=UTF-8''${encoded}`,
      },
    });
  } catch (error) {
    console.error("GET /api/results/template error:", error);
    return NextResponse.json({ ok: false, message: "Failed to export template." }, { status: 500 });
  }
}
