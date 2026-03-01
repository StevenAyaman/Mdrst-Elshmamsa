import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { hashPassword, verifyPassword } from "@/lib/password";

export const runtime = "nodejs";

type ChangePasswordPayload = {
  actorCode?: string;
  actorRole?: string;
  currentPassword?: string;
  nextPassword?: string;
};

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

function isSessionActorMatch(request: Request, actorCode: string, actorRole: string) {
  const session = decodeSessionFromCookie(request);
  if (!session?.code || !session?.role) return false;
  const normalizedRole = session.role === "nzam" ? "system" : session.role;
  const requestedRole = actorRole === "nzam" ? "system" : actorRole;
  return session.code === actorCode && normalizedRole === requestedRole;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ChangePasswordPayload;
    const actorCode = String(body.actorCode ?? "").trim();
    const actorRole = String(body.actorRole ?? "").trim().toLowerCase();
    const currentPassword = String(body.currentPassword ?? "").trim();
    const nextPassword = String(body.nextPassword ?? "").trim();

    if (!actorCode || !actorRole || !currentPassword || !nextPassword) {
      return NextResponse.json(
        { ok: false, message: "Missing required fields." },
        { status: 400 }
      );
    }
    if (!isSessionActorMatch(request, actorCode, actorRole)) {
      return NextResponse.json(
        { ok: false, message: "Session mismatch." },
        { status: 401 }
      );
    }
    if (nextPassword.length < 4) {
      return NextResponse.json(
        { ok: false, message: "Password too short." },
        { status: 400 }
      );
    }

    const db = getAdminDb();
    const ref = db.collection("users").doc(actorCode);
    const snap = await ref.get();
    if (!snap.exists) {
      return NextResponse.json(
        { ok: false, message: "User not found." },
        { status: 404 }
      );
    }
    const data = snap.data() as { startupPassword?: string; passwordHash?: string };
    const storedPassword = String(data.startupPassword ?? "").trim();
    const storedHash = String(data.passwordHash ?? "").trim();

    if (storedHash) {
      const ok = await verifyPassword(currentPassword, storedHash);
      if (!ok) {
        return NextResponse.json(
          { ok: false, message: "Current password is incorrect." },
          { status: 400 }
        );
      }
    } else if (storedPassword) {
      if (storedPassword !== currentPassword) {
        return NextResponse.json(
          { ok: false, message: "Current password is incorrect." },
          { status: 400 }
        );
      }
    } else {
      return NextResponse.json(
        { ok: false, message: "No password found for this account." },
        { status: 400 }
      );
    }

    const nextHash = await hashPassword(nextPassword);
    await ref.update({
      startupPassword: "",
      passwordHash: nextHash,
      mustChangePassword: false,
      updatedAt: new Date().toISOString(),
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("POST /api/users/change-password error:", error);
    return NextResponse.json(
      { ok: false, message: "Failed to change password." },
      { status: 500 }
    );
  }
}
