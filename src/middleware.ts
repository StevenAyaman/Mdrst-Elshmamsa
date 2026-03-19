import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

type Session = {
  code?: string;
  role?: string;
  mustChangePassword?: boolean;
  needsServicePref?: boolean;
  iat?: number;
} | null;

const SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function decodeSession(value: string): Session {
  try {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    const padLength = (4 - (normalized.length % 4)) % 4;
    const padded = normalized + "=".repeat(padLength);
    const decoded = atob(padded);
    const parsed = JSON.parse(decoded) as Session;
    return parsed;
  } catch {
    return null;
  }
}

function isAllowedPath(role: string, pathname: string) {
  if (pathname.startsWith("/portal/notifications")) return true;
  if (pathname.startsWith("/portal/calendar")) return true;
  if (pathname.startsWith("/portal/leaderboard")) return true;
  if (pathname.startsWith("/portal/admin/library")) return true;
  if (pathname.startsWith("/portal/library")) return true;
  if (pathname.startsWith("/portal/photos")) return true;
  if (pathname.startsWith("/portal/competitions")) return true;
  if (pathname.startsWith("/portal/settings")) return true;
  if (pathname.startsWith("/portal/lesson-reports")) {
    return role === "teacher" || role === "student" || role === "parent";
  }
  if (pathname.startsWith("/portal/exams")) {
    return role === "admin" || role === "teacher" || role === "student" || role === "parent";
  }
  if (pathname.startsWith("/portal/results")) {
    return role === "admin" || role === "teacher" || role === "student" || role === "parent";
  }
  if (pathname.startsWith("/portal/force-password")) return true;
  if (pathname.startsWith("/portal/admin/students/")) {
    return role === "admin" || role === "system" || role === "teacher";
  }
  if (pathname.startsWith("/portal/inquiries")) {
    return (
      role === "admin" ||
      role === "notes" ||
      role === "student" ||
      role === "parent"
    );
  }
  if (pathname.startsWith("/portal/complaints")) {
    return role === "admin" || role === "system" || role === "teacher";
  }

  if (role === "admin") {
    return (
      pathname === "/portal/admin" ||
      pathname.startsWith("/portal/admin/") ||
      pathname === "/portal/attendance" ||
      pathname.startsWith("/portal/attendance/")
    );
  }
  if (role === "system") {
    return (
      pathname === "/portal/system" ||
      pathname.startsWith("/portal/system/") ||
      pathname === "/portal/attendance" ||
      pathname.startsWith("/portal/attendance/") ||
      pathname === "/portal/nzam" ||
      pathname.startsWith("/portal/nzam/")
    );
  }
  if (role === "teacher") {
    return (
      pathname === "/portal/teacher" ||
      pathname.startsWith("/portal/teacher/") ||
      pathname === "/portal/attendance" ||
      pathname.startsWith("/portal/attendance/") ||
      pathname === "/portal/homework" ||
      pathname.startsWith("/portal/homework/")
    );
  }
  if (role === "notes") {
    return pathname === "/portal/notes" || pathname.startsWith("/portal/notes/");
  }
  if (role === "katamars") {
    return pathname === "/portal/katamars" || pathname.startsWith("/portal/katamars/");
  }
  if (role === "student") {
    return (
      pathname === "/portal/student" ||
      pathname.startsWith("/portal/student/") ||
      pathname === "/portal/homework" ||
      pathname.startsWith("/portal/homework/")
    );
  }
  if (role === "parent") {
    return (
      pathname === "/portal/parent" ||
      pathname.startsWith("/portal/parent/") ||
      pathname === "/portal/homework" ||
      pathname.startsWith("/portal/homework/")
    );
  }
  return false;
}

function redirectToLogin(request: NextRequest) {
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  const response = NextResponse.redirect(url);
  response.cookies.delete("dsms_session");
  response.cookies.delete("dsms_last_path");
  return response;
}

