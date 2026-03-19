import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";

export const runtime = "nodejs";

type Session = { code: string; role: string } | null;

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

function normalizeRole(role: string) {
  return role === "nzam" ? "system" : role;
}

function isIsoDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isTime(value: string) {
  return /^\d{2}:\d{2}(:\d{2})?$/.test(value);
}

function normalizeTime(value: string) {
  const raw = String(value ?? "").trim();
  if (/^\d{2}:\d{2}(:\d{2})?$/.test(raw)) return raw.slice(0, 5);
  const twelve = raw.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!twelve) return "";
  let hour = Number(twelve[1]);
  const minute = twelve[2];
  const meridiem = twelve[3].toUpperCase();
  if (hour === 12) hour = 0;
  if (meridiem === "PM") hour += 12;
  return `${String(hour).padStart(2, "0")}:${minute}`;
}

async function loadActor(code: string) {
  const db = getAdminDb();
  const doc = await db.collection("users").doc(code).get();
  if (!doc.exists) return null;
  const data = doc.data() as { code?: string; name?: string; role?: string };
  return {
    code: String(data.code ?? code),
    name: String(data.name ?? ""),
    role: normalizeRole(String(data.role ?? "").trim().toLowerCase()),
  };
}

async function getActivePeriod() {
  const db = getAdminDb();
  const snapshot = await db.collection("service_periods").where("active", "==", true).limit(1).get();
  if (snapshot.empty) return null;
  const doc = snapshot.docs[0];
  const data = doc.data() as { name?: string; startDate?: string; endDate?: string };
  return {
    id: doc.id,
    name: String(data.name ?? ""),
    startDate: String(data.startDate ?? ""),
    endDate: String(data.endDate ?? ""),
  };
}

