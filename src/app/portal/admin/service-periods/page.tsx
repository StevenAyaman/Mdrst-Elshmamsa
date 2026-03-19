"use client";

import Link from "next/link";
import BackButton from "@/app/back-button";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type StoredUser = { studentCode?: string; role?: string };

type PeriodItem = {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  active: boolean;
  term1Name: string;
  term2Name: string;
  activeTerm: "term1" | "term2";
  term1Start: string;
  term1End: string;
  term2Start: string;
  term2End: string;
};

export default function ServicePeriodsPage() {
  const router = useRouter();
  const [me, setMe] = useState<StoredUser | null>(null);
  const [periods, setPeriods] = useState<PeriodItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [active, setActive] = useState(true);
  const [term1Name, setTerm1Name] = useState("");
  const [term2Name, setTerm2Name] = useState("");
  const [activeTerm, setActiveTerm] = useState<"term1" | "term2">("term1");
  const [term1Start, setTerm1Start] = useState("");
  const [term1End, setTerm1End] = useState("");
  const [term2Start, setTerm2Start] = useState("");
  const [term2End, setTerm2End] = useState("");
  const [creating, setCreating] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    const stored = window.localStorage.getItem("dsms:user");
    if (!stored) {
      router.replace("/login");
      return;
    }
    try {
      const user = JSON.parse(stored) as StoredUser;
      const role = user.role === "nzam" ? "system" : user.role;
      if (role !== "admin") {
        router.replace(`/portal/${role ?? "student"}`);
        return;
      }
      setMe(user);
    } catch {
      router.replace("/login");
    }
  }, [router]);

  useEffect(() => {
    async function loadPeriods() {
      if (!me?.studentCode || !me?.role) return;
      try {
        setLoading(true);
        setError(null);
        const query = new URLSearchParams({
          actorCode: me.studentCode,
          actorRole: me.role,
          status: "all",
        });
        const res = await fetch(`/api/service-periods?${query.toString()}`);
        const json = await res.json();
        if (!res.ok || !json.ok) {
          setError(json?.message || "تعذر تحميل الفترات.");
          return;
        }
        setPeriods(json.data as PeriodItem[]);
      } catch {
        setError("تعذر تحميل الفترات.");
      } finally {
        setLoading(false);
      }
    }
    loadPeriods();
  }, [me?.studentCode, me?.role]);

  async function createPeriod(e: React.FormEvent) {
    e.preventDefault();
    if (!me?.studentCode || !me?.role) return;
    if (
      !name.trim() ||
      !term1Name.trim() ||
      !term2Name.trim() ||
      !term1Start ||
      !term1End ||
      !term2Start ||
      !term2End
    ) {
      setError("اسم الفترة وأسماء/تواريخ التيرمين مطلوبة.");
      return;
    }

    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/service-periods", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          actorCode: me.studentCode,
          actorRole: me.role,
          name: name.trim(),
          startDate: term1Start,
          endDate: term2End,
          active,
          term1Name: term1Name.trim(),
          term2Name: term2Name.trim(),
          activeTerm,
          term1Start,
          term1End,
          term2Start,
          term2End,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(json?.message || "تعذر إضافة الفترة.");
        return;
      }
      const created = json.data as PeriodItem;
      setPeriods((prev) => [created, ...prev.map((item) => (active ? { ...item, active: false } : item))]);
      setName("");
      setActive(true);
      setTerm1Name("");
      setTerm2Name("");
      setActiveTerm("term1");
      setTerm1Start("");
      setTerm1End("");
      setTerm2Start("");
      setTerm2End("");
    } catch {
      setError("تعذر إضافة الفترة.");
    } finally {
      setCreating(false);
    }
  }

  function updateLocalField(id: string, key: keyof PeriodItem, value: string | boolean) {
    setPeriods((prev) =>
      prev.map((item) => {
        if (item.id !== id) return item;
        const next = { ...item, [key]: value } as PeriodItem;
        if (key === "term1Start" && typeof value === "string") {
          next.startDate = value;
        }
        if (key === "term2End" && typeof value === "string") {
          next.endDate = value;
        }
        return next;
      })
    );
  }

  async function savePeriod(id: string) {
    if (!me?.studentCode || !me?.role) return;
    const period = periods.find((p) => p.id === id);
    if (!period) return;

    setSavingId(id);
    setError(null);
    try {
      const res = await fetch("/api/service-periods", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          actorCode: me.studentCode,
          actorRole: me.role,
          id: period.id,
          name: period.name,
          startDate: period.term1Start,
          endDate: period.term2End,
          active: period.active,
          term1Name: period.term1Name,
          term2Name: period.term2Name,
          activeTerm: period.activeTerm,
          term1Start: period.term1Start,
          term1End: period.term1End,
          term2Start: period.term2Start,
          term2End: period.term2End,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(json?.message || "تعذر حفظ الفترة.");
        return;
      }
      if (period.active) {
        setPeriods((prev) => prev.map((item) => (item.id === id ? item : { ...item, active: false })));
      }
    } catch {
      setError("تعذر حفظ الفترة.");
    } finally {
      setSavingId(null);
    }
  }

  async function deletePeriod(id: string) {
    if (!me?.studentCode || !me?.role) return;
    setDeletingId(id);
    setError(null);
    try {
      const res = await fetch("/api/service-periods", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          actorCode: me.studentCode,
          actorRole: me.role,
          id,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(json?.message || "تعذر حذف الفترة.");
        return;
      }
      setPeriods((prev) => prev.filter((item) => item.id !== id));
      setConfirmDeleteId(null);
    } catch {
      setError("تعذر حذف الفترة.");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <main className="min-h-screen px-6 pb-24 pt-10">
      <div className="mx-auto w-full max-w-5xl">
        <header className="mb-8 flex items-center justify-between">
          <h1 className="app-heading mt-2">فترات الخدمة</h1>
          <BackButton
            className="back-btn rounded-full border border-black/10 bg-white px-4 py-2 text-sm font-semibold text-[color:var(--ink)] shadow-sm"
            fallbackHref={"/portal/admin/administration"}
            />
        </header>

        <section className="mb-6 rounded-3xl border border-white/20 bg-white/15 p-6 text-white shadow-[var(--shadow)] backdrop-blur-md">
          <p className="mb-3 text-lg font-semibold">إضافة فترة جديدة</p>
          <form onSubmit={createPeriod} className="grid gap-3 sm:grid-cols-2">
            <input
              className="rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-sm text-white"
              placeholder="اسم الفترة"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={active}
                onChange={(e) => setActive(e.target.checked)}
              />
              تفعيل هذه الفترة
            </label>
            <input
              className="rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-sm text-white"
              placeholder="اسم التيرم الأول"
              value={term1Name}
              onChange={(e) => setTerm1Name(e.target.value)}
            />
            <input
              className="rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-sm text-white"
              placeholder="اسم التيرم الثاني"
              value={term2Name}
              onChange={(e) => setTerm2Name(e.target.value)}
            />
            <label className="text-sm">
              التيرم الفعّال
              <select
                value={activeTerm}
                onChange={(e) => setActiveTerm(e.target.value === "term2" ? "term2" : "term1")}
                className="mt-1 w-full rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-sm text-white"
              >
                <option value="term1" className="text-black">
                  التيرم الأول
                </option>
                <option value="term2" className="text-black">
                  التيرم الثاني
                </option>
              </select>
            </label>
            <label className="text-sm">
              تاريخ بداية التيرم الأول
              <input
                type="date"
                className="mt-1 w-full rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-sm text-white"
                value={term1Start}
                onChange={(e) => setTerm1Start(e.target.value)}
              />
            </label>
            <label className="text-sm">
              تاريخ نهاية التيرم الأول
              <input
                type="date"
                className="mt-1 w-full rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-sm text-white"
                value={term1End}
                onChange={(e) => setTerm1End(e.target.value)}
              />
            </label>
            <label className="text-sm">
              تاريخ بداية التيرم الثاني
              <input
                type="date"
                className="mt-1 w-full rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-sm text-white"
                value={term2Start}
                onChange={(e) => setTerm2Start(e.target.value)}
              />
            </label>
            <label className="text-sm">
              تاريخ نهاية التيرم الثاني
              <input
                type="date"
                className="mt-1 w-full rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-sm text-white"
                value={term2End}
                onChange={(e) => setTerm2End(e.target.value)}
              />
            </label>
            <button
              type="submit"
              disabled={creating}
              className="w-fit rounded-full bg-[color:var(--accent-2)] px-5 py-2 text-sm font-semibold text-white"
            >
              {creating ? "جار الإضافة..." : "إضافة الفترة"}
            </button>
          </form>
          {error ? <p className="mt-3 text-sm text-red-200">{error}</p> : null}
        </section>

        <section className="rounded-3xl border border-white/20 bg-white/15 p-6 text-white shadow-[var(--shadow)] backdrop-blur-md">
          <p className="mb-3 text-lg font-semibold">الفترات الحالية</p>
          {loading ? <p className="text-sm text-white/80">جار التحميل...</p> : null}
          {!loading && periods.length === 0 ? (
            <p className="text-sm text-white/80">لا توجد فترات بعد.</p>
          ) : null}
          <div className="grid gap-3">
            {periods.map((period) => (
              <div
                key={period.id}
                className="rounded-2xl border border-white/20 bg-white/10 p-4"
              >
                <div className="mb-3 flex items-center justify-between">
                  <span className="text-sm text-white/70">معرّف الفترة: {period.id}</span>
                  <button
                    type="button"
                    onClick={() => setConfirmDeleteId(period.id)}
                    className="flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs text-white/90 hover:bg-white/20"
                  >
                    <img src="/delete-2.png" alt="" className="h-4 w-4" />
                    حذف الفترة
                  </button>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <input
                    className="rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-sm text-white"
                    value={period.name}
                    onChange={(e) => updateLocalField(period.id, "name", e.target.value)}
                  />
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={period.active}
                      onChange={(e) => updateLocalField(period.id, "active", e.target.checked)}
                    />
                    مفعلة
                  </label>
                  <input
                    className="rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-sm text-white"
                    value={period.term1Name}
                    onChange={(e) => updateLocalField(period.id, "term1Name", e.target.value)}
                    placeholder="اسم التيرم الأول"
                  />
                  <input
                    className="rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-sm text-white"
                    value={period.term2Name}
                    onChange={(e) => updateLocalField(period.id, "term2Name", e.target.value)}
                    placeholder="اسم التيرم الثاني"
                  />
                  <label className="text-sm">
                    التيرم الفعّال
                    <select
                      value={period.activeTerm}
                      onChange={(e) => updateLocalField(period.id, "activeTerm", e.target.value === "term2" ? "term2" : "term1")}
                      className="mt-1 w-full rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-sm text-white"
                    >
                      <option value="term1" className="text-black">
                        التيرم الأول
                      </option>
                      <option value="term2" className="text-black">
                        التيرم الثاني
                      </option>
                    </select>
                  </label>
                  <label className="text-sm">
                    تاريخ بداية التيرم الأول
                    <input
                      type="date"
                      className="mt-1 w-full rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-sm text-white"
                      value={period.term1Start}
                      onChange={(e) => updateLocalField(period.id, "term1Start", e.target.value)}
                    />
                  </label>
                  <label className="text-sm">
                    تاريخ نهاية التيرم الأول
                    <input
                      type="date"
                      className="mt-1 w-full rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-sm text-white"
                      value={period.term1End}
                      onChange={(e) => updateLocalField(period.id, "term1End", e.target.value)}
                    />
                  </label>
                  <label className="text-sm">
                    تاريخ بداية التيرم الثاني
                    <input
                      type="date"
                      className="mt-1 w-full rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-sm text-white"
                      value={period.term2Start}
                      onChange={(e) => updateLocalField(period.id, "term2Start", e.target.value)}
                    />
                  </label>
                  <label className="text-sm">
                    تاريخ نهاية التيرم الثاني
                    <input
                      type="date"
                      className="mt-1 w-full rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-sm text-white"
                      value={period.term2End}
                      onChange={(e) => updateLocalField(period.id, "term2End", e.target.value)}
                    />
                  </label>
                </div>
                <button
                  type="button"
                  onClick={() => savePeriod(period.id)}
                  disabled={savingId === period.id}
                  className="mt-3 rounded-full bg-blue-600 px-4 py-1 text-sm text-white"
                >
                  {savingId === period.id ? "..." : "حفظ"}
                </button>
              </div>
            ))}
          </div>
        </section>
      </div>

      {confirmDeleteId ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="w-full max-w-md rounded-3xl border border-white/20 bg-white/10 p-6 text-white shadow-[var(--shadow)] backdrop-blur-md">
            <h2 className="mb-3 text-lg font-semibold">تأكيد حذف الفترة</h2>
            <p className="text-sm text-white/80">
              سيتم حذف الفترة وكل بياناتها المرتبطة بها (الحضور، الواجبات، تقارير الحصص وغيرها). لا يمكن التراجع
              عن هذا الإجراء.
            </p>
            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmDeleteId(null)}
                className="rounded-full border border-white/30 bg-white/10 px-4 py-2 text-sm text-white"
              >
                إلغاء
              </button>
              <button
                type="button"
                onClick={() => deletePeriod(confirmDeleteId)}
                disabled={deletingId === confirmDeleteId}
                className="rounded-full bg-red-600 px-4 py-2 text-sm font-semibold text-white"
              >
                {deletingId === confirmDeleteId ? "جار الحذف..." : "حذف"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}

