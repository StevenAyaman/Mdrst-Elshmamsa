import { rm } from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";
import { getAdminDb, getAdminStorage } from "@/lib/firebase/admin";

export const runtime = "nodejs";

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

async function deleteCollectionDocs(db: ReturnType<typeof getAdminDb>, path: string) {
  const snapshot = await db.collection(path).get();
  if (snapshot.empty) return;
  const batch = db.batch();
  snapshot.docs.forEach((doc) => batch.delete(doc.ref));
  await batch.commit();
}

async function clearAttachments(db: ReturnType<typeof getAdminDb>, collectionName: string) {
  const snapshot = await db.collection(collectionName).get();
  if (snapshot.empty) return;
  const batch = db.batch();
  snapshot.docs.forEach((doc) => batch.update(doc.ref, { attachments: [] }));
  await batch.commit();
}

export async function POST(request: Request) {
  try {
    const session = decodeSessionFromCookie(request);
    const role = normalizeRole(String(session?.role ?? "").trim());
    if (!role || role !== "admin") {
      return NextResponse.json({ ok: false, message: "Unauthorized." }, { status: 401 });
    }

    try {
      const storage = getAdminStorage();
      const bucket = storage.bucket();
      const [files] = await bucket.getFiles();
      await Promise.allSettled(files.map((file) => file.delete()));
    } catch (error) {
      console.warn("Storage bucket cleanup skipped:", error);
    }

    const uploadsDir = path.join(process.cwd(), "public", "uploads");
    await rm(uploadsDir, { recursive: true, force: true }).catch(() => null);

    const db = getAdminDb();
    await deleteCollectionDocs(db, "photoPhotos");
    await deleteCollectionDocs(db, "libraryFiles");
    await clearAttachments(db, "competitions_posts");
    await clearAttachments(db, "lessonReports");

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("POST /api/storage-usage/clear error:", error);
    return NextResponse.json({ ok: false, message: "Failed to clear storage." }, { status: 500 });
  }
}
