import { NextResponse } from "next/server";
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

function normalizeClassId(value: string) {
  return String(value ?? "").trim().toUpperCase();
}

export async function GET(request: Request) {
  try {
    const session = decodeSessionFromCookie(request);
    if (!session?.code || !session?.role) {
      return NextResponse.json({ ok: false, message: "Unauthorized." }, { status: 401 });
    }
    const db = getAdminDb();
    const snapshot = await db.collection("classes").orderBy("name", "asc").get();
    const data = snapshot.docs.map((doc) => {
      const item = doc.data() as { name?: string };
      return {
        id: doc.id,
        name: item.name ?? doc.id,
      };
    });
    return NextResponse.json({ ok: true, data });
  } catch (error) {
    console.error("GET /api/classes error:", error);
    return NextResponse.json(
      { ok: false, message: "Failed to load classes." },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const session = decodeSessionFromCookie(request);
    if (!session?.code || !session?.role) {
      return NextResponse.json({ ok: false, message: "Unauthorized." }, { status: 401 });
    }

    const db = getAdminDb();
    const role = normalizeRole(String(session.role ?? "").trim().toLowerCase());
    if (role !== "admin") {
      return NextResponse.json({ ok: false, message: "Not allowed." }, { status: 403 });
    }

    const body = (await request.json()) as { id?: string; name?: string };
    const id = normalizeClassId(body.id ?? "");
    const name = String(body.name ?? "").trim();

    if (!id || !name) {
      return NextResponse.json({ ok: false, message: "Class code and class name are required." }, { status: 400 });
    }

    const ref = db.collection("classes").doc(id);
    const exists = await ref.get();
    if (exists.exists) {
      return NextResponse.json({ ok: false, message: "Class code already exists." }, { status: 409 });
    }

    await ref.set({
      name,
      createdAt: new Date().toISOString(),
      createdBy: session.code,
    });

    return NextResponse.json({ ok: true, data: { id, name } });
  } catch (error) {
    console.error("POST /api/classes error:", error);
    return NextResponse.json({ ok: false, message: "Failed to create class." }, { status: 500 });
  }
}
