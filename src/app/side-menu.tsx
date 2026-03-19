"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

type StoredUser = { role?: string; studentCode?: string; classes?: string[] };

type ClassItem = {
  id: string;
  name: string;
};

export default function SideMenu() {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState<string>("student");
  const [userCode, setUserCode] = useState<string | null>(null);
  const [userClasses, setUserClasses] = useState<string[]>([]);
  const [needsServicePref, setNeedsServicePref] = useState(false);
  const [classId, setClassId] = useState<string | null>(null);
  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [selectedClassId, setSelectedClassId] = useState("");
  const [resultsPublished, setResultsPublished] = useState(false);

  useEffect(() => {
    function readStoredUser() {
      if (typeof window === "undefined") return;
      const stored = window.localStorage.getItem("dsms:user");
      if (!stored) {
        setRole("student");
        setUserCode(null);
        setUserClasses([]);
        setNeedsServicePref(false);
        return;
      }
      try {
        const user = JSON.parse(stored) as StoredUser;
        const nextRole = user?.role
          ? user.role === "nzam"
            ? "system"
            : user.role
          : "student";
        setRole(nextRole);
        setUserCode(user?.studentCode ? String(user.studentCode) : null);
        setUserClasses(
          Array.isArray(user?.classes)
            ? user.classes.map((c) => String(c).trim()).filter(Boolean)
            : [],
        );
        setNeedsServicePref(
          Boolean((user as { needsServicePref?: boolean })?.needsServicePref),
        );
      } catch {
        setRole("student");
        setUserCode(null);
        setUserClasses([]);
        setNeedsServicePref(false);
      }
    }

    readStoredUser();
    const onStorage = (event: StorageEvent) => {
      if (event.key === "dsms:user") {
        readStoredUser();
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem("dsms:user");
    if (!stored) return;
    try {
      const user = JSON.parse(stored) as StoredUser;
      const nextRole = user?.role
        ? user.role === "nzam"
          ? "system"
          : user.role
        : "student";
      setRole(nextRole);
      setUserCode(user?.studentCode ? String(user.studentCode) : null);
      setUserClasses(
        Array.isArray(user?.classes)
          ? user.classes.map((c) => String(c).trim()).filter(Boolean)
          : [],
      );
      setNeedsServicePref(
        Boolean((user as { needsServicePref?: boolean })?.needsServicePref),
      );
    } catch {
      // ignore
    }
  }, [pathname]);

  useEffect(() => {
    async function hydrateRoleFromApi() {
      if (!userCode) return;
      try {
        const res = await fetch(
          `/api/users?code=${encodeURIComponent(userCode)}`,
        );
        const json = await res.json();
        if (!res.ok || !json.ok) return;
        const apiRoleRaw = String(json.data?.role ?? "")
          .trim()
          .toLowerCase();
        const apiRole =
          apiRoleRaw === "nzam" ? "system" : apiRoleRaw || "student";
        setRole(apiRole);
        const apiClasses = Array.isArray(json.data?.classes)
          ? (json.data.classes as string[])
              .map((c) => String(c).trim())
              .filter(Boolean)
          : [];
        if (apiClasses.length) setUserClasses(apiClasses);
      } catch {
        // ignore
      }
    }
    hydrateRoleFromApi();
  }, [userCode]);

  useEffect(() => {
    const storedClass = window.localStorage.getItem("dsms:classId");
    const fallbackClass = userClasses.length ? userClasses[0] : null;
    setClassId(storedClass || fallbackClass);
  }, [userClasses]);

  useEffect(() => {
    if (role !== "admin" && role !== "teacher" && role !== "system") return;
    async function loadClasses() {
      try {
        if ((role === "teacher" || role === "system") && userCode) {
          const userRes = await fetch(
            `/api/users?code=${encodeURIComponent(userCode)}`,
          );
          const userJson = await userRes.json();
          if (userRes.ok && userJson.ok) {
            const ownClasses = Array.isArray(userJson.data?.classes)
              ? (userJson.data.classes as string[])
                  .map((id) => String(id).trim())
                  .filter(Boolean)
              : [];
            const loaded = ownClasses.map((id) => ({ id, name: id }));
            setClasses(loaded);
            if (!selectedClassId) {
              const fallback = classId || loaded[0]?.id || "";
              if (fallback) setSelectedClassId(fallback);
            }
          }
          return;
        }

        const res = await fetch("/api/classes");
        const json = await res.json();
        if (res.ok && json.ok) {
          const loaded = (json.data as ClassItem[]) || [];
          setClasses(loaded);
          if (!selectedClassId) {
            const fallback = classId || loaded[0]?.id || "";
            if (fallback) setSelectedClassId(fallback);
          }
        }
      } catch {
        // ignore
      }
    }
    loadClasses();
  }, [classId, role, selectedClassId, userCode]);

  useEffect(() => {
    if (role !== "admin" && role !== "teacher" && role !== "system") return;
    if (!selectedClassId && classId) {
      setSelectedClassId(classId);
    }
  }, [classId, role, selectedClassId]);

  useEffect(() => {
    async function hydrateClassFromApi() {
      if (classId || !userCode || !role) return;
      if (role !== "system" && role !== "admin") return;
      try {
        const res = await fetch(
          `/api/users?code=${encodeURIComponent(userCode)}`,
        );
        const json = await res.json();
        if (!res.ok || !json.ok) return;
        const classes = Array.isArray(json.data?.classes)
          ? (json.data.classes as string[])
              .map((c) => String(c).trim())
              .filter(Boolean)
          : [];
        if (classes.length) {
          const nextClass = classes[0];
          setClassId(nextClass);
          window.localStorage.setItem("dsms:classId", nextClass);
        }
      } catch {
        // ignore
      }
    }
    hydrateClassFromApi();
  }, [classId, role, userCode]);

  useEffect(() => {
    async function loadResultsVisibility() {
      if (!role) return;
      if (!["admin", "teacher", "student", "parent"].includes(role)) {
        setResultsPublished(false);
        return;
      }
      try {
        const res = await fetch("/api/results/records");
        const json = await res.json();
        if (res.ok && json.ok) {
          const published = Boolean(json.data?.published);
          setResultsPublished(published);
          return;
        }
        setResultsPublished(false);
      } catch {
        setResultsPublished(false);
      }
    }
    loadResultsVisibility();
  }, [role, pathname]);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  const menuItems = useMemo(() => {
    const effectiveRole = role;
    const roleHome = `/portal/${effectiveRole}`;

    if (effectiveRole === "admin") {
      return [
        {
          id: "home",
          label: "الرئيسية",
          icon: "/home_24dp_FFFFFF_FILL0_wght400_GRAD0_opsz24.png",
          href: roleHome,
        },
        {
          id: "results",
          label: "النتائج",
          href: "/portal/results",
          noIcon: true,
          centered: true,
        },
        {
          id: "exams",
          label: "الاختبارات",
          icon: "/homework.png",
          href: "/portal/exams",
        },
        {
          id: "calendar",
          label: "التقويم",
          icon: "/Calender.png",
          href: "/portal/calendar",
        },
        {
          id: "leaderboard",
          label: "لوحة المتصدرين",
          icon: "/Mosbka.png",
          href: "/portal/leaderboard",
        },
        {
          id: "classes",
          label: "الفصول",
          icon: "/Class.png",
          href: "/portal/admin/classes",
        },
        {
          id: "library",
          label: "المكتبة",
          icon: "/Mktba.png",
          href: "/portal/admin/library",
        },
        {
          id: "attendance",
          label: "الحضور والغياب",
          icon: "/7dor.png",
          href: "/portal/attendance",
        },
        {
          id: "role-tool",
          label: "الإدارة",
          icon: "/administration.png",
          href: "/portal/admin/administration",
        },
        {
          id: "competition",
          label: "مسابقة القطمارس",
          icon: "/katamars.png",
          href: "/portal/competitions",
        },
      ];
    }

    if (effectiveRole === "system") {
      return [
        {
          id: "home",
          label: "الرئيسية",
          icon: "/home_24dp_FFFFFF_FILL0_wght400_GRAD0_opsz24.png",
          href: roleHome,
        },
        {
          id: "calendar",
          label: "التقويم",
          icon: "/Calender.png",
          href: "/portal/calendar",
        },
        {
          id: "leaderboard",
          label: "لوحة المتصدرين",
          icon: "/Mosbka.png",
          href: "/portal/leaderboard",
        },
        {
          id: "photos",
          label: "الصور",
          icon: "/Photos1.png",
          href: "/portal/photos",
        },
        {
          id: "class",
          label: "الفصل",
          icon: "/Class.png",
          href: "/portal/system/class",
        },
        {
          id: "library",
          label: "المكتبة",
          icon: "/Mktba.png",
          href: "/portal/library",
        },
        {
          id: "competition",
          label: "مسابقة القطمارس",
          icon: "/katamars.png",
          href: "/portal/competitions",
        },
        {
          id: "complaints",
          label: "ملاحظات سلوك",
          icon: "/complaints.png",
          href: "/portal/complaints",
        },
        {
          id: "role-tool",
          label: "الحضور",
          icon: "/7dor.png",
          href: "/portal/attendance",
        },
      ];
    }

    if (effectiveRole === "teacher") {
      return [
        {
          id: "home",
          label: "الرئيسية",
          icon: "/home_24dp_FFFFFF_FILL0_wght400_GRAD0_opsz24.png",
          href: roleHome,
        },
        {
          id: "results",
          label: "النتائج",
          icon: "/homework.png",
          href: "/portal/results",
        },
        {
          id: "exams",
          label: "الاختبارات",
          icon: "/homework.png",
          href: "/portal/exams",
        },
        {
          id: "calendar",
          label: "التقويم",
          icon: "/Calender.png",
          href: "/portal/calendar",
        },
        {
          id: "leaderboard",
          label: "لوحة المتصدرين",
          icon: "/Mosbka.png",
          href: "/portal/leaderboard",
        },
        {
          id: "notifications",
          label: "التنبيهات",
          icon: "/NotificationW.png",
          href: "/portal/notifications",
        },
        {
          id: "classes",
          label: "الفصول",
          icon: "/Class.png",
          href: "/portal/teacher/classes",
        },
        {
          id: "library",
          label: "المكتبة",
          icon: "/Mktba.png",
          href: "/portal/library",
        },
        {
          id: "attendance",
          label: "الحضور والغياب",
          icon: "/7dor.png",
          href: "/portal/attendance",
        },
        {
          id: "role-tool",
          label: "الواجبات",
          icon: "/homework.png",
          href: "/portal/homework",
        },
        {
          id: "lesson-reports",
          label: "تقارير الحصص",
          icon: "/7dor.png",
          href: "/portal/lesson-reports",
        },
      ];
    }

    if (effectiveRole === "notes") {
      return [
        {
          id: "home",
          label: "الرئيسية",
          icon: "/home_24dp_FFFFFF_FILL0_wght400_GRAD0_opsz24.png",
          href: roleHome,
        },
        {
          id: "calendar",
          label: "التقويم",
          icon: "/Calender.png",
          href: "/portal/calendar",
        },
        {
          id: "leaderboard",
          label: "لوحة المتصدرين",
          icon: "/Mosbka.png",
          href: "/portal/leaderboard",
        },
        {
          id: "notifications",
          label: "التنبيهات",
          icon: "/NotificationW.png",
          href: "/portal/notifications",
        },
        {
          id: "inquiries",
          label: "الاستفسارات والشكاوي",
          icon: "/QuestionW.png",
          href: "/portal/inquiries",
        },
      ];
    }

    if (effectiveRole === "katamars") {
      return [
        {
          id: "home",
          label: "الرئيسية",
          icon: "/home_24dp_FFFFFF_FILL0_wght400_GRAD0_opsz24.png",
          href: roleHome,
        },
        {
          id: "calendar",
          label: "التقويم",
          icon: "/Calender.png",
          href: "/portal/calendar",
        },
        {
          id: "leaderboard",
          label: "لوحة المتصدرين",
          icon: "/Mosbka.png",
          href: "/portal/leaderboard",
        },
        {
          id: "classes",
          label: "الفصول",
          icon: "/Class.png",
          href: "/portal/katamars/classes",
        },
        {
          id: "competition",
          label: "مسابقة القطمارس",
          icon: "/katamars.png",
          href: "/portal/competitions",
        },
        {
          id: "katamars-results",
          label: "إدارة مسابقة القطمارس",
          icon: "/administration.png",
          href: "/portal/katamars/results",
        },
      ];
    }

    return [
      {
        id: "home",
        label: "الرئيسية",
        icon: "/home_24dp_FFFFFF_FILL0_wght400_GRAD0_opsz24.png",
        href: roleHome,
      },
      {
        id: "calendar",
        label: "التقويم",
        icon: "/Calender.png",
        href: "/portal/calendar",
      },
      {
        id: "leaderboard",
        label: "لوحة المتصدرين",
        icon: "/Mosbka.png",
        href: "/portal/leaderboard",
      },
      {
        id: "exams",
        label: "الاختبارات",
        icon: "/homework.png",
        href: "/portal/exams",
      },
      ...((effectiveRole === "student" || effectiveRole === "parent") &&
      resultsPublished
        ? [
            {
              id: "results",
              label: "النتائج",
              icon: "/homework.png",
              href: "/portal/results",
            },
          ]
        : []),
      {
        id: "library",
        label: "المكتبة",
        icon: "/Mktba.png",
        href: "/portal/library",
      },
      {
        id: "competition",
        label: "مسابقة القطمارس",
        icon: "/katamars.png",
        href: "/portal/competitions",
      },
      {
        id: "homework",
        label: "الواجبات",
        icon: "/homework.png",
        href: "/portal/homework",
      },
      ...(effectiveRole === "student" || effectiveRole === "parent"
        ? [
            {
              id: "lesson-reports",
              label: "تقارير الحصص",
              icon: "/7dor.png",
              href: "/portal/lesson-reports",
            },
          ]
        : []),
      ...(effectiveRole === "student" || effectiveRole === "parent"
        ? [
            {
              id: "inquiries",
              label: "الاستفسارات والشكاوي",
              icon: "/QuestionW.png",
              href: "/portal/inquiries",
            },
          ]
        : []),
    ];
  }, [role, resultsPublished]);

  if (
    pathname === "/login" ||
    pathname === "/request-account" ||
    pathname.startsWith("/portal/force-password") ||
    (pathname.startsWith("/portal/student/service") && needsServicePref)
  )
    return null;

  async function handleLogout() {
    try {
      await fetch("/api/logout", { method: "POST" });
    } finally {
      window.localStorage.removeItem("dsms:user");
      window.localStorage.removeItem("dsms:push");
      router.replace("/login");
      router.refresh();
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="menu-trigger flex items-center justify-center text-white"
        aria-label="فتح القائمة"
      >
        <img
          src="/menu_24dp_FFFFFF_FILL0_wght400_GRAD0_opsz24.png"
          alt="القائمة"
          className="h-7 w-7 object-contain"
        />
      </button>

      {open ? (
        <div className="fixed inset-0 z-60">
          <div
            className="absolute inset-0 bg-black/40 menu-backdrop-anim z-50"
            onClick={() => setOpen(false)}
          />
          <aside className="absolute right-0 top-0 h-full w-[min(85vw,360px)] z-60 animate-in slide-in-from-right duration-500 ease-out border-r-0 border-y-0 shadow-[var(--shadow-glow)] rounded-l-3xl glass-panel p-6 text-white">
            <div className="mb-6 flex items-start gap-3 pb-4 border-b border-[color:var(--glass-border)]">
              <div className="min-w-0 flex-1">
                <img
                  src="/COPYRIGHT.png"
                  alt="مدرسة الشمامسة"
                  loading="lazy"
                  decoding="async"
                  className="block h-auto w-full object-contain"
                />
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-2xl text-white/70 hover:text-white hover:bg-white/10 transition-colors"
                aria-label="إغلاق"
              >
                ×
              </button>
            </div>
            <div className="flex h-[calc(100%-76px)] flex-col gap-3 overflow-y-auto pr-1">
              <div className="grid gap-2">
                {menuItems.map((item) => (
                  <Link
                    key={item.id}
                    href={item.href}
                    className={`rounded-2xl border border-[color:var(--accent)]/20 bg-white/5 px-4 py-3.5 text-white transition-all duration-300 hover:bg-white/15 hover:border-[color:var(--accent)]/60 hover:shadow-[0_4_12px_rgba(226,183,110,0.15)] hover:-translate-x-1 ${
                      item.centered
                        ? "flex justify-center text-center"
                        : "flex items-center gap-4"
                    }`}
                  >
                    {!item.noIcon ? (
                      <div className="bg-black/20 p-2 rounded-xl shadow-inner border border-white/5">
                        <img
                          src={item.icon}
                          alt=""
                          loading="lazy"
                          decoding="async"
                          className="h-5 w-5"
                          aria-hidden="true"
                        />
                      </div>
                    ) : null}
                    <span className="text-[15px] font-semibold tracking-wide">
                      {item.label}
                    </span>
                  </Link>
                ))}
              </div>

              {role === "admin" ? (
                <div className="mt-4 grid gap-3 rounded-2xl border border-[color:var(--glass-border)] bg-black/20 p-4 shadow-inner">
                  <p className="text-sm font-bold text-[color:var(--accent)] drop-shadow-sm mb-1">
                    إدارة عامة
                  </p>
                  <Link
                    href="/portal/admin/service-periods"
                    className="rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 px-4 py-2.5 text-center text-sm font-semibold text-white transition-colors"
                  >
                    فترات الخدمة
                  </Link>
                  <Link
                    href="/portal/admin/account-requests"
                    className="rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 px-4 py-2.5 text-center text-sm font-semibold text-white transition-colors"
                  >
                    طلبات الحسابات
                  </Link>
                  <Link
                    href="/portal/complaints"
                    className="rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 px-4 py-2.5 text-center text-sm font-semibold text-white transition-colors"
                  >
                    السلوك
                  </Link>
                </div>
              ) : null}

              {role === "admin" || role === "teacher" || role === "system" ? (
                <div className="mt-4 rounded-2xl border border-[color:var(--glass-border)] bg-black/20 p-4 shadow-inner">
                  <p className="mb-4 text-sm font-bold text-[color:var(--accent)] drop-shadow-sm">
                    ملفات الفصل
                  </p>
                  <div className="grid gap-3">
                    <select
                      className="w-full rounded-xl border border-[color:var(--glass-border)] bg-black/40 px-4 py-3 text-sm text-white focus:border-[color:var(--accent)] focus:ring-1 focus:ring-[color:var(--accent)] transition-all outline-none appearance-none"
                      value={selectedClassId}
                      onChange={(e) => setSelectedClassId(e.target.value)}
                    >
                      <option value="" className="text-black">
                        اختر الفصل
                      </option>
                      {(classes.length
                        ? classes
                        : classId
                          ? [{ id: classId, name: classId }]
                          : []
                      ).map((item) => (
                        <option
                          key={item.id}
                          value={item.id}
                          className="text-black"
                        >
                          {item.name}
                        </option>
                      ))}
                    </select>
                    <a
                      href={
                        selectedClassId
                          ? `/api/classes/${selectedClassId}/student-services-export`
                          : "#"
                      }
                      className={`rounded-xl px-4 py-2.5 text-center text-sm font-semibold transition-all ${selectedClassId ? "border border-white/10 bg-white/5 hover:bg-[color:var(--accent)]/20 hover:border-[color:var(--accent)]/40 text-white shadow-sm hover:shadow-[0_4_12px_rgba(226,183,110,0.15)] hover:-translate-y-0.5" : "pointer-events-none border border-transparent bg-white/5 text-white/30"}`}
                    >
                      قداسات الطلاب
                    </a>
                    <a
                      href={
                        selectedClassId
                          ? `/api/classes/${selectedClassId}/qr-export`
                          : "#"
                      }
                      className={`rounded-xl px-4 py-2.5 text-center text-sm font-semibold transition-all ${selectedClassId ? "border border-white/10 bg-white/5 hover:bg-[color:var(--accent)]/20 hover:border-[color:var(--accent)]/40 text-white shadow-sm hover:shadow-[0_4_12px_rgba(226,183,110,0.15)] hover:-translate-y-0.5" : "pointer-events-none border border-transparent bg-white/5 text-white/30"}`}
                    >
                      Qr code الطلاب
                    </a>
                    <div className="rounded-xl border border-[color:var(--glass-border)] bg-white/5 px-4 py-4 mt-2">
                      <p className="mb-3 text-[13px] font-semibold text-white/80">
                        الحضور والغياب والواجبات
                      </p>
                      <a
                        href={
                          selectedClassId
                            ? `/api/classes/${selectedClassId}/attendance-export`
                            : "#"
                        }
                        className={`block rounded-lg px-3 py-2 text-center text-xs font-semibold transition-colors ${selectedClassId ? "bg-black/30 hover:bg-black/50 text-white" : "pointer-events-none bg-black/20 text-white/30"}`}
                      >
                        تنزيل ملف الحضور والغياب
                      </a>
                      <a
                        href={
                          selectedClassId
                            ? `/api/classes/${selectedClassId}/homework-export`
                            : "#"
                        }
                        className={`mt-2 block rounded-lg px-3 py-2 text-center text-xs font-semibold transition-colors ${selectedClassId ? "bg-black/30 hover:bg-black/50 text-white" : "pointer-events-none bg-black/20 text-white/30"}`}
                      >
                        تنزيل تقرير الواجبات
                      </a>
                    </div>
                  </div>
                </div>
              ) : null}
              <div className="mt-8 mb-4 grid gap-3">
                <Link
                  href="/portal/settings"
                  className="flex items-center gap-4 rounded-2xl border border-[color:var(--glass-border)] bg-black/20 hover:bg-white/5 px-4 py-3.5 text-white transition-all hover:-translate-y-0.5 hover:shadow-[0_4_12px_rgba(226,183,110,0.15)] hover:border-[color:var(--accent)]/60"
                >
                  <div className="bg-black/30 p-2 rounded-xl border border-white/5">
                    <img
                      src="/account_circle_24dp_FFFFFF_FILL0_wght400_GRAD0_opsz24.png"
                      alt=""
                      loading="lazy"
                      decoding="async"
                      className="h-5 w-5"
                      aria-hidden="true"
                    />
                  </div>
                  <span className="text-[15px] font-semibold tracking-wide">
                    حسابي
                  </span>
                </Link>
                <button
                  type="button"
                  onClick={handleLogout}
                  className="logout-btn w-full flex items-center justify-start gap-4 rounded-2xl border border-red-500/30 bg-red-500/10 hover:bg-red-500/20 px-4 py-3.5 text-red-100 transition-all hover:-translate-y-0.5 hover:shadow-[0_4_12px_rgba(239,68,68,0.2)] hover:border-red-500/50"
                >
                  <div className="bg-red-500/20 p-2 rounded-xl shadow-inner border border-red-500/20">
                    <img
                      src="/Logout.png"
                      alt=""
                      loading="lazy"
                      decoding="async"
                      className="h-5 w-5"
                      aria-hidden="true"
                    />
                  </div>
                  <span className="text-[15px] font-semibold tracking-wide">
                    تسجيل الخروج
                  </span>
                </button>
              </div>
            </div>
          </aside>
        </div>
      ) : null}
    </>
  );
}
