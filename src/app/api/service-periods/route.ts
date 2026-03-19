import { NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";

export const runtime = "nodejs";

type SessionPayload = { code?: string; role?: string };

type CreatePeriodPayload = {
  actorCode?: string;
  actorRole?: string;
  name?: string;
  startDate?: string;
  endDate?: string;
  active?: boolean;
  term1Name?: string;
  term2Name?: string;
  activeTerm?: "term1" | "term2";
  term1Start?: string;
  term1End?: string;
  term2Start?: string;
  term2End?: string;
};

type UpdatePeriodPayload = {
  actorCode?: string;
  actorRole?: string;
  id?: string;
  name?: string;
  startDate?: string;
  endDate?: string;
  active?: boolean;
  term1Name?: string;
  term2Name?: string;
  activeTerm?: "term1" | "term2";
  term1Start?: string;
  term1End?: string;
  term2Start?: string;
  term2End?: string;
};

type DeletePeriodPayload = {
  actorCode?: string;
  actorRole?: string;
  id?: string;
};

function decodeSessionFromCookie(request: Request) {
  const cookieHeader = request.headers.get("cookie") ?? "";
  const pairs = cookieHeader.split(";").map((v) => v.trim());
  const sessionPair = pairs.find((p) => p.startsWith("dsms_session="));
  if (!sessionPair) return null;
  const encoded = sessionPair.slice("dsms_session=".length);
  try {
    const decoded = Buffer.from(encoded, "base64url").toString("utf8");
    const parsed = JSON.parse(decoded) as SessionPayload;
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

function isSessionActorMatch(request: Request, actorCode: string, actorRole: string) {
  const session = decodeSessionFromCookie(request);
  if (!session?.code || !session?.role) return false;
  return session.code === actorCode && normalizeRole(session.role) === normalizeRole(actorRole);
}

async function verifyAdminActor(actorCode: string, actorRole: string) {
  if (normalizeRole(actorRole) !== "admin") return false;
  const db = getAdminDb();
  const doc = await db.collection("users").doc(actorCode).get();
  if (!doc.exists) return false;
  const data = doc.data() as { role?: string };
  return normalizeRole(String(data.role ?? "").trim().toLowerCase()) === "admin";
}

function isIsoDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

async function deleteQueryBatch(query: FirebaseFirestore.Query) {
  const snapshot = await query.get();
  if (snapshot.empty) return 0;
  const db = getAdminDb();
  let batch = db.batch();
  let counter = 0;
  let deleted = 0;
  for (const doc of snapshot.docs) {
    batch.delete(doc.ref);
    counter += 1;
    deleted += 1;
    if (counter >= 400) {
      await batch.commit();
      batch = db.batch();
      counter = 0;
    }
  }
  if (counter > 0) {
    await batch.commit();
  }
  return deleted;
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const status = String(url.searchParams.get("status") ?? "all").trim().toLowerCase();
    const actorCode = String(url.searchParams.get("actorCode") ?? "").trim();
    const actorRole = String(url.searchParams.get("actorRole") ?? "").trim().toLowerCase();

    if (!actorCode || !actorRole) {
      return NextResponse.json({ ok: false, message: "Missing actor info." }, { status: 400 });
    }
    if (!isSessionActorMatch(request, actorCode, actorRole)) {
      return NextResponse.json({ ok: false, message: "Session mismatch." }, { status: 401 });
    }

    const role = normalizeRole(actorRole);
    if (role !== "admin" && role !== "system" && role !== "teacher") {
      return NextResponse.json({ ok: false, message: "Not allowed." }, { status: 403 });
    }

    const db = getAdminDb();
    let query = db.collection("service_periods");

    if (status === "active" || role !== "admin") {
      query = query.where("active", "==", true) as typeof query;
    }

    const snapshot = await query.get();
    const data = snapshot.docs
      .map((doc) => {
        const item = doc.data() as {
          name?: string;
          startDate?: string;
          endDate?: string;
          active?: boolean;
          createdAt?: string;
          term1Name?: string;
          term2Name?: string;
          activeTerm?: string;
          term1Start?: string;
          term1End?: string;
          term2Start?: string;
          term2End?: string;
        };
        return {
          id: doc.id,
          name: String(item.name ?? ""),
          startDate: String(item.startDate ?? ""),
          endDate: String(item.endDate ?? ""),
          active: Boolean(item.active),
          createdAt: String(item.createdAt ?? ""),
          term1Name: String(item.term1Name ?? ""),
          term2Name: String(item.term2Name ?? ""),
          activeTerm: item.activeTerm === "term2" ? "term2" : "term1",
          term1Start: String(item.term1Start ?? ""),
          term1End: String(item.term1End ?? ""),
          term2Start: String(item.term2Start ?? ""),
          term2End: String(item.term2End ?? ""),
        };
      })
      .sort((a, b) => (a.startDate < b.startDate ? 1 : -1));

    return NextResponse.json({ ok: true, data });
  } catch (error) {
    console.error("GET /api/service-periods error:", error);
    return NextResponse.json({ ok: false, message: "Failed to load periods." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as CreatePeriodPayload;
    const actorCode = String(body.actorCode ?? "").trim();
    const actorRole = String(body.actorRole ?? "").trim().toLowerCase();
    const name = String(body.name ?? "").trim();
    const startDate = String(body.startDate ?? "").trim();
    const endDate = String(body.endDate ?? "").trim();
    const active = Boolean(body.active);
    const term1Name = String(body.term1Name ?? "").trim();
    const term2Name = String(body.term2Name ?? "").trim();
    const activeTerm = body.activeTerm === "term2" ? "term2" : "term1";
    const term1Start = String(body.term1Start ?? "").trim();
    const term1End = String(body.term1End ?? "").trim();
    const term2Start = String(body.term2Start ?? "").trim();
    const term2End = String(body.term2End ?? "").trim();

    if (
      !actorCode ||
      !actorRole ||
      !name ||
      !term1Name ||
      !term2Name ||
      !term1Start ||
      !term1End ||
      !term2Start ||
      !term2End
    ) {
      return NextResponse.json({ ok: false, message: "Missing required fields." }, { status: 400 });
    }
    if (
      !isIsoDate(term1Start) ||
      !isIsoDate(term1End) ||
      !isIsoDate(term2Start) ||
      !isIsoDate(term2End) ||
      term1Start > term1End ||
      term2Start > term2End
    ) {
      return NextResponse.json({ ok: false, message: "تواريخ التيرم غير صحيحة." }, { status: 400 });
    }
    const computedStartDate = term1Start;
    const computedEndDate = term2End;
    if (!isIsoDate(computedStartDate) || !isIsoDate(computedEndDate) || computedStartDate > computedEndDate) {
      return NextResponse.json({ ok: false, message: "تواريخ الفترة غير صحيحة." }, { status: 400 });
    }
    if (!isSessionActorMatch(request, actorCode, actorRole)) {
      return NextResponse.json({ ok: false, message: "Session mismatch." }, { status: 401 });
    }
    const canCreate = await verifyAdminActor(actorCode, actorRole);
    if (!canCreate) {
      return NextResponse.json({ ok: false, message: "Not allowed." }, { status: 403 });
    }

    const db = getAdminDb();
    if (active) {
      const activeSnapshot = await db.collection("service_periods").where("active", "==", true).get();
      for (const doc of activeSnapshot.docs) {
        await doc.ref.update({ active: false, updatedAt: new Date().toISOString() });
      }
    }

    const ref = await db.collection("service_periods").add({
      name,
      startDate: computedStartDate,
      endDate: computedEndDate,
      active,
      term1Name,
      term2Name,
      activeTerm,
      term1Start,
      term1End,
      term2Start,
      term2End,
      createdAt: new Date().toISOString(),
      createdBy: actorCode,
    });

    return NextResponse.json({
      ok: true,
      data: {
        id: ref.id,
        name,
        startDate: computedStartDate,
        endDate: computedEndDate,
        active,
        term1Name,
        term2Name,
        activeTerm,
        term1Start,
        term1End,
        term2Start,
        term2End,
      },
    });
  } catch (error) {
    console.error("POST /api/service-periods error:", error);
    return NextResponse.json({ ok: false, message: "Failed to create period." }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const body = (await request.json()) as UpdatePeriodPayload;
    const actorCode = String(body.actorCode ?? "").trim();
    const actorRole = String(body.actorRole ?? "").trim().toLowerCase();
    const id = String(body.id ?? "").trim();
    const name = String(body.name ?? "").trim();
    const startDate = String(body.startDate ?? "").trim();
    const endDate = String(body.endDate ?? "").trim();
    const active = body.active;
    const term1Name = String(body.term1Name ?? "").trim();
    const term2Name = String(body.term2Name ?? "").trim();
    const activeTerm = body.activeTerm === "term2" ? "term2" : "term1";
    const term1Start = String(body.term1Start ?? "").trim();
    const term1End = String(body.term1End ?? "").trim();
    const term2Start = String(body.term2Start ?? "").trim();
    const term2End = String(body.term2End ?? "").trim();

    if (
      !actorCode ||
      !actorRole ||
      !id ||
      !name ||
      !term1Name ||
      !term2Name ||
      !term1Start ||
      !term1End ||
      !term2Start ||
      !term2End
    ) {
      return NextResponse.json({ ok: false, message: "Missing required fields." }, { status: 400 });
    }
    if (
      !isIsoDate(term1Start) ||
      !isIsoDate(term1End) ||
      !isIsoDate(term2Start) ||
      !isIsoDate(term2End) ||
      term1Start > term1End ||
      term2Start > term2End
    ) {
      return NextResponse.json({ ok: false, message: "تواريخ التيرم غير صحيحة." }, { status: 400 });
    }
    const computedStartDate = term1Start;
    const computedEndDate = term2End;
    if (!isIsoDate(computedStartDate) || !isIsoDate(computedEndDate) || computedStartDate > computedEndDate) {
      return NextResponse.json({ ok: false, message: "تواريخ الفترة غير صحيحة." }, { status: 400 });
    }
    if (!isSessionActorMatch(request, actorCode, actorRole)) {
      return NextResponse.json({ ok: false, message: "Session mismatch." }, { status: 401 });
    }
    const canEdit = await verifyAdminActor(actorCode, actorRole);
    if (!canEdit) {
      return NextResponse.json({ ok: false, message: "Not allowed." }, { status: 403 });
    }

    const db = getAdminDb();
    const ref = db.collection("service_periods").doc(id);
    const doc = await ref.get();
    if (!doc.exists) {
      return NextResponse.json({ ok: false, message: "الفترة غير موجودة." }, { status: 404 });
    }

    if (active) {
      const activeSnapshot = await db.collection("service_periods").where("active", "==", true).get();
      for (const item of activeSnapshot.docs) {
        if (item.id === id) continue;
        await item.ref.update({ active: false, updatedAt: new Date().toISOString() });
      }
    }

    await ref.update({
      name,
      startDate: computedStartDate,
      endDate: computedEndDate,
      active: Boolean(active),
      term1Name,
      term2Name,
      activeTerm,
      term1Start,
      term1End,
      term2Start,
      term2End,
      updatedAt: new Date().toISOString(),
      updatedBy: actorCode,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("PATCH /api/service-periods error:", error);
    return NextResponse.json({ ok: false, message: "Failed to update period." }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const body = (await request.json()) as DeletePeriodPayload;
    const actorCode = String(body.actorCode ?? "").trim();
    const actorRole = String(body.actorRole ?? "").trim().toLowerCase();
    const id = String(body.id ?? "").trim();

    if (!actorCode || !actorRole || !id) {
      return NextResponse.json({ ok: false, message: "Missing required fields." }, { status: 400 });
    }
    if (!isSessionActorMatch(request, actorCode, actorRole)) {
      return NextResponse.json({ ok: false, message: "Session mismatch." }, { status: 401 });
    }
    const canDelete = await verifyAdminActor(actorCode, actorRole);
    if (!canDelete) {
      return NextResponse.json({ ok: false, message: "Not allowed." }, { status: 403 });
    }

    const db = getAdminDb();
    const periodRef = db.collection("service_periods").doc(id);
    const periodDoc = await periodRef.get();
    if (!periodDoc.exists) {
      return NextResponse.json({ ok: false, message: "الفترة غير موجودة." }, { status: 404 });
    }

    const periodData = periodDoc.data() as { startDate?: string; endDate?: string };
    const startDate = String(periodData.startDate ?? "").trim();
    const endDate = String(periodData.endDate ?? "").trim();
    if (!isIsoDate(startDate) || !isIsoDate(endDate)) {
      return NextResponse.json({ ok: false, message: "تواريخ الفترة غير صحيحة." }, { status: 400 });
    }

    await deleteQueryBatch(
      db.collection("attendance").where("date", ">=", startDate).where("date", "<=", endDate)
    );

    await deleteQueryBatch(
      db.collection("lesson_reports").where("lessonDate", ">=", startDate).where("lessonDate", "<=", endDate)
    );

    // Delete notifications within date range.
    try {
      const startTs = Timestamp.fromDate(new Date(`${startDate}T00:00:00.000Z`));
      const endTs = Timestamp.fromDate(new Date(`${endDate}T23:59:59.999Z`));
      const notifSnap = await db
        .collection("notifications")
        .where("createdAt", ">=", startTs)
        .where("createdAt", "<=", endTs)
        .get();
      if (!notifSnap.empty) {
        let batch = db.batch();
        let counter = 0;
        for (const doc of notifSnap.docs) {
          batch.delete(doc.ref);
          counter += 1;
          if (counter >= 400) {
            await batch.commit();
            batch = db.batch();
            counter = 0;
          }
        }
        if (counter > 0) {
          await batch.commit();
        }
      }
    } catch (notifyError) {
      console.error("DELETE period notifications error:", notifyError);
    }

    const homeworksSnap = await db.collection("homeworks").where("periodId", "==", id).get();
    if (!homeworksSnap.empty) {
      for (const hwDoc of homeworksSnap.docs) {
        const hwId = hwDoc.id;
        const submissionsSnap = await db
          .collection("homeworks")
          .doc(hwId)
          .collection("submissions")
          .get();
        if (!submissionsSnap.empty) {
          let batch = db.batch();
          let counter = 0;
          for (const sub of submissionsSnap.docs) {
            batch.delete(sub.ref);
            counter += 1;
            if (counter >= 400) {
              await batch.commit();
              batch = db.batch();
              counter = 0;
            }
          }
          if (counter > 0) {
            await batch.commit();
          }
        }

        await deleteQueryBatch(db.collection("homeworkGrades").where("homeworkId", "==", hwId));
        await hwDoc.ref.delete();
      }
    }

    // Delete results data tied to this period.
    try {
      const settingsRef = db.collection("results_settings").doc(id);
      const settingsDoc = await settingsRef.get();
      if (settingsDoc.exists) {
        const scoresSnap = await settingsRef.collection("results_scores").get();
        if (!scoresSnap.empty) {
          let batch = db.batch();
          let counter = 0;
          for (const scoreDoc of scoresSnap.docs) {
            batch.delete(scoreDoc.ref);
            counter += 1;
            if (counter >= 400) {
              await batch.commit();
              batch = db.batch();
              counter = 0;
            }
          }
          if (counter > 0) {
            await batch.commit();
          }
        }
        await settingsRef.delete();
      }

      await deleteQueryBatch(db.collection("results_subject_limits").where("periodId", "==", id));
    } catch (resultsError) {
      console.error("DELETE period results error:", resultsError);
    }

    await periodRef.delete();

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("DELETE /api/service-periods error:", error);
    return NextResponse.json({ ok: false, message: "Failed to delete period." }, { status: 500 });
  }
}
