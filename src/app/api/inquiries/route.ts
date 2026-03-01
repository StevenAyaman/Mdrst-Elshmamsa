import { randomUUID } from "crypto";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";
import { getAdminDb } from "@/lib/firebase/admin";

export const runtime = "nodejs";

type SessionPayload = { code?: string; role?: string } | null;

const allowedFileTypes = new Set([
  "application/pdf",
  "audio/mpeg",
  "audio/mp3",
  "image/png",
  "image/jpeg",
  "image/jpg",
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

function splitChunks<T>(arr: T[], size: number) {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

async function getNotesTokens(db: ReturnType<typeof getAdminDb>) {
  const notesSnapshot = await db.collection("users").where("role", "==", "notes").get();
  if (notesSnapshot.empty) return [];
  const noteCodes = notesSnapshot.docs
    .map((doc) => String((doc.data() as { code?: string }).code ?? doc.id).trim())
    .filter(Boolean);
  if (!noteCodes.length) return [];
  const tokens: string[] = [];
  for (let i = 0; i < noteCodes.length; i += 10) {
    const chunk = noteCodes.slice(i, i + 10);
    const tokenSnapshot = await db
      .collection("pushTokens")
      .where("userCode", "in", chunk)
      .get();
    tokenSnapshot.docs.forEach((doc) => {
      const token = String((doc.data() as { token?: string }).token ?? "").trim();
      if (token) tokens.push(token);
    });
  }
  return tokens;
}

async function loadActor(code: string) {
  const db = getAdminDb();
  const doc = await db.collection("users").doc(code).get();
  if (doc.exists)
    return doc.data() as {
      role?: string;
      name?: string;
      classes?: string[];
      childrenCodes?: string[];
      profilePhoto?: string;
    };
  const snapshot = await db.collection("users").where("code", "==", code).limit(1).get();
  if (snapshot.empty) return null;
  return snapshot.docs[0].data() as {
    role?: string;
    name?: string;
    classes?: string[];
    childrenCodes?: string[];
    profilePhoto?: string;
  };
}

async function getAllowedClassesForUser(role: string, actor: { classes?: string[]; childrenCodes?: string[] }) {
  if (role === "admin" || role === "notes") return [];
  const classes = Array.isArray(actor.classes) ? actor.classes : [];
  if (role !== "parent") return classes;
  const childCodes = Array.isArray(actor.childrenCodes) ? actor.childrenCodes : [];
  if (!childCodes.length) return [];
  const db = getAdminDb();
  const classSet = new Set<string>();
  for (const childCode of childCodes) {
    const childDoc = await db.collection("users").doc(childCode).get();
    if (!childDoc.exists) continue;
    const child = childDoc.data() as { classes?: string[] };
    const childClasses = Array.isArray(child.classes) ? child.classes : [];
    childClasses.forEach((cls) => classSet.add(String(cls)));
  }
  return Array.from(classSet);
}

async function saveUploadedFile(threadId: string, file: File) {
  if (!allowedFileTypes.has(file.type)) {
    return { ok: false as const, message: "نوع الملف غير مسموح." };
  }
  if (file.size > maxFileSizeBytes) {
    return { ok: false as const, message: "حجم الملف كبير جداً (20MB)." };
  }
  const buffer = Buffer.from(await file.arrayBuffer());
  const cleanName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const objectName = `${Date.now()}-${randomUUID()}-${cleanName}`;
  const relativeDir = path.join("uploads", "inquiries", threadId);
  const absoluteDir = path.join(process.cwd(), "public", relativeDir);
  await mkdir(absoluteDir, { recursive: true });
  const absoluteFilePath = path.join(absoluteDir, objectName);
  await writeFile(absoluteFilePath, buffer);
  const storagePath = path.join(relativeDir, objectName).replace(/\\/g, "/");
  return {
    ok: true as const,
    url: `/${storagePath}`,
    storagePath,
    fileName: file.name,
    mimeType: file.type,
    size: file.size,
  };
}

async function enrichActors(
  db: ReturnType<typeof getAdminDb>,
  codes: string[]
): Promise<
  Record<
    string,
    { name: string; role: string; profilePhoto?: string; classLabel?: string }
  >
> {
  const unique = Array.from(new Set(codes.filter(Boolean)));
  const map: Record<
    string,
    { name: string; role: string; profilePhoto?: string; classLabel?: string }
  > = {};
  for (const code of unique) {
    const doc = await db.collection("users").doc(code).get();
    if (!doc.exists) continue;
    const data = doc.data() as {
      name?: string;
      role?: string;
      classes?: string[];
      childrenCodes?: string[];
      profilePhoto?: string;
    };
    const role = normalizeRole(String(data.role ?? "").trim().toLowerCase());
    let classLabel = "";
    if (role === "student") {
      const classId = Array.isArray(data.classes) && data.classes.length ? String(data.classes[0] ?? "") : "";
      classLabel = classId;
    }
    if (role === "parent") {
      const childCodes = Array.isArray(data.childrenCodes) ? data.childrenCodes : [];
      if (childCodes.length) {
        const classSet = new Set<string>();
        for (const childCode of childCodes) {
          const childDoc = await db.collection("users").doc(String(childCode)).get();
          if (!childDoc.exists) continue;
          const child = childDoc.data() as { classes?: string[] };
          const childClasses = Array.isArray(child.classes) ? child.classes : [];
          childClasses.forEach((cls) => {
            const value = String(cls ?? "").trim();
            if (value) classSet.add(value);
          });
        }
        classLabel = Array.from(classSet).join("، ");
      }
    }
    map[code] = {
      name: String(data.name ?? "").trim(),
      role,
      profilePhoto: String(data.profilePhoto ?? "").trim(),
      classLabel,
    };
  }
  return map;
}

export async function GET(request: Request) {
  try {
    const session = decodeSessionFromCookie(request);
    if (!session?.code || !session?.role) {
      return NextResponse.json({ ok: false, message: "Unauthorized." }, { status: 401 });
    }
    const actor = await loadActor(session.code);
    if (!actor) {
      return NextResponse.json({ ok: false, message: "User not found." }, { status: 404 });
    }
    const role = normalizeRole(String(actor.role ?? session.role ?? "").trim().toLowerCase());
    if (!["student", "parent", "admin", "notes"].includes(role)) {
      return NextResponse.json({ ok: false, message: "Not allowed." }, { status: 403 });
    }

    const url = new URL(request.url);
    const threadId = String(url.searchParams.get("id") ?? "").trim();
    const rawQuery = String(url.searchParams.get("q") ?? "").trim();
    const queryText = rawQuery.toLowerCase();
    const db = getAdminDb();

    if (threadId) {
      const threadRef = db.collection("inquiries").doc(threadId);
      const threadDoc = await threadRef.get();
      if (!threadDoc.exists) {
        return NextResponse.json({ ok: false, message: "Thread not found." }, { status: 404 });
      }
      const thread = threadDoc.data() as {
        createdByCode?: string;
        createdByRole?: string;
        title?: string;
        status?: string;
        createdAt?: { toDate?: () => Date };
        lastMessageAt?: { toDate?: () => Date };
        lastMessageBy?: { role?: string; name?: string };
      };

      if ((role === "student" || role === "parent") && String(thread.createdByCode ?? "") !== session.code) {
        return NextResponse.json({ ok: false, message: "Not allowed." }, { status: 403 });
      }

      const messagesSnapshot = await threadRef
        .collection("messages")
        .orderBy("createdAt", "asc")
        .limit(200)
        .get();
      const actorCodes = messagesSnapshot.docs
        .map((doc) => {
          const item = doc.data() as { createdBy?: { code?: string } };
          return String(item.createdBy?.code ?? "").trim();
        })
        .filter(Boolean);
      const actorMap = await enrichActors(db, actorCodes);

      const messages = messagesSnapshot.docs.map((doc) => {
        const item = doc.data() as Record<string, unknown>;
        const createdBy = item.createdBy as { code?: string; name?: string; role?: string } | undefined;
        const actorCode = String(createdBy?.code ?? "").trim();
        const actorInfo = actorMap[actorCode];
        return {
          id: doc.id,
          text: String(item.text ?? ""),
          fileUrl: String(item.fileUrl ?? ""),
          fileName: String(item.fileName ?? ""),
          mimeType: String(item.mimeType ?? ""),
          createdAt: (item.createdAt as Timestamp | undefined)?.toDate
            ? (item.createdAt as Timestamp).toDate().toISOString()
            : new Date().toISOString(),
          createdBy: {
            ...(createdBy ?? {}),
            name: String(actorInfo?.name ?? createdBy?.name ?? ""),
            role: String(actorInfo?.role ?? createdBy?.role ?? ""),
            profilePhoto: actorInfo?.profilePhoto ?? "",
            classLabel: actorInfo?.classLabel ?? "",
          },
        };
      });

      return NextResponse.json({
        ok: true,
        data: {
          id: threadDoc.id,
          title: String(thread.title ?? ""),
          status: String(thread.status ?? "open"),
          createdAt: thread.createdAt?.toDate ? thread.createdAt.toDate().toISOString() : "",
          lastMessageAt: thread.lastMessageAt?.toDate ? thread.lastMessageAt.toDate().toISOString() : "",
          lastMessageBy: thread.lastMessageBy ?? {},
          messages,
        },
      });
    }

    const baseQuery =
      role === "admin" || role === "notes"
        ? db.collection("inquiries").orderBy("lastMessageAt", "desc").limit(200)
        : db.collection("inquiries").where("createdByCode", "==", session.code).limit(200);
    const snapshot = await baseQuery.get();
    const listActorCodes = snapshot.docs
      .map((doc) => {
        const item = doc.data() as { createdBy?: { code?: string } };
        return String(item.createdBy?.code ?? "").trim();
      })
      .filter(Boolean);
    const listActorMap = await enrichActors(db, listActorCodes);

    let data = snapshot.docs.map((doc) => {
      const item = doc.data() as Record<string, unknown>;
      const createdBy = item.createdBy as { code?: string; name?: string; role?: string } | undefined;
      const creatorCode = String(createdBy?.code ?? "").trim();
      const creatorInfo = listActorMap[creatorCode];
      return {
        id: doc.id,
        title: String(item.title ?? ""),
        status: String(item.status ?? "open"),
        createdAt: (item.createdAt as Timestamp | undefined)?.toDate
          ? (item.createdAt as Timestamp).toDate().toISOString()
          : new Date().toISOString(),
        lastMessageAt: (item.lastMessageAt as Timestamp | undefined)?.toDate
          ? (item.lastMessageAt as Timestamp).toDate().toISOString()
          : "",
        lastMessageBy: item.lastMessageBy ?? {},
        createdBy: {
          ...(createdBy ?? {}),
          name: String(creatorInfo?.name ?? createdBy?.name ?? ""),
          role: String(creatorInfo?.role ?? createdBy?.role ?? ""),
          profilePhoto: creatorInfo?.profilePhoto ?? "",
          classLabel: creatorInfo?.classLabel ?? "",
        },
      };
    });

    if (queryText) {
      const filtered: typeof data = [];
      for (const thread of data) {
        const createdByName = String(thread.createdBy?.name ?? "").toLowerCase();
        const createdByCode = String((thread.createdBy as { code?: string } | undefined)?.code ?? "").toLowerCase();
        const title = String(thread.title ?? "").toLowerCase();
        const lastBy = String(
          (thread.lastMessageBy as { name?: string } | undefined)?.name ?? ""
        ).toLowerCase();
        if (
          createdByName.includes(queryText) ||
          createdByCode.includes(queryText) ||
          title.includes(queryText) ||
          lastBy.includes(queryText)
        ) {
          filtered.push(thread);
          continue;
        }
        try {
          const messagesSnapshot = await db
            .collection("inquiries")
            .doc(thread.id)
            .collection("messages")
            .orderBy("createdAt", "desc")
            .limit(200)
            .get();
          const match = messagesSnapshot.docs.some((doc) => {
            const item = doc.data() as { text?: string };
            return String(item.text ?? "").toLowerCase().includes(queryText);
          });
          if (match) filtered.push(thread);
        } catch {
          // ignore message search failure
        }
      }
      data = filtered;
    }
    if (role !== "admin" && role !== "notes") {
      data.sort((a, b) => {
        const aDate = a.lastMessageAt || a.createdAt;
        const bDate = b.lastMessageAt || b.createdAt;
        return String(bDate).localeCompare(String(aDate));
      });
    }

    return NextResponse.json({ ok: true, data });
  } catch (error) {
    console.error("GET /api/inquiries error:", error);
    return NextResponse.json({ ok: false, message: "Failed to load inquiries." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = decodeSessionFromCookie(request);
    if (!session?.code || !session?.role) {
      return NextResponse.json({ ok: false, message: "Unauthorized." }, { status: 401 });
    }
    const actor = await loadActor(session.code);
    if (!actor) {
      return NextResponse.json({ ok: false, message: "User not found." }, { status: 404 });
    }
    const role = normalizeRole(String(actor.role ?? session.role ?? "").trim().toLowerCase());
    if (!["student", "parent"].includes(role)) {
      return NextResponse.json({ ok: false, message: "Not allowed." }, { status: 403 });
    }

    const form = await request.formData();
    const title = String(form.get("title") ?? "").trim() || "استفسار";
    const text = String(form.get("message") ?? "").trim();
    const file = form.get("file");

    if (!text) {
      return NextResponse.json({ ok: false, message: "اكتب الرسالة." }, { status: 400 });
    }

    const db = getAdminDb();
    const threadRef = await db.collection("inquiries").add({
      title,
      status: "open",
      createdAt: Timestamp.now(),
      lastMessageAt: Timestamp.now(),
      createdBy: { code: session.code, name: actor.name ?? "", role },
      createdByCode: session.code,
      createdByRole: role,
      lastMessageBy: { code: session.code, name: actor.name ?? "", role },
      classIds: await getAllowedClassesForUser(role, actor),
    });

    let filePayload: {
      fileUrl?: string;
      fileName?: string;
      mimeType?: string;
    } = {};
    if (file instanceof File) {
      const saved = await saveUploadedFile(threadRef.id, file);
      if (!saved.ok) {
        return NextResponse.json({ ok: false, message: saved.message }, { status: 400 });
      }
      filePayload = {
        fileUrl: saved.url,
        fileName: saved.fileName,
        mimeType: saved.mimeType,
      };
    }

    await threadRef.collection("messages").add({
      text,
      ...filePayload,
      createdAt: Timestamp.now(),
      createdBy: { code: session.code, name: actor.name ?? "", role },
    });

    try {
      await db.collection("notifications").add({
        title: "استفسار جديد",
        body: `${actor.name ?? "طالب"} أرسل استفساراً جديداً.`,
        createdAt: Timestamp.now(),
        createdBy: {
          name: actor.name ?? "",
          code: session.code,
          role,
        },
        audience: {
          type: "role",
          role: "notes",
        },
      });
      const tokens = await getNotesTokens(db);
      if (tokens.length) {
        const messaging = getMessaging();
        for (const chunk of splitChunks(tokens, 500)) {
          await messaging.sendEachForMulticast({
            tokens: chunk,
            notification: {
              title: "استفسار جديد",
              body: `${actor.name ?? "طالب"} أرسل استفساراً جديداً.`,
            },
            data: {
              type: "inquiry",
              inquiryId: threadRef.id,
            },
          });
        }
      }
    } catch (pushError) {
      console.error("Inquiry notes push failed:", pushError);
    }

    return NextResponse.json({ ok: true, data: { id: threadRef.id } });
  } catch (error) {
    console.error("POST /api/inquiries error:", error);
    return NextResponse.json({ ok: false, message: "Failed to create inquiry." }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const session = decodeSessionFromCookie(request);
    if (!session?.code || !session?.role) {
      return NextResponse.json({ ok: false, message: "Unauthorized." }, { status: 401 });
    }
    const actor = await loadActor(session.code);
    if (!actor) {
      return NextResponse.json({ ok: false, message: "User not found." }, { status: 404 });
    }
    const role = normalizeRole(String(actor.role ?? session.role ?? "").trim().toLowerCase());
    if (!["student", "parent", "notes", "admin"].includes(role)) {
      return NextResponse.json({ ok: false, message: "Not allowed." }, { status: 403 });
    }

    const form = await request.formData();
    const inquiryId = String(form.get("id") ?? "").trim();
    const text = String(form.get("message") ?? "").trim();
    const file = form.get("file");

    if (!inquiryId || !text) {
      return NextResponse.json({ ok: false, message: "Missing fields." }, { status: 400 });
    }

    const db = getAdminDb();
    const threadRef = db.collection("inquiries").doc(inquiryId);
    const threadDoc = await threadRef.get();
    if (!threadDoc.exists) {
      return NextResponse.json({ ok: false, message: "Thread not found." }, { status: 404 });
    }
    const thread = threadDoc.data() as { createdByCode?: string };
    if ((role === "student" || role === "parent") && String(thread.createdByCode ?? "") !== session.code) {
      return NextResponse.json({ ok: false, message: "Not allowed." }, { status: 403 });
    }

    let filePayload: {
      fileUrl?: string;
      fileName?: string;
      mimeType?: string;
    } = {};
    if (file instanceof File) {
      const saved = await saveUploadedFile(threadRef.id, file);
      if (!saved.ok) {
        return NextResponse.json({ ok: false, message: saved.message }, { status: 400 });
      }
      filePayload = {
        fileUrl: saved.url,
        fileName: saved.fileName,
        mimeType: saved.mimeType,
      };
    }

    await threadRef.collection("messages").add({
      text,
      ...filePayload,
      createdAt: Timestamp.now(),
      createdBy: {
        code: session.code,
        name: role === "notes" ? "إدارة مدرسة الشمامسة" : actor.name ?? "",
        role,
      },
    });

    await threadRef.update({
      lastMessageAt: Timestamp.now(),
      lastMessageBy: { code: session.code, name: actor.name ?? "", role },
      status: role === "notes" || role === "admin" ? "answered" : "open",
    });

    if (role === "student" || role === "parent") {
      try {
        await db.collection("notifications").add({
          title: "رسالة جديدة على استفسار",
          body: `${actor.name ?? "مستخدم"} أرسل رسالة جديدة.`,
          createdAt: Timestamp.now(),
          createdBy: {
            name: actor.name ?? "",
            code: session.code,
            role,
          },
          audience: {
            type: "role",
            role: "notes",
          },
        });
        const tokens = await getNotesTokens(db);
        if (tokens.length) {
          const messaging = getMessaging();
          for (const chunk of splitChunks(tokens, 500)) {
            await messaging.sendEachForMulticast({
              tokens: chunk,
              notification: {
                title: "رد جديد على الاستفسار",
                body: `${actor.name ?? "مستخدم"} أرسل رسالة جديدة.`,
              },
              data: {
                type: "inquiry-reply",
                inquiryId,
              },
            });
          }
        }
      } catch (pushError) {
        console.error("Inquiry notes reply push failed:", pushError);
      }
    }

    if (role === "notes" || role === "admin") {
      try {
        const userCode = String(thread.createdByCode ?? "").trim();
        if (userCode) {
          const tokenSnapshot = await db
            .collection("pushTokens")
            .where("userCode", "==", userCode)
            .get();
          const tokens = tokenSnapshot.docs
            .map((doc) => String((doc.data() as { token?: string }).token ?? "").trim())
            .filter(Boolean);
          if (tokens.length) {
            const messaging = getMessaging();
            await messaging.sendEachForMulticast({
              tokens,
              notification: { title: "رد على استفسارك", body: text },
              data: { type: "inquiry-reply", inquiryId },
            });
          }
        }
      } catch (pushError) {
        console.error("Inquiry reply push failed:", pushError);
      }
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("PATCH /api/inquiries error:", error);
    return NextResponse.json({ ok: false, message: "Failed to add message." }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const session = decodeSessionFromCookie(request);
    if (!session?.code || !session?.role) {
      return NextResponse.json({ ok: false, message: "Unauthorized." }, { status: 401 });
    }
    const actor = await loadActor(session.code);
    if (!actor) {
      return NextResponse.json({ ok: false, message: "User not found." }, { status: 404 });
    }
    const role = normalizeRole(String(actor.role ?? session.role ?? "").trim().toLowerCase());
    if (!["student", "parent", "notes", "admin"].includes(role)) {
      return NextResponse.json({ ok: false, message: "Not allowed." }, { status: 403 });
    }

    const url = new URL(request.url);
    const threadId = String(url.searchParams.get("id") ?? "").trim();
    if (!threadId) {
      return NextResponse.json({ ok: false, message: "Missing thread id." }, { status: 400 });
    }

    const db = getAdminDb();
    const threadRef = db.collection("inquiries").doc(threadId);
    const threadDoc = await threadRef.get();
    if (!threadDoc.exists) {
      return NextResponse.json({ ok: false, message: "Thread not found." }, { status: 404 });
    }
    const thread = threadDoc.data() as { createdByCode?: string };
    if ((role === "student" || role === "parent") && String(thread.createdByCode ?? "") !== session.code) {
      return NextResponse.json({ ok: false, message: "Not allowed." }, { status: 403 });
    }

    const messagesSnap = await threadRef.collection("messages").get();
    let batch = db.batch();
    let batchSize = 0;
    for (const doc of messagesSnap.docs) {
      batch.delete(doc.ref);
      batchSize += 1;
      if (batchSize >= 400) {
        await batch.commit();
        batch = db.batch();
        batchSize = 0;
      }
    }
    if (batchSize > 0) {
      await batch.commit();
    }
    await threadRef.delete();

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("DELETE /api/inquiries error:", error);
    return NextResponse.json({ ok: false, message: "Failed to delete inquiry." }, { status: 500 });
  }
}
