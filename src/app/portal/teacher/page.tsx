"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type StoredUser = { role?: string; name?: string };
type NotificationItem = {
  id: string;
  title: string;
  body: string;
  createdBy?: { name?: string };
  audience?: { type?: "all" | "class"; classId?: string; className?: string };
};

export default function TeacherHomePage() {
  const router = useRouter();
  const [alerts, setAlerts] = useState<NotificationItem[]>([]);
  const name = useMemo(() => {
    if (typeof window === "undefined") return "الخادم";
    try {
      const stored = window.localStorage.getItem("dsms:user");
      if (!stored) return "الخادم";
      const user = JSON.parse(stored) as StoredUser;
      return user.name || "الخادم";
    } catch {
      return "الخادم";
    }
  }, []);

  useEffect(() => {
    const stored = window.localStorage.getItem("dsms:user");
    if (!stored) {
      router.replace("/login");
      return;
    }
    try {
      const user = JSON.parse(stored) as StoredUser;
      if (user.role !== "teacher") {
        router.replace(`/portal/${user.role ?? "student"}`);
        return;
      }
    } catch {
      router.replace("/login");
    }
  }, [router]);

  useEffect(() => {
    async function loadAlerts() {
      try {
        const res = await fetch("/api/notifications?limit=2&role=teacher");
        const json = await res.json();
        if (res.ok && json.ok) {
          setAlerts((json.data as NotificationItem[]) ?? []);
        }
      } catch {
        setAlerts([]);
      }
    }
    loadAlerts();
  }, []);

  return (
    <main className="min-h-screen px-6 pb-24 pt-10">
      <section className="mx-auto w-full max-w-5xl">
        <h1 className="greeting-text mt-2">سلام ونعمة يا {name}</h1>
        <div className="mt-6 rounded-3xl border border-white/20 bg-white/15 p-5 text-white shadow-[var(--shadow)] backdrop-blur-md">
          <div className="flex items-center justify-between">
            <p className="text-sm text-white/90">آخر التنبيهات</p>
            <Link
              href="/portal/notifications"
              className="rounded-full border border-white/20 px-3 py-1 text-[10px] text-white/80 transition hover:bg-white/10"
            >
              عرض الكل
            </Link>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {alerts.length === 0 ? (
              <div className="rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-sm text-white/70">
                لا يوجد تنبيهات
              </div>
            ) : (
              alerts.map((item) => (
                <Link
                  key={item.id}
                  href={`/portal/notifications/${item.id}`}
                  className="rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-sm"
                >
                  <p className="text-white">{item.title}</p>
                  <p className="mt-1 text-[10px] text-white/70">
                    من: {item.createdBy?.name ?? "غير معروف"}
                  </p>
                  <p className="mt-1 text-[10px] text-white/70">
                    {item.audience?.type === "class"
                      ? `إلى: ${item.audience.className ?? item.audience.classId}`
                      : "إلى: المدرسة كلها"}
                  </p>
                </Link>
              ))
            )}
          </div>
        </div>
        <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {[
            { href: "/portal/teacher/classes", label: "الفصول", icon: "/Class.png" },
            { href: "/portal/homework", label: "الواجبات", icon: "/homework.png" },
            { href: "/portal/lesson-reports", label: "تقارير الحصص", icon: "/attendance-docs.png" },
            { href: "/portal/attendance", label: "الحضور والغياب", icon: "/7dor.png" },
            { href: "/portal/photos", label: "الصور", icon: "/Photos1.png" },
            { href: "/portal/library", label: "المكتبة", icon: "/Mktba.png" },
            { href: "/portal/complaints", label: "السلوك", icon: "/Shkawi.png" },
          ].map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="flex flex-col items-center justify-center gap-3 rounded-3xl border border-white/20 bg-white/15 px-6 py-10 text-white shadow-[var(--shadow)] backdrop-blur-md transition hover:-translate-y-0.5 hover:shadow-lg"
            >
              <img src={item.icon} alt="" className="h-14 w-14" aria-hidden="true" />
              <p className="text-xl font-semibold">{item.label}</p>
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}
