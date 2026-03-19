import { NextResponse } from "next/server";
import { getMessaging } from "firebase-admin/messaging";
import { getAdminDb } from "@/lib/firebase/admin";

export const runtime = "nodejs";

type Session = { code: string; role: string } | null;

function decodeSessionFromCookie(request: Request): Session {
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
  if (!doc.exists) return null;
  const data = doc.data() as {
    code?: string;
    name?: string;
    role?: string;
    classes?: string[];
  };
  return {
    code: String(data.code ?? code),
    name: String(data.name ?? ""),
    role: normalizeRole(String(data.role ?? "").trim().toLowerCase()),
    classes: Array.isArray(data.classes) ? data.classes.map((c) => String(c).trim()) : [],
  };
}

export async function GET(request: Request) {
  try {
    const session = decodeSessionFromCookie(request);
    const actorCode = String(session?.code ?? "").trim();
    const actorRole = normalizeRole(String(session?.role ?? "").trim().toLowerCase());
    if (!actorCode || !actorRole) {
      return NextResponse.json({ ok: false, message: "Unauthorized." }, { status: 401 });
    }

    const actor = await loadActor(actorCode);
    if (!actor || actor.role !== actorRole) {
      return NextResponse.json({ ok: false, message: "Session mismatch." }, { status: 401 });
    }
    if (!["admin", "system", "teacher"].includes(actorRole)) {
      return NextResponse.json({ ok: false, message: "Not allowed." }, { status: 403 });
    }

    const db = getAdminDb();

    if (actorRole === "admin") {
      const snapshot = await db.collection("complaints").limit(500).get();
      const data = snapshot.docs
        .map((doc) => {
          const item = doc.data() as Record<string, unknown>;
          return {
            id: doc.id,
            studentCode: String(item.studentCode ?? ""),
            studentName: String(item.studentName ?? ""),
            classId: String(item.classId ?? ""),
            message: String(item.message ?? ""),
            replyMessage: String(item.replyMessage ?? ""),
            repliedAt: String(item.repliedAt ?? ""),
            repliedByName: String(item.repliedByName ?? ""),
            createdByCode: String(item.createdByCode ?? ""),
            createdByName: String(item.createdByName ?? ""),
            createdByRole: String(item.createdByRole ?? ""),
            seen: Boolean(item.seen),
            deletedBy: Array.isArray(item.deletedBy) ? item.deletedBy : [],
            createdAt: String(item.createdAt ?? ""),
            seenAt: String(item.seenAt ?? ""),
          };
        })
        .filter((item) => !item.deletedBy.includes(actorCode))
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));

      const classesSnapshot = await db.collection("classes").get();
      const classes = classesSnapshot.docs.map((doc) => doc.id).sort((a, b) => a.localeCompare(b, "en"));
      const studentsByClass = new Map<string, Array<{ code: string; name: string }>>();
      for (const classId of classes) {
        const classStudents = await db
          .collection("users")
          .where("role", "==", "student")
          .where("classes", "array-contains", classId)
          .limit(500)
          .get();
        const list = classStudents.docs
          .map((doc) => {
            const item = doc.data() as { code?: string; name?: string };
            return {
              code: String(item.code ?? doc.id),
              name: String(item.name ?? ""),
            };
          })
          .sort((a, b) => a.name.localeCompare(b.name, "ar"));
        studentsByClass.set(classId, list);
      }

      return NextResponse.json({
        ok: true,
        data,
        meta: {
          classes,
          studentsByClass: Object.fromEntries(studentsByClass),
        },
      });
    }

    const mySnapshot = await db
      .collection("complaints")
      .where("createdByCode", "==", actorCode)
      .limit(300)
      .get();

    const data = mySnapshot.docs
      .map((doc) => {
        const item = doc.data() as Record<string, unknown>;
        return {
          id: doc.id,
          studentCode: String(item.studentCode ?? ""),
          studentName: String(item.studentName ?? ""),
          classId: String(item.classId ?? ""),
          message: String(item.message ?? ""),
          replyMessage: String(item.replyMessage ?? ""),
          repliedAt: String(item.repliedAt ?? ""),
          repliedByName: String(item.repliedByName ?? ""),
          seen: Boolean(item.seen),
          deletedBy: Array.isArray(item.deletedBy) ? item.deletedBy : [],
          createdAt: String(item.createdAt ?? ""),
          seenAt: String(item.seenAt ?? ""),
        };
      })
      .filter((item) => !item.deletedBy.includes(actorCode))
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));

    const studentsByClass = new Map<string, Array<{ code: string; name: string }>>();
    for (const classId of actor.classes) {
      if (!classId) continue;
      const classStudents = await db
        .collection("users")
        .where("role", "==", "student")
        .where("classes", "array-contains", classId)
        .limit(500)
        .get();

      const list = classStudents.docs
        .map((doc) => {
          const item = doc.data() as { code?: string; name?: string };
          return {
            code: String(item.code ?? doc.id),
            name: String(item.name ?? ""),
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name, "ar"));
      studentsByClass.set(classId, list);
    }

    return NextResponse.json({
      ok: true,
      data,
      meta: {
        classes: actor.classes,
        studentsByClass: Object.fromEntries(studentsByClass),
      },
    });
  } catch (error) {
    console.error("GET /api/complaints error:", error);
    return NextResponse.json({ ok: false, message: "Failed to load complaints." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = decodeSessionFromCookie(request);
    const actorCode = String(session?.code ?? "").trim();
    const actorRole = normalizeRole(String(session?.role ?? "").trim().toLowerCase());
    if (!actorCode || !actorRole) {
      return NextResponse.json({ ok: false, message: "Unauthorized." }, { status: 401 });
    }
    if (!["system", "teacher", "admin"].includes(actorRole)) {
      return NextResponse.json({ ok: false, message: "Not allowed." }, { status: 403 });
    }

    const actor = await loadActor(actorCode);
    if (!actor || actor.role !== actorRole) {
      return NextResponse.json({ ok: false, message: "Session mismatch." }, { status: 401 });
    }

    const body = (await request.json()) as {
      studentCode?: string;
      message?: string;
    };
    const studentCode = String(body.studentCode ?? "").trim();
    const message = String(body.message ?? "").trim();
    if (!studentCode || !message) {
      return NextResponse.json({ ok: false, message: "Missing fields." }, { status: 400 });
    }
    if (message.length < 5) {
      return NextResponse.json({ ok: false, message: "نص الشكوى قصير." }, { status: 400 });
    }

    const db = getAdminDb();
    const studentDoc = await db.collection("users").doc(studentCode).get();
    if (!studentDoc.exists) {
      return NextResponse.json({ ok: false, message: "الطالب غير موجود." }, { status: 404 });
    }
    const student = studentDoc.data() as {
      name?: string;
      role?: string;
      classes?: string[];
      parentCodes?: string[];
    };
    if (String(student.role ?? "").trim().toLowerCase() !== "student") {
      return NextResponse.json({ ok: false, message: "المستخدم ليس طالباً." }, { status: 400 });
    }
    const studentClasses = Array.isArray(student.classes)
      ? student.classes.map((c) => String(c).trim()).filter(Boolean)
      : [];
    const sharedClass = studentClasses.find((c) => actor.classes.includes(c));
    if (!sharedClass && actorRole !== "admin") {
      return NextResponse.json(
        { ok: false, message: "لا يمكنك تقديم شكوى لطالب خارج فصولك." },
        { status: 403 }
      );
    }
    const targetClass = sharedClass || studentClasses[0] || "";

    const now = new Date().toISOString();
    const ref = await db.collection("complaints").add({
      studentCode,
      studentName: String(student.name ?? ""),
      classId: targetClass,
      message,
      createdByCode: actor.code,
      createdByName: actor.name,
      createdByRole: actor.role,
      seen: false,
      deletedBy: [],
      createdAt: now,
      seenAt: "",
      seenByCode: "",
    });

    try {
      await db.collection("notifications").add({
        title: "ملاحظة سلوك",
        body: `تم إرسال ملاحظة سلوك بخصوص الطالب ${String(student.name ?? studentCode)}.`,
        createdAt: new Date(),
        createdBy: {
          name: actor.name,
          code: actor.code,
          role: actor.role,
        },
        audience: {
          type: "role",
          role: "notes",
        },
      });
    } catch (notifyError) {
      console.error("Complaint notification doc failed:", notifyError);
    }

    // Notify student + parent accounts about the complaint.
    try {
      const parentCodeSet = new Set(
        Array.isArray(student.parentCodes)
          ? student.parentCodes.map((code) => String(code).trim()).filter(Boolean)
          : []
      );

      // Fallback: parent account can be linked from childrenCodes.
      if (!parentCodeSet.size) {
        const parentSnapshot = await db
          .collection("users")
          .where("role", "==", "parent")
          .where("childrenCodes", "array-contains", studentCode)
          .get();
        for (const parentDoc of parentSnapshot.docs) {
          parentCodeSet.add(parentDoc.id);
        }
      }

      const targetCodeSet = new Set<string>([studentCode]);
      parentCodeSet.forEach((code) => targetCodeSet.add(code));
      const targetCodes = Array.from(targetCodeSet);
      if (targetCodes.length) {
        const tokenSet = new Set<string>();
        for (const codesChunk of splitChunks(targetCodes, 10)) {
          const tokensSnapshot = await db
            .collection("pushTokens")
            .where("userCode", "in", codesChunk)
            .get();
          for (const tokenDoc of tokensSnapshot.docs) {
            const token = String((tokenDoc.data() as { token?: string }).token ?? "").trim();
            if (token) tokenSet.add(token);
          }
        }

        const tokens = Array.from(tokenSet);
        if (tokens.length) {
          const title = "ملاحظة سلوك";
          const body = `تم إرسال ملاحظة سلوك بخصوص الطالب ${String(student.name ?? studentCode)}.`;
          const messaging = getMessaging();
          for (const tokenChunk of splitChunks(tokens, 500)) {
            await messaging.sendEachForMulticast({
              tokens: tokenChunk,
              notification: { title, body },
              data: {
                type: "complaint",
                complaintId: ref.id,
                studentCode,
                classId: targetClass,
              },
            });
          }
        }
      }
    } catch (pushError) {
      console.error("Complaint parent push failed:", pushError);
    }

    return NextResponse.json({ ok: true, data: { id: ref.id } });
  } catch (error) {
    console.error("POST /api/complaints error:", error);
    return NextResponse.json({ ok: false, message: "Failed to create complaint." }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const session = decodeSessionFromCookie(request);
    const actorCode = String(session?.code ?? "").trim();
    const actorRole = normalizeRole(String(session?.role ?? "").trim().toLowerCase());
    if (!actorCode || !actorRole) {
      return NextResponse.json({ ok: false, message: "Unauthorized." }, { status: 401 });
    }
    if (actorRole !== "admin") {
      return NextResponse.json({ ok: false, message: "Not allowed." }, { status: 403 });
    }

    const actor = await loadActor(actorCode);
    if (!actor || actor.role !== "admin") {
      return NextResponse.json({ ok: false, message: "Not allowed." }, { status: 403 });
    }

    const body = (await request.json()) as { id?: string; seen?: boolean; replyMessage?: string };
    const id = String(body.id ?? "").trim();
    if (!id) {
      return NextResponse.json({ ok: false, message: "Missing complaint id." }, { status: 400 });
    }

    const db = getAdminDb();
    const ref = db.collection("complaints").doc(id);
    const doc = await ref.get();
    if (!doc.exists) {
      return NextResponse.json({ ok: false, message: "Complaint not found." }, { status: 404 });
    }

    const replyMessage = String(body.replyMessage ?? "").trim();
    const nextSeen = typeof body.seen === "boolean" ? body.seen : undefined;
    const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() };

    if (typeof nextSeen === "boolean") {
      updates.seen = nextSeen;
      updates.seenAt = nextSeen ? new Date().toISOString() : "";
      updates.seenByCode = nextSeen ? actorCode : "";
    }

    if (replyMessage) {
      updates.replyMessage = replyMessage;
      updates.repliedAt = new Date().toISOString();
      updates.repliedByCode = actorCode;
      updates.repliedByName = actor.name;
      updates.repliedByRole = actor.role;
    }

    await ref.update(updates);

    if (replyMessage) {
      try {
        const data = doc.data() as { studentCode?: string; classId?: string };
        const studentCode = String(data.studentCode ?? "").trim();
        if (studentCode) {
          const studentDoc = await db.collection("users").doc(studentCode).get();
          if (studentDoc.exists) {
            const student = studentDoc.data() as { parentCodes?: string[] };
            const targetCodes = new Set<string>([studentCode]);
            const parentCodes = Array.isArray(student.parentCodes)
              ? student.parentCodes.map((code) => String(code).trim()).filter(Boolean)
              : [];
            parentCodes.forEach((code) => targetCodes.add(code));

            const codeChunks = splitChunks(Array.from(targetCodes), 10);
            const tokenSet = new Set<string>();
            for (const chunk of codeChunks) {
              const tokensSnapshot = await db
                .collection("pushTokens")
                .where("userCode", "in", chunk)
                .get();
              for (const tokenDoc of tokensSnapshot.docs) {
                const token = String((tokenDoc.data() as { token?: string }).token ?? "").trim();
                if (token) tokenSet.add(token);
              }
            }

            const tokens = Array.from(tokenSet);
            if (tokens.length) {
              const messaging = getMessaging();
              const title = "رد على ملاحظة سلوك";
              const body = replyMessage;
              for (const tokenChunk of splitChunks(tokens, 500)) {
                await messaging.sendEachForMulticast({
                  tokens: tokenChunk,
                  notification: { title, body },
                  data: {
                    type: "complaint-reply",
                    complaintId: id,
                    studentCode,
                  },
                });
              }
            }
          }
        }
      } catch (pushError) {
        console.error("Complaint reply push failed:", pushError);
      }
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("PATCH /api/complaints error:", error);
    return NextResponse.json({ ok: false, message: "Failed to update complaint." }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const session = decodeSessionFromCookie(request);
    const actorCode = String(session?.code ?? "").trim();
    const actorRole = normalizeRole(String(session?.role ?? "").trim().toLowerCase());
    if (!actorCode || !actorRole) {
      return NextResponse.json({ ok: false, message: "Unauthorized." }, { status: 401 });
    }
    if (!["admin", "system", "teacher"].includes(actorRole)) {
      return NextResponse.json({ ok: false, message: "Not allowed." }, { status: 403 });
    }

    const actor = await loadActor(actorCode);
    if (!actor || actor.role !== actorRole) {
      return NextResponse.json({ ok: false, message: "Session mismatch." }, { status: 401 });
    }

    const body = (await request.json()) as { id?: string; mode?: "me" | "all" };
    const id = String(body.id ?? "").trim();
    const mode = body.mode === "all" ? "all" : "me";
    if (!id) {
      return NextResponse.json({ ok: false, message: "Missing complaint id." }, { status: 400 });
    }

    const db = getAdminDb();
    const ref = db.collection("complaints").doc(id);
    const doc = await ref.get();
    if (!doc.exists) {
      return NextResponse.json({ ok: false, message: "Complaint not found." }, { status: 404 });
    }
    const data = doc.data() as {
      createdByCode?: string;
      seen?: boolean;
      deletedBy?: string[];
    };

    if (mode === "all") {
      if (actorRole === "admin") {
        return NextResponse.json({ ok: false, message: "Not allowed." }, { status: 403 });
      }
      if (String(data.createdByCode ?? "") !== actorCode) {
        return NextResponse.json({ ok: false, message: "Not allowed." }, { status: 403 });
      }
      if (Boolean(data.seen)) {
        return NextResponse.json({ ok: false, message: "Not allowed." }, { status: 403 });
      }
      await ref.delete();
      return NextResponse.json({ ok: true, data: { deleted: "all" } });
    }

    // delete for me
    if (actorRole !== "admin" && String(data.createdByCode ?? "") !== actorCode) {
      return NextResponse.json({ ok: false, message: "Not allowed." }, { status: 403 });
    }

    const deletedBy = Array.isArray(data.deletedBy) ? data.deletedBy : [];
    if (!deletedBy.includes(actorCode)) {
      deletedBy.push(actorCode);
      await ref.update({
        deletedBy,
        updatedAt: new Date().toISOString(),
      });
    }

    return NextResponse.json({ ok: true, data: { deleted: "me" } });
  } catch (error) {
    console.error("DELETE /api/complaints error:", error);
    return NextResponse.json({ ok: false, message: "Failed to delete complaint." }, { status: 500 });
  }
}
