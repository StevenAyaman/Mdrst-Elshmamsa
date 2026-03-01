import { randomUUID } from "crypto";
import { mkdir, unlink, writeFile } from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";

export const runtime = "nodejs";

const allowedUploadRoles = new Set(["admin", "teacher"]);
const allowedSubjects = new Set(["alhan", "katamars", "coptic", "taqs", "agbia"]);
const allowedMimeTypes = new Set(["application/pdf", "audio/mpeg", "audio/mp3"]);
const maxFileSizeBytes = 20 * 1024 * 1024;

type LibraryFileDoc = {
  grade: string;
  subject: string;
  fileName: string;
  fileType: "pdf" | "mp3";
  mimeType: string;
  size: number;
  url: string;
  storagePath: string;
  createdAt: Timestamp;
  createdBy: {
    name: string;
    code: string;
    role: string;
  };
};

type SessionPayload = { code?: string; role?: string } | null;

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

function isSessionActorMatch(request: Request, actorCode: string, actorRole: string) {
  const session = decodeSessionFromCookie(request);
  if (!session?.code || !session?.role) return false;
  return session.code === actorCode && normalizeRole(session.role) === normalizeRole(actorRole);
}

async function verifyUploader(code: string, role: string) {
  const db = getAdminDb();
  let uploader: { role?: string; name?: string } | null = null;
  const userDoc = await db.collection("users").doc(code).get();
  if (userDoc.exists) {
    uploader = userDoc.data() as { role?: string; name?: string };
  } else {
    const uploaderSnapshot = await db
      .collection("users")
      .where("code", "==", code)
      .limit(1)
      .get();
    if (!uploaderSnapshot.empty) {
      uploader = uploaderSnapshot.docs[0].data() as { role?: string; name?: string };
    }
  }
  if (!uploader) return { ok: false as const, status: 403, message: "User not found." };

  const uploaderRole = String(uploader.role ?? "").trim().toLowerCase();
  if (uploaderRole !== role || !allowedUploadRoles.has(uploaderRole)) {
    return { ok: false as const, status: 403, message: "Not allowed." };
  }

  return { ok: true as const, db, uploader };
}

