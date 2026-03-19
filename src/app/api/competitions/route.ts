import { NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
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
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.ms-powerpoint",
  "text/plain",
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

async function loadActor(db: ReturnType<typeof getAdminDb>, code: string) {
  const directDoc = await db.collection("users").doc(code).get();
  if (directDoc.exists) {
    return directDoc.data() as { role?: string; name?: string };
  }
  const snapshot = await db.collection("users").where("code", "==", code).limit(1).get();
  if (snapshot.empty) return null;
  return snapshot.docs[0].data() as { role?: string; name?: string };
}

async function saveUploadedFile(itemId: string, file: File) {
  if (!allowedFileTypes.has(file.type)) {
    return { ok: false as const, message: "نوع الملف غير مسموح." };
  }
  const buffer = Buffer.from(await file.arrayBuffer());
  const cleanName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const objectName = `${Date.now()}-${cleanName}`;
  const relativeDir = path.join("uploads", "competitions", itemId);
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
    const db = getAdminDb();
    const actor = await loadActor(db, session.code);
    if (!actor) {
      return NextResponse.json({ ok: false, message: "User not found." }, { status: 404 });
    }
    const role = normalizeRole(String(actor.role ?? session.role ?? "").trim().toLowerCase());
    if (!["admin", "system", "teacher", "parent", "student", "notes", "katamars"].includes(role)) {
      return NextResponse.json({ ok: false, message: "Not allowed." }, { status: 403 });
    }

    const snapshot = await db
      .collection("competitions_posts")
      .orderBy("createdAt", "desc")
      .limit(300)
      .get();
    const data = snapshot.docs.map((doc) => ({ id: doc.id, ...(doc.data() as Record<string, unknown>) }));
    return NextResponse.json({ ok: true, data });
  } catch (error) {
    console.error("GET /api/competitions error:", error);
    return NextResponse.json({ ok: false, message: "Failed to load competitions." }, { status: 500 });
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
    if (role !== "katamars" && role !== "admin") {
      return NextResponse.json({ ok: false, message: "Not allowed." }, { status: 403 });
    }

    const form = await request.formData();
    const title = String(form.get("title") ?? "").trim();
    const body = String(form.get("body") ?? "").trim();
    const link = String(form.get("link") ?? "").trim();

    if (!title && !body && !link) {
      return NextResponse.json({ ok: false, message: "أدخل رسالة أو عنوان أو رابط." }, { status: 400 });
    }

    const ref = await db.collection("competitions_posts").add({
      title,
      body,
      link,
      createdAt: Timestamp.now(),
      createdBy: {
        code: session.code,
        name: String(actor.name ?? ""),
        role,
      },
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

    const doc = await ref.get();
    return NextResponse.json({ ok: true, data: { id: ref.id, ...doc.data() } });
  } catch (error) {
    console.error("POST /api/competitions error:", error);
    return NextResponse.json({ ok: false, message: "Failed to create competition post." }, { status: 500 });
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
    if (role !== "katamars" && role !== "admin") {
      return NextResponse.json({ ok: false, message: "Not allowed." }, { status: 403 });
    }

    const id = String(new URL(request.url).searchParams.get("id") ?? "").trim();
    if (!id) return NextResponse.json({ ok: false, message: "Missing id." }, { status: 400 });

    const ref = db.collection("competitions_posts").doc(id);
    const doc = await ref.get();
    if (!doc.exists) {
      return NextResponse.json({ ok: false, message: "Post not found." }, { status: 404 });
    }
    const item = doc.data() as { createdBy?: { code?: string } };
    if (role !== "admin" && String(item.createdBy?.code ?? "") !== session.code) {
      return NextResponse.json({ ok: false, message: "Not allowed." }, { status: 403 });
    }
    await ref.delete();
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("DELETE /api/competitions error:", error);
    return NextResponse.json({ ok: false, message: "Failed to delete post." }, { status: 500 });
  }
}

