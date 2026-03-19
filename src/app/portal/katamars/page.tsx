"use client";

import Link from "next/link";
import { useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";

type StoredUser = { role?: string; name?: string };

const toShortName = (value?: string) => {
  const parts = String(value ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return parts.slice(0, 2).join(" ") || "الخادم";
};

export default function KatamarsHomePage() {
  const router = useRouter();

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
      if (user.role !== "katamars") {
        router.replace(`/portal/${user.role ?? "student"}`);
      }
    } catch {
      router.replace("/login");
    }
  }, [router]);

  return (
    <main className="min-h-screen px-6 pb-24 pt-10">
      <section className="mx-auto w-full max-w-5xl">
        <h1 className="greeting-text mt-2">سلام ونعمة يا {name}</h1>
        <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          <Link
            href="/portal/katamars/classes"
            className="flex flex-col items-center justify-center gap-3 rounded-3xl border border-white/20 bg-white/15 px-6 py-10 text-white shadow-[var(--shadow)] backdrop-blur-md transition hover:-translate-y-0.5 hover:shadow-lg"
          >
            <img src="/Class.png" alt="" className="h-14 w-14" aria-hidden="true" />
            <p className="text-xl font-semibold">الفصول</p>
          </Link>
          <Link
            href="/portal/leaderboard"
            className="flex flex-col items-center justify-center gap-3 rounded-3xl border border-white/20 bg-white/15 px-6 py-10 text-white shadow-[var(--shadow)] backdrop-blur-md transition hover:-translate-y-0.5 hover:shadow-lg"
          >
            <img src="/katamars.png" alt="" className="h-14 w-14" aria-hidden="true" />
            <p className="text-xl font-semibold">لوحة المتصدرين</p>
          </Link>
          <Link
            href="/portal/katamars/results"
            className="flex flex-col items-center justify-center gap-3 rounded-3xl border border-white/20 bg-white/15 px-6 py-10 text-white shadow-[var(--shadow)] backdrop-blur-md transition hover:-translate-y-0.5 hover:shadow-lg"
          >
            <img src="/administration.png" alt="" className="h-14 w-14" aria-hidden="true" />
            <p className="text-xl font-semibold">إدارة مسابقة القطمارس</p>
          </Link>
          <Link
            href="/portal/competitions"
            className="flex flex-col items-center justify-center gap-3 rounded-3xl border border-white/20 bg-white/15 px-6 py-10 text-white shadow-[var(--shadow)] backdrop-blur-md transition hover:-translate-y-0.5 hover:shadow-lg"
          >
            <img src="/katamars.png" alt="" className="h-14 w-14" aria-hidden="true" />
            <p className="text-xl font-semibold">مسابقة القطمارس</p>
          </Link>
          <Link
            href="/portal/calendar"
            className="flex flex-col items-center justify-center gap-3 rounded-3xl border border-white/20 bg-white/15 px-6 py-10 text-white shadow-[var(--shadow)] backdrop-blur-md transition hover:-translate-y-0.5 hover:shadow-lg"
          >
            <img src="/Calender.png" alt="" className="h-14 w-14" aria-hidden="true" />
            <p className="text-xl font-semibold">التقويم</p>
          </Link>
        </div>
      </section>
    </main>
  );
}
