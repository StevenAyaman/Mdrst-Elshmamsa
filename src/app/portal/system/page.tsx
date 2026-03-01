"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type StoredUser = { role?: string; name?: string; classes?: string[] };

export default function SystemHomePage() {
  const router = useRouter();
  const [currentClass, setCurrentClass] = useState<string | null>(null);
  const [latestAlert, setLatestAlert] = useState<{
    title: string;
    body: string;
    audience?: { classId?: string };
  } | null>(null);
  const name = useMemo(() => {
    if (typeof window === "undefined") return "الخادم";
    try {
      const stored = window.localStorage.getItem("dsms:user");
      if (!stored) return "الخادم";
      const user = JSON.parse(stored) as StoredUser;
      const classes = Array.isArray(user.classes) ? user.classes.map((c) => String(c).trim()).filter(Boolean) : [];
      setCurrentClass(classes[0] ?? null);
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
      const role = user.role === "nzam" ? "system" : user.role;
      if (role !== "system") {
        router.replace(`/portal/${role ?? "student"}`);
        return;
      }
    } catch {
      router.replace("/login");
    }
  }, [router]);

  useEffect(() => {
    async function loadAlert() {
      try {
        const params = new URLSearchParams({ role: "system", limit: "1" });
        if (currentClass) {
          params.set("classId", currentClass);
        }
        const res = await fetch(`/api/notifications?${params.toString()}`);
        const json = await res.json();
        if (res.ok && json.ok && Array.isArray(json.data) && json.data.length) {
          setLatestAlert(json.data[0]);
        }
      } catch {
        //
      }
    }
    loadAlert();
  }, [currentClass]);

  return (
    <main className="min-h-screen px-6 pb-24 pt-10">
      <section className="mx-auto w-full max-w-5xl">
        <h1 className="greeting-text mt-2">سلام ونعمة يا {name}</h1>
        <section className="mt-6 rounded-3xl border border-white/20 bg-white/20 p-5 text-white shadow-[var(--shadow)] backdrop-blur-md">
          <div className="flex items-center justify-between">
            <p className="text-lg font-semibold">التنبيهات</p>
            <div className="flex gap-2">
              <Link
                href="/portal/notifications"
                className="rounded-full border border-white/40 px-4 py-1 text-xs font-semibold text-white transition hover:bg-white/10"
              >
                عرض الكل
              </Link>
              {currentClass ? (
                <Link
                  href={`/portal/notifications?classId=${currentClass}`}
                  className="rounded-full border border-white/40 px-4 py-1 text-xs font-semibold text-white transition hover:bg-white/10"
                >
                  تنبيه للفصل
                </Link>
              ) : null}
            </div>
          </div>
          <div className="mt-4 rounded-2xl border border-white/10 bg-white/10 p-4 text-sm">
            <p className="text-base font-semibold">
              {latestAlert?.title ?? "لا توجد تنبيهات جديدة."}
            </p>
            {latestAlert?.body ? (
              <p className="mt-2 text-xs text-white/80">{latestAlert.body}</p>
            ) : null}
          </div>
        </section>
        <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {[
            { href: "/portal/photos", label: "الصور", icon: "/Photos1.png" },
            { href: "/portal/system/class", label: "الفصل", icon: "/Class.png" },
            { href: "/portal/library", label: "المكتبة", icon: "/Mktba.png" },
            { href: "/portal/attendance", label: "الغياب والحضور", icon: "/7dor.png" },
            { href: "/portal/competitions", label: "مسابقة القطمارس", icon: "/Mosbka.png" },
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
