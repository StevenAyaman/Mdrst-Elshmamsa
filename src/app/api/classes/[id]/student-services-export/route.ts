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

async function verifyAdminActor(actorCode: string, actorRole: string) {
  if (actorRole !== "admin") return false;
  const db = getAdminDb();
  const doc = await db.collection("users").doc(actorCode).get();
  if (!doc.exists) return false;
  const data = doc.data() as { role?: string };
  return String(data.role ?? "").trim().toLowerCase() === "admin";
}

async function verifySystemActorForClass(actorCode: string, actorRole: string, classId: string) {
  if (actorRole !== "system") return false;
  const db = getAdminDb();
  const doc = await db.collection("users").doc(actorCode).get();
  if (!doc.exists) return false;
  const data = doc.data() as { role?: string; classes?: string[] };
  const role = String(data.role ?? "").trim().toLowerCase();
  const classes = Array.isArray(data.classes) ? data.classes.map((c) => String(c).trim()) : [];
  return (role === "system" || role === "nzam") && classes.includes(classId);
}

function parseImageDataUrl(dataUrl: string) {
  const match = dataUrl.match(/^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/i);
  if (!match) return null;
  const extRaw = match[1].toLowerCase();
  const extension: "png" | "jpeg" = extRaw === "png" ? "png" : "jpeg";
  const base64 = match[2];
  return { extension, base64: `data:image/${extension};base64,${base64}` };
}

