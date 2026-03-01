"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type StoredUser = { studentCode?: string; role?: string };

type PeriodItem = {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  active: boolean;
};

export default function ServicePeriodsPage() {
  const router = useRouter();
  const [me, setMe] = useState<StoredUser | null>(null);
  const [periods, setPeriods] = useState<PeriodItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [active, setActive] = useState(true);
  const [creating, setCreating] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);

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
    if (!name.trim() || !startDate || !endDate) {
      setError("اسم الفترة وتواريخ البداية والنهاية مطلوبة.");
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
          startDate,
          endDate,
          active,
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
      setStartDate("");
      setEndDate("");
      setActive(true);
    } catch {
      setError("تعذر إضافة الفترة.");
    } finally {
      setCreating(false);
    }
  }

  function updateLocalField(id: string, key: keyof PeriodItem, value: string | boolean) {
    setPeriods((prev) =>
      prev.map((item) => (item.id === id ? { ...item, [key]: value } : item))
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
          startDate: period.startDate,
          endDate: period.endDate,
          active: period.active,
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

  return (
    <main className="min-h-screen px-6 pb-24 pt-10">
      <div className="mx-auto w-full max-w-5xl">
        <header className="mb-8 flex items-center justify-between">
          <h1 className="app-heading mt-2">فترات الخدمة</h1>
          <Link
            href="/portal/admin/administration"
            className="back-btn rounded-full border border-black/10 bg-white px-4 py-2 text-sm font-semibold text-[color:var(--ink)] shadow-sm"
          >
            رجوع
          </Link>
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
              type="date"
              className="rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-sm text-white"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
            <input
              type="date"
              className="rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-sm text-white"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
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
                    type="date"
                    className="rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-sm text-white"
                    value={period.startDate}
                    onChange={(e) => updateLocalField(period.id, "startDate", e.target.value)}
                  />
                  <input
                    type="date"
                    className="rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-sm text-white"
                    value={period.endDate}
                    onChange={(e) => updateLocalField(period.id, "endDate", e.target.value)}
                  />
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
    </main>
  );
}

