import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
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

async function verifyAdminActor(actorCode: string, actorRole: string) {
  if (normalizeRole(actorRole) !== "admin") return false;
  const db = getAdminDb();
  const doc = await db.collection("users").doc(actorCode).get();
  if (!doc.exists) return false;
  const data = doc.data() as { role?: string };
  return normalizeRole(String(data.role ?? "").trim().toLowerCase()) === "admin";
}

async function verifySystemActorForClass(actorCode: string, actorRole: string, classId: string) {
  const normalizedRole = normalizeRole(actorRole);
  if (normalizedRole !== "system" && normalizedRole !== "teacher") return false;
  const db = getAdminDb();
  const doc = await db.collection("users").doc(actorCode).get();
  if (!doc.exists) return false;
  const data = doc.data() as { role?: string; classes?: string[] };
  const role = normalizeRole(String(data.role ?? "").trim().toLowerCase());
  const classes = Array.isArray(data.classes) ? data.classes.map((c) => String(c).trim()) : [];
  return (role === "system" || role === "teacher") && classes.includes(classId);
}

function getTargetWeekday(classId: string) {
  const upper = classId.toUpperCase();
  if (upper.endsWith("B")) return 5; // Friday
  if (upper.endsWith("G")) return 4; // Thursday
  return 5;
}

function generateClassDates(startDate: string, endDate: string, classId: string) {
  const targetWeekday = getTargetWeekday(classId);
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) return [];

  const dates: string[] = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    if (cursor.getDay() === targetWeekday) {
      const yyyy = cursor.getFullYear();
      const mm = String(cursor.getMonth() + 1).padStart(2, "0");
      const dd = String(cursor.getDate()).padStart(2, "0");
      dates.push(`${yyyy}-${mm}-${dd}`);
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}

