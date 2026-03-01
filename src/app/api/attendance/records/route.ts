import { NextResponse } from "next/server";
import { getMessaging } from "firebase-admin/messaging";
import { getAdminDb } from "@/lib/firebase/admin";

export const runtime = "nodejs";

type SessionPayload = { code?: string; role?: string };

type SavePayload = {
  actorCode?: string;
  actorRole?: string;
  date?: string;
  classId?: string;
  entries?: Array<{ code?: string; status?: "present" | "absent" }>;
};

type ClearPayload = {
  actorCode?: string;
  actorRole?: string;
  date?: string;
  classId?: string;
};

function decodeSessionFromCookie(request: Request) {
  const cookieHeader = request.headers.get("cookie") ?? "";
  const pairs = cookieHeader.split(";").map((v) => v.trim());
  const sessionPair = pairs.find((p) => p.startsWith("dsms_session="));
  if (!sessionPair) return null;
  const encoded = sessionPair.slice("dsms_session=".length);
  try {
    const decoded = Buffer.from(encoded, "base64url").toString("utf8");
    const parsed = JSON.parse(decoded) as SessionPayload;
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

function isSessionActorMatch(request: Request, actorCode: string, actorRole: string) {
  const session = decodeSessionFromCookie(request);
  if (!session?.code || !session?.role) return false;
  return session.code === actorCode && normalizeRole(session.role) === normalizeRole(actorRole);
}

async function getActorUser(actorCode: string) {
  const db = getAdminDb();
  const doc = await db.collection("users").doc(actorCode).get();
  if (!doc.exists) return null;
  const data = doc.data() as { role?: string; classes?: string[] };
  return {
    role: normalizeRole(String(data.role ?? "").trim().toLowerCase()),
    classes: Array.isArray(data.classes) ? data.classes : [],
  };
}

function isIsoDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function splitChunks<T>(arr: T[], size: number) {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

async function resolveClassIdForActor(
  actorCode: string,
  actorRole: string,
  requestedClassId: string
) {
  const user = await getActorUser(actorCode);
  if (!user) return { ok: false as const, message: "User not found." };

  if (user.role === "admin") {
    if (!requestedClassId) {
      return { ok: false as const, message: "Class is required for admin." };
    }
    return { ok: true as const, classId: requestedClassId };
  }

  if (normalizeRole(actorRole) === "teacher" && user.role === "teacher") {
    if (!requestedClassId) {
      return { ok: false as const, message: "Class is required for teacher." };
    }
    if (!user.classes.includes(requestedClassId)) {
      return { ok: false as const, message: "Not allowed." };
    }
    return { ok: true as const, classId: requestedClassId };
  }

  if (normalizeRole(actorRole) !== "system" || user.role !== "system") {
    return { ok: false as const, message: "Not allowed." };
  }
  if (!user.classes.length) {
    return { ok: false as const, message: "لا يوجد فصل مرتبط بحساب خادم النظام." };
  }

  // System servant is always bound to his own class.
  return { ok: true as const, classId: user.classes[0] };
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const actorCode = String(searchParams.get("actorCode") ?? "").trim();
    const actorRole = String(searchParams.get("actorRole") ?? "").trim().toLowerCase();
    const date = String(searchParams.get("date") ?? "").trim();
    const requestedClassId = String(searchParams.get("classId") ?? "").trim();

    if (!actorCode || !actorRole || !date) {
      return NextResponse.json({ ok: false, message: "Missing required fields." }, { status: 400 });
    }
    if (!isIsoDate(date)) {
      return NextResponse.json({ ok: false, message: "Invalid date." }, { status: 400 });
    }
    if (!isSessionActorMatch(request, actorCode, actorRole)) {
      return NextResponse.json({ ok: false, message: "Session mismatch." }, { status: 401 });
    }

    const classRes = await resolveClassIdForActor(actorCode, actorRole, requestedClassId);
    if (!classRes.ok) {
      return NextResponse.json({ ok: false, message: classRes.message }, { status: 403 });
    }
    const classId = classRes.classId;

    const db = getAdminDb();
    const studentsSnapshot = await db
      .collection("users")
      .where("role", "==", "student")
      .where("classes", "array-contains", classId)
      .get();

    const students = studentsSnapshot.docs
      .map((doc) => {
        const data = doc.data() as { code?: string; name?: string };
        return {
          code: String(data.code ?? doc.id),
          name: String(data.name ?? ""),
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name, "ar"));

    const attendanceSnapshot = await db
      .collection("attendance")
      .where("classId", "==", classId)
      .where("date", "==", date)
      .get();

    const attendanceMap: Record<string, "present" | "absent"> = {};
    for (const doc of attendanceSnapshot.docs) {
      const data = doc.data() as { code?: string; status?: string };
      const code = String(data.code ?? "").trim();
      const status = String(data.status ?? "").trim().toLowerCase();
      if (!code) continue;
      if (status === "present" || status === "absent") {
        attendanceMap[code] = status;
      }
    }

    return NextResponse.json({
      ok: true,
      data: { classId, date, students, attendance: attendanceMap },
    });
  } catch (error) {
    console.error("GET /api/attendance/records error:", error);
    return NextResponse.json({ ok: false, message: "Failed to load attendance." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as SavePayload;
    const actorCode = String(body.actorCode ?? "").trim();
    const actorRole = String(body.actorRole ?? "").trim().toLowerCase();
    const date = String(body.date ?? "").trim();
    const requestedClassId = String(body.classId ?? "").trim();
    const entries = Array.isArray(body.entries) ? body.entries : [];

    if (!actorCode || !actorRole || !date || !entries.length) {
      return NextResponse.json({ ok: false, message: "Missing required fields." }, { status: 400 });
    }
    if (!isIsoDate(date)) {
      return NextResponse.json({ ok: false, message: "Invalid date." }, { status: 400 });
    }
    if (!isSessionActorMatch(request, actorCode, actorRole)) {
      return NextResponse.json({ ok: false, message: "Session mismatch." }, { status: 401 });
    }

    const classRes = await resolveClassIdForActor(actorCode, actorRole, requestedClassId);
    if (!classRes.ok) {
      return NextResponse.json({ ok: false, message: classRes.message }, { status: 403 });
    }
    const classId = classRes.classId;

    const db = getAdminDb();
    const validEntries = entries
      .map((item) => ({
        code: String(item.code ?? "").trim(),
        status: String(item.status ?? "").trim().toLowerCase(),
      }))
      .filter(
        (item): item is { code: string; status: "present" | "absent" } =>
          Boolean(item.code) && (item.status === "present" || item.status === "absent")
      );

    if (!validEntries.length) {
      return NextResponse.json({ ok: false, message: "No valid entries." }, { status: 400 });
    }

    let batch = db.batch();
    let counter = 0;
    for (const entry of validEntries) {
      const docId = `${classId}_${date}_${entry.code}`;
      const ref = db.collection("attendance").doc(docId);
      batch.set(ref, {
        code: entry.code,
        classId,
        date,
        status: entry.status,
        recordedBy: actorCode,
        recordedAt: new Date().toISOString(),
      });
      counter += 1;
      if (counter >= 350) {
        await batch.commit();
        batch = db.batch();
        counter = 0;
      }
    }
    if (counter > 0) {
      await batch.commit();
    }

    // When system servant saves attendance, notify absent student + parent accounts.
    if (normalizeRole(actorRole) === "system") {
      try {
        const absentEntries = validEntries.filter((entry) => entry.status === "absent");
        if (absentEntries.length) {
          const absentCodes = absentEntries.map((entry) => entry.code);
          const targetUserCodes = new Set<string>();
          const absentStudentInfo = new Map<string, { name: string; classId: string; parentCodes: string[] }>();

          for (const studentCode of absentCodes) {
            const studentDoc = await db.collection("users").doc(studentCode).get();
            if (!studentDoc.exists) continue;
            const student = studentDoc.data() as { name?: string; classes?: string[]; parentCodes?: string[] };
            const parentCodes = Array.isArray(student.parentCodes)
              ? student.parentCodes.map((code) => String(code).trim()).filter(Boolean)
              : [];
            absentStudentInfo.set(studentCode, {
              name: String(student.name ?? ""),
              classId:
                Array.isArray(student.classes) && student.classes.length
                  ? String(student.classes[0] ?? classId)
                  : classId,
              parentCodes,
            });
            targetUserCodes.add(studentCode);
            for (const parentCode of parentCodes) {
              targetUserCodes.add(parentCode);
            }
          }

          const recipientCodes = Array.from(targetUserCodes).filter(Boolean);
          const tokenSet = new Set<string>();

          for (const codesChunk of splitChunks(recipientCodes, 10)) {
            const tokensSnap = await db
              .collection("pushTokens")
              .where("userCode", "in", codesChunk)
              .get();
            for (const doc of tokensSnap.docs) {
              const token = String((doc.data() as { token?: string }).token ?? "").trim();
              if (token) tokenSet.add(token);
            }
          }

          const allTokens = Array.from(tokenSet);
          if (allTokens.length) {
            const details = absentCodes
              .map((studentCode) => {
                const item = absentStudentInfo.get(studentCode);
                if (!item) return "";
                const isGirl = item.classId.toUpperCase().endsWith("G");
                return `${isGirl ? "الطالبة" : "الطالب"} ${item.name || studentCode}`;
              })
              .filter(Boolean)
              .join("، ");

            const title = "تسجيل غياب";
            const body =
              absentCodes.length === 1
                ? `تم تسجيل غياب ${details} بتاريخ ${date}.`
                : `تم تسجيل غياب ${absentCodes.length} طلاب بتاريخ ${date}.`;

            const messaging = getMessaging();
            for (const tokenChunk of splitChunks(allTokens, 500)) {
              await messaging.sendEachForMulticast({
                tokens: tokenChunk,
                notification: { title, body },
                data: {
                  type: "attendance_absence",
                  classId,
                  date,
                },
              });
            }
          }
        }
      } catch (pushError) {
        console.error("Attendance absence push failed:", pushError);
      }
    }

    return NextResponse.json({
      ok: true,
      data: { classId, date, saved: validEntries.length },
    });
  } catch (error) {
    console.error("POST /api/attendance/records error:", error);
    return NextResponse.json({ ok: false, message: "Failed to save attendance." }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const body = (await request.json()) as ClearPayload;
    const actorCode = String(body.actorCode ?? "").trim();
    const actorRole = String(body.actorRole ?? "").trim().toLowerCase();
    const date = String(body.date ?? "").trim();
    const requestedClassId = String(body.classId ?? "").trim();

    if (!actorCode || !actorRole || !date) {
      return NextResponse.json({ ok: false, message: "Missing required fields." }, { status: 400 });
    }
    if (!isIsoDate(date)) {
      return NextResponse.json({ ok: false, message: "Invalid date." }, { status: 400 });
    }
    if (!isSessionActorMatch(request, actorCode, actorRole)) {
      return NextResponse.json({ ok: false, message: "Session mismatch." }, { status: 401 });
    }

    const classRes = await resolveClassIdForActor(actorCode, actorRole, requestedClassId);
    if (!classRes.ok) {
      return NextResponse.json({ ok: false, message: classRes.message }, { status: 403 });
    }
    const classId = classRes.classId;

    const db = getAdminDb();
    const snapshot = await db
      .collection("attendance")
      .where("classId", "==", classId)
      .where("date", "==", date)
      .get();

    if (snapshot.empty) {
      return NextResponse.json({ ok: true, data: { deleted: 0 } });
    }

    let batch = db.batch();
    let counter = 0;
    let deleted = 0;
    for (const doc of snapshot.docs) {
      batch.delete(doc.ref);
      counter += 1;
      deleted += 1;
      if (counter >= 400) {
        await batch.commit();
        batch = db.batch();
        counter = 0;
      }
    }
    if (counter > 0) {
      await batch.commit();
    }

    return NextResponse.json({ ok: true, data: { deleted } });
  } catch (error) {
    console.error("DELETE /api/attendance/records error:", error);
    return NextResponse.json({ ok: false, message: "Failed to clear attendance." }, { status: 500 });
  }
}
