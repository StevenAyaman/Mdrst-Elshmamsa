import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";
import { getAdminDb } from "@/lib/firebase/admin";
import { decodeSessionFromCookie, getUserByCode, normalizeRole } from "@/lib/session";
import { mapRole } from "@/lib/code-mapper";

export const runtime = "nodejs";

function normalizeMonthKey(month: string) {
  return month.replace(/[^\p{L}\p{N}]+/gu, "-");
}

function makeCompetitionDocId(month: string, classId: string, studentCode: string) {
  return `${normalizeMonthKey(month)}__${classId}__${studentCode}`;
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
  const studentDoc = await getUserByCode(studentCode);
  if (studentDoc?.exists) {
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
  data: Record<string, string>
) {
  if (!userCodes.length) return;

  await db.collection("notifications").add({
    title,
    body,
    createdAt: new Date(),
    createdBy: { name: "نظام المسابقة", code: "system", role: "system" },
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

async function updateTop3AndNotify(db: ReturnType<typeof getAdminDb>, month: string, classId: string) {
  const scoresSnap = await db
    .collection("katamars_competition_scores")
    .where("month", "==", month)
    .where("classId", "==", classId)
    .get();

  const entries = scoresSnap.docs
    .map((doc) => doc.data() as { studentCode?: string; studentName?: string; score?: number })
    .map((item) => ({
      studentCode: String(item.studentCode ?? "").trim(),
      studentName: String(item.studentName ?? "").trim(),
      score: Number(item.score ?? 0),
    }))
    .filter((item) => item.studentCode);

  if (!entries.length) return;

  const sorted = entries.sort((a, b) => b.score - a.score);
  const top3 = sorted.slice(0, 3).map((item) => item.studentCode);
  const topDocId = `katamars__${normalizeMonthKey(month)}__${classId}`;
  const topRef = db.collection("leaderboard_top3").doc(topDocId);
  const topDoc = await topRef.get();
  const prevTop3 = topDoc.exists
    ? (topDoc.data() as { top3Codes?: string[] }).top3Codes ?? []
    : [];

  const entered = top3.filter((code) => !prevTop3.includes(code));
  const dropped = prevTop3.filter((code) => !top3.includes(code));

  const nameMap = new Map(sorted.map((item) => [item.studentCode, item.studentName]));

  for (const code of entered) {
    const rank = top3.indexOf(code) + 1;
    const name = nameMap.get(code) || code;
    const parentCodes = await resolveParentCodes(db, code);
    const targetCodes = Array.from(new Set([code, ...parentCodes]));
    await notifyUsers(
      db,
      targetCodes,
      "مركز متقدم في الليدربورد",
      `تهانينا! ${name} وصل للمركز ${rank} في مسابقة القطمارس.`,
      { type: "leaderboard_rank_up", competition: "katamars", month, classId, rank: String(rank) }
    );
  }

  for (const code of dropped) {
    const prevRank = prevTop3.indexOf(code) + 1;
    const name = nameMap.get(code) || code;
    const parentCodes = await resolveParentCodes(db, code);
    const targetCodes = Array.from(new Set([code, ...parentCodes]));
    await notifyUsers(
      db,
      targetCodes,
      "تغيير في الليدربورد",
      `تم خروج ${name} من المراكز الثلاثة الأولى في مسابقة القطمارس.`,
      { type: "leaderboard_rank_down", competition: "katamars", month, classId, prevRank: String(prevRank) }
    );
  }

  await topRef.set(
    { top3Codes: top3, updatedAt: new Date().toISOString() },
    { merge: true }
  );
}

async function getAccess(request: Request) {
  const session = decodeSessionFromCookie(request);
  if (!session?.code || !session?.role) return { ok: false as const, status: 401 };

  const actorDoc = await getUserByCode(session.code);
  if (!actorDoc?.exists) return { ok: false as const, status: 404 };

  const actorData = actorDoc.data() as { role?: string };
  const role = normalizeRole(String(actorData.role ?? session.role).trim().toLowerCase());
  if (role !== "katamars" && role !== "admin") return { ok: false as const, status: 403 };

  const db = getAdminDb();
  const classesSnap = await db.collection("classes").get();
  const classes = classesSnap.docs
    .map((doc) => ({
      id: String(doc.id).trim(),
      name: String((doc.data() as { name?: string }).name ?? doc.id).trim() || String(doc.id).trim(),
    }))
    .filter((item) => item.id)
    .sort((a, b) => a.name.localeCompare(b.name, "ar"));

  return { ok: true as const, role, code: session.code, classes };
}

function asNumber(value: unknown) {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return NaN;
    return Number(trimmed);
  }
  return NaN;
}

export async function GET(request: Request) {
  try {
    const access = await getAccess(request);
    if (!access.ok) {
      const map: Record<number, string> = {
        401: "Unauthorized.",
        403: "للأسف، غير مسموح لك الدخول.",
        404: "User not found.",
      };
      return NextResponse.json({ ok: false, message: map[access.status] ?? "Not allowed." }, { status: access.status });
    }

    const url = new URL(request.url);
    const classId = String(url.searchParams.get("classId") ?? "").trim();
    const month = String(url.searchParams.get("month") ?? "").trim();

    if (!classId || !month) {
      return NextResponse.json({ ok: false, message: "بيانات غير مكتملة." }, { status: 400 });
    }

    const db = getAdminDb();
    const studentsSnap = await db.collection("users").where("classes", "array-contains", classId).get();
    const students = studentsSnap.docs
      .map((doc) => {
        const data = doc.data() as { code?: string; name?: string; role?: string };
        if (mapRole(String(data.role ?? "").trim().toLowerCase()) !== "student") return null;
        return {
          code: String(data.code ?? doc.id).trim(),
          name: String(data.name ?? "").trim(),
          classId,
        };
      })
      .filter((item): item is { code: string; name: string; classId: string } => Boolean(item?.code))
      .sort((a, b) => a.name.localeCompare(b.name, "ar"));

    const scoresSnap = await db
      .collection("katamars_competition_scores")
      .where("month", "==", month)
      .where("classId", "==", classId)
      .get();

    const scoreMap = new Map<string, { score: number; updatedAt: string }>();
    for (const doc of scoresSnap.docs) {
      const data = doc.data() as { studentCode?: string; score?: number; updatedAt?: string };
      const studentCode = String(data.studentCode ?? "").trim();
      if (!studentCode) continue;
      scoreMap.set(studentCode, {
        score: Number(data.score ?? 0),
        updatedAt: String(data.updatedAt ?? ""),
      });
    }

    return NextResponse.json({
      ok: true,
      data: {
        role: access.role,
        classes: access.classes,
        students: students.map((student) => ({
          ...student,
          score: scoreMap.get(student.code)?.score ?? null,
          updatedAt: scoreMap.get(student.code)?.updatedAt ?? "",
        })),
      },
    });
  } catch (error) {
    console.error("GET /api/katamars-competition/manual error:", error);
    return NextResponse.json({ ok: false, message: "Failed to load Katamars competition data." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const access = await getAccess(request);
    if (!access.ok) {
      const map: Record<number, string> = {
        401: "Unauthorized.",
        403: "للأسف، غير مسموح لك الدخول.",
        404: "User not found.",
      };
      return NextResponse.json({ ok: false, message: map[access.status] ?? "Not allowed." }, { status: access.status });
    }

    const body = (await request.json()) as {
      month?: string;
      classId?: string;
      studentCode?: string;
      score?: number | string;
    };

    const month = String(body.month ?? "").trim();
    const classId = String(body.classId ?? "").trim();
    const studentCode = String(body.studentCode ?? "").trim();
    const score = asNumber(body.score);

    if (!month || !classId || !studentCode || Number.isNaN(score)) {
      return NextResponse.json({ ok: false, message: "بيانات غير مكتملة." }, { status: 400 });
    }
    if (score < 0) {
      return NextResponse.json({ ok: false, message: "الدرجة لا يمكن أن تكون سالبة." }, { status: 400 });
    }

    const studentDoc = await getUserByCode(studentCode);
    if (!studentDoc?.exists) {
      return NextResponse.json({ ok: false, message: "الطالب غير موجود." }, { status: 404 });
    }

    const studentData = studentDoc.data() as { role?: string; classes?: string[]; name?: string };
    if (mapRole(String(studentData.role ?? "").trim().toLowerCase()) !== "student") {
      return NextResponse.json({ ok: false, message: "الكود ليس لطالب." }, { status: 400 });
    }

    const studentClasses = Array.isArray(studentData.classes)
      ? studentData.classes.map((value) => String(value).trim()).filter(Boolean)
      : [];
    if (!studentClasses.includes(classId)) {
      return NextResponse.json({ ok: false, message: "الطالب غير مسجل في هذا الفصل." }, { status: 400 });
    }

    const db = getAdminDb();
    await db.collection("katamars_competition_scores").doc(makeCompetitionDocId(month, classId, studentCode)).set(
      {
        month,
        classId,
        studentCode,
        studentName: String(studentData.name ?? "").trim(),
        score,
        updatedBy: access.code,
        updatedAt: new Date().toISOString(),
        touchedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    try {
      await updateTop3AndNotify(db, month, classId);
    } catch (notifyError) {
      console.error("Katamars leaderboard notification failed:", notifyError);
    }

    return NextResponse.json({ ok: true, data: { studentCode, score } });
  } catch (error) {
    console.error("POST /api/katamars-competition/manual error:", error);
    return NextResponse.json({ ok: false, message: "Failed to save Katamars competition grade." }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const access = await getAccess(request);
    if (!access.ok) {
      const map: Record<number, string> = {
        401: "Unauthorized.",
        403: "للأسف، غير مسموح لك الدخول.",
        404: "User not found.",
      };
      return NextResponse.json({ ok: false, message: map[access.status] ?? "Not allowed." }, { status: access.status });
    }

    const url = new URL(request.url);
    const month = String(url.searchParams.get("month") ?? "").trim();
    const classId = String(url.searchParams.get("classId") ?? "").trim();
    const studentCode = String(url.searchParams.get("studentCode") ?? "").trim();
    if (!month || !classId) {
      return NextResponse.json({ ok: false, message: "بيانات غير مكتملة." }, { status: 400 });
    }

    const db = getAdminDb();
    if (studentCode) {
      await db.collection("katamars_competition_scores").doc(makeCompetitionDocId(month, classId, studentCode)).delete();
      return NextResponse.json({ ok: true, data: { deleted: 1 } });
    }

    const snap = await db
      .collection("katamars_competition_scores")
      .where("month", "==", month)
      .where("classId", "==", classId)
      .get();

    if (snap.empty) return NextResponse.json({ ok: true, data: { deleted: 0 } });

    let batch = db.batch();
    let count = 0;
    let deleted = 0;
    for (const doc of snap.docs) {
      batch.delete(doc.ref);
      count += 1;
      deleted += 1;
      if (count >= 350) {
        await batch.commit();
        batch = db.batch();
        count = 0;
      }
    }
    if (count > 0) await batch.commit();

    return NextResponse.json({ ok: true, data: { deleted } });
  } catch (error) {
    console.error("DELETE /api/katamars-competition/manual error:", error);
    return NextResponse.json({ ok: false, message: "Failed to delete Katamars competition grades." }, { status: 500 });
  }
}
