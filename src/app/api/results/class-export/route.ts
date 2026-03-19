import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { getAdminDb } from "@/lib/firebase/admin";
import { decodeSessionFromCookie, getActivePeriod, getUserByCode, normalizeRole } from "@/lib/session";

export const runtime = "nodejs";

type GradeScaleItem = { id?: string; name?: string; min?: number; max?: number };

type ScoreDoc = {
  studentCode?: string;
  studentName?: string;
  subject?: string;
  classworkScore?: number;
  examScore?: number;
  totalScore?: number;
  minScore?: number;
  maxScore?: number;
  notes?: string;
  term?: string;
};

function pickScaleLabel(percent: number, scale: GradeScaleItem[]) {
  const sorted = [...scale].sort((a, b) => Number(b.max ?? 0) - Number(a.max ?? 0));
  for (const item of sorted) {
    const min = Number(item.min ?? 0);
    const max = Number(item.max ?? 0);
    if (percent >= min && percent <= max) return String(item.name ?? "").trim() || "-";
  }
  return "-";
}

export async function GET(request: Request) {
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

    const url = new URL(request.url);
    const classId = String(url.searchParams.get("classId") ?? "").trim();
    const termParam = String(url.searchParams.get("term") ?? "").trim();
    if (!classId) {
      return NextResponse.json({ ok: false, message: "Missing class." }, { status: 400 });
    }

    const db = getAdminDb();

    const settingsSnap = await db.collection("results_settings").doc(period.id).get();
    const settingsData = settingsSnap.data() as
      | { gradeScale?: GradeScaleItem[]; currentTerm?: "term1" | "term2" }
      | undefined;
    const gradeScale = Array.isArray(settingsData?.gradeScale) ? settingsData?.gradeScale ?? [] : [];
    const currentTerm =
      period.activeTerm === "term2" ? "term2" : settingsData?.currentTerm === "term2" ? "term2" : "term1";
    const termToUse = termParam === "term1" || termParam === "term2" ? termParam : currentTerm;

    const scoresSnap = await db
      .collection("results_scores")
      .where("periodId", "==", period.id)
      .where("classId", "==", classId)
      .get();

    const byStudent = new Map<
      string,
      {
        code: string;
        name: string;
        subjects: Record<string, { min: number; max: number; classwork: number; exam: number; total: number; notes: string }>;
      }
    >();
    const subjectsSet = new Set<string>();

    for (const doc of scoresSnap.docs) {
      const d = doc.data() as ScoreDoc;
      const term = String(d.term ?? "").trim();
      if (term && term !== termToUse) continue;
      const studentCode = String(d.studentCode ?? "").trim();
      const studentName = String(d.studentName ?? "").trim();
      const subject = String(d.subject ?? "").trim();
      if (!studentCode || !subject) continue;
      subjectsSet.add(subject);
      const current = byStudent.get(studentCode) ?? {
        code: studentCode,
        name: studentName,
        subjects: {},
      };
      current.subjects[subject] = {
        min: Number(d.minScore ?? 0),
        max: Number(d.maxScore ?? 20),
        classwork: Number(d.classworkScore ?? 0),
        exam: Number(d.examScore ?? 0),
        total: Number(d.totalScore ?? 0),
        notes: String(d.notes ?? "").trim(),
      };
      byStudent.set(studentCode, current);
    }

    const subjects = Array.from(subjectsSet).sort((a, b) => a.localeCompare(b, "ar"));

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("الدرجات");
    sheet.views = [{ rightToLeft: true }];

    const headers = ["الكود", "الاسم"];
    for (const subject of subjects) {
      headers.push(`${subject} (صغرى)`);
      headers.push(`${subject} (عظمى)`);
      headers.push(`${subject} (أعمال)`);
      headers.push(`${subject} (اختبار)`);
      headers.push(`${subject} (الطالب/ة)`);
      headers.push(`${subject} (ملاحظات)`);
    }
    headers.push("المجموع");
    headers.push("النسبة المئوية");
    headers.push("التقدير");

    sheet.addRow(headers);
    const headerRow = sheet.getRow(1);
    headerRow.height = 26;
    headerRow.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E3A5F" } };
      cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      cell.border = {
        top: { style: "thin", color: { argb: "FFD0D0D0" } },
        left: { style: "thin", color: { argb: "FFD0D0D0" } },
        bottom: { style: "thin", color: { argb: "FFD0D0D0" } },
        right: { style: "thin", color: { argb: "FFD0D0D0" } },
      };
    });

    const students = Array.from(byStudent.values()).sort((a, b) => a.name.localeCompare(b.name, "ar"));
    for (const student of students) {
      const row: Array<string | number> = [student.code, student.name];
      let totalScore = 0;
      let totalMax = 0;
      for (const subject of subjects) {
        const item = student.subjects[subject];
        const min = item?.min ?? 0;
        const max = item?.max ?? 20;
        const classwork = item?.classwork ?? 0;
        const exam = item?.exam ?? 0;
        const total = item?.total ?? classwork + exam;
        const notes = item?.notes ?? (total < min ? "رسوب" : "");
        row.push(min, max, classwork, exam, total, notes);
        totalScore += total;
        totalMax += max;
      }
      const percent = totalMax > 0 ? Number(((totalScore / totalMax) * 100).toFixed(2)) : 0;
      const grade = pickScaleLabel(percent, gradeScale);
      row.push(totalScore, percent, grade);
      sheet.addRow(row);
    }

    for (let c = 1; c <= sheet.columnCount; c += 1) {
      const width = c === 1 ? 14 : c === 2 ? 24 : 16;
      sheet.getColumn(c).width = width;
    }

    for (let r = 2; r <= sheet.rowCount; r += 1) {
      const row = sheet.getRow(r);
      row.height = 22;
      row.eachCell((cell, col) => {
        cell.alignment = { horizontal: col === 2 ? "right" : "center", vertical: "middle", wrapText: true };
        cell.border = {
          top: { style: "thin", color: { argb: "FFE1E1E1" } },
          left: { style: "thin", color: { argb: "FFE1E1E1" } },
          bottom: { style: "thin", color: { argb: "FFE1E1E1" } },
          right: { style: "thin", color: { argb: "FFE1E1E1" } },
        };
      });
    }

    const buffer = await workbook.xlsx.writeBuffer();
    const bytes = new Uint8Array(buffer as ArrayBuffer);
    const fileName = `درجات ${classId.toUpperCase()} ${period.name || period.id}.xlsx`;

    return new NextResponse(bytes, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      },
    });
  } catch (error) {
    console.error("GET /api/results/class-export error:", error);
    return NextResponse.json({ ok: false, message: "Failed to export class results." }, { status: 500 });
  }
}
