"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type StoredUser = { role?: string; name?: string; studentCode?: string };

type AlertItem = {
  id: string;
  title: string;
  createdAt: string;
  createdBy?: { name?: string };
  audience?: { type?: "all" | "class"; classId?: string; className?: string };
};

type ChildInfo = {
  code: string;
  name: string;
  classId: string;
};

const toShortName = (value?: string) => {
  const parts = String(value ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return parts.slice(0, 2).join(" ") || "ولي الأمر";
};

export default function ParentHomePage() {
  const router = useRouter();
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [children, setChildren] = useState<ChildInfo[]>([]);
  const [loadingChildren, setLoadingChildren] = useState(true);
  const [childrenError, setChildrenError] = useState<string | null>(null);
  const user = useMemo<StoredUser | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      const stored = window.localStorage.getItem("dsms:user");
      return stored ? (JSON.parse(stored) as StoredUser) : null;
    } catch {
      return null;
    }
  }, []);

  const name = useMemo(() => {
    return toShortName(user?.name);
  }, [user]);

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

  useEffect(() => {
    async function loadAlerts() {
      try {
        const res = await fetch("/api/notifications?limit=2&role=parent");
        const json = await res.json();
        if (res.ok && json.ok) {
          setAlerts(json.data as AlertItem[]);
        }
      } catch {
        // ignore
      }
    }
    loadAlerts();
  }, []);

  useEffect(() => {
    async function loadChildren() {
      if (!user?.studentCode) {
        setChildren([]);
        setLoadingChildren(false);
        return;
      }
      setLoadingChildren(true);
      setChildrenError(null);
      try {
        const parentRes = await fetch(`/api/users?code=${encodeURIComponent(user.studentCode)}`);
        const parentJson = await parentRes.json();
        if (!parentRes.ok || !parentJson.ok) {
          setChildrenError("تعذر تحميل بيانات الأبناء.");
          setLoadingChildren(false);
          return;
        }

        const childrenCodes = Array.isArray(parentJson.data?.childrenCodes)
          ? (parentJson.data.childrenCodes as string[]).map((v) => String(v).trim()).filter(Boolean)
          : [];

        if (!childrenCodes.length) {
          setChildren([]);
          setLoadingChildren(false);
          return;
        }

        const childrenRows = await Promise.all(
          childrenCodes.map(async (code) => {
            try {
              const res = await fetch(`/api/users?code=${encodeURIComponent(code)}`);
              const json = await res.json();
              if (!res.ok || !json.ok) return null;
              const classes = Array.isArray(json.data?.classes) ? (json.data.classes as string[]) : [];
              return {
                code,
                name: String(json.data?.name ?? "-"),
                classId: classes[0] ? String(classes[0]) : "-",
              } as ChildInfo;
            } catch {
              return null;
            }
          })
        );

        setChildren(childrenRows.filter(Boolean) as ChildInfo[]);
      } catch {
        setChildrenError("تعذر تحميل بيانات الأبناء.");
      } finally {
        setLoadingChildren(false);
      }
    }

    loadChildren();
  }, [user?.studentCode]);

  const childClasses = useMemo(() => {
    return Array.from(new Set(children.map((child) => child.classId).filter(Boolean))).sort();
  }, [children]);

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
                    {item.audience?.type === "class"
                      ? `إلى: ${item.audience.className ?? item.audience.classId}`
                      : "إلى: المدرسة كلها"}
                  </p>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="mb-6 rounded-3xl border border-white/20 bg-white/15 p-5 text-white shadow-[var(--shadow)] backdrop-blur-md">
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="text-sm text-white/90">أبنائي</p>
            <div className="flex flex-wrap items-center gap-2 text-[11px] text-white/80">
              <span className="rounded-full border border-white/25 bg-white/10 px-3 py-1">
                عدد الأبناء: {children.length}
              </span>
              <span className="rounded-full border border-white/25 bg-white/10 px-3 py-1">
                الفصول: {childClasses.length}
              </span>
            </div>
          </div>
          {loadingChildren ? (
            <p className="text-sm text-white/70">جار تحميل بيانات الأبناء...</p>
          ) : childrenError ? (
            <p className="text-sm text-red-200">{childrenError}</p>
          ) : children.length === 0 ? (
            <p className="text-sm text-white/70">لا يوجد أبناء مرتبطون بهذا الحساب بعد.</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {children.map((child) => (
                <div
                  key={child.code}
                  className="rounded-2xl border border-white/20 bg-white/10 px-4 py-3"
                >
                  <p className="text-sm font-semibold text-white">{child.name}</p>
                  <p className="mt-1 text-[11px] text-white/75">الكود: {child.code}</p>
                  <p className="mt-1 text-[11px] text-white/75">الفصل: {child.classId || "-"}</p>
                  <Link
                    href={`/portal/parent/students/${encodeURIComponent(child.code)}`}
                    className="mt-3 inline-flex rounded-full border border-white/30 bg-white/10 px-3 py-1 text-[11px] font-semibold text-white"
                  >
                    فتح ملف الابن
                  </Link>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {[
          { href: "/portal/competitions", label: "مسابقة القطمارس", icon: "/katamars.png" },
          { href: "/portal/leaderboard", label: "لوحة المتصدرين", icon: "/Mosbka.png" },
          { href: "/portal/photos", label: "الصور", icon: "/Photos1.png" },
            { href: "/portal/library", label: "المكتبة", icon: "/Mktba.png" },
            { href: "/portal/calendar", label: "التقويم", icon: "/Calender.png" },
            { href: "/portal/lesson-reports", label: "تقارير الحصص", icon: "/7dor.png" },
            { href: "/portal/homework", label: "الواجبات", icon: "/homework.png" },
            { href: "/portal/inquiries", label: "الاستفسارات والشكاوي", icon: "/QuestionW.png" },
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
