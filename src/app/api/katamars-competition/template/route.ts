import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { getAdminDb } from "@/lib/firebase/admin";
import { decodeSessionFromCookie, getUserByCode, normalizeRole } from "@/lib/session";
import { mapRole } from "@/lib/code-mapper";

export const runtime = "nodejs";

async function getAccess(request: Request) {
  const session = decodeSessionFromCookie(request);
  if (!session?.code || !session?.role) return { ok: false as const, status: 401 };

  const actorDoc = await getUserByCode(session.code);
  if (!actorDoc?.exists) return { ok: false as const, status: 404 };

  const actorData = actorDoc.data() as { role?: string };
  const role = normalizeRole(String(actorData.role ?? session.role).trim().toLowerCase());
  if (role !== "katamars" && role !== "admin") return { ok: false as const, status: 403 };

  return { ok: true as const, role, code: session.code };
}

export async function GET(request: Request) {
  try {
    const access = await getAccess(request);
    if (!access.ok) {
      const map: Record<number, string> = {
        401: "Unauthorized.",
        403: "للأسف، غير مسموح لك الدخول.",
        404: "User not found.",
      };
      return NextResponse.json({ ok: false, message: map[access.status] ?? "Not allowed." }, { status: access.status });
    }

    const url = new URL(request.url);
    const classId = String(url.searchParams.get("classId") ?? "").trim();
    const month = String(url.searchParams.get("month") ?? "").trim();
    if (!classId || !month) {
      return NextResponse.json({ ok: false, message: "بيانات غير مكتملة." }, { status: 400 });
    }

    const db = getAdminDb();
    const studentsSnap = await db.collection("users").where("classes", "array-contains", classId).get();
    const students = studentsSnap.docs
      .map((doc) => {
        const data = doc.data() as { code?: string; name?: string; role?: string };
        if (mapRole(String(data.role ?? "").trim().toLowerCase()) !== "student") return null;
        return {
          code: String(data.code ?? doc.id).trim(),
          name: String(data.name ?? "").trim(),
          classId,
        };
      })
      .filter((item): item is { code: string; name: string; classId: string } => Boolean(item?.code))
      .sort((a, b) => a.name.localeCompare(b.name, "ar"));

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("درجات مسابقة القطمارس");
    sheet.views = [{ rightToLeft: true }];
    sheet.columns = [
      { header: "الاسم", key: "name", width: 34 },
      { header: "الصف", key: "classId", width: 14 },
      { header: "الكود", key: "code", width: 18 },
      { header: "الدرجة", key: "score", width: 14 },
      { header: "الشهر", key: "month", width: 18 },
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
      row.getCell(1).value = student.name;
      row.getCell(2).value = student.classId;
      row.getCell(3).value = student.code;
      row.getCell(4).value = null;
      row.getCell(5).value = month;
      for (let cellIndex = 1; cellIndex <= 5; cellIndex += 1) {
        const cell = row.getCell(cellIndex);
        cell.border = {
          top: { style: "thin", color: { argb: "FFD0D0D0" } },
          left: { style: "thin", color: { argb: "FFD0D0D0" } },
          bottom: { style: "thin", color: { argb: "FFD0D0D0" } },
          right: { style: "thin", color: { argb: "FFD0D0D0" } },
        };
        cell.alignment = { horizontal: cellIndex === 1 ? "right" : "center", vertical: "middle" };
      }
      rowIndex += 1;
    }

    const buffer = await workbook.xlsx.writeBuffer();
    const fileName = `درجات مسابقة القطمارس ${month} ${classId}.xlsx`;
    const encoded = encodeURIComponent(fileName);

    return new NextResponse(new Uint8Array(buffer as ArrayBuffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="katamars-competition.xlsx"; filename*=UTF-8''${encoded}`,
      },
    });
  } catch (error) {
    console.error("GET /api/katamars-competition/template error:", error);
    return NextResponse.json({ ok: false, message: "Failed to export Katamars competition template." }, { status: 500 });
  }
}