function buildDatesForDay(start: string, end: string, targetDay: number) {
  const result: string[] = [];
  if (!isIsoDate(start) || !isIsoDate(end)) return result;
  const cursor = new Date(`${start}T00:00:00`);
  const last = new Date(`${end}T00:00:00`);
  while (cursor <= last) {
    if (cursor.getDay() === targetDay) {
      const iso = cursor.toISOString().slice(0, 10);
      result.push(iso);
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return result;
}

export async function GET(request: Request) {
  try {
    const session = decodeSessionFromCookie(request);
    const actorCode = String(session?.code ?? "").trim();
    const actorRole = normalizeRole(String(session?.role ?? "").trim().toLowerCase());
    if (!actorCode || !actorRole) {
      return NextResponse.json({ ok: false, message: "Unauthorized." }, { status: 401 });
    }
    if (actorRole !== "admin") {
      return NextResponse.json({ ok: false, message: "Not allowed." }, { status: 403 });
    }

    const actor = await loadActor(actorCode);
    if (!actor || actor.role !== "admin") {
      return NextResponse.json({ ok: false, message: "Not allowed." }, { status: 403 });
    }

    const db = getAdminDb();
    const snapshot = await db.collection("class_weekly_schedule").get();
    const data = snapshot.docs.map((doc) => ({ classId: doc.id, ...(doc.data() as Record<string, unknown>) }));
    const period = await getActivePeriod();
    return NextResponse.json({ ok: true, data, meta: { period } });
  } catch (error) {
    console.error("GET /api/calendar-weekly error:", error);
    return NextResponse.json({ ok: false, message: "Failed to load weekly schedule." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = decodeSessionFromCookie(request);
    const actorCode = String(session?.code ?? "").trim();
    const actorRole = normalizeRole(String(session?.role ?? "").trim().toLowerCase());
    if (!actorCode || !actorRole) {
      return NextResponse.json({ ok: false, message: "Unauthorized." }, { status: 401 });
    }
    if (actorRole !== "admin") {
      return NextResponse.json({ ok: false, message: "Not allowed." }, { status: 403 });
    }

    const actor = await loadActor(actorCode);
    if (!actor || actor.role !== "admin") {
      return NextResponse.json({ ok: false, message: "Not allowed." }, { status: 403 });
    }

    const body = (await request.json()) as {
      classId?: string;
      classIds?: string[];
      dayOfWeek?: number;
      time?: string;
      endTime?: string;
      details?: string;
    };
    const classIds = Array.isArray(body.classIds)
      ? body.classIds.map((c) => String(c).trim()).filter(Boolean)
      : [];
    const classId = String(body.classId ?? "").trim();
    const targetClassIds = classIds.length ? classIds : classId ? [classId] : [];
    const dayOfWeek = typeof body.dayOfWeek === "number" ? body.dayOfWeek : -1;
    const time = normalizeTime(String(body.time ?? "").trim());
    const endTime = normalizeTime(String(body.endTime ?? "").trim());
    const details = String(body.details ?? "").trim();

    if (!targetClassIds.length) {
      return NextResponse.json({ ok: false, message: "Missing class." }, { status: 400 });
    }
    if (isTime(time) && isTime(endTime) && time >= endTime) {
      return NextResponse.json({ ok: false, message: "Invalid start/end time." }, { status: 400 });
    }

    const period = await getActivePeriod();
    if (!period) {
      return NextResponse.json({ ok: false, message: "لا توجد فترة فعالة." }, { status: 400 });
    }

    const db = getAdminDb();
    let totalCreated = 0;

    for (const classTargetId of targetClassIds) {
      const scheduleRef = db.collection("class_weekly_schedule").doc(classTargetId);

      if (dayOfWeek < 0 || !isTime(time) || !isTime(endTime)) {
        await scheduleRef.delete();
        const weeklySnapshot = await db
          .collection("calendar_events")
          .where("date", ">=", period.startDate)
          .where("date", "<=", period.endDate)
          .get();
        let batch = db.batch();
        let counter = 0;
        for (const doc of weeklySnapshot.docs) {
          const eventData = doc.data() as { type?: string; classIds?: string[] };
          if (String(eventData.type ?? "") !== "weekly") continue;
          const eventClassIds = Array.isArray(eventData.classIds) ? eventData.classIds : [];
          if (!eventClassIds.includes(classTargetId)) continue;
          batch.delete(doc.ref);
          counter += 1;
          if (counter >= 400) {
            await batch.commit();
            batch = db.batch();
            counter = 0;
          }
        }
        if (counter) await batch.commit();
        continue;
      }

      await scheduleRef.set({
        classId: classTargetId,
        dayOfWeek,
        time,
        endTime,
        details,
        updatedAt: new Date().toISOString(),
        updatedBy: actor.code,
      });

      const dates = buildDatesForDay(period.startDate, period.endDate, dayOfWeek);
      const weeklySnapshot = await db
        .collection("calendar_events")
        .where("date", ">=", period.startDate)
        .where("date", "<=", period.endDate)
        .get();
      let batch = db.batch();
      let counter = 0;
      for (const doc of weeklySnapshot.docs) {
        const eventData = doc.data() as { type?: string; classIds?: string[] };
        if (String(eventData.type ?? "") !== "weekly") continue;
        const eventClassIds = Array.isArray(eventData.classIds) ? eventData.classIds : [];
        if (!eventClassIds.includes(classTargetId)) continue;
        batch.delete(doc.ref);
        counter += 1;
        if (counter >= 400) {
          await batch.commit();
          batch = db.batch();
          counter = 0;
        }
      }
      if (counter) await batch.commit();

      let createBatch = db.batch();
      let createCounter = 0;
      for (const date of dates) {
        const ref = db.collection("calendar_events").doc();
        createBatch.set(ref, {
          title: "حصة أسبوعية",
          date,
          time,
          endTime,
          details,
          type: "weekly",
          classIds: [classTargetId],
          allSchool: false,
          createdBy: {
            code: actor.code,
            name: actor.name,
            role: actor.role,
          },
          createdAt: new Date().toISOString(),
        });
        createCounter += 1;
        totalCreated += 1;
        if (createCounter >= 400) {
          await createBatch.commit();
          createBatch = db.batch();
          createCounter = 0;
        }
      }
      if (createCounter) await createBatch.commit();
    }

    return NextResponse.json({ ok: true, data: { count: totalCreated, classes: targetClassIds.length } });
  } catch (error) {
    console.error("POST /api/calendar-weekly error:", error);
    return NextResponse.json({ ok: false, message: "Failed to save weekly schedule." }, { status: 500 });
  }
}
