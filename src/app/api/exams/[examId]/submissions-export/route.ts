import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
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

function styleCell(cell: ExcelJS.Cell, isHeader = false) {
  cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  cell.border = {
    top: { style: "thin", color: { argb: "FF9CA3AF" } },
    left: { style: "thin", color: { argb: "FF9CA3AF" } },
    bottom: { style: "thin", color: { argb: "FF9CA3AF" } },
    right: { style: "thin", color: { argb: "FF9CA3AF" } },
  };
  if (isHeader) {
    cell.font = { bold: true, color: { argb: "FF0F172A" } };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFE2E8F0" },
    };
  }
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ examId: string }> },
) {
  const resolvedParams = await params;
  const session = decodeSessionFromCookie(request);
  const role = normalizeRole(String(session?.role ?? "").trim());
  if (!role || !["admin", "teacher"].includes(role)) {
    return NextResponse.json({ ok: false, message: "Unauthorized." }, { status: 401 });
  }

  const examId = decodeURIComponent(String(resolvedParams.examId ?? "")).trim();
  if (!examId) {
    return NextResponse.json({ ok: false, message: "Exam not found." }, { status: 404 });
  }

  const db = getAdminDb();
  const examDoc = await db.collection("exams").doc(examId).get();
  if (!examDoc.exists) {
    return NextResponse.json({ ok: false, message: "Exam not found." }, { status: 404 });
  }
  const examData = examDoc.data() as { title?: string } | undefined;

  const questionsSnap = await db
    .collection("questions")
    .where("examId", "==", examId)
    .get();
  const questions = questionsSnap.docs.map((doc) => {
    const data = doc.data() as { text?: string };
    return { id: doc.id, text: String(data.text ?? "").trim() };
  });

  const submissionsSnap = await db
    .collection("exam_submissions")
    .where("examId", "==", examId)
    .get();
  const submissions: Array<Record<string, unknown> & { id: string; studentCode?: string }> =
    submissionsSnap.docs.map((doc) => ({
      id: doc.id,
      ...(doc.data() as Record<string, unknown>),
    }));

  const studentCodes = submissions
    .map((item) => String(item.studentCode ?? ""))
    .filter(Boolean);
  const studentMap = new Map<string, { name?: string; classes?: string[] }>();
  for (const code of studentCodes) {
    const directDoc = await db.collection("users").doc(code).get();
    if (directDoc.exists) {
      studentMap.set(code, directDoc.data() as { name?: string; classes?: string[] });
      continue;
    }
    const snap = await db.collection("users").where("code", "==", code).limit(1).get();
    if (!snap.empty) {
      studentMap.set(code, snap.docs[0].data() as { name?: string; classes?: string[] });
    }
  }

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("التسليمات", {
    views: [{ rightToLeft: true, state: "frozen", ySplit: 1 }],
  });

  const headers = [
    "اسم الطالب",
    "كود الطالب",
    "الفصل",
    ...questions.map((q, idx) => `سؤال ${idx + 1}: ${q.text || "بدون عنوان"}`),
    "المجموع",
  ];
  sheet.addRow(headers);
  sheet.getRow(1).height = 28;
  sheet.getRow(1).eachCell((cell) => styleCell(cell, true));

  submissions.forEach((submission) => {
    const code = String(submission.studentCode ?? "");
    const student = studentMap.get(code);
    const name = student?.name ?? String(submission.studentName ?? "");
    const classId = Array.isArray(student?.classes)
      ? String(student?.classes[0] ?? "")
      : String(submission.studentClass ?? "");
    const answers = (submission.answers ?? {}) as Record<
      string,
      { score?: number }
    >;
    const scores = questions.map((q) => Number(answers?.[q.id]?.score ?? 0));
    const total = scores.reduce((sum, value) => sum + value, 0);
    const row = [name, code, classId, ...scores, total];
    const added = sheet.addRow(row);
    added.eachCell((cell) => styleCell(cell, false));
  });

  sheet.columns.forEach((col) => {
    col.width = Math.min(40, Math.max(16, (col.header?.toString().length ?? 10) + 4));
  });

  const buffer = await workbook.xlsx.writeBuffer();
  const title = examData?.title ? examData.title.replace(/[\\/:*?"<>|]/g, "_") : "exam";
  const filename = `submissions_${title}.xlsx`;

  return new NextResponse(Buffer.from(buffer), {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${encodeURIComponent(filename)}"`,
    },
  });
}
