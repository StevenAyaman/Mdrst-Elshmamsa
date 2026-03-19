import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { chromium } from "playwright";
import { getAdminDb } from "@/lib/firebase/admin";
import { decodeSessionFromCookie, getActivePeriod, getUserByCode, normalizeRole } from "@/lib/session";

export const runtime = "nodejs";

type GradeScaleItem = { name?: string; min?: number; max?: number };

type ScoreDoc = {
  studentCode?: string;
  studentName?: string;
  classId?: string;
  subject?: string;
  minScore?: number;
  maxScore?: number;
  classworkMinScore?: number;
  classworkMaxScore?: number;
  classworkScore?: number;
  examScore?: number;
  totalScore?: number;
  notes?: string;
  term?: string;
};

type DisplayRow = {
  label: string;
  studentScore: string;
  minScore: string;
  maxScore: string;
  notes: string;
  kind: "subject" | "classwork";
};

const BASE_SUBJECTS = [
  { key: "alhan", label: "الألحان", classworkLabel: "أعمال سنة ألحان" },
  { key: "coptic", label: "اللغة القبطية", classworkLabel: "أعمال سنة قبطي" },
] as const;

function getSubjectOrder(seasonalKey: "taks" | "katamars") {
  const taks = { key: "taks", label: "الطقس", classworkLabel: "أعمال سنة طقس" } as const;
  const katamars = { key: "katamars", label: "القطمارس", classworkLabel: "أعمال سنة قطمارس" } as const;
  return seasonalKey === "taks"
    ? ([...BASE_SUBJECTS, taks, katamars] as const)
    : ([...BASE_SUBJECTS, katamars, taks] as const);
}

function isPublished(settings: { published?: boolean } | undefined) {
  return Boolean(settings?.published);
}

function pickScaleLabel(percent: number, scale: GradeScaleItem[]) {
  const sorted = [...scale].sort((a, b) => Number(b.max ?? 0) - Number(a.max ?? 0));
  for (const item of sorted) {
    const min = Number(item.min ?? 0);
    const max = Number(item.max ?? 0);
    if (percent >= min && percent <= max) return String(item.name ?? "").trim() || "-";
  }
  return "-";
}

function normalizeSubjectKey(subject: string) {
  const value = String(subject ?? "")
    .trim()
    .toLowerCase()
    .replace(/[أإآ]/g, "ا")
    .replace(/[ة]/g, "ه");
  if (value.includes("لحن")) return "alhan";
  if (value.includes("الحان") || value.includes("الالحان") || value.includes("ألحان") || value.includes("الألحان")) {
    return "alhan";
  }
  if (value.includes("قطمار")) return "katamars";
  if (value.includes("طقس")) return "taks";
  if (value.includes("اجبي") || value.includes("اجبيه")) return "agbia";
  if (value.includes("قبط")) return "coptic";
  return value;
}

function escapeHtml(text: string) {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function readFileAsDataUrl(filePath: string, mime: string) {
  const buffer = fs.readFileSync(filePath);
  return `data:${mime};base64,${buffer.toString("base64")}`;
}

function getCopticYearLabel(dateText: string) {
  const source = new Date(`${dateText}T00:00:00`);
  if (Number.isNaN(source.getTime())) return "الحالية ش";
  const year = source.getFullYear();
  const month = source.getMonth() + 1;
  const day = source.getDate();
  const copticYear = month > 9 || (month === 9 && day >= 11) ? year - 283 : year - 284;
  return `${copticYear} ش`;
}

function getNextClassName(classId: string) {
  const match = String(classId ?? "")
    .trim()
    .toUpperCase()
    .match(/^(\d+)\s*([A-Z])$/);
  if (!match) return "—";
  const currentYear = Number(match[1]);
  const section = match[2];
  if (Number.isNaN(currentYear) || currentYear >= 5) return "خارج المرحلة الحالية";
  return `${currentYear + 1}${section}`;
}

function formatClassDisplay(className: string, classId: string) {
  const cleanName = String(className ?? "").trim();
  const cleanId = String(classId ?? "").trim();
  if (cleanName && cleanId && cleanName.toUpperCase() === cleanId.toUpperCase()) return cleanId;
  if (cleanName && cleanId) return `${cleanName} (${cleanId})`;
  return cleanName || cleanId || "-";
}

function formatScore(value: number | null | undefined) {
  if (typeof value !== "number" || Number.isNaN(value)) return "";
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.00$/, "");
}

