import { NextResponse } from "next/server";
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

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const token = String(body.token ?? "").trim();
    if (!token) {
      return NextResponse.json(
        { ok: false, message: "Missing token." },
        { status: 400 }
      );
    }

    const session = request.headers.get("cookie") || "";
    const userCode = String(body.userCode ?? "").trim();

    if (!userCode) {
      return NextResponse.json(
        { ok: false, message: "Missing user code." },
        { status: 400 }
      );
    }
    const sessionInfo = decodeSessionFromCookie(request);
    if (!sessionInfo?.code || sessionInfo.code !== userCode) {
      return NextResponse.json(
        { ok: false, message: "Session mismatch." },
        { status: 401 }
      );
    }

    const db = getAdminDb();
    const userDoc = await db.collection("users").doc(userCode).get();
    if (!userDoc.exists) {
      return NextResponse.json(
        { ok: false, message: "User not found." },
        { status: 404 }
      );
    }

    const user = userDoc.data() as { role?: string; classes?: string[] };
    const role = String(user.role ?? "").trim();
    const classes = Array.isArray(user.classes) ? user.classes : [];

    await db.collection("pushTokens").doc(token).set({
      token,
      userCode,
      role,
      classIds: classes,
      updatedAt: Timestamp.now(),
      session,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("POST /api/push/register error:", error);
    return NextResponse.json(
      { ok: false, message: "Failed to register token." },
      { status: 500 }
    );
  }
}
