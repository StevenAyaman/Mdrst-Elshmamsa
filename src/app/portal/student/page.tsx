"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type StoredUser = { role?: string; name?: string };
type AlertItem = {
  id: string;
  title: string;
  createdAt: string;
  createdBy?: { name?: string };
  audience?: { type?: "all" | "class"; classId?: string; className?: string };
};

export default function StudentHomePage() {
  const router = useRouter();
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
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
      if (user.role !== "student") {
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
        const res = await fetch("/api/notifications?limit=2&role=student");
        const json = await res.json();
        if (res.ok && json.ok) {
          setAlerts(json.data);
        }
      } catch {
        // ignore
      }
    }
    loadAlerts();
  }, []);

  return (
    <main className="min-h-screen px-6 pb-24 pt-10">
      <section className="mx-auto w-full max-w-5xl">
        <h1 className="greeting-text mt-2">سلام ونعمة يا {name}</h1>

        <div className="mb-6 mt-6 rounded-3xl border border-white/20 bg-white/15 p-5 text-white shadow-[var(--shadow)] backdrop-blur-md">
          <div className="flex items-center justify-between">
            <p className="text-sm text-white/90">آخر التنبيهات</p>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {alerts.length === 0 ? (
              <div className="rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-center text-sm font-semibold text-white">
                لا يوجد تنبيهات.
              </div>
            ) : (
              alerts.map((item) => (
                <div
                  key={item.id}
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
                </div>
              ))
            )}
          </div>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {[
            { href: "/portal/competitions", label: "مسابقة القطمارس", icon: "/Mosbka.png" },
            { href: "/portal/photos", label: "الصور", icon: "/Photos1.png" },
            { href: "/portal/student/service", label: "خدمة القداس", icon: "/Class.png" },
            { href: "/portal/library", label: "المكتبة", icon: "/Mktba.png" },
            { href: "/portal/homework", label: "الواجبات", icon: "/homework.png" },
            { href: "/portal/lesson-reports", label: "تقارير الحصص", icon: "/attendance-docs.png" },
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
