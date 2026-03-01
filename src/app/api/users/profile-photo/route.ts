import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";

export const runtime = "nodejs";

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

export async function GET(request: Request) {
  try {
    const session = decodeSessionFromCookie(request);
    if (!session?.code) {
      return NextResponse.json({ ok: false, message: "Unauthorized." }, { status: 401 });
    }
    const db = getAdminDb();
    const doc = await db.collection("users").doc(session.code).get();
    if (!doc.exists) {
      return NextResponse.json({ ok: false, message: "User not found." }, { status: 404 });
    }
    const data = doc.data() as { profilePhoto?: string };
    return NextResponse.json({ ok: true, data: { profilePhoto: data.profilePhoto ?? "" } });
  } catch (error) {
    console.error("GET /api/users/profile-photo error:", error);
    return NextResponse.json({ ok: false, message: "Failed to load photo." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = decodeSessionFromCookie(request);
    if (!session?.code) {
      return NextResponse.json({ ok: false, message: "Unauthorized." }, { status: 401 });
    }
    const body = await request.json();
    const profilePhoto = String(body.profilePhoto ?? "").trim();
    if (!profilePhoto.startsWith("data:image/")) {
      return NextResponse.json({ ok: false, message: "Invalid image." }, { status: 400 });
    }

    const db = getAdminDb();
    await db.collection("users").doc(session.code).update({
      profilePhoto,
      updatedAt: new Date().toISOString(),
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("POST /api/users/profile-photo error:", error);
    return NextResponse.json({ ok: false, message: "Failed to save photo." }, { status: 500 });
  }
}
