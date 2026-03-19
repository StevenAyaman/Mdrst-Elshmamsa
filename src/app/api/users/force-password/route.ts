import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { hashPassword } from "@/lib/password";

export const runtime = "nodejs";

type ForcePasswordPayload = {
  actorCode?: string;
  actorRole?: string;
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
    const body = (await request.json()) as ForcePasswordPayload;
    const actorCode = String(body.actorCode ?? "").trim();
    const actorRole = String(body.actorRole ?? "").trim().toLowerCase();
    const nextPassword = String(body.nextPassword ?? "").trim();

    if (!actorCode || !actorRole || !nextPassword) {
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
    const data = snap.data() as {
      classes?: string[];
      preferredMass?: string;
      preferredService?: string;
      currentRank?: string;
      lastServiceType?: string;
      ordinationDate?: string;
      ordinationChurch?: string;
      ordainedBy?: string;
      lastServiceDate?: string;
      civilId?: string;
      civilCardPhoto?: string;
    };
    const classId =
      Array.isArray(data.classes) && data.classes.length ? String(data.classes[0] ?? "") : "";
    const isGirlsClass = classId.toUpperCase().endsWith("G");
    const isBoysClass = classId.toUpperCase().endsWith("B");
    const preferredMass = String(data.preferredMass ?? "").trim();
    const preferredService = String(data.preferredService ?? "").trim();
    const currentRank = String(data.currentRank ?? "").trim();
    const lastServiceType = String(data.lastServiceType ?? "").trim();
    const ordinationDate = String(data.ordinationDate ?? "").trim();
    const ordinationChurch = String(data.ordinationChurch ?? "").trim();
    const ordainedBy = String(data.ordainedBy ?? "").trim();
    const lastServiceDate = String(data.lastServiceDate ?? "").trim();
    const civilId = String(data.civilId ?? "").trim();
    const civilCardPhoto = String(data.civilCardPhoto ?? "").trim();
    const needsServicePref =
      actorRole === "student" &&
      (
        !preferredMass ||
        (!isGirlsClass && !preferredService) ||
        (isBoysClass &&
          (!currentRank ||
            !lastServiceType ||
            !ordinationDate ||
            !ordinationChurch ||
            !ordainedBy ||
            !lastServiceDate)) ||
        !/^\d{12}$/.test(civilId) ||
        !civilCardPhoto.startsWith("data:image/")
      );

    const nextHash = await hashPassword(nextPassword);
    await ref.update({
      startupPassword: "",
      passwordHash: nextHash,
      mustChangePassword: false,
      updatedAt: new Date().toISOString(),
    });

    const response = NextResponse.json({ ok: true });
    const normalizedRole = actorRole === "nzam" ? "system" : actorRole;
    const sessionPayload = Buffer.from(
      JSON.stringify({
        code: actorCode,
        role: normalizedRole,
        mustChangePassword: false,
        needsServicePref,
        iat: Date.now(),
      })
    ).toString("base64url");
    response.cookies.set("dsms_session", sessionPayload, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
    response.cookies.set("dsms_last_path", encodeURIComponent(`/portal/${normalizedRole}`), {
      httpOnly: false,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
    return response;
  } catch (error) {
    console.error("POST /api/users/force-password error:", error);
    return NextResponse.json(
      { ok: false, message: "Failed to change password." },
      { status: 500 }
    );
  }
}
