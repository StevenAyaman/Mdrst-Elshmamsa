import { NextResponse } from "next/server";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
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
]);
const maxFileSizeBytes = 20 * 1024 * 1024;

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

function isIsoDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
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

async function getSubmittedHomeworkIdsForCodes(
  db: ReturnType<typeof getAdminDb>,
  studentCodes: string[],
) {
  const ids = new Set<string>();
  for (const code of studentCodes) {
    if (!code) continue;
    try {
      const snap = await db.collectionGroup("submissions").where("studentCode", "==", code).get();
      for (const doc of snap.docs) {
        const homeworkId = doc.ref.parent.parent?.id;
        if (homeworkId) ids.add(homeworkId);
      }
    } catch (error) {
      console.error("getSubmittedHomeworkIdsForCodes failed:", error);
    }
  }
  return ids;
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

export async function GET(request: Request) {
  try {
    const session = decodeSessionFromCookie(request);
    if (!session?.code || !session?.role) {
      return NextResponse.json({ ok: false, message: "Unauthorized." }, { status: 401 });
    }
    const actorCode = session.code;
    const db = getAdminDb();
    const actor = await loadActor(db, actorCode);
    if (!actor) {
      return NextResponse.json({ ok: false, message: "User not found." }, { status: 404 });
    }
    const role = normalizeRole(String(actor.role ?? session.role ?? "").trim().toLowerCase());

    if (role === "teacher") {
      const snapshot = await db
        .collection("homeworks")
        .where("createdBy.code", "==", session.code)
        .limit(200)
        .get();
      const data = snapshot.docs
        .map((doc) => ({ id: doc.id, ...(doc.data() as Record<string, unknown>) }))
        .filter((doc) => {
          const hiddenFor = Array.isArray((doc as { hiddenFor?: string[] }).hiddenFor)
            ? (doc as { hiddenFor?: string[] }).hiddenFor!
            : [];
          return !hiddenFor.includes(actorCode);
        })
        .sort((a: Record<string, unknown>, b: Record<string, unknown>) => {
          const aTime =
            (a.createdAt as { seconds?: number; _seconds?: number } | undefined)?._seconds ??
            (a.createdAt as { seconds?: number; _seconds?: number } | undefined)?.seconds ??
            0;
          const bTime =
            (b.createdAt as { seconds?: number; _seconds?: number } | undefined)?._seconds ??
            (b.createdAt as { seconds?: number; _seconds?: number } | undefined)?.seconds ??
            0;
          return bTime - aTime;
        });
      return NextResponse.json({ ok: true, data });
    }

    if (role === "student" || role === "parent") {
      const classes = await getClassesForUser(db, role, actor);
      if (!classes.length) return NextResponse.json({ ok: true, data: [] });
      const targetStudentCodes =
        role === "student"
          ? [actorCode]
          : normalizeStringList(actor.childrenCodes);
      const submittedHomeworkIds = await getSubmittedHomeworkIdsForCodes(db, targetStudentCodes);
      const snapshot = await db.collection("homeworks").limit(500).get();
      const data = snapshot.docs
        .map((doc) => ({
          id: doc.id,
          ...(doc.data() as Record<string, unknown>),
          submitted: submittedHomeworkIds.has(doc.id),
        }))
        .filter((item) => {
          const raw = item as { classIds?: unknown[]; classId?: unknown; class?: unknown };
          const classIds: string[] = [];
          if (Array.isArray(raw.classIds)) {
            classIds.push(
              ...raw.classIds
                .map((c) => normalizeClassId(String(c ?? "")))
                .filter(Boolean)
            );
          }
          if (raw.classId !== undefined && raw.classId !== null) {
            classIds.push(normalizeClassId(String(raw.classId)));
          }
          if (raw.class !== undefined && raw.class !== null) {
            classIds.push(normalizeClassId(String(raw.class)));
          }
          return classIds.some((cls) => classes.some((userCls) => classMatches(userCls, cls)));
        })
        .sort((a: Record<string, unknown>, b: Record<string, unknown>) => {
          const aTime =
            (a.createdAt as { seconds?: number; _seconds?: number } | undefined)?._seconds ??
            (a.createdAt as { seconds?: number; _seconds?: number } | undefined)?.seconds ??
            0;
          const bTime =
            (b.createdAt as { seconds?: number; _seconds?: number } | undefined)?._seconds ??
            (b.createdAt as { seconds?: number; _seconds?: number } | undefined)?.seconds ??
            0;
          return bTime - aTime;
        });
      return NextResponse.json({ ok: true, data });
    }

    return NextResponse.json({ ok: false, message: "Not allowed." }, { status: 403 });
  } catch (error) {
    console.error("GET /api/homework error:", error);
    return NextResponse.json(
      {
        ok: false,
        message:
          process.env.NODE_ENV === "development" && error instanceof Error
            ? `Failed to load homework: ${error.message}`
            : "Failed to load homework.",
      },
      { status: 500 }
    );
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
    const title = String(form.get("title") ?? "").trim();
    const subject = String(form.get("subject") ?? "").trim();
    const description = String(form.get("description") ?? "").trim();
    const publishDate = String(form.get("publishDate") ?? "").trim();
    const dueAt = String(form.get("dueAt") ?? "").trim();
    const maxScoreRaw = String(form.get("maxScore") ?? "").trim();
    const maxScore = Number(maxScoreRaw || "20");
    const classIdsRaw = String(form.get("classIds") ?? "").trim();
    const classIds = classIdsRaw
      .split(/[,،]/)
      .map((v) => normalizeClassId(v))
      .filter(Boolean);

    if (!title || !subject || !publishDate || !dueAt || !classIds.length) {
      return NextResponse.json({ ok: false, message: "Missing required fields." }, { status: 400 });
    }
    if (Number.isNaN(maxScore) || maxScore <= 0) {
      return NextResponse.json({ ok: false, message: "الدرجة القصوى غير صالحة." }, { status: 400 });
    }
    if (!isIsoDate(publishDate)) {
      return NextResponse.json({ ok: false, message: "تاريخ نشر الواجب غير صحيح." }, { status: 400 });
    }
    if (!SUBJECTS.has(subject)) {
      return NextResponse.json({ ok: false, message: "Subject not allowed." }, { status: 400 });
    }

    const activePeriodSnapshot = await db
      .collection("service_periods")
      .where("active", "==", true)
      .limit(1)
      .get();
    if (activePeriodSnapshot.empty) {
      return NextResponse.json({ ok: false, message: "لا توجد فترة خدمة فعالة حالياً." }, { status: 400 });
    }
    const activePeriodDoc = activePeriodSnapshot.docs[0];
    const activePeriod = activePeriodDoc.data() as { startDate?: string; endDate?: string; name?: string };
    const periodStart = String(activePeriod.startDate ?? "").trim();
    const periodEnd = String(activePeriod.endDate ?? "").trim();
    if (!isIsoDate(periodStart) || !isIsoDate(periodEnd)) {
      return NextResponse.json({ ok: false, message: "بيانات الفترة الفعالة غير صالحة." }, { status: 400 });
    }
    if (publishDate < periodStart || publishDate > periodEnd) {
      return NextResponse.json(
        {
          ok: false,
          message: `تاريخ النشر يجب أن يكون داخل الفترة الفعالة (${periodStart} - ${periodEnd}).`,
        },
        { status: 400 }
      );
    }

    const file = form.get("file");
    const ref = await db.collection("homeworks").add({
      title,
      subject,
      description,
      publishDate,
      dueAt,
      classIds,
      maxScore,
      periodId: activePeriodDoc.id,
      periodName: String(activePeriod.name ?? ""),
      createdAt: Timestamp.now(),
      createdBy: { code: session.code, name: actor.name ?? "", role },
      hiddenFor: [],
    });

    let filePayload: { fileUrl?: string; fileName?: string; mimeType?: string } = {};
    if (file instanceof File) {
      const saved = await saveUploadedFile(ref.id, file);
      if (!saved.ok) {
        return NextResponse.json({ ok: false, message: saved.message }, { status: 400 });
      }
      filePayload = {
        fileUrl: saved.url,
        fileName: saved.fileName,
        mimeType: saved.mimeType,
      };
      await ref.update(filePayload);
    }

    // Create class notifications and push for students/parents in target classes.
    try {
      const dueText = dueAt ? dueAt.replace("T", " ") : "";
      const notifyTitle = "واجب جديد";
      const notifyBody = `${title}${subject ? ` - ${subject}` : ""}${dueText ? ` | آخر موعد: ${dueText}` : ""}`;
      const notifPayloads = classIds.map((cls) => ({
        title: notifyTitle,
        body: notifyBody,
        createdAt: Timestamp.now(),
        createdBy: { code: session.code, name: String(actor.name ?? ""), role },
        audience: { type: "class" as const, classId: cls, className: cls },
        meta: { type: "homework", homeworkId: ref.id },
      }));
      await Promise.all(notifPayloads.map((payload) => db.collection("notifications").add(payload)));

      const tokenSets = await Promise.all(
        classIds.map((cls) =>
          db.collection("pushTokens").where("classIds", "array-contains", cls).get()
        )
      );
      const tokenSet = new Set<string>();
      for (const snapshot of tokenSets) {
        for (const doc of snapshot.docs) {
          const item = doc.data() as { token?: string; role?: string };
          const token = String(item.token ?? "").trim();
          const tokenRole = normalizeRole(String(item.role ?? "").trim().toLowerCase());
          if (!token) continue;
          if (tokenRole === "student" || tokenRole === "parent") {
            tokenSet.add(token);
          }
        }
      }

      const tokens = Array.from(tokenSet);
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
              data: { type: "homework", homeworkId: ref.id },
            })
          )
        );
      }
    } catch (notifyError) {
      console.error("Homework notification failed:", notifyError);
    }

    const savedDoc = await ref.get();
    return NextResponse.json({ ok: true, data: { id: ref.id, ...savedDoc.data() } });
  } catch (error) {
    console.error("POST /api/homework error:", error);
    return NextResponse.json({ ok: false, message: "Failed to create homework." }, { status: 500 });
  }
}
