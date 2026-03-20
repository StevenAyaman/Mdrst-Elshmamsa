import { NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";
import { getAdminDb } from "@/lib/firebase/admin";

export const runtime = "nodejs";

type NotificationDoc = {
  title: string;
  body: string;
  createdAt: Timestamp;
  createdBy: {
    name: string;
    code: string;
    role: string;
  };
  audience: {
    type: "all" | "class" | "role" | "users";
    classId?: string;
    className?: string;
    role?: string;
    userCodes?: string[];
  };
};

const publishRoles = new Set(["admin", "system", "teacher", "notes"]);

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

function splitChunks<T>(arr: T[], size: number) {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

async function loadActor(code: string) {
  const db = getAdminDb();
  const doc = await db.collection("users").doc(code).get();
  if (doc.exists) return doc.data() as { role?: string; name?: string; classes?: string[]; childrenCodes?: string[] };
  const snapshot = await db.collection("users").where("code", "==", code).limit(1).get();
  if (snapshot.empty) return null;
  return snapshot.docs[0].data() as { role?: string; name?: string; classes?: string[]; childrenCodes?: string[] };
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

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const limitParam = url.searchParams.get("limit");
    const limit = limitParam ? Math.min(Number(limitParam) || 10, 50) : 10;
    const session = decodeSessionFromCookie(request);
    if (!session?.code || !session?.role) {
      return NextResponse.json({ ok: false, message: "Unauthorized." }, { status: 401 });
    }
    const actor = await loadActor(session.code);
    if (!actor) {
      return NextResponse.json({ ok: false, message: "User not found." }, { status: 404 });
    }
    const role = normalizeRole(String(actor.role ?? session.role ?? "").trim().toLowerCase());
    const sessionCode = String(session.code ?? "").trim();
    const classId = String(url.searchParams.get("classId") ?? "").trim();
    const allowedClasses = await getAllowedClassesForUser(role, actor);

    const db = getAdminDb();
    const snapshot = await db
      .collection("notifications")
      .orderBy("createdAt", "desc")
      .limit(Math.max(limit, 50))
      .get();

    let data = snapshot.docs.map((doc) => {
      const item = doc.data() as NotificationDoc;
      return {
        id: doc.id,
        title: item.title,
        body: item.body,
        createdAt: item.createdAt?.toDate
          ? item.createdAt.toDate().toISOString()
          : new Date().toISOString(),
        createdBy: item.createdBy,
        audience: item.audience,
      };
    });

    if (!publishRoles.has(role)) {
      if (!allowedClasses.length) {
        return NextResponse.json({ ok: false, message: "Not allowed." }, { status: 403 });
      }
      if (classId && !allowedClasses.includes(classId)) {
        return NextResponse.json({ ok: false, message: "Not allowed." }, { status: 403 });
      }
      data = data.filter((item) => {
        if (item.audience?.type === "role") {
          return item.audience.role === role;
        }
        if (item.audience?.type === "users") {
          const targetCodes = Array.isArray(item.audience.userCodes)
            ? item.audience.userCodes.map((code) => String(code).trim()).filter(Boolean)
            : [];
          return targetCodes.includes(sessionCode);
        }
        if (item.audience?.type === "all") return true;
        if (item.audience?.type === "class") {
          const targetClass = item.audience.classId ?? "";
          if (classId) return targetClass === classId;
          return allowedClasses.includes(targetClass);
        }
        return false;
      });
    } else if (role === "admin") {
      data = data.filter((item) => {
        if (item.audience?.type === "role" && item.audience.role === "notes") {
          return false;
        }
        return true;
      });
    }

    data = data.slice(0, limit);
    return NextResponse.json({ ok: true, data });
  } catch (error) {
    console.error("GET /api/notifications error:", error);
    return NextResponse.json(
      { ok: false, message: "Failed to load notifications." },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const title = String(body.title ?? "").trim();
    const content = String(body.body ?? "").trim();
    const session = decodeSessionFromCookie(request);
    if (!session?.code || !session?.role) {
      return NextResponse.json({ ok: false, message: "Unauthorized." }, { status: 401 });
    }
    const actor = await loadActor(session.code);
    if (!actor) {
      return NextResponse.json({ ok: false, message: "User not found." }, { status: 404 });
    }
    const name = String(actor.name ?? "").trim();
    const code = String(session.code ?? "").trim();
    const role = normalizeRole(String(actor.role ?? session.role ?? "").trim().toLowerCase());
    const audience = body.audience ?? { type: "all" };
    const audienceType =
      audience?.type === "class"
        ? "class"
        : audience?.type === "users"
          ? "users"
          : "all";
    const classId = audienceType === "class" ? String(audience.classId ?? "").trim() : undefined;
    const className =
      audienceType === "class" ? String(audience.className ?? "").trim() : undefined;
    const userCodes =
      audienceType === "users"
        ? Array.isArray(audience.userCodes)
          ? audience.userCodes.map((code: string) => String(code).trim()).filter(Boolean)
          : []
        : [];

    if (!title || !content || !name || !code || !role) {
      return NextResponse.json(
        { ok: false, message: "Missing required fields." },
        { status: 400 }
      );
    }
    if (!publishRoles.has(role)) {
      return NextResponse.json(
        { ok: false, message: "Not allowed." },
        { status: 403 }
      );
    }
    if (role === "system" && audienceType === "all") {
      return NextResponse.json(
        { ok: false, message: "Not allowed." },
        { status: 403 }
      );
    }
    if (audienceType === "class" && !classId) {
      return NextResponse.json(
        { ok: false, message: "Class is required for class audience." },
        { status: 400 }
      );
    }
    if (audienceType === "users" && !userCodes.length) {
      return NextResponse.json(
        { ok: false, message: "User codes are required for users audience." },
        { status: 400 }
      );
    }
    if (audienceType === "class" && role !== "admin" && role !== "notes") {
      const allowedClasses = await getAllowedClassesForUser(role, actor);
      if (!allowedClasses.includes(classId!)) {
        return NextResponse.json({ ok: false, message: "Not allowed." }, { status: 403 });
      }
    }

    const db = getAdminDb();
    const payload: NotificationDoc = {
      title,
      body: content,
      createdAt: Timestamp.now(),
      createdBy: { name, code, role },
      audience:
        audienceType === "class"
          ? { type: "class", classId: classId!, className: className || classId! }
          : audienceType === "users"
            ? { type: "users", userCodes }
          : { type: "all" },
    };

    const ref = await db.collection("notifications").add(payload);
    const saved = await ref.get();
    const doc = saved.data() as NotificationDoc;

    // Push notifications
    let tokens: string[] = [];
    if (audienceType === "class" && classId) {
      const tokensSnapshot = await db
        .collection("pushTokens")
        .where("classIds", "array-contains", classId)
        .get();
      tokens = tokensSnapshot.docs
        .map((d) => (d.data() as { token?: string }).token)
        .filter(Boolean) as string[];
    } else if (audienceType === "users" && userCodes.length) {
      const tokenSet = new Set<string>();
      for (const codesChunk of splitChunks(userCodes, 10)) {
        const tokensSnapshot = await db
          .collection("pushTokens")
          .where("userCode", "in", codesChunk)
          .get();
        for (const doc of tokensSnapshot.docs) {
          const token = String((doc.data() as { token?: string }).token ?? "").trim();
          if (token) tokenSet.add(token);
        }
      }
      tokens = Array.from(tokenSet);
    } else {
      const tokensSnapshot = await db.collection("pushTokens").get();
      tokens = tokensSnapshot.docs
        .map((d) => (d.data() as { token?: string }).token)
        .filter(Boolean) as string[];
    }

    if (tokens.length) {
      try {
        const messaging = getMessaging();
        const chunks: string[][] = [];
        for (let i = 0; i < tokens.length; i += 500) {
          chunks.push(tokens.slice(i, i + 500));
        }
        await Promise.all(
          chunks.map((chunk) =>
            messaging.sendEachForMulticast({
              tokens: chunk,
              notification: {
                title: title,
                body: content,
              },
              data: {
                notificationId: ref.id,
                audienceType,
                classId: classId || "",
              },
            })
          )
        );
      } catch (pushError) {
        console.error("Push send failed:", pushError);
      }
    }

    return NextResponse.json({
      ok: true,
      data: {
        id: ref.id,
        title: doc.title,
        body: doc.body,
        createdAt: doc.createdAt.toDate().toISOString(),
        createdBy: doc.createdBy,
        audience: doc.audience,
      },
    });
  } catch (error) {
    console.error("POST /api/notifications error:", error);
    return NextResponse.json(
      { ok: false, message: "Failed to create notification." },
      { status: 500 }
    );
  }
}
