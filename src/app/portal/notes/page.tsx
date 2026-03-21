"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type StoredUser = { role?: string; name?: string };

const toShortName = (value?: string) => {
  const parts = String(value ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return parts.slice(0, 2).join(" ") || "الخادم";
};

export default function NotesHomePage() {
  const router = useRouter();
  const [alerts, setAlerts] = useState<
    {
      id: string;
      title: string;
      createdAt: string;
      createdBy?: { name?: string };
      audience?: { type?: "all" | "class"; classId?: string; className?: string };
    }[]
  >([]);
  const name = useMemo(() => {
    if (typeof window === "undefined") return "الخادم";
    try {
      const stored = window.localStorage.getItem("dsms:user");
      if (!stored) return "الخادم";
      const user = JSON.parse(stored) as StoredUser;
      return toShortName(user.name);
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
      const role = user.role === "nzam" ? "system" : user.role;
      if (role !== "notes") {
        router.replace(`/portal/${role ?? "student"}`);
        return;
      }
    } catch {
      router.replace("/login");
    }
  }, [router]);

  useEffect(() => {
    async function loadAlerts() {
      try {
        const res = await fetch("/api/notifications?limit=2&role=notes");
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
                لا توجد تنبيهات بعد.
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
                    {item.audience?.type === "class"
                      ? `إلى: ${item.audience.className ?? item.audience.classId}`
                      : "إلى: المدرسة كلها"}
                  </p>
                </Link>
              ))
            )}
          </div>
        </div>

        <div className="mt-6 flex justify-center">
          <div className="grid w-full max-w-xs gap-4 sm:max-w-sm">
          {[
          { href: "/portal/inquiries", label: "الاستفسارات والشكاوي", icon: "/QuestionW.png" },
          { href: "/portal/leaderboard", label: "لوحة المتصدرين", icon: "/Mosbka.png" },
          { href: "/portal/calendar", label: "التقويم", icon: "/Calender.png" },
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
        </div>
      </section>
    </main>
  );
}
