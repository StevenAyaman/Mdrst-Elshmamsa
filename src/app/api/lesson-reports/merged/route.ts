import { NextResponse } from "next/server";
import { chromium } from "playwright";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { getAdminDb } from "@/lib/firebase/admin";

export const runtime = "nodejs";

type SessionPayload = { code?: string; role?: string } | null;
type UserActor = {
  role?: string;
  classes?: string[];
  childrenCodes?: string[];
};
type ReportAttachment = { fileUrl?: string; fileName?: string; mimeType?: string };
type ReportImageAttachment = { fileUrl: string; fileName: string };

function decodeSessionFromCookie(request: Request): SessionPayload {
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

function normalizeRole(role: string) {
  return role === "nzam" ? "system" : role;
}

function normalizeClassId(value: string) {
  return String(value ?? "").trim().toUpperCase();
}

function classBase(value: string) {
  return normalizeClassId(value).replace(/[BG]$/i, "");
}

function classMatches(userClassValue: string, reportClassValue: string) {
  const a = normalizeClassId(userClassValue);
  const b = normalizeClassId(reportClassValue);
  if (!a || !b) return false;
  if (a === b) return true;
  return classBase(a) === classBase(b);
}

async function loadActor(db: ReturnType<typeof getAdminDb>, code: string): Promise<UserActor | null> {
  const directDoc = await db.collection("users").doc(code).get();
  if (directDoc.exists) return directDoc.data() as UserActor;
  const snapshot = await db.collection("users").where("code", "==", code).limit(1).get();
  if (snapshot.empty) return null;
  return snapshot.docs[0].data() as UserActor;
}

async function getParentClasses(db: ReturnType<typeof getAdminDb>, childrenCodes: string[]) {
  const set = new Set<string>();
  for (const code of childrenCodes) {
    const child = await loadActor(db, code);
    const classes = Array.isArray(child?.classes)
      ? child!.classes.map((c) => normalizeClassId(String(c))).filter(Boolean)
      : [];
    classes.forEach((c) => set.add(c));
  }
  return Array.from(set);
}

function escapeHtml(value: string) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function normalizeDate(value: string) {
  const raw = String(value ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const [y, m, d] = raw.split("-");
  return `${y}-${m}-${d}`;
}

function toAbsoluteUrl(request: Request, fileUrl: string) {
  const value = String(fileUrl ?? "").trim();
  if (!value) return "";
  if (value.startsWith("http://") || value.startsWith("https://")) return value;
  if (value.startsWith("/")) {
    const base = new URL(request.url);
    return `${base.origin}${value}`;
  }
  return value;
}

function guessMimeTypeFromName(name: string) {
  const lower = name.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".bmp")) return "image/bmp";
  return "";
}

async function fontDataUrlFromPublic(fontFileName: string) {
  const filePath = path.join(process.cwd(), "public", "Fonts", fontFileName);
  const fontBuffer = await readFile(filePath);
  return `data:font/ttf;base64,${fontBuffer.toString("base64")}`;
}

