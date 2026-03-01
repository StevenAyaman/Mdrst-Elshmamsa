"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

type StoredUser = { role?: string };

export default function BottomBar() {
  const pathname = usePathname();
  const [role, setRole] = useState<string>(() => {
    if (typeof window === "undefined") return "student";
    const stored = window.localStorage.getItem("dsms:user");
    if (!stored) return "student";
    try {
      const user = JSON.parse(stored) as StoredUser;
      if (!user?.role) return "student";
      return user.role === "nzam" ? "system" : user.role;
    } catch {
      return "student";
    }
  });

  useEffect(() => {
    queueMicrotask(() => {
      const stored = window.localStorage.getItem("dsms:user");
      if (!stored) {
        setRole("student");
        return;
      }
      try {
        const user = JSON.parse(stored) as StoredUser;
        const nextRole = user?.role ? (user.role === "nzam" ? "system" : user.role) : "student";
        setRole(nextRole);
      } catch {
        setRole("student");
      }
    });
  }, []);

  const tabs = useMemo(() => {
    const effectiveRole = pathname.startsWith("/portal/admin") ? "admin" : role;
    const roleHome = `/portal/${effectiveRole}`;
    if (effectiveRole === "admin") {
      return [
        {
          id: "role-tool",
          label: "الإدارة",
          icon: "/administration.png",
          href: "/portal/admin/administration",
        },
        {
          id: "competition",
          label: "المسابقات",
          icon: "/competition.png",
          href: "/portal/competitions",
        },
        { id: "home", label: "الرئيسية", icon: "/home.png", href: roleHome },
        {
          id: "classes",
          label: "الفصول",
          icon: "/classes.png",
          href: "/portal/admin/classes",
        },
        { id: "library", label: "المكتبة", icon: "/library.png", href: "/portal/admin/library" },
      ];
    }
    if (effectiveRole === "system") {
      return [
        { id: "complaints", label: "السلوك", icon: "/Shkawi.png", href: "/portal/complaints" },
        { id: "role-tool", label: "الحضور", icon: "/attendance-docs.png", href: "/portal/attendance" },
        { id: "photos", label: "الصور", icon: "/Photos.png", href: "/portal/photos" },
        { id: "class", label: "الفصل", icon: "/classes.png", href: "/portal/system/class" },
        { id: "library", label: "المكتبة", icon: "/library.png", href: "/portal/library" },
      ];
    }
    if (effectiveRole === "teacher") {
      return [
        { id: "role-tool", label: "الواجبات", icon: "/administration.png", href: "/portal/homework" },
        { id: "notifications", label: "التنبيهات", icon: "/competition.png", href: "/portal/notifications" },
        { id: "home", label: "الرئيسية", icon: "/home.png", href: roleHome },
        { id: "library", label: "المكتبة", icon: "/library.png", href: "/portal/library" },
      ];
    }
    return [
      { id: "notifications", label: "مسابقة القطمارس", icon: "/Mosbka.png", href: "/portal/notifications" },
      { id: "home", label: "الرئيسية", icon: "/home.png", href: roleHome },
      { id: "library", label: "المكتبة", icon: "/library.png", href: "/portal/library" },
    ];
  }, [pathname, role]);

  if (pathname === "/login" || pathname === "/request-account") return null;

  return (
    <nav className="fixed bottom-6 left-1/2 z-50 w-[min(92vw,720px)] -translate-x-1/2 rounded-full border border-black/10 bg-white px-3 py-2 shadow-[var(--shadow)] backdrop-blur">
      <div className={`grid ${tabs.length === 5 ? "grid-cols-5" : tabs.length === 4 ? "grid-cols-4" : "grid-cols-3"} gap-2`}>
        {tabs.map((tab) => {
          const className =
            "flex flex-col items-center gap-1 rounded-2xl px-3 py-2 text-sm font-semibold text-[#111]";
          const iconClass = "h-6 w-6";

          if (tab.href) {
            return (
              <Link key={tab.id} href={tab.href} className={className}>
                <img src={tab.icon} alt="" className={iconClass} aria-hidden="true" />
                <span>{tab.label}</span>
              </Link>
            );
          }

          return (
            <button key={tab.id} className={className} type="button">
              <img src={tab.icon} alt="" className={iconClass} aria-hidden="true" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
