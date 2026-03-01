const path = require("path");
const fs = require("fs");
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

async function seed() {
  loadEnv();
  const db = getFirestore(getApp());
  const names = ["1B", "1G", "2B", "2G", "3B", "3G", "4B", "4G", "5B", "5G"];

  const batch = db.batch();
  for (const name of names) {
    const ref = db.collection("classes").doc(name);
    batch.set(ref, { name });
  }
  await batch.commit();
  console.log("Classes seeded:", names.join(", "));
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
