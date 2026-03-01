import { NextResponse } from "next/server";
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
};

type UpdatePeriodPayload = {
  actorCode?: string;
  actorRole?: string;
  id?: string;
  name?: string;
  startDate?: string;
  endDate?: string;
  active?: boolean;
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
        };
        return {
          id: doc.id,
          name: String(item.name ?? ""),
          startDate: String(item.startDate ?? ""),
          endDate: String(item.endDate ?? ""),
          active: Boolean(item.active),
          createdAt: String(item.createdAt ?? ""),
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

    if (!actorCode || !actorRole || !name || !startDate || !endDate) {
      return NextResponse.json({ ok: false, message: "Missing required fields." }, { status: 400 });
    }
    if (!isIsoDate(startDate) || !isIsoDate(endDate) || startDate > endDate) {
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
      startDate,
      endDate,
      active,
      createdAt: new Date().toISOString(),
      createdBy: actorCode,
    });

    return NextResponse.json({ ok: true, data: { id: ref.id, name, startDate, endDate, active } });
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

    if (!actorCode || !actorRole || !id || !name || !startDate || !endDate) {
      return NextResponse.json({ ok: false, message: "Missing required fields." }, { status: 400 });
    }
    if (!isIsoDate(startDate) || !isIsoDate(endDate) || startDate > endDate) {
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
      startDate,
      endDate,
      active: Boolean(active),
      updatedAt: new Date().toISOString(),
      updatedBy: actorCode,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("PATCH /api/service-periods error:", error);
    return NextResponse.json({ ok: false, message: "Failed to update period." }, { status: 500 });
  }
}
