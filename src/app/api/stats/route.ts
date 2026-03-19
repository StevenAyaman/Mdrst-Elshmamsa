import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";

export const runtime = "nodejs";

type RoleCount = {
  admin: number;
  system: number;
  teacher: number;
  parent: number;
  notes: number;
  katamars: number;
  student: number;
  classes: number;
};

type ClassAttendanceMetric = {
  classId: string;
  attendanceRate: number;
  absenceRate: number;
  totalRecords: number;
  present: number;
  absent: number;
};

type ClassCommitmentMetric = {
  classId: string;
  totalScore: number;
};

type ClassInsights = {
  period: { id: string; name: string; startDate: string; endDate: string } | null;
  weekly: {
    labels: string[];
    school: number[];
    boys: number[];
    girls: number[];
    classes: Record<string, number[]>;
  };
  attendance: {
    boysBestAttendance: ClassAttendanceMetric[];
    girlsBestAttendance: ClassAttendanceMetric[];
    boysLeastAbsence: ClassAttendanceMetric[];
    girlsLeastAbsence: ClassAttendanceMetric[];
  };
  commitment: {
    boysTop: ClassCommitmentMetric[];
    girlsTop: ClassCommitmentMetric[];
  };
};

async function countRole(role: string) {
  const db = getAdminDb();
  const snapshot = await db.collection("users").where("role", "==", role).count().get();
  return snapshot.data().count ?? 0;
}

function normalizeClassId(value: string) {
  return String(value ?? "").trim().toUpperCase();
}

function classGender(classId: string): "boys" | "girls" | "other" {
  const normalized = normalizeClassId(classId);
  if (normalized.endsWith("B")) return "boys";
  if (normalized.endsWith("G")) return "girls";
  return "other";
}

function roundOne(value: number) {
  return Math.round(value * 10) / 10;
}

function startOfDayMs(isoDate: string) {
  return new Date(`${isoDate}T00:00:00`).getTime();
}

