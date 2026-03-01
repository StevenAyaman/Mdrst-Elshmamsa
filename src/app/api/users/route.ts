import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { mapRole } from "@/lib/code-mapper";
import { getAdminDb } from "@/lib/firebase/admin";
import { hashPassword } from "@/lib/password";

export const runtime = "nodejs";

type ActorPayload = {
  actorCode?: string;
  actorRole?: string;
};

type CreateUserPayload = ActorPayload & {
  code?: string;
  name?: string;
  role?: string;
  startupPassword?: string;
  classes?: string[];
  subjects?: string[];
  parentCodes?: string[]; // student: parent account codes, parent: child student codes
};

type DeleteUserPayload = ActorPayload & {
  targetCode?: string;
  clearAll?: boolean;
};

type UpdateUserPayload = ActorPayload & {
  originalCode?: string;
  code?: string;
  name?: string;
  parentCodes?: string[];
  childrenCodes?: string[];
};

const ALLOWED_SUBJECTS = new Set(["طقس", "اجبيه", "قطمارس", "الحان", "قبطي"]);

function normalizeSubjects(value: unknown) {
  if (!Array.isArray(value)) return [];
  const unique = new Set<string>();
  for (const item of value) {
    const subject = String(item ?? "").trim();
    if (!subject) continue;
    if (!ALLOWED_SUBJECTS.has(subject)) continue;
    unique.add(subject);
  }
  return Array.from(unique);
}

async function verifyAdminActor(actorCode: string, actorRole: string) {
  if (actorRole !== "admin") return false;
  const db = getAdminDb();
  const doc = await db.collection("users").doc(actorCode).get();
  if (!doc.exists) return false;
  const data = doc.data() as { role?: string };
  return String(data.role ?? "").trim().toLowerCase() === "admin";
}

