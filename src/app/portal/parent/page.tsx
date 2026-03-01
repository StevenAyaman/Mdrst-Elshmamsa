"use client";

import Link from "next/link";
import { useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";

type StoredUser = { role?: string; name?: string };

export default function ParentHomePage() {
  const router = useRouter();
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
      if (user.role !== "parent") {
        router.replace(`/portal/${user.role ?? "student"}`);
        return;
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
          {[
            { href: "/portal/competitions", label: "مسابقة القطمارس", icon: "/Mosbka.png" },
            { href: "/portal/photos", label: "الصور", icon: "/Photos1.png" },
            { href: "/portal/library", label: "المكتبة", icon: "/Mktba.png" },
            { href: "/portal/lesson-reports", label: "تقارير الحصص", icon: "/attendance-docs.png" },
            { href: "/portal/homework", label: "الواجبات", icon: "/homework.png" },
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