function avgNumber(a: number | undefined, b: number | undefined) {
  const aNum = typeof a === "number" && Number.isFinite(a) ? a : NaN;
  const bNum = typeof b === "number" && Number.isFinite(b) ? b : NaN;
  if (Number.isFinite(aNum) && Number.isFinite(bNum)) return (aNum + bNum) / 2;
  if (Number.isFinite(aNum)) return aNum;
  if (Number.isFinite(bNum)) return bNum;
  return NaN;
}

function classStudentLabel(classId: string) {
  return classId.toUpperCase().includes("G") ? "درجة الطالبة" : "درجة الطالب";
}

function buildRows(
  rows: Array<ScoreDoc & { totalScore: number; notes: string }>,
  subjectOrder: Array<{ key: string; label: string; classworkLabel?: string }>
): DisplayRow[] {
  const byKey = new Map<string, ScoreDoc & { totalScore: number; notes: string }>();
  for (const row of rows) {
    const key = normalizeSubjectKey(String(row.subject ?? ""));
    if (!byKey.has(key)) byKey.set(key, row);
  }
  const rowsOut: DisplayRow[] = [];
  for (const item of subjectOrder) {
    const row = byKey.get(item.key);
    if (!row) {
      continue;
    }
    const examMax = Number(row?.maxScore ?? NaN);
    const examMin = Number(row?.minScore ?? NaN);
    const classworkMax = Number(row?.classworkMaxScore ?? NaN);
    const classworkMin = Number(row?.classworkMinScore ?? NaN);
    const totalMax = Number.isFinite(examMax) && Number.isFinite(classworkMax) ? examMax + classworkMax : NaN;
    const totalMin = Number.isFinite(examMin) && Number.isFinite(classworkMin) ? examMin + classworkMin : NaN;

    rowsOut.push({
      label: item.label,
      studentScore: formatScore(Number(row?.totalScore ?? NaN)),
      minScore: formatScore(totalMin),
      maxScore: formatScore(totalMax),
      notes: String(row?.notes ?? "").trim(),
      kind: "subject",
    });

    if ("classworkLabel" in item && item.classworkLabel) {
      rowsOut.push({
        label: item.classworkLabel,
        studentScore: formatScore(Number(row?.classworkScore ?? NaN)),
        minScore: formatScore(classworkMin),
        maxScore: formatScore(classworkMax),
        notes: "",
        kind: "classwork",
      });
    }
  }
  return rowsOut;
}

