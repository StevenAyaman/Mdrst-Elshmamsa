import { NextResponse } from "next/server";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { getAdminDb } from "@/lib/firebase/admin";

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
