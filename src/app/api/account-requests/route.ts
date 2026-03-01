import { NextResponse } from "next/server";
import { mapRole } from "@/lib/code-mapper";
import { getAdminDb } from "@/lib/firebase/admin";
import { hashPassword } from "@/lib/password";

export const runtime = "nodejs";

type AccountRequestPayload = {
  name?: string;
  code?: string;
  role?: string;
  classId?: string;
  startupPassword?: string;
};

type AdminQueryPayload = {
  actorCode?: string;
  actorRole?: string;
  status?: string;
};

type RequestActionPayload = {
  actorCode?: string;
  actorRole?: string;
  requestId?: string;
  action?: "approve" | "reject" | "update";
  name?: string;
  code?: string;
  role?: string;
  classId?: string;
  startupPassword?: string;
};

function normalizeRole(value: string) {
  return value === "nzam" ? "system" : value;
}

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
  return session.code === actorCode && normalizeRole(session.role) === normalizeRole(actorRole);
}

async function verifyAdminActor(actorCode: string, actorRole: string) {
  if (normalizeRole(actorRole) !== "admin") return false;
  const db = getAdminDb();
  const doc = await db.collection("users").doc(actorCode).get();
  if (!doc.exists) return false;
  const data = doc.data() as { role?: string };
  return normalizeRole(String(data.role ?? "").trim().toLowerCase()) === "admin";
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as AccountRequestPayload;
    const name = String(body.name ?? "").trim();
    const code = String(body.code ?? "").trim();
    const startupPassword = String(body.startupPassword ?? "").trim();
    const role = mapRole(body.role ?? "");
    const classId = String(body.classId ?? "").trim();

    if (!name || !code || !startupPassword || !role) {
      return NextResponse.json(
        { ok: false, message: "الاسم والكود والدور وكلمة المرور مطلوبة." },
        { status: 400 }
      );
    }

    if (!["admin", "notes"].includes(role) && !classId) {
      return NextResponse.json(
        { ok: false, message: "الفصل مطلوب لهذا الدور." },
        { status: 400 }
      );
    }

    const db = getAdminDb();
    const userDoc = await db.collection("users").doc(code).get();
    if (userDoc.exists) {
      return NextResponse.json(
        { ok: false, message: "هذا الكود مستخدم بالفعل." },
        { status: 409 }
      );
    }

    const pendingByCode = await db
      .collection("account_requests")
      .where("code", "==", code)
      .where("status", "==", "pending")
      .limit(1)
      .get();
    if (!pendingByCode.empty) {
      return NextResponse.json(
        { ok: false, message: "يوجد طلب معلق بنفس الكود." },
        { status: 409 }
      );
    }

    const passwordHash = await hashPassword(startupPassword);
    await db.collection("account_requests").add({
      name,
      code,
      role,
      classId: ["admin", "notes"].includes(role) ? "" : classId,
      startupPassword: "",
      passwordHash,
      status: "pending",
      createdAt: new Date().toISOString(),
    });

    return NextResponse.json({
      ok: true,
      message: "تم إرسال الطلب بنجاح.",
    });
  } catch (error) {
    console.error("POST /api/account-requests error:", error);
    return NextResponse.json(
      { ok: false, message: "فشل إرسال الطلب." },
      { status: 500 }
    );
  }
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const query = Object.fromEntries(searchParams.entries()) as AdminQueryPayload;
    const actorCode = String(query.actorCode ?? "").trim();
    const actorRole = String(query.actorRole ?? "").trim().toLowerCase();
    const status = String(query.status ?? "pending").trim().toLowerCase();

    if (!actorCode || !actorRole) {
      return NextResponse.json(
        { ok: false, message: "Missing actor info." },
        { status: 400 }
      );
    }
    if (!isSessionActorMatch(request, actorCode, actorRole)) {
      return NextResponse.json(
        { ok: false, message: "Session mismatch." },
        { status: 401 }
      );
    }
    const isAdmin = await verifyAdminActor(actorCode, actorRole);
    if (!isAdmin) {
      return NextResponse.json(
        { ok: false, message: "Not allowed." },
        { status: 403 }
      );
    }

    const db = getAdminDb();
    const snapshot = await db
      .collection("account_requests")
      .where("status", "==", status)
      .get();

    const data = snapshot.docs
      .map((doc) => {
        const item = doc.data() as {
          name?: string;
          code?: string;
          role?: string;
          classId?: string;
          status?: string;
          createdAt?: string;
        };
        return {
          id: doc.id,
          name: item.name ?? "",
          code: item.code ?? "",
          role: item.role ?? "",
          classId: item.classId ?? "",
          status: item.status ?? "pending",
          createdAt: item.createdAt ?? "",
        };
      })
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

    return NextResponse.json({
      ok: true,
      data,
      count: data.length,
    });
  } catch (error) {
    console.error("GET /api/account-requests error:", error);
    return NextResponse.json(
      { ok: false, message: "Failed to load requests." },
      { status: 500 }
    );
  }
}

