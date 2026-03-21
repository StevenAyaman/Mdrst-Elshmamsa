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

type ResultsPayload = {
  published?: boolean;
};

const toShortName = (value?: string) => {
  const parts = String(value ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return parts.slice(0, 2).join(" ") || "الخادم";
};

export default function StudentHomePage() {
  const router = useRouter();
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [resultsPublished, setResultsPublished] = useState(false);
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
        const [alertsRes, resultsRes] = await Promise.all([
          fetch("/api/notifications?limit=2&role=student"),
          fetch("/api/results/records"),
        ]);

        const alertsJson = await alertsRes.json();
        if (alertsRes.ok && alertsJson.ok) {
          setAlerts(alertsJson.data);
        }

        const resultsJson = (await resultsRes.json()) as {
          ok?: boolean;
          data?: ResultsPayload;
        };
        if (resultsRes.ok && resultsJson.ok) {
          setResultsPublished(Boolean(resultsJson.data?.published));
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

        <div className="mb-6 mt-6 rounded-3xl glass-panel p-5 text-white animate-in slide-in-from-bottom-4 duration-500 ease-out z-10 relative">
          <div className="flex items-center justify-between pb-3 border-b border-[color:var(--glass-border)]">
            <p className="text-sm font-semibold text-[color:var(--accent)] drop-shadow-sm">
              آخر التنبيهات
            </p>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {alerts.length === 0 ? (
              <div className="rounded-2xl border border-[color:var(--glass-border)] bg-black/20 px-4 py-4 text-center text-sm font-semibold text-white/70 shadow-inner">
                لا يوجد تنبيهات.
              </div>
            ) : (
              alerts.map((item) => (
                <div
                  key={item.id}
                  className="rounded-2xl border border-[color:var(--glass-border)] bg-black/20 px-4 py-4 hover:bg-black/30 transition-colors shadow-inner"
                >
                  <p className="text-white">{item.title}</p>
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

        {resultsPublished ? (
          <div className="mb-8 flex justify-center">
            <Link
              href="/portal/results"
              className="group relative flex h-[34rem] w-[23rem] flex-col items-center overflow-hidden rounded-[3rem] border-[10px] border-sky-500 bg-[#f7f7f7] px-8 pb-10 pt-12 text-center shadow-[0_18px_40px_rgba(0,0,0,0.28)] transition duration-300 hover:-translate-y-1 hover:shadow-[0_24px_50px_rgba(0,0,0,0.35)]"
            >
              <div className="relative z-10">
                <p className="font-['ThuluthCustom','MajallaCustom',sans-serif] text-[3rem] leading-none text-black">
                  مدرسة الشمامسة
                </p>
                <p className="mt-2 text-[1.45rem] font-semibold text-black">
                  كاتدرائية مارمرقس الرسول بالكويت
                </p>
              </div>

              <div className="relative z-10 mt-12 rounded-[2rem] bg-white/90 p-4 shadow-[0_10px_26px_rgba(0,0,0,0.18)]">
                <img
                  src="/elmdrsa.jpeg"
                  alt="مدرسة الشمامسة"
                  className="h-40 w-40 object-contain"
                  loading="lazy"
                />
              </div>

              <div className="mt-auto w-full px-5">
                <div className="rounded-[1.15rem] border-4 border-sky-600 bg-sky-400 px-4 py-5 text-center text-[1.7rem] font-bold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.18)] transition duration-300 group-hover:scale-[1.02] group-hover:bg-sky-500">
                  تحميل النتيجة
                </div>
              </div>
            </Link>
          </div>
        ) : null}

        <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {[
            {
              href: "/portal/competitions",
              label: "مسابقة القطمارس",
              icon: "/katamars.png",
            },
            {
              href: "/portal/leaderboard",
              label: "لوحة المتصدرين",
              icon: "/katamars.png",
            },
            { href: "/portal/photos", label: "الصور", icon: "/Photos1.png" },
            {
              href: "/portal/student/service",
              label: "خدمة القداس",
              icon: "/Church.png",
            },
            { href: "/portal/library", label: "المكتبة", icon: "/Mktba.png" },
            {
              href: "/portal/calendar",
              label: "التقويم",
              icon: "/Calender.png",
            },
            {
              href: "/portal/homework",
              label: "الواجبات",
              icon: "/homework.png",
            },
            {
              href: "/portal/lesson-reports",
              label: "تقارير الحصص",
              icon: "/7dor.png",
            },
          ].map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="flex flex-col items-center justify-center gap-4 rounded-3xl glass-panel p-8 text-white transition-all duration-300 hover:shadow-[0_4_12px_rgba(226,183,110,0.15)] hover:border-[color:var(--accent)]/60 hover:-translate-y-1"
            >
              <img
                src={item.icon}
                alt=""
                className="h-14 w-14"
                aria-hidden="true"
              />
              <p className="text-xl font-semibold">{item.label}</p>
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}
