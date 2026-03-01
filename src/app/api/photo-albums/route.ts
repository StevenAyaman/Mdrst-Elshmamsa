import { NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";

export const runtime = "nodejs";

const manageRoles = new Set(["admin"]);

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

type AlbumDoc = {
  title: string;
  createdAt: Timestamp;
  createdBy: {
    name: string;
    code: string;
    role: string;
  };
  photoCount: number;
};

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
    const id = String(url.searchParams.get("id") ?? "").trim();

    const db = getAdminDb();
    if (id) {
      const doc = await db.collection("photoAlbums").doc(id).get();
      if (!doc.exists) {
        return NextResponse.json({ ok: false, message: "Album not found." }, { status: 404 });
      }
      const item = doc.data() as AlbumDoc;
      return NextResponse.json({
        ok: true,
        data: {
          id: doc.id,
          title: item.title,
          createdAt: item.createdAt?.toDate
            ? item.createdAt.toDate().toISOString()
            : new Date().toISOString(),
          createdBy: item.createdBy,
          photoCount: Number(item.photoCount ?? 0),
        },
      });
    }

    const snapshot = await db
      .collection("photoAlbums")
      .orderBy("createdAt", "desc")
      .limit(200)
      .get();

    const data = snapshot.docs.map((doc) => {
      const item = doc.data() as AlbumDoc;
      return {
        id: doc.id,
        title: item.title,
        createdAt: item.createdAt?.toDate
          ? item.createdAt.toDate().toISOString()
          : new Date().toISOString(),
        createdBy: item.createdBy,
        photoCount: Number(item.photoCount ?? 0),
      };
    });

    return NextResponse.json({ ok: true, data });
  } catch (error) {
    console.error("GET /api/photo-albums error:", error);
    return NextResponse.json({ ok: false, message: "Failed to load albums." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const title = String(body.title ?? "").trim();
    const session = decodeSessionFromCookie(request);
    if (!session?.code || !session?.role) {
      return NextResponse.json({ ok: false, message: "Unauthorized." }, { status: 401 });
    }
    const role = normalizeRole(String(session.role ?? "").trim().toLowerCase());
    const code = String(session.code ?? "").trim();

    if (!title || !role || !code) {
      return NextResponse.json({ ok: false, message: "Missing required fields." }, { status: 400 });
    }
    if (!manageRoles.has(role)) {
      return NextResponse.json({ ok: false, message: "Not allowed." }, { status: 403 });
    }

    const verified = await verifyManager(code, role);
    if (!verified.ok) {
      return NextResponse.json(
        { ok: false, message: verified.message },
        { status: verified.status }
      );
    }
    const { db, actor } = verified;

    const payload: AlbumDoc = {
      title,
      createdAt: Timestamp.now(),
      createdBy: { name: actor.name || "", code, role },
      photoCount: 0,
    };
    const ref = await db.collection("photoAlbums").add(payload);

    return NextResponse.json({
      ok: true,
      data: {
        id: ref.id,
        title: payload.title,
        createdAt: new Date().toISOString(),
        createdBy: payload.createdBy,
        photoCount: 0,
      },
    });
  } catch (error) {
    console.error("POST /api/photo-albums error:", error);
    return NextResponse.json({ ok: false, message: "Failed to create album." }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const session = decodeSessionFromCookie(request);
    if (!session?.code || !session?.role) {
      return NextResponse.json({ ok: false, message: "Unauthorized." }, { status: 401 });
    }
    const role = normalizeRole(String(session.role ?? "").trim().toLowerCase());
    const code = String(session.code ?? "").trim();
    if (role !== "admin") {
      return NextResponse.json({ ok: false, message: "Not allowed." }, { status: 403 });
    }

    const verified = await verifyManager(code, role);
    if (!verified.ok) {
      return NextResponse.json(
        { ok: false, message: verified.message },
        { status: verified.status }
      );
    }
    const { db } = verified;

    const body = await request.json();
    const id = String(body.id ?? "").trim();
    if (!id) {
      return NextResponse.json({ ok: false, message: "Missing album id." }, { status: 400 });
    }

    const albumRef = db.collection("photoAlbums").doc(id);
    const albumDoc = await albumRef.get();
    if (!albumDoc.exists) {
      return NextResponse.json({ ok: false, message: "Album not found." }, { status: 404 });
    }

    const photosSnap = await db.collection("photoPhotos").where("albumId", "==", id).get();
    let batch = db.batch();
    let count = 0;
    for (const photoDoc of photosSnap.docs) {
      batch.delete(photoDoc.ref);
      count += 1;
      if (count % 400 === 0) {
        await batch.commit();
        batch = db.batch();
      }
    }
    if (count % 400 !== 0) {
      await batch.commit();
    }

    await albumRef.delete();

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("DELETE /api/photo-albums error:", error);
    return NextResponse.json({ ok: false, message: "Failed to delete album." }, { status: 500 });
  }
}
