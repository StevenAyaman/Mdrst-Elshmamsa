import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";

export const runtime = "nodejs";

type AttendanceDoc = {
  code?: string;
  status?: string;
  date?: string;
  createdAt?: { toDate?: () => Date } | string;
};

type HomeworkGradeDoc = {
  code?: string;
  title?: string;
  subject?: string;
  score?: number;
  maxScore?: number;
  createdByRole?: string;
  createdAt?: { toDate?: () => Date } | string;
};

type KatamarsGradeDoc = {
  month?: string;
  classId?: string;
  score?: number;
  updatedAt?: { toDate?: () => Date } | string;
};

function toIsoDate(value: unknown) {
  if (value && typeof value === "object" && "toDate" in (value as Record<string, unknown>)) {
    const maybe = value as { toDate?: () => Date };
    if (maybe.toDate) return maybe.toDate().toISOString();
  }
  if (typeof value === "string") return value;
  return new Date().toISOString();
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

export async function GET(
  request: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  try {
    const session = decodeSessionFromCookie(request);
    const sessionRole = session?.role === "nzam" ? "system" : session?.role;
    if (!session?.code || !sessionRole) {
      return NextResponse.json(
        { ok: false, message: "Not allowed." },
        { status: 403 }
      );
    }

    const { code } = await params;
    const studentCode = String(code ?? "").trim();
    if (!studentCode) {
      return NextResponse.json(
        { ok: false, message: "Missing code." },
        { status: 400 }
      );
    }

    const db = getAdminDb();
    let actorRole = sessionRole;
    let actorClasses: string[] = [];
    let actorChildrenCodes: string[] = [];

    if (sessionRole !== "admin") {
      const actorDoc = await db.collection("users").doc(session.code).get();
      if (!actorDoc.exists) {
        return NextResponse.json({ ok: false, message: "Not allowed." }, { status: 403 });
      }
      const actor = actorDoc.data() as { role?: string; classes?: string[]; childrenCodes?: string[] };
      actorRole = String(actor.role ?? "").trim().toLowerCase();

      if (actorRole === "parent") {
        actorChildrenCodes = Array.isArray(actor.childrenCodes)
          ? actor.childrenCodes.map((value) => String(value).trim()).filter(Boolean)
          : [];
        if (!actorChildrenCodes.includes(studentCode)) {
          return NextResponse.json({ ok: false, message: "Not allowed." }, { status: 403 });
        }
      } else if (actorRole === "system" || actorRole === "teacher") {
        actorClasses = Array.isArray(actor.classes) ? actor.classes : [];
        if (!actorClasses.length) {
          return NextResponse.json({ ok: false, message: "Not allowed." }, { status: 403 });
        }
      } else if (actorRole === "katamars") {
        actorClasses = [];
      } else {
        return NextResponse.json({ ok: false, message: "Not allowed." }, { status: 403 });
      }
    }
    const userDoc = await db.collection("users").doc(studentCode).get();
    if (!userDoc.exists) {
      return NextResponse.json(
        { ok: false, message: "Student not found." },
        { status: 404 }
      );
    }

    const user = userDoc.data() as {
      code?: string;
      name?: string;
      role?: string;
      classes?: string[];
      parentCodes?: string[];
      preferredMass?: string;
      preferredService?: string;
      lastServiceType?: string;
      currentRank?: string;
      ordinationDate?: string;
      ordinationChurch?: string;
      ordainedBy?: string;
      lastServiceDate?: string;
      civilId?: string;
      civilCardPhoto?: string;
      profilePhoto?: string;
    };
    const userRole = String(user.role ?? "").trim().toLowerCase();
    if (userRole !== "student") {
      return NextResponse.json(
        { ok: false, message: "User is not a student." },
        { status: 400 }
      );
    }

    if (sessionRole !== "admin" && actorRole !== "parent" && actorRole !== "katamars") {
      const studentClasses = Array.isArray(user.classes) ? user.classes : [];
      const shared = studentClasses.find((c) => actorClasses.includes(c));
      if (!shared) {
        return NextResponse.json({ ok: false, message: "Not allowed." }, { status: 403 });
      }
    }

    if (sessionRole !== "admin" && actorRole === "parent") {
      const linked = actorChildrenCodes.includes(studentCode);
      if (!linked) {
        return NextResponse.json({ ok: false, message: "Not allowed." }, { status: 403 });
      }
    }

    const attendanceSnap = await db
      .collection("attendance")
      .where("code", "==", studentCode)
      .limit(200)
      .get();
    const attendanceRecords = attendanceSnap.docs.map((doc) => {
      const item = doc.data() as AttendanceDoc;
      return {
        id: doc.id,
        status: String(item.status ?? "").toLowerCase(),
        date: String(item.date ?? ""),
        createdAt: toIsoDate(item.createdAt),
      };
    });
    const present = attendanceRecords.filter((r) => r.status === "present").length;
    const absent = attendanceRecords.filter((r) => r.status === "absent").length;
    const absentDays = attendanceRecords
      .filter((r) => r.status === "absent")
      .map((r) => r.date || r.createdAt)
      .filter(Boolean);

    const gradesSnap = await db
      .collection("homeworkGrades")
      .where("code", "==", studentCode)
      .limit(200)
      .get();
    const homeworkGrades = gradesSnap.docs
      .map((doc) => {
        const item = doc.data() as HomeworkGradeDoc;
        return {
          id: doc.id,
          title: String(item.title ?? item.subject ?? "واجب"),
          subject: String(item.subject ?? ""),
          score: Number(item.score ?? 0),
          maxScore: Number(item.maxScore ?? 0),
          createdByRole: String(item.createdByRole ?? ""),
          createdAt: toIsoDate(item.createdAt),
        };
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    const katamarsSnap = await db
      .collection("katamars_competition_scores")
      .where("studentCode", "==", studentCode)
      .limit(50)
      .get();
    const katamarsGrades = katamarsSnap.docs
      .map((doc) => {
        const item = doc.data() as KatamarsGradeDoc;
        return {
          id: doc.id,
          month: String(item.month ?? ""),
          classId: String(item.classId ?? ""),
          score: Number(item.score ?? 0),
          updatedAt: toIsoDate(item.updatedAt),
        };
      })
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

    return NextResponse.json({
      ok: true,
      data: {
        code: user.code ?? studentCode,
        name: user.name ?? "",
        className: Array.isArray(user.classes) && user.classes.length ? user.classes[0] : "",
        parentCodes: Array.isArray(user.parentCodes) ? user.parentCodes : [],
        preferredMass: String(user.preferredMass ?? ""),
        preferredService: String(user.preferredService ?? ""),
        lastServiceType: String(user.lastServiceType ?? ""),
        currentRank: String(user.currentRank ?? ""),
        ordinationDate: String(user.ordinationDate ?? ""),
        ordinationChurch: String(user.ordinationChurch ?? ""),
        ordainedBy: String(user.ordainedBy ?? ""),
        lastServiceDate: String(user.lastServiceDate ?? ""),
        civilId: String(user.civilId ?? ""),
        civilCardPhoto: String(user.civilCardPhoto ?? ""),
        profilePhoto: String(user.profilePhoto ?? ""),
        attendance: {
          present,
          absent,
          absentDays,
        },
        grades: homeworkGrades,
        katamarsGrades,
      },
    });
  } catch (error) {
    console.error("GET /api/students/[code] error:", error);
    return NextResponse.json(
      { ok: false, message: "Failed to load student file." },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  try {
    const session = decodeSessionFromCookie(request);
    const sessionRole = session?.role === "nzam" ? "system" : session?.role;
    if (!session?.code || !sessionRole) {
      return NextResponse.json({ ok: false, message: "Not allowed." }, { status: 403 });
    }

    const { code } = await params;
    const studentCode = String(code ?? "").trim();
    if (!studentCode) {
      return NextResponse.json({ ok: false, message: "Missing code." }, { status: 400 });
    }

    const body = (await request.json()) as { profilePhoto?: string };
    const profilePhoto = String(body.profilePhoto ?? "").trim();
    if (!profilePhoto.startsWith("data:image/")) {
      return NextResponse.json({ ok: false, message: "Invalid photo." }, { status: 400 });
    }

    const db = getAdminDb();
    const studentDoc = await db.collection("users").doc(studentCode).get();
    if (!studentDoc.exists) {
      return NextResponse.json({ ok: false, message: "Student not found." }, { status: 404 });
    }
    const studentData = studentDoc.data() as { role?: string };
    if (String(studentData.role ?? "").trim().toLowerCase() !== "student") {
      return NextResponse.json({ ok: false, message: "User is not a student." }, { status: 400 });
    }

    if (sessionRole !== "admin") {
      if (sessionRole !== "parent") {
        return NextResponse.json({ ok: false, message: "Not allowed." }, { status: 403 });
      }
      const actorDoc = await db.collection("users").doc(session.code).get();
      if (!actorDoc.exists) {
        return NextResponse.json({ ok: false, message: "Not allowed." }, { status: 403 });
      }
      const actor = actorDoc.data() as { childrenCodes?: string[]; role?: string };
      if (String(actor.role ?? "").trim().toLowerCase() !== "parent") {
        return NextResponse.json({ ok: false, message: "Not allowed." }, { status: 403 });
      }
      const children = Array.isArray(actor.childrenCodes)
        ? actor.childrenCodes.map((v) => String(v).trim())
        : [];
      if (!children.includes(studentCode)) {
        return NextResponse.json({ ok: false, message: "Not allowed." }, { status: 403 });
      }
    }

    await db.collection("users").doc(studentCode).update({
      profilePhoto,
      updatedAt: new Date().toISOString(),
    });

    return NextResponse.json({ ok: true, data: { profilePhoto } });
  } catch (error) {
    console.error("PATCH /api/students/[code] error:", error);
    return NextResponse.json({ ok: false, message: "Failed to update student." }, { status: 500 });
  }
}