function makeCertificateHtml(input: {
  copticYear: string;
  termLabel: string;
  studentName: string;
  studentCode: string;
  parentCode: string;
  classId: string;
  classDisplay: string;
      classStudentColumn: string;
      studentLabel: string;
      studentLabelWithSlash: string;
      attendanceLabel: string;
  rows: DisplayRow[];
  total: string;
  totalMin: string;
  totalMax: string;
  percent: string;
  grade: string;
  nextClass: string;
  showNextClass: boolean;
  absenceDays: string;
  excusedAbsenceDays: string;
  attendancePercent: string;
  logoData: string;
  copyrightData: string;
  stampData: string;
  majallaRegular: string;
  majallaBold: string;
  thuluth: string;
  abraam: string;
}) {
  let tableRows = "";
  for (let i = 0; i < input.rows.length; i += 1) {
    const row = input.rows[i];
    const next = input.rows[i + 1];
    const hasClasswork = row.kind === "subject" && next?.kind === "classwork";
    const isFailed = String(row.notes ?? "").trim() === "رسوب";
    const rowClass = `${row.kind === "subject" && i > 0 ? "subject-sep " : ""}${isFailed ? "failed" : ""}`.trim();

    tableRows += `
      <tr class="${rowClass}">
        <td>${escapeHtml(row.label)}</td>
        <td>${escapeHtml(row.minScore)}</td>
        <td>${escapeHtml(row.maxScore)}</td>
        <td>${escapeHtml(row.studentScore)}</td>
        ${
          hasClasswork
            ? `<td rowspan="2"${isFailed ? ' class="notes-merged failed"' : ""}>${escapeHtml(row.notes)}</td>`
            : `<td${isFailed ? ' class="failed"' : ""}>${escapeHtml(row.notes)}</td>`
        }
      </tr>
    `;

    if (hasClasswork) {
      const cw = next;
      tableRows += `
        <tr class="${isFailed ? "failed" : ""}">
          <td>${escapeHtml(cw.label)}</td>
          <td>${escapeHtml(cw.minScore)}</td>
          <td>${escapeHtml(cw.maxScore)}</td>
          <td>${escapeHtml(cw.studentScore)}</td>
        </tr>
      `;
      i += 1;
    }
  }

  return `<!doctype html>
<html lang="ar" dir="rtl">
  <head>
    <meta charset="utf-8" />
    <style>
      @font-face { font-family: "MajallaCustom"; src: url("${input.majallaRegular}") format("truetype"); font-weight: 400; }
      @font-face { font-family: "MajallaCustom"; src: url("${input.majallaBold}") format("truetype"); font-weight: 700; }
      @font-face { font-family: "ThuluthCustom"; src: url("${input.thuluth}") format("truetype"); font-weight: 400; }
      @font-face { font-family: "AbraamCustom"; src: url("${input.abraam}") format("truetype"); font-weight: 700; }
      * { box-sizing: border-box; }
      body { margin: 0; background: #ffffff; font-family: "MajallaCustom", sans-serif; color: #111; }
      .page { width: 210mm; min-height: 297mm; margin: 0 auto; padding: 8mm; }
      .sheet {
        border: 1px solid #111;
        min-height: 281mm;
        padding: 10px 12px 10px;
        position: relative;
      }
      .top { display: grid; grid-template-columns: 1fr 50px 1fr; align-items: start; direction: ltr; }
      .year {
        direction: rtl;
        text-align: left;
        font-size: 15px;
        font-weight: 700;
        padding-top: 8px;
        justify-self: start;
        margin-left: 8px;
      }
      .cross {
        direction: rtl;
        text-align: center;
        font-family: "AbraamCustom", "MajallaCustom", sans-serif;
        font-size: 34px;
        line-height: 1;
        margin-top: 3px;
      }
      .head-logo { display: flex; justify-content: flex-end; align-items: center; }
      .head-logo img {
        width: 178px;
        height: 64px;
        object-fit: contain;
      }
      .title {
        margin-top: 32px;
        text-align: center;
        font-family: "ThuluthCustom", "MajallaCustom", sans-serif;
        font-size: 32px;
        line-height: 1.1;
      }
      .title + .identity { margin-top: 26px; }
      .identity {
        margin-top: 10px;
        font-size: 15px;
        font-weight: 700;
      }
      .identity-row {
        display: grid;
        grid-template-columns: 1fr 1fr;
        align-items: center;
        gap: 8px;
        line-height: 1.9;
      }
      .identity-right { text-align: right; }
      .identity-left {
        text-align: right;
        direction: rtl;
        padding-right: 14mm;
      }
      table { width: 100%; border-collapse: collapse; }
      .marks { margin-top: 8px; }
      .marks th, .marks td {
        border: 1px solid #111;
        text-align: center;
        vertical-align: middle;
        padding: 2px 2px;
        font-size: 14px;
        height: 28px;
      }
      .marks tr.subject-sep td { border-top: 2px solid #111; }
      .marks tr.failed td { background: #e9e9e9; }
      .marks thead th { font-weight: 700; height: 30px; }
      .marks tbody td:first-child { font-weight: 700; }
      .marks tfoot td { border-top: 2px solid #111; font-weight: 700; }
      .summary { width: 62%; margin: 26px auto 0; }
      .summary td {
        border: 1px solid #111;
        text-align: center;
        padding: 5px 4px;
        font-size: 13px;
        font-weight: 700;
      }
      .verse {
        margin-top: 80px;
        text-align: center;
        font-family: "ThuluthCustom", "MajallaCustom", sans-serif;
        font-size: 28px;
        line-height: 1.2;
      }
      .bottom {
        margin-top: 0;
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 16px;
        align-items: end;
        direction: ltr;
        position: absolute;
        left: 12px;
        right: 12px;
        bottom: 10px;
      }
      .stamp-box { text-align: center; }
      .stamp-box img {
        width: 125px;
        height: 62px;
        object-fit: contain;
        border: 1px solid #4d67cc;
        padding: 2px;
      }
      .stamp-line {
        width: 160px;
        margin: 2px auto 0;
        border-top: 1px solid #111;
        padding-top: 2px;
        font-size: 13px;
        font-weight: 700;
      }
      .absence td {
        border: 1px solid #111;
        text-align: center;
        padding: 5px 4px;
        font-size: 13px;
        font-weight: 700;
      }
    </style>
  </head>
  <body>
    <div class="page">
      <div class="sheet">
        <div class="top">
          <div class="year">العام الدراسي / ${escapeHtml(input.copticYear).replace(/"/g, "")}</div>
          <div class="cross">#</div>
          <div class="head-logo">
            <img src="${input.copyrightData}" alt="school-header" />
          </div>
        </div>

        <div class="title">${escapeHtml(input.termLabel)}</div>

        <div class="identity">
          <div class="identity-row">
            <div class="identity-right">${escapeHtml(input.studentLabel)} : ${escapeHtml(input.studentName)}</div>
            <div class="identity-left">كود الطالب : ${escapeHtml(input.studentCode)}</div>
          </div>
          <div class="identity-row">
            <div class="identity-right">الفصل : ${escapeHtml(input.classDisplay)}</div>
            <div class="identity-left">كود ولي الأمر: ${escapeHtml(input.parentCode)}</div>
          </div>
        </div>

        <table class="marks">
          <thead>
            <tr>
              <th>المادة</th>
              <th>النهاية الصغرى</th>
              <th>النهاية العظمى</th>
              <th>${escapeHtml(input.classStudentColumn)}</th>
              <th>ملاحظات</th>
            </tr>
          </thead>
          <tbody>${tableRows}</tbody>
          <tfoot>
            <tr class="total-row">
              <td>المجموع</td>
              <td>${escapeHtml(input.totalMin)}</td>
              <td>${escapeHtml(input.totalMax)}</td>
              <td>${escapeHtml(input.total)}</td>
              <td></td>
            </tr>
          </tfoot>
        </table>

        <table class="summary">
          <tr>
            <td>تقدير الطالب: ${escapeHtml(input.grade)}</td>
            <td>نسبة ${escapeHtml(input.studentLabelWithSlash)}: ${escapeHtml(input.percent)}%</td>
          </tr>
          ${
            input.showNextClass
              ? `<tr><td colspan="2">فصل السنة القادمة / ${escapeHtml(input.nextClass)}</td></tr>`
              : ""
          }
        </table>

        <div class="verse">أَمَّا أَنْتُمْ أَيُّهَا ٱلْأَحِبَّاءُ، فَابْنُوا أَنْفُسَكُمْ عَلَى إِيمَانِكُمُ ٱلْأَقْدَسِ</div>

        <div class="bottom">
          <div class="stamp-box">
            <img src="${input.stampData}" alt="stamp" />
            <div class="stamp-line">ختم المدرسة</div>
          </div>
          <table class="absence">
            <tr><td>أيام غياب الطالب</td></tr>
            <tr><td>أيام غياب الطالب المسجلة: ${escapeHtml(input.excusedAbsenceDays)}</td></tr>
            <tr><td>نسبة الحضور ${escapeHtml(input.attendanceLabel)}: ${escapeHtml(input.attendancePercent)}</td></tr>
          </table>
        </div>
      </div>
    </div>
  </body>
</html>`;
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

    const db = getAdminDb();
      const settingsSnap = await db.collection("results_settings").doc(period.id).get();
      const settings = settingsSnap.data() as
        | {
            published?: boolean;
            gradeScale?: GradeScaleItem[];
            currentTerm?: "term1" | "term2";
            term1SeasonalSubject?: "taks" | "katamars";
            term2SeasonalSubject?: "taks" | "katamars";
            copticYearLabel?: string;
          }
        | undefined;
      const currentTerm =
        settings?.currentTerm === "term2"
          ? "term2"
          : settings?.currentTerm === "term1"
            ? "term1"
            : period.activeTerm === "term2"
              ? "term2"
              : "term1";
      const term1Seasonal = settings?.term1SeasonalSubject === "katamars" ? "katamars" : "taks";
      const term2Seasonal = settings?.term2SeasonalSubject === "taks" ? "taks" : "katamars";
      const seasonalKey = currentTerm === "term2" ? term2Seasonal : term1Seasonal;
      const subjectOrder = getSubjectOrder(seasonalKey);
      const copticYearLabel = String(settings?.copticYearLabel ?? "").trim() || getCopticYearLabel(period.endDate);

    if (!isPublished(settings)) {
      return NextResponse.json({ ok: false, message: "Results are not published." }, { status: 403 });
    }

    const url = new URL(request.url);
    const targetCode = String(url.searchParams.get("studentCode") ?? "").trim();

    const requesterDoc = await getUserByCode(session.code);
    if (!requesterDoc?.exists) {
      return NextResponse.json({ ok: false, message: "User not found." }, { status: 404 });
    }
    const requester = requesterDoc.data() as { role?: string; childrenCodes?: string[] };
    const requesterRole = normalizeRole(String(requester.role ?? session.role).trim().toLowerCase());

    let studentCode = targetCode;
    if (requesterRole === "student") {
      studentCode = session.code;
    } else if (requesterRole === "parent") {
      if (!studentCode) {
        return NextResponse.json({ ok: false, message: "Missing studentCode." }, { status: 400 });
      }
      const allowedChildren = Array.isArray(requester.childrenCodes)
        ? requester.childrenCodes.map((v) => String(v).trim())
        : [];
      if (!allowedChildren.includes(studentCode)) {
        return NextResponse.json({ ok: false, message: "Not allowed." }, { status: 403 });
      }
    } else {
      return NextResponse.json({ ok: false, message: "Not allowed." }, { status: 403 });
    }

    const studentDoc = await getUserByCode(studentCode);
    if (!studentDoc?.exists) {
      return NextResponse.json({ ok: false, message: "Student not found." }, { status: 404 });
    }
    const studentData = studentDoc.data() as { parentCodes?: string[]; classes?: string[]; name?: string };
    const parentCode = Array.isArray(studentData.parentCodes)
      ? studentData.parentCodes.map((v) => String(v).trim()).filter(Boolean)[0] ?? "-"
      : "-";

    const scoreSnap = await db
      .collection("results_scores")
      .where("periodId", "==", period.id)
      .where("studentCode", "==", studentCode)
      .get();

    let scoreDocs = scoreSnap.docs;
    if (!scoreDocs.length) {
      const fallbackSnap = await db.collection("results_scores").where("studentCode", "==", studentCode).get();
      scoreDocs = fallbackSnap.docs.filter((doc) => {
        const data = doc.data() as { periodId?: string };
        const pid = String(data.periodId ?? "").trim();
        return !pid || pid === period.id;
      });
    } else {
      const fallbackSnap = await db.collection("results_scores").where("studentCode", "==", studentCode).get();
      const extraDocs = fallbackSnap.docs.filter((doc) => {
        const data = doc.data() as { periodId?: string };
        const pid = String(data.periodId ?? "").trim();
        return !pid || pid === period.id;
      });
      const byId = new Map(scoreDocs.map((doc) => [doc.id, doc]));
      for (const doc of extraDocs) {
        if (!byId.has(doc.id)) byId.set(doc.id, doc);
      }
      scoreDocs = Array.from(byId.values());
    }

    if (!scoreDocs.length) {
      return NextResponse.json({ ok: false, message: "لا توجد درجات متاحة." }, { status: 404 });
    }

      const rawRows = scoreDocs.map((doc) => {
        const d = doc.data() as ScoreDoc;
        const min = Number(d.minScore ?? 0);
        const max = Number(d.maxScore ?? 20);
        const classworkMin = Number(d.classworkMinScore ?? 0);
        const classworkMax = Number(d.classworkMaxScore ?? 20);
        const classwork = Number(d.classworkScore ?? 0);
        const exam = Number(d.examScore ?? 0);
        const total = Number(d.totalScore ?? classwork + exam);
        const notes = total < min + classworkMin ? "رسوب" : String(d.notes ?? "").trim();
        return {
          subject: String(d.subject ?? "").trim(),
          studentName: String(d.studentName ?? "").trim(),
          classId: String(d.classId ?? "").trim(),
          minScore: min,
          maxScore: max,
          classworkMinScore: classworkMin,
          classworkMaxScore: classworkMax,
          classworkScore: classwork,
          examScore: exam,
          totalScore: total,
          notes,
          term: String(d.term ?? "").trim(),
        };
      });

      const term1Map = new Map<string, typeof rawRows[number]>();
      const term2Map = new Map<string, typeof rawRows[number]>();
      for (const row of rawRows) {
        const key = normalizeSubjectKey(row.subject);
        if (row.term === "term2") {
          term2Map.set(key, row);
        } else if (row.term === "term1") {
          term1Map.set(key, row);
        } else {
          if (currentTerm === "term2") term2Map.set(key, row);
          else term1Map.set(key, row);
        }
      }

      const computedRows: Array<ScoreDoc & { totalScore: number; notes: string }> = [];
      for (const item of subjectOrder) {
        const key = item.key;
        const row1 = term1Map.get(key);
        const row2 = term2Map.get(key);

        if (currentTerm === "term2" && (key === "alhan" || key === "coptic")) {
          const useRow = row2 ?? row1;
          if (!useRow) continue;
          const classworkScore = avgNumber(row1?.classworkScore, row2?.classworkScore);
          const examScore = avgNumber(row1?.examScore, row2?.examScore);
          const totalScore = avgNumber(row1?.totalScore, row2?.totalScore);
          const minScore = Number(useRow.minScore ?? 0);
          const classworkMinScore = Number(useRow.classworkMinScore ?? 0);
          const notes = totalScore < minScore + classworkMinScore ? "رسوب" : String(useRow.notes ?? "").trim();
          computedRows.push({
            ...useRow,
            classworkScore,
            examScore,
            totalScore: Number.isFinite(totalScore) ? totalScore : Number(useRow.totalScore ?? 0),
            notes,
          });
          continue;
        }

        const picked = currentTerm === "term2" ? row2 ?? row1 : row1 ?? row2;
        if (!picked) continue;
        computedRows.push(picked);
      }

    const studentName = computedRows[0]?.studentName || String(studentData.name ?? "").trim() || studentCode;
    const classId =
      computedRows[0]?.classId ||
      (Array.isArray(studentData.classes) ? String(studentData.classes[0] ?? "").trim() : "") ||
      "-";
    let classDisplay = classId;
    if (classId && classId !== "-") {
      const classSnap = await db.collection("classes").doc(classId).get();
      const className = classSnap.exists ? String((classSnap.data() as { name?: string }).name ?? "").trim() : "";
      classDisplay = formatClassDisplay(className, classId);
    }
      const total = computedRows.reduce((sum, r) => sum + (Number.isFinite(r.totalScore) ? r.totalScore : 0), 0);
      const totalMax = computedRows.reduce((sum, r) => {
        const examMax = Number(r.maxScore ?? 0);
        const classworkMax = Number(r.classworkMaxScore ?? 0);
        return sum + (Number.isFinite(examMax) ? examMax : 0) + (Number.isFinite(classworkMax) ? classworkMax : 0);
      }, 0);
    const percentage = totalMax > 0 ? Number(((total / totalMax) * 100).toFixed(2)) : 0;
    const totalMin = computedRows.reduce((sum, r) => {
      const examMin = Number(r.minScore ?? 0);
      const classworkMin = Number(r.classworkMinScore ?? 0);
      return sum + (Number.isFinite(examMin) ? examMin : 0) + (Number.isFinite(classworkMin) ? classworkMin : 0);
    }, 0);
    const scale = Array.isArray(settings?.gradeScale) ? settings?.gradeScale ?? [] : [];
    const gradeLabel = pickScaleLabel(percentage, scale);
      const rows = buildRows(computedRows, subjectOrder as Array<{ key: string; label: string; classworkLabel?: string }>);

    let failedCore = false;
    for (const row of computedRows) {
      const key = normalizeSubjectKey(row.subject ?? "");
      if (key !== "alhan" && key !== "coptic") continue;
      const minScore = Number(row.minScore ?? 0);
      const classworkMinScore = Number(row.classworkMinScore ?? 0);
      const totalScore = Number(row.totalScore ?? 0);
      if (totalScore < minScore + classworkMinScore) {
        failedCore = true;
        break;
      }
    }
    const showNextClass = currentTerm === "term2";
    let nextClassName = "";
    if (showNextClass) {
      const nextClassId = failedCore ? classId : getNextClassName(classId);
      if (nextClassId === classId) {
        nextClassName = classDisplay;
      } else {
        const nextClassSnap = await db.collection("classes").doc(nextClassId).get();
        const nextClassLabel = nextClassSnap.exists
          ? String((nextClassSnap.data() as { name?: string }).name ?? "").trim()
          : "";
        nextClassName = formatClassDisplay(nextClassLabel, nextClassId);
      }
    }

    // Use a single-field query to avoid composite-index dependency in certificate generation.
    const attendanceSnap = await db
      .collection("attendance")
      .where("studentCode", "==", studentCode)
      .get();
    let absenceDays = 0;
    let presentDays = 0;
    for (const doc of attendanceSnap.docs) {
      const d = doc.data() as { date?: string; status?: string };
      const date = String(d.date ?? "").trim();
      if (!date || date < period.startDate || date > period.endDate) continue;
      const status = String(d.status ?? "").trim().toLowerCase();
      if (status === "absent") absenceDays += 1;
      if (status === "present") presentDays += 1;
    }
    const totalAttendanceRecords = absenceDays + presentDays;
    const attendancePercent =
      totalAttendanceRecords > 0 ? `${Number(((presentDays / totalAttendanceRecords) * 100).toFixed(2))}%` : "0%";

    const majallaRegular = readFileAsDataUrl(path.join(process.cwd(), "public", "Fonts", "majalla.ttf"), "font/ttf");
    const majallaBold = readFileAsDataUrl(path.join(process.cwd(), "public", "Fonts", "majallab.ttf"), "font/ttf");
    const thuluth = readFileAsDataUrl(path.join(process.cwd(), "public", "Fonts", "DTHULUTH.TTF"), "font/ttf");
    const abraam = readFileAsDataUrl(path.join(process.cwd(), "public", "Fonts", "ABRAAM.ttf"), "font/ttf");
    const logoData = readFileAsDataUrl(path.join(process.cwd(), "public", "elmdrsa.jpeg"), "image/jpeg");
    const copyrightData = readFileAsDataUrl(path.join(process.cwd(), "public", "Copyright1.png"), "image/png");
    const stampData = readFileAsDataUrl(path.join(process.cwd(), "public", "Stamp.png"), "image/png");

    const html = makeCertificateHtml({
      copticYear: copticYearLabel,
      termLabel:
        currentTerm === "term2"
          ? `شهادة نهاية العام الدراسي للعام ${copticYearLabel}`
          : `شهادة الفصل الدراسي الأول للعام ${copticYearLabel}`,
      studentName,
      studentCode,
      parentCode,
      classId,
      classDisplay,
      classStudentColumn: classStudentLabel(classId),
      studentLabel: classId.toUpperCase().includes("G") ? "الطالبة" : "الطالب",
      studentLabelWithSlash: classId.toUpperCase().includes("G") ? "الطالبة" : "الطالب",
      attendanceLabel: classId.toUpperCase().includes("G") ? "للطالبة" : "للطالب",
      rows,
      total: formatScore(total) || "0",
      totalMin: formatScore(totalMin) || "",
      totalMax: formatScore(totalMax) || "",
      percent: formatScore(percentage) || "0",
      grade: gradeLabel,
      nextClass: nextClassName,
      showNextClass,
      absenceDays: String(absenceDays),
      excusedAbsenceDays: String(absenceDays),
      attendancePercent,
      logoData,
      copyrightData,
      stampData,
      majallaRegular,
      majallaBold,
      thuluth,
      abraam,
    });

    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle" });
    const pdfBuffer = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "0", right: "0", bottom: "0", left: "0" },
    });
    await page.close();
    await browser.close();

    const fileName = `شهادة_${studentCode}_${period.name || period.id}.pdf`;
    return new NextResponse(new Uint8Array(pdfBuffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      },
    });
  } catch (error) {
    console.error("GET /api/results/certificate error:", error);
    const extra =
      process.env.NODE_ENV !== "production" && error instanceof Error
        ? `: ${error.message}`
        : "";
    return NextResponse.json({ ok: false, message: `Failed to generate certificate.${extra}` }, { status: 500 });
  }
}
