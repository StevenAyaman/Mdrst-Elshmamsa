"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type StoredUser = {
  studentCode?: string;
  role?: string;
};

type ClassItem = { id: string; name: string };

type RequestItem = {
  id: string;
  name: string;
  code: string;
  role: string;
  classId: string;
  password: string;
  createdAt: string;
};

const roleOptions = [
  { value: "admin", label: "Admin" },
  { value: "system", label: "نظام" },
  { value: "teacher", label: "مدرس" },
  { value: "parent", label: "ولي أمر" },
  { value: "notes", label: "ملاحظات" },
  { value: "student", label: "طالب" },
];

export default function AccountRequestsPage() {
  const [me, setMe] = useState<StoredUser | null>(null);
  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [requests, setRequests] = useState<RequestItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actioningId, setActioningId] = useState<string | null>(null);

  useEffect(() => {
    const stored = window.localStorage.getItem("dsms:user");
    if (!stored) return;
    try {
      setMe(JSON.parse(stored) as StoredUser);
    } catch {
      setMe(null);
    }
  }, []);

  useEffect(() => {
    async function loadClasses() {
      try {
        const res = await fetch("/api/classes");
        const json = await res.json();
        if (res.ok && json.ok) setClasses(json.data as ClassItem[]);
      } catch {
        // noop
      }
    }
    loadClasses();
  }, []);

  useEffect(() => {
    async function loadRequests() {
      if (!me?.studentCode || !me?.role) return;
      try {
        setLoading(true);
        setError(null);
        const query = new URLSearchParams({
          actorCode: me.studentCode,
          actorRole: me.role,
          status: "pending",
        });
        const res = await fetch(`/api/account-requests?${query.toString()}`);
        const json = await res.json();
        if (!res.ok || !json.ok) {
          setError(json?.message || "تعذر تحميل الطلبات.");
          return;
        }
        const items = (json.data as Omit<RequestItem, "password">[]).map((item) => ({
          ...item,
          password: "",
        }));
        setRequests(items as RequestItem[]);
      } catch {
        setError("تعذر تحميل الطلبات.");
      } finally {
        setLoading(false);
      }
    }
    loadRequests();
  }, [me?.studentCode, me?.role]);

  const classMap = useMemo(() => {
    const map: Record<string, string> = {};
    classes.forEach((cls) => {
      map[cls.id] = cls.name || cls.id;
    });
    return map;
  }, [classes]);

  function updateRequestField(id: string, key: keyof RequestItem, value: string) {
    setRequests((prev) =>
      prev.map((item) => (item.id === id ? { ...item, [key]: value } : item))
    );
  }

  async function processRequest(id: string, action: "approve" | "reject" | "update") {
    if (!me?.studentCode || !me?.role) return;
    const item = requests.find((r) => r.id === id);
    if (!item) return;

    if (action !== "reject") {
      if (!item.name.trim() || !item.code.trim()) {
        setError("الاسم والكود مطلوبان.");
        return;
      }
      if (!["admin", "notes"].includes(item.role) && !item.classId.trim()) {
        setError("الفصل مطلوب لهذا الدور.");
        return;
      }
    }

    setActioningId(id);
    setError(null);
    try {
      const res = await fetch("/api/account-requests", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          actorCode: me.studentCode,
          actorRole: me.role,
          requestId: id,
          action,
          name: item.name,
          code: item.code,
          role: item.role,
          classId: ["admin", "notes"].includes(item.role) ? "" : item.classId,
          startupPassword: item.password,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(json?.message || "تعذر تنفيذ الإجراء.");
        return;
      }
      if (action === "approve" || action === "reject") {
        setRequests((prev) => prev.filter((r) => r.id !== id));
      }
    } catch {
      setError("تعذر تنفيذ الإجراء.");
    } finally {
      setActioningId(null);
    }
  }

  return (
    <main className="min-h-screen px-6 pb-24 pt-10">
      <div className="mx-auto w-full max-w-5xl">
        <header className="mb-8 flex items-center justify-between">
          <h1 className="app-heading mt-2">طلبات الحسابات</h1>
          <Link
            href="/portal/admin/administration"
            className="back-btn rounded-full border border-black/10 bg-white px-4 py-2 text-sm font-semibold text-[color:var(--ink)] shadow-sm"
          >
            رجوع
          </Link>
        </header>

        <section className="rounded-3xl border border-white/20 bg-white/15 p-6 text-white shadow-[var(--shadow)] backdrop-blur-md">
          <div className="mb-4 flex items-center justify-between">
            <p className="text-lg font-semibold">الطلبات المعلقة</p>
            <span className="rounded-full border border-white/40 bg-white/20 px-3 py-1 text-sm">
              {requests.length}
            </span>
          </div>

          {loading ? <p className="text-sm text-white/80">جار التحميل...</p> : null}
          {error ? <p className="mb-3 text-sm text-red-200">{error}</p> : null}
          {!loading && requests.length === 0 ? (
            <p className="text-sm text-white/80">لا توجد طلبات حالياً.</p>
          ) : null}

          <div className="grid gap-4">
            {requests.map((item) => (
              <div
                key={item.id}
                className="rounded-2xl border border-white/20 bg-white/10 p-4"
              >
                <div className="grid gap-2 sm:grid-cols-2">
                  <input
                    className="rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-sm text-white"
                    value={item.name}
                    onChange={(e) => updateRequestField(item.id, "name", e.target.value)}
                    placeholder="الاسم"
                  />
                  <input
                    className="rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-sm text-white"
                    value={item.code}
                    onChange={(e) => updateRequestField(item.id, "code", e.target.value)}
                    placeholder="كود المستخدم"
                  />
                  <select
                    className="rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-sm text-white"
                    value={item.role}
                    onChange={(e) => {
                      const nextRole = e.target.value;
                      updateRequestField(item.id, "role", nextRole);
                      if (nextRole === "admin" || nextRole === "notes") {
                        updateRequestField(item.id, "classId", "");
                      }
                    }}
                  >
                    {roleOptions.map((opt) => (
                      <option key={opt.value} value={opt.value} className="text-black">
                        {opt.label}
                      </option>
                    ))}
                  </select>
                  <select
                    className="rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-sm text-white"
                    value={item.classId}
                    onChange={(e) => updateRequestField(item.id, "classId", e.target.value)}
                    disabled={item.role === "admin" || item.role === "notes"}
                  >
                    <option value="" className="text-black">
                      {["admin", "notes"].includes(item.role) ? "بدون فصل" : "اختر الفصل"}
                    </option>
                    {classes.map((cls) => (
                      <option key={cls.id} value={cls.id} className="text-black">
                        {classMap[cls.id] ?? cls.id}
                      </option>
                    ))}
                  </select>
                  <input
                    className="rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-sm text-white sm:col-span-2"
                    value={item.password}
                    onChange={(e) => updateRequestField(item.id, "password", e.target.value)}
                    placeholder="تعيين باسورد جديد (اختياري)"
                  />
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => processRequest(item.id, "update")}
                    disabled={actioningId === item.id}
                    className="rounded-full border border-white/40 px-4 py-1 text-sm text-white/95"
                  >
                    حفظ التعديل
                  </button>
                  <button
                    type="button"
                    onClick={() => processRequest(item.id, "approve")}
                    disabled={actioningId === item.id}
                    className="rounded-full bg-green-700 px-4 py-1 text-sm text-white"
                  >
                    قبول
                  </button>
                  <button
                    type="button"
                    onClick={() => processRequest(item.id, "reject")}
                    disabled={actioningId === item.id}
                    className="rounded-full bg-red-700 px-4 py-1 text-sm text-white"
                  >
                    رفض
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}

