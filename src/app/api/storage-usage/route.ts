import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";

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

export async function GET(request: Request) {
  try {
    const session = decodeSessionFromCookie(request);
    const role = normalizeRole(String(session?.role ?? "").trim());
    if (!role || role !== "admin") {
      return NextResponse.json({ ok: false, message: "Unauthorized." }, { status: 401 });
    }

    const db = getAdminDb();
    let imageBytes = 0;
    let videoBytes = 0;
    let imageCount = 0;
    let videoCount = 0;

    const photoSnapshot = await db.collection("photoPhotos").get();
    photoSnapshot.docs.forEach((doc) => {
      const data = doc.data() as { size?: number; mimeType?: string };
      const size = Number(data.size ?? 0);
      const mime = String(data.mimeType ?? "").toLowerCase();
      if (mime.startsWith("image/")) {
        imageBytes += size;
        imageCount += 1;
      }
    });

    const messagesSnapshot = await db.collectionGroup("messages").get();
    messagesSnapshot.docs.forEach((doc) => {
      const data = doc.data() as { size?: number; mimeType?: string };
      const size = Number(data.size ?? 0);
      const mime = String(data.mimeType ?? "").toLowerCase();
      if (!size || !mime) return;
      if (mime.startsWith("image/")) {
        imageBytes += size;
        imageCount += 1;
      } else if (mime.startsWith("video/")) {
        videoBytes += size;
        videoCount += 1;
      }
    });

    return NextResponse.json({
      ok: true,
      data: {
        imageBytes,
        videoBytes,
        imageCount,
        videoCount,
      },
    });
  } catch (error) {
    console.error("GET /api/storage-usage error:", error);
    return NextResponse.json({ ok: false, message: "Failed to load storage usage." }, { status: 500 });
  }
}
