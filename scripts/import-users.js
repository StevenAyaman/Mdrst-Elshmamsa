const path = require("path");
const fs = require("fs");
const xlsx = require("xlsx");
const { getApps, initializeApp, applicationDefault, cert } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

function loadEnv() {
  const envPath = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx === -1) continue;
    const k = line.slice(0, idx);
    const v = line.slice(idx + 1);
    if (!process.env[k]) process.env[k] = v;
  }
}

function getApp() {
  if (getApps().length) return getApps()[0];

  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    return initializeApp({ credential: applicationDefault() });
  }

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error("Missing Firebase credentials. Set GOOGLE_APPLICATION_CREDENTIALS or env vars.");
  }

  return initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
}

function normalize(value) {
  return String(value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function mapRole(raw) {
  const role = normalize(raw);
  if (!role) return null;
  if (["admin", "مدير"].includes(role)) return "admin";
  if (["system", "system admin", "مدير النظام"].includes(role)) return "system";
  if (["nzam", "نزام", "نطام"].includes(role)) return "nzam";
  if (["teacher", "مدرس"].includes(role)) return "teacher";
  if (["parent", "ولي امر", "ولي أمر", "وليالامر"].includes(role)) return "parent";
  if (["student", "طالب"].includes(role)) return "student";
  return null;
}

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { role: "student", file: "Data.xlsx" };
  for (const arg of args) {
    if (arg.startsWith("--role=")) out.role = arg.split("=")[1];
    if (arg.startsWith("--file=")) out.file = arg.split("=")[1];
    if (arg === "--all") out.role = "all";
  }
  return out;
}

function parseList(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return [];
  return raw
    .split(/[,،]/)
    .map((v) => v.trim())
    .filter(Boolean);
}

async function main() {
  loadEnv();
  const { role, file } = parseArgs();
  const filePath = path.isAbsolute(file) ? file : path.join(process.cwd(), file);

  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const workbook = xlsx.readFile(filePath);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = xlsx.utils.sheet_to_json(sheet, { defval: "" });

  const db = getFirestore(getApp());
  let imported = 0;
  let skipped = 0;

  const parentToStudents = new Map();

  const batchLimit = 400;
  let batch = db.batch();
  let batchCount = 0;

  for (const row of rows) {
    const code = String(row["Code"] ?? row["code"] ?? "").trim();
    const name = String(row["Name"] ?? row["name"] ?? "").trim();
    const rawRole = row["Role"] ?? row["role"];
    const startupPassword = String(row["Startup Password"] ?? row["startupPassword"] ?? "").trim();
    const classes = parseList(row["Classes"] ?? row["classes"]);
    const parentCodes = parseList(row["Parent Codes"] ?? row["parent codes"] ?? row["parentCodes"]);
    const mappedRole = mapRole(rawRole);

    if (!code || !name || !startupPassword || !mappedRole) {
      skipped += 1;
      continue;
    }

    if (role !== "all" && mappedRole !== role) {
      skipped += 1;
      continue;
    }

    const ref = db.collection("users").doc(code);
    batch.set(ref, {
      code,
      name,
      role: mappedRole,
      startupPassword,
      classes,
      parentCodes: mappedRole === "student" ? parentCodes : [],
    });
    batchCount += 1;
    imported += 1;

    if (mappedRole === "student" && parentCodes.length) {
      for (const parentCode of parentCodes) {
        const list = parentToStudents.get(parentCode) ?? new Set();
        list.add(code);
        parentToStudents.set(parentCode, list);
      }
    }

    if (batchCount >= batchLimit) {
      await batch.commit();
      batch = db.batch();
      batchCount = 0;
    }
  }

  if (batchCount > 0) {
    await batch.commit();
  }

  // Back-fill parent studentCodes based on student parentCodes.
  let parentUpdates = 0;
  if (parentToStudents.size > 0) {
    let parentBatch = db.batch();
    let parentCount = 0;
    for (const [parentCode, students] of parentToStudents.entries()) {
      const ref = db.collection("users").doc(parentCode);
      parentBatch.set(
        ref,
        {
          studentCodes: Array.from(students),
        },
        { merge: true }
      );
      parentCount += 1;
      parentUpdates += 1;
      if (parentCount >= batchLimit) {
        await parentBatch.commit();
        parentBatch = db.batch();
        parentCount = 0;
      }
    }
    if (parentCount > 0) {
      await parentBatch.commit();
    }
  }

  console.log(
    `Done. Imported: ${imported}. Skipped: ${skipped}. Parents updated: ${parentUpdates}.`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
