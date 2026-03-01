const fs = require("fs");
const path = require("path");
const admin = require("firebase-admin");

const envPath = path.join(process.cwd(), ".env.local");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z0-9_]+)=(.*)$/);
    if (m) process.env[m[1]] = m[2];
  }
}

const projectId = process.env.FIREBASE_PROJECT_ID;
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
const privateKey = (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n");

if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.cert({ projectId, clientEmail, privateKey }) });
}

(async () => {
  const db = admin.firestore();
  const snap = await db.collection("users").get();
  const users = snap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
  console.log("COUNT", users.length);
  for (const u of users) {
    console.log(`${u.id}\t${u.name || ""}\t${u.role || ""}`);
  }
})();
