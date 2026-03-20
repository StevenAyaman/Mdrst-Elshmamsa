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

async function loadActor(code: string) {
  const db = getAdminDb();
  const doc = await db.collection("users").doc(code).get();
  if (doc.exists) return doc.data() as { role?: string; classes?: string[]; childrenCodes?: string[] };
  const snapshot = await db.collection("users").where("code", "==", code).limit(1).get();
  if (snapshot.empty) return null;
  return snapshot.docs[0].data() as { role?: string; classes?: string[]; childrenCodes?: string[] };
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

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
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
    const { id } = await params;
    const db = getAdminDb();
    const doc = await db.collection("notifications").doc(id).get();
    if (!doc.exists) {
      return NextResponse.json(
        { ok: false, message: "Not found." },
        { status: 404 }
      );
    }

    const data = doc.data() as {
      title: string;
      body: string;
      createdAt?: { toDate?: () => Date };
      createdBy?: { name?: string; code?: string; role?: string };
      audience?: {
        type?: "all" | "class" | "role" | "users";
        classId?: string;
        role?: string;
        userCodes?: string[];
      };
    };

    if (!["admin", "system", "teacher", "notes"].includes(role)) {
      const allowedClasses = await getAllowedClassesForUser(role, actor);
      const audienceType = data.audience?.type ?? "all";
      const audienceClass = String(data.audience?.classId ?? "");
      const audienceRole = String(data.audience?.role ?? "");
      const audienceUsers = Array.isArray(data.audience?.userCodes)
        ? data.audience?.userCodes.map((code) => String(code).trim()).filter(Boolean)
        : [];
      if (audienceType === "role" && audienceRole !== role) {
        return NextResponse.json({ ok: false, message: "Not allowed." }, { status: 403 });
      }
      if (audienceType === "users" && !audienceUsers.includes(session.code)) {
        return NextResponse.json({ ok: false, message: "Not allowed." }, { status: 403 });
      }
      if (audienceType === "class" && !allowedClasses.includes(audienceClass)) {
        return NextResponse.json({ ok: false, message: "Not allowed." }, { status: 403 });
      }
    }

    return NextResponse.json({
      ok: true,
      data: {
        id: doc.id,
        title: data.title,
        body: data.body,
        createdAt: data.createdAt?.toDate
          ? data.createdAt.toDate().toISOString()
          : new Date().toISOString(),
        createdBy: data.createdBy ?? {},
      },
    });
  } catch (error) {
    console.error("GET /api/notifications/[id] error:", error);
    return NextResponse.json(
      { ok: false, message: "Failed to load notification." },
      { status: 500 }
    );
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
    const actor = await loadActor(session.code);
    if (!actor) {
      return NextResponse.json({ ok: false, message: "User not found." }, { status: 404 });
    }
    const role = normalizeRole(String(actor.role ?? session.role ?? "").trim().toLowerCase());
    if (!["admin", "system", "teacher", "notes"].includes(role)) {
      return NextResponse.json({ ok: false, message: "Not allowed." }, { status: 403 });
    }
    const { id } = await params;
    const db = getAdminDb();
    const ref = db.collection("notifications").doc(id);
    const doc = await ref.get();
    if (!doc.exists) {
      return NextResponse.json(
        { ok: false, message: "Not found." },
        { status: 404 }
      );
    }
    const data = doc.data() as { audience?: { type?: "all" | "class"; classId?: string } };
    if (role !== "admin" && role !== "notes" && data.audience?.type === "class") {
      const allowedClasses = await getAllowedClassesForUser(role, actor);
      const audienceClass = String(data.audience?.classId ?? "");
      if (!allowedClasses.includes(audienceClass)) {
        return NextResponse.json({ ok: false, message: "Not allowed." }, { status: 403 });
      }
    }

    await ref.delete();
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("DELETE /api/notifications/[id] error:", error);
    return NextResponse.json(
      { ok: false, message: "Failed to delete notification." },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = decodeSessionFromCookie(request);
    if (!session?.code || !session?.role) {
      return NextResponse.json({ ok: false, message: "Unauthorized." }, { status: 401 });
    }
    const actor = await loadActor(session.code);
    if (!actor) {
      return NextResponse.json({ ok: false, message: "User not found." }, { status: 404 });
    }
    const actorRole = normalizeRole(String(actor.role ?? session.role ?? "").trim().toLowerCase());
    const { id } = await params;
    const body = await request.json();
    const title = String(body.title ?? "").trim();
    const content = String(body.body ?? "").trim();
    const audience = body.audience ?? { type: "all" };
    const audienceType = audience?.type === "class" ? "class" : "all";
    const classId = audienceType === "class" ? String(audience.classId ?? "").trim() : undefined;
    const className =
      audienceType === "class" ? String(audience.className ?? "").trim() : undefined;

    if (!title || !content) {
      return NextResponse.json(
        { ok: false, message: "Missing required fields." },
        { status: 400 }
      );
    }
    if (!["admin", "system", "teacher", "notes"].includes(actorRole)) {
      return NextResponse.json(
        { ok: false, message: "Not allowed." },
        { status: 403 }
      );
    }
    if (audienceType === "class" && actorRole !== "admin" && actorRole !== "notes") {
      const allowedClasses = await getAllowedClassesForUser(actorRole, actor);
      if (!allowedClasses.includes(classId!)) {
        return NextResponse.json({ ok: false, message: "Not allowed." }, { status: 403 });
      }
    }

    const db = getAdminDb();
    const ref = db.collection("notifications").doc(id);
    await ref.set(
      {
        title,
        body: content,
        audience: {
          type: audienceType,
          classId: classId || undefined,
          className: className || undefined,
        },
      },
      { merge: true }
    );

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("PUT /api/notifications/[id] error:", error);
    return NextResponse.json(
      { ok: false, message: "Failed to update notification." },
      { status: 500 }
    );
  }
}
