"use client";

import Link from "next/link";
import BackButton from "@/app/back-button";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type StoredUser = { role?: string; studentCode?: string };

type Attachment = {
  fileUrl: string;
  fileName?: string;
  mimeType?: string;
};

type LessonReport = {
  id: string;
  title?: string;
  body?: string;
  subject?: string;
  classId?: string;
  lessonDate?: string;
  attachments?: Attachment[];
  createdBy?: { name?: string; code?: string };
};

const SUBJECTS = ["طقس", "اجبيه", "قطمارس", "الحان", "قبطي"];
type GroupedReport = {
  classId: string;
  lessonDate: string;
  count: number;
  subjects: string[];
  attachments: Attachment[];
};
type GroupedDate = {
  lessonDate: string;
  reports: LessonReport[];
  classIds: string[];
  attachments: Attachment[];
};

function formatDate(value?: string) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("ar-EG");
}

export default function LessonReportsPage() {
  const router = useRouter();
  const [role, setRole] = useState<string>("");
  const [userCode, setUserCode] = useState<string>("");
  const [reports, setReports] = useState<LessonReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterDate, setFilterDate] = useState("");

  const [teacherClasses, setTeacherClasses] = useState<string[]>([]);
  const [body, setBody] = useState("");
  const [subject, setSubject] = useState("");
  const [classId, setClassId] = useState("");
  const [lessonDate, setLessonDate] = useState("");
  const [files, setFiles] = useState<FileList | null>(null);
  const [saving, setSaving] = useState(false);
  const [menuReportId, setMenuReportId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editBody, setEditBody] = useState("");
  const [editSubject, setEditSubject] = useState("");
  const [editClassId, setEditClassId] = useState("");
  const [editLessonDate, setEditLessonDate] = useState("");
  const [editSaving, setEditSaving] = useState(false);

  const canCreate = role === "teacher";
  const isViewerOnly = role === "student" || role === "parent";

  useEffect(() => {
    const raw = window.localStorage.getItem("dsms:user");
    if (!raw) {
      router.replace("/login");
      return;
    }
    try {
      const parsed = JSON.parse(raw) as StoredUser;
      const normalizedRole = parsed.role === "nzam" ? "system" : String(parsed.role ?? "");
      if (!["teacher", "student", "parent", "admin"].includes(normalizedRole)) {
        router.replace(`/portal/${normalizedRole || "student"}`);
        return;
      }
      setRole(normalizedRole);
      setUserCode(String(parsed.studentCode ?? ""));
    } catch {
      router.replace("/login");
    }
  }, [router]);

  useEffect(() => {
    async function loadReports() {
      if (!role) return;
      setLoading(true);
      setError(null);
      try {
        const query = new URLSearchParams();
        if (filterDate) query.set("lessonDate", filterDate);
        const res = await fetch(`/api/lesson-reports${query.toString() ? `?${query.toString()}` : ""}`);
        const json = await res.json();
        if (!res.ok || !json.ok) {
          setError(json?.message || "تعذر تحميل تقارير الحصص.");
          setReports([]);
          return;
        }
        setReports((json.data as LessonReport[]) ?? []);
      } catch {
        setError("تعذر تحميل تقارير الحصص.");
        setReports([]);
      } finally {
        setLoading(false);
      }
    }
    loadReports();
  }, [filterDate, role]);

  useEffect(() => {
    async function loadTeacherClasses() {
      if (!canCreate || !userCode) return;
      try {
        const res = await fetch(`/api/users?code=${encodeURIComponent(userCode)}`);
        const json = await res.json();
        if (!res.ok || !json.ok) return;
        const classes = Array.isArray(json.data?.classes)
          ? (json.data.classes as string[]).map((item) => String(item).trim()).filter(Boolean)
          : [];
        setTeacherClasses(classes);
        if (!classId && classes.length) setClassId(classes[0]);
      } catch {
        // ignore
      }
    }
    loadTeacherClasses();
  }, [canCreate, classId, userCode]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!canCreate) return;
    if (!subject.trim() || !classId.trim() || !lessonDate.trim() || !body.trim()) {
      setError("اختر المادة، الفصل، وتاريخ الحصة، واكتب تفاصيل الحصة.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("body", body.trim());
      form.append("subject", subject.trim());
      form.append("classId", classId.trim());
      form.append("lessonDate", lessonDate.trim());
      if (files) {
        Array.from(files).forEach((file) => form.append("files", file));
      }
      const res = await fetch("/api/lesson-reports", {
        method: "POST",
        body: form,
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(json?.message || "تعذر حفظ التقرير.");
        return;
      }
      setReports((prev) => [json.data as LessonReport, ...prev]);
      setBody("");
      setSubject("");
      setLessonDate("");
      setFiles(null);
      const fileInput = document.getElementById("lesson-report-files") as HTMLInputElement | null;
      if (fileInput) fileInput.value = "";
    } catch {
      setError("تعذر حفظ التقرير.");
    } finally {
      setSaving(false);
    }
  }

  const backHref = useMemo(() => `/portal/${role || "student"}`, [role]);
  const groupedReports = useMemo<GroupedReport[]>(() => {
    const isImageAttachment = (att: Attachment) =>
      String(att.mimeType ?? "").toLowerCase().startsWith("image/") ||
      /\.(png|jpe?g|webp|gif|bmp)$/i.test(String(att.fileName ?? att.fileUrl ?? ""));

    const map = new Map<string, GroupedReport>();
    for (const report of reports) {
      const classId = String(report.classId ?? "").trim().toUpperCase();
      const lessonDate = String(report.lessonDate ?? "").trim();
      if (!classId || !lessonDate) continue;
      const key = `${classId}__${lessonDate}`;
      const existing = map.get(key);
      const subject = String(report.subject ?? "").trim();
      const reportNonImageAttachments = Array.isArray(report.attachments)
        ? report.attachments.filter((att) => !isImageAttachment(att))
        : [];
      if (!existing) {
        map.set(key, {
          classId,
          lessonDate,
          count: 1,
          subjects: subject ? [subject] : [],
          attachments: reportNonImageAttachments,
        });
      } else {
        existing.count += 1;
        if (subject && !existing.subjects.includes(subject)) existing.subjects.push(subject);
        for (const att of reportNonImageAttachments) {
          if (!existing.attachments.some((current) => current.fileUrl === att.fileUrl)) {
            existing.attachments.push(att);
          }
        }
      }
    }
    return Array.from(map.values()).sort((a, b) => b.lessonDate.localeCompare(a.lessonDate));
  }, [reports]);

  const groupedByDate = useMemo<GroupedDate[]>(() => {
    const isImageAttachment = (att: Attachment) =>
      String(att.mimeType ?? "").toLowerCase().startsWith("image/") ||
      /\.(png|jpe?g|webp|gif|bmp)$/i.test(String(att.fileName ?? att.fileUrl ?? ""));

    const map = new Map<string, GroupedDate>();
    for (const report of reports) {
      const lessonDate = String(report.lessonDate ?? "").trim();
      if (!lessonDate) continue;
      const classId = String(report.classId ?? "").trim().toUpperCase();
      const found = map.get(lessonDate);
      if (!found) {
        map.set(lessonDate, {
          lessonDate,
          reports: [report],
          classIds: classId ? [classId] : [],
          attachments: Array.isArray(report.attachments)
            ? report.attachments.filter((att) => !isImageAttachment(att))
            : [],
        });
      } else {
        found.reports.push(report);
        if (classId && !found.classIds.includes(classId)) found.classIds.push(classId);
        const nonImage = Array.isArray(report.attachments)
          ? report.attachments.filter((att) => !isImageAttachment(att))
          : [];
        for (const att of nonImage) {
          if (!found.attachments.some((current) => current.fileUrl === att.fileUrl)) {
            found.attachments.push(att);
          }
        }
      }
    }
    return Array.from(map.values())
      .sort((a, b) => b.lessonDate.localeCompare(a.lessonDate))
      .map((group) => ({
        ...group,
        reports: [...group.reports].sort((a, b) => {
          const classA = String(a.classId ?? "");
          const classB = String(b.classId ?? "");
          if (classA !== classB) return classA.localeCompare(classB, "ar");
          return String(a.subject ?? "").localeCompare(String(b.subject ?? ""), "ar");
        }),
      }));
  }, [reports]);

  function canManageReport(report: LessonReport) {
    if (role === "admin") return true;
    return role === "teacher" && String(report.createdBy?.code ?? "") === userCode;
  }

  function startEdit(report: LessonReport) {
    setEditingId(report.id);
    setEditBody(String(report.body ?? ""));
    setEditSubject(String(report.subject ?? ""));
    setEditClassId(String(report.classId ?? ""));
    setEditLessonDate(String(report.lessonDate ?? ""));
    setMenuReportId(null);
  }

  async function saveEdit() {
    if (!editingId) return;
    if (!editBody.trim() || !editSubject.trim() || !editClassId.trim() || !editLessonDate.trim()) {
      setError("كل الحقول مطلوبة.");
      return;
    }
    setEditSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/lesson-reports", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: editingId,
          body: editBody.trim(),
          subject: editSubject.trim(),
          classId: editClassId.trim(),
          lessonDate: editLessonDate.trim(),
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(json?.message || "تعذر تعديل التقرير.");
        return;
      }
      setReports((prev) => prev.map((r) => (r.id === editingId ? (json.data as LessonReport) : r)));
      setEditingId(null);
    } catch {
      setError("تعذر تعديل التقرير.");
    } finally {
      setEditSaving(false);
    }
  }

  async function deleteReport(id: string) {
    const ok = window.confirm("حذف التقرير؟");
    if (!ok) return;
    setError(null);
    try {
      const res = await fetch(`/api/lesson-reports?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(json?.message || "تعذر حذف التقرير.");
        return;
      }
      setReports((prev) => prev.filter((r) => r.id !== id));
      setMenuReportId(null);
      if (editingId === id) setEditingId(null);
    } catch {
      setError("تعذر حذف التقرير.");
    }
  }

  async function deleteDayReports(lessonDate: string) {
    const ok = window.confirm("تأكيد حذف تقرير اليوم بالكامل؟");
    if (!ok) return;
    setError(null);
    try {
      const res = await fetch(`/api/lesson-reports?lessonDate=${encodeURIComponent(lessonDate)}`, {
        method: "DELETE",
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(json?.message || "تعذر حذف تقارير اليوم.");
        return;
      }
      setReports((prev) => prev.filter((r) => String(r.lessonDate ?? "").trim() !== lessonDate));
    } catch {
      setError("تعذر حذف تقارير اليوم.");
    }
  }

  return (
    <main className="min-h-screen px-6 pb-24 pt-10">
      <section className="mx-auto w-full max-w-5xl">
        <header className="mb-6 flex items-center justify-between">
          <h1 className="app-heading mt-2">تقارير الحصص</h1>
          <BackButton
            className="back-btn rounded-full border border-black/10 bg-white px-4 py-2 text-sm font-semibold text-[color:var(--ink)] shadow-sm"
            fallbackHref={backHref}
            />
        </header>

        {canCreate ? (
          <form
            onSubmit={handleCreate}
            className="mb-6 rounded-3xl border border-white/20 bg-white/15 p-5 text-white shadow-[var(--shadow)] backdrop-blur-md"
          >
            <p className="text-sm text-white/90">إضافة تقرير حصة</p>
            <div className="mt-4 grid gap-3">
              <div className="grid gap-3 md:grid-cols-2">
                <select
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  className="rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-sm text-white"
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
                <select
                  value={classId}
                  onChange={(e) => setClassId(e.target.value)}
                  className="rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-sm text-white"
                >
                  <option value="" className="text-black">
                    اختر الفصل
                  </option>
                  {teacherClasses.map((item) => (
                    <option key={item} value={item} className="text-black">
                      {item}
                    </option>
                  ))}
                </select>
                <input
                  type="date"
                  value={lessonDate}
                  onChange={(e) => setLessonDate(e.target.value)}
                  className="rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-sm text-white"
                />
              </div>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="تفاصيل الحصة (إجباري)"
                className="min-h-[110px] rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-sm text-white placeholder:text-white/70"
              />
              <input
                id="lesson-report-files"
                type="file"
                multiple
                accept=".pdf,image/*,video/*"
                onChange={(e) => setFiles(e.target.files)}
                className="rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-xs text-white"
              />
              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-full bg-white px-5 py-2 text-sm font-semibold text-black disabled:opacity-60"
                >
                  {saving ? "جار الحفظ..." : "حفظ التقرير"}
                </button>
              </div>
            </div>
          </form>
        ) : null}

        <div className="rounded-3xl border border-white/20 bg-white/15 p-5 text-white shadow-[var(--shadow)] backdrop-blur-md">
          <p className="text-sm text-white/90">تقارير الحصص</p>
          <div className="mt-3">
            <input
              type="date"
              value={filterDate}
              onChange={(e) => setFilterDate(e.target.value)}
              className="rounded-2xl border border-white/20 bg-white/10 px-3 py-2 text-sm text-white"
            />
          </div>
          {loading ? <p className="mt-3 text-sm text-white/70">جار التحميل...</p> : null}
          {error ? <p className="mt-3 text-sm text-red-200">{error}</p> : null}
          {!loading && !error && reports.length === 0 ? (
            <p className="mt-3 text-sm text-white/70">لا توجد تقارير بعد.</p>
          ) : null}
          {isViewerOnly ? (
            <div className="mt-4 grid gap-3">
              {groupedReports.map((group) => (
                <div key={`${group.classId}-${group.lessonDate}`} className="rounded-2xl border border-white/20 bg-white/10 px-4 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-white">الفصل: {group.classId}</p>
                    <p className="text-[11px] text-white/70">{formatDate(group.lessonDate)}</p>
                  </div>
                  <p className="mt-1 text-[11px] text-white/70">عدد تقارير المواد: {group.count}</p>
                  <p className="mt-1 text-[11px] text-white/70">
                    المواد: {group.subjects.length ? group.subjects.join(" - ") : "-"}
                  </p>
                  <a
                    href={`/api/lesson-reports/merged?classId=${encodeURIComponent(group.classId)}&lessonDate=${encodeURIComponent(group.lessonDate)}`}
                    className="mt-3 inline-flex w-fit rounded-full border border-white/30 px-3 py-1 text-xs text-white/90"
                  >
                    تنزيل الحصة
                  </a>
                  {group.attachments.length ? (
                    <div className="mt-3">
                      <p className="text-xs text-white/90">مرفقات الحصة:</p>
                      <div className="mt-1 grid gap-1">
                        {group.attachments.map((att, idx) => (
                          <a
                            key={`${group.classId}-${group.lessonDate}-att-${idx}`}
                            href={att.fileUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex w-fit rounded-full border border-white/30 px-3 py-1 text-xs text-white/90"
                          >
                            {att.fileName || "تنزيل الملف"}
                          </a>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-4 grid gap-4">
              {groupedByDate.map((group) => (
                <div key={group.lessonDate} className="rounded-2xl border border-white/20 bg-white/10 p-4">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-white">تاريخ الحصة: {group.lessonDate}</p>
                    <div className="flex items-center gap-2">
                      <p className="text-[11px] text-white/70">عدد التقارير: {group.reports.length}</p>
                      {role === "teacher" ? (
                        <button
                          type="button"
                          onClick={() => deleteDayReports(group.lessonDate)}
                          className="inline-flex items-center rounded-full border border-red-300/70 bg-red-500/20 p-1.5"
                          title="حذف تقرير اليوم بالكامل"
                          aria-label="حذف تقرير اليوم بالكامل"
                        >
                          <img src="/delete-2.png" alt="حذف" className="h-4 w-4 object-contain" />
                        </button>
                      ) : null}
                    </div>
                  </div>
                  <div className="mb-3 flex flex-wrap gap-2">
                    {group.classIds.map((cls) => (
                      <a
                        key={`${group.lessonDate}-${cls}`}
                        href={`/api/lesson-reports/merged?classId=${encodeURIComponent(cls)}&lessonDate=${encodeURIComponent(group.lessonDate)}`}
                        className="inline-flex w-fit rounded-full border border-white/30 px-3 py-1 text-xs text-white/90"
                      >
                        تنزيل ملف {cls}
                      </a>
                    ))}
                  </div>
                  {group.attachments.length ? (
                    <div className="mb-3">
                      <p className="text-xs text-white/90">مرفقات الحصة:</p>
                      <div className="mt-1 grid gap-1">
                        {group.attachments.map((att, idx) => (
                          <a
                            key={`${group.lessonDate}-att-${idx}`}
                            href={att.fileUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex w-fit rounded-full border border-white/30 px-3 py-1 text-xs text-white/90"
                          >
                            {att.fileName || "تنزيل الملف"}
                          </a>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  <div className="grid gap-3">
                    {group.reports.map((report) => (
                      <div key={report.id} className="relative rounded-xl border border-white/20 bg-black/10 p-3">
                        {canManageReport(report) ? (
                          <div className="absolute left-2 top-2">
                            <button
                              type="button"
                              onClick={() => setMenuReportId((prev) => (prev === report.id ? null : report.id))}
                              className="rounded-md border border-white/30 px-2 py-0.5 text-white"
                            >
                              ⋮
                            </button>
                            {menuReportId === report.id ? (
                              <div className="absolute left-0 top-8 z-20 w-28 rounded-xl border border-white/20 bg-white/95 p-1 text-right text-black">
                                <button
                                  type="button"
                                  onClick={() => startEdit(report)}
                                  className="block w-full rounded-lg px-2 py-1 text-sm hover:bg-black/5"
                                >
                                  تعديل
                                </button>
                                <button
                                  type="button"
                                  onClick={() => deleteReport(report.id)}
                                  className="block w-full rounded-lg px-2 py-1 text-sm text-red-600 hover:bg-red-50"
                                >
                                  حذف
                                </button>
                              </div>
                            ) : null}
                          </div>
                        ) : null}

                        {editingId === report.id ? (
                          <div className="grid gap-2 pt-6">
                            <div className="grid gap-2 md:grid-cols-3">
                              <select
                                value={editSubject}
                                onChange={(e) => setEditSubject(e.target.value)}
                                className="rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-sm text-white"
                              >
                                <option value="" className="text-black">اختر المادة</option>
                                {SUBJECTS.map((item) => (
                                  <option key={item} value={item} className="text-black">{item}</option>
                                ))}
                              </select>
                              <input
                                value={editClassId}
                                onChange={(e) => setEditClassId(e.target.value.toUpperCase())}
                                className="rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-sm text-white"
                                placeholder="الفصل"
                              />
                              <input
                                type="date"
                                value={editLessonDate}
                                onChange={(e) => setEditLessonDate(e.target.value)}
                                className="rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-sm text-white"
                              />
                            </div>
                            <textarea
                              value={editBody}
                              onChange={(e) => setEditBody(e.target.value)}
                              className="min-h-[100px] rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-sm text-white"
                            />
                            <div className="flex gap-2">
                              <button
                                type="button"
                                onClick={saveEdit}
                                disabled={editSaving}
                                className="rounded-full bg-white px-4 py-1.5 text-sm font-semibold text-black disabled:opacity-60"
                              >
                                {editSaving ? "جار الحفظ..." : "حفظ"}
                              </button>
                              <button
                                type="button"
                                onClick={() => setEditingId(null)}
                                className="rounded-full border border-white/30 px-4 py-1.5 text-sm text-white"
                              >
                                إلغاء
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="grid gap-1 pt-1">
                            <p className="text-sm font-semibold text-white">{report.subject || "-"}</p>
                            <p className="text-[11px] text-white/70">الفصل: {report.classId || "-"}</p>
                            <p className="text-[11px] text-white/70">بواسطة: {report.createdBy?.name || "غير معروف"}</p>
                            {report.body ? (
                              <p className="mt-1 whitespace-pre-line text-sm text-white">{report.body}</p>
                            ) : null}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
