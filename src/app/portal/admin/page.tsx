"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

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

const roleCards = [
  { key: "admin", label: "Admins", statsKey: "admin" as const },
  { key: "system", label: "خدام النظام", statsKey: "system" as const },
  { key: "teacher", label: "المدرسين", statsKey: "teacher" as const },
  { key: "parent", label: "أولياء الأمور", statsKey: "parent" as const },
  { key: "notes", label: "خدام الملاحظات و الشكاوي ", statsKey: "notes" as const },
  { key: "student", label: "الطلاب", statsKey: "student" as const },
];

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
      return parsed?.name || "الخادم";
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
    student: 0,
    nzam: 0,
    classes: 0,
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

  useEffect(() => {
    async function loadStats() {
      try {
        const res = await fetch("/api/stats");
        const json = await res.json();
        if (res.ok && json.ok) {
          setStats(json.data);
        }
      } catch {
        // keep defaults
      }
    }
    loadStats();
  }, []);

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

        <div className="rounded-3xl border border-white/20 bg-white/15 p-6 text-white shadow-[var(--shadow)] backdrop-blur-md">
          <div className="grid grid-cols-3 gap-4">
            {roleCards.map((roleCard) => (
              <button
                key={roleCard.key}
                type="button"
                onClick={() => setSelectedRole(roleCard.key)}
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
          </div>
        </div>

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

    </main>
  );
}
