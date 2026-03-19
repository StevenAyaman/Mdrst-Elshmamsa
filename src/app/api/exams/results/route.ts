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

async function loadUser(db: ReturnType<typeof getAdminDb>, code: string) {
  const directDoc = await db.collection("users").doc(code).get();
  if (directDoc.exists) return directDoc.data() as { childrenCodes?: string[] };
  const snapshot = await db.collection("users").where("code", "==", code).limit(1).get();
  if (snapshot.empty) return null;
  return snapshot.docs[0].data() as { childrenCodes?: string[] };
}

function normalizeList(value: unknown) {
  const raw = Array.isArray(value)
    ? value.map((v) => String(v))
    : typeof value === "string"
      ? value.split(/[,،]/).map((v) => String(v).trim())
      : [];
  return raw.map((v) => String(v).trim()).filter(Boolean);
}

export async function GET(request: Request) {
  const session = decodeSessionFromCookie(request);
  const actorCode = String(session?.code ?? "").trim();
  const role = normalizeRole(String(session?.role ?? "").trim());
  if (!actorCode || !["student", "parent"].includes(role)) {
    return NextResponse.json({ ok: false, message: "Unauthorized." }, { status: 401 });
  }

  const db = getAdminDb();
  const url = new URL(request.url);
  const targetCode = String(url.searchParams.get("studentCode") ?? "").trim();

  let codes: string[] = [];
  if (role === "student") {
    codes = [actorCode];
  } else {
    const actor = await loadUser(db, actorCode);
    if (!actor) {
      return NextResponse.json({ ok: false, message: "User not found." }, { status: 404 });
    }
    codes = normalizeList(actor.childrenCodes);
    if (targetCode) {
      codes = codes.filter((code) => code === targetCode);
    }
  }

  const submissions: Record<string, unknown>[] = [];
  const chunks: string[][] = [];
  for (let i = 0; i < codes.length; i += 10) {
    chunks.push(codes.slice(i, i + 10));
  }
  if (!chunks.length) {
    return NextResponse.json({ ok: true, data: [] });
  }
  for (const chunk of chunks) {
    const snap = await db
      .collection("exam_submissions")
      .where("studentCode", "in", chunk)
      .get();
    snap.docs.forEach((doc) => submissions.push(doc.data() as Record<string, unknown>));
  }

  const finishedSubmissions = submissions.filter((item) => item.finished);

  const examIds = Array.from(new Set(finishedSubmissions.map((s) => String(s.examId ?? ""))).values()).filter(Boolean);
  const examsMap = new Map<string, Record<string, unknown>>();
  for (const examId of examIds) {
    const examSnap = await db.collection("exams").doc(examId).get();
    if (examSnap.exists) {
      examsMap.set(examId, examSnap.data() as Record<string, unknown>);
    }
  }

  const result = finishedSubmissions.map((submission) => {
    const examId = String(submission.examId ?? "");
    const exam = examsMap.get(examId) ?? {};
    return {
      examId,
      studentCode: submission.studentCode,
      score: submission.score ?? 0,
      pendingCount: submission.pendingCount ?? 0,
      title: exam.title ?? "اختبار",
      subject: exam.subject ?? "",
      classId: exam.classId ?? "",
      createdAt: exam.createdAt ?? null,
      submittedAt: submission.submittedAt ?? null,
    };
  });

  return NextResponse.json({ ok: true, data: result });
}
