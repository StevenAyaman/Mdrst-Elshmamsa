import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { Timestamp } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";

export const runtime = "nodejs";

function decodeSessionFromCookie(request: Request) {
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

async function canExportForClass(actorCode: string, actorRole: string, classId: string) {
  const role = normalizeRole(actorRole);
  const db = getAdminDb();
  const actorDoc = await db.collection("users").doc(actorCode).get();
  if (!actorDoc.exists) return false;
  const actor = actorDoc.data() as { role?: string; classes?: string[] };
  const realRole = normalizeRole(String(actor.role ?? "").trim().toLowerCase());
  const classes = Array.isArray(actor.classes) ? actor.classes.map((c) => String(c).trim()) : [];

  if (role === "admin" && realRole === "admin") return true;
  if ((role === "teacher" || role === "system") && realRole === role) {
    return classes.includes(classId);
  }
  return false;
}

function createdAtValue(item: { createdAt?: Timestamp }) {
  if (!item.createdAt) return 0;
  if (typeof item.createdAt.toMillis === "function") return item.createdAt.toMillis();
  return 0;
}

function isIsoDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function timestampToIsoDate(value?: Timestamp) {
  if (!value || typeof value.toMillis !== "function") return "";
  const date = new Date(value.toMillis());
  if (Number.isNaN(date.getTime())) return "";
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function formatDateForHeader(isoDate: string) {
  if (!isIsoDate(isoDate)) return isoDate;
  const [yyyy, mm, dd] = isoDate.split("-");
  return `${dd}-${mm}-${yyyy}`;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = decodeSessionFromCookie(request);
    const actorCode = String(session?.code ?? "").trim();
    const actorRole = normalizeRole(String(session?.role ?? "").trim().toLowerCase());
    const { id } = await params;
    const classId = String(id ?? "").trim();
    const url = new URL(request.url);
    const periodId = String(url.searchParams.get("periodId") ?? "").trim();

    if (!actorCode || !actorRole || !classId) {
      return NextResponse.json({ ok: false, message: "Missing class." }, { status: 400 });
    }

    const canExport = await canExportForClass(actorCode, actorRole, classId);
    if (!canExport) {
      return NextResponse.json({ ok: false, message: "Not allowed." }, { status: 403 });
    }

    const db = getAdminDb();
    let periodDoc: FirebaseFirestore.DocumentSnapshot;
    if (periodId) {
      periodDoc = await db.collection("service_periods").doc(periodId).get();
      if (!periodDoc.exists) {
        return NextResponse.json({ ok: false, message: "الفترة غير موجودة." }, { status: 404 });
      }
    } else {
      const activeSnap = await db
        .collection("service_periods")
        .where("active", "==", true)
        .limit(1)
        .get();
      if (activeSnap.empty) {
        return NextResponse.json({ ok: false, message: "لا توجد فترة فعالة حالياً." }, { status: 400 });
      }
      periodDoc = activeSnap.docs[0];
    }
    const periodData = periodDoc.data() as { name?: string; startDate?: string; endDate?: string };
    const periodName = String(periodData.name ?? "").trim();
    const periodStart = String(periodData.startDate ?? "").trim();
    const periodEnd = String(periodData.endDate ?? "").trim();
    if (!isIsoDate(periodStart) || !isIsoDate(periodEnd)) {
      return NextResponse.json({ ok: false, message: "بيانات الفترة غير صحيحة." }, { status: 400 });
    }

    const studentsSnapshot = await db
      .collection("users")
      .where("role", "==", "student")
      .where("classes", "array-contains", classId)
      .get();

    const students = studentsSnapshot.docs
      .map((doc) => {
        const data = doc.data() as { code?: string; name?: string };
        return {
          code: String(data.code ?? doc.id),
          name: String(data.name ?? ""),
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name, "ar"));

    const homeworkSnapshot = await db
      .collection("homeworks")
      .where("classIds", "array-contains", classId)
      .get();

    const rawHomeworkList = homeworkSnapshot.docs
      .map((doc) => {
        const data = doc.data() as { title?: string; createdAt?: Timestamp; publishDate?: string };
        const publishDate = String(data.publishDate ?? "").trim();
        return {
          id: doc.id,
          title: String(data.title ?? "واجب").trim() || "واجب",
          publishDate: isIsoDate(publishDate) ? publishDate : timestampToIsoDate(data.createdAt),
          createdAt: data.createdAt,
          ref: doc.ref,
        };
      })
      .filter((item) => item.publishDate && item.publishDate >= periodStart && item.publishDate <= periodEnd)
      .sort((a, b) => createdAtValue(a) - createdAtValue(b));

    const submissionMapByHomework = new Map<string, Map<string, { submitted: boolean; score?: number; maxScore?: number }>>();
    const homeworkList: Array<(typeof rawHomeworkList)[number]> = [];

    for (const hw of rawHomeworkList) {
      const subSnapshot = await hw.ref.collection("submissions").get();
      const map = new Map<string, { submitted: boolean; score?: number; maxScore?: number }>();
      for (const subDoc of subSnapshot.docs) {
        const sub = subDoc.data() as { studentCode?: string; score?: number; maxScore?: number };
        const studentCode = String(sub.studentCode ?? subDoc.id).trim();
        if (!studentCode) continue;
        const score = typeof sub.score === "number" && !Number.isNaN(sub.score) ? sub.score : undefined;
        const maxScore = typeof sub.maxScore === "number" && !Number.isNaN(sub.maxScore) ? sub.maxScore : undefined;
        map.set(studentCode, { submitted: true, score, maxScore });
      }
      // Keep only homeworks that still have at least one submission.
      if (map.size > 0) {
        submissionMapByHomework.set(hw.id, map);
        homeworkList.push(hw);
      }
    }

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("الواجبات");
    sheet.views = [{ rightToLeft: true }];

    const fixedColumns = 2;
    const totalColumns = fixedColumns + homeworkList.length + 1;

    sheet.mergeCells(1, 1, 1, totalColumns);
    const titleCell = sheet.getCell(1, 1);
    titleCell.value = `تقرير الواجبات - فصل ${classId.toUpperCase()}`;
    titleCell.font = { name: "Calibri", size: 18, bold: true, color: { argb: "FFFFFFFF" } };
    titleCell.alignment = { vertical: "middle", horizontal: "center" };
    titleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1EA7E1" } };
    sheet.getRow(1).height = 34;

    const headerRow = sheet.getRow(3);
    headerRow.getCell(1).value = "الكود";
    headerRow.getCell(2).value = "الاسم";
    homeworkList.forEach((hw, idx) => {
      headerRow.getCell(3 + idx).value = `${formatDateForHeader(hw.publishDate)}\n${hw.title}`;
    });
    const totalColIndex = 3 + homeworkList.length;
    headerRow.getCell(totalColIndex).value = "مجموع الدرجات";
    headerRow.height = 44;

    let rowIndex = 4;
    for (const student of students) {
      const row = sheet.getRow(rowIndex++);
      row.getCell(1).value = student.code;
      row.getCell(2).value = student.name;
      let totalScore = 0;

      homeworkList.forEach((hw, idx) => {
        const subMap = submissionMapByHomework.get(hw.id);
        const sub = subMap?.get(student.code);
        const cell = row.getCell(3 + idx);
        if (!sub?.submitted) {
          cell.value = "لم يُسلِّم";
        } else if (typeof sub.score === "number") {
          cell.value = `${sub.score}/${sub.maxScore ?? 20}`;
          totalScore += sub.score;
        } else {
          cell.value = "مُسَلَّم";
        }
      });

      row.getCell(totalColIndex).value = totalScore;
      row.height = 24;
    }

    for (let c = 1; c <= totalColumns; c += 1) {
      const col = sheet.getColumn(c);
      if (c === 1) col.width = 14;
      else if (c === 2) col.width = 24;
      else if (c === totalColIndex) col.width = 16;
      else col.width = 22;
    }

    function styleCell(cell: ExcelJS.Cell, isHeader = false) {
      cell.border = {
        top: { style: "thin", color: { argb: "FFBFBFBF" } },
        left: { style: "thin", color: { argb: "FFBFBFBF" } },
        bottom: { style: "thin", color: { argb: "FFBFBFBF" } },
        right: { style: "thin", color: { argb: "FFBFBFBF" } },
      };
      cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
      if (isHeader) {
        cell.font = { name: "Calibri", size: 12, bold: true };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF5F5F5" } };
      } else {
        cell.font = { name: "Calibri", size: 11 };
      }
    }

    const firstDataRow = 4;
    const lastDataRow = Math.max(firstDataRow, rowIndex - 1);
    for (let c = 1; c <= totalColumns; c += 1) {
      styleCell(sheet.getCell(3, c), true);
      for (let r = firstDataRow; r <= lastDataRow; r += 1) {
        const cell = sheet.getCell(r, c);
        styleCell(cell);
      }
    }

    const buffer = await workbook.xlsx.writeBuffer();
    const bytes = new Uint8Array(buffer as ArrayBuffer);
    const periodLabel = periodName || `${periodStart} - ${periodEnd}`;
    const fileName = `تقرير الواجبات ${classId.toUpperCase()} ${periodLabel}.xlsx`;
    const encodedFileName = encodeURIComponent(fileName);

    return new NextResponse(bytes, {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename=\"homework-report.xlsx\"; filename*=UTF-8''${encodedFileName}`,
      },
    });
  } catch (error) {
    console.error("GET /api/classes/[id]/homework-export error:", error);
    return NextResponse.json(
      {
        ok: false,
        message:
          process.env.NODE_ENV === "development" && error instanceof Error
            ? `Failed to export homework report: ${error.message}`
            : "Failed to export homework report.",
      },
      { status: 500 }
    );
  }
}
