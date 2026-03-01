import { NextResponse } from "next/server";
import * as xlsx from "xlsx";
import { getAdminDb } from "@/lib/firebase/admin";

export const runtime = "nodejs";

type SheetRow = Record<string, unknown>;
type UserDoc = { name?: string; role?: string; classes?: string[]; parentCodes?: string[] };

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

function normalizeName(value: string) {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
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
    const startsWithTemplateTitle = firstCell.includes("move accounts template");
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
    let updated = 0;
    let updatedParents = 0;
    let skipped = 0;
    const skipDetails: string[] = [];

    for (let index = 0; index < rows.length; index += 1) {
      const rowNo = index + 2;
      const row = rows[index];
      const code = readCell(row, ["Code", "code", "الكود"]);
      const name = readCell(row, ["Name", "name", "الاسم"]);
      const oldClass = readCell(row, ["Old Class", "oldClass", "Current Class", "class", "old class"]);
      const newClass = readCell(row, ["New Class", "newClass", "new class", "الفصل الجديد"]);

      if (!code || !name || !oldClass || !newClass) {
        skipped += 1;
        skipDetails.push(`Row ${rowNo}: missing code, name, old class, or new class`);
        continue;
      }

      const ref = db.collection("users").doc(code);
      const userDoc = await ref.get();
      if (!userDoc.exists) {
        skipped += 1;
        skipDetails.push(`Row ${rowNo}: user not found (${code})`);
        continue;
      }

      const user = userDoc.data() as UserDoc;
      const dbName = String((user as { name?: string }).name ?? "");
      if (normalizeName(dbName) !== normalizeName(name)) {
        skipped += 1;
        skipDetails.push(`Row ${rowNo}: name mismatch for code (${code})`);
        continue;
      }
      const role = String(user.role ?? "").trim().toLowerCase();
      if (role === "admin") {
        skipped += 1;
        skipDetails.push(`Row ${rowNo}: admin cannot be moved (${code})`);
        continue;
      }

      const classes = Array.isArray(user.classes) ? user.classes : [];
      if (!classes.includes(oldClass)) {
        skipped += 1;
        skipDetails.push(`Row ${rowNo}: old class mismatch (${code})`);
        continue;
      }

      let nextClasses: string[] = [newClass];
      if (role === "teacher") {
        nextClasses = Array.from(new Set(classes.map((c) => (c === oldClass ? newClass : c))));
      }

      await ref.set({ classes: nextClasses, updatedAt: new Date().toISOString() }, { merge: true });
      updated += 1;
      if (role === "student") {
        updatedParents += await moveLinkedParents(db, user, oldClass, newClass);
      }
    }

    return NextResponse.json({
      ok: true,
      data: {
        updated,
        updatedParents,
        skipped,
        skipDetails: skipDetails.slice(0, 40),
      },
    });
  } catch (error) {
    console.error("POST /api/users/promote/import error:", error);
    return NextResponse.json(
      { ok: false, message: "Failed to import promotions." },
      { status: 500 }
    );
  }
}
