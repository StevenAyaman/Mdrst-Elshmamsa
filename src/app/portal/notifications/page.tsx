"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import BackButton from "@/app/back-button";
import { useRouter } from "next/navigation";

type StoredUser = {
  name?: string;
  studentCode?: string;
  role?: string;
};

type NotificationItem = {
  id: string;
  title: string;
  body: string;
  createdAt: string;
  createdBy: {
    name?: string;
    code?: string;
    role?: string;
  };
  audience?: {
    type?: "all" | "class" | "role";
    classId?: string;
    className?: string;
    role?: string;
  };
};

const allowedRoles = new Set(["admin", "system", "teacher", "notes"]);

function timeAgo(iso: string) {
  const diff = Math.max(0, Date.now() - new Date(iso).getTime());
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "منذ لحظات";
  if (minutes < 60) return `منذ ${minutes} دقيقة`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `منذ ${hours} ساعة`;
  const days = Math.floor(hours / 24);
  return `منذ ${days} يوم`;
}

export default function NotificationsPage() {
  const router = useRouter();
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [audience, setAudience] = useState<{ type: "all" | "class"; classId?: string }>(
    { type: "all" }
  );
  const [multiClassIds, setMultiClassIds] = useState<string[]>([]);
  const [classes, setClasses] = useState<{ id: string; name: string }[]>([]);
  const [filter, setFilter] = useState<{ type: "all" | "class"; classId?: string }>(
    { type: "all" }
  );
  const [user, setUser] = useState<StoredUser | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [clearError, setClearError] = useState<string | null>(null);

  useEffect(() => {
    const stored = window.localStorage.getItem("dsms:user");
    if (stored) {
      try {
        setUser(JSON.parse(stored));
      } catch {
        setUser(null);
      }
    }
  }, []);

  useEffect(() => {
    async function loadClasses() {
      if (!user?.role || !allowedRoles.has(user.role)) return;
      try {
        if (user.role === "system" || user.role === "teacher") {
          const userRes = await fetch(`/api/users?code=${user.studentCode}`);
          const userJson = await userRes.json();
          if (userRes.ok && userJson.ok) {
            const fetched = (userJson.data?.classes as string[]) ?? [];
            const onlyOwn = fetched.map((id) => ({ id, name: id }));
            setClasses(onlyOwn);
            if (onlyOwn.length) {
              setAudience({ type: "class", classId: onlyOwn[0].id });
              setMultiClassIds([onlyOwn[0].id]);
            }
          }
          return;
        }

        const res = await fetch("/api/classes");
        const json = await res.json();
        if (res.ok && json.ok) {
          setClasses(json.data as { id: string; name: string }[]);
        }
      } catch {
        // ignore
      }
    }
    loadClasses();
  }, [user?.role, user?.studentCode]);

  async function loadNotifications(force = false) {
    try {
      const roleParam = user?.role ?? "";
      let classIdParam = "";
      const userClasses = (user as { classes?: string[] })?.classes ?? [];

      if (!allowedRoles.has(roleParam)) {
        classIdParam =
          filter.type === "class" && filter.classId && userClasses.includes(filter.classId)
            ? filter.classId
            : userClasses[0] ?? "";
        if (!classIdParam && user?.studentCode) {
          const userRes = await fetch(`/api/users?code=${user.studentCode}`);
          const userJson = await userRes.json();
          if (userRes.ok && userJson.ok) {
            const fetchedClasses = (userJson.data?.classes as string[]) ?? [];
            classIdParam = fetchedClasses[0] ?? "";
          }
        }
      } else {
        classIdParam = filter.type === "class" ? filter.classId ?? "" : "";
      }

      const query = new URLSearchParams();
      query.set("limit", roleParam === "admin" || roleParam === "notes" ? "100" : "15");
      if (roleParam) query.set("role", roleParam);
      if (classIdParam) query.set("classId", classIdParam);

      const cacheKey = `dsms:notifications-cache:${roleParam || "none"}:${classIdParam || "all"}`;
      if (!force && roleParam !== "admin" && roleParam !== "notes") {
        const cached = window.localStorage.getItem(cacheKey);
        if (cached) {
          try {
            setItems(JSON.parse(cached) as NotificationItem[]);
          } catch {
            // ignore
          }
        }
      }

      const res = await fetch(`/api/notifications?${query.toString()}`);
      const json = await res.json();
      if (res.ok && json.ok) {
        setItems(json.data as NotificationItem[]);
        if (roleParam !== "admin" && roleParam !== "notes") {
          window.localStorage.setItem(cacheKey, JSON.stringify(json.data));
        }
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadNotifications();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.role, user?.studentCode, filter.type, filter.classId]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!user?.name || !user?.studentCode || !user?.role) {
      setError("لا توجد جلسة صالحة.");
      return;
    }
    if (!title.trim() || !body.trim()) {
      setError("برجاء إدخال العنوان والمحتوى.");
      return;
    }
    const canPostMultiClass = user.role === "notes" || user.role === "teacher";
    if (audience.type === "class" && canPostMultiClass && multiClassIds.length === 0) {
      setError("برجاء اختيار فصل واحد على الأقل.");
      return;
    }
    if (audience.type === "class" && user.role !== "notes" && !audience.classId) {
      setError("برجاء اختيار الفصل المستهدف.");
      return;
    }
    if (audience.type === "class" && canPostMultiClass) {
      const selected = multiClassIds.length ? multiClassIds : [];
      for (const classId of selected) {
        const res = await fetch("/api/notifications", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: title.trim(),
            body: body.trim(),
            createdBy: {
              name: user.name,
              code: user.studentCode,
              role: user.role,
            },
            audience: {
              type: "class",
              classId,
              className: classes.find((c) => c.id === classId)?.name,
            },
          }),
        });
        const json = await res.json();
        if (!res.ok || !json.ok) {
          setError(json?.message || "حدث خطأ.");
          return;
        }
        setItems((prev) => [json.data as NotificationItem, ...prev]);
      }
      setTitle("");
      setBody("");
      if (user.role === "teacher" || user.role === "system") {
        const fallback = classes[0]?.id;
        setAudience({ type: "class", classId: fallback });
        setMultiClassIds(fallback ? [fallback] : []);
      } else {
        setAudience({ type: "all" });
        setMultiClassIds([]);
      }
      return;
    }

    const res = await fetch("/api/notifications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: title.trim(),
        body: body.trim(),
        createdBy: {
          name: user.name,
          code: user.studentCode,
          role: user.role,
        },
        audience: {
          type: audience.type,
          classId: audience.type === "class" ? audience.classId : undefined,
          className:
            audience.type === "class"
              ? classes.find((c) => c.id === audience.classId)?.name
              : undefined,
        },
      }),
    });
    const json = await res.json();
    if (!res.ok || !json.ok) {
      setError(json?.message || "حدث خطأ.");
      return;
    }
    setItems((prev) => [json.data as NotificationItem, ...prev]);
    setTitle("");
    setBody("");
    if (user.role === "teacher" || user.role === "system") {
      const fallback = classes[0]?.id;
      setAudience({ type: "class", classId: fallback });
      setMultiClassIds(fallback ? [fallback] : []);
    } else {
      setAudience({ type: "all" });
    }
  }

  const canCreate = user?.role ? allowedRoles.has(user.role) : false;
  const canDelete = canCreate;
  const canClear = user?.role ? (allowedRoles.has(user.role) && user.role !== "notes") : false;

  async function handleDelete(id: string) {
    if (!canDelete) return;
    setDeleting(true);
    setDeleteError(null);
    const res = await fetch(`/api/notifications/${id}`, { method: "DELETE" });
    if (res.ok) {
      setItems((prev) => prev.filter((item) => item.id !== id));
      setConfirmDeleteId(null);
      setDeleting(false);
      return;
    }
    setDeleting(false);
    setDeleteError("تعذر حذف التنبيه. حاول مرة أخرى.");
  }

  async function handleClearAll() {
    if (!canClear) return;
    setClearing(true);
    setClearError(null);
    const res = await fetch("/api/notifications/clear", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: user?.role ?? "" }),
    });
    if (res.ok) {
      setItems([]);
      setClearing(false);
      return;
    }
    setClearing(false);
    setClearError("تعذر مسح التنبيهات. حاول مرة أخرى.");
  }

  return (
    <main className="min-h-screen px-6 pb-24 pt-10">
      <div className="mx-auto w-full max-w-5xl">
        <header className="mb-8 flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-[color:var(--accent-2)]">
              التنبيهات
            </p>
            <h1 className="app-heading mt-2">كل التنبيهات</h1>
          </div>
          <BackButton
            className="back-btn rounded-full border border-black/10 bg-white px-4 py-2 text-sm font-semibold text-[color:var(--ink)] shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
          />
        </header>

        {canCreate ? (
          <form
            onSubmit={handleSubmit}
            className="notif-form mb-8 rounded-3xl border border-white/20 bg-white/15 p-6 text-white shadow-[var(--shadow)] backdrop-blur-md"
          >
            <p className="notif-title text-sm">تنبيه جديد</p>
            <div className="mt-4 grid gap-3">
              <input
                className="rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-sm text-white placeholder:text-white/70"
                placeholder="عنوان التنبيه"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
              <textarea
                className="min-h-[120px] rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-sm text-white placeholder:text-white/70"
                placeholder="تفاصيل التنبيه"
                value={body}
                onChange={(e) => setBody(e.target.value)}
              />
              <div className="grid gap-2">
                <label className="notif-title text-xs">الفئة المستهدفة</label>
                {user?.role === "teacher" ? (
                  <div className="grid gap-2 rounded-2xl border border-white/20 bg-white/10 p-3">
                    <p className="text-xs text-white/80">اختر صف أو أكثر من صفوفك</p>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {classes.map((cls) => {
                        const checked = multiClassIds.includes(cls.id);
                        return (
                          <label
                            key={cls.id}
                            className="flex cursor-pointer items-center gap-2 rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-sm text-white"
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(e) => {
                                const nextChecked = e.target.checked;
                                setAudience({ type: "class", classId: cls.id });
                                setMultiClassIds((prev) => {
                                  if (nextChecked) {
                                    return prev.includes(cls.id) ? prev : [...prev, cls.id];
                                  }
                                  return prev.filter((id) => id !== cls.id);
                                });
                              }}
                            />
                            <span>{cls.name}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <select
                    className="rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-sm text-white/70"
                    style={{ color: "rgba(255,255,255,0.6)" }}
                    value={audience.type === "class" ? audience.classId ?? "" : "__all__"}
                    onChange={(e) => {
                      const value = e.target.value;
                      if (value === "__all__") {
                        setAudience({ type: "all" });
                        setMultiClassIds([]);
                      } else {
                        setAudience({ type: "class", classId: value });
                        setMultiClassIds([value]);
                      }
                    }}
                  >
                    {user?.role !== "system" && user?.role !== "teacher" ? (
                      <option value="__all__" className="text-black">
                        المدرسة كلها
                      </option>
                    ) : null}
                    {classes.map((cls) => (
                      <option key={cls.id} value={cls.id} className="text-black">
                        {cls.name}
                      </option>
                    ))}
                  </select>
                )}
                {user?.role === "notes" && audience.type === "class" ? (
                  <div className="grid gap-2">
                    <p className="text-xs text-white/80">اختر أكثر من فصل</p>
                    <div className="flex flex-wrap gap-2">
                      {classes.map((cls) => {
                        const active = multiClassIds.includes(cls.id);
                        return (
                          <button
                            key={cls.id}
                            type="button"
                            onClick={() => {
                              setMultiClassIds((prev) =>
                                prev.includes(cls.id)
                                  ? prev.filter((id) => id !== cls.id)
                                  : [...prev, cls.id]
                              );
                            }}
                            className={`rounded-full border px-3 py-1 text-xs ${
                              active
                                ? "border-white/60 bg-white/25 text-white"
                                : "border-white/20 bg-white/10 text-white/80"
                            }`}
                          >
                            {cls.name}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
              </div>
              {error ? <p className="text-xs text-red-200">{error}</p> : null}
              <div className="flex justify-end">
                <button
                  type="submit"
                  className="rounded-full bg-white px-5 py-2 text-sm font-semibold text-black"
                >
                  نشر التنبيه
                </button>
              </div>
            </div>
          </form>
        ) : null}

        {(user?.role === "admin" || user?.role === "system" || user?.role === "teacher" || user?.role === "notes") ? (
          <div className="mb-6 flex flex-wrap items-center justify-center gap-3">
            <label className="text-sm text-[color:var(--muted)]"></label>
            <select
              className="rounded-full border border-black/10 bg-white px-4 py-2 text-sm text-[color:var(--ink)] shadow-sm"
              value={filter.type === "class" ? filter.classId ?? "" : "__all__"}
              onChange={(e) => {
                const value = e.target.value;
                if (value === "__all__") {
                  setFilter({ type: "all" });
                } else {
                  setFilter({ type: "class", classId: value });
                }
              }}
            >
              <option value="__all__">المدرسة كلها</option>
              {classes.map((cls) => (
                <option key={cls.id} value={cls.id}>
                  {cls.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => loadNotifications(true)}
              className="rounded-full border border-black/10 bg-white px-4 py-2 text-sm font-semibold text-[color:var(--ink)] shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
            >
              تحديث
            </button>
            {canClear ? (
              <button
                type="button"
                onClick={handleClearAll}
                className="rounded-full border border-red-200 bg-white px-4 py-2 text-sm font-semibold text-red-600 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
              >
                {clearing ? "جار المسح..." : "مسح الكل"}
              </button>
            ) : null}
            {clearError ? <span className="text-xs text-red-600">{clearError}</span> : null}
          </div>
        ) : null}

        <div className="grid gap-4">
          {loading ? (
            <p className="text-sm text-[color:var(--muted)]">جار التحميل...</p>
          ) : items.length === 0 ? (
            <div className="rounded-2xl border border-black/10 bg-white px-4 py-3 text-center text-sm font-semibold text-[color:var(--ink)] shadow-sm">
              لا يوجد تنبيهات
            </div>
          ) : (
            items.map((item) => (
              <div
                key={item.id}
                className="notif-card rounded-3xl border border-black/10 bg-white/90 p-5 shadow-[var(--shadow)]"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="notif-card-title text-sm font-semibold">{item.title}</p>
                    <span className="notif-card-meta text-xs">
                      {timeAgo(item.createdAt)}
                    </span>
                  </div>
                  {canDelete ? (
                    <button
                      type="button"
                      className="rounded-full px-2 py-1 hover:bg-red-50"
                      onClick={() => setConfirmDeleteId(item.id)}
                      aria-label="حذف التنبيه"
                    >
                      <img src="/delete.png" alt="" className="h-5 w-5" />
                    </button>
                  ) : null}
                </div>
                <Link href={`/portal/notifications/${item.id}`} className="mt-3 block">
                  <p className="notif-card-body text-sm line-clamp-2">
                    {item.body}
                  </p>
                  {item.audience?.type === "class" ? (
                    <p className="notif-card-meta mt-1 text-[10px]">
                      إلى: {item.audience.className ?? item.audience.classId}
                    </p>
                  ) : item.audience?.type === "role" ? (
                    <p className="notif-card-meta mt-1 text-[10px]">
                      إلى: {item.audience.role === "notes" ? "حساب الملاحظات" : item.audience.role}
                    </p>
                  ) : (
                    <p className="notif-card-meta mt-1 text-[10px]">
                      إلى: المدرسة كلها
                    </p>
                  )}
                </Link>
              </div>
            ))
          )}
        </div>
      </div>

      {confirmDeleteId ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div
            className="w-full max-w-sm rounded-3xl border border-black/10 bg-white p-6 shadow-[var(--shadow)]"
            role="dialog"
            aria-modal="true"
          >
            <p className="text-base font-semibold text-[color:var(--ink)]">
              تأكيد الحذف
            </p>
            <p className="mt-2 text-sm text-[color:var(--muted)]">
              هل تريد حذف هذا التنبيه؟ لا يمكن التراجع بعد الحذف.
            </p>
            {deleteError ? (
              <p className="mt-2 text-sm text-red-600">{deleteError}</p>
            ) : null}
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                className="rounded-full border border-black/10 px-4 py-2 text-sm font-semibold text-[color:var(--ink)]"
                onClick={() => setConfirmDeleteId(null)}
                disabled={deleting}
              >
                إلغاء
              </button>
              <button
                type="button"
                className="rounded-full bg-red-600 px-4 py-2 text-sm font-semibold text-white"
                onClick={() => handleDelete(confirmDeleteId)}
                disabled={deleting}
              >
                {deleting ? "جار الحذف..." : "حذف"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
