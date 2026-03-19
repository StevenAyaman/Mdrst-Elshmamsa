import { NextResponse } from "next/server";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";
import * as xlsx from "xlsx";
import { mapRole } from "@/lib/code-mapper";
import { getAdminDb } from "@/lib/firebase/admin";
import { hashPassword } from "@/lib/password";

export const runtime = "nodejs";

type SheetRow = Record<string, unknown>;
const ALLOWED_SUBJECTS = new Set(["طقس", "اجبيه", "قطمارس", "الحان", "قبطي"]);

function parseList(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw) return [];
  return raw
    .split(/[,،]/)
    .map((v) => v.trim())
    .filter(Boolean);
}

function readCell(row: SheetRow, keys: string[]) {
  const entries = Object.entries(row).map(([key, value]) => ({
    key,
    normalized: key.trim().toLowerCase(),
    value,
  }));

  for (const key of keys) {
    const normalizedTarget = key.trim().toLowerCase();
    const exact = entries.find((entry) => entry.key === key);
    if (exact && exact.value !== undefined && exact.value !== null && String(exact.value).trim()) {
      return String(exact.value).trim();
    }
    const loose = entries.find((entry) => entry.normalized === normalizedTarget);
    if (loose && loose.value !== undefined && loose.value !== null && String(loose.value).trim()) {
      return String(loose.value).trim();
    }
  }
  return "";
}

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

