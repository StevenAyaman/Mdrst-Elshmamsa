const fs = require('fs');
const path = require('path');
const envPath = path.join(process.cwd(), '.env.local');
for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  if (!line || line.startsWith('#')) continue;
  const idx = line.indexOf('=');
  if (idx === -1) continue;
  const k = line.slice(0, idx);
  const v = line.slice(idx + 1);
  process.env[k] = v;
}
const { applicationDefault, getApps, initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const app = getApps().length
  ? getApps()[0]
  : initializeApp({ credential: applicationDefault() });
const db = getFirestore(app);
(async () => {
  try {
    const cols = await db.listCollections();
    console.log('collections:', cols.map((c) => c.id));
    const snap = await db.collection('sensors').limit(5).get();
    console.log('sensors docs:', snap.docs.length);
  } catch (e) {
    console.error('error', e.code || '', e.message);
  }
})();
