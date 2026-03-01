import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

type Session = {
  code?: string;
  role?: string;
  mustChangePassword?: boolean;
  needsServicePref?: boolean;
} | null;

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
  if (pathname.startsWith("/portal/admin/library")) return true;
  if (pathname.startsWith("/portal/library")) return true;
  if (pathname.startsWith("/portal/photos")) return true;
  if (pathname.startsWith("/portal/competitions")) return true;
  if (pathname.startsWith("/portal/settings")) return true;
  if (pathname.startsWith("/portal/lesson-reports")) {
    return role === "teacher" || role === "student" || role === "parent";
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
  if (!pathname.startsWith("/portal")) return NextResponse.next();

  const raw = request.cookies.get("dsms_session")?.value;
  if (!raw) return redirectToLogin(request);

  const session = decodeSession(raw);
  const roleRaw = String(session?.role ?? "").trim().toLowerCase();
  const role = roleRaw === "nzam" ? "system" : roleRaw;
  if (!role || !isAllowedPath(role, pathname)) {
    return redirectToLogin(request);
  }

  if (
    session?.mustChangePassword &&
    !pathname.startsWith("/portal/force-password")
  ) {
    const url = request.nextUrl.clone();
    url.pathname = "/portal/force-password";
    url.search = "";
    return NextResponse.redirect(url);
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
    return NextResponse.redirect(url);
  }

  if (session?.mustChangePassword && pathname.startsWith("/portal/force-password")) {
    return NextResponse.next();
  }

  const allowNav = request.cookies.get("dsms_allow_nav")?.value;
  if (allowNav) {
    const response = NextResponse.next();
    response.cookies.set("dsms_allow_nav", "", { path: "/", maxAge: 0 });
    return response;
  }

  const referer = request.headers.get("referer") ?? "";
  if (referer) {
    try {
      const refUrl = new URL(referer);
      const refPath = refUrl.pathname;
      if (refPath.startsWith("/portal") && isAllowedPath(role, refPath)) {
        return NextResponse.next();
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
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/portal/:path*"],
};
