import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";

export const runtime = "nodejs";

type SessionPayload = { code?: string; role?: string };

function decodeSessionFromCookie(request: Request): SessionPayload | null {
  const cookieHeader = request.headers.get("cookie") ?? "";
  const pairs = cookieHeader.split(";").map((v) => v.trim());
  const sessionPair = pairs.find((p) => p.startsWith("dsms_session="));
  if (!sessionPair) return null;
  const encoded = sessionPair.slice("dsms_session=".length);
  try {
    const decoded = Buffer.from(encoded, "base64url").toString("utf8");
    const parsed = JSON.parse(decoded) as SessionPayload;
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
  if (doc.exists) return doc.data() as { role?: string; classes?: string[] };
  const snapshot = await db.collection("users").where("code", "==", code).limit(1).get();
  if (snapshot.empty) return null;
  return snapshot.docs[0].data() as { role?: string; classes?: string[] };
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
    const { id } = await params;
    const actor = await loadActor(session.code);
    if (!actor) {
      return NextResponse.json({ ok: false, message: "User not found." }, { status: 404 });
    }
    const role = normalizeRole(String(actor.role ?? "").trim().toLowerCase());
    const classes = Array.isArray(actor.classes) ? actor.classes : [];
    if (role !== "admin") {
      if (role !== "system" && role !== "teacher") {
        return NextResponse.json({ ok: false, message: "Not allowed." }, { status: 403 });
      }
      if (!classes.includes(id)) {
        return NextResponse.json({ ok: false, message: "Not allowed." }, { status: 403 });
      }
    }

    const db = getAdminDb();

    const usersSnapshot = await db
      .collection("users")
      .where("classes", "array-contains", id)
      .get();

    const users = usersSnapshot.docs.map((doc) => {
      const data = doc.data() as {
        code?: string;
        name?: string;
        role?: string;
        subjects?: string[];
        parentCodes?: string[];
      };
      return {
        id: doc.id,
        code: data.code ?? doc.id,
        name: data.name ?? "",
        role: (data.role ?? "student").toString(),
        subjects: Array.isArray(data.subjects) ? data.subjects : [],
        parentCodes: Array.isArray(data.parentCodes) ? data.parentCodes : [],
      };
    });

    const groups = {
      students: users.filter((u) => u.role === "student"),
      teachers: users.filter((u) => u.role === "teacher"),
      systems: users.filter((u) => u.role === "system"),
      parents: users.filter((u) => u.role === "parent"),
    };

    return NextResponse.json({
      ok: true,
      data: {
        classId: id,
        groups,
      },
    });
  } catch (error) {
    console.error("GET /api/classes/[id] error:", error);
    return NextResponse.json(
      { ok: false, message: "Failed to load class." },
      { status: 500 }
    );
  }
}