function buildHtml(params: {
  classId: string;
  lessonDate: string;
  reports: Array<{
    subject: string;
    teacherName: string;
    details: string;
    attachments: ReportImageAttachment[];
  }>;
  logoUrl: string;
  tajawalDataUrl: string;
  thuluthDataUrl: string;
  abraamDataUrl: string;
}) {
  const blocks = params.reports
    .map((report) => {
      const detailsLines = report.details
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
      const detailsHtml = detailsLines.length
        ? detailsLines.map((line) => `<div class="bullet">• ${escapeHtml(line)}</div>`).join("")
        : `<div class="bullet">-</div>`;
      const attachmentsHtml = report.attachments.length
        ? report.attachments
          .map(
            (att) =>
              `<div class="attach-image-wrap"><img class="attach-image" src="${escapeHtml(att.fileUrl)}" alt="${escapeHtml(
                att.fileName
              )}" /></div>`
          )
          .join("")
        : `<div class="bullet">-</div>`;

      return `
        <section class="report-block">
          <div class="row"><span class="label">كاتب التقرير ←</span><span class="value">${escapeHtml(report.teacherName)}</span></div>
          <div class="row"><span class="label">المادة ←</span><span class="value">${escapeHtml(report.subject)}</span></div>
          <div class="row head">تفاصيل الحصة ←</div>
          <div class="details">${detailsHtml}</div>
          <div class="row head">المرفقات ←</div>
          <div class="details">${attachmentsHtml}</div>
        </section>
      `;
    })
    .join("");

  return `
  <!doctype html>
  <html lang="ar" dir="rtl">
  <head>
    <meta charset="utf-8" />
    <style>
      @font-face {
        font-family: Tajawal;
        src: url("${escapeHtml(params.tajawalDataUrl)}") format("truetype");
      }
      @font-face {
        font-family: DThuluth;
        src: url("${escapeHtml(params.thuluthDataUrl)}") format("truetype");
      }
      @font-face {
        font-family: Abraam;
        src: url("${escapeHtml(params.abraamDataUrl)}") format("truetype");
      }
      body {
        margin: 0;
        padding: 28px;
        font-family: Tajawal, sans-serif;
        color: #111;
        background: #fff;
      }
      .header {
        position: relative;
        text-align: center;
        min-height: 190px;
      }
      .cross {
        font-family: ABRAAM !important;
        font-size: 28px;
        margin-bottom: 8px;
      }
      .logo {
        position: absolute;
        right: 0;
        top: 8px;
        width: 84px;
        height: 84px;
        object-fit: contain;
      }
      .title-main {
        font-family: DThuluth, serif !important;
        font-size: 52px;
        line-height: 1.1;
        margin: 8px 0 10px;
      }
      .meta {
        font-size: 24px;
        line-height: 1.5;
      }
      .line {
        border-bottom: 2px solid #111;
        margin: 8px 0 18px;
      }
      .report-block {
        padding: 0 8px 16px;
        margin-bottom: 18px;
        border-bottom: 1.5px solid #111;
        break-inside: avoid;
      }
      .row {
        display: flex;
        justify-content: flex-start;
        gap: 10px;
        margin: 4px 0;
        font-size: 23px;
      }
      .row .label {
        font-weight: 700;
      }
      .row .value {
        font-weight: 500;
      }
      .row.head {
        font-weight: 700;
        margin-top: 12px;
      }
      .details {
        margin-right: 8px;
      }
      .attach-image-wrap {
        margin: 8px 0;
      }
      .attach-image {
        width: 220px;
        max-width: 100%;
        border-radius: 10px;
        border: 1px solid #bbb;
        object-fit: cover;
      }
      .bullet {
        font-size: 21px;
        line-height: 1.45;
      }
      .end-note {
        margin-top: 28px;
        text-align: center;
        font-family: DThuluth, serif !important;
        line-height: 1.3;
      }
      .end-note .line1 {
        font-size: 25px;
      }
      .end-note .line2 {
        font-size: 30px;
        margin-top: 6px;
      }
      .end-note .line3 {
        font-family: Abraam, serif !important;
        font-size: 28px;
        margin-top: 4px;
      }
    </style>
  </head>
  <body>
    <header class="header">
      <img class="logo" src="${escapeHtml(new URL("/elmdrsa.jpeg", params.logoUrl).toString())}" />
      <div class="cross">#</div>
      <div class="title-main">بسم الثالوث القدوس</div>
      <div class="meta">تقرير صف  "${escapeHtml(params.classId)}"</div>
      <div class="meta">بتاريخ : "${escapeHtml(params.lessonDate)}"</div>
    </header>
    <div class="line"></div>
    ${blocks}
    <section class="end-note">
      <div class="line1">نهاية تقرير اليوم</div>
      <div class="line2">صلوا من اجل الخدمة</div>
      <div class="line3">#</div>
    </section>
  </body>
  </html>
  `;
}