function asCleanText(value: unknown) {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return "";
  const text = String(value).trim();
  if (text.toLowerCase() === "false" || text.toLowerCase() === "true") return "";
  return text;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = decodeSessionFromCookie(request);
    const role = session?.role === "nzam" ? "system" : session?.role;
    const code = String(session?.code ?? "").trim();

    const { id } = await params;
    const classId = String(id ?? "").trim();
    if (!classId) {
      return NextResponse.json({ ok: false, message: "Missing class id." }, { status: 400 });
    }

    if (!code || !role) {
      return NextResponse.json({ ok: false, message: "Not allowed." }, { status: 403 });
    }
    const canExport =
      (await verifyAdminActor(code, role)) ||
      (await verifySystemActorForClass(code, role, classId));
    if (!canExport) {
      return NextResponse.json({ ok: false, message: "Not allowed." }, { status: 403 });
    }
    const isGirlsClass = classId.toUpperCase().endsWith("G");

    const db = getAdminDb();
    const activePeriodSnap = await db
      .collection("service_periods")
      .where("active", "==", true)
      .limit(1)
      .get();
    if (activePeriodSnap.empty) {
      return NextResponse.json({ ok: false, message: "لا توجد فترة فعالة حالياً." }, { status: 400 });
    }
    const period = activePeriodSnap.docs[0].data() as {
      name?: string;
      term1Name?: string;
      term2Name?: string;
      activeTerm?: "term1" | "term2";
    };
    const activeTerm = period.activeTerm ?? "term1";
    const termLabel =
      activeTerm === "term2"
        ? String(period.term2Name ?? "").trim()
        : String(period.term1Name ?? "").trim();
    const usersSnap = await db
      .collection("users")
      .where("role", "==", "student")
      .where("classes", "array-contains", classId)
      .get();

    const rows = usersSnap.docs
      .map((doc) => {
        const item = doc.data() as {
          code?: string;
          name?: string;
          preferredMass?: string;
          preferredService?: string;
          lastServiceType?: string;
          currentRank?: string;
          ordinationDate?: string;
          ordinationChurch?: string;
          ordainedBy?: string;
          lastServiceDate?: string;
          civilId?: string;
          civilCardPhoto?: string;
        };
        return {
          "الكود": asCleanText(item.code ?? doc.id),
          "الاسم": asCleanText(item.name ?? ""),
          "القداس المفضل": asCleanText(item.preferredMass),
          ...(isGirlsClass
            ? {}
            : {
                "الخدمة المفضلة": asCleanText(item.preferredService),
                "نوع اخر خدمة": asCleanText(item.lastServiceType),
                "الرتبة الحالية": asCleanText(item.currentRank),
                "تاريخ الرسامة/الترقية": asCleanText(item.ordinationDate),
                "كنيسة الرسامة": asCleanText(item.ordinationChurch),
                "الرسامة على يد": asCleanText(item.ordainedBy),
                "تاريخ اخر خدمة": asCleanText(item.lastServiceDate),
              }),
          "الرقم المدني": asCleanText(item.civilId),
          "صورة المدنية": asCleanText(item.civilCardPhoto),
        };
      })
      .sort((a, b) => a["الاسم"].localeCompare(b["الاسم"], "ar"));

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("StudentServices");
    sheet.views = [{ rightToLeft: true }];

    const columns: Array<{ key: string; header: string; width: number }> = [
      { key: "الكود", header: "الكود", width: 16 },
      { key: "الاسم", header: "الاسم", width: 28 },
      { key: "القداس المفضل", header: "القداس المفضل", width: 24 },
      { key: "الخدمة المفضلة", header: "الخدمة المفضلة", width: 20 },
      { key: "نوع اخر خدمة", header: "نوع اخر خدمة", width: 20 },
      { key: "الرتبة الحالية", header: "الرتبة الحالية", width: 18 },
      { key: "تاريخ الرسامة/الترقية", header: "تاريخ الرسامة/الترقية", width: 22 },
      { key: "كنيسة الرسامة", header: "كنيسة الرسامة", width: 22 },
      { key: "الرسامة على يد", header: "الرسامة على يد", width: 22 },
      { key: "تاريخ اخر خدمة", header: "تاريخ اخر خدمة", width: 20 },
      { key: "الرقم المدني", header: "الرقم المدني", width: 18 },
      { key: "صورة المدنية", header: "صورة المدنية", width: 22 },
    ];

    sheet.columns = columns.map((c) => ({ header: c.header, key: c.key, width: c.width }));
    const header = sheet.getRow(1);
    header.height = 26;
    header.eachCell((cell) => {
      cell.font = { bold: true, name: "Calibri", size: 12 };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEFF3FF" } };
      cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
      cell.border = {
        top: { style: "thin", color: { argb: "FFBFC5D6" } },
        bottom: { style: "thin", color: { argb: "FFBFC5D6" } },
        left: { style: "thin", color: { argb: "FFBFC5D6" } },
        right: { style: "thin", color: { argb: "FFBFC5D6" } },
      };
    });

    rows.forEach((row) => {
      sheet.addRow({
        ...row,
        "صورة المدنية": "",
      });
    });

    for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
      const excelRow = sheet.getRow(rowNumber);
      excelRow.height = 56;
      excelRow.eachCell((cell) => {
        cell.font = { name: "Calibri", size: 11 };
        cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
        cell.border = {
          top: { style: "thin", color: { argb: "FFE3E8F5" } },
          bottom: { style: "thin", color: { argb: "FFE3E8F5" } },
          left: { style: "thin", color: { argb: "FFE3E8F5" } },
          right: { style: "thin", color: { argb: "FFE3E8F5" } },
        };
      });
    }

    const imageColIndex = columns.findIndex((c) => c.key === "صورة المدنية") + 1;
    rows.forEach((row, index) => {
      const parsed = parseImageDataUrl(String(row["صورة المدنية"] ?? ""));
      if (!parsed) return;
      const imageId = workbook.addImage({
        extension: parsed.extension,
        base64: parsed.base64,
      });
      const rowNumber = index + 2;
      sheet.addImage(imageId, {
        tl: { col: imageColIndex - 1 + 0.18, row: rowNumber - 1 + 0.12 },
        ext: { width: 70, height: 42 },
      });
    });

    const buffer = await workbook.xlsx.writeBuffer();
    const bytes = new Uint8Array(buffer as ArrayBuffer);

    const fileName = `قداسات ${classId.toUpperCase()} ${termLabel || String(period.name ?? "").trim()}`.trim() + `.xlsx`;
    return new NextResponse(bytes, {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${fileName}"`,
      },
    });
  } catch (error) {
    console.error("GET /api/classes/[id]/student-services-export error:", error);
    return NextResponse.json(
      { ok: false, message: "Failed to export excel." },
      { status: 500 }
    );
  }
}
