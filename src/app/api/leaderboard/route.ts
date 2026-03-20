import { NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";
import { decodeSessionFromCookie, getActivePeriod, getUserByCode, normalizeRole } from "@/lib/session";
import { mapRole } from "@/lib/code-mapper";

export const runtime = "nodejs";

type CompetitionKey = "attendance" | "commitment" | "katamars";

type LeaderboardEntry = {
  code: string;
  name: string;
  classId: string;
  className: string;
  score: number;
  percent?: number;
  profilePhoto?: string;
};

function classGender(classId: string) {
  const upper = classId.toUpperCase();
  if (upper.includes("G")) return "girls";
  if (upper.includes("B")) return "boys";
  return "mixed";
}

function asDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseScope(rawScope: string, classIdParam: string) {
  const value = rawScope.trim().toLowerCase();
  if (value.startsWith("class:")) {
    const classId = value.slice("class:".length).trim();
    return { type: "class" as const, classId };
  }
  if (value === "class") {
    return { type: "class" as const, classId: classIdParam.trim() };
  }
  if (value === "boys") return { type: "boys" as const };
  if (value === "girls") return { type: "girls" as const };
  return { type: "school" as const };
}

async function resolveAllowedClasses(role: string, userCode: string) {
  const db = getAdminDb();
  if (role === "admin") {
    const classesSnap = await db.collection("classes").get();
    return classesSnap.docs.map((doc) => String(doc.id).trim()).filter(Boolean);
  }

  const userDoc = await getUserByCode(userCode);
  if (!userDoc?.exists) return [];
  const data = userDoc.data() as { classes?: string[]; childrenCodes?: string[] };

  if (role === "parent") {
    const children = Array.isArray(data.childrenCodes)
      ? data.childrenCodes.map((c) => String(c).trim()).filter(Boolean)
      : [];
    if (!children.length) return [];
    const snapshots = await Promise.all(children.map((code) => getUserByCode(code)));
    const classIds = new Set<string>();
    snapshots.forEach((snap) => {
      if (!snap?.exists) return;
      const childData = snap.data() as { classes?: string[] };
      const childClasses = Array.isArray(childData.classes)
        ? childData.classes.map((c) => String(c).trim()).filter(Boolean)
        : [];
      childClasses.forEach((cls) => classIds.add(cls));
    });
    return Array.from(classIds);
  }

  return Array.isArray(data.classes)
    ? data.classes.map((c) => String(c).trim()).filter(Boolean)
    : [];
}

async function resolveClassNameMap() {
  const db = getAdminDb();
  const snap = await db.collection("classes").get();
  const map = new Map<string, string>();
  snap.docs.forEach((doc) => {
    const data = doc.data() as { name?: string };
    const name = String(data.name ?? "").trim();
    const id = String(doc.id).trim();
    map.set(id, name || id);
  });
  return map;
}

async function resolveResetAt(competition: CompetitionKey) {
  const db = getAdminDb();
  const doc = await db.collection("leaderboard_resets").doc(competition).get();
  if (!doc.exists) return null;
  const data = doc.data() as { resetAt?: string };
  return String(data.resetAt ?? "").trim() || null;
}

async function buildStudentList(scope: ReturnType<typeof parseScope>, classNameMap: Map<string, string>) {
  const db = getAdminDb();
  const studentsSnap = await db.collection("users").where("role", "==", "student").get();
  const students = studentsSnap.docs
    .map((doc) => {
      const data = doc.data() as { code?: string; name?: string; classes?: string[]; profilePhoto?: string };
      const code = String(data.code ?? doc.id).trim();
      if (!code) return null;
      const classes = Array.isArray(data.classes)
        ? data.classes.map((c) => String(c).trim()).filter(Boolean)
        : [];
      const name = String(data.name ?? "").trim();
      const profilePhoto = String(data.profilePhoto ?? "").trim();
      const profilePhotoValue = profilePhoto ? profilePhoto : undefined;
      return { code, name, classes, profilePhoto: profilePhotoValue };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);

  const filtered = students.filter((student) => {
    if (scope.type === "school") return true;
    if (scope.type === "class") return student.classes.includes(scope.classId);
    if (scope.type === "boys") return student.classes.some((cls) => classGender(cls) === "boys");
    if (scope.type === "girls") return student.classes.some((cls) => classGender(cls) === "girls");
    return true;
  });

  return filtered.map((student) => {
    const primaryClass =
      scope.type === "class"
        ? scope.classId
        : student.classes.find((cls) => (scope.type === "boys" ? classGender(cls) === "boys" : scope.type === "girls" ? classGender(cls) === "girls" : true)) ||
          student.classes[0] ||
          "";
    const className = primaryClass ? classNameMap.get(primaryClass) || primaryClass : "";
    return {
      ...student,
      classId: primaryClass,
      className,
    };
  });
}

export async function GET(request: Request) {
  try {
    const session = decodeSessionFromCookie(request);
    if (!session?.code || !session?.role) {
      return NextResponse.json({ ok: false, message: "Unauthorized." }, { status: 401 });
    }

    const actorDoc = await getUserByCode(session.code);
    if (!actorDoc?.exists) {
      return NextResponse.json({ ok: false, message: "User not found." }, { status: 404 });
    }

    const actorData = actorDoc.data() as { role?: string };
    const role = normalizeRole(String(actorData.role ?? session.role).trim().toLowerCase());

    const url = new URL(request.url);
    const competitionRaw = String(url.searchParams.get("competition") ?? "").trim().toLowerCase();
    const competition: CompetitionKey =
      competitionRaw === "commitment" || competitionRaw === "katamars" || competitionRaw === "attendance"
        ? (competitionRaw as CompetitionKey)
        : "attendance";

    const scope = parseScope(String(url.searchParams.get("scope") ?? "school"), String(url.searchParams.get("classId") ?? ""));

    if (scope.type === "class" && !scope.classId) {
      return NextResponse.json({ ok: false, message: "Missing class." }, { status: 400 });
    }

    const allowedClasses = await resolveAllowedClasses(role, session.code);
    if (scope.type === "class" && role !== "admin" && !allowedClasses.includes(scope.classId)) {
      return NextResponse.json({ ok: false, message: "Not allowed." }, { status: 403 });
    }

    const period = await getActivePeriod();
    if (!period?.term1Start || !period.term1End || !period.term2Start || !period.term2End) {
      return NextResponse.json({ ok: false, message: "لا توجد فترة فعالة." }, { status: 400 });
    }

    const termStart = period.activeTerm === "term2" ? period.term2Start : period.term1Start;
    const termEnd = period.activeTerm === "term2" ? period.term2End : period.term1End;
    const termStartDate = asDate(`${termStart}T00:00:00.000Z`);
    const termEndDate = asDate(`${termEnd}T23:59:59.999Z`);
    if (!termStartDate || !termEndDate) {
      return NextResponse.json({ ok: false, message: "تواريخ الفترة غير صالحة." }, { status: 400 });
    }

    const classNameMap = await resolveClassNameMap();
    const students = await buildStudentList(scope, classNameMap);
    const studentMap = new Map<string, typeof students[number]>();
    students.forEach((student) => studentMap.set(student.code, student));

    const resetAt = await resolveResetAt(competition);
    const resetDate = resetAt ? asDate(resetAt) : null;
    const effectiveStart = resetDate && resetDate > termStartDate ? resetDate : termStartDate;

    const db = getAdminDb();
    const leaderboard: LeaderboardEntry[] = [];

    if (competition === "attendance") {
      const attendanceSnap = await db
        .collection("attendance")
        .where("date", ">=", termStart)
        .where("date", "<=", termEnd)
        .get();

      const stats = new Map<string, { present: number; total: number }>();
      attendanceSnap.docs.forEach((doc) => {
        const data = doc.data() as { code?: string; classId?: string; status?: string; date?: string };
        const code = String(data.code ?? "").trim();
        const classId = String(data.classId ?? "").trim();
        const status = String(data.status ?? "").trim().toLowerCase();
        const date = String(data.date ?? "").trim();
        if (!code || !studentMap.has(code)) return;
        if (scope.type === "class" && classId !== scope.classId) return;
        if (scope.type === "boys" && classGender(classId) !== "boys") return;
        if (scope.type === "girls" && classGender(classId) !== "girls") return;
        if (resetDate && date && date < resetDate.toISOString().slice(0, 10)) return;
        const current = stats.get(code) ?? { present: 0, total: 0 };
        current.total += 1;
        if (status === "present") current.present += 1;
        stats.set(code, current);
      });

      studentMap.forEach((student) => {
        const stat = stats.get(student.code) ?? { present: 0, total: 0 };
        const percent = stat.total > 0 ? Number(((stat.present / stat.total) * 100).toFixed(2)) : 0;
        leaderboard.push({
          code: student.code,
          name: student.name,
          classId: student.classId,
          className: student.className,
          score: percent,
          percent,
          profilePhoto: student.profilePhoto,
        });
      });
    }

    if (competition === "commitment") {
      const startTs = Timestamp.fromDate(effectiveStart);
      const endTs = Timestamp.fromDate(termEndDate);
      const gradesSnap = await db
        .collection("homeworkGrades")
        .where("createdAt", ">=", startTs)
        .where("createdAt", "<=", endTs)
        .get();

      const stats = new Map<string, { score: number; max: number }>();
      gradesSnap.docs.forEach((doc) => {
        const data = doc.data() as { code?: string; score?: number; maxScore?: number };
        const code = String(data.code ?? "").trim();
        if (!code || !studentMap.has(code)) return;
        const current = stats.get(code) ?? { score: 0, max: 0 };
        current.score += Number(data.score ?? 0);
        current.max += Number(data.maxScore ?? 0);
        stats.set(code, current);
      });

      studentMap.forEach((student) => {
        const stat = stats.get(student.code) ?? { score: 0, max: 0 };
        const percent = stat.max > 0 ? Number(((stat.score / stat.max) * 100).toFixed(2)) : 0;
        leaderboard.push({
          code: student.code,
          name: student.name,
          classId: student.classId,
          className: student.className,
          score: percent,
          percent,
          profilePhoto: student.profilePhoto,
        });
      });
    }

    if (competition === "katamars") {
      const scoresSnap = await db.collection("katamars_competition_scores").get();
      const stats = new Map<string, number>();

      scoresSnap.docs.forEach((doc) => {
        const data = doc.data() as {
          studentCode?: string;
          score?: number;
          classId?: string;
          updatedAt?: string;
          touchedAt?: { seconds?: number; _seconds?: number };
        };
        const code = String(data.studentCode ?? "").trim();
        const classId = String(data.classId ?? "").trim();
        if (!code || !studentMap.has(code)) return;
        if (scope.type === "class" && classId !== scope.classId) return;
        if (scope.type === "boys" && classGender(classId) !== "boys") return;
        if (scope.type === "girls" && classGender(classId) !== "girls") return;

        let eventDate: Date | null = null;
        const seconds = data.touchedAt?._seconds ?? data.touchedAt?.seconds;
        if (seconds) {
          eventDate = new Date(seconds * 1000);
        } else if (data.updatedAt) {
          eventDate = asDate(data.updatedAt);
        }
        if (eventDate && (eventDate < effectiveStart || eventDate > termEndDate)) return;

        const current = stats.get(code) ?? 0;
        stats.set(code, current + Number(data.score ?? 0));
      });

      studentMap.forEach((student) => {
        leaderboard.push({
          code: student.code,
          name: student.name,
          classId: student.classId,
          className: student.className,
          score: stats.get(student.code) ?? 0,
          profilePhoto: student.profilePhoto,
        });
      });
    }

    const sorted = leaderboard.sort((a, b) => b.score - a.score);
    return NextResponse.json({
      ok: true,
      data: {
        competition,
        scope,
        period: {
          id: period.id,
          name: period.name,
          term: period.activeTerm,
          start: termStart,
          end: termEnd,
        },
        resetAt,
        leaderboard: sorted.map((item, idx) => ({ ...item, rank: idx + 1 })),
      },
    });
  } catch (error) {
    console.error("GET /api/leaderboard error:", error);
    return NextResponse.json({ ok: false, message: "Failed to load leaderboard." }, { status: 500 });
  }
}
