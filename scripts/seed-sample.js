const path = require("path");
const fs = require("fs");
const { getApps, initializeApp, applicationDefault, cert } = require("firebase-admin/app");
const { getFirestore, Timestamp } = require("firebase-admin/firestore");

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

loadEnv();

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

  return initializeApp({
    credential: cert({ projectId, clientEmail, privateKey }),
  });
}

async function seed() {
  const db = getFirestore(getApp());

  const users = [
    { code: "1111", startupPassword: "1111", role: "admin", name: "مدير النظام" },
    { code: "2222", startupPassword: "2222", role: "teacher", name: "أ. مينا" },
    { code: "3333", startupPassword: "3333", role: "system", name: "مسؤول تقني" },
    { code: "4444", startupPassword: "4444", role: "parent", name: "ولي أمر" },
    { code: "5555", startupPassword: "5555", role: "student", name: "طالب تجريبي" },
    { code: "9999", startupPassword: "9999", role: "nzam", name: "مشرف حضور" },
  ];

  const sensors = [
    { name: "Temp Hall", type: "temperature", value: 24.8, unit: "°C", status: "online" },
    { name: "Humidity Lab", type: "humidity", value: 52, unit: "%", status: "online" },
    { name: "Door Main", type: "contact", value: 1, unit: "state", status: "offline" },
  ];

  const batch = db.batch();

  for (const user of users) {
    const ref = db.collection("users").doc(user.code);
    batch.set(ref, {
      code: user.code,
      startupPassword: user.startupPassword,
      role: user.role,
      name: user.name,
    });
  }

  for (const sensor of sensors) {
    const ref = db.collection("sensors").doc();
    batch.set(ref, {
      ...sensor,
      updatedAt: Timestamp.now(),
    });
  }

  await batch.commit();
  console.log("Seed completed: users + sensors inserted.");
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
