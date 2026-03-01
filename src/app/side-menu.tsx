"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

type StoredUser = { role?: string; studentCode?: string; classes?: string[] };

type ServicePeriod = {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  active: boolean;
};

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
  const [periods, setPeriods] = useState<ServicePeriod[]>([]);
  const [periodId, setPeriodId] = useState("");

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
            : []
        );
        setNeedsServicePref(Boolean((user as { needsServicePref?: boolean })?.needsServicePref));
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
          : []
      );
      setNeedsServicePref(Boolean((user as { needsServicePref?: boolean })?.needsServicePref));
    } catch {
      // ignore
    }
  }, [pathname]);

  useEffect(() => {
    async function hydrateRoleFromApi() {
      if (!userCode) return;
      try {
        const res = await fetch(`/api/users?code=${encodeURIComponent(userCode)}`);
        const json = await res.json();
        if (!res.ok || !json.ok) return;
        const apiRoleRaw = String(json.data?.role ?? "").trim().toLowerCase();
        const apiRole = apiRoleRaw === "nzam" ? "system" : apiRoleRaw || "student";
        setRole(apiRole);
        const apiClasses = Array.isArray(json.data?.classes)
          ? (json.data.classes as string[]).map((c) => String(c).trim()).filter(Boolean)
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
          const userRes = await fetch(`/api/users?code=${encodeURIComponent(userCode)}`);
          const userJson = await userRes.json();
          if (userRes.ok && userJson.ok) {
            const ownClasses = Array.isArray(userJson.data?.classes)
              ? (userJson.data.classes as string[]).map((id) => String(id).trim()).filter(Boolean)
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
        const res = await fetch(`/api/users?code=${encodeURIComponent(userCode)}`);
        const json = await res.json();
        if (!res.ok || !json.ok) return;
        const classes = Array.isArray(json.data?.classes)
          ? (json.data.classes as string[]).map((c) => String(c).trim()).filter(Boolean)
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
    async function loadPeriods() {
      if (!classId || !userCode || !role) return;
      if (role !== "admin" && role !== "system" && role !== "teacher") return;
      try {
        const query = new URLSearchParams({
          actorCode: userCode,
          actorRole: role,
          status: "all",
        });
        const res = await fetch(`/api/service-periods?${query.toString()}`);
        const json = await res.json();
        if (res.ok && json.ok) {
          const loaded = json.data as ServicePeriod[];
          setPeriods(loaded);
          if (loaded.length) {
            const activePeriod = loaded.find((item) => item.active);
            setPeriodId(activePeriod?.id ?? loaded[0].id);
          }
        }
      } catch {
        // ignore
      }
    }
    loadPeriods();
  }, [classId, role, userCode]);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);



  const menuItems = useMemo(() => {
    const effectiveRole = role;
    const roleHome = `/portal/${effectiveRole}`;

    if (effectiveRole === "admin") {
      return [
        { id: "home", label: "الرئيسية", icon: "/home.png", href: roleHome },
        { id: "classes", label: "الفصول", icon: "/classes.png", href: "/portal/admin/classes" },
        { id: "library", label: "المكتبة", icon: "/library.png", href: "/portal/admin/library" },
        { id: "attendance", label: "الحضور والغياب", icon: "/attendance-docs.png", href: "/portal/attendance" },
        { id: "role-tool", label: "الإدارة", icon: "/administration.png", href: "/portal/admin/administration" },
        { id: "competition", label: "مسابقة القطمارس", icon: "/competition.png", href: "/portal/competitions" },
      ];
    }

    if (effectiveRole === "system") {
      return [
        { id: "home", label: "الرئيسية", icon: "/home.png", href: roleHome },
        { id: "photos", label: "الصور", icon: "/Photos.png", href: "/portal/photos" },
        { id: "class", label: "الفصل", icon: "/classes.png", href: "/portal/system/class" },
        { id: "library", label: "المكتبة", icon: "/library.png", href: "/portal/library" },
        { id: "competition", label: "مسابقة القطمارس", icon: "/competition.png", href: "/portal/competitions" },
        { id: "complaints", label: "ملاحظات سلوك", icon: "/complaints.png", href: "/portal/complaints" },
        { id: "role-tool", label: "الحضور", icon: "/attendance-docs.png", href: "/portal/attendance" },
      ];
    }

    if (effectiveRole === "teacher") {
      return [
        { id: "home", label: "الرئيسية", icon: "/home.png", href: roleHome },
        { id: "notifications", label: "التنبيهات", icon: "/Notification.png", href: "/portal/notifications" },
        { id: "classes", label: "الفصول", icon: "/classes.png", href: "/portal/teacher/classes" },
        { id: "library", label: "المكتبة", icon: "/library.png", href: "/portal/library" },
        { id: "attendance", label: "الحضور والغياب", icon: "/7dor.png", href: "/portal/attendance" },
        { id: "role-tool", label: "الواجبات", icon: "/homeworkb.png", href: "/portal/homework" },
        { id: "lesson-reports", label: "تقارير الحصص", icon: "/attendance-docs.png", href: "/portal/lesson-reports" },
      ];
    }

    if (effectiveRole === "notes") {
      return [
      { id: "home", label: "الرئيسية", icon: "/home.png", href: roleHome },
      { id: "notifications", label: "التنبيهات", icon: "/Notification.png", href: "/portal/notifications" },
      { id: "inquiries", label: "الاستفسارات والشكاوي", icon: "/Questions.png", href: "/portal/inquiries" },
      ];
    }

    return [
      { id: "home", label: "الرئيسية", icon: "/home.png", href: roleHome },
      { id: "library", label: "المكتبة", icon: "/library.png", href: "/portal/library" },
      { id: "competition", label: "مسابقة القطمارس", icon: "/competition.png", href: "/portal/competitions" },
      { id: "homework", label: "الواجبات", icon: "/homeworkb.png", href: "/portal/homework" },
      ...(effectiveRole === "student" || effectiveRole === "parent"
        ? [{ id: "lesson-reports", label: "تقارير الحصص", icon: "/attendance-docs.png", href: "/portal/lesson-reports" }]
        : []),
      ...(effectiveRole === "student" || effectiveRole === "parent"
        ? [{ id: "inquiries", label: "الاستفسارات والشكاوي", icon: "/Questions.png", href: "/portal/inquiries" }]
        : []),
    ];
  }, [pathname, role]);

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
          <aside className="absolute right-0 top-0 h-full w-[min(85vw,360px)] rounded-l-3xl border border-white/20 bg-white/95 p-5 shadow-[var(--shadow)] menu-panel-anim z-60">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-lg font-semibold text-[#111]">القائمة</p>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="flex h-10 w-10 items-center justify-center text-3xl text-[#111]"
                aria-label="إغلاق"
              >
                ×
              </button>
            </div>
            <div className="flex h-[calc(100%-48px)] flex-col gap-2 overflow-y-auto">
              <div className="grid gap-2">
                {menuItems.map((item) => (
                  <Link
                    key={item.id}
                    href={item.href}
                    className="flex items-center gap-3 rounded-2xl border border-black/10 bg-white px-4 py-3 text-[#111] transition hover:-translate-y-0.5 hover:shadow-md"
                  >
                    <img src={item.icon} alt="" className="h-6 w-6" aria-hidden="true" />
                    <span className="text-sm font-semibold">{item.label}</span>
                  </Link>
                ))}
              </div>

              {role === "admin" ? (
                <div className="mt-2 grid gap-2 rounded-2xl border border-black/10 bg-white/70 p-2">
                  <Link
                    href="/portal/admin/service-periods"
                    className="rounded-xl border border-black/10 bg-white px-4 py-2 text-center text-xs font-semibold text-[#111]"
                  >
                    فترات الخدمة
                  </Link>
                  <Link
                    href="/portal/admin/account-requests"
                    className="rounded-xl border border-black/10 bg-white px-4 py-2 text-center text-xs font-semibold text-[#111]"
                  >
                    طلبات الحسابات
                  </Link>
                  <Link
                    href="/portal/complaints"
                    className="rounded-xl border border-black/10 bg-white px-4 py-2 text-center text-xs font-semibold text-[#111]"
                  >
                    السلوك
                  </Link>
                </div>
              ) : null}

              {role === "admin" || role === "teacher" || role === "system" ? (
                <div className="mt-3 rounded-2xl border border-black/10 bg-black/5 p-3">
                  <p className="mb-3 text-sm font-semibold text-[#111]">ملفات الفصل</p>
                  <div className="grid gap-2">
                    <select
                      className="w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-xs text-[#111]"
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
                        <option key={item.id} value={item.id} className="text-black">
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
                      className={`rounded-xl px-4 py-2 text-center text-xs font-semibold ${
                        selectedClassId
                          ? "border border-black/10 bg-white text-[#111]"
                          : "pointer-events-none border border-black/10 bg-black/5 text-[color:var(--muted)]"
                      }`}
                    >
                      قداسات الطلاب
                    </a>
                    <a
                      href={
                        selectedClassId
                          ? `/api/classes/${selectedClassId}/qr-export`
                          : "#"
                      }
                      className={`rounded-xl px-4 py-2 text-center text-xs font-semibold ${
                        selectedClassId
                          ? "border border-black/10 bg-white text-[#111]"
                          : "pointer-events-none border border-black/10 bg-black/5 text-[color:var(--muted)]"
                      }`}
                    >
                      Qr code الطلاب
                    </a>
                    <div className="rounded-xl border border-black/10 bg-white px-3 py-3">
                      <p className="mb-2 text-xs font-semibold text-[#111]">الحضور والغياب والواجبات</p>
                      <select
                        className="mb-2 w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-xs text-[#111]"
                        value={periodId}
                        onChange={(e) => setPeriodId(e.target.value)}
                      >
                        <option value="" className="text-black">
                          اختر الفترة
                        </option>
                        {periods.map((period) => (
                          <option key={period.id} value={period.id} className="text-black">
                            {period.name}
                          </option>
                        ))}
                      </select>
                      <a
                        href={
                          periodId && selectedClassId
                            ? `/api/classes/${selectedClassId}/attendance-export?periodId=${encodeURIComponent(periodId)}`
                            : "#"
                        }
                        className={`block rounded-lg px-3 py-2 text-center text-xs font-semibold ${
                          periodId && selectedClassId
                            ? "border border-black/10 bg-white text-[#111]"
                            : "pointer-events-none border border-black/10 bg-black/5 text-[color:var(--muted)]"
                        }`}
                      >
                        تنزيل ملف الحضور والغياب
                      </a>
                      <a
                        href={
                          periodId && selectedClassId
                            ? `/api/classes/${selectedClassId}/homework-export?periodId=${encodeURIComponent(periodId)}`
                            : "#"
                        }
                        className={`mt-2 block rounded-lg px-3 py-2 text-center text-xs font-semibold ${
                          periodId && selectedClassId
                            ? "border border-black/10 bg-white text-[#111]"
                            : "pointer-events-none border border-black/10 bg-black/5 text-[color:var(--muted)]"
                        }`}
                      >
                        تنزيل تقرير الواجبات
                      </a>
                    </div>
                  </div>
                </div>
              ) : null}
              <div className="mt-auto grid gap-2">
                <Link
                  href="/portal/settings"
                  className="flex items-center gap-3 rounded-2xl border border-black/10 bg-white px-4 py-3 text-[#111] transition hover:-translate-y-0.5 hover:shadow-md"
                >
                  <img src="/account.png" alt="" className="h-6 w-6" aria-hidden="true" />
                  <span className="text-sm font-semibold">حسابي</span>
                </Link>
                <button
                  type="button"
                  onClick={handleLogout}
                  className="logout-btn flex items-center gap-3 rounded-2xl border border-red-500/40 bg-red-600 px-4 py-3 text-white transition hover:-translate-y-0.5 hover:shadow-md"
                >
                  <img src="/Logout.png" alt="" className="h-6 w-6" aria-hidden="true" />
                  <span className="text-sm font-semibold">تسجيل الخروج</span>
                </button>
              </div>
            </div>
          </aside>
        </div>
      ) : null}
    </>
  );
}