function applySecurityHeaders(response: NextResponse) {
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("Permissions-Policy", "camera=(), microphone=(self), geolocation=()");
  response.headers.set("Cross-Origin-Opener-Policy", "same-origin");
  response.headers.set("Cross-Origin-Resource-Policy", "same-site");
  if (process.env.NODE_ENV === "production") {
    response.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload");
  }
  return response;
}

function getLastPath(request: NextRequest) {
  const raw = request.cookies.get("dsms_last_path")?.value;
  if (!raw) return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  if (pathname.startsWith("/api/")) {
    const method = request.method.toUpperCase();
    if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
      const origin = request.headers.get("origin");
      const host = request.headers.get("host");
      if (origin && host) {
        try {
          const originHost = new URL(origin).host;
          if (originHost !== host) {
            return applySecurityHeaders(
              NextResponse.json({ ok: false, message: "Invalid request origin." }, { status: 403 })
            );
          }
        } catch {
          return applySecurityHeaders(
            NextResponse.json({ ok: false, message: "Invalid request origin." }, { status: 403 })
          );
        }
      }
    }
    return applySecurityHeaders(NextResponse.next());
  }

  if (process.env.NODE_ENV === "production") {
    const proto = request.headers.get("x-forwarded-proto");
    if (proto === "http") {
      const url = request.nextUrl.clone();
      url.protocol = "https:";
      return applySecurityHeaders(NextResponse.redirect(url));
    }
  }

  if (!pathname.startsWith("/portal")) return applySecurityHeaders(NextResponse.next());

  const raw = request.cookies.get("dsms_session")?.value;
  if (!raw) return applySecurityHeaders(redirectToLogin(request));

  const session = decodeSession(raw);
  const roleRaw = String(session?.role ?? "").trim().toLowerCase();
  const role = roleRaw === "nzam" ? "system" : roleRaw;
  const issuedAt = Number(session?.iat ?? 0);
  if (!Number.isFinite(issuedAt) || issuedAt <= 0 || Date.now() - issuedAt > SESSION_MAX_AGE_MS) {
    return applySecurityHeaders(redirectToLogin(request));
  }
  if (!role || !isAllowedPath(role, pathname)) {
    return applySecurityHeaders(redirectToLogin(request));
  }

  if (
    session?.mustChangePassword &&
    !pathname.startsWith("/portal/force-password")
  ) {
    const url = request.nextUrl.clone();
    url.pathname = "/portal/force-password";
    url.search = "";
    return applySecurityHeaders(NextResponse.redirect(url));
  }

  if (
    role === "student" &&
    session?.needsServicePref &&
    !session?.mustChangePassword &&
    !pathname.startsWith("/portal/student/service")
  ) {
    const url = request.nextUrl.clone();
    url.pathname = "/portal/student/service";
    url.search = "";
    return applySecurityHeaders(NextResponse.redirect(url));
  }

  if (session?.mustChangePassword && pathname.startsWith("/portal/force-password")) {
    return applySecurityHeaders(NextResponse.next());
  }

  const allowNav = request.cookies.get("dsms_allow_nav")?.value;
  if (allowNav) {
    const response = NextResponse.next();
    response.cookies.set("dsms_allow_nav", "", { path: "/", maxAge: 0 });
    return applySecurityHeaders(response);
  }

  const referer = request.headers.get("referer") ?? "";
  if (referer) {
    try {
      const refUrl = new URL(referer);
      const refPath = refUrl.pathname;
      if (refPath.startsWith("/portal") && isAllowedPath(role, refPath)) {
        return applySecurityHeaders(NextResponse.next());
      }
    } catch {
      // ignore invalid referer
    }
  }

  const lastPath = getLastPath(request);
  if (
    lastPath &&
    lastPath !== pathname &&
    lastPath.startsWith("/portal") &&
    isAllowedPath(role, lastPath)
  ) {
    const url = request.nextUrl.clone();
    url.pathname = lastPath;
    url.search = "";
    return applySecurityHeaders(NextResponse.redirect(url));
  }

  return applySecurityHeaders(NextResponse.next());
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
