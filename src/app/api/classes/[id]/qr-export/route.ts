import { createRequire } from "module";
import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import path from "path";
import fs from "fs";

export const runtime = "nodejs";

const require = createRequire(import.meta.url);
const PDFDocumentModule = require("pdfkit");
const QRCodeModule = require("qrcode");
const PDFDocument =
  PDFDocumentModule?.default ??
  PDFDocumentModule?.PDFDocument ??
  PDFDocumentModule;
const QRCode = QRCodeModule?.default ?? QRCodeModule;

type Session = { code?: string; role?: string } | null;

function decodeSessionFromCookie(request: Request): Session {
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
  if (normalizeRole(actorRole) !== "system") return false;
  const db = getAdminDb();
  const doc = await db.collection("users").doc(actorCode).get();
  if (!doc.exists) return false;
  const data = doc.data() as { role?: string; classes?: string[] };
  if (normalizeRole(String(data.role ?? "").trim().toLowerCase()) !== "system") return false;
  const classes = Array.isArray(data.classes) ? data.classes : [];
  return classes.includes(classId);
}

async function getStudents(classId: string) {
  const db = getAdminDb();
  const snap = await db
    .collection("users")
    .where("role", "==", "student")
    .where("classes", "array-contains", classId)
    .get();
  return snap.docs
    .map((doc) => {
      const item = doc.data() as { code?: string; name?: string };
      return {
        code: String(item.code ?? doc.id),
        name: String(item.name ?? ""),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "ar"));
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = decodeSessionFromCookie(request);
    const actorCode = String(session?.code ?? "").trim();
    const actorRole = normalizeRole(String(session?.role ?? "").trim().toLowerCase());
    if (!actorCode || !actorRole) {
      return NextResponse.json({ ok: false, message: "Unauthorized." }, { status: 401 });
    }

    const { id } = await params;
    const classId = String(id ?? "").trim();
    if (!classId) {
      return NextResponse.json({ ok: false, message: "Missing class." }, { status: 400 });
    }

    const canAccess =
      (await verifyAdminActor(actorCode, actorRole)) ||
      (await verifySystemActorForClass(actorCode, actorRole, classId));
    if (!canAccess) {
      return NextResponse.json({ ok: false, message: "Not allowed." }, { status: 403 });
    }

    const students = await getStudents(classId);

    const fontPath = path.join(process.cwd(), "public", "Fonts", "Tajawal-Regular.ttf");
    const doc = new PDFDocument({
      size: "A4",
      margin: 36,
      font: null,
    });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Uint8Array) => chunks.push(Buffer.from(chunk)));

    try {
      const fontBuffer = fs.readFileSync(fontPath);
      doc.registerFont("Tajawal", fontBuffer);
      doc.font("Tajawal");
    } catch (fontError) {
      console.warn("QR export font load failed, using default font.", fontError);
    }

    doc.fontSize(18).text(`QR Codes - ${classId.toUpperCase()}`, {
      align: "center",
    });
    doc.moveDown(0.8);

    const tableTop = doc.y + 8;
    const rowHeight = 56;
    const colName = 80;
    const colCode = 220;
    const colQr = 360;

    doc.fontSize(12).text("الاسم", colName, tableTop);
    doc.text("الكود", colCode, tableTop);
    doc.text("QR", colQr, tableTop);
    let y = tableTop + 20;

    for (const student of students) {
      if (y + rowHeight > doc.page.height - 40) {
        doc.addPage();
        y = 50;
      }

      doc.fontSize(11).text(student.name, colName, y + 8, { width: 120 });
      doc.fontSize(11).text(student.code, colCode, y + 8);

      const qrDataUrl = await QRCode.toDataURL(student.code, { margin: 0, width: 80 });
      const base64 = qrDataUrl.split(",")[1] || "";
      const imgBuffer = Buffer.from(base64, "base64");
      doc.image(imgBuffer, colQr, y, { width: 48, height: 48 });

      y += rowHeight;
    }

    doc.end();

    const pdfBuffer: Buffer = await new Promise((resolve, reject) => {
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);
    });

    return new NextResponse(new Uint8Array(pdfBuffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="QR-${classId.toUpperCase()}.pdf"`,
      },
    });
  } catch (error) {
    console.error("GET /api/classes/[id]/qr-export error:", error);
    return NextResponse.json(
      { ok: false, message: "Failed to export QR codes." },
      { status: 500 }
    );
  }
}