function normalizeArabicName(value: string) {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
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

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const roleParam = String(url.searchParams.get("role") ?? "").trim().toLowerCase();
    const actorCode = String(url.searchParams.get("actorCode") ?? "").trim();
    const actorRole = String(url.searchParams.get("actorRole") ?? "").trim().toLowerCase();

    if (roleParam) {
      if (!actorCode || !actorRole) {
        return NextResponse.json(
          { ok: false, message: "Missing actor info." },
          { status: 400 }
        );
      }
      if (!isSessionActorMatch(request, actorCode, actorRole)) {
        return NextResponse.json(
          { ok: false, message: "Session mismatch." },
          { status: 401 }
        );
      }
      const canList = await verifyAdminActor(actorCode, actorRole);
      if (!canList) {
        return NextResponse.json(
          { ok: false, message: "Not allowed." },
          { status: 403 }
        );
      }

      const db = getAdminDb();
      const snapshot =
        roleParam === "system"
          ? await db.collection("users").where("role", "in", ["system", "nzam"]).get()
          : await db.collection("users").where("role", "==", roleParam).get();

      const data = snapshot.docs
        .map((doc) => {
          const item = doc.data() as {
            code?: string;
            name?: string;
            role?: string;
            classes?: string[];
            subjects?: string[];
            parentCodes?: string[];
            childrenCodes?: string[];
          };
          return {
            code: item.code ?? doc.id,
            name: item.name ?? "",
            role: item.role ?? "",
            classes: Array.isArray(item.classes) ? item.classes : [],
            subjects: Array.isArray(item.subjects) ? item.subjects : [],
            parentCodes: Array.isArray(item.parentCodes) ? item.parentCodes : [],
            childrenCodes: Array.isArray(item.childrenCodes) ? item.childrenCodes : [],
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name, "ar"));

      return NextResponse.json({ ok: true, data });
    }

    const code = String(url.searchParams.get("code") ?? "").trim();
    if (!code) {
      return NextResponse.json(
        { ok: false, message: "Missing code." },
        { status: 400 }
      );
    }

    const session = decodeSessionFromCookie(request);
    if (!session?.code || !session?.role) {
      return NextResponse.json(
        { ok: false, message: "Unauthorized." },
        { status: 401 }
      );
    }
    const sessionRole = session.role === "nzam" ? "system" : session.role;
    if (sessionRole !== "admin" && session.code !== code) {
      let allowedAsParent = false;
      if (sessionRole === "parent") {
        const sessionDoc = await getAdminDb().collection("users").doc(session.code).get();
        if (sessionDoc.exists) {
          const sessionData = sessionDoc.data() as { childrenCodes?: string[] };
          const childrenCodes = Array.isArray(sessionData.childrenCodes)
            ? sessionData.childrenCodes
            : [];
          allowedAsParent = childrenCodes.includes(code);
        }
      }
      if (!allowedAsParent) {
        return NextResponse.json(
          { ok: false, message: "Not allowed." },
          { status: 403 }
        );
      }
    }

    const db = getAdminDb();
    const snapshot = await db.collection("users").doc(code).get();
    if (!snapshot.exists) {
      return NextResponse.json(
        { ok: false, message: "Not found." },
        { status: 404 }
      );
    }

    const data = snapshot.data() as {
      name?: string;
      role?: string;
      classes?: string[];
      subjects?: string[];
      parentCodes?: string[];
      childrenCodes?: string[];
    };

    return NextResponse.json({
      ok: true,
      data: {
        code,
        name: data.name ?? "",
        role: data.role ?? "",
        classes: Array.isArray(data.classes) ? data.classes : [],
        subjects: Array.isArray(data.subjects) ? data.subjects : [],
        parentCodes: Array.isArray(data.parentCodes) ? data.parentCodes : [],
        childrenCodes: Array.isArray(data.childrenCodes) ? data.childrenCodes : [],
      },
    });
  } catch (error) {
    console.error("GET /api/users error:", error);
    return NextResponse.json(
      { ok: false, message: "Failed to load user." },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as CreateUserPayload;
    const actorCode = String(body.actorCode ?? "").trim();
    const actorRole = String(body.actorRole ?? "").trim().toLowerCase();
    if (!actorCode || !actorRole) {
      return NextResponse.json(
        { ok: false, message: "Missing actor info." },
        { status: 400 }
      );
    }
    if (!isSessionActorMatch(request, actorCode, actorRole)) {
      return NextResponse.json(
        { ok: false, message: "Session mismatch." },
        { status: 401 }
      );
    }
    const canCreate = await verifyAdminActor(actorCode, actorRole);
    if (!canCreate) {
      return NextResponse.json(
        { ok: false, message: "Not allowed." },
        { status: 403 }
      );
    }

    const name = String(body.name ?? "").trim();
    const startupPassword = String(body.startupPassword ?? "").trim();
    const mappedRole = mapRole(body.role ?? "");
    const requestedClasses = Array.isArray(body.classes)
      ? body.classes.map((v) => String(v).trim()).filter(Boolean)
      : [];
    const subjects = normalizeSubjects(body.subjects);
    const relationCodes = Array.isArray(body.parentCodes)
      ? body.parentCodes.map((v) => String(v).trim()).filter(Boolean)
      : [];

    if (!name || !startupPassword || !mappedRole) {
      return NextResponse.json(
        { ok: false, message: "Missing required fields." },
        { status: 400 }
      );
    }

    let classes = requestedClasses;
    if (mappedRole === "admin" || mappedRole === "notes") {
      classes = [];
    } else if (mappedRole === "parent") {
      classes = [];
      if (relationCodes.length < 1) {
        return NextResponse.json(
          { ok: false, message: "Parent must have at least one child code." },
          { status: 400 }
        );
      }
    } else if (mappedRole === "teacher") {
      if (classes.length < 1) {
        return NextResponse.json(
          { ok: false, message: "Teacher must have at least one class." },
          { status: 400 }
        );
      }
      if (subjects.length < 1) {
        return NextResponse.json(
          { ok: false, message: "Teacher must have at least one subject." },
          { status: 400 }
        );
      }
    } else if (classes.length !== 1) {
      return NextResponse.json(
        { ok: false, message: "Exactly one class is required for this role." },
        { status: 400 }
      );
    }

    const db = getAdminDb();
    const code = String(body.code ?? "").trim();
    if (!code) {
      return NextResponse.json(
        { ok: false, message: "User code is required." },
        { status: 400 }
      );
    }
    const exists = await db.collection("users").doc(code).get();
    if (exists.exists) {
      return NextResponse.json(
        { ok: false, message: "Code already exists." },
        { status: 409 }
      );
    }

    const passwordHash = await hashPassword(startupPassword);

    await db.collection("users").doc(code).set({
      code,
      name,
      role: mappedRole,
      startupPassword: "",
      passwordHash,
      mustChangePassword: true,
      classes,
      subjects: mappedRole === "teacher" ? subjects : [],
      parentCodes: mappedRole === "student" ? relationCodes : [],
      childrenCodes: mappedRole === "parent" ? relationCodes : [],
      createdAt: new Date().toISOString(),
    });

    // Parent row may contain child student codes; link students back to this parent account code.
    if (mappedRole === "parent") {
      for (const childCode of relationCodes) {
        const childRef = db.collection("users").doc(childCode);
        const childDoc = await childRef.get();
        if (!childDoc.exists) continue;
        const child = childDoc.data() as { role?: string };
        if (String(child.role ?? "").trim().toLowerCase() !== "student") continue;
        await childRef.update({
          parentCodes: FieldValue.arrayUnion(code),
        });
      }
    }

    return NextResponse.json({
      ok: true,
      data: { code, name, role: mappedRole, classes },
    });
  } catch (error) {
    console.error("POST /api/users error:", error);
    return NextResponse.json(
      { ok: false, message: "Failed to create user." },
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request) {
  try {
    const body = (await request.json()) as DeleteUserPayload;
    const actorCode = String(body.actorCode ?? "").trim();
    const actorRole = String(body.actorRole ?? "").trim().toLowerCase();
    const targetCode = String(body.targetCode ?? "").trim();
    const clearAll = Boolean(body.clearAll);

    if (!actorCode || !actorRole || (!targetCode && !clearAll)) {
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
    if (!clearAll && targetCode === actorCode) {
      return NextResponse.json(
        { ok: false, message: "لا يمكن حذف حسابك الحالي." },
        { status: 400 }
      );
    }

    const canDelete = await verifyAdminActor(actorCode, actorRole);
    if (!canDelete) {
      return NextResponse.json(
        { ok: false, message: "Not allowed." },
        { status: 403 }
      );
    }

    const db = getAdminDb();
    if (clearAll) {
      const snapshot = await db.collection("users").get();
      const deletable = snapshot.docs.filter((doc) => {
        if (doc.id === actorCode) return false;
        return true;
      });

      let deleted = 0;
      let batch = db.batch();
      let batchSize = 0;
      for (const doc of deletable) {
        batch.delete(doc.ref);
        batchSize += 1;
        deleted += 1;
        if (batchSize >= 400) {
          await batch.commit();
          batch = db.batch();
          batchSize = 0;
        }
      }
      if (batchSize > 0) {
        await batch.commit();
      }

      return NextResponse.json({
        ok: true,
        data: {
          deleted,
          kept: snapshot.size - deleted,
        },
      });
    }

    const targetRef = db.collection("users").doc(targetCode);
    const targetDoc = await targetRef.get();
    if (!targetDoc.exists) {
      return NextResponse.json(
        { ok: false, message: "User not found." },
        { status: 404 }
      );
    }
    await targetRef.delete();
    return NextResponse.json({ ok: true, data: { deleted: 1 } });
  } catch (error) {
    console.error("DELETE /api/users error:", error);
    return NextResponse.json(
      { ok: false, message: "Failed to delete user." },
      { status: 500 }
    );
  }
}

export async function PATCH(request: Request) {
  try {
    const body = (await request.json()) as UpdateUserPayload;
    const actorCode = String(body.actorCode ?? "").trim();
    const actorRole = String(body.actorRole ?? "").trim().toLowerCase();
    const originalCode = String(body.originalCode ?? "").trim();
    const nextCode = String(body.code ?? "").trim();
    const nextName = String(body.name ?? "").trim();
    const nextParentCodesRaw = Array.isArray(body.parentCodes)
      ? body.parentCodes.map((v) => String(v).trim()).filter(Boolean)
      : [];
    const nextChildrenCodesRaw = Array.isArray(body.childrenCodes)
      ? body.childrenCodes.map((v) => String(v).trim()).filter(Boolean)
      : [];

    if (!actorCode || !actorRole || !originalCode || !nextCode || !nextName) {
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
    const canEdit = await verifyAdminActor(actorCode, actorRole);
    if (!canEdit) {
      return NextResponse.json(
        { ok: false, message: "Not allowed." },
        { status: 403 }
      );
    }
    if (actorCode === originalCode && nextCode !== originalCode) {
      return NextResponse.json(
        { ok: false, message: "لا يمكن تغيير كود حسابك الحالي." },
        { status: 400 }
      );
    }

    const db = getAdminDb();
    const sourceRef = db.collection("users").doc(originalCode);
    const sourceDoc = await sourceRef.get();
    if (!sourceDoc.exists) {
      return NextResponse.json(
        { ok: false, message: "User not found." },
        { status: 404 }
      );
    }

    const source = sourceDoc.data() as {
      role?: string;
      classes?: string[];
      startupPassword?: string;
      parentCodes?: string[];
      childrenCodes?: string[];
      createdAt?: string;
      [key: string]: unknown;
    };
    const role = String(source.role ?? "").trim().toLowerCase();
    const nextParentCodes = role === "student" ? nextParentCodesRaw : [];
    const nextChildrenCodes = role === "parent" ? nextChildrenCodesRaw : [];

    const targetRef = db.collection("users").doc(nextCode);
    if (nextCode !== originalCode) {
      const targetDoc = await targetRef.get();
      if (targetDoc.exists) {
        return NextResponse.json(
          { ok: false, message: "Code already exists." },
          { status: 409 }
        );
      }
    }

    const nextData = {
      ...source,
      code: nextCode,
      name: nextName,
      parentCodes: nextParentCodes,
      childrenCodes: nextChildrenCodes,
      updatedAt: new Date().toISOString(),
    };

    if (nextCode === originalCode) {
      await sourceRef.set(nextData);
    } else {
      const batch = db.batch();
      batch.set(targetRef, nextData);
      batch.delete(sourceRef);
      await batch.commit();

      // Keep parent-child links valid if a parent code changed.
      const linkedSnapshot = await db
        .collection("users")
        .where("parentCodes", "array-contains", originalCode)
        .get();
      for (const doc of linkedSnapshot.docs) {
        const data = doc.data() as { parentCodes?: string[] };
        const parentCodes = Array.isArray(data.parentCodes) ? data.parentCodes : [];
        const replaced = parentCodes.map((value) =>
          value === originalCode ? nextCode : value
        );
        await doc.ref.update({ parentCodes: replaced });
      }
    }

    return NextResponse.json({
      ok: true,
      data: {
        originalCode,
        code: nextCode,
        name: nextName,
        parentCodes: nextParentCodes,
        childrenCodes: nextChildrenCodes,
      },
    });
  } catch (error) {
    console.error("PATCH /api/users error:", error);
    return NextResponse.json(
      { ok: false, message: "Failed to update user." },
      { status: 500 }
    );
  }
}
