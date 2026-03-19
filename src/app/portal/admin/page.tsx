"use client";

import { memo, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AttendanceAnalyticsChart } from "@/components/admin/attendance-analytics-chart";
import { useAttendanceAnalytics } from "@/hooks/use-attendance-analytics";

type StoredUser = {
  name?: string;
  role?: string;
  studentCode?: string;
};

type UserListItem = {
  sourceCode: string;
  code: string;
  name: string;
  role: string;
  classes: string[];
  parentCodes: string[];
  childrenCodes: string[];
};

type ClassAttendanceMetric = {
  classId: string;
  attendanceRate: number;
  absenceRate: number;
  totalRecords: number;
  present: number;
  absent: number;
};

type ClassCommitmentMetric = {
  classId: string;
  totalScore: number;
};

type ClassInsights = {
  period: { id: string; name: string; startDate: string; endDate: string } | null;
  attendance: {
    boysBestAttendance: ClassAttendanceMetric[];
    girlsBestAttendance: ClassAttendanceMetric[];
    boysLeastAbsence: ClassAttendanceMetric[];
    girlsLeastAbsence: ClassAttendanceMetric[];
  };
  commitment: {
    boysTop: ClassCommitmentMetric[];
    girlsTop: ClassCommitmentMetric[];
  };
};

const roleCards = [
  { key: "admin", label: "Admins", statsKey: "admin" as const },
  { key: "system", label: "خدام النظام", statsKey: "system" as const },
  { key: "teacher", label: "المدرسين", statsKey: "teacher" as const },
  { key: "parent", label: "أولياء الأمور", statsKey: "parent" as const },
  { key: "notes", label: "خدام الاستفسارات ", statsKey: "notes" as const },
  { key: "katamars", label: "قطمارس", statsKey: "katamars" as const },
  { key: "student", label: "الطلاب", statsKey: "student" as const },
];

