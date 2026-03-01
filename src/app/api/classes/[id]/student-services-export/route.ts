import { NextResponse } from "next/server";
import * as xlsx from "xlsx";
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
        };
        return {
          "الكود": String(item.code ?? doc.id),
          "الاسم": String(item.name ?? ""),
          "القداس المفضل": String(item.preferredMass ?? ""),
          ...(isGirlsClass
            ? {}
            : {
                "الخدمة المفضلة": String(item.preferredService ?? ""),
                "نوع اخر خدمة": String(item.lastServiceType ?? ""),
                "الرتبة الحالية": String(item.currentRank ?? ""),
                "تاريخ الرسامة/الترقية": String(item.ordinationDate ?? ""),
                "كنيسة الرسامة": String(item.ordinationChurch ?? ""),
                "الرسامة على يد": String(item.ordainedBy ?? ""),
                "تاريخ اخر خدمة": String(item.lastServiceDate ?? ""),
              }),
        };
      })
      .sort((a, b) => a["الاسم"].localeCompare(b["الاسم"], "ar"));

    const wb = xlsx.utils.book_new();
    const ws = xlsx.utils.json_to_sheet(rows);
    xlsx.utils.book_append_sheet(wb, ws, "StudentServices");
    const buffer = xlsx.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
    const bytes = new Uint8Array(buffer);

    const fileName = `student-services-${classId}.xlsx`;
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