function formatDateForHeader(isoDate: string) {
  const [yyyy, mm, dd] = isoDate.split("-");
  if (!yyyy || !mm || !dd) return isoDate;
  return `${dd}-${mm}-${yyyy}`;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = decodeSessionFromCookie(request);
    const role = normalizeRole(String(session?.role ?? ""));
    const actorCode = String(session?.code ?? "").trim();
    const { id } = await params;
    const classId = String(id ?? "").trim();
    const url = new URL(request.url);
    const periodId = String(url.searchParams.get("periodId") ?? "").trim();
    if (!classId) {
      return NextResponse.json({ ok: false, message: "Missing class." }, { status: 400 });
    }
    if (!actorCode || !role) {
      return NextResponse.json({ ok: false, message: "Not allowed." }, { status: 403 });
    }
    const canExport =
      (await verifyAdminActor(actorCode, role)) ||
      (await verifySystemActorForClass(actorCode, role, classId));
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
    const period = periodDoc.data() as {
      name?: string;
      startDate?: string;
      endDate?: string;
      term1Start?: string;
      term1End?: string;
      term2Start?: string;
      term2End?: string;
      term1Name?: string;
      term2Name?: string;
      activeTerm?: "term1" | "term2";
    };
    const activeTerm = period.activeTerm ?? "term1";
    const term1Start = String(period.term1Start ?? "");
    const term1End = String(period.term1End ?? "");
    const term2Start = String(period.term2Start ?? "");
    const term2End = String(period.term2End ?? "");
    const startDate =
      activeTerm === "term2" ? term2Start || String(period.startDate ?? "") : term1Start || String(period.startDate ?? "");
    const endDate =
      activeTerm === "term2" ? term2End || String(period.endDate ?? "") : term1End || String(period.endDate ?? "");
    const periodName = String(period.name ?? "");
    const termLabel =
      activeTerm === "term2"
        ? String(period.term2Name ?? "").trim()
        : String(period.term1Name ?? "").trim();
    const dates = generateClassDates(startDate, endDate, classId);
    if (!dates.length) {
      return NextResponse.json({ ok: false, message: "لا توجد تواريخ حصص داخل الفترة." }, { status: 400 });
    }

    const studentsSnapshot = await db
      .collection("users")
      .where("role", "==", "student")
      .where("classes", "array-contains", classId)
      .get();
    const activeStudentCodes = new Set<string>();
    const students = studentsSnapshot.docs
      .map((doc) => {
        const data = doc.data() as { code?: string; name?: string };
        const code = String(data.code ?? doc.id).trim();
        if (code) activeStudentCodes.add(code);
        return {
          code,
          name: String(data.name ?? ""),
        };
      })
      .filter((student) => Boolean(student.code))
      .sort((a, b) => a.name.localeCompare(b.name, "ar"));

    // Avoid composite-index dependency for now: load class attendance then filter by date range in code.
    const attendanceSnapshot = await db
      .collection("attendance")
      .where("classId", "==", classId)
      .get();

    const statusMap = new Map<string, "present" | "absent">();
    for (const doc of attendanceSnapshot.docs) {
      const item = doc.data() as { code?: string; date?: string; status?: string };
      const code = String(item.code ?? "").trim();
      const date = String(item.date ?? "").trim();
      const status = String(item.status ?? "").trim().toLowerCase();
      if (!code || !date) continue;
      if (!activeStudentCodes.has(code)) continue;
      if (date < startDate || date > endDate) continue;
      if (status !== "present" && status !== "absent") continue;
      statusMap.set(`${code}__${date}`, status);
    }

    const displayDates = [...dates];

    const rows = students.map((student) => {
      let presentCount = 0;
      let absentCount = 0;
      const valuesByDate: string[] = [];
      for (const date of displayDates) {
        const status = statusMap.get(`${student.code}__${date}`);
        if (status === "present") {
          valuesByDate.push("✓");
          presentCount += 1;
        } else if (status === "absent") {
          valuesByDate.push("✕");
          absentCount += 1;
        } else {
          valuesByDate.push("-");
        }
      }
      const ratio = dates.length ? Math.round((presentCount / dates.length) * 100) : 0;

      return {
        code: student.code,
        name: student.name,
        valuesByDate,
        presentCount,
        absentCount,
        ratio,
      };
    });

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Attendance");
    sheet.views = [{ rightToLeft: false }];

    const fixedColumns = 3;
    const summaryColumns = 3;
    const totalColumns = fixedColumns + displayDates.length + summaryColumns;
    const titleColor = classId.toUpperCase().endsWith("G") ? "FFF48FB1" : "FF1EA7E1";

    // Top title row.
    sheet.mergeCells(1, 1, 1, totalColumns);
    const title = sheet.getCell(1, 1);
    title.value = `Class ${classId.toUpperCase()}`;
    title.font = { name: "Calibri", size: 18, color: { argb: "FFFFFFFF" } };
    title.alignment = { vertical: "middle", horizontal: "center" };
    title.fill = { type: "pattern", pattern: "solid", fgColor: { argb: titleColor } };
    sheet.getRow(1).height = 34;

    // Header row.
    const headerRowNumber = 3;
    const headerRow = sheet.getRow(headerRowNumber);
    headerRow.getCell(1).value = "#";
    headerRow.getCell(2).value = "Code";
    headerRow.getCell(3).value = "Name";
    displayDates.forEach((date, index) => {
      headerRow.getCell(4 + index).value = formatDateForHeader(date);
    });
    const presentCol = 4 + displayDates.length;
    const absentCol = presentCol + 1;
    const ratioCol = absentCol + 1;
    headerRow.getCell(presentCol).value = "عدد أيام الحضور";
    headerRow.getCell(absentCol).value = "عدد أيام الغياب";
    headerRow.getCell(ratioCol).value = "نسبة الحضور";
    headerRow.height = 26;

    // Data rows start after dates row.
    let rowPtr = 4;
    rows.forEach((row, index) => {
      const r = sheet.getRow(rowPtr++);
      r.getCell(1).value = index + 1;
      r.getCell(2).value = row.code;
      r.getCell(3).value = row.name;
      row.valuesByDate.forEach((value, i) => {
        r.getCell(4 + i).value = value;
      });
      r.getCell(presentCol).value = row.presentCount;
      r.getCell(absentCol).value = row.absentCount;
      r.getCell(ratioCol).value = `${row.ratio}%`;
      r.height = 22;
    });

    // Styling.
    const firstDataRow = 4;
    const lastDataRow = Math.max(firstDataRow, rowPtr - 1);
    for (let c = 1; c <= totalColumns; c += 1) {
      const col = sheet.getColumn(c);
      if (c === 1) col.width = 6;
      else if (c === 2) col.width = 14;
      else if (c === 3) col.width = 22;
      else if (c >= 4 && c < presentCol) col.width = 12;
      else col.width = 16;
    }

    function styleCell(cell: ExcelJS.Cell, isHeader = false) {
      cell.border = {
        top: { style: "thin", color: { argb: "FFBFBFBF" } },
        left: { style: "thin", color: { argb: "FFBFBFBF" } },
        bottom: { style: "thin", color: { argb: "FFBFBFBF" } },
        right: { style: "thin", color: { argb: "FFBFBFBF" } },
      };
      cell.alignment = { vertical: "middle", horizontal: "center" };
      if (isHeader) {
        cell.font = { name: "Calibri", size: 12, bold: true };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF5F5F5" } };
      } else {
        cell.font = { name: "Calibri", size: 11 };
      }
    }

    for (let c = 1; c <= totalColumns; c += 1) {
      styleCell(sheet.getCell(headerRowNumber, c), true);
      for (let r = firstDataRow; r <= lastDataRow; r += 1) {
        const cell = sheet.getCell(r, c);
        styleCell(cell);
        if (c >= 4 && c < presentCol) {
          const value = String(cell.value ?? "");
          if (value === "✓") {
            cell.font = { name: "Calibri", size: 14, bold: true, color: { argb: "FF16A34A" } };
          } else if (value === "✕") {
            cell.font = { name: "Calibri", size: 14, bold: true, color: { argb: "FFDC2626" } };
          }
        }
      }
    }

    const buffer = await workbook.xlsx.writeBuffer();
    const bytes = new Uint8Array(buffer as ArrayBuffer);

    const classCode = classId.toUpperCase();
    const periodLabel = termLabel || periodName || `${startDate} - ${endDate}`;
    const fileName = `حضور ${classCode} ${periodLabel}.xlsx`;
    const encodedFileName = encodeURIComponent(fileName);
    return new NextResponse(bytes, {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="attendance.xlsx"; filename*=UTF-8''${encodedFileName}`,
      },
    });
  } catch (error) {
    console.error("GET /api/classes/[id]/attendance-export error:", error);
    return NextResponse.json(
      {
        ok: false,
        message:
          process.env.NODE_ENV === "development" && error instanceof Error
            ? `Failed to export attendance: ${error.message}`
            : "Failed to export attendance.",
      },
      { status: 500 }
    );
  }
}
