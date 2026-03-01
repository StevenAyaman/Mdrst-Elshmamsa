import { NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { getAdminDb } from "@/lib/firebase/admin";

export const runtime = "nodejs";

type SessionPayload = { code?: string; role?: string } | null;
const SUBJECTS = new Set(["طقس", "اجبيه", "قطمارس", "الحان", "قبطي"]);

const allowedFileTypes = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/jpg",
  "video/mp4",
  "video/quicktime",
]);

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
  return normalizeClassId(value).replace(/[BG]$/i, "");
}

function classMatches(userClassValue: string, reportClassValue: string) {
  const a = normalizeClassId(userClassValue);
  const b = normalizeClassId(reportClassValue);
  if (!a || !b) return false;
  if (a === b) return true;
  return classBase(a) === classBase(b);
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

async function saveUploadedFile(reportId: string, file: File) {
  if (!allowedFileTypes.has(file.type)) {
    return { ok: false as const, message: "نوع الملف غير مسموح." };
  }
  const buffer = Buffer.from(await file.arrayBuffer());
  const cleanName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const objectName = `${Date.now()}-${cleanName}`;
  const relativeDir = path.join("uploads", "lesson-reports", reportId);
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

async function getParentClasses(db: ReturnType<typeof getAdminDb>, childrenCodes: string[]) {
  const set = new Set<string>();
  for (const code of childrenCodes) {
    const child = await loadActor(db, code);
    const classes = Array.isArray(child?.classes)
      ? child!.classes.map((c) => normalizeClassId(String(c))).filter(Boolean)
      : [];
    classes.forEach((c) => set.add(c));
  }
  return Array.from(set);
}

export async function GET(request: Request) {
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
    const actorClasses = Array.isArray(actor.classes)
      ? actor.classes.map((c) => normalizeClassId(String(c))).filter(Boolean)
      : [];

    let allowedClasses: string[] = [];
    if (role === "teacher") {
      allowedClasses = actorClasses;
    } else if (role === "student") {
      allowedClasses = actorClasses;
    } else if (role === "parent") {
      const children = Array.isArray(actor.childrenCodes)
        ? actor.childrenCodes.map((c) => String(c).trim()).filter(Boolean)
        : [];
      allowedClasses = await getParentClasses(db, children);
    } else if (role === "admin") {
      const classFilter = normalizeClassId(new URL(request.url).searchParams.get("classId") ?? "");
      if (classFilter) {
        allowedClasses = [classFilter];
      } else {
        const classesSnap = await db.collection("classes").limit(200).get();
        allowedClasses = classesSnap.docs.map((doc) => normalizeClassId(doc.id)).filter(Boolean);
      }
    } else {
      return NextResponse.json({ ok: false, message: "Not allowed." }, { status: 403 });
    }

    if (!allowedClasses.length) return NextResponse.json({ ok: true, data: [] });

    const url = new URL(request.url);
    const filterClassId = normalizeClassId(url.searchParams.get("classId") ?? "");
    const exactDate = String(url.searchParams.get("lessonDate") ?? "").trim();
    const fromDate = String(url.searchParams.get("fromDate") ?? "").trim();
    const toDate = String(url.searchParams.get("toDate") ?? "").trim();

    const snapshot = await db.collection("lesson_reports").orderBy("lessonDate", "desc").limit(500).get();
    const data = snapshot.docs
      .map((doc) => ({ id: doc.id, ...(doc.data() as Record<string, unknown>) }))
      .filter((item) => {
        const reportClassId = normalizeClassId(String((item as { classId?: string }).classId ?? ""));
        if (!allowedClasses.some((cls) => classMatches(cls, reportClassId))) return false;
        if (filterClassId && !classMatches(filterClassId, reportClassId)) return false;
        const lessonDate = String((item as { lessonDate?: string }).lessonDate ?? "").trim();
        if (exactDate && lessonDate !== exactDate) return false;
        if (fromDate && lessonDate && lessonDate < fromDate) return false;
        if (toDate && lessonDate && lessonDate > toDate) return false;
        return true;
      });

    return NextResponse.json({ ok: true, data });
  } catch (error) {
    console.error("GET /api/lesson-reports error:", error);
    return NextResponse.json({ ok: false, message: "Failed to load reports." }, { status: 500 });
  }
}

export async function POST(request: Request) {
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

    const form = await request.formData();
    const body = String(form.get("body") ?? "").trim();
    const subject = String(form.get("subject") ?? "").trim();
    const lessonDate = String(form.get("lessonDate") ?? "").trim();
    const classId = normalizeClassId(String(form.get("classId") ?? "").trim());
    const teacherClasses = Array.isArray(actor.classes)
      ? actor.classes.map((c) => normalizeClassId(String(c))).filter(Boolean)
      : [];

    if (!subject || !lessonDate || !classId || !body) {
      return NextResponse.json({ ok: false, message: "Missing required fields." }, { status: 400 });
    }
    if (!SUBJECTS.has(subject)) {
      return NextResponse.json({ ok: false, message: "Subject not allowed." }, { status: 400 });
    }
    if (!teacherClasses.some((cls) => classMatches(cls, classId))) {
      return NextResponse.json({ ok: false, message: "Not allowed for this class." }, { status: 403 });
    }

    const title = `تقرير حصة ${lessonDate} ${classId}`;

    const ref = await db.collection("lesson_reports").add({
      title,
      body,
      subject,
      classId,
      lessonDate,
      createdAt: Timestamp.now(),
      createdBy: { code: session.code, name: String(actor.name ?? ""), role },
      attachments: [],
    });

    const attachments: Array<{ fileUrl: string; fileName: string; mimeType: string }> = [];
    const files = form.getAll("files");
    for (const item of files) {
      if (!(item instanceof File)) continue;
      const saved = await saveUploadedFile(ref.id, item);
      if (!saved.ok) continue;
      attachments.push({
        fileUrl: saved.url,
        fileName: saved.fileName,
        mimeType: saved.mimeType,
      });
    }
    if (attachments.length) {
      await ref.update({ attachments });
    }

    try {
      const notifyTitle = "تقرير حصة جديد";
      const notifyBody = `${title} | ${subject} | الفصل: ${classId} | التاريخ: ${lessonDate}`;
      await db.collection("notifications").add({
        title: notifyTitle,
        body: notifyBody,
        createdAt: Timestamp.now(),
        createdBy: { code: session.code, name: String(actor.name ?? ""), role },
        audience: { type: "class" as const, classId, className: classId },
        meta: { type: "lesson-report", reportId: ref.id },
      });

      const tokensSnapshot = await db
        .collection("pushTokens")
        .where("classIds", "array-contains", classId)
        .get();
      const tokens = tokensSnapshot.docs
        .map((doc) => doc.data() as { token?: string; role?: string })
        .filter((item) => {
          const tokenRole = normalizeRole(String(item.role ?? "").trim().toLowerCase());
          return tokenRole === "student" || tokenRole === "parent";
        })
        .map((item) => String(item.token ?? "").trim())
        .filter(Boolean);

      if (tokens.length) {
        const messaging = getMessaging();
        const chunks: string[][] = [];
        for (let i = 0; i < tokens.length; i += 500) {
          chunks.push(tokens.slice(i, i + 500));
        }
        await Promise.all(
          chunks.map((chunk) =>
            messaging.sendEachForMulticast({
              tokens: chunk,
              notification: { title: notifyTitle, body: notifyBody },
              data: { type: "lesson-report", reportId: ref.id, classId },
            })
          )
        );
      }
    } catch (notifyError) {
      console.error("Lesson report notification failed:", notifyError);
    }

    const doc = await ref.get();
    return NextResponse.json({ ok: true, data: { id: ref.id, ...doc.data() } });
  } catch (error) {
    console.error("POST /api/lesson-reports error:", error);
    return NextResponse.json({ ok: false, message: "Failed to create report." }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
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
    if (role !== "teacher" && role !== "admin") {
      return NextResponse.json({ ok: false, message: "Not allowed." }, { status: 403 });
    }

    const payload = (await request.json()) as {
      id?: string;
      subject?: string;
      lessonDate?: string;
      body?: string;
      classId?: string;
    };

    const id = String(payload.id ?? "").trim();
    const subject = String(payload.subject ?? "").trim();
    const lessonDate = String(payload.lessonDate ?? "").trim();
    const body = String(payload.body ?? "").trim();
    const classId = normalizeClassId(String(payload.classId ?? "").trim());

    if (!id || !subject || !lessonDate || !body || !classId) {
      return NextResponse.json({ ok: false, message: "Missing required fields." }, { status: 400 });
    }
    if (!SUBJECTS.has(subject)) {
      return NextResponse.json({ ok: false, message: "Subject not allowed." }, { status: 400 });
    }

    const ref = db.collection("lesson_reports").doc(id);
    const oldDoc = await ref.get();
    if (!oldDoc.exists) {
      return NextResponse.json({ ok: false, message: "Report not found." }, { status: 404 });
    }

    const oldData = oldDoc.data() as {
      classId?: string;
      createdBy?: { code?: string; role?: string };
    };
    const ownerCode = String(oldData.createdBy?.code ?? "").trim();
    if (role !== "admin" && (!ownerCode || ownerCode !== session.code)) {
      return NextResponse.json({ ok: false, message: "Not allowed to edit this report." }, { status: 403 });
    }

    if (role !== "admin") {
      const teacherClasses = Array.isArray(actor.classes)
        ? actor.classes.map((c) => normalizeClassId(String(c))).filter(Boolean)
        : [];
      if (!teacherClasses.some((cls) => classMatches(cls, classId))) {
        return NextResponse.json({ ok: false, message: "Not allowed for this class." }, { status: 403 });
      }
    }

    const title = `تقرير حصة ${lessonDate} ${classId}`;
    await ref.update({
      title,
      body,
      subject,
      classId,
      lessonDate,
      updatedAt: Timestamp.now(),
    });

    const updated = await ref.get();
    return NextResponse.json({ ok: true, data: { id: updated.id, ...updated.data() } });
  } catch (error) {
    console.error("PATCH /api/lesson-reports error:", error);
    return NextResponse.json({ ok: false, message: "Failed to update report." }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
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
    if (role !== "teacher" && role !== "admin") {
      return NextResponse.json({ ok: false, message: "Not allowed." }, { status: 403 });
    }

    const url = new URL(request.url);
    const id = String(url.searchParams.get("id") ?? "").trim();
    const lessonDate = String(url.searchParams.get("lessonDate") ?? "").trim();
    if (!id && !lessonDate) {
      return NextResponse.json({ ok: false, message: "Missing id or lessonDate." }, { status: 400 });
    }

    if (lessonDate) {
      let query = db.collection("lesson_reports").where("lessonDate", "==", lessonDate);
      if (role !== "admin") {
        query = query.where("createdBy.code", "==", session.code);
      }
      const snap = await query.get();
      if (snap.empty) {
        return NextResponse.json({ ok: true, deleted: 0 });
      }
      const batch = db.batch();
      snap.docs.forEach((d) => batch.delete(d.ref));
      await batch.commit();
      return NextResponse.json({ ok: true, deleted: snap.size });
    }

    const ref = db.collection("lesson_reports").doc(id);
    const doc = await ref.get();
    if (!doc.exists) {
      return NextResponse.json({ ok: false, message: "Report not found." }, { status: 404 });
    }

    const data = doc.data() as { createdBy?: { code?: string } };
    const ownerCode = String(data.createdBy?.code ?? "").trim();
    if (role !== "admin" && ownerCode !== session.code) {
      return NextResponse.json({ ok: false, message: "Not allowed to delete this report." }, { status: 403 });
    }

    await ref.delete();
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("DELETE /api/lesson-reports error:", error);
    return NextResponse.json({ ok: false, message: "Failed to delete report." }, { status: 500 });
  }
}
