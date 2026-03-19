import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { decodeSessionFromCookie, getUserByCode, normalizeRole } from "@/lib/session";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const session = decodeSessionFromCookie(request);
    if (!session?.code || !session?.role) {
      return NextResponse.json({ ok: false, message: "Unauthorized." }, { status: 401 });
    }

    const actorDoc = await getUserByCode(session.code);
    if (!actorDoc?.exists) {
      return NextResponse.json({ ok: false, message: "User not found." }, { status: 404 });
    }

    const actorData = actorDoc.data() as { role?: string };
    const role = normalizeRole(String(actorData.role ?? session.role).trim().toLowerCase());
    if (role !== "admin") {
      return NextResponse.json({ ok: false, message: "Not allowed." }, { status: 403 });
    }

    const body = (await request.json()) as { competition?: string };
    const competition = String(body.competition ?? "").trim().toLowerCase();
    if (!["attendance", "commitment", "katamars"].includes(competition)) {
      return NextResponse.json({ ok: false, message: "Invalid competition." }, { status: 400 });
    }

    const db = getAdminDb();
    await db.collection("leaderboard_resets").doc(competition).set(
      {
        competition,
        resetAt: new Date().toISOString(),
        updatedBy: session.code,
      },
      { merge: true },
    );

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("POST /api/leaderboard/reset error:", error);
    return NextResponse.json({ ok: false, message: "Failed to reset leaderboard." }, { status: 500 });
  }
}
