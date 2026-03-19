import { NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";
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
  email?: string;
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
  email?: string;
  rejectReason?: string;
};

type RequestDeletePayload = {
  actorCode?: string;
  actorRole?: string;
  requestId?: string;
};

function normalizeRole(value: string) {
  return value === "nzam" ? "system" : value;
}

function splitChunks<T>(arr: T[], size: number) {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

async function notifyAdmins(title: string, body: string, data: Record<string, string> = {}) {
  const db = getAdminDb();
  await db.collection("notifications").add({
    title,
    body,
    createdAt: Timestamp.now(),
    createdBy: { name: "نظام الحسابات", code: "system", role: "system" },
    audience: { type: "role", role: "admin" },
    data,
  });

  const tokensSnap = await db.collection("pushTokens").where("role", "==", "admin").get();
  const tokens = tokensSnap.docs
    .map((doc) => (doc.data() as { token?: string }).token)
    .filter(Boolean) as string[];

  if (!tokens.length) return;
  const messaging = getMessaging();
  for (const chunk of splitChunks(tokens, 500)) {
    await messaging.sendEachForMulticast({
      tokens: chunk,
      notification: { title, body },
      data,
    });
  }
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

async function sendApprovalEmail(
  to: string,
  name: string,
  code: string,
  startupPassword: string
) {
  const apiKey = String(process.env.RESEND_API_KEY ?? "").trim();
  const from = String(process.env.RESEND_FROM_EMAIL ?? "onboarding@resend.dev").trim();
  if (!apiKey) {
    return { ok: false, message: "RESEND_API_KEY غير مضبوط." };
  }

  const subject = "تم قبول طلب إنشاء الحساب";
  const html = `
    <div dir="rtl" style="font-family: Tahoma, Arial, sans-serif; line-height:1.8">
      <h3>مدرسة الشمامسة</h3>
      <p>مرحباً ${name || "بك"}،</p>
      <p>تم قبول طلب إنشاء حسابك بنجاح.</p>
      <p><strong>كود المستخدم:</strong> ${code}</p>
      <p><strong>كلمة المرور المبدئية:</strong> ${startupPassword}</p>
      <p>يمكنك الآن تسجيل الدخول من التطبيق او الموقع الالكتروني.</p>
    </div>
  `;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject,
      html,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    return { ok: false, message: `فشل إرسال البريد: ${text || res.status}` };
  }
  return { ok: true };
}

async function sendRejectionEmail(to: string, name: string, reason: string) {
  const apiKey = String(process.env.RESEND_API_KEY ?? "").trim();
  const from = String(process.env.RESEND_FROM_EMAIL ?? "onboarding@resend.dev").trim();
  if (!apiKey) {
    return { ok: false, message: "RESEND_API_KEY غير مضبوط." };
  }

  const subject = "تم رفض طلب إنشاء الحساب";
  const reasonBlock = reason ? `<p><strong>سبب الرفض:</strong> ${reason}</p>` : "";
  const html = `
    <div dir="rtl" style="font-family: Tahoma, Arial, sans-serif; line-height:1.8">
      <h3>مدرسة الشمامسة</h3>
      <p>مرحباً ${name || "بك"}،</p>
      <p>تم رفض طلب إنشاء الحساب.</p>
      ${reasonBlock}
      <p>يمكنك تقديم طلب جديد بعد التعديل.</p>
    </div>
  `;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject,
      html,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    return { ok: false, message: `فشل إرسال البريد: ${text || res.status}` };
  }
  return { ok: true };
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
    const email = String(body.email ?? "").trim().toLowerCase();
    const role = mapRole(body.role ?? "");
    const classId = String(body.classId ?? "").trim();

    if (!name || !code || !startupPassword || !role || !email) {
      return NextResponse.json(
        { ok: false, message: "الاسم والكود والدور والباسورد المبدأي والإيميل مطلوبة." },
        { status: 400 }
      );
    }
    if (!isValidEmail(email)) {
      return NextResponse.json({ ok: false, message: "صيغة الإيميل غير صحيحة." }, { status: 400 });
    }

    if (!["admin", "notes", "katamars"].includes(role) && !classId) {
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
      classId: ["admin", "notes", "katamars"].includes(role) ? "" : classId,
      email,
      startupPassword,
      passwordHash,
      status: "pending",
      createdAt: new Date().toISOString(),
    });

    try {
      const title = "طلب حساب جديد";
      const bodyText = `تم استلام طلب حساب جديد باسم ${name} (${role}).`;
      await notifyAdmins(title, bodyText, { type: "account_request", code });
    } catch (notifyError) {
      console.error("Account request notification failed:", notifyError);
    }

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
          email?: string;
          startupPassword?: string;
          rejectReason?: string;
          status?: string;
          createdAt?: string;
          reviewedAt?: string;
        };
        return {
          id: doc.id,
          name: item.name ?? "",
          code: item.code ?? "",
          role: item.role ?? "",
          classId: item.classId ?? "",
          email: item.email ?? "",
          startupPassword: item.startupPassword ?? "",
          rejectReason: item.rejectReason ?? "",
          status: item.status ?? "pending",
          createdAt: item.createdAt ?? "",
          reviewedAt: item.reviewedAt ?? "",
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
      email?: string;
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
    const rejectReason = String(body.rejectReason ?? "").trim();
    const email = String(body.email ?? existing.email ?? "").trim().toLowerCase();
    const role = mapRole(body.role ?? existing.role ?? "");
    const classId = String(body.classId ?? existing.classId ?? "").trim();

    if (!name || !code || !role || !email) {
      return NextResponse.json(
        { ok: false, message: "بيانات الطلب غير مكتملة." },
        { status: 400 }
      );
    }
    if (!isValidEmail(email)) {
      return NextResponse.json({ ok: false, message: "صيغة الإيميل غير صحيحة." }, { status: 400 });
    }
    const legacyPassword = String(existing.startupPassword ?? "").trim();
    if (action !== "reject" && !existing.passwordHash && !legacyPassword && !startupPassword) {
      return NextResponse.json(
        { ok: false, message: "الباسورد المبدأي مطلوب." },
        { status: 400 }
      );
    }
    if (!["admin", "notes", "katamars"].includes(role) && !classId) {
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
        classId: ["admin", "notes", "katamars"].includes(role) ? "" : classId,
        email,
        startupPassword: startupPassword || legacyPassword || "",
        passwordHash: nextHash,
        updatedAt: new Date().toISOString(),
      });
      return NextResponse.json({ ok: true, message: "تم تحديث الطلب." });
    }

    if (action === "reject") {
      const emailResult = await sendRejectionEmail(email, name, rejectReason);
      if (!emailResult.ok) {
        return NextResponse.json(
          { ok: false, message: emailResult.message || "تعذر إرسال إيميل الرفض." },
          { status: 500 }
        );
      }
      await reqRef.update({
        status: "rejected",
        reviewedAt: new Date().toISOString(),
        reviewedBy: actorCode,
        rejectReason,
        rejectionEmailSentAt: new Date().toISOString(),
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
    const finalStartupPassword = startupPassword || legacyPassword;

    if (!finalStartupPassword) {
      return NextResponse.json(
        { ok: false, message: "اكتب الباسورد المبدأي لإرساله في إيميل القبول." },
        { status: 400 }
      );
    }

    const emailResult = await sendApprovalEmail(email, name, code, finalStartupPassword);
    if (!emailResult.ok) {
      return NextResponse.json(
        { ok: false, message: emailResult.message || "تعذر إرسال الإيميل." },
        { status: 500 }
      );
    }

    await userRef.set({
      code,
      name,
      role,
      startupPassword: "",
      passwordHash: finalHash,
      mustChangePassword: true,
      classes: ["admin", "notes", "katamars"].includes(role) ? [] : [classId],
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
      classId: ["admin", "notes", "katamars"].includes(role) ? "" : classId,
      email: "",
      emailSentAt: new Date().toISOString(),
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

export async function DELETE(request: Request) {
  try {
    const body = (await request.json()) as RequestDeletePayload;
    const actorCode = String(body.actorCode ?? "").trim();
    const actorRole = String(body.actorRole ?? "").trim().toLowerCase();
    const requestId = String(body.requestId ?? "").trim();

    if (!actorCode || !actorRole || !requestId) {
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
    const ref = db.collection("account_requests").doc(requestId);
    const snap = await ref.get();
    if (!snap.exists) {
      return NextResponse.json(
        { ok: false, message: "الطلب غير موجود." },
        { status: 404 }
      );
    }

    await ref.delete();
    return NextResponse.json({ ok: true, message: "تم حذف السجل." });
  } catch (error) {
    console.error("DELETE /api/account-requests error:", error);
    return NextResponse.json(
      { ok: false, message: "Failed to delete request record." },
      { status: 500 }
    );
  }
}