export async function GET(request: Request) {
  try {
    const session = decodeSessionFromCookie(request);
    if (!session?.code || !session?.role) {
      return NextResponse.json({ ok: false, message: "Unauthorized." }, { status: 401 });
    }
    const url = new URL(request.url);
    const grade = String(url.searchParams.get("grade") ?? "").trim();
    const subject = String(url.searchParams.get("subject") ?? "").trim();

    if (!grade || !subject) {
      return NextResponse.json(
        { ok: false, message: "Missing grade or subject." },
        { status: 400 }
      );
    }
    if (!allowedSubjects.has(subject)) {
      return NextResponse.json(
        { ok: false, message: "Invalid subject." },
        { status: 400 }
      );
    }

    const db = getAdminDb();
    const snapshot = await db
      .collection("libraryFiles")
      .where("grade", "==", grade)
      .where("subject", "==", subject)
      .get();

    const data = snapshot.docs
      .map((doc) => {
        const item = doc.data() as LibraryFileDoc;
        return {
          id: doc.id,
          fileName: item.fileName,
          fileType: item.fileType,
          mimeType: item.mimeType,
          size: item.size,
          url: item.url,
          storagePath: item.storagePath,
          createdAt: item.createdAt?.toDate
            ? item.createdAt.toDate().toISOString()
            : new Date().toISOString(),
          createdBy: item.createdBy,
        };
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    return NextResponse.json({ ok: true, data });
  } catch (error) {
    console.error("GET /api/library-files error:", error);
    return NextResponse.json(
      { ok: false, message: "Failed to load files." },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const grade = String(form.get("grade") ?? "").trim();
    const subject = String(form.get("subject") ?? "").trim();
    const role = String(form.get("role") ?? "").trim().toLowerCase();
    const code = String(form.get("code") ?? "").trim();
    const name = String(form.get("name") ?? "").trim();
    const file = form.get("file");

    if (!grade || !subject || !role || !code || !name) {
      return NextResponse.json(
        { ok: false, message: "Missing required fields." },
        { status: 400 }
      );
    }
    if (!allowedSubjects.has(subject)) {
      return NextResponse.json(
        { ok: false, message: "Invalid subject." },
        { status: 400 }
      );
    }
    if (!allowedUploadRoles.has(role)) {
      return NextResponse.json(
        { ok: false, message: "Not allowed." },
        { status: 403 }
      );
    }
    if (!isSessionActorMatch(request, code, role)) {
      return NextResponse.json(
        { ok: false, message: "Session mismatch." },
        { status: 401 }
      );
    }
    if (!(file instanceof File)) {
      return NextResponse.json(
        { ok: false, message: "File is required." },
        { status: 400 }
      );
    }
    if (!allowedMimeTypes.has(file.type)) {
      return NextResponse.json(
        { ok: false, message: "Only PDF or MP3 files are allowed." },
        { status: 400 }
      );
    }
    if (file.size > maxFileSizeBytes) {
      return NextResponse.json(
        { ok: false, message: "Max file size is 20MB." },
        { status: 400 }
      );
    }

    const verified = await verifyUploader(code, role);
    if (!verified.ok) {
      return NextResponse.json(
        { ok: false, message: verified.message },
        { status: verified.status }
      );
    }
    const { db, uploader } = verified;

    const buffer = Buffer.from(await file.arrayBuffer());
    const extension = file.type === "application/pdf" ? "pdf" : "mp3";
    const cleanName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const objectName = `${Date.now()}-${randomUUID()}-${cleanName}`;
    const relativeDir = path.join("uploads", "library", grade, subject);
    const absoluteDir = path.join(process.cwd(), "public", relativeDir);
    await mkdir(absoluteDir, { recursive: true });
    const absoluteFilePath = path.join(absoluteDir, objectName);
    await writeFile(absoluteFilePath, buffer);
    const storagePath = path.join(relativeDir, objectName).replace(/\\/g, "/");
    const url = `/${storagePath}`;

    const payload: LibraryFileDoc = {
      grade,
      subject,
      fileName: file.name,
      fileType: extension,
      mimeType: file.type,
      size: file.size,
      url,
      storagePath,
      createdAt: Timestamp.now(),
      createdBy: { name: uploader.name || name, code, role },
    };

    const ref = await db.collection("libraryFiles").add(payload);
    return NextResponse.json({
      ok: true,
      data: {
        id: ref.id,
        fileName: payload.fileName,
        fileType: payload.fileType,
        mimeType: payload.mimeType,
        size: payload.size,
        url: payload.url,
        storagePath: payload.storagePath,
        createdAt: new Date().toISOString(),
        createdBy: payload.createdBy,
      },
    });
  } catch (error) {
    console.error("POST /api/library-files error:", error);
    return NextResponse.json(
      { ok: false, message: "Failed to upload file." },
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request) {
  try {
    const body = await request.json();
    const id = String(body.id ?? "").trim();
    const role = String(body.role ?? "").trim().toLowerCase();
    const code = String(body.code ?? "").trim();

    if (!id || !role || !code) {
      return NextResponse.json(
        { ok: false, message: "Missing required fields." },
        { status: 400 }
      );
    }
    if (!allowedUploadRoles.has(role)) {
      return NextResponse.json(
        { ok: false, message: "Not allowed." },
        { status: 403 }
      );
    }
    if (!isSessionActorMatch(request, code, role)) {
      return NextResponse.json(
        { ok: false, message: "Session mismatch." },
        { status: 401 }
      );
    }

    const verified = await verifyUploader(code, role);
    if (!verified.ok) {
      return NextResponse.json(
        { ok: false, message: verified.message },
        { status: verified.status }
      );
    }
    const { db } = verified;

    const docRef = db.collection("libraryFiles").doc(id);
    const existing = await docRef.get();
    if (!existing.exists) {
      return NextResponse.json({ ok: false, message: "File not found." }, { status: 404 });
    }
    const data = existing.data() as LibraryFileDoc;
    const storagePath = data.storagePath;

    // delete local stored file if present
    if (storagePath) {
      const absoluteFilePath = path.join(process.cwd(), "public", storagePath);
      await unlink(absoluteFilePath).catch(() => undefined);
    }

    await docRef.delete();

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("DELETE /api/library-files error:", error);
    return NextResponse.json(
      { ok: false, message: "Failed to delete file." },
      { status: 500 }
    );
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    const id = String(body.id ?? "").trim();
    const role = String(body.role ?? "").trim().toLowerCase();
    const code = String(body.code ?? "").trim();
    const fileName = String(body.fileName ?? "").trim();

    if (!id || !role || !code || !fileName) {
      return NextResponse.json(
        { ok: false, message: "Missing required fields." },
        { status: 400 }
      );
    }
    if (!allowedUploadRoles.has(role)) {
      return NextResponse.json(
        { ok: false, message: "Not allowed." },
        { status: 403 }
      );
    }
    if (!isSessionActorMatch(request, code, role)) {
      return NextResponse.json(
        { ok: false, message: "Session mismatch." },
        { status: 401 }
      );
    }

    const verified = await verifyUploader(code, role);
    if (!verified.ok) {
      return NextResponse.json(
        { ok: false, message: verified.message },
        { status: verified.status }
      );
    }
    const { db } = verified;

    const docRef = db.collection("libraryFiles").doc(id);
    const existing = await docRef.get();
    if (!existing.exists) {
      return NextResponse.json({ ok: false, message: "File not found." }, { status: 404 });
    }

    await docRef.update({ fileName });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("PATCH /api/library-files error:", error);
    return NextResponse.json(
      { ok: false, message: "Failed to rename file." },
      { status: 500 }
    );
  }
}
