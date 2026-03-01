import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";

export const runtime = "nodejs";

type PromotePayload = {
  actorCode?: string;
  actorRole?: string;
  code?: string;
  oldClass?: string;
  newClass?: string;
};

type UserDoc = {
  role?: string;
  classes?: string[];
  name?: string;
  parentCodes?: string[];
};

async function verifyAdminActor(actorCode: string, actorRole: string) {
  if (actorRole !== "admin") return false;
  const db = getAdminDb();
  const doc = await db.collection("users").doc(actorCode).get();
  if (!doc.exists) return false;
  const data = doc.data() as { role?: string };
  return String(data.role ?? "").trim().toLowerCase() === "admin";
}

function decodeSessionFromCookie(request: Request) {
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

function isSessionActorMatch(request: Request, actorCode: string, actorRole: string) {
  const session = decodeSessionFromCookie(request);
  if (!session?.code || !session?.role) return false;
  const normalizedRole = session.role === "nzam" ? "system" : session.role;
  const requestedRole = actorRole === "nzam" ? "system" : actorRole;
  return session.code === actorCode && normalizedRole === requestedRole;
}

async function moveLinkedParents(
  db: ReturnType<typeof getAdminDb>,
  student: UserDoc,
  oldClass: string,
  newClass: string
) {
  const parentCodes = Array.isArray(student.parentCodes)
    ? student.parentCodes.map((v) => String(v).trim()).filter(Boolean)
    : [];
  let updatedParents = 0;

  for (const parentCode of parentCodes) {
    const parentRef = db.collection("users").doc(parentCode);
    const parentDoc = await parentRef.get();
    if (!parentDoc.exists) continue;
    const parent = parentDoc.data() as UserDoc;
    const parentRole = String(parent.role ?? "").trim().toLowerCase();
    if (parentRole !== "parent") continue;

    const parentClasses = Array.isArray(parent.classes) ? parent.classes : [];
    let nextClasses = parentClasses;
    if (parentClasses.includes(oldClass)) {
      nextClasses = Array.from(
        new Set(parentClasses.map((c) => (c === oldClass ? newClass : c)))
      );
    } else if (!parentClasses.includes(newClass)) {
      nextClasses = Array.from(new Set([...parentClasses, newClass]));
    }

    await parentRef.set(
      {
        classes: nextClasses,
        updatedAt: new Date().toISOString(),
      },
      { merge: true }
    );
    updatedParents += 1;
  }

  return updatedParents;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as PromotePayload;
    const actorCode = String(body.actorCode ?? "").trim();
    const actorRole = String(body.actorRole ?? "").trim().toLowerCase();
    const code = String(body.code ?? "").trim();
    const oldClass = String(body.oldClass ?? "").trim();
    const newClass = String(body.newClass ?? "").trim();

    if (!actorCode || !actorRole || !code || !oldClass || !newClass) {
      return NextResponse.json(
        { ok: false, message: "Missing required fields." },
        { status: 400 }
      );
    }
    if (!isSessionActorMatch(request, actorCode, actorRole)) {
      return NextResponse.json(
        { ok: false, message: "Session mismatch." },
        { status: 401 }
      );
    }

    const canPromote = await verifyAdminActor(actorCode, actorRole);
    if (!canPromote) {
      return NextResponse.json(
        { ok: false, message: "Not allowed." },
        { status: 403 }
      );
    }

    const db = getAdminDb();
    const userRef = db.collection("users").doc(code);
    const userDoc = await userRef.get();
    if (!userDoc.exists) {
      return NextResponse.json(
        { ok: false, message: "User not found." },
        { status: 404 }
      );
    }

    const user = userDoc.data() as UserDoc;
    const role = String(user.role ?? "").trim().toLowerCase();
    if (role === "admin") {
      return NextResponse.json(
        { ok: false, message: "لا يمكن نقل الأدمن بين الفصول." },
        { status: 400 }
      );
    }

    const classes = Array.isArray(user.classes) ? user.classes : [];
    if (!classes.includes(oldClass)) {
      return NextResponse.json(
        { ok: false, message: "Old class does not match current user class." },
        { status: 400 }
      );
    }

    let nextClasses: string[] = [newClass];
    if (role === "teacher") {
      nextClasses = Array.from(new Set(classes.map((c) => (c === oldClass ? newClass : c))));
    }

    await userRef.set({ classes: nextClasses, updatedAt: new Date().toISOString() }, { merge: true });
    const updatedParents =
      role === "student" ? await moveLinkedParents(db, user, oldClass, newClass) : 0;

    return NextResponse.json({
      ok: true,
      data: {
        code,
        name: String(user.name ?? ""),
        oldClasses: classes,
        newClasses: nextClasses,
        updatedParents,
      },
    });
  } catch (error) {
    console.error("POST /api/users/promote error:", error);
    return NextResponse.json(
      { ok: false, message: "Failed to promote user." },
      { status: 500 }
    );
  }
}