function splitChunks<T>(arr: T[], size: number) {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

async function notifyAdmins(title: string, body: string, data: Record<string, string> = {}) {
  const db = getAdminDb();
  await db.collection("notifications").add({
    title,
    body,
    createdAt: Timestamp.now(),
    createdBy: { name: "نظام الحسابات", code: "system", role: "system" },
    audience: { type: "role", role: "admin" },
    data,
  });

  const tokensSnap = await db.collection("pushTokens").where("role", "==", "admin").get();
  const tokens = tokensSnap.docs
    .map((doc) => (doc.data() as { token?: string }).token)
    .filter(Boolean) as string[];
  if (!tokens.length) return;

  const messaging = getMessaging();
  for (const chunk of splitChunks(tokens, 500)) {
    await messaging.sendEachForMulticast({
      tokens: chunk,
      notification: { title, body },
      data,
    });
  }
}

async function generateUniqueCode(localReserved: Set<string>) {
  const db = getAdminDb();
  for (let i = 0; i < 40; i += 1) {
    const code = String(Math.floor(100000 + Math.random() * 900000));
    if (localReserved.has(code)) continue;
    const exists = await db.collection("users").doc(code).get();
    if (!exists.exists) return code;
  }
  throw new Error("Failed to generate unique code.");
}

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const actorCode = String(form.get("actorCode") ?? "").trim();
    const actorRole = String(form.get("actorRole") ?? "").trim().toLowerCase();
    const file = form.get("file");

    if (!actorCode || !actorRole || !(file instanceof File)) {
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
    const canImport = await verifyAdminActor(actorCode, actorRole);
    if (!canImport) {
      return NextResponse.json(
        { ok: false, message: "Not allowed." },
        { status: 403 }
      );
    }

    const bytes = await file.arrayBuffer();
    const workbook = xlsx.read(bytes, { type: "array" });
    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
    if (!firstSheet) {
      return NextResponse.json(
        { ok: false, message: "Excel file is empty." },
        { status: 400 }
      );
    }

    const firstCell = String((firstSheet["A1"]?.v ?? "")).trim().toLowerCase();
    const startsWithTemplateTitle = firstCell.includes("users import template");
    const rows = xlsx.utils.sheet_to_json(firstSheet, {
      defval: "",
      // Our generated template has a title row in row 1 and headers in row 2.
      range: startsWithTemplateTitle ? 1 : 0,
    }) as SheetRow[];
    if (!rows.length) {
      return NextResponse.json(
        { ok: false, message: "No rows found in file." },
        { status: 400 }
      );
    }

    const db = getAdminDb();
    const createdCodes: string[] = [];
    const skipped: string[] = [];
    const reservedCodes = new Set<string>();

    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      const rowNo = index + 2;

      const name = readCell(row, ["Name", "name", "الاسم"]);
      const roleRaw = readCell(row, ["Role", "role", "الدور"]);
      const startupPassword = readCell(row, [
        "Startup Password",
        "Startup password",
        "startupPassword",
        "password",
        "Password",
        "كلمة المرور",
      ]);
      const classesRaw = readCell(row, ["Classes", "classes", "الفصول", "class"]);
      const subjectsRaw = readCell(row, ["Subject", "subject", "Subjects", "subjects", "المادة", "المواد"]);
      const parentCodesRaw = readCell(row, [
        "Parent Codes",
        "parent codes",
        "parentCodes",
        "اكواد اولياء الامور",
      ]);
      const studentCodesRaw = readCell(row, [
        "Student Codes",
        "student codes",
        "studentCodes",
        "Child Codes",
        "child codes",
        "childrenCodes",
        "اكواد الابناء",
      ]);

      const mappedRole = mapRole(roleRaw);
      const isCompletelyEmpty =
        !name &&
        !roleRaw &&
        !startupPassword &&
        !String(classesRaw ?? "").trim() &&
        !String(subjectsRaw ?? "").trim() &&
        !String(parentCodesRaw ?? "").trim() &&
        !String(studentCodesRaw ?? "").trim() &&
        !readCell(row, ["Code", "code", "الكود"]);

      // Ignore empty lines in the Excel file.
      if (isCompletelyEmpty) {
        continue;
      }

      if (!name || !startupPassword || !mappedRole) {
        skipped.push(`Row ${rowNo}: missing name/password/role`);
        continue;
      }

      let classes = parseList(classesRaw);
      const subjects = parseList(subjectsRaw).filter((value) => ALLOWED_SUBJECTS.has(value));
      if (mappedRole === "admin" || mappedRole === "notes" || mappedRole === "katamars") {
        classes = [];
      } else if (mappedRole === "parent") {
        classes = [];
      } else if (mappedRole === "teacher") {
        if (classes.length < 1) {
          skipped.push(`Row ${rowNo}: teacher needs at least one class`);
          continue;
        }
        if (subjects.length < 1) {
          skipped.push(`Row ${rowNo}: teacher needs Subject`);
          continue;
        }
      } else if (classes.length !== 1) {
        skipped.push(`Row ${rowNo}: exactly one class required for role ${mappedRole}`);
        continue;
      }

      const relationCodes =
        mappedRole === "parent" ? parseList(studentCodesRaw) : parseList(parentCodesRaw);
      if (mappedRole === "parent" && relationCodes.length < 1) {
        skipped.push(`Row ${rowNo}: parent needs Student Codes`);
        continue;
      }
      const parentCodes = mappedRole === "student" ? relationCodes : [];
      const childrenCodes = mappedRole === "parent" ? relationCodes : [];

      let code = readCell(row, ["Code", "code", "الكود"]);
      if (code) {
        if (reservedCodes.has(code)) {
          skipped.push(`Row ${rowNo}: duplicate code in file`);
          continue;
        }
        const exists = await db.collection("users").doc(code).get();
        if (exists.exists) {
          skipped.push(`Row ${rowNo}: code already exists`);
          continue;
        }
      } else {
        code = await generateUniqueCode(reservedCodes);
      }
      reservedCodes.add(code);

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
        parentCodes,
        childrenCodes,
        createdAt: new Date().toISOString(),
      });

      // Parent row may include child codes; mirror the relationship on student docs.
      if (mappedRole === "parent") {
        for (const childCode of childrenCodes) {
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
      createdCodes.push(code);
    }

    try {
      if (createdCodes.length) {
        const title = "تم استيراد حسابات جديدة";
        const bodyText = `تم استيراد ${createdCodes.length} حساب جديد عبر ملف Excel.`;
        await notifyAdmins(title, bodyText, { type: "accounts_import" });
      }
    } catch (notifyError) {
      console.error("Import users notification failed:", notifyError);
    }

    return NextResponse.json({
      ok: true,
      data: {
        imported: createdCodes.length,
        skipped: skipped.length,
        createdCodes,
        skipDetails: skipped.slice(0, 25),
      },
    });
  } catch (error) {
    console.error("POST /api/users/import error:", error);
    return NextResponse.json(
      { ok: false, message: "Failed to import users." },
      { status: 500 }
    );
  }
}