export async function PATCH(request: Request) {
  try {
    const body = (await request.json()) as RequestActionPayload;
    const actorCode = String(body.actorCode ?? "").trim();
    const actorRole = String(body.actorRole ?? "").trim().toLowerCase();
    const requestId = String(body.requestId ?? "").trim();
    const action = body.action;

    if (!actorCode || !actorRole || !requestId || !action) {
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
    const isAdmin = await verifyAdminActor(actorCode, actorRole);
    if (!isAdmin) {
      return NextResponse.json(
        { ok: false, message: "Not allowed." },
        { status: 403 }
      );
    }

    const db = getAdminDb();
    const reqRef = db.collection("account_requests").doc(requestId);
    const reqDoc = await reqRef.get();
    if (!reqDoc.exists) {
      return NextResponse.json(
        { ok: false, message: "الطلب غير موجود." },
        { status: 404 }
      );
    }

    const existing = reqDoc.data() as {
      name?: string;
      code?: string;
      role?: string;
      classId?: string;
      startupPassword?: string;
      passwordHash?: string;
      status?: string;
    };
    if ((existing.status ?? "").toLowerCase() !== "pending") {
      return NextResponse.json(
        { ok: false, message: "الطلب ليس معلقًا." },
        { status: 400 }
      );
    }

    const name = String(body.name ?? existing.name ?? "").trim();
    const code = String(body.code ?? existing.code ?? "").trim();
    const startupPassword = String(body.startupPassword ?? "").trim();
    const role = mapRole(body.role ?? existing.role ?? "");
    const classId = String(body.classId ?? existing.classId ?? "").trim();

    if (!name || !code || !role) {
      return NextResponse.json(
        { ok: false, message: "بيانات الطلب غير مكتملة." },
        { status: 400 }
      );
    }
    const legacyPassword = String(existing.startupPassword ?? "").trim();
    if (action !== "reject" && !existing.passwordHash && !legacyPassword && !startupPassword) {
      return NextResponse.json(
        { ok: false, message: "كلمة المرور مطلوبة." },
        { status: 400 }
      );
    }
    if (!["admin", "notes"].includes(role) && !classId) {
      return NextResponse.json(
        { ok: false, message: "الفصل مطلوب لهذا الدور." },
        { status: 400 }
      );
    }

    if (action === "update") {
      const nextHash = startupPassword
        ? await hashPassword(startupPassword)
        : existing.passwordHash ?? (legacyPassword ? await hashPassword(legacyPassword) : "");
      await reqRef.update({
        name,
        code,
        role,
        classId: ["admin", "notes"].includes(role) ? "" : classId,
        startupPassword: "",
        passwordHash: nextHash,
        updatedAt: new Date().toISOString(),
      });
      return NextResponse.json({ ok: true, message: "تم تحديث الطلب." });
    }

    if (action === "reject") {
      await reqRef.update({
        status: "rejected",
        reviewedAt: new Date().toISOString(),
        reviewedBy: actorCode,
      });
      return NextResponse.json({ ok: true, message: "تم رفض الطلب." });
    }

    const userRef = db.collection("users").doc(code);
    const exists = await userRef.get();
    if (exists.exists) {
      return NextResponse.json(
        { ok: false, message: "الكود مستخدم بالفعل." },
        { status: 409 }
      );
    }

    const finalHash = startupPassword
      ? await hashPassword(startupPassword)
      : existing.passwordHash ?? (legacyPassword ? await hashPassword(legacyPassword) : "");
    await userRef.set({
      code,
      name,
      role,
      startupPassword: "",
      passwordHash: finalHash,
      mustChangePassword: true,
      classes: ["admin", "notes"].includes(role) ? [] : [classId],
      parentCodes: [],
      createdAt: new Date().toISOString(),
    });

    await reqRef.update({
      status: "approved",
      reviewedAt: new Date().toISOString(),
      reviewedBy: actorCode,
      approvedUserCode: code,
      name,
      code,
      role,
      classId: ["admin", "notes"].includes(role) ? "" : classId,
      startupPassword: "",
      passwordHash: finalHash,
    });

    return NextResponse.json({
      ok: true,
      message: "تم قبول الطلب وإنشاء الحساب.",
    });
  } catch (error) {
    console.error("PATCH /api/account-requests error:", error);
    return NextResponse.json(
      { ok: false, message: "Failed to process request." },
      { status: 500 }
    );
  }
}