export async function GET(request: Request) {
  let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
  try {
    const session = decodeSessionFromCookie(request);
    if (!session?.code || !session?.role) {
      return NextResponse.json({ ok: false, message: "Unauthorized." }, { status: 401 });
    }

    const url = new URL(request.url);
    const classId = normalizeClassId(url.searchParams.get("classId") ?? "");
    const lessonDate = String(url.searchParams.get("lessonDate") ?? "").trim();
    if (!classId || !lessonDate) {
      return NextResponse.json({ ok: false, message: "Missing classId or lessonDate." }, { status: 400 });
    }

    const db = getAdminDb();
    const actor = await loadActor(db, session.code);
    if (!actor) {
      return NextResponse.json({ ok: false, message: "User not found." }, { status: 404 });
    }
    const role = normalizeRole(String(actor.role ?? session.role ?? "").trim().toLowerCase());

    let allowedClasses: string[] = [];
    if (role === "teacher" || role === "student" || role === "system") {
      allowedClasses = Array.isArray(actor.classes)
        ? actor.classes.map((c) => normalizeClassId(String(c))).filter(Boolean)
        : [];
    } else if (role === "parent") {
      const children = Array.isArray(actor.childrenCodes)
        ? actor.childrenCodes.map((c) => String(c).trim()).filter(Boolean)
        : [];
      allowedClasses = await getParentClasses(db, children);
    } else if (role === "admin") {
      allowedClasses = [classId];
    } else {
      return NextResponse.json({ ok: false, message: "Not allowed." }, { status: 403 });
    }

    if (!allowedClasses.some((cls) => classMatches(cls, classId))) {
      return NextResponse.json({ ok: false, message: "Not allowed for this class." }, { status: 403 });
    }

    const snapshot = await db
      .collection("lesson_reports")
      .where("classId", "==", classId)
      .limit(500)
      .get();

    const reports = snapshot.docs
      .map((doc) => ({ id: doc.id, ...(doc.data() as Record<string, unknown>) }))
      .filter((item) => String((item as { lessonDate?: string }).lessonDate ?? "").trim() === lessonDate)
      .sort((a, b) =>
        String((a as { subject?: string }).subject ?? "").localeCompare(
          String((b as { subject?: string }).subject ?? ""),
          "ar"
        )
      );

    if (!reports.length) {
      return NextResponse.json({ ok: false, message: "No reports found for this date." }, { status: 404 });
    }

    const [tajawalDataUrl, thuluthDataUrl, abraamDataUrl] = await Promise.all([
      fontDataUrlFromPublic("Tajawal-Regular.ttf"),
      fontDataUrlFromPublic("DTHULUTH.TTF"),
      fontDataUrlFromPublic("ABRAAM.ttf"),
    ]);

    const html = buildHtml({
      classId,
      lessonDate: normalizeDate(lessonDate),
      reports: reports.map((report) => ({
        subject: String((report as { subject?: string }).subject ?? "-"),
        teacherName: String((report as { createdBy?: { name?: string } }).createdBy?.name ?? "غير معروف"),
        details: String((report as { body?: string }).body ?? "").trim(),
        attachments: (
          Array.isArray((report as { attachments?: unknown[] }).attachments)
            ? ((report as { attachments?: ReportAttachment[] }).attachments ?? [])
            : []
        )
          .map((att) => {
            const fileName = String(att.fileName ?? "مرفق").trim() || "مرفق";
            const mimeType = String(att.mimeType ?? "").trim() || guessMimeTypeFromName(fileName);
            return {
              fileUrl: toAbsoluteUrl(request, String(att.fileUrl ?? "").trim()),
              fileName,
              mimeType,
            };
          })
          .filter((att) => att.fileUrl && att.mimeType.startsWith("image/"))
          .map((att) => ({ fileUrl: att.fileUrl, fileName: att.fileName })),
      })),
      logoUrl: new URL(request.url).origin,
      tajawalDataUrl,
      thuluthDataUrl,
      abraamDataUrl,
    });

    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: `<div></div>`,
      footerTemplate: `
        <div style="width:100%;font-size:11px;color:#444;text-align:center;font-family:Tajawal,sans-serif;">
          صفحة <span class="pageNumber"></span> / <span class="totalPages"></span>
        </div>
      `,
      margin: { top: "10mm", bottom: "16mm", left: "8mm", right: "8mm" },
    });

    const reportFileName = `lesson-report-${classId}-${lessonDate}.pdf`;
    const reportFileNameArabic = `تقرير حصة ${lessonDate} ${classId}.pdf`;
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${reportFileName}"; filename*=UTF-8''${encodeURIComponent(reportFileNameArabic)}`,
      },
    });
  } catch (error) {
    console.error("GET /api/lesson-reports/merged error:", error);
    return NextResponse.json(
      {
        ok: false,
        message:
          process.env.NODE_ENV === "development" && error instanceof Error
            ? `Failed to generate merged report: ${error.message}`
            : "Failed to generate merged report.",
      },
      { status: 500 }
    );
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}
