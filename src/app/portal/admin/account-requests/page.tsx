"use client";

import Link from "next/link";
import BackButton from "@/app/back-button";
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
  email?: string;
  password: string;
  startupPassword?: string;
  rejectReason?: string;
  createdAt: string;
  reviewedAt?: string;
};

const roleOptions = [
  { value: "admin", label: "Admin" },
  { value: "system", label: "نظام" },
  { value: "teacher", label: "مدرس" },
  { value: "parent", label: "ولي أمر" },
  { value: "notes", label: "الملاحظات و الشكاوي" },
  { value: "katamars", label: "حساب القطمارس" },
  { value: "student", label: "طالب" },
];

export default function AccountRequestsPage() {
  const [me, setMe] = useState<StoredUser | null>(null);
  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [requests, setRequests] = useState<RequestItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actioningId, setActioningId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<"pending" | "rejected" | "approved">("pending");
  const [rejectOpenId, setRejectOpenId] = useState<string | null>(null);
  const [rejectReasons, setRejectReasons] = useState<Record<string, string>>({});

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
          status: statusFilter,
        });
        const res = await fetch(`/api/account-requests?${query.toString()}`);
        const json = await res.json();
        if (!res.ok || !json.ok) {
          setError(json?.message || "تعذر تحميل الطلبات.");
          return;
        }
        const items = (json.data as Omit<RequestItem, "password">[]).map((item) => ({
          ...item,
          password: String(item.startupPassword ?? ""),
        }));
        let next = items as RequestItem[];
        if (statusFilter === "approved") {
          const cutoff = Date.now() - 48 * 60 * 60 * 1000;
          next = next.filter((item) => {
            const t = Date.parse(String(item.reviewedAt ?? item.createdAt ?? ""));
            return Number.isFinite(t) && t >= cutoff;
          });
        }
        setRequests(next);
      } catch {
        setError("تعذر تحميل الطلبات.");
      } finally {
        setLoading(false);
      }
    }
    loadRequests();
  }, [me?.studentCode, me?.role, statusFilter]);

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

  async function processRequest(
    id: string,
    action: "approve" | "reject" | "update",
    rejectReasonOverride?: string
  ) {
    if (!me?.studentCode || !me?.role) return;
    const item = requests.find((r) => r.id === id);
    if (!item) return;

    if (action !== "reject") {
      if (!item.name.trim() || !item.code.trim()) {
        setError("الاسم والكود مطلوبان.");
        return;
      }
      if (!["admin", "notes", "katamars"].includes(item.role) && !item.classId.trim()) {
        setError("الفصل مطلوب لهذا الدور.");
        return;
      }
    }
    if (action === "approve" && !item.password.trim()) {
      setError("قبل القبول: اكتب الباسورد المبدأي ليتم إرساله للمستخدم في الإيميل.");
      return;
    }

    const rejectReason = String(rejectReasonOverride ?? "").trim();

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
          classId: ["admin", "notes", "katamars"].includes(item.role) ? "" : item.classId,
          startupPassword: item.password,
          email: String(item.email ?? "").trim(),
          rejectReason,
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
      if (action === "reject") {
        setRejectOpenId(null);
      }
    } catch {
      setError("تعذر تنفيذ الإجراء.");
    } finally {
      setActioningId(null);
    }
  }

  function updateRejectReason(id: string, value: string) {
    setRejectReasons((prev) => ({ ...prev, [id]: value }));
  }

  async function deleteRequestRecord(id: string) {
    if (!me?.studentCode || !me?.role) return;
    if (!window.confirm("تأكيد حذف السجل؟")) return;
    setActioningId(id);
    setError(null);
    try {
      const res = await fetch("/api/account-requests", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          actorCode: me.studentCode,
          actorRole: me.role,
          requestId: id,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(json?.message || "تعذر حذف السجل.");
        return;
      }
      setRequests((prev) => prev.filter((r) => r.id !== id));
    } catch {
      setError("تعذر حذف السجل.");
    } finally {
      setActioningId(null);
    }
  }

  return (
    <main className="min-h-screen px-6 pb-24 pt-10">
      <div className="mx-auto w-full max-w-5xl">
        <header className="mb-8 flex items-center justify-between">
          <h1 className="app-heading mt-2">طلبات الحسابات</h1>
          <BackButton
            className="back-btn rounded-full border border-black/10 bg-white px-4 py-2 text-sm font-semibold text-[color:var(--ink)] shadow-sm"
            fallbackHref={"/portal/admin/administration"}
            />
        </header>

        <section className="rounded-3xl border border-white/20 bg-white/15 p-6 text-white shadow-[var(--shadow)] backdrop-blur-md">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setStatusFilter("pending")}
                className={`rounded-full px-3 py-1 text-sm ${
                  statusFilter === "pending"
                    ? "bg-white text-[color:var(--ink)]"
                    : "border border-white/30 bg-transparent text-white"
                }`}
              >
                المعلقة
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter("rejected")}
                className={`rounded-full px-3 py-1 text-sm ${
                  statusFilter === "rejected"
                    ? "bg-white text-[color:var(--ink)]"
                    : "border border-white/30 bg-transparent text-white"
                }`}
              >
                المرفوضة
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter("approved")}
                className={`rounded-full px-3 py-1 text-sm ${
                  statusFilter === "approved"
                    ? "bg-white text-[color:var(--ink)]"
                    : "border border-white/30 bg-transparent text-white"
                }`}
              >
                 المقبولة
              </button>
            </div>
            <p className="text-lg font-semibold">
              {statusFilter === "pending"
                ? ""
                : statusFilter === "rejected"
                ? ""
                : ""}
            </p>
            <span className="rounded-full border border-white/40 bg-white/20 px-3 py-1 text-sm">
              {requests.length}
            </span>
          </div>

          {loading ? <p className="text-sm text-white/80">جار التحميل...</p> : null}
          {error ? <p className="mb-3 text-sm text-red-200">{error}</p> : null}
          {!loading && requests.length === 0 ? (
            <p className="text-sm text-white/80">
              {statusFilter === "pending"
                ? "لا توجد طلبات معلقة حالياً."
                : statusFilter === "rejected"
                ? "لا توجد طلبات مرفوضة حالياً."
                : "لا توجد حسابات مقبولة خلال آخر 48 ساعة."}
            </p>
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
                  <input
                    className="rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-sm text-white"
                    value={String(item.email ?? "")}
                    onChange={(e) => updateRequestField(item.id, "email", e.target.value)}
                    placeholder="البريد الإلكتروني"
                  />
                  <select
                    className="rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-sm text-white"
                    value={item.role}
                    onChange={(e) => {
                      const nextRole = e.target.value;
                      updateRequestField(item.id, "role", nextRole);
                      if (["admin", "notes", "katamars"].includes(nextRole)) {
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
                    disabled={["admin", "notes", "katamars"].includes(item.role)}
                  >
                    <option value="" className="text-black">
                      {["admin", "notes", "katamars"].includes(item.role) ? "بدون فصل" : "اختر الفصل"}
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
                    placeholder="الباسورد المبدأي"
                  />
                </div>

                {statusFilter === "pending" ? (
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
                      onClick={() =>
                        setRejectOpenId((prev) => (prev === item.id ? null : item.id))
                      }
                      disabled={actioningId === item.id}
                      className="rounded-full bg-red-700 px-4 py-1 text-sm text-white"
                    >
                      رفض
                    </button>
                  </div>
                ) : null}

                {statusFilter === "pending" ? (
                  <div
                    className={`grid transition-all duration-200 ease-in-out ${
                      rejectOpenId === item.id
                        ? "mt-3 grid-rows-[1fr] opacity-100"
                        : "grid-rows-[0fr] opacity-0"
                    }`}
                  >
                    <div className="min-h-0 overflow-hidden">
                      <div className="rounded-xl border border-red-200/40 bg-red-500/10 p-3">
                        <textarea
                          className="w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm text-white outline-none"
                          rows={2}
                          placeholder="سبب الرفض (اختياري)"
                          value={rejectReasons[item.id] ?? ""}
                          onChange={(e) => updateRejectReason(item.id, e.target.value)}
                        />
                        <div className="mt-2 flex justify-end gap-2">
                          <button
                            type="button"
                            className="rounded-full border border-white/30 px-3 py-1 text-sm text-white"
                            onClick={() => setRejectOpenId(null)}
                          >
                            إلغاء
                          </button>
                          <button
                            type="button"
                            className="rounded-full bg-red-700 px-3 py-1 text-sm text-white"
                            disabled={actioningId === item.id}
                            onClick={() =>
                              processRequest(item.id, "reject", rejectReasons[item.id] ?? "")
                            }
                          >
                            تأكيد الرفض
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : statusFilter === "rejected" ? (
                  <div className="mt-3 space-y-2">
                    <div className="rounded-xl border border-red-200/40 bg-red-500/10 px-3 py-2 text-sm text-red-100">
                      سبب الرفض: {item.rejectReason?.trim() || "لم يتم إضافة سبب."}
                    </div>
                    <button
                      type="button"
                      onClick={() => deleteRequestRecord(item.id)}
                      disabled={actioningId === item.id}
                      className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-red-300/50 bg-red-500/15"
                      aria-label="حذف السجل"
                    >
                      <img src="/delete-2.png" alt="حذف" className="h-4 w-4 object-contain" />
                    </button>
                  </div>
                ) : (
                  <div className="mt-3 space-y-2">
                    <div className="rounded-xl border border-green-200/40 bg-green-500/10 px-3 py-2 text-sm text-green-100">
                      تم قبول الحساب: {item.reviewedAt ? new Date(item.reviewedAt).toLocaleString("ar-EG") : "-"}
                    </div>
                    <button
                      type="button"
                      onClick={() => deleteRequestRecord(item.id)}
                      disabled={actioningId === item.id}
                      className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-red-300/50 bg-red-500/15"
                      aria-label="حذف السجل"
                    >
                      <img src="/delete-2.png" alt="حذف" className="h-4 w-4 object-contain" />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