async function loadClassInsights(): Promise<ClassInsights> {
  const empty: ClassInsights = {
    period: null,
    weekly: {
      labels: [],
      school: [],
      boys: [],
      girls: [],
      classes: {},
    },
    attendance: {
      boysBestAttendance: [],
      girlsBestAttendance: [],
      boysLeastAbsence: [],
      girlsLeastAbsence: [],
    },
    commitment: {
      boysTop: [],
      girlsTop: [],
    },
  };

  const db = getAdminDb();
  const activePeriodSnapshot = await db
    .collection("service_periods")
    .where("active", "==", true)
    .limit(1)
    .get();
  if (activePeriodSnapshot.empty) return empty;

  const periodDoc = activePeriodSnapshot.docs[0];
  const periodData = periodDoc.data() as { name?: string; startDate?: string; endDate?: string };
  const startDate = String(periodData.startDate ?? "").trim();
  const endDate = String(periodData.endDate ?? "").trim();
  if (!startDate || !endDate) return empty;
  const startMs = startOfDayMs(startDate);
  const endMs = startOfDayMs(endDate);
  if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs < startMs) return empty;
  const days = Math.floor((endMs - startMs) / (24 * 60 * 60 * 1000)) + 1;
  const weekCount = Math.max(1, Math.ceil(days / 7));
  const weeklyLabels = Array.from({ length: weekCount }, (_, idx) => `الأسبوع ${idx + 1}`);
  const weeklySchool = Array.from({ length: weekCount }, () => 0);
  const weeklyBoys = Array.from({ length: weekCount }, () => 0);
  const weeklyGirls = Array.from({ length: weekCount }, () => 0);

  const classesSnapshot = await db.collection("classes").get();
  const classIds = classesSnapshot.docs.map((doc) => normalizeClassId(String(doc.id)));
  const classSet = new Set(classIds);
  const activeStudentCodesByClass = new Map<string, Set<string>>();
  const weeklyClassMap: Record<string, number[]> = {};
  classIds.forEach((classId) => {
    weeklyClassMap[classId] = Array.from({ length: weekCount }, () => 0);
    activeStudentCodesByClass.set(classId, new Set<string>());
  });

  const studentsSnapshot = await db.collection("users").where("role", "==", "student").get();
  for (const doc of studentsSnapshot.docs) {
    const data = doc.data() as { code?: string; classes?: string[] };
    const studentCode = String(data.code ?? doc.id).trim();
    if (!studentCode) continue;
    const studentClasses = Array.isArray(data.classes) ? data.classes : [];
    for (const rawClassId of studentClasses) {
      const classId = normalizeClassId(String(rawClassId ?? ""));
      if (!classSet.has(classId)) continue;
      activeStudentCodesByClass.get(classId)?.add(studentCode);
    }
  }

  const attendanceStats = new Map<string, { present: number; absent: number }>();
  classIds.forEach((classId) => attendanceStats.set(classId, { present: 0, absent: 0 }));

  const attendanceSnapshot = await db
    .collection("attendance")
    .where("date", ">=", startDate)
    .where("date", "<=", endDate)
    .get();

  for (const doc of attendanceSnapshot.docs) {
    const item = doc.data() as { classId?: string; status?: string; date?: string; code?: string };
    const classId = normalizeClassId(String(item.classId ?? ""));
    if (!classSet.has(classId)) continue;
    const studentCode = String(item.code ?? "").trim();
    if (!studentCode || !activeStudentCodesByClass.get(classId)?.has(studentCode)) continue;
    const status = String(item.status ?? "").trim().toLowerCase();
    const record = attendanceStats.get(classId);
    if (!record) continue;
    if (status === "present") record.present += 1;
    if (status === "absent") record.absent += 1;
    if (status !== "present") continue;
    const date = String(item.date ?? "").trim();
    const dateMs = startOfDayMs(date);
    if (Number.isNaN(dateMs) || dateMs < startMs || dateMs > endMs) continue;
    const weekIndex = Math.floor((dateMs - startMs) / (7 * 24 * 60 * 60 * 1000));
    if (weekIndex < 0 || weekIndex >= weekCount) continue;
    weeklySchool[weekIndex] += 1;
    weeklyClassMap[classId][weekIndex] = (weeklyClassMap[classId][weekIndex] ?? 0) + 1;
    const gender = classGender(classId);
    if (gender === "boys") weeklyBoys[weekIndex] += 1;
    if (gender === "girls") weeklyGirls[weekIndex] += 1;
  }

  const attendanceMetrics: ClassAttendanceMetric[] = classIds
    .map((classId) => {
      const stat = attendanceStats.get(classId) ?? { present: 0, absent: 0 };
      const total = stat.present + stat.absent;
      const attendanceRate = total > 0 ? (stat.present / total) * 100 : 0;
      const absenceRate = total > 0 ? (stat.absent / total) * 100 : 0;
      return {
        classId,
        attendanceRate: roundOne(attendanceRate),
        absenceRate: roundOne(absenceRate),
        totalRecords: total,
        present: stat.present,
        absent: stat.absent,
      };
    })
    .filter((item) => item.totalRecords > 0);

  function pickBestAttendance(gender: "boys" | "girls") {
    const list = attendanceMetrics.filter((item) => classGender(item.classId) === gender);
    if (!list.length) return [];
    const best = Math.max(...list.map((item) => item.attendanceRate));
    return list.filter((item) => item.attendanceRate === best);
  }

  function pickLeastAbsence(gender: "boys" | "girls") {
    const list = attendanceMetrics.filter((item) => classGender(item.classId) === gender);
    if (!list.length) return [];
    const least = Math.min(...list.map((item) => item.absenceRate));
    return list.filter((item) => item.absenceRate === least);
  }

  const scoreByClass = new Map<string, number>();
  classIds.forEach((classId) => scoreByClass.set(classId, 0));

  const homeworksSnapshot = await db
    .collection("homeworks")
    .where("periodId", "==", periodDoc.id)
    .get();

  for (const hwDoc of homeworksSnapshot.docs) {
    const subsSnapshot = await hwDoc.ref.collection("submissions").get();
    for (const subDoc of subsSnapshot.docs) {
      const sub = subDoc.data() as { className?: string; score?: number };
      const classId = normalizeClassId(String(sub.className ?? ""));
      if (!classSet.has(classId)) continue;
      const score = Number(sub.score ?? 0);
      if (Number.isNaN(score)) continue;
      scoreByClass.set(classId, (scoreByClass.get(classId) ?? 0) + score);
    }
  }

  const commitmentMetrics: ClassCommitmentMetric[] = Array.from(scoreByClass.entries())
    .map(([classId, totalScore]) => ({ classId, totalScore: roundOne(totalScore) }))
    .filter((item) => item.totalScore > 0);

  function pickTopCommitment(gender: "boys" | "girls") {
    const list = commitmentMetrics.filter((item) => classGender(item.classId) === gender);
    if (!list.length) return [];
    const best = Math.max(...list.map((item) => item.totalScore));
    return list.filter((item) => item.totalScore === best);
  }

  return {
    period: {
      id: periodDoc.id,
      name: String(periodData.name ?? ""),
      startDate,
      endDate,
    },
    weekly: {
      labels: weeklyLabels,
      school: weeklySchool,
      boys: weeklyBoys,
      girls: weeklyGirls,
      classes: weeklyClassMap,
    },
    attendance: {
      boysBestAttendance: pickBestAttendance("boys"),
      girlsBestAttendance: pickBestAttendance("girls"),
      boysLeastAbsence: pickLeastAbsence("boys"),
      girlsLeastAbsence: pickLeastAbsence("girls"),
    },
    commitment: {
      boysTop: pickTopCommitment("boys"),
      girlsTop: pickTopCommitment("girls"),
    },
  };
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

async function verifyAdminActor(actorCode: string, actorRole: string) {
  if (actorRole !== "admin") return false;
  const db = getAdminDb();
  const doc = await db.collection("users").doc(actorCode).get();
  if (!doc.exists) return false;
  const data = doc.data() as { role?: string };
  return String(data.role ?? "").trim().toLowerCase() === "admin";
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
    const [admin, system, teacher, parent, notes, katamars, student, nzam, classes, classInsights] = await Promise.all([
      countRole("admin"),
      countRole("system"),
      countRole("teacher"),
      countRole("parent"),
      countRole("notes"),
      countRole("katamars"),
      countRole("student"),
      countRole("nzam"),
      getAdminDb().collection("classes").count().get().then((s) => s.data().count ?? 0),
      loadClassInsights(),
    ]);

    const data: RoleCount = {
      admin,
      system: system + nzam,
      teacher,
      parent,
      notes,
      katamars,
      student,
      classes,
    };
    return NextResponse.json({ ok: true, data: { ...data, classInsights } });
  } catch (error) {
    console.error("GET /api/stats error:", error);
    return NextResponse.json({ ok: false, message: "Failed to load stats." }, { status: 500 });
  }
}
