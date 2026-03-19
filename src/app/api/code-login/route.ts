import { NextResponse } from "next/server";
import { mapRole, normalizeValue } from "@/lib/code-mapper";
import { hashPassword, verifyPassword } from "@/lib/password";
import { getAdminDb } from "@/lib/firebase/admin";

const loginAttempts = new Map<string, { count: number; lockedUntil: number }>();
const LOGIN_MAX_ATTEMPTS = 6;
const LOGIN_LOCK_MS = 10 * 60 * 1000;

function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for") ?? "";
  if (forwarded) return forwarded.split(",")[0].trim();
  return request.headers.get("x-real-ip") ?? "unknown";
}

function getAttemptKey(code: string, ip: string) {
  return `${code}::${ip}`;
}

export async function POST(request: Request) {
  const { code, password } = await request.json();
  const studentCode = normalizeValue(code);
  const studentPassword = normalizeValue(password).replace(/\s+/g, "");
  const ip = getClientIp(request);
  const attemptKey = getAttemptKey(studentCode || "unknown", ip);
  const currentAttempt = loginAttempts.get(attemptKey);

  if (currentAttempt?.lockedUntil && currentAttempt.lockedUntil > Date.now()) {
    return NextResponse.json(
      { ok: false, message: "تم إيقاف المحاولة مؤقتًا. حاول لاحقًا." },
      { status: 429 }
    );
  }

  if (!studentCode || !studentPassword) {
    return NextResponse.json(
      { ok: false, message: "كود الطالب وكلمة المرور مطلوبان." },
      { status: 400 }
    );
  }

  let db;
  try {
    db = getAdminDb();
  } catch {
    return NextResponse.json(
      {
        ok: false,
        message:
          "إعدادات Firebase Admin غير مكتملة. تأكد من قيم البيئة المطلوبة.",
      },
      { status: 500 }
    );
  }

  let record: Record<string, unknown> | null = null;
  const directDoc = await db.collection("users").doc(studentCode).get();
  if (directDoc.exists) {
    record = directDoc.data() as Record<string, unknown>;
  } else {
    const snapshot = await db
      .collection("users")
      .where("code", "==", studentCode)
      .limit(1)
      .get();
    if (!snapshot.empty) {
      record = snapshot.docs[0].data() as Record<string, unknown>;
    }
  }

  if (!record) {
    const failed = loginAttempts.get(attemptKey);
    const nextCount = (failed?.count ?? 0) + 1;
    loginAttempts.set(attemptKey, {
      count: nextCount,
      lockedUntil: nextCount >= LOGIN_MAX_ATTEMPTS ? Date.now() + LOGIN_LOCK_MS : 0,
    });
    return NextResponse.json(
      { ok: false, message: "البيانات خاطئة." },
      { status: 401 }
    );
  }
  const storedPassword = normalizeValue(record.startupPassword).replace(/\s+/g, "");
  const storedHash = String(record.passwordHash ?? "").trim();

  if (!storedPassword && !storedHash) {
    return NextResponse.json(
      {
        ok: false,
        message: "هذا المستخدم لا يحتوي على كلمة مرور.",
      },
      { status: 400 }
    );
  }

  let passwordOk = false;
  if (storedHash) {
    passwordOk = await verifyPassword(studentPassword, storedHash);
  } else if (storedPassword) {
    passwordOk = storedPassword === studentPassword;
  }

  if (!passwordOk) {
    const failed = loginAttempts.get(attemptKey);
    const nextCount = (failed?.count ?? 0) + 1;
    loginAttempts.set(attemptKey, {
      count: nextCount,
      lockedUntil: nextCount >= LOGIN_MAX_ATTEMPTS ? Date.now() + LOGIN_LOCK_MS : 0,
    });
    return NextResponse.json(
      { ok: false, message: "البيانات خاطئة." },
      { status: 401 }
    );
  }

  if (!storedHash && storedPassword) {
    try {
      const nextHash = await hashPassword(storedPassword);
      await db
        .collection("users")
        .doc(studentCode)
        .update({
          passwordHash: nextHash,
          startupPassword: "",
          updatedAt: new Date().toISOString(),
        });
    } catch {
      // ignore migration failure
    }
  }

  const role = mapRole(record.role);
  if (!role) {
    return NextResponse.json(
      { ok: false, message: "الدور غير معروف داخل قاعدة البيانات." },
      { status: 400 }
    );
  }

  const name = String(record.name ?? "").trim();
  const mustChangePassword = Boolean(record.mustChangePassword ?? false);
  const classId = Array.isArray(record.classes) && record.classes.length
    ? String(record.classes[0] ?? "")
    : "";
  const isGirlsClass = classId.toUpperCase().endsWith("G");
  const preferredMass = String(record.preferredMass ?? "").trim();
  const preferredService = String(record.preferredService ?? "").trim();
  const currentRank = String(record.currentRank ?? "").trim();
  const lastServiceType = String(record.lastServiceType ?? "").trim();
  const ordinationDate = String(record.ordinationDate ?? "").trim();
  const ordinationChurch = String(record.ordinationChurch ?? "").trim();
  const ordainedBy = String(record.ordainedBy ?? "").trim();
  const lastServiceDate = String(record.lastServiceDate ?? "").trim();
  const civilId = String(record.civilId ?? "").trim();
  const civilCardPhoto = String(record.civilCardPhoto ?? "").trim();
  const isBoysClass = classId.toUpperCase().endsWith("B");
  const needsServicePref =
    role === "student" &&
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

  const response = NextResponse.json({
    ok: true,
    data: {
      studentCode,
      role,
      name,
      mustChangePassword,
      needsServicePref,
    },
  });
  const sessionPayload = Buffer.from(
    JSON.stringify({ code: studentCode, role, mustChangePassword, needsServicePref, iat: Date.now() })
  ).toString("base64url");
  response.cookies.set("dsms_session", sessionPayload, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  response.cookies.set("dsms_last_path", encodeURIComponent(`/portal/${role}`), {
    httpOnly: false,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  loginAttempts.delete(attemptKey);
  return response;
}
