"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type StoredUser = {
  role?: string;
  studentCode?: string;
  name?: string;
};

type HomeworkItem = {
  id: string;
  title?: string;
  subject?: string;
  description?: string;
  dueAt?: string;
  classIds?: string[];
  createdBy?: { name?: string };
  createdAt?: { _seconds?: number };
  submitted?: boolean;
  maxScore?: number;
};

const SUBJECTS = ["طقس", "اجبيه", "قطمارس", "الحان", "قبطي"];

function formatDateTime(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("ar-EG");
}

function isExpired(value?: string) {
  if (!value) return false;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  return Date.now() > date.getTime();
}

export default function HomeworkPage() {
  const router = useRouter();
  const [user, setUser] = useState<StoredUser | null>(null);
  const [role, setRole] = useState("");
  const [items, setItems] = useState<HomeworkItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [publishDate, setPublishDate] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [dueTime, setDueTime] = useState("");
  const [maxScore, setMaxScore] = useState("20");
  const [teacherClasses, setTeacherClasses] = useState<string[]>([]);
  const [selectedClasses, setSelectedClasses] = useState<string[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [confirmDeleteTitle, setConfirmDeleteTitle] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [closingId, setClosingId] = useState<string | null>(null);

  useEffect(() => {
    const stored = window.localStorage.getItem("dsms:user");
    if (!stored) {
      router.replace("/login");
      return;
    }
    try {
      const parsed = JSON.parse(stored) as StoredUser;
      setUser(parsed);
      const normalized = parsed.role === "nzam" ? "system" : parsed.role;
      const nextRole = String(normalized ?? "");
      if (!["teacher", "student", "parent"].includes(nextRole)) {
        router.replace(`/portal/${nextRole || "student"}`);
        return;
      }
      setRole(nextRole);
    } catch {
      router.replace("/login");
    }
  }, [router]);

  useEffect(() => {
    async function loadData() {
      if (!role) return;
      try {
        setLoading(true);
        setError(null);
        const res = await fetch("/api/homework");
        const json = await res.json();
        if (res.ok && json.ok) {
          setItems(json.data as HomeworkItem[]);
        }
        if (role === "teacher" && user?.studentCode) {
          const userRes = await fetch(`/api/users?code=${encodeURIComponent(user.studentCode)}`);
          const userJson = await userRes.json();
          if (userRes.ok && userJson.ok) {
            const classes = Array.isArray(userJson.data?.classes)
              ? (userJson.data.classes as string[])
              : [];
            setTeacherClasses(classes);
            if (!selectedClasses.length && classes.length) {
              setSelectedClasses([classes[0]]);
            }
          }
        }
      } catch {
        setError("تعذر تحميل الواجبات.");
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, [role, user?.studentCode, selectedClasses.length]);

  const canCreate = role === "teacher";

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!canCreate) return;
    setError(null);
    const maxScoreNumber = Number(maxScore);
    if (!title.trim() || !subject || !publishDate || !dueDate || !dueTime || selectedClasses.length === 0) {
      setError("برجاء إدخال العنوان والمادة وتاريخ النشر وموعد التسليم واختيار فصل واحد على الأقل.");
      return;
    }
    if (Number.isNaN(maxScoreNumber) || maxScoreNumber <= 0) {
      setError("من فضلك أدخل الدرجة القصوى بشكل صحيح.");
      return;
    }
    setSaving(true);
    try {
      const form = new FormData();
      form.append("title", title.trim());
      form.append("subject", subject);
      form.append("description", description.trim());
      form.append("publishDate", publishDate);
      form.append("dueAt", `${dueDate}T${dueTime}`);
      form.append("maxScore", String(maxScoreNumber));
      form.append("classIds", selectedClasses.join(","));
      if (file) form.append("file", file);
      const res = await fetch("/api/homework", { method: "POST", body: form });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(json?.message || "تعذر إنشاء الواجب.");
        return;
      }
      setItems((prev) => [json.data as HomeworkItem, ...prev]);
      setTitle("");
      setSubject("");
      setDescription("");
      setPublishDate("");
      setDueDate("");
      setDueTime("");
      setMaxScore("20");
      setFile(null);
    } catch {
      setError("تعذر إنشاء الواجب.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteHomework(mode: "all" | "me") {
    if (!confirmDeleteId) return;
    setDeleting(true);
    try {
      const action = mode === "all" ? "deleteall" : "hide";
      const res = await fetch(`/api/homework/${confirmDeleteId}?action=${action}`, {
        method: "DELETE",
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(json.message || "تعذر حذف الواجب.");
        return;
      }
      setItems((prev) => prev.filter((item) => item.id !== confirmDeleteId));
      setConfirmDeleteId(null);
      setConfirmDeleteTitle(null);
    } catch {
      setError("تعذر حذف الواجب.");
    } finally {
      setDeleting(false);
    }
  }

  async function handleCloseHomework(homeworkId: string) {
    setClosingId(homeworkId);
    setError(null);
    try {
      const res = await fetch(`/api/homework/${homeworkId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ closeNow: true }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(json?.message || "تعذر إغلاق الواجب.");
        return;
      }
      setItems((prev) =>
        prev.map((item) =>
          item.id === homeworkId ? { ...item, dueAt: new Date().toISOString() } : item
        )
      );
    } catch {
      setError("تعذر إغلاق الواجب.");
    } finally {
      setClosingId(null);
    }
  }


  const listTitle = useMemo(() => {
    if (role === "teacher") return "الواجبات التي قمت بإنشائها";
    if (role === "student" || role === "parent") return "واجباتك";
    return "الواجبات";
  }, [role]);

  return (
    <main className="min-h-screen px-6 pb-24 pt-10">
      <div className="mx-auto w-full max-w-5xl">
        <header className="mb-8 flex items-center justify-between">
          <h1 className="app-heading mt-2">الواجبات</h1>
          <Link
            href={role === "teacher" ? "/portal/teacher" : `/portal/${role || "student"}`}
            className="back-btn rounded-full border border-black/10 bg-white px-4 py-2 text-sm font-semibold text-[color:var(--ink)] shadow-sm"
          >
            رجوع
          </Link>
        </header>

        {canCreate ? (
          <form
            onSubmit={handleCreate}
            className="mb-6 rounded-3xl border border-white/20 bg-white/15 p-6 text-white shadow-[var(--shadow)] backdrop-blur-md"
          >
            <p className="text-sm text-white/90">إنشاء واجب جديد</p>
            <div className="mt-4 grid gap-3">
              <input
                className="rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-sm text-white placeholder:text-white/70"
                placeholder="عنوان الواجب"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
              <select
                className="rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-sm text-white"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
              >
                <option value="" className="text-black">
                  اختر المادة
                </option>
                {SUBJECTS.map((item) => (
                  <option key={item} value={item} className="text-black">
                    {item}
                  </option>
                ))}
              </select>
              <textarea
                className="min-h-[110px] rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-sm text-white placeholder:text-white/70"
                placeholder="تفاصيل الواجب (اختياري)"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
              <div className="grid gap-3 md:grid-cols-2">
                <label className="grid gap-2 text-xs text-white/80">
                  تاريخ نشر الواجب
                  <input
                    type="date"
                    className="rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-sm text-white"
                    value={publishDate}
                    onChange={(e) => setPublishDate(e.target.value)}
                  />
                </label>
                <label className="grid gap-2 text-xs text-white/80">
                  آخر موعد للتسليم (تاريخ)
                  <input
                    type="date"
                    className="rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-sm text-white"
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                  />
                </label>
                <label className="grid gap-2 text-xs text-white/80">
                  آخر موعد للتسليم (وقت)
                  <input
                    type="time"
                    className="rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-sm text-white"
                    value={dueTime}
                    onChange={(e) => setDueTime(e.target.value)}
                  />
                </label>
                <label className="grid gap-2 text-xs text-white/80">
                  الدرجة القصوى
                  <input
                    type="number"
                    min={1}
                    className="rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-sm text-white"
                    value={maxScore}
                    onChange={(e) => setMaxScore(e.target.value)}
                  />
                </label>
              </div>
              <div className="grid gap-2">
                <p className="text-xs text-white/80">اختر الفصول</p>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {teacherClasses.map((cls) => {
                    const active = selectedClasses.includes(cls);
                    return (
                      <label
                        key={cls}
                        className={`flex items-center gap-2 rounded-2xl border px-3 py-2 text-xs ${
                          active
                            ? "border-white/60 bg-white/25 text-white"
                            : "border-white/20 bg-white/10 text-white/80"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={active}
                          onChange={() =>
                            setSelectedClasses((prev) =>
                              prev.includes(cls) ? prev.filter((id) => id !== cls) : [...prev, cls]
                            )
                          }
                          className="h-4 w-4 accent-white"
                        />
                        <span>{cls}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
              <input
                type="file"
                className="rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-xs text-white"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
              {error ? <p className="text-xs text-red-200">{error}</p> : null}
              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-full bg-white px-5 py-2 text-sm font-semibold text-black disabled:opacity-60"
                >
                  {saving ? "جار الحفظ..." : "نشر الواجب"}
                </button>
              </div>
            </div>
          </form>
        ) : null}

        <div className="rounded-3xl border border-white/20 bg-white/15 p-6 text-white shadow-[var(--shadow)] backdrop-blur-md">
          <p className="text-sm text-white/90">{listTitle}</p>
          {loading ? <p className="mt-3 text-sm text-white/70">جار التحميل...</p> : null}
          {!loading && items.length === 0 ? (
            <p className="mt-3 text-sm text-white/70">لا توجد واجبات بعد.</p>
          ) : null}
          <div className="mt-4 grid gap-3">
            {items.map((item) => {
              const expired = isExpired(item.dueAt);
              const allowOpen = true;
              const submitted = Boolean(item.submitted);
              const cardClass =
                role === "student" || role === "parent"
                  ? submitted
                    ? "border-emerald-300/70 bg-emerald-500/15"
                    : expired
                      ? "border-red-300/70 bg-red-500/15"
                      : "border-orange-300/70 bg-orange-500/15"
                  : expired
                    ? "border-red-200/50 bg-red-500/10"
                    : "border-white/20 bg-white/10";
              return (
              <div
                key={item.id}
                className={`flex items-start justify-between gap-3 rounded-2xl border px-4 py-3 text-sm ${cardClass}`}
              >
                <div className="flex-1 text-right">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-white">{item.title || "واجب"}</p>
                    {isExpired(item.dueAt) ? (
                      <span className="rounded-full border border-red-200/60 bg-red-500/20 px-2 py-0.5 text-[10px] text-red-100">
                        منتهي
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1 text-[10px] text-white/70">
                    المادة: {item.subject || "-"}
                  </p>
                  <p className="mt-1 text-[10px] text-white/70">
                    التسليم: {formatDateTime(item.dueAt)}
                  </p>
                  <p className="mt-1 text-[10px] text-white/70">
                    الفصول: {Array.isArray(item.classIds) ? item.classIds.join(", ") : "-"}
                  </p>
                  {allowOpen ? (
                    <div className="mt-2 flex flex-wrap justify-end gap-2">
                      <Link
                        href={`/portal/homework/${item.id}`}
                        className="inline-flex w-fit rounded-full border border-white/30 px-3 py-1 text-[10px] text-white/90"
                      >
                        فتح الواجب
                      </Link>
                      {role === "teacher" && !expired ? (
                        <button
                          type="button"
                          onClick={() => handleCloseHomework(item.id)}
                          disabled={closingId === item.id}
                          className="inline-flex w-fit rounded-full border border-red-300/70 bg-red-500/15 px-3 py-1 text-[10px] text-red-100 disabled:opacity-60"
                        >
                          {closingId === item.id ? "جار الإغلاق..." : "إغلاق الواجب"}
                        </button>
                      ) : null}
                    </div>
                  ) : (
                    <p className="mt-2 text-[10px] text-red-100/90">انتهى موعد التسليم</p>
                  )}
                </div>
                {role === "teacher" ? (
                  <button
                    type="button"
                    onClick={() => {
                      setConfirmDeleteId(item.id);
                      setConfirmDeleteTitle(item.title || "واجب");
                    }}
                    className="rounded-full border border-white/40 bg-white/10 p-2"
                    title="حذف"
                  >
                    <img src="/delete.png" alt="حذف" className="h-5 w-5" />
                  </button>
                ) : null}
              </div>
            );
            })}
          </div>
        </div>
      </div>

      {confirmDeleteId ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-3xl bg-white p-6 text-center shadow-xl">
            <p className="text-lg font-semibold text-black">حذف الواجب</p>
            <p className="mt-2 text-sm text-black/70">
              {confirmDeleteTitle || "واجب"}
            </p>
            <div className="mt-4 grid gap-2">
              <button
                type="button"
                onClick={() => handleDeleteHomework("all")}
                disabled={deleting}
                className="rounded-full bg-red-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
              >
                حذف للكل
              </button>
              <button
                type="button"
                onClick={() => handleDeleteHomework("me")}
                disabled={deleting}
                className="rounded-full bg-gray-200 px-4 py-2 text-sm font-semibold text-black disabled:opacity-60"
              >
                حذف لدي
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirmDeleteId(null);
                  setConfirmDeleteTitle(null);
                }}
                className="rounded-full border border-black/10 bg-white px-4 py-2 text-sm text-black"
              >
                إلغاء
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}

