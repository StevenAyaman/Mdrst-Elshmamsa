"use client";

import Link from "next/link";
import BackButton from "@/app/back-button";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type StoredUser = {
  role?: string;
  studentCode?: string;
};

type ComplaintItem = {
  id: string;
  studentCode: string;
  studentName: string;
  classId: string;
  message: string;
  replyMessage?: string;
  repliedAt?: string;
  repliedByName?: string;
  createdByCode?: string;
  createdByName?: string;
  createdByRole?: string;
  seen: boolean;
  createdAt: string;
  seenAt?: string;
};

type ComplaintsResponse = {
  ok: boolean;
  data?: ComplaintItem[];
  meta?: {
    classes?: string[];
    studentsByClass?: Record<string, Array<{ code: string; name: string }>>;
  };
  message?: string;
};

export default function ComplaintsPage() {
  const router = useRouter();
  const [role, setRole] = useState<"admin" | "system" | "teacher" | "notes" | "">("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<ComplaintItem[]>([]);

  const [classes, setClasses] = useState<string[]>([]);
  const [studentsByClass, setStudentsByClass] = useState<
    Record<string, Array<{ code: string; name: string }>>
  >({});
  const [selectedClass, setSelectedClass] = useState("");
  const [selectedStudentCode, setSelectedStudentCode] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [submitMessage, setSubmitMessage] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ComplaintItem | null>(null);
  const [deleteMode, setDeleteMode] = useState<"me" | "all">("me");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [replyingId, setReplyingId] = useState<string | null>(null);
  const [replyError, setReplyError] = useState<string | null>(null);

  useEffect(() => {
    const stored = window.localStorage.getItem("dsms:user");
    if (!stored) {
      router.replace("/login");
      return;
    }
    try {
      const user = JSON.parse(stored) as StoredUser;
      const normalized = user.role === "nzam" ? "system" : String(user.role ?? "");
      if (!["admin", "system", "teacher", "notes"].includes(normalized)) {
        router.replace(`/portal/${normalized || "student"}`);
        return;
      }
      setRole(normalized as "admin" | "system" | "teacher" | "notes");
    } catch {
      router.replace("/login");
    }
  }, [router]);

  async function loadData() {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch("/api/complaints");
      const json = (await res.json()) as ComplaintsResponse;
      if (!res.ok || !json.ok) {
        setError(json.message || "تعذر تحميل الشكاوى.");
        return;
      }
      setItems(json.data ?? []);
      const loadedClasses = json.meta?.classes ?? [];
      const loadedStudentsByClass = json.meta?.studentsByClass ?? {};
      setClasses(loadedClasses);
      setStudentsByClass(loadedStudentsByClass);
      if (loadedClasses.length && !selectedClass) {
        setSelectedClass(loadedClasses[0]);
      }
    } catch {
      setError("تعذر تحميل الشكاوى.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!role) return;
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role]);

  const currentStudents = useMemo(() => {
    return selectedClass ? studentsByClass[selectedClass] ?? [] : [];
  }, [selectedClass, studentsByClass]);

  async function submitComplaint(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setSubmitMessage(null);

    if (!selectedStudentCode.trim() || !message.trim()) {
      setSubmitMessage("اختر الطالب واكتب الملاحظة.");
      return;
    }

    try {
      setSaving(true);
      const res = await fetch("/api/complaints", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          studentCode: selectedStudentCode.trim(),
          message: message.trim(),
        }),
      });
      const json = (await res.json()) as { ok: boolean; message?: string };
      if (!res.ok || !json.ok) {
        setSubmitMessage(json.message || "تعذر إرسال الملاحظة.");
        return;
      }

      setMessage("");
      setSubmitMessage("تم إرسال الملاحظة.");
      await loadData();
    } catch {
      setSubmitMessage("تعذر إرسال الملاحظة.");
    } finally {
      setSaving(false);
    }
  }

  async function markSeen(id: string) {
    try {
      const res = await fetch("/api/complaints", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, seen: true }),
      });
      const json = (await res.json()) as { ok: boolean; message?: string };
      if (!res.ok || !json.ok) {
        setError(json.message || "تعذر تحديث الملاحظة.");
        return;
      }
      setItems((prev) => prev.map((item) => (item.id === id ? { ...item, seen: true } : item)));
    } catch {
      setError("تعذر تحديث الملاحظة.");
    }
  }

  async function handleDelete() {
    if (!deleteTarget || !role) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const res = await fetch("/api/complaints", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: deleteTarget.id, mode: deleteMode }),
      });
      const json = (await res.json()) as { ok: boolean; message?: string };
      if (!res.ok || !json.ok) {
        setDeleteError(json.message || "تعذر الحذف.");
        return;
      }
      setItems((prev) => prev.filter((item) => item.id !== deleteTarget.id));
      setDeleteTarget(null);
    } catch {
      setDeleteError("تعذر الحذف.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <main className="min-h-screen px-6 pb-24 pt-10">
      <div className="mx-auto w-full max-w-5xl">
        <header className="mb-8 flex items-center justify-between">
          <h1 className="app-heading mt-2">ملاحظات سلوك</h1>
          <BackButton
            className="back-btn rounded-full border border-black/10 bg-white px-4 py-2 text-sm font-semibold text-[color:var(--ink)] shadow-sm"
            fallbackHref={
              role === "admin"
                ? "/portal/admin/administration"
                : role === "notes"
                  ? "/portal/notes"
                  : `/portal/${role || "system"}`
            }
            />
        </header>

        {loading ? <p className="text-sm text-white/80">جار التحميل...</p> : null}
        {error ? <p className="text-sm text-red-200">{error}</p> : null}

        {!loading && (role === "system" || role === "teacher" || role === "admin") ? (
          <section className="mb-6 rounded-3xl border border-white/20 bg-white/15 p-6 text-white shadow-[var(--shadow)] backdrop-blur-md">
            <p className="text-xl font-semibold">تقديم ملاحظة سلوك</p>
            <form className="mt-4 grid gap-3" onSubmit={submitComplaint}>
              <select
                className="rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-sm text-white"
                value={selectedClass}
                onChange={(e) => {
                  setSelectedClass(e.target.value);
                  setSelectedStudentCode("");
                }}
              >
                <option value="" className="text-black">
                  اختر الفصل
                </option>
                {classes.map((classId) => (
                  <option key={classId} value={classId} className="text-black">
                    {classId}
                  </option>
                ))}
              </select>

              <select
                className="rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-sm text-white"
                value={selectedStudentCode}
                onChange={(e) => setSelectedStudentCode(e.target.value)}
              >
                <option value="" className="text-black">
                  اختر الطالب
                </option>
                {currentStudents.map((student) => (
                  <option key={student.code} value={student.code} className="text-black">
                    {student.name} - {student.code}
                  </option>
                ))}
              </select>

              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="اكتب الملاحظة"
                rows={4}
                className="rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-sm text-white placeholder:text-white/70"
              />

              {submitMessage ? <p className="text-sm text-white">{submitMessage}</p> : null}
              <button
                type="submit"
                disabled={saving}
                className="w-fit rounded-full bg-white px-5 py-2 text-sm font-semibold text-black disabled:opacity-60"
              >
                {saving ? "جار الإرسال..." : "إرسال الملاحظة"}
              </button>
            </form>
          </section>
        ) : null}

        {!loading ? (
          <section className="rounded-3xl border border-white/20 bg-white/15 p-6 text-white shadow-[var(--shadow)] backdrop-blur-md">
            <p className="text-xl font-semibold">
              {role === "admin" || role === "notes" ? "كل الملاحظات" : "كل الملاحظات :"}
            </p>
            <div className="mt-4 grid gap-3">
              {items.length === 0 ? (
                <p className="text-sm text-white/80">لا توجد ملاحظات حالياً.</p>
              ) : (
                items.map((item) => (
                  <div key={item.id} className="rounded-2xl border border-white/20 bg-white/10 p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-sm">
                          الطالب: {item.studentName || "-"} ({item.studentCode})
                        </p>
                        <p className="text-sm text-white/85">الفصل: {item.classId || "-"}</p>
                        {role === "admin" || role === "notes" ? (
                          <p className="text-sm text-white/85">
                            بواسطة: {item.createdByName || "-"} ({item.createdByRole || "-"})
                          </p>
                        ) : null}
                      </div>
                      <span
                        className={`rounded-full px-3 py-1 text-xs font-semibold ${
                          item.seen ? "bg-green-600 text-white" : "bg-red-600 text-white"
                        }`}
                      >
                        {item.seen ? "Seen" : "Pending"}
                      </span>
                    </div>

                    <p className="mt-3 whitespace-pre-wrap text-sm">{item.message}</p>
                    <p className="mt-2 text-xs text-white/75">{item.createdAt}</p>

                    <div className="relative mt-3 flex flex-wrap items-center gap-2">
                      {(role === "admin" || role === "notes") && !item.seen ? (
                        <button
                          type="button"
                          onClick={() => markSeen(item.id)}
                          className="rounded-full bg-white px-4 py-2 text-xs font-semibold text-black"
                        >
                          تعليم كـ Seen
                        </button>
                      ) : null}
                      {role && role !== "notes" ? (
                        <button
                          type="button"
                          onClick={() => {
                            setDeleteMode(item.seen ? "me" : "all");
                            setDeleteTarget(item);
                          }}
                          className="absolute bottom-2 left-2 flex h-7 w-7 items-center justify-center"
                          aria-label="حذف الملاحظة"
                        >
                          <img src="/delete-white.png" alt="" className="h-5 w-5" />
                        </button>
                      ) : null}
                    </div>

                    {role === "notes" ? (
                      <div className="mt-4 rounded-2xl border border-white/20 bg-white/10 p-3">
                        <p className="text-xs text-white/80">رد الملاحظات</p>
                        {item.replyMessage ? (
                          <>
                            <p className="mt-2 text-sm text-white">{item.replyMessage}</p>
                            {item.repliedAt ? (
                              <p className="mt-1 text-[10px] text-white/70">
                                {item.repliedByName ? `بواسطة ${item.repliedByName} - ` : ""}
                                {item.repliedAt}
                              </p>
                            ) : null}
                          </>
                        ) : (
                          <div className="mt-2 grid gap-2">
                            <textarea
                              rows={3}
                              className="rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-xs text-white placeholder:text-white/70"
                              placeholder="اكتب الرد"
                              value={replyDrafts[item.id] ?? ""}
                              onChange={(e) =>
                                setReplyDrafts((prev) => ({ ...prev, [item.id]: e.target.value }))
                              }
                            />
                            {replyError && replyingId === item.id ? (
                              <p className="text-xs text-red-200">{replyError}</p>
                            ) : null}
                            <button
                              type="button"
                              disabled={replyingId === item.id}
                              onClick={async () => {
                                const draft = (replyDrafts[item.id] ?? "").trim();
                                if (!draft) {
                                  setReplyError("اكتب الرد أولاً.");
                                  setReplyingId(item.id);
                                  return;
                                }
                                try {
                                  setReplyError(null);
                                  setReplyingId(item.id);
                                  const res = await fetch("/api/complaints", {
                                    method: "PATCH",
                                    headers: { "Content-Type": "application/json" },
                                    body: JSON.stringify({ id: item.id, replyMessage: draft, seen: true }),
                                  });
                                  const json = (await res.json()) as { ok: boolean; message?: string };
                                  if (!res.ok || !json.ok) {
                                    setReplyError(json.message || "تعذر إرسال الرد.");
                                    return;
                                  }
                                  setItems((prev) =>
                                    prev.map((entry) =>
                                      entry.id === item.id
                                        ? {
                                            ...entry,
                                            replyMessage: draft,
                                            repliedAt: new Date().toISOString(),
                                            repliedByName: "تم الرد",
                                            seen: true,
                                          }
                                        : entry
                                    )
                                  );
                                } catch {
                                  setReplyError("تعذر إرسال الرد.");
                                } finally {
                                  setReplyingId(null);
                                }
                              }}
                              className="w-fit rounded-full bg-white px-4 py-1.5 text-xs font-semibold text-black disabled:opacity-60"
                            >
                              {replyingId === item.id ? "جارٍ الإرسال..." : "إرسال الرد"}
                            </button>
                          </div>
                        )}
                      </div>
                    ) : null}
                  </div>
                ))
              )}
            </div>
          </section>
        ) : null}
      </div>

      {deleteTarget ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 menu-backdrop-anim">
          <div className="w-full max-w-sm rounded-3xl border border-white/20 bg-white p-6 text-[color:var(--ink)] shadow-2xl menu-panel-anim">
            <p className="text-lg font-bold">حذف الملاحظة</p>
            <p className="mt-2 text-sm text-[color:var(--muted)]">
              اختر طريقة الحذف.
            </p>
            <div className="mt-4 grid gap-2">
              {role === "admin" ? (
                <button
                  type="button"
                  onClick={() => setDeleteMode("me")}
                  className="rounded-full border border-black/10 px-4 py-2 text-sm font-semibold"
                >
                  حذف لدي
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => setDeleteMode("me")}
                    className={`rounded-full border px-4 py-2 text-sm font-semibold ${
                      deleteMode === "me" ? "border-black/30 bg-black/5" : "border-black/10"
                    }`}
                  >
                    حذف لدي
                  </button>
                  {!deleteTarget.seen ? (
                    <button
                      type="button"
                      onClick={() => setDeleteMode("all")}
                      className={`rounded-full border px-4 py-2 text-sm font-semibold ${
                        deleteMode === "all" ? "border-black/30 bg-black/5" : "border-black/10"
                      }`}
                    >
                      حذف للجميع
                    </button>
                  ) : null}
                </>
              )}
              {deleteError ? <p className="text-xs text-red-600">{deleteError}</p> : null}
            </div>
            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="rounded-full border border-black/10 px-4 py-2 text-sm font-semibold"
              >
                إلغاء
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleting}
                className="rounded-full bg-red-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
              >
                {deleting ? "جارٍ الحذف..." : "حذف"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
