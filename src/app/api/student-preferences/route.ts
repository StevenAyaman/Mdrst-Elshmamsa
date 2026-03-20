import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";

export const runtime = "nodejs";

const ALLOWED_SERVICES = new Set(["خدمة مذبح", "خدمة القرائات"]);
const ALLOWED_RANKS = new Set(["ابصالتس", "اغنسطس", "ابيدياكون", "دياكون"]);
const ALLOWED_MASSES = new Set([
  "قداس الجمعة الاول",
  "قداس الجمعة الثاني",
  "قداس السبت الاول",
  "قداس السبت الثاني",
  "قداس الاحد الاول",
  "قداس الاحد الثاني",
  "قداس الثلاثاء",
]);

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

function normalizeRememberedDate(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  if (raw === "لا اتذكر") return "لا اتذكر";
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  return "";
}

function isValidCivilId(value: string) {
  return /^\d{12}$/.test(value);
}

function isValidCivilCardDataUrl(value: string) {
  return /^data:image\/(png|jpe?g|webp);base64,/i.test(value);
}

export async function GET(request: Request) {
  try {
    const session = decodeSessionFromCookie(request);
    const role = normalizeRole(String(session?.role ?? ""));
    const code = String(session?.code ?? "").trim();

    if (!code || role !== "student") {
      return NextResponse.json({ ok: false, message: "Not allowed." }, { status: 403 });
    }

    const db = getAdminDb();
    const doc = await db.collection("users").doc(code).get();
    if (!doc.exists) {
      return NextResponse.json({ ok: false, message: "User not found." }, { status: 404 });
    }
    const data = doc.data() as {
      preferredService?: string;
      preferredMass?: string;
      lastServiceType?: string;
      currentRank?: string;
      ordinationDate?: string;
      ordinationChurch?: string;
      ordainedBy?: string;
      lastServiceDate?: string;
      civilId?: string;
      civilCardPhoto?: string;
      classes?: string[];
    };
    const classId = Array.isArray(data.classes) && data.classes.length ? String(data.classes[0] ?? "") : "";
    const isGirlsClass = classId.toUpperCase().endsWith("G");
    const isBoysClass = classId.toUpperCase().endsWith("B");

    return NextResponse.json({
      ok: true,
      data: {
        preferredService: String(data.preferredService ?? ""),
        preferredMass: String(data.preferredMass ?? ""),
        lastServiceType: String(data.lastServiceType ?? ""),
        currentRank: String(data.currentRank ?? ""),
        ordinationDate: String(data.ordinationDate ?? ""),
        ordinationChurch: String(data.ordinationChurch ?? ""),
        ordainedBy: String(data.ordainedBy ?? ""),
        lastServiceDate: String(data.lastServiceDate ?? ""),
        civilId: String(data.civilId ?? ""),
        civilCardPhoto: String(data.civilCardPhoto ?? ""),
        isGirlsClass,
        requiresService: !isGirlsClass,
        requiresExtraFields: isBoysClass,
      },
    });
  } catch (error) {
    console.error("GET /api/student-preferences error:", error);
    return NextResponse.json(
      { ok: false, message: "Failed to load preferences." },
      { status: 500 }
    );
  }
}

export async function PATCH(request: Request) {
  try {
    const session = decodeSessionFromCookie(request);
    const role = normalizeRole(String(session?.role ?? ""));
    const code = String(session?.code ?? "").trim();

    if (!code || role !== "student") {
      return NextResponse.json({ ok: false, message: "Not allowed." }, { status: 403 });
    }

    const body = (await request.json()) as {
      preferredService?: string;
      preferredMass?: string;
      lastServiceType?: string;
      currentRank?: string;
      ordinationDate?: string;
      ordinationChurch?: string;
      ordainedBy?: string;
      lastServiceDate?: string;
      civilId?: string;
      civilCardPhoto?: string;
    };
    const preferredServiceInput = String(body.preferredService ?? "").trim();
    const preferredMass = String(body.preferredMass ?? "").trim();
    const lastServiceType = String(body.lastServiceType ?? "").trim();
    const currentRank = String(body.currentRank ?? "").trim();
    const ordinationDate = normalizeRememberedDate(body.ordinationDate);
    const ordinationChurch = String(body.ordinationChurch ?? "").trim();
    const ordainedBy = String(body.ordainedBy ?? "").trim();
    const lastServiceDate = normalizeRememberedDate(body.lastServiceDate);
    const civilId = String(body.civilId ?? "").trim();
    const civilCardPhoto = String(body.civilCardPhoto ?? "").trim();

    const db = getAdminDb();
    const userDoc = await db.collection("users").doc(code).get();
    if (!userDoc.exists) {
      return NextResponse.json({ ok: false, message: "User not found." }, { status: 404 });
    }
    const userData = userDoc.data() as { classes?: string[] };
    const classId =
      Array.isArray(userData.classes) && userData.classes.length
        ? String(userData.classes[0] ?? "")
        : "";
    const isGirlsClass = classId.toUpperCase().endsWith("G");
    const isBoysClass = classId.toUpperCase().endsWith("B");
    const preferredService = isGirlsClass ? "" : preferredServiceInput;

    const isServiceValid = isGirlsClass || ALLOWED_SERVICES.has(preferredService);
    if (
      !isServiceValid ||
      !ALLOWED_MASSES.has(preferredMass) ||
      (isBoysClass &&
        (!ALLOWED_RANKS.has(currentRank) ||
          !ALLOWED_SERVICES.has(lastServiceType) ||
          !ordinationDate ||
          !ordinationChurch ||
          !ordainedBy ||
          !lastServiceDate)) ||
      !isValidCivilId(civilId) ||
      !isValidCivilCardDataUrl(civilCardPhoto) ||
      civilCardPhoto.length > 900_000
    ) {
      return NextResponse.json(
        { ok: false, message: "من فضلك أكمل بيانات الخدمة المفضلة بشكل صحيح (وصغّر صورة المدنية إذا كانت كبيرة)." },
        { status: 400 }
      );
    }
    await db.collection("users").doc(code).update({
      preferredService,
      preferredMass,
      lastServiceType: isBoysClass ? lastServiceType : "",
      currentRank: isBoysClass ? currentRank : "",
      ordinationDate: isBoysClass ? ordinationDate : "",
      ordinationChurch: isBoysClass ? ordinationChurch : "",
      ordainedBy: isBoysClass ? ordainedBy : "",
      lastServiceDate: isBoysClass ? lastServiceDate : "",
      civilId,
      civilCardPhoto,
      updatedAt: new Date().toISOString(),
    });

    const response = NextResponse.json({
      ok: true,
      data: {
        preferredService,
        preferredMass,
        lastServiceType,
        currentRank,
        ordinationDate,
        ordinationChurch,
        ordainedBy,
        lastServiceDate,
        civilId,
        civilCardPhoto,
      },
    });
    const sessionPayload = Buffer.from(
      JSON.stringify({
        code,
        role: "student",
        mustChangePassword: false,
        needsServicePref: false,
      })
    ).toString("base64url");
    response.cookies.set("dsms_session", sessionPayload, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
    response.cookies.set("dsms_last_path", encodeURIComponent("/portal/student"), {
      httpOnly: false,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
    return response;
  } catch (error) {
    console.error("PATCH /api/student-preferences error:", error);
    return NextResponse.json(
      { ok: false, message: "Failed to save preferences." },
      { status: 500 }
    );
  }
}