const toShortName = (value?: string) => {
  const parts = String(value ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return parts.slice(0, 2).join(" ") || "الخادم";
};

const AlertsSection = memo(function AlertsSection({
  alerts,
}: {
  alerts: {
    id: string;
    title: string;
    createdAt: string;
    createdBy?: { name?: string };
    audience?: { type?: "all" | "class"; classId?: string; className?: string };
  }[];
}) {
  return (
    <div className="mb-6 rounded-3xl border border-white/20 bg-white/15 p-5 text-white shadow-[var(--shadow)] backdrop-blur-md">
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
  );
});

const RoleStatsSection = memo(function RoleStatsSection({
  stats,
  selectedRole,
  onSelectRole,
  storageUsage,
  storageError,
  onOpenStorage,
}: {
  stats: {
    admin: number;
    system: number;
    teacher: number;
    parent: number;
    notes: number;
    katamars: number;
    student: number;
    classes: number;
  };
  selectedRole: string;
  onSelectRole: (role: string) => void;
  storageUsage: {
    imageBytes: number;
    videoBytes: number;
    imageCount: number;
    videoCount: number;
  } | null;
  storageError: string | null;
  onOpenStorage: () => void;
}) {
  const totalBytes =
    (storageUsage?.imageBytes ?? 0) + (storageUsage?.videoBytes ?? 0);

  const formatBytes = (value: number) => {
    if (!value) return "0 KB";
    const units = ["B", "KB", "MB", "GB"];
    let size = value;
    let unit = 0;
    while (size >= 1024 && unit < units.length - 1) {
      size /= 1024;
      unit += 1;
    }
    return `${size.toFixed(1)} ${units[unit]}`;
  };

  return (
    <div className="mt-6 rounded-3xl border border-white/20 bg-white/15 p-6 text-white shadow-[var(--shadow)] backdrop-blur-md">
      <div className="grid grid-cols-3 gap-4">
        {roleCards.map((roleCard) => (
          <button
            key={roleCard.key}
            type="button"
            onClick={() => onSelectRole(roleCard.key)}
            className={`rounded-2xl border px-4 py-4 text-center transition ${
              selectedRole === roleCard.key
                ? "border-white/60 bg-white/25"
                : "border-white/20 bg-white/10"
            }`}
          >
            <p className="text-2xl font-semibold text-white">{stats[roleCard.statsKey]}</p>
            <p className="mt-1 text-sm text-white/85">{roleCard.label}</p>
          </button>
        ))}
        <div className="rounded-2xl border border-white/20 bg-white/10 px-4 py-4 text-center">
          <p className="text-2xl font-semibold text-white">{stats.classes}</p>
          <p className="mt-1 text-sm text-white/85">الفصول</p>
        </div>
        <button
          type="button"
          onClick={onOpenStorage}
          className="rounded-2xl border border-white/20 bg-white/10 px-4 py-4 text-center transition hover:bg-white/15"
        >
          <p className="text-lg font-semibold text-white">إجمالي المساحة</p>
          {storageError ? (
            <p className="mt-2 text-xs text-red-200">تعذر التحميل</p>
          ) : (
            <p className="mt-2 text-sm text-white/85">
              {formatBytes(totalBytes)}
            </p>
          )}
        </button>
      </div>
    </div>
  );
});

export default function AdminHome() {
  const router = useRouter();
  const [sessionUser] = useState<StoredUser | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      const stored = window.localStorage.getItem("dsms:user");
      return stored ? (JSON.parse(stored) as StoredUser) : null;
    } catch {
      return null;
    }
  });
  const [displayName] = useState<string>(() => {
    if (typeof window === "undefined") return "الخادم";
    try {
      const stored = window.localStorage.getItem("dsms:user");
      if (!stored) return "الخادم";
      const parsed = JSON.parse(stored) as StoredUser;
      return toShortName(parsed?.name);
    } catch {
      return "الخادم";
    }
  });
  const [pushStatus] = useState<"on" | "off">(() => {
    if (typeof window === "undefined") return "off";
    const permission =
      typeof Notification !== "undefined" ? Notification.permission : "denied";
    const enabled =
      permission === "granted" && window.localStorage.getItem("dsms:push") === "done";
    return enabled ? "on" : "off";
  });

  useEffect(() => {
    const stored = window.localStorage.getItem("dsms:user");
    if (!stored) {
      router.replace("/login");
      return;
    }
    try {
      const parsed = JSON.parse(stored) as StoredUser;
      const role = parsed.role === "nzam" ? "system" : parsed.role;
      if (role !== "admin") {
        router.replace(`/portal/${role ?? "student"}`);
        return;
      }
    } catch {
      router.replace("/login");
    }
  }, [router]);

  const [stats, setStats] = useState({
    admin: 0,
    system: 0,
    teacher: 0,
    parent: 0,
    notes: 0,
    katamars: 0,
    student: 0,
    nzam: 0,
    classes: 0,
    classInsights: null as ClassInsights | null,
  });
  const [alerts, setAlerts] = useState<
    {
      id: string;
      title: string;
      createdAt: string;
      createdBy?: { name?: string };
      audience?: { type?: "all" | "class"; classId?: string; className?: string };
    }[]
  >([]);
  const [selectedRole, setSelectedRole] = useState<string>("admin");
  const [users, setUsers] = useState<UserListItem[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersError, setUsersError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [deletingCode, setDeletingCode] = useState<string | null>(null);
  const [clearingAll, setClearingAll] = useState(false);
  const [savingCode, setSavingCode] = useState<string | null>(null);
  const [studentNameByCode, setStudentNameByCode] = useState<Record<string, string>>({});
  const [storageUsage, setStorageUsage] = useState<{
    imageBytes: number;
    videoBytes: number;
    imageCount: number;
    videoCount: number;
  } | null>(null);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [storageOpen, setStorageOpen] = useState(false);
  const [storageClearing, setStorageClearing] = useState(false);

  useEffect(() => {
    async function loadStats() {
      try {
        const res = await fetch("/api/stats");
        const json = await res.json();
        if (res.ok && json.ok) {
          setStats((prev) => ({ ...prev, ...json.data }));
        }
      } catch {
        // keep defaults
      }
    }
    loadStats();
  }, []);

  useEffect(() => {
    async function loadStorageUsage() {
      try {
        const res = await fetch("/api/storage-usage");
        const json = await res.json();
        if (!res.ok || !json.ok) {
          setStorageError(json?.message || "تعذر تحميل مساحة التخزين.");
          return;
        }
        setStorageUsage(json.data);
      } catch {
        setStorageError("تعذر تحميل مساحة التخزين.");
      }
    }
    loadStorageUsage();
  }, []);

  function formatBytes(value: number) {
    if (!value) return "0 KB";
    const units = ["B", "KB", "MB", "GB"];
    let size = value;
    let unit = 0;
    while (size >= 1024 && unit < units.length - 1) {
      size /= 1024;
      unit += 1;
    }
    return `${size.toFixed(1)} ${units[unit]}`;
  }

  async function handleClearAllFiles() {
    if (!storageUsage) return;
    const ok = window.confirm("تأكيد حذف كل الملفات؟ سيتم حذف كل الوسائط المرفوعة.");
    if (!ok) return;
    setStorageClearing(true);
    setStorageError(null);
    try {
      const res = await fetch("/api/storage-usage/clear", { method: "POST" });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setStorageError(json?.message || "تعذر حذف الملفات.");
        return;
      }
      setStorageUsage({
        imageBytes: 0,
        videoBytes: 0,
        imageCount: 0,
        videoCount: 0,
      });
    } catch {
      setStorageError("تعذر حذف الملفات.");
    } finally {
      setStorageClearing(false);
    }
  }

  useEffect(() => {
    async function loadAlerts() {
      try {
        const res = await fetch("/api/notifications?limit=2&role=admin");
        const json = await res.json();
        if (res.ok && json.ok) {
          setAlerts(json.data);
        }
      } catch {
        // keep empty
      }
    }
    loadAlerts();
  }, []);

  useEffect(() => {
    async function loadUsersByRole() {
      if (!sessionUser?.studentCode || !sessionUser?.role || !selectedRole) return;
      try {
        setUsersLoading(true);
        setUsersError(null);
        const query = new URLSearchParams({
          role: selectedRole,
          actorCode: sessionUser.studentCode,
          actorRole: sessionUser.role,
        });
        const res = await fetch(`/api/users?${query.toString()}`);
        const json = await res.json();
        if (!res.ok || !json.ok) {
          setUsersError(json?.message || "تعذر تحميل الحسابات.");
          return;
        }
        const prepared = (json.data as Partial<Omit<UserListItem, "sourceCode">>[]).map((item) => ({
          code: String(item.code ?? ""),
          name: String(item.name ?? ""),
          role: String(item.role ?? ""),
          classes: Array.isArray(item.classes) ? item.classes.map((v) => String(v)) : [],
          parentCodes: Array.isArray(item.parentCodes) ? item.parentCodes.map((v) => String(v)) : [],
          childrenCodes: Array.isArray(item.childrenCodes) ? item.childrenCodes.map((v) => String(v)) : [],
          sourceCode: String(item.code ?? ""),
        }));
        setUsers(prepared);
      } catch {
        setUsersError("تعذر تحميل الحسابات.");
      } finally {
        setUsersLoading(false);
      }
    }
    loadUsersByRole();
  }, [selectedRole, sessionUser?.studentCode, sessionUser?.role]);

  useEffect(() => {
    async function loadStudentNames() {
      if (selectedRole !== "parent") return;
      if (!sessionUser?.studentCode || !sessionUser?.role) return;
      try {
        const query = new URLSearchParams({
          role: "student",
          actorCode: sessionUser.studentCode,
          actorRole: sessionUser.role,
        });
        const res = await fetch(`/api/users?${query.toString()}`);
        const json = await res.json();
        if (!res.ok || !json.ok) return;
        const map: Record<string, string> = {};
        for (const item of json.data as Array<{ code?: string; name?: string }>) {
          const code = String(item.code ?? "").trim();
          if (!code) continue;
          map[code] = String(item.name ?? "").trim();
        }
        setStudentNameByCode(map);
      } catch {
        // keep previous names map
      }
    }
    loadStudentNames();
  }, [selectedRole, sessionUser?.studentCode, sessionUser?.role]);

  const filteredUsers = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) return users;
    return users.filter((item) => {
      const byCode = item.code.toLowerCase().includes(term);
      const byName = item.name.toLowerCase().includes(term);
      const byClass = item.classes.join(" ").toLowerCase().includes(term);
      const byParent = item.parentCodes.join(" ").toLowerCase().includes(term);
      const byChildren = item.childrenCodes.join(" ").toLowerCase().includes(term);
      return byCode || byName || byClass || byParent || byChildren;
    });
  }, [users, searchTerm]);

  const analyticsInitialRange = useMemo(
    () => ({
      initialStartDate: stats.classInsights?.period?.startDate ?? "",
      initialEndDate: stats.classInsights?.period?.endDate ?? "",
    }),
    [stats.classInsights?.period?.startDate, stats.classInsights?.period?.endDate]
  );

  const {
    group: analyticsGroup,
    setGroup: setAnalyticsGroup,
    classId: analyticsClassId,
    setClassId: setAnalyticsClassId,
    startDate: analyticsStartDate,
    setStartDate: setAnalyticsStartDate,
    endDate: analyticsEndDate,
    setEndDate: setAnalyticsEndDate,
    classes: analyticsClasses,
    points: analyticsPoints,
    loading: analyticsLoading,
    error: analyticsError,
  } = useAttendanceAnalytics(analyticsInitialRange);

  async function handleDeleteUser(targetCode: string) {
    if (!sessionUser?.studentCode || !sessionUser?.role) return;
    const ok = window.confirm(`تأكيد حذف الحساب ${targetCode}؟`);
    if (!ok) return;

    setDeletingCode(targetCode);
    setUsersError(null);
    try {
      const res = await fetch("/api/users", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          actorCode: sessionUser.studentCode,
          actorRole: sessionUser.role,
          targetCode,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setUsersError(json?.message || "تعذر حذف الحساب.");
        return;
      }
      setUsers((prev) => prev.filter((u) => u.sourceCode !== targetCode));
    } catch {
      setUsersError("تعذر حذف الحساب.");
    } finally {
      setDeletingCode(null);
    }
  }

  function updateUserField(
    sourceCode: string,
    key: "code" | "name" | "parentCodes" | "childrenCodes",
    value: string
  ) {
    setUsers((prev) =>
      prev.map((item) => {
        if (item.sourceCode !== sourceCode) return item;
        if (key === "parentCodes" || key === "childrenCodes") {
          const list = value
            .split(/[,،]/)
            .map((v) => v.trim())
            .filter(Boolean);
          return key === "parentCodes"
            ? { ...item, parentCodes: list }
            : { ...item, childrenCodes: list };
        }
        return { ...item, [key]: value };
      })
    );
  }

  async function handleSaveUser(sourceCode: string) {
    if (!sessionUser?.studentCode || !sessionUser?.role) return;
    const user = users.find((u) => u.sourceCode === sourceCode);
    if (!user) return;
    if (!user.code.trim() || !user.name.trim()) {
      setUsersError("الاسم والكود مطلوبان.");
      return;
    }

    setSavingCode(sourceCode);
    setUsersError(null);
    try {
      const res = await fetch("/api/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          actorCode: sessionUser.studentCode,
          actorRole: sessionUser.role,
          originalCode: sourceCode,
          code: user.code.trim(),
          name: user.name.trim(),
          parentCodes: user.parentCodes,
          childrenCodes: user.childrenCodes,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setUsersError(json?.message || "تعذر حفظ التعديلات.");
        return;
      }
      const savedCode = String(json.data?.code ?? user.code).trim();
      const savedName = String(json.data?.name ?? user.name).trim();
      const savedParents = Array.isArray(json.data?.parentCodes)
        ? (json.data.parentCodes as string[])
        : user.parentCodes;
      const savedChildren = Array.isArray(json.data?.childrenCodes)
        ? (json.data.childrenCodes as string[])
        : user.childrenCodes;
      setUsers((prev) =>
        prev.map((item) =>
          item.sourceCode === sourceCode
            ? {
                ...item,
                sourceCode: savedCode,
                code: savedCode,
                name: savedName,
                parentCodes: savedParents,
                childrenCodes: savedChildren,
              }
            : item
        )
      );
    } catch {
      setUsersError("تعذر حفظ التعديلات.");
    } finally {
      setSavingCode(null);
    }
  }

  async function handleClearAllUsers() {
    if (!sessionUser?.studentCode || !sessionUser?.role) return;
    const ok = window.confirm(
      "تأكيد حذف كل الحسابات؟ سيتم حذف كل الحسابات باستثناء حسابك الحالي فقط."
    );
    if (!ok) return;

    setClearingAll(true);
    setUsersError(null);
    try {
      const res = await fetch("/api/users", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          actorCode: sessionUser.studentCode,
          actorRole: sessionUser.role,
          clearAll: true,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setUsersError(json?.message || "تعذر حذف الحسابات.");
        return;
      }
      setUsers((prev) =>
        prev.filter((u) => u.sourceCode === sessionUser.studentCode)
      );
    } catch {
      setUsersError("تعذر حذف الحسابات.");
    } finally {
      setClearingAll(false);
    }
  }

  return (
    <main className="min-h-screen px-6 pb-24 pt-10">
      <div className="fixed left-6 top-6 z-40 flex items-center gap-2">
        <div
          className={`h-3 w-3 rounded-full ${
            pushStatus === "on" ? "bg-green-500" : "bg-red-500"
          }`}
          aria-label={pushStatus === "on" ? "الإشعارات مفعلة" : "الإشعارات غير مفعلة"}
        />
        <span className="text-xl text-white">🔔</span>
      </div>
      <section className="mx-auto w-full max-w-5xl">
        <header className="mb-10 flex flex-col gap-3">
          <p className="greeting-text">
            سلام ونعمة يا {displayName}
          </p>
        </header>

        <AlertsSection alerts={alerts} />

          <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2" />

        <section className="mt-6 rounded-3xl border border-white/20 bg-white/15 p-6 text-white shadow-[var(--shadow)] backdrop-blur-md">
          <div className="mb-4 flex items-center justify-between">
            <p className="text-lg font-semibold">إحصائيات الفصول</p>
            <p className="text-xs text-white/80">
              {stats.classInsights?.period
                ? `${stats.classInsights.period.name || "الفترة الفعالة"}`
                : "لا توجد فترة فعالة"}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="rounded-2xl border border-white/20 bg-white/10 p-4 text-center">
              <p className="text-sm font-semibold text-white">الاكثر حضوراً (بنين)</p>
              {stats.classInsights?.attendance?.boysBestAttendance?.length ? (
                <div className="mt-3 space-y-3 text-sm text-white/90">
                  {stats.classInsights.attendance.boysBestAttendance.map((item, idx) => (
                    <div key={`boys-att-${item.classId}`}>
                      <p
                        className="font-semibold leading-tight"
                        style={{ fontSize: idx === 0 ? "2.15rem" : "1.65rem" }}
                      >
                        {item.classId}
                      </p>
                      <p className="text-sm text-white/80">{item.attendanceRate}%</p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-2 text-sm text-white/70">لا توجد بيانات حضور.</p>
              )}
            </div>

            <div className="rounded-2xl border border-white/20 bg-white/10 p-4 text-center">
              <p className="text-sm font-semibold text-white">الاكثر حضوراً (بنات)</p>
              {stats.classInsights?.attendance?.girlsBestAttendance?.length ? (
                <div className="mt-3 space-y-3 text-sm text-white/90">
                  {stats.classInsights.attendance.girlsBestAttendance.map((item, idx) => (
                    <div key={`girls-att-${item.classId}`}>
                      <p
                        className="font-semibold leading-tight"
                        style={{ fontSize: idx === 0 ? "2.15rem" : "1.65rem" }}
                      >
                        {item.classId}
                      </p>
                      <p className="text-sm text-white/80">{item.attendanceRate}%</p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-2 text-sm text-white/70">لا توجد بيانات حضور.</p>
              )}
            </div>

            <div className="rounded-2xl border border-white/20 bg-white/10 p-4 text-center">
              <p className="text-sm font-semibold text-white">الاكثر التزاماً (بنات)</p>
              {stats.classInsights?.commitment?.girlsTop?.length ? (
                <div className="mt-3 space-y-3 text-sm text-white/90">
                  {stats.classInsights.commitment.girlsTop.map((item, idx) => (
                    <div key={`girls-score-${item.classId}`}>
                      <p
                        className="font-semibold leading-tight"
                        style={{ fontSize: idx === 0 ? "2.15rem" : "1.65rem" }}
                      >
                        {item.classId}
                      </p>
                      <p className="text-sm text-white/80">{item.totalScore}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-2 text-sm text-white/70">لا توجد بيانات التزام.</p>
              )}
            </div>

            <div className="rounded-2xl border border-white/20 bg-white/10 p-4 text-center">
              <p className="text-sm font-semibold text-white">الاكثر التزاماً  (بنين)</p>
              {stats.classInsights?.commitment?.boysTop?.length ? (
                <div className="mt-3 space-y-3 text-sm text-white/90">
                  {stats.classInsights.commitment.boysTop.map((item, idx) => (
                    <div key={`boys-score-${item.classId}`}>
                      <p
                        className="font-semibold leading-tight"
                        style={{ fontSize: idx === 0 ? "2.15rem" : "1.65rem" }}
                      >
                        {item.classId}
                      </p>
                      <p className="text-sm text-white/80">{item.totalScore}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-2 text-sm text-white/70">لا توجد بيانات التزام.</p>
              )}
            </div>
          </div>
        </section>

        <AttendanceAnalyticsChart
          loading={analyticsLoading}
          error={analyticsError}
          points={analyticsPoints}
          classes={analyticsClasses}
          group={analyticsGroup}
          classId={analyticsClassId}
          startDate={analyticsStartDate}
          endDate={analyticsEndDate}
          periodName={stats.classInsights?.period?.name || "الفترة الفعالة"}
          onGroupChange={setAnalyticsGroup}
          onClassChange={setAnalyticsClassId}
          onStartDateChange={setAnalyticsStartDate}
          onEndDateChange={setAnalyticsEndDate}
        />

        <RoleStatsSection
          stats={stats}
          selectedRole={selectedRole}
          onSelectRole={setSelectedRole}
          storageUsage={storageUsage}
          storageError={storageError}
          onOpenStorage={() => setStorageOpen(true)}
        />

          <section className="mt-6 rounded-3xl border border-white/20 bg-white/15 p-6 text-white shadow-[var(--shadow)] backdrop-blur-md">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-lg font-semibold">
                حسابات {roleCards.find((item) => item.key === selectedRole)?.label ?? ""}
              </p>
              <div className="flex w-full max-w-3xl flex-wrap items-center gap-2">
              <input
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search بالاسم او الكود او الفصل او كود ولي الأمر"
                className="min-w-[260px] flex-1 rounded-2xl border border-white/20 bg-white/10 px-4 py-2 text-sm text-white placeholder:text-white/70"
              />
              <button
                type="button"
                onClick={handleClearAllUsers}
                disabled={clearingAll}
                className="rounded-full bg-red-700 px-4 py-2 text-xs font-semibold text-white disabled:opacity-60"
              >
                {clearingAll ? "جار الحذف..." : "حذف الكل"}
              </button>
              </div>
            </div>

            {usersLoading ? <p className="mt-4 text-sm text-white/80">جار التحميل...</p> : null}
            {usersError ? <p className="mt-4 text-sm text-red-200">{usersError}</p> : null}
          {!usersLoading && !usersError && filteredUsers.length === 0 ? (
            <p className="mt-4 text-sm text-white/80">لا توجد حسابات.</p>
          ) : null}

          {!usersLoading && !usersError && filteredUsers.length > 0 ? (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[680px] text-right text-sm text-white">
                <thead>
                  <tr className="border-b border-white/20 text-white/85">
                    <th className="px-3 py-2">الكود</th>
                    <th className="px-3 py-2">الاسم</th>
                    <th className="px-3 py-2">الفصل</th>
                    <th className="px-3 py-2">كود ولي الأمر</th>
                    {selectedRole === "parent" ? (
                      <th className="px-3 py-2">أسماء الأبناء</th>
                    ) : null}
                    {selectedRole === "parent" ? (
                      <th className="px-3 py-2">كود الطلاب</th>
                    ) : null}
                    <th className="px-3 py-2">حذف</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredUsers.map((item) => (
                    <tr key={item.sourceCode} className="border-b border-white/10">
                      <td className="px-3 py-2">
                        <input
                          value={item.code}
                          onChange={(e) =>
                            updateUserField(item.sourceCode, "code", e.target.value)
                          }
                          className="w-full rounded-lg border border-white/20 bg-white/10 px-2 py-1 text-sm text-white"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          value={item.name}
                          onChange={(e) =>
                            updateUserField(item.sourceCode, "name", e.target.value)
                          }
                          className="w-full rounded-lg border border-white/20 bg-white/10 px-2 py-1 text-sm text-white"
                        />
                      </td>
                      <td className="px-3 py-2">{item.classes.length ? item.classes.join(", ") : "-"}</td>
                      <td className="px-3 py-2">
                        <input
                          value={item.parentCodes.join(", ")}
                          onChange={(e) =>
                            updateUserField(item.sourceCode, "parentCodes", e.target.value)
                          }
                          className="w-full rounded-lg border border-white/20 bg-white/10 px-2 py-1 text-sm text-white"
                        />
                      </td>
                      {selectedRole === "parent" ? (
                        <td className="px-3 py-2">
                          {((item.childrenCodes.length ? item.childrenCodes : item.parentCodes).map((childCode) =>
                            studentNameByCode[childCode] ? studentNameByCode[childCode] : childCode
                          )).join(", ") || "-"}
                        </td>
                      ) : null}
                      {selectedRole === "parent" ? (
                        <td className="px-3 py-2">
                          <input
                            value={(item.childrenCodes.length ? item.childrenCodes : item.parentCodes).join(", ")}
                            onChange={(e) =>
                              updateUserField(item.sourceCode, "childrenCodes", e.target.value)
                            }
                            className="w-full rounded-lg border border-white/20 bg-white/10 px-2 py-1 text-sm text-white"
                          />
                        </td>
                      ) : null}
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            className="rounded-full bg-blue-600 px-3 py-1 text-xs font-semibold text-white disabled:opacity-60"
                            onClick={() => handleSaveUser(item.sourceCode)}
                            disabled={savingCode === item.sourceCode}
                          >
                            {savingCode === item.sourceCode ? "..." : "حفظ"}
                          </button>
                        <button
                          type="button"
                          className="rounded-full bg-red-600 px-3 py-1 text-xs font-semibold text-white disabled:opacity-60"
                          onClick={() => handleDeleteUser(item.sourceCode)}
                          disabled={deletingCode === item.sourceCode}
                        >
                          {deletingCode === item.sourceCode ? "..." : "حذف"}
                        </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>
      </section>

      {storageOpen ? (
        <div className="fixed inset-0 z-[999] flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-3xl border border-white/20 bg-[#0b1d3a] p-5 text-white shadow-[var(--shadow)]">
            <div className="flex items-center justify-between">
              <p className="text-lg font-semibold">تفاصيل المساحة</p>
              <button
                type="button"
                onClick={() => setStorageOpen(false)}
                className="text-white/70 transition hover:text-white"
              >
                ✕
              </button>
            </div>
            <div className="mt-4 rounded-2xl border border-white/15 bg-white/5 p-4 text-sm">
              {storageError ? (
                <p className="text-xs text-red-200">{storageError}</p>
              ) : storageUsage ? (
                <div className="space-y-2 text-sm text-white/85">
                  <p>
                    الصور: {storageUsage.imageCount} · {formatBytes(storageUsage.imageBytes)}
                  </p>
                  <p>
                    الفيديوهات: {storageUsage.videoCount} · {formatBytes(storageUsage.videoBytes)}
                  </p>
                  <p className="text-xs text-white/60">
                    إجمالي الوسائط: {formatBytes(
                      storageUsage.imageBytes + storageUsage.videoBytes
                    )}
                  </p>
                </div>
              ) : (
                <p className="text-xs text-white/70">جارٍ حساب المساحة...</p>
              )}
            </div>
            <button
              type="button"
              onClick={handleClearAllFiles}
              disabled={storageClearing}
              className="mt-4 w-full rounded-full bg-red-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              {storageClearing ? "جار الحذف..." : "حذف كل الملفات"}
            </button>
          </div>
        </div>
      ) : null}
    </main>
  );
}
