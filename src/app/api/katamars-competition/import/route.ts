import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
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

  return { ok: true as const, role, code: session.code };
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

    const form = await request.formData();
    const fallbackClassId = String(form.get("classId") ?? "").trim();
    const month = String(form.get("month") ?? "").trim();
    const file = form.get("file");
    if (!month || !(file instanceof File)) {
      return NextResponse.json({ ok: false, message: "بيانات غير مكتملة." }, { status: 400 });
    }

    const bytes = await file.arrayBuffer();
    const workbook = XLSX.read(Buffer.from(bytes), { type: "buffer" });
    const firstSheetName = workbook.SheetNames[0];
    if (!firstSheetName) {
      return NextResponse.json({ ok: false, message: "الملف فارغ." }, { status: 400 });
    }

    const db = getAdminDb();

    const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[firstSheetName], { header: 1, defval: "" });
    if (rows.length < 2) {
      return NextResponse.json({ ok: false, message: "الملف لا يحتوي على بيانات كافية." }, { status: 400 });
    }

    let updated = 0;
    const skipped: string[] = [];
    let batch = db.batch();
    let pending = 0;
    const touchedClasses = new Set<string>();
    const studentCache = new Map<
      string,
      { code: string; name: string; classes: string[]; role: string | null } | null
    >();

    for (let i = 1; i < rows.length; i += 1) {
      const row = rows[i] as unknown[];
      const rowClassId = String(row?.[1] ?? "").trim() || fallbackClassId;
      const studentCode = String(row?.[2] ?? "").trim();
      const score = asNumber(row?.[3]);
      if (!studentCode) continue;
      if (!rowClassId) {
        skipped.push(`السطر ${i + 1}: الصف غير مكتوب`);
        continue;
      }

      if (!studentCache.has(studentCode)) {
        const studentDoc = await getUserByCode(studentCode);
        if (!studentDoc?.exists) {
          studentCache.set(studentCode, null);
        } else {
          const data = studentDoc.data() as { code?: string; name?: string; role?: string; classes?: string[] };
          studentCache.set(studentCode, {
            code: String(data.code ?? studentDoc.id).trim(),
            name: String(data.name ?? "").trim(),
            role: mapRole(String(data.role ?? "").trim().toLowerCase()),
            classes: Array.isArray(data.classes)
              ? data.classes.map((value) => String(value).trim()).filter(Boolean)
              : [],
          });
        }
      }

      const student = studentCache.get(studentCode);
      if (!student) {
        skipped.push(`السطر ${i + 1}: الطالب غير موجود`);
        continue;
      }
      if (student.role !== "student") {
        skipped.push(`السطر ${i + 1}: الكود ليس لطالب`);
        continue;
      }
      if (!student.classes.includes(rowClassId)) {
        skipped.push(`السطر ${i + 1}: الطالب غير مسجل في الفصل ${rowClassId}`);
        continue;
      }
      if (Number.isNaN(score)) {
        skipped.push(`السطر ${i + 1}: الدرجة غير صحيحة`);
        continue;
      }
      if (score < 0) {
        skipped.push(`السطر ${i + 1}: الدرجة لا يمكن أن تكون سالبة`);
        continue;
      }

      batch.set(
        db.collection("katamars_competition_scores").doc(makeCompetitionDocId(month, rowClassId, studentCode)),
        {
          month,
          classId: rowClassId,
          studentCode,
          studentName: student.name,
          score,
          updatedBy: access.code,
          updatedAt: new Date().toISOString(),
          touchedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );

      touchedClasses.add(rowClassId);
      updated += 1;
      pending += 1;
      if (pending >= 350) {
        await batch.commit();
        batch = db.batch();
        pending = 0;
      }
    }

    if (pending > 0) await batch.commit();

    try {
      for (const classId of touchedClasses) {
        await updateTop3AndNotify(db, month, classId);
      }
    } catch (notifyError) {
      console.error("Katamars leaderboard notification failed:", notifyError);
    }
    return NextResponse.json({ ok: true, data: { updated, skipped } });
  } catch (error) {
    console.error("POST /api/katamars-competition/import error:", error);
    return NextResponse.json({ ok: false, message: "Failed to import Katamars competition grades." }, { status: 500 });
  }
}
