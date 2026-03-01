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

async function getUserClasses(db: ReturnType<typeof getAdminDb>, code: string, role: string) {
  if (role === "student") {
    const doc = await db.collection("users").doc(code).get();
    if (!doc.exists) return [];
    const data = doc.data() as { classes?: string[] };
    return Array.isArray(data.classes) ? data.classes.map((c) => String(c).trim()).filter(Boolean) : [];
  }
  if (role === "parent") {
    const doc = await db.collection("users").doc(code).get();
    if (!doc.exists) return [];
    const data = doc.data() as { childrenCodes?: string[] };
    const children = Array.isArray(data.childrenCodes)
      ? data.childrenCodes.map((c) => String(c).trim()).filter(Boolean)
      : [];
    const classSet = new Set<string>();
    for (const childCode of children) {
      const childDoc = await db.collection("users").doc(childCode).get();
      if (!childDoc.exists) continue;
      const child = childDoc.data() as { classes?: string[] };
      const childClasses = Array.isArray(child.classes)
        ? child.classes.map((c) => String(c).trim()).filter(Boolean)
        : [];
      childClasses.forEach((cls) => classSet.add(cls));
    }
    return Array.from(classSet);
  }
  return [];
}

export async function GET(request: Request) {
  try {
    const session = decodeSessionFromCookie(request);
    if (!session?.code || !session?.role) {
      return NextResponse.json({ ok: false, message: "Unauthorized." }, { status: 401 });
    }
    const role = normalizeRole(String(session.role ?? "").trim().toLowerCase());
    if (!["student", "parent"].includes(role)) {
      return NextResponse.json({ ok: false, message: "Not allowed." }, { status: 403 });
    }

    const db = getAdminDb();
    const classIds = await getUserClasses(db, session.code, role);
    const staffSet = new Map<
      string,
      { code: string; name: string; role: string; classIds: string[] }
    >();

    for (const classId of classIds) {
      const snapshot = await db
        .collection("users")
        .where("classes", "array-contains", classId)
        .limit(200)
        .get();
      for (const doc of snapshot.docs) {
        const data = doc.data() as { code?: string; name?: string; role?: string; classes?: string[] };
        const userRole = normalizeRole(String(data.role ?? "").trim().toLowerCase());
        if (userRole !== "teacher" && userRole !== "system") continue;
        const code = String(data.code ?? doc.id).trim();
        if (!code) continue;
        const existing = staffSet.get(code);
        const nextClasses = Array.isArray(data.classes)
          ? data.classes.map((c) => String(c).trim()).filter(Boolean)
          : [];
        staffSet.set(code, {
          code,
          name: String(data.name ?? "").trim(),
          role: userRole,
          classIds: existing ? Array.from(new Set([...existing.classIds, ...nextClasses])) : nextClasses,
        });
      }
    }

    const notesSnapshot = await db.collection("users").where("role", "==", "notes").limit(10).get();
    const notes = notesSnapshot.docs.map((doc) => {
      const data = doc.data() as { code?: string; name?: string; role?: string };
      return {
        code: String(data.code ?? doc.id).trim(),
        name: String(data.name ?? "").trim(),
        role: "notes",
        classIds: [] as string[],
      };
    });

    const staff = Array.from(staffSet.values()).sort((a, b) =>
      a.name.localeCompare(b.name, "ar")
    );

    return NextResponse.json({
      ok: true,
      data: {
        notes,
        staff,
      },
    });
  } catch (error) {
    console.error("GET /api/inquiries/contacts error:", error);
    return NextResponse.json({ ok: false, message: "Failed to load contacts." }, { status: 500 });
  }
}
