import { NextResponse } from "next/server";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { getAdminDb } from "@/lib/firebase/admin";
import { getActivePeriod } from "@/lib/session";

export const runtime = "nodejs";

type SessionPayload = { code?: string; role?: string } | null;

const allowedFileTypes = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/jpg",
  "video/mp4",
  "video/quicktime",
  "audio/webm",
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/ogg",
  "audio/mp4",
  "audio/aac",
  "audio/x-m4a",
]);
const maxFileSizeBytes = 20 * 1024 * 1024;

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

async function resolveResetAt(db: ReturnType<typeof getAdminDb>, competition: "commitment") {
  const doc = await db.collection("leaderboard_resets").doc(competition).get();
  if (!doc.exists) return null;
  const data = doc.data() as { resetAt?: string };
  return String(data.resetAt ?? "").trim() || null;
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
  data: Record<string, string>
) {
  if (!userCodes.length) return;

  await db.collection("notifications").add({
    title,
    body,
    createdAt: Timestamp.now(),
    createdBy: { name: "نظام الليدربورد", code: "system", role: "system" },
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

async function updateCommitmentTop3AndNotify(db: ReturnType<typeof getAdminDb>, classId: string) {
  const period = await getActivePeriod();
  if (!period?.term1Start || !period.term1End || !period.term2Start || !period.term2End) return;

  const termStart = period.activeTerm === "term2" ? period.term2Start : period.term1Start;
  const termEnd = period.activeTerm === "term2" ? period.term2End : period.term1End;
  const resetAt = await resolveResetAt(db, "commitment");
  const resetDate = resetAt ? new Date(resetAt) : null;

  const studentsSnap = await db
    .collection("users")
    .where("role", "==", "student")
    .where("classes", "array-contains", classId)
    .get();
  const students = studentsSnap.docs
    .map((doc) => {
      const data = doc.data() as { code?: string; name?: string };
      const code = String(data.code ?? doc.id).trim();
      return { code, name: String(data.name ?? "").trim() };
    })
    .filter((item) => item.code);

  if (!students.length) return;

  const studentSet = new Set(students.map((s) => s.code));
  const nameMap = new Map(students.map((s) => [s.code, s.name]));

  const startTs = Timestamp.fromDate(new Date(`${termStart}T00:00:00.000Z`));
  const endTs = Timestamp.fromDate(new Date(`${termEnd}T23:59:59.999Z`));
  const gradesSnap = await db
    .collection("homeworkGrades")
    .where("createdAt", ">=", startTs)
    .where("createdAt", "<=", endTs)
    .get();

  const stats = new Map<string, { score: number; max: number }>();
  gradesSnap.docs.forEach((doc) => {
    const data = doc.data() as { code?: string; score?: number; maxScore?: number; createdAt?: Timestamp };
    const code = String(data.code ?? "").trim();
    if (!studentSet.has(code)) return;
    if (resetDate && data.createdAt?.toDate) {
      const created = data.createdAt.toDate();
      if (created < resetDate) return;
    }
    const current = stats.get(code) ?? { score: 0, max: 0 };
    current.score += Number(data.score ?? 0);
    current.max += Number(data.maxScore ?? 0);
    stats.set(code, current);
  });

  const leaderboard = students.map((student) => {
    const stat = stats.get(student.code) ?? { score: 0, max: 0 };
    const percent = stat.max > 0 ? Number(((stat.score / stat.max) * 100).toFixed(2)) : 0;
    return { code: student.code, name: student.name, score: percent };
  });

  const sorted = leaderboard.sort((a, b) => b.score - a.score);
  const top3 = sorted.slice(0, 3).map((item) => item.code);
  const topRef = db.collection("leaderboard_top3").doc(`commitment__${classId}`);
  const topDoc = await topRef.get();
  const prevTop3 = topDoc.exists
    ? (topDoc.data() as { top3Codes?: string[] }).top3Codes ?? []
    : [];

  const entered = top3.filter((code) => !prevTop3.includes(code));
  const dropped = prevTop3.filter((code) => !top3.includes(code));

  for (const code of entered) {
    const rank = top3.indexOf(code) + 1;
    const name = nameMap.get(code) || code;
    const parentCodes = await resolveParentCodes(db, code);
    const targetCodes = Array.from(new Set([code, ...parentCodes]));
    await notifyUsers(
      db,
      targetCodes,
      "مركز متقدم في الليدربورد",
      `تهانينا! ${name} وصل للمركز ${rank} في ليدربورد الالتزام.`,
      { type: "leaderboard_rank_up", competition: "commitment", classId, rank: String(rank) }
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
      `تم خروج ${name} من المراكز الثلاثة الأولى في ليدربورد الالتزام.`,
      { type: "leaderboard_rank_down", competition: "commitment", classId, prevRank: String(prevRank) }
    );
  }

  await topRef.set({ top3Codes: top3, updatedAt: new Date().toISOString() }, { merge: true });
}

async function loadActor(db: ReturnType<typeof getAdminDb>, code: string) {
  const directDoc = await db.collection("users").doc(code).get();
  if (directDoc.exists) {
    return directDoc.data() as { role?: string; name?: string; classes?: string[]; childrenCodes?: string[] };
  }
  const snapshot = await db.collection("users").where("code", "==", code).limit(1).get();
  if (snapshot.empty) return null;
  return snapshot.docs[0].data() as { role?: string; name?: string; classes?: string[]; childrenCodes?: string[] };
}

async function getClassesForUser(
  db: ReturnType<typeof getAdminDb>,
  role: string,
  actor: { classes?: string[]; childrenCodes?: string[] },
) {
  if (role === "student") {
    return normalizeStringList(actor.classes, true);
  }
  if (role === "parent") {
    const childCodes = normalizeStringList(actor.childrenCodes);
    const classSet = new Set<string>();
    for (const childCode of childCodes) {
      const directDoc = await db.collection("users").doc(childCode).get();
      let child: { classes?: string[] } | null = null;
      if (directDoc.exists) {
        child = directDoc.data() as { classes?: string[] };
      } else {
        const childSnapshot = await db.collection("users").where("code", "==", childCode).limit(1).get();
        if (!childSnapshot.empty) {
          child = childSnapshot.docs[0].data() as { classes?: string[] };
        }
      }
      if (!child) continue;
      const childClasses = normalizeStringList(child.classes, true);
      childClasses.forEach((cls) => classSet.add(cls));
    }
    return Array.from(classSet);
  }
  return [];
}

async function saveUploadedFile(homeworkId: string, file: File) {
  if (!allowedFileTypes.has(file.type)) {
    return { ok: false as const, message: "نوع الملف غير مسموح." };
  }
  if (file.size > maxFileSizeBytes) {
    return { ok: false as const, message: "حجم الملف كبير جداً (20MB)." };
  }
  const buffer = Buffer.from(await file.arrayBuffer());
  const cleanName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const objectName = `${Date.now()}-${cleanName}`;
  const relativeDir = path.join("uploads", "homework", homeworkId);
  const absoluteDir = path.join(process.cwd(), "public", relativeDir);
  await mkdir(absoluteDir, { recursive: true });
  const absoluteFilePath = path.join(absoluteDir, objectName);
  await writeFile(absoluteFilePath, buffer);
  const storagePath = path.join(relativeDir, objectName).replace(/\\/g, "/");
  return {
    ok: true as const,
    url: `/${storagePath}`,
    fileName: file.name,
    mimeType: file.type,
  };
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = decodeSessionFromCookie(request);
    if (!session?.code || !session?.role) {
      return NextResponse.json({ ok: false, message: "Unauthorized." }, { status: 401 });
    }
    const db = getAdminDb();
    const actor = await loadActor(db, session.code);
    if (!actor) {
      return NextResponse.json({ ok: false, message: "User not found." }, { status: 404 });
    }
    const role = normalizeRole(String(actor.role ?? session.role ?? "").trim().toLowerCase());
    const { id } = await params;
    const homeworkId = String(id ?? "").trim();
    const doc = await db.collection("homeworks").doc(homeworkId).get();
    if (!doc.exists) {
      return NextResponse.json({ ok: false, message: "Homework not found." }, { status: 404 });
    }
    const data = doc.data() as {
      classIds?: string[];
      createdBy?: { code?: string };
      title?: string;
      subject?: string;
      description?: string;
      dueAt?: string;
      fileUrl?: string;
      fileName?: string;
      mimeType?: string;
      createdAt?: Timestamp;
    };

    if (role === "teacher") {
      if (String(data.createdBy?.code ?? "") !== session.code) {
        return NextResponse.json({ ok: false, message: "Not allowed." }, { status: 403 });
      }
      const url = new URL(request.url);
      const studentCode = String(url.searchParams.get("studentCode") ?? "").trim();
      const subsSnapshot = await doc.ref.collection("submissions").get();
      const submissions = await Promise.all(
        subsSnapshot.docs.map(async (subDoc) => {
          const data = subDoc.data() as { studentCode?: string; className?: string };
          if (data.className) return data;
          const studentCode = String(data.studentCode ?? "").trim();
          if (!studentCode) return data;
          const studentDoc = await db.collection("users").doc(studentCode).get();
          if (!studentDoc.exists) return data;
          const student = studentDoc.data() as { classes?: string[] };
          const classes = Array.isArray(student.classes) ? student.classes : [];
          return {
            ...data,
            className: classes[0] ? String(classes[0]) : "",
          };
        })
      );
      let messages: Record<string, unknown>[] = [];
      if (studentCode) {
        const subRef = doc.ref.collection("submissions").doc(studentCode);
        const messagesSnapshot = await subRef
          .collection("messages")
          .orderBy("createdAt", "asc")
          .limit(200)
          .get();
        messages = messagesSnapshot.docs.map((m) => m.data());
      }
      return NextResponse.json({
        ok: true,
        data: {
          id: doc.id,
          ...data,
          submissions,
          messages,
        },
      });
    }

    if (role === "student" || role === "parent") {
      const classes = await getClassesForUser(db, role, actor);
      const rawData = data as { classIds?: unknown; classId?: unknown; class?: unknown };
      const classIds = [
        ...normalizeStringList(rawData.classIds, true),
        ...normalizeStringList(rawData.classId, true),
        ...normalizeStringList(rawData.class, true),
      ];
      if (!classes.some((cls) => classIds.some((hwCls) => classMatches(cls, hwCls)))) {
        return NextResponse.json({ ok: false, message: "Not allowed." }, { status: 403 });
      }
      const url = new URL(request.url);
      const studentCode =
        role === "student"
          ? session.code
          : String(url.searchParams.get("studentCode") ?? "").trim();
      if (!studentCode) {
        return NextResponse.json({ ok: false, message: "Missing student code." }, { status: 400 });
      }
      const subRef = doc.ref.collection("submissions").doc(studentCode);
      const subDoc = await subRef.get();
      const messagesSnapshot = await subRef
        .collection("messages")
        .orderBy("createdAt", "asc")
        .limit(200)
        .get();
      const messages = messagesSnapshot.docs.map((m) => m.data());
      return NextResponse.json({
        ok: true,
        data: {
          id: doc.id,
          ...data,
          submission: subDoc.exists ? subDoc.data() : null,
          messages,
        },
      });
    }

    return NextResponse.json({ ok: false, message: "Not allowed." }, { status: 403 });
  } catch (error) {
    console.error("GET /api/homework/[id] error:", error);
    return NextResponse.json({ ok: false, message: "Failed to load homework." }, { status: 500 });
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = decodeSessionFromCookie(request);
    if (!session?.code || !session?.role) {
      return NextResponse.json({ ok: false, message: "Unauthorized." }, { status: 401 });
    }
    const db = getAdminDb();
    const actor = await loadActor(db, session.code);
    if (!actor) {
      return NextResponse.json({ ok: false, message: "User not found." }, { status: 404 });
    }
    const role = normalizeRole(String(actor.role ?? session.role ?? "").trim().toLowerCase());
    const { id } = await params;
    const homeworkId = String(id ?? "").trim();
    const doc = await db.collection("homeworks").doc(homeworkId).get();
    if (!doc.exists) {
      return NextResponse.json({ ok: false, message: "Homework not found." }, { status: 404 });
    }
    const hw = doc.data() as { classIds?: string[]; createdBy?: { code?: string } };
    const form = await request.formData();
    const message = String(form.get("message") ?? "").trim();
    const file = form.get("file");

    if (!message && !(file instanceof File)) {
      return NextResponse.json({ ok: false, message: "اكتب رسالة أو ارفع ملفاً." }, { status: 400 });
    }

    if (role === "teacher") {
      if (String(hw.createdBy?.code ?? "") !== session.code) {
        return NextResponse.json({ ok: false, message: "Not allowed." }, { status: 403 });
      }
      const targetStudentCode = String(form.get("studentCode") ?? "").trim();
      if (!targetStudentCode) {
        return NextResponse.json({ ok: false, message: "Missing student code." }, { status: 400 });
      }
      const subRef = doc.ref.collection("submissions").doc(targetStudentCode);
      let filePayload: { fileUrl?: string; fileName?: string; mimeType?: string } = {};
      if (file instanceof File) {
        const saved = await saveUploadedFile(homeworkId, file);
        if (!saved.ok) {
          return NextResponse.json({ ok: false, message: saved.message }, { status: 400 });
        }
        filePayload = { fileUrl: saved.url, fileName: saved.fileName, mimeType: saved.mimeType };
      }
      await subRef.set(
        {
          studentCode: targetStudentCode,
          updatedAt: Timestamp.now(),
        },
        { merge: true }
      );
      await subRef.collection("messages").add({
        message,
        ...filePayload,
        createdAt: Timestamp.now(),
        createdBy: { code: session.code, name: actor.name ?? "", role },
      });

      try {
        const studentDoc = await db.collection("users").doc(targetStudentCode).get();
        const studentData = studentDoc.exists
          ? (studentDoc.data() as { name?: string; parentCodes?: string[] })
          : {};
        const studentName = String(studentData?.name ?? targetStudentCode).trim();
        const parentCodes = Array.isArray(studentData?.parentCodes)
          ? studentData.parentCodes.map((code) => String(code).trim()).filter(Boolean)
          : [];
        const targetCodes = Array.from(new Set([targetStudentCode, ...parentCodes]));

        if (targetCodes.length) {
          const notifyTitle = "رسالة واجب جديدة";
          const notifyBody = `${String(hw.title ?? "واجب")} | ${studentName} | من: ${String(actor.name ?? "المعلم")}`;
          await db.collection("notifications").add({
            title: notifyTitle,
            body: notifyBody,
            createdAt: Timestamp.now(),
            createdBy: { name: String(actor.name ?? ""), code: session.code, role },
            audience: { type: "users", userCodes: targetCodes },
            data: { type: "homework_message", homeworkId, studentCode: targetStudentCode },
          });

          const tokenSet = new Set<string>();
          for (const codesChunk of splitChunks(targetCodes, 10)) {
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
          if (tokens.length) {
            const messaging = getMessaging();
            for (const tokenChunk of splitChunks(tokens, 500)) {
              await messaging.sendEachForMulticast({
                tokens: tokenChunk,
                notification: { title: notifyTitle, body: notifyBody },
                data: { type: "homework_message", homeworkId, studentCode: targetStudentCode },
              });
            }
          }
        }
      } catch (notifyError) {
        console.error("Homework teacher message notification failed:", notifyError);
      }
      return NextResponse.json({ ok: true });
    }

    if (role === "student" || role === "parent") {
      const classes = await getClassesForUser(db, role, actor);
      const rawHw = hw as { classIds?: unknown; classId?: unknown; class?: unknown };
      const classIds = [
        ...normalizeStringList(rawHw.classIds, true),
        ...normalizeStringList(rawHw.classId, true),
        ...normalizeStringList(rawHw.class, true),
      ];
      if (!classes.some((cls) => classIds.some((hwCls) => classMatches(cls, hwCls)))) {
        return NextResponse.json({ ok: false, message: "Not allowed." }, { status: 403 });
      }
      const dueAtRaw = (doc.data() as { dueAt?: string }).dueAt;
      if (dueAtRaw) {
        const dueTime = new Date(dueAtRaw).getTime();
        if (!Number.isNaN(dueTime) && Date.now() > dueTime) {
          return NextResponse.json(
            { ok: false, message: "انتهى موعد تسليم الواجب." },
            { status: 400 }
          );
        }
      }
      const studentCode =
        role === "student"
          ? session.code
          : String(form.get("studentCode") ?? "").trim();
      if (!studentCode) {
        return NextResponse.json({ ok: false, message: "Missing student code." }, { status: 400 });
      }
      const studentDoc = await db.collection("users").doc(studentCode).get();
      const studentData = studentDoc.exists
        ? (studentDoc.data() as { name?: string; classes?: string[] })
        : {};
      const studentName = String(studentData?.name ?? "").trim();
      const studentClasses = Array.isArray(studentData?.classes)
        ? studentData.classes.map((c) => String(c).trim()).filter(Boolean)
        : [];
      let filePayload: { fileUrl?: string; fileName?: string; mimeType?: string } = {};
      if (file instanceof File) {
        const saved = await saveUploadedFile(homeworkId, file);
        if (!saved.ok) {
          return NextResponse.json({ ok: false, message: saved.message }, { status: 400 });
        }
        filePayload = { fileUrl: saved.url, fileName: saved.fileName, mimeType: saved.mimeType };
      }
      const subRef = doc.ref.collection("submissions").doc(studentCode);
      await subRef.set(
        {
          studentCode,
          studentName,
          className: studentClasses[0] ?? "",
          updatedAt: Timestamp.now(),
        },
        { merge: true }
      );
      await subRef.collection("messages").add({
        message,
        ...filePayload,
        createdAt: Timestamp.now(),
        createdBy: { code: session.code, name: actor.name ?? "", role },
      });

      try {
        const teacherCode = String(hw.createdBy?.code ?? "").trim();
        if (teacherCode) {
          const notifyTitle = "تسليم أو رسالة واجب";
          const notifyBody = `${String(hw.title ?? "واجب")} | ${studentName || studentCode}`;
          await db.collection("notifications").add({
            title: notifyTitle,
            body: notifyBody,
            createdAt: Timestamp.now(),
            createdBy: { name: String(studentName || studentCode), code: session.code, role },
            audience: { type: "users", userCodes: [teacherCode] },
            data: { type: "homework_message", homeworkId, studentCode },
          });

          const tokensSnapshot = await db
            .collection("pushTokens")
            .where("userCode", "==", teacherCode)
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
                data: { type: "homework_message", homeworkId, studentCode },
              });
            }
          }
        }
      } catch (notifyError) {
        console.error("Homework student message notification failed:", notifyError);
      }
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ ok: false, message: "Not allowed." }, { status: 403 });
  } catch (error) {
    console.error("POST /api/homework/[id] error:", error);
    return NextResponse.json({ ok: false, message: "Failed to submit homework." }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = decodeSessionFromCookie(request);
    if (!session?.code || !session?.role) {
      return NextResponse.json({ ok: false, message: "Unauthorized." }, { status: 401 });
    }
    const db = getAdminDb();
    const actor = await loadActor(db, session.code);
    if (!actor) {
      return NextResponse.json({ ok: false, message: "User not found." }, { status: 404 });
    }
    const role = normalizeRole(String(actor.role ?? session.role ?? "").trim().toLowerCase());
    if (role !== "teacher") {
      return NextResponse.json({ ok: false, message: "Not allowed." }, { status: 403 });
    }
    const { id } = await params;
    const homeworkId = String(id ?? "").trim();
    if (!homeworkId) {
      return NextResponse.json({ ok: false, message: "Missing homework id." }, { status: 400 });
    }
    const doc = await db.collection("homeworks").doc(homeworkId).get();
    if (!doc.exists) {
      return NextResponse.json({ ok: false, message: "Homework not found." }, { status: 404 });
    }
    const hw = doc.data() as {
      createdBy?: { code?: string };
      title?: string;
      classIds?: string[];
      maxScore?: number;
    };
    if (String(hw.createdBy?.code ?? "") !== session.code) {
      return NextResponse.json({ ok: false, message: "Not allowed." }, { status: 403 });
    }

    const body = await request.json();

    const scoreRaw = body.score;
    const targetStudent = String(body.studentCode ?? "").trim();
    if (scoreRaw !== undefined && targetStudent) {
      const homeworkMaxScoreRaw = Number(body.maxScore ?? hw.maxScore ?? 20);
      const homeworkMaxScore = Number.isNaN(homeworkMaxScoreRaw) || homeworkMaxScoreRaw <= 0 ? 20 : homeworkMaxScoreRaw;
      const score = Number(scoreRaw);
      if (Number.isNaN(score) || score < 0 || score > homeworkMaxScore) {
        return NextResponse.json({ ok: false, message: "درجة غير صالحة." }, { status: 400 });
      }
      const subRef = doc.ref.collection("submissions").doc(targetStudent);
      await subRef.set(
        {
          studentCode: targetStudent,
          score,
          maxScore: homeworkMaxScore,
          gradedAt: Timestamp.now(),
        },
        { merge: true }
      );

      await db.collection("homeworkGrades").add({
        code: targetStudent,
        homeworkId,
        title: String(hw.title ?? "واجب"),
        subject: String(body.subject ?? ""),
        score,
        maxScore: homeworkMaxScore,
        createdByRole: "teacher",
        createdAt: Timestamp.now(),
      });

      try {
        const studentDoc = await db.collection("users").doc(targetStudent).get();
        const studentData = studentDoc.exists
          ? (studentDoc.data() as { name?: string; parentCodes?: string[] })
          : {};
        const studentName = String(studentData?.name ?? targetStudent).trim();
        const parentCodes = Array.isArray(studentData?.parentCodes)
          ? studentData.parentCodes.map((code) => String(code).trim()).filter(Boolean)
          : [];
        const targetCodes = Array.from(new Set([targetStudent, ...parentCodes]));
        const studentClasses = studentDoc.exists
          ? Array.isArray((studentDoc.data() as { classes?: string[] }).classes)
            ? (studentDoc.data() as { classes?: string[] }).classes!.map((c) => String(c).trim()).filter(Boolean)
            : []
          : [];

        if (targetCodes.length) {
          const notifyTitle = "تحديث درجة واجب";
          const notifyBody = `${String(hw.title ?? "واجب")} | ${studentName} | الدرجة: ${score}/${homeworkMaxScore}`;
          await db.collection("notifications").add({
            title: notifyTitle,
            body: notifyBody,
            createdAt: Timestamp.now(),
            createdBy: { name: String(actor.name ?? ""), code: session.code, role },
            audience: { type: "users", userCodes: targetCodes },
            data: { type: "homework_grade", homeworkId, studentCode: targetStudent },
          });

          const tokenSet = new Set<string>();
          for (const codesChunk of splitChunks(targetCodes, 10)) {
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
          if (tokens.length) {
            const messaging = getMessaging();
            for (const tokenChunk of splitChunks(tokens, 500)) {
              await messaging.sendEachForMulticast({
                tokens: tokenChunk,
                notification: { title: notifyTitle, body: notifyBody },
                data: { type: "homework_grade", homeworkId, studentCode: targetStudent },
              });
            }
          }
        }

        if (studentClasses.length) {
          for (const classId of studentClasses) {
            await updateCommitmentTop3AndNotify(db, classId);
          }
        }
      } catch (notifyError) {
        console.error("Homework grade notification failed:", notifyError);
      }

      return NextResponse.json({ ok: true });
    }

    const closeNow = Boolean(body.closeNow);
    if (closeNow) {
      const dueAt = new Date().toISOString();
      await doc.ref.update({ dueAt });

      const classIds = Array.isArray(hw.classIds) ? hw.classIds : [];
      if (classIds.length) {
        const title = "تم إغلاق الواجب";
        const bodyText = `تم إغلاق التسليم لواجب: ${String(hw.title ?? "واجب")}`;
        const createdAt = Timestamp.now();
        const notifDocs = classIds.map((cls) => ({
          title,
          body: bodyText,
          createdAt,
          createdBy: { name: actor.name ?? "", code: session.code, role },
          audience: { type: "class", classId: cls, className: cls },
        }));
        await Promise.all(
          notifDocs.map((payload) => db.collection("notifications").add(payload))
        );
      }

      return NextResponse.json({ ok: true });
    }

    const dueAt = String(body.dueAt ?? "").trim();
    if (!dueAt) {
      return NextResponse.json({ ok: false, message: "Missing due date." }, { status: 400 });
    }
    const dueDate = new Date(dueAt);
    if (Number.isNaN(dueDate.getTime())) {
      return NextResponse.json({ ok: false, message: "Invalid date." }, { status: 400 });
    }

    await doc.ref.update({ dueAt });

    const classIds = Array.isArray(hw.classIds) ? hw.classIds : [];
    if (classIds.length) {
      const title = "تم تمديد موعد الواجب";
      const bodyText = `تم تمديد موعد تسليم واجب: ${String(hw.title ?? "واجب")}`;
      const createdAt = Timestamp.now();

      const notifDocs = classIds.map((cls) => ({
        title,
        body: bodyText,
        createdAt,
        createdBy: { name: actor.name ?? "", code: session.code, role },
        audience: { type: "class", classId: cls, className: cls },
      }));

      await Promise.all(
        notifDocs.map((payload) => db.collection("notifications").add(payload))
      );

      try {
        const tokensSnapshot = await db
          .collection("pushTokens")
          .where("classIds", "array-contains-any", classIds.slice(0, 10))
          .get();
        const tokens = tokensSnapshot.docs
          .map((d) => (d.data() as { token?: string }).token)
          .filter(Boolean) as string[];

        if (tokens.length) {
          const { getMessaging } = await import("firebase-admin/messaging");
          const chunks: string[][] = [];
          for (let i = 0; i < tokens.length; i += 500) {
            chunks.push(tokens.slice(i, i + 500));
          }
          await Promise.all(
            chunks.map((chunk) =>
              getMessaging().sendEachForMulticast({
                tokens: chunk,
                notification: { title, body: bodyText },
                data: { type: "homework", homeworkId },
              })
            )
          );
        }
      } catch (pushError) {
        console.error("Homework extend push failed:", pushError);
      }
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("PATCH /api/homework/[id] error:", error);
    return NextResponse.json({ ok: false, message: "Failed to update homework." }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = decodeSessionFromCookie(request);
    if (!session?.code || !session?.role) {
      return NextResponse.json({ ok: false, message: "Unauthorized." }, { status: 401 });
    }
    const db = getAdminDb();
    const actor = await loadActor(db, session.code);
    if (!actor) {
      return NextResponse.json({ ok: false, message: "User not found." }, { status: 404 });
    }
    const role = normalizeRole(String(actor.role ?? session.role ?? "").trim().toLowerCase());
    if (role !== "teacher") {
      return NextResponse.json({ ok: false, message: "Not allowed." }, { status: 403 });
    }

    const { id } = await params;
    const homeworkId = String(id ?? "").trim();
    if (!homeworkId) {
      return NextResponse.json({ ok: false, message: "Missing homework id." }, { status: 400 });
    }

    const doc = await db.collection("homeworks").doc(homeworkId).get();
    if (!doc.exists) {
      return NextResponse.json({ ok: false, message: "Homework not found." }, { status: 404 });
    }
    const hw = doc.data() as { createdBy?: { code?: string } };
    if (String(hw.createdBy?.code ?? "") !== session.code) {
      return NextResponse.json({ ok: false, message: "Not allowed." }, { status: 403 });
    }

    const url = new URL(request.url);
    const action = String(url.searchParams.get("action") ?? "").trim().toLowerCase();
    const studentCode = String(url.searchParams.get("studentCode") ?? "").trim();

    if (action === "hide") {
      await doc.ref.update({
        hiddenFor: FieldValue.arrayUnion(session.code),
      });
      return NextResponse.json({ ok: true });
    }

    if (action === "deleteall") {
      const subsSnapshot = await doc.ref.collection("submissions").get();
      for (const subDoc of subsSnapshot.docs) {
        const msgsSnap = await subDoc.ref.collection("messages").get();
        let batch = db.batch();
        let count = 0;
        for (const msg of msgsSnap.docs) {
          batch.delete(msg.ref);
          count += 1;
          if (count % 400 === 0) {
            await batch.commit();
            batch = db.batch();
          }
        }
        if (count % 400 !== 0) {
          await batch.commit();
        }
        await subDoc.ref.delete();
      }
      const gradeSnapshot = await db
        .collection("homeworkGrades")
        .where("homeworkId", "==", homeworkId)
        .get();
      if (!gradeSnapshot.empty) {
        let gradeBatch = db.batch();
        let gradeCount = 0;
        for (const gradeDoc of gradeSnapshot.docs) {
          gradeBatch.delete(gradeDoc.ref);
          gradeCount += 1;
          if (gradeCount % 400 === 0) {
            await gradeBatch.commit();
            gradeBatch = db.batch();
          }
        }
        if (gradeCount % 400 !== 0) {
          await gradeBatch.commit();
        }
      }
      await doc.ref.delete();
      return NextResponse.json({ ok: true });
    }

    if (action === "clear-submissions") {
      const subsSnapshot = await doc.ref.collection("submissions").get();
      for (const subDoc of subsSnapshot.docs) {
        const msgsSnap = await subDoc.ref.collection("messages").get();
        let batch = db.batch();
        let count = 0;
        for (const msg of msgsSnap.docs) {
          batch.delete(msg.ref);
          count += 1;
          if (count % 400 === 0) {
            await batch.commit();
            batch = db.batch();
          }
        }
        if (count % 400 !== 0) {
          await batch.commit();
        }
        await subDoc.ref.delete();
      }
      const gradeSnapshot = await db
        .collection("homeworkGrades")
        .where("homeworkId", "==", homeworkId)
        .get();
      if (!gradeSnapshot.empty) {
        let gradeBatch = db.batch();
        let gradeCount = 0;
        for (const gradeDoc of gradeSnapshot.docs) {
          gradeBatch.delete(gradeDoc.ref);
          gradeCount += 1;
          if (gradeCount % 400 === 0) {
            await gradeBatch.commit();
            gradeBatch = db.batch();
          }
        }
        if (gradeCount % 400 !== 0) {
          await gradeBatch.commit();
        }
      }
      return NextResponse.json({ ok: true });
    }

    if (!studentCode) {
      return NextResponse.json({ ok: false, message: "Missing student code." }, { status: 400 });
    }

    const subRef = doc.ref.collection("submissions").doc(studentCode);
    const messagesSnap = await subRef.collection("messages").get();
    let batch = db.batch();
    let count = 0;
    for (const msg of messagesSnap.docs) {
      batch.delete(msg.ref);
      count += 1;
      if (count % 400 === 0) {
        await batch.commit();
        batch = db.batch();
      }
    }
    if (count % 400 !== 0) {
      await batch.commit();
    }

    await subRef.delete();

    const studentGradeSnapshot = await db
      .collection("homeworkGrades")
      .where("homeworkId", "==", homeworkId)
      .where("code", "==", studentCode)
      .get();
    if (!studentGradeSnapshot.empty) {
      let gradeBatch = db.batch();
      let gradeCount = 0;
      for (const gradeDoc of studentGradeSnapshot.docs) {
        gradeBatch.delete(gradeDoc.ref);
        gradeCount += 1;
        if (gradeCount % 400 === 0) {
          await gradeBatch.commit();
          gradeBatch = db.batch();
        }
      }
      if (gradeCount % 400 !== 0) {
        await gradeBatch.commit();
      }
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("DELETE /api/homework/[id] error:", error);
    return NextResponse.json({ ok: false, message: "Failed to delete submission." }, { status: 500 });
  }
}
