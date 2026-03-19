import { NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";
import { getAdminDb } from "@/lib/firebase/admin";

export const runtime = "nodejs";

type SessionPayload = { code?: string; role?: string } | null;

function decodeSessionFromCookie(request: Request): SessionPayload {
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

function classBase(value: string) {
  const normalized = normalizeClassId(value);
  return normalized.replace(/[BG]$/i, "");
}

function classMatches(userClassValue: string, homeworkClassValue: string) {
  const userClass = normalizeClassId(userClassValue);
  const hwClass = normalizeClassId(homeworkClassValue);
  if (!userClass || !hwClass) return false;
  if (userClass === hwClass) return true;
  return classBase(userClass) === classBase(hwClass);
}

function normalizeStringList(value: unknown, upper = false) {
  const toList = (input: string) =>
    input
      .split(/[,،]/)
      .map((v) => String(v).trim())
      .filter(Boolean);
  const raw = Array.isArray(value)
    ? value.map((v) => String(v))
    : typeof value === "string"
      ? toList(value)
      : [];
  return raw.map((v) => (upper ? normalizeClassId(v) : String(v).trim())).filter(Boolean);
}

function splitChunks<T>(arr: T[], size: number) {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

async function resolveParentCodes(db: ReturnType<typeof getAdminDb>, studentCode: string) {
  const parentCodeSet = new Set<string>();
  const studentDoc = await db.collection("users").doc(studentCode).get();
  if (studentDoc.exists) {
    const student = studentDoc.data() as { parentCodes?: string[] };
    const directParents = Array.isArray(student.parentCodes)
      ? student.parentCodes.map((code) => String(code).trim()).filter(Boolean)
      : [];
    directParents.forEach((code) => parentCodeSet.add(code));
  }

  if (!parentCodeSet.size) {
    const parentSnapshot = await db
      .collection("users")
      .where("role", "==", "parent")
      .where("childrenCodes", "array-contains", studentCode)
      .get();
    for (const parentDoc of parentSnapshot.docs) {
      parentCodeSet.add(parentDoc.id);
    }
  }

  return Array.from(parentCodeSet);
}

async function notifyUsers(
  db: ReturnType<typeof getAdminDb>,
  userCodes: string[],
  title: string,
  body: string,
  data: Record<string, string>,
) {
  if (!userCodes.length) return;

  await db.collection("notifications").add({
    title,
    body,
    createdAt: Timestamp.now(),
    createdBy: { name: "نظام الواجبات", code: "system", role: "system" },
    audience: { type: "users", userCodes },
    data,
  });

  const tokenSet = new Set<string>();
  for (const codesChunk of splitChunks(userCodes, 10)) {
    const tokensSnapshot = await db
      .collection("pushTokens")
      .where("userCode", "in", codesChunk)
      .get();
    for (const tokenDoc of tokensSnapshot.docs) {
      const token = String((tokenDoc.data() as { token?: string }).token ?? "").trim();
      if (token) tokenSet.add(token);
    }
  }
  const tokens = Array.from(tokenSet);
  if (!tokens.length) return;

  const messaging = getMessaging();
  for (const tokenChunk of splitChunks(tokens, 500)) {
    await messaging.sendEachForMulticast({
      tokens: tokenChunk,
      notification: { title, body },
      data,
    });
  }
}

async function resolveHomeworkClassIds(raw: Record<string, unknown>) {
  const classIds: string[] = [];
  if (Array.isArray(raw.classIds)) {
    classIds.push(
      ...raw.classIds.map((c) => normalizeClassId(String(c ?? ""))).filter(Boolean),
    );
  }
  if (raw.classId !== undefined && raw.classId !== null) {
    classIds.push(normalizeClassId(String(raw.classId)));
  }
  if (raw.class !== undefined && raw.class !== null) {
    classIds.push(normalizeClassId(String(raw.class)));
  }
  return classIds.filter(Boolean);
}

export async function POST(request: Request) {
  try {
    const session = decodeSessionFromCookie(request);
    const actorCode = String(session?.code ?? "").trim();
    const actorRole = normalizeRole(String(session?.role ?? "").trim().toLowerCase());
    if (!actorCode || !actorRole || !["admin", "system"].includes(actorRole)) {
      return NextResponse.json({ ok: false, message: "Unauthorized." }, { status: 401 });
    }

    const db = getAdminDb();
    const now = Date.now();
    const in24h = now + 24 * 60 * 60 * 1000;
    const snapshot = await db.collection("homeworks").limit(500).get();

    let sent24h = 0;
    let sentOverdue = 0;

    for (const doc of snapshot.docs) {
      const data = doc.data() as Record<string, unknown>;
      const dueAt = String(data.dueAt ?? "").trim();
      if (!dueAt) continue;

      const dueTime = new Date(dueAt).getTime();
      if (Number.isNaN(dueTime)) continue;

      const classIds = await resolveHomeworkClassIds(data);
      if (!classIds.length) continue;

      const reminder24hSentAt = String(data.reminder24hSentAt ?? "").trim();
      const overdueSentAt = String(data.overdueSentAt ?? "").trim();

      const shouldRemind24h = dueTime > now && dueTime <= in24h && !reminder24hSentAt;
      const shouldOverdue = dueTime <= now && !overdueSentAt;

      if (!shouldRemind24h && !shouldOverdue) continue;

      const submissionsSnap = await doc.ref.collection("submissions").get();
      const submittedCodes = new Set(
        submissionsSnap.docs
          .map((s) => String((s.data() as { studentCode?: string }).studentCode ?? "").trim())
          .filter(Boolean),
      );

      const targetCodes = new Set<string>();
      for (const classId of classIds) {
        const studentsSnap = await db
          .collection("users")
          .where("role", "==", "student")
          .where("classes", "array-contains", classId)
          .get();
        for (const studentDoc of studentsSnap.docs) {
          const student = studentDoc.data() as { code?: string };
          const studentCode = String(student.code ?? studentDoc.id).trim();
          if (!studentCode || submittedCodes.has(studentCode)) continue;
          targetCodes.add(studentCode);
          const parentCodes = await resolveParentCodes(db, studentCode);
          parentCodes.forEach((code) => targetCodes.add(code));
        }
      }

      const title = shouldOverdue ? "انتهاء موعد الواجب" : "تنبيه موعد الواجب";
      const body = shouldOverdue
        ? `انتهى موعد تسليم واجب: ${String(data.title ?? "واجب")}.`
        : `تبقى أقل من 24 ساعة على موعد تسليم واجب: ${String(data.title ?? "واجب")}.`;

      if (targetCodes.size) {
        await notifyUsers(
          db,
          Array.from(targetCodes),
          title,
          body,
          { type: shouldOverdue ? "homework_overdue" : "homework_due_24h", homeworkId: doc.id },
        );
      }

      if (shouldRemind24h) {
        await doc.ref.update({ reminder24hSentAt: new Date().toISOString() });
        sent24h += 1;
      }
      if (shouldOverdue) {
        await doc.ref.update({ overdueSentAt: new Date().toISOString() });
        sentOverdue += 1;
      }
    }

    return NextResponse.json({ ok: true, data: { sent24h, sentOverdue } });
  } catch (error) {
    console.error("POST /api/homework/reminders error:", error);
    return NextResponse.json(
      { ok: false, message: "Failed to send homework reminders." },
      { status: 500 }
    );
  }
}
