import { NextResponse } from "next/server";
import { getMessaging } from "firebase-admin/messaging";
import { getAdminDb } from "@/lib/firebase/admin";

export const runtime = "nodejs";

type Session = { code: string; role: string } | null;
type CalendarEventDoc = {
  id: string;
  allSchool: boolean;
  classIds: string[];
  [key: string]: unknown;
};

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
  return /^\d{2}:\d{2}$/.test(value);
}

function enumerateDates(start: string, end: string) {
  const dates: string[] = [];
  const cursor = new Date(`${start}T00:00:00`);
  const limit = new Date(`${end}T00:00:00`);
  while (cursor <= limit) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}

function buildSeriesId() {
  return `series_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function splitChunks<T>(arr: T[], size: number) {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

async function loadUser(code: string) {
  const db = getAdminDb();
  const doc = await db.collection("users").doc(code).get();
  if (!doc.exists) return null;
  const data = doc.data() as {
    code?: string;
    name?: string;
    role?: string;
    classes?: string[];
    childrenCodes?: string[];
  };
  return {
    code: String(data.code ?? code),
    name: String(data.name ?? ""),
    role: normalizeRole(String(data.role ?? "").trim().toLowerCase()),
    classes: Array.isArray(data.classes) ? data.classes.map((c) => String(c).trim()).filter(Boolean) : [],
    childrenCodes: Array.isArray(data.childrenCodes)
      ? data.childrenCodes.map((c) => String(c).trim()).filter(Boolean)
      : [],
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

function clampRange(start: string, end: string, period: { startDate: string; endDate: string }) {
  const nextStart = start < period.startDate ? period.startDate : start;
  const nextEnd = end > period.endDate ? period.endDate : end;
  return { start: nextStart, end: nextEnd };
}

export async function GET(request: Request) {
  try {
    const session = decodeSessionFromCookie(request);
    const actorCode = String(session?.code ?? "").trim();
    const actorRole = normalizeRole(String(session?.role ?? "").trim().toLowerCase());
    if (!actorCode || !actorRole) {
      return NextResponse.json({ ok: false, message: "Unauthorized." }, { status: 401 });
    }

    const actor = await loadUser(actorCode);
    if (!actor || actor.role !== actorRole) {
      return NextResponse.json({ ok: false, message: "Session mismatch." }, { status: 401 });
    }

    const url = new URL(request.url);
    const start = String(url.searchParams.get("start") ?? "").trim();
    const end = String(url.searchParams.get("end") ?? "").trim();
    if (!isIsoDate(start) || !isIsoDate(end) || start > end) {
      return NextResponse.json({ ok: false, message: "Invalid date range." }, { status: 400 });
    }

    const period = await getActivePeriod();
    if (!period) {
      return NextResponse.json({ ok: false, message: "لا توجد فترة فعالة." }, { status: 400 });
    }
    const range = clampRange(start, end, period);

    const db = getAdminDb();
    const baseQuery = db
      .collection("calendar_events")
      .where("date", ">=", range.start)
      .where("date", "<=", range.end);

    const snapshot = await baseQuery.get();
    const allEvents: CalendarEventDoc[] = snapshot.docs.map((doc) => {
      const data = doc.data() as Record<string, unknown>;
      const classIds = Array.isArray(data.classIds)
        ? data.classIds.map((value) => String(value).trim()).filter(Boolean)
        : [];
      return {
        id: doc.id,
        ...data,
        allSchool: Boolean(data.allSchool),
        classIds,
      };
    });

    if (actorRole === "admin") {
      return NextResponse.json({ ok: true, data: allEvents, meta: { period } });
    }

    let classIds: string[] = [];
    if (actorRole === "parent") {
      const parentDoc = await db.collection("users").doc(actor.code).get();
      const parentData = parentDoc.data() as { childrenCodes?: string[] };
      const childrenCodes = Array.isArray(parentData?.childrenCodes)
        ? parentData.childrenCodes.map((c) => String(c).trim()).filter(Boolean)
        : [];
      if (childrenCodes.length) {
        const childSnapshots = await Promise.all(
          childrenCodes.map((code) => db.collection("users").doc(code).get())
        );
        const set = new Set<string>();
        for (const snap of childSnapshots) {
          if (!snap.exists) continue;
          const data = snap.data() as { classes?: string[] };
          const classes = Array.isArray(data.classes) ? data.classes : [];
          classes.forEach((c) => {
            const id = String(c).trim();
            if (id) set.add(id);
          });
        }
        classIds = Array.from(set);
      }
    } else {
      classIds = actor.classes ?? [];
    }

    if (!classIds.length) {
      const data = allEvents.filter((event) => Boolean(event.allSchool));
      return NextResponse.json({ ok: true, data, meta: { period } });
    }

    const allowed = new Set(classIds);
    const filtered = allEvents.filter((event) => {
      if (event.allSchool) return true;
      const ids = event.classIds;
      return ids.some((id) => allowed.has(id));
    });

    return NextResponse.json({ ok: true, data: filtered, meta: { period } });
  } catch (error) {
    console.error("GET /api/calendar-events error:", error);
    return NextResponse.json({ ok: false, message: "Failed to load events." }, { status: 500 });
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
    if (!["admin", "teacher"].includes(actorRole)) {
      return NextResponse.json({ ok: false, message: "Not allowed." }, { status: 403 });
    }

    const actor = await loadUser(actorCode);
    if (!actor || actor.role !== actorRole) {
      return NextResponse.json({ ok: false, message: "Session mismatch." }, { status: 401 });
    }

    const body = (await request.json()) as {
      title?: string;
      date?: string;
      dateFrom?: string;
      dateTo?: string;
      time?: string;
      endTime?: string;
      details?: string;
      type?: string;
      classIds?: string[];
      allSchool?: boolean;
    };

    const title = String(body.title ?? "").trim();
    const date = String(body.date ?? "").trim();
    const dateFrom = String(body.dateFrom ?? "").trim();
    const dateTo = String(body.dateTo ?? "").trim();
    const time = String(body.time ?? "").trim();
    const endTime = String(body.endTime ?? "").trim();
    const details = String(body.details ?? "").trim();
    const type = String(body.type ?? "").trim();
    const allSchool = Boolean(body.allSchool);
    const classIds = Array.isArray(body.classIds)
      ? body.classIds.map((c) => String(c).trim()).filter(Boolean)
      : [];

    if (!title || !time || !details || !type) {
      return NextResponse.json({ ok: false, message: "Missing fields." }, { status: 400 });
    }
    if (!isTime(time) || !isTime(endTime)) {
      return NextResponse.json({ ok: false, message: "Invalid date or time." }, { status: 400 });
    }
    if (time >= endTime) {
      return NextResponse.json({ ok: false, message: "End time must be after start time." }, { status: 400 });
    }
    const hasSingleDate = isIsoDate(date);
    const hasRange = isIsoDate(dateFrom) && isIsoDate(dateTo);
    if (!hasSingleDate && !hasRange) {
      return NextResponse.json({ ok: false, message: "Missing date or date range." }, { status: 400 });
    }
    if (hasRange && dateFrom > dateTo) {
      return NextResponse.json({ ok: false, message: "Invalid date range." }, { status: 400 });
    }
    if (!allSchool && !classIds.length) {
      return NextResponse.json({ ok: false, message: "Missing class selection." }, { status: 400 });
    }

    const period = await getActivePeriod();
    if (!period) {
      return NextResponse.json({ ok: false, message: "لا توجد فترة فعالة." }, { status: 400 });
    }
    const startDate = hasRange ? dateFrom : date;
    const endDate = hasRange ? dateTo : date;
    if (startDate < period.startDate || endDate > period.endDate) {
      return NextResponse.json({ ok: false, message: "التواريخ خارج الفترة الفعالة." }, { status: 400 });
    }

    if (actorRole === "teacher") {
      const teacherClasses = new Set(actor.classes ?? []);
      if (!allSchool) {
        const invalid = classIds.filter((c) => !teacherClasses.has(c));
        if (invalid.length) {
          return NextResponse.json({ ok: false, message: "لا يمكنك اختيار فصول خارج فصولك." }, { status: 403 });
        }
      }
      if (type !== "exam") {
        return NextResponse.json({ ok: false, message: "المعلم يمكنه إضافة الامتحانات فقط." }, { status: 403 });
      }
    }

    const db = getAdminDb();
    const dates = enumerateDates(startDate, endDate);
    const seriesId = dates.length > 1 ? buildSeriesId() : "";
    const createdIds: string[] = [];
    for (const eventDate of dates) {
      const ref = await db.collection("calendar_events").add({
        title,
        date: eventDate,
        time,
        endTime,
        details,
        type,
        classIds: allSchool ? [] : classIds,
        allSchool,
        createdBy: {
          code: actor.code,
          name: actor.name,
          role: actor.role,
        },
        seriesId,
        createdAt: new Date().toISOString(),
      });
      createdIds.push(ref.id);
    }

    try {
      const notifyTitle = "إضافة جديدة في التقويم";
      const rangeText = startDate === endDate ? startDate : `${startDate} - ${endDate}`;
      const notifyBody = `${title} | ${rangeText} | ${time} - ${endTime}`;
      const createdAt = new Date().toISOString();

      if (allSchool) {
        await db.collection("notifications").add({
          title: notifyTitle,
          body: notifyBody,
          createdAt,
          createdBy: {
            code: actor.code,
            name: actor.name,
            role: actor.role,
          },
          audience: { type: "all" },
          data: { type: "calendar_event", seriesId: seriesId || null },
        });

        const tokensSnapshot = await db.collection("pushTokens").get();
        const tokens = tokensSnapshot.docs
          .map((d) => (d.data() as { token?: string }).token)
          .filter(Boolean) as string[];
        if (tokens.length) {
          const messaging = getMessaging();
          for (const tokenChunk of splitChunks(tokens, 500)) {
            await messaging.sendEachForMulticast({
              tokens: tokenChunk,
              notification: { title: notifyTitle, body: notifyBody },
              data: { type: "calendar_event", seriesId: seriesId || "" },
            });
          }
        }
      } else if (classIds.length) {
        await Promise.all(
          classIds.map((cls) =>
            db.collection("notifications").add({
              title: notifyTitle,
              body: notifyBody,
              createdAt,
              createdBy: {
                code: actor.code,
                name: actor.name,
                role: actor.role,
              },
              audience: { type: "class", classId: cls, className: cls },
              data: { type: "calendar_event", classId: cls, seriesId: seriesId || null },
            })
          )
        );

        for (const clsChunk of splitChunks(classIds, 10)) {
          const tokensSnapshot = await db
            .collection("pushTokens")
            .where("classIds", "array-contains-any", clsChunk)
            .get();
          const tokens = tokensSnapshot.docs
            .map((d) => (d.data() as { token?: string }).token)
            .filter(Boolean) as string[];
          if (tokens.length) {
            const messaging = getMessaging();
            for (const tokenChunk of splitChunks(tokens, 500)) {
              await messaging.sendEachForMulticast({
                tokens: tokenChunk,
                notification: { title: notifyTitle, body: notifyBody },
                data: { type: "calendar_event", classIds: clsChunk.join(",") },
              });
            }
          }
        }
      }
    } catch (notifyError) {
      console.error("Calendar notification failed:", notifyError);
    }

    return NextResponse.json({
      ok: true,
      data: { ids: createdIds, count: createdIds.length, seriesId: seriesId || null },
    });
  } catch (error) {
    console.error("POST /api/calendar-events error:", error);
    return NextResponse.json({ ok: false, message: "Failed to create event." }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const session = decodeSessionFromCookie(request);
    const actorCode = String(session?.code ?? "").trim();
    const actorRole = normalizeRole(String(session?.role ?? "").trim().toLowerCase());
    if (!actorCode || !actorRole) {
      return NextResponse.json({ ok: false, message: "Unauthorized." }, { status: 401 });
    }
    if (!["admin", "teacher"].includes(actorRole)) {
      return NextResponse.json({ ok: false, message: "Not allowed." }, { status: 403 });
    }

    const actor = await loadUser(actorCode);
    if (!actor || actor.role !== actorRole) {
      return NextResponse.json({ ok: false, message: "Session mismatch." }, { status: 401 });
    }

    const body = (await request.json()) as {
      id?: string;
      title?: string;
      date?: string;
      time?: string;
      endTime?: string;
      details?: string;
      type?: string;
      classIds?: string[];
      allSchool?: boolean;
    };
    const id = String(body.id ?? "").trim();
    if (!id) {
      return NextResponse.json({ ok: false, message: "Missing event id." }, { status: 400 });
    }

    const db = getAdminDb();
    const ref = db.collection("calendar_events").doc(id);
    const doc = await ref.get();
    if (!doc.exists) {
      return NextResponse.json({ ok: false, message: "Event not found." }, { status: 404 });
    }
    const existing = doc.data() as {
      createdBy?: { code?: string; role?: string };
    };
    if (actorRole !== "admin" && String(existing.createdBy?.code ?? "") !== actor.code) {
      return NextResponse.json({ ok: false, message: "Not allowed." }, { status: 403 });
    }

    const updates: Record<string, unknown> = {};
    if (body.title) updates.title = String(body.title).trim();
    if (body.details) updates.details = String(body.details).trim();
    if (body.time && isTime(String(body.time))) updates.time = String(body.time).trim();
    if (body.endTime && isTime(String(body.endTime))) updates.endTime = String(body.endTime).trim();
    if (body.type) updates.type = String(body.type).trim();
    if (typeof body.allSchool === "boolean") updates.allSchool = Boolean(body.allSchool);
    if (Array.isArray(body.classIds)) {
      updates.classIds = body.classIds.map((c) => String(c).trim()).filter(Boolean);
    }
    if (body.date && isIsoDate(String(body.date))) {
      const date = String(body.date).trim();
      const period = await getActivePeriod();
      if (!period || date < period.startDate || date > period.endDate) {
        return NextResponse.json({ ok: false, message: "التاريخ خارج الفترة الفعالة." }, { status: 400 });
      }
      updates.date = date;
    }
    const startValue = String(updates.time ?? (doc.data() as { time?: string }).time ?? "").trim();
    const endValue = String(updates.endTime ?? (doc.data() as { endTime?: string }).endTime ?? "").trim();
    if (!isTime(startValue) || !isTime(endValue) || startValue >= endValue) {
      return NextResponse.json({ ok: false, message: "Invalid start/end time." }, { status: 400 });
    }

    updates.updatedAt = new Date().toISOString();
    await ref.update(updates);

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("PATCH /api/calendar-events error:", error);
    return NextResponse.json({ ok: false, message: "Failed to update event." }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const session = decodeSessionFromCookie(request);
    const actorCode = String(session?.code ?? "").trim();
    const actorRole = normalizeRole(String(session?.role ?? "").trim().toLowerCase());
    if (!actorCode || !actorRole) {
      return NextResponse.json({ ok: false, message: "Unauthorized." }, { status: 401 });
    }
    if (!["admin", "teacher"].includes(actorRole)) {
      return NextResponse.json({ ok: false, message: "Not allowed." }, { status: 403 });
    }

    const actor = await loadUser(actorCode);
    if (!actor || actor.role !== actorRole) {
      return NextResponse.json({ ok: false, message: "Session mismatch." }, { status: 401 });
    }

    const body = (await request.json()) as { id?: string };
    const id = String(body.id ?? "").trim();
    if (!id) {
      return NextResponse.json({ ok: false, message: "Missing event id." }, { status: 400 });
    }

    const db = getAdminDb();
    const ref = db.collection("calendar_events").doc(id);
    const doc = await ref.get();
    if (!doc.exists) {
      return NextResponse.json({ ok: false, message: "Event not found." }, { status: 404 });
    }
    const existing = doc.data() as { createdBy?: { code?: string }; seriesId?: string };
    if (actorRole !== "admin" && String(existing.createdBy?.code ?? "") !== actor.code) {
      return NextResponse.json({ ok: false, message: "Not allowed." }, { status: 403 });
    }

    const seriesId = String(existing.seriesId ?? "").trim();
    if (!seriesId) {
      await ref.delete();
      return NextResponse.json({ ok: true, deleted: 1 });
    }

    const seriesSnapshot = await db.collection("calendar_events").where("seriesId", "==", seriesId).get();
    if (seriesSnapshot.empty) {
      await ref.delete();
      return NextResponse.json({ ok: true, deleted: 1 });
    }

    const batch = db.batch();
    for (const item of seriesSnapshot.docs) {
      batch.delete(item.ref);
    }
    await batch.commit();
    return NextResponse.json({ ok: true, deleted: seriesSnapshot.size });
  } catch (error) {
    console.error("DELETE /api/calendar-events error:", error);
    return NextResponse.json({ ok: false, message: "Failed to delete event." }, { status: 500 });
  }
}
