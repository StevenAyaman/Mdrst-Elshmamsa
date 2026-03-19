import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";

export const runtime = "nodejs";

type SessionPayload = { code?: string; role?: string };

type GroupFilter = "school" | "boys" | "girls" | "class";

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

function normalizeClassId(value: string) {
  return String(value ?? "").trim().toUpperCase();
}

function isIsoDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function toDayMs(isoDate: string) {
  return new Date(`${isoDate}T00:00:00`).getTime();
}

async function verifyAdminActor(actorCode: string, actorRole: string) {
  if (normalizeRole(actorRole) !== "admin") return false;
  const db = getAdminDb();
  const doc = await db.collection("users").doc(actorCode).get();
  if (!doc.exists) return false;
  const data = doc.data() as { role?: string };
  return normalizeRole(String(data.role ?? "").trim().toLowerCase()) === "admin";
}

function classMatchesGroup(classId: string, group: GroupFilter, selectedClassId: string) {
  const normalized = normalizeClassId(classId);
  if (!normalized) return false;
  if (group === "school") return true;
  if (group === "boys") return normalized.endsWith("B");
  if (group === "girls") return normalized.endsWith("G");
  if (group === "class") return normalized === normalizeClassId(selectedClassId);
  return false;
}

export async function GET(request: Request) {
  try {
    const session = decodeSessionFromCookie(request);
    if (!session?.code || !session?.role) {
      return NextResponse.json({ ok: false, message: "Unauthorized." }, { status: 401 });
    }
    const isAdmin = await verifyAdminActor(session.code, session.role);
    if (!isAdmin) {
      return NextResponse.json({ ok: false, message: "Not allowed." }, { status: 403 });
    }

    const db = getAdminDb();
    const url = new URL(request.url);
    const rawGroup = String(url.searchParams.get("group") ?? "school").trim().toLowerCase();
    const group = (["school", "boys", "girls", "class"].includes(rawGroup)
      ? rawGroup
      : "school") as GroupFilter;
    const classId = normalizeClassId(String(url.searchParams.get("classId") ?? "").trim());

    let startDate = String(url.searchParams.get("startDate") ?? "").trim();
    let endDate = String(url.searchParams.get("endDate") ?? "").trim();

    const activePeriodSnapshot = await db
      .collection("service_periods")
      .where("active", "==", true)
      .limit(1)
      .get();
    const activePeriodDoc = activePeriodSnapshot.empty ? null : activePeriodSnapshot.docs[0];
    const activePeriod = activePeriodDoc
      ? (activePeriodDoc.data() as { name?: string; startDate?: string; endDate?: string })
      : null;

    if (!startDate) startDate = String(activePeriod?.startDate ?? "").trim();
    if (!endDate) endDate = String(activePeriod?.endDate ?? "").trim();

    if (!isIsoDate(startDate) || !isIsoDate(endDate)) {
      return NextResponse.json({ ok: false, message: "Invalid date range." }, { status: 400 });
    }
    if (startDate > endDate) {
      return NextResponse.json({ ok: false, message: "Invalid date order." }, { status: 400 });
    }
    if (group === "class" && !classId) {
      return NextResponse.json({ ok: false, message: "Class is required." }, { status: 400 });
    }

    const classesSnapshot = await db.collection("classes").orderBy("name", "asc").get();
    const classes = classesSnapshot.docs.map((doc) => {
      const data = doc.data() as { name?: string };
      return { id: normalizeClassId(doc.id), name: String(data.name ?? doc.id) };
    });

    const startMs = toDayMs(startDate);
    const endMs = toDayMs(endDate);
    if (Number.isNaN(startMs) || Number.isNaN(endMs)) {
      return NextResponse.json({ ok: false, message: "Invalid date range." }, { status: 400 });
    }
    const now = new Date();
    const todayIso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
      now.getDate()
    ).padStart(2, "0")}`;
    const todayMs = toDayMs(todayIso);
    const effectiveEndMs = Math.min(endMs, todayMs);
    if (effectiveEndMs < startMs) {
      return NextResponse.json({
        ok: true,
        data: {
          period: activePeriod
            ? {
                id: activePeriodDoc?.id ?? "",
                name: String(activePeriod.name ?? ""),
                startDate: String(activePeriod.startDate ?? ""),
                endDate: String(activePeriod.endDate ?? ""),
              }
            : null,
          classes,
          filter: { group, classId, startDate, endDate },
          points: [],
        },
      });
    }

    const totalDays = Math.floor((effectiveEndMs - startMs) / (24 * 60 * 60 * 1000)) + 1;
    const weekCount = Math.max(1, Math.ceil(totalDays / 7));
    const counts = Array.from({ length: weekCount }, () => 0);
    const points = Array.from({ length: weekCount }, (_, index) => {
      const weekStartMs = startMs + index * 7 * 24 * 60 * 60 * 1000;
      const weekEndMs = Math.min(effectiveEndMs, weekStartMs + 6 * 24 * 60 * 60 * 1000);
      const weekStart = new Date(weekStartMs);
      const weekEnd = new Date(weekEndMs);
      const formatIso = (d: Date) => {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, "0");
        const day = String(d.getDate()).padStart(2, "0");
        return `${y}-${m}-${day}`;
      };
      return {
        weekNumber: index + 1,
        label: `الأسبوع ${index + 1}`,
        startDate: formatIso(weekStart),
        endDate: formatIso(weekEnd),
        count: 0,
      };
    });

    const attendanceSnapshot = await db
      .collection("attendance")
      .where("date", ">=", startDate)
      .where("date", "<=", endDate)
      .get();

    for (const doc of attendanceSnapshot.docs) {
      const item = doc.data() as { classId?: string; date?: string; status?: string };
      const status = String(item.status ?? "").trim().toLowerCase();
      if (status !== "present") continue;
      const rowClassId = normalizeClassId(String(item.classId ?? ""));
      if (!classMatchesGroup(rowClassId, group, classId)) continue;
      const rowDate = String(item.date ?? "").trim();
      if (!isIsoDate(rowDate)) continue;
      const dateMs = toDayMs(rowDate);
      if (Number.isNaN(dateMs) || dateMs < startMs || dateMs > effectiveEndMs) continue;
      const weekIndex = Math.floor((dateMs - startMs) / (7 * 24 * 60 * 60 * 1000));
      if (weekIndex < 0 || weekIndex >= weekCount) continue;
      counts[weekIndex] += 1;
    }

    for (let i = 0; i < points.length; i += 1) {
      points[i].count = counts[i];
    }

    return NextResponse.json({
      ok: true,
      data: {
        period: activePeriod
          ? {
              id: activePeriodDoc?.id ?? "",
              name: String(activePeriod.name ?? ""),
              startDate: String(activePeriod.startDate ?? ""),
              endDate: String(activePeriod.endDate ?? ""),
            }
          : null,
        classes,
        filter: { group, classId, startDate, endDate },
        points,
      },
    });
  } catch (error) {
    console.error("GET /api/attendance/analytics error:", error);
    return NextResponse.json(
      { ok: false, message: "Failed to load attendance analytics." },
      { status: 500 }
    );
  }
}
