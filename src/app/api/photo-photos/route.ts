import { randomUUID } from "crypto";
import { mkdir, unlink, writeFile } from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";

export const runtime = "nodejs";

const manageRoles = new Set(["admin", "teacher", "system"]);
const allowedMimeTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const maxFileSizeBytes = 8 * 1024 * 1024;

type PhotoDoc = {
  albumId: string;
  fileName: string;
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

async function verifyManager(code: string, role: string) {
  const db = getAdminDb();
  let actor: { role?: string; name?: string } | null = null;
  const userDoc = await db.collection("users").doc(code).get();
  if (userDoc.exists) {
    actor = userDoc.data() as { role?: string; name?: string };
  } else {
    const snapshot = await db.collection("users").where("code", "==", code).limit(1).get();
    if (!snapshot.empty) {
      actor = snapshot.docs[0].data() as { role?: string; name?: string };
    }
  }
  if (!actor) return { ok: false as const, status: 403, message: "User not found." };

  const actorRole = String(actor.role ?? "").trim().toLowerCase();
  if (actorRole !== role || !manageRoles.has(actorRole)) {
    return { ok: false as const, status: 403, message: "Not allowed." };
  }

  return { ok: true as const, db, actor };
}

export async function GET(request: Request) {
  try {
    const session = decodeSessionFromCookie(request);
    if (!session?.code || !session?.role) {
      return NextResponse.json({ ok: false, message: "Unauthorized." }, { status: 401 });
    }
    const url = new URL(request.url);
    const albumId = String(url.searchParams.get("albumId") ?? "").trim();
    if (!albumId) {
      return NextResponse.json({ ok: false, message: "Missing albumId." }, { status: 400 });
    }

    const db = getAdminDb();
    let docs: Array<{ id: string; data: () => unknown }> = [];
    try {
      const snapshot = await db
        .collection("photoPhotos")
        .where("albumId", "==", albumId)
        .get();
      docs = snapshot.docs;
    } catch (queryError) {
      // Fallback path in case query/index mismatch happens in existing deployments.
      console.error("photo-photos primary query failed, using fallback:", queryError);
      const snapshot = await db.collection("photoPhotos").limit(1000).get();
      docs = snapshot.docs.filter((doc) => {
        const item = doc.data() as { albumId?: string };
        return String(item.albumId ?? "") === albumId;
      });
    }

    const data = docs
      .map((doc) => {
        const item = doc.data() as PhotoDoc;
        return {
        id: doc.id,
        albumId: item.albumId,
        fileName: item.fileName,
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
    console.error("GET /api/photo-photos error:", error);
    return NextResponse.json({ ok: false, message: "Failed to load photos." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const albumId = String(form.get("albumId") ?? "").trim();
    const role = String(form.get("role") ?? "").trim().toLowerCase();
    const code = String(form.get("code") ?? "").trim();
    const name = String(form.get("name") ?? "").trim();
    const file = form.get("file");

    if (!albumId || !role || !code || !name) {
      return NextResponse.json({ ok: false, message: "Missing required fields." }, { status: 400 });
    }
    if (!manageRoles.has(role)) {
      return NextResponse.json({ ok: false, message: "Not allowed." }, { status: 403 });
    }
    if (!isSessionActorMatch(request, code, role)) {
      return NextResponse.json({ ok: false, message: "Session mismatch." }, { status: 401 });
    }
    if (!(file instanceof File)) {
      return NextResponse.json({ ok: false, message: "File is required." }, { status: 400 });
    }
    if (!allowedMimeTypes.has(file.type)) {
      return NextResponse.json(
        { ok: false, message: "Only JPG/PNG/WEBP images are allowed." },
        { status: 400 }
      );
    }
    if (file.size > maxFileSizeBytes) {
      return NextResponse.json(
        { ok: false, message: "Max file size is 8MB." },
        { status: 400 }
      );
    }

    const verified = await verifyManager(code, role);
    if (!verified.ok) {
      return NextResponse.json(
        { ok: false, message: verified.message },
        { status: verified.status }
      );
    }
    const { db, actor } = verified;

    const albumRef = db.collection("photoAlbums").doc(albumId);
    const albumDoc = await albumRef.get();
    if (!albumDoc.exists) {
      return NextResponse.json({ ok: false, message: "Album not found." }, { status: 404 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const cleanName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const objectName = `${Date.now()}-${randomUUID()}-${cleanName}`;
    const relativeDir = path.join("uploads", "photos", albumId);
    const absoluteDir = path.join(process.cwd(), "public", relativeDir);
    await mkdir(absoluteDir, { recursive: true });
    const absoluteFilePath = path.join(absoluteDir, objectName);
    await writeFile(absoluteFilePath, buffer);
    const storagePath = path.join(relativeDir, objectName).replace(/\\/g, "/");
    const url = `/${storagePath}`;

    const payload: PhotoDoc = {
      albumId,
      fileName: file.name,
      mimeType: file.type,
      size: file.size,
      url,
      storagePath,
      createdAt: Timestamp.now(),
      createdBy: { name: actor.name || name, code, role },
    };

    const ref = await db.collection("photoPhotos").add(payload);
    await albumRef.update({ photoCount: FieldValue.increment(1) });

    return NextResponse.json({
      ok: true,
      data: {
        id: ref.id,
        albumId,
        fileName: payload.fileName,
        mimeType: payload.mimeType,
        size: payload.size,
        url: payload.url,
        storagePath: payload.storagePath,
        createdAt: new Date().toISOString(),
        createdBy: payload.createdBy,
      },
    });
  } catch (error) {
    console.error("POST /api/photo-photos error:", error);
    return NextResponse.json({ ok: false, message: "Failed to upload photo." }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const body = await request.json();
    const id = String(body.id ?? "").trim();
    const role = String(body.role ?? "").trim().toLowerCase();
    const code = String(body.code ?? "").trim();

    if (!id || !role || !code) {
      return NextResponse.json({ ok: false, message: "Missing required fields." }, { status: 400 });
    }
    if (!manageRoles.has(role)) {
      return NextResponse.json({ ok: false, message: "Not allowed." }, { status: 403 });
    }
    if (!isSessionActorMatch(request, code, role)) {
      return NextResponse.json({ ok: false, message: "Session mismatch." }, { status: 401 });
    }

    const verified = await verifyManager(code, role);
    if (!verified.ok) {
      return NextResponse.json(
        { ok: false, message: verified.message },
        { status: verified.status }
      );
    }
    const { db } = verified;

    const docRef = db.collection("photoPhotos").doc(id);
    const existing = await docRef.get();
    if (!existing.exists) {
      return NextResponse.json({ ok: false, message: "Photo not found." }, { status: 404 });
    }
    const data = existing.data() as PhotoDoc;
    const storagePath = data.storagePath;

    if (storagePath) {
      const absoluteFilePath = path.join(process.cwd(), "public", storagePath);
      await unlink(absoluteFilePath).catch(() => undefined);
    }

    await docRef.delete();
    if (data.albumId) {
      await db.collection("photoAlbums").doc(data.albumId).update({
        photoCount: FieldValue.increment(-1),
      });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("DELETE /api/photo-photos error:", error);
    return NextResponse.json({ ok: false, message: "Failed to delete photo." }, { status: 500 });
  }
}
