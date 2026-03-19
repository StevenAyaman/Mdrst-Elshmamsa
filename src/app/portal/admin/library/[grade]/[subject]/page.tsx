"use client";

import Link from "next/link";
import BackButton from "@/app/back-button";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

const gradeLabels: Record<string, string> = {
  "1": "سنة أولى",
  "2": "سنة ثانية",
  "3": "سنة ثالثة",
  "4": "سنة رابعة",
  "5": "سنة خامسة",
};

const subjectLabels: Record<string, string> = {
  alhan: "الالحان",
  katamars: "القطمارس",
  coptic: "القبطي",
  taqs: "الطقس",
  agbia: "الاجبية",
};

type StoredUser = {
  name?: string;
  studentCode?: string;
  role?: string;
};

type LibraryFile = {
  id: string;
  fileName: string;
  fileType: "pdf" | "mp3";
  mimeType: string;
  size: number;
  url: string;
  storagePath?: string;
  createdAt: string;
  createdBy: {
    name?: string;
  };
};

const canUploadRoles = new Set(["admin", "teacher"]);

export default function LibrarySubjectPage() {
  const params = useParams<{ grade: string; subject: string }>();
  const grade = params?.grade ?? "1";
  const subject = params?.subject ?? "alhan";
  const gradeLabel = gradeLabels[grade] ?? "السنة";
  const subjectLabel = subjectLabels[subject] ?? "المادة";
  const headingSubject = subjectLabel;
  const [user, setUser] = useState<StoredUser | null>(null);
  const [files, setFiles] = useState<LibraryFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [menuId, setMenuId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const stored = window.localStorage.getItem("dsms:user");
    if (!stored) return;
    try {
      setUser(JSON.parse(stored) as StoredUser);
    } catch {
      setUser(null);
    }
  }, []);

  useEffect(() => {
    async function loadFiles() {
      try {
        setLoading(true);
        setError(null);
        const query = new URLSearchParams({ grade, subject });
        const res = await fetch(`/api/library-files?${query.toString()}`);
        const json = await res.json();
        if (!res.ok || !json.ok) {
          setError(json?.message || "تعذر تحميل الملفات.");
          return;
        }
        setFiles(json.data as LibraryFile[]);
      } catch {
        setError("تعذر تحميل الملفات.");
      } finally {
        setLoading(false);
      }
    }
    loadFiles();
  }, [grade, subject]);

  const canUpload = user?.role ? canUploadRoles.has(user.role) : false;

  async function uploadFile(file: File) {
    setUploadError(null);
    if (!canUpload) {
      setUploadError("غير مسموح لك برفع ملفات.");
      return;
    }
    if (!user?.name || !user?.studentCode || !user?.role) {
      setUploadError("لا توجد جلسة مستخدم صالحة.");
      return;
    }
    const formData = new FormData();
    formData.append("grade", grade);
    formData.append("subject", subject);
    formData.append("role", user.role);
    formData.append("code", user.studentCode);
    formData.append("name", user.name);
    formData.append("file", file);

    setUploading(true);
    try {
      const res = await fetch("/api/library-files", {
        method: "POST",
        body: formData,
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setUploadError(json?.message || "فشل رفع الملف.");
        return;
      }
      setFiles((prev) => [json.data as LibraryFile, ...prev]);
    } catch {
      setUploadError("فشل رفع الملف.");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function handlePickFileClick() {
    if (!canUpload || uploading) return;
    fileInputRef.current?.click();
  }

  async function handleFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    await uploadFile(file);
  }

  async function handleDelete(id: string) {
    if (!canUpload || !user?.role || !user?.studentCode) return;
    setUploadError(null);
    setDeletingId(id);
    try {
      const res = await fetch("/api/library-files", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, role: user.role, code: user.studentCode }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setUploadError(json?.message || "تعذر حذف الملف.");
        return;
      }
      setFiles((prev) => prev.filter((f) => f.id !== id));
    } catch {
      setUploadError("تعذر حذف الملف.");
    } finally {
      setDeletingId(null);
    }
  }

  async function handleRename(id: string) {
    if (!canUpload || !user?.role || !user?.studentCode) return;
    const fileName = renameValue.trim();
    if (!fileName) return;
    setUploadError(null);
    setRenamingId(id);
    try {
      const res = await fetch("/api/library-files", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, role: user.role, code: user.studentCode, fileName }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setUploadError(json?.message || "تعذر تعديل الاسم.");
        return;
      }
      setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, fileName } : f)));
      setRenamingId(null);
      setMenuId(null);
      setRenameValue("");
    } catch {
      setUploadError("تعذر تعديل الاسم.");
    }
  }

  return (
    <main className="min-h-screen px-6 pb-24 pt-10">
      <div className="mx-auto w-full max-w-5xl">
        <header className="mb-8 flex items-center justify-between">
          <h1 className="app-heading mt-2">
            منهج {headingSubject} - {gradeLabel}
          </h1>
          <BackButton
            className="back-btn rounded-full border border-black/10 bg-white px-4 py-2 text-sm font-semibold text-[color:var(--ink)] shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
            fallbackHref={`/portal/admin/library/${grade}`}
            />
        </header>

        <section className="mt-6 rounded-3xl border border-white/20 bg-white/15 p-6 text-white shadow-[var(--shadow)] backdrop-blur-md">
          <div className="flex items-center justify-between">
            <p className="text-2xl font-semibold">{subjectLabel}</p>
            {canUpload ? (
              <button
                type="button"
                onClick={handlePickFileClick}
                disabled={uploading}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-3xl leading-none text-black disabled:opacity-60"
                aria-label="إضافة ملف"
              >
                +
              </button>
            ) : null}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,audio/mpeg,audio/mp3,.mp3"
            className="hidden"
            onChange={handleFilePicked}
          />
          {uploading ? <p className="mt-3 text-sm text-white/85">جار الرفع...</p> : null}
          {uploadError ? <p className="mt-3 text-sm text-red-200">{uploadError}</p> : null}
          {loading ? <p className="mt-3 text-sm text-white/80">جار التحميل...</p> : null}
          {error ? <p className="mt-3 text-sm text-red-200">{error}</p> : null}
          {!loading && !error && files.length === 0 ? (
            <p className="mt-3 text-sm text-white/80">لا توجد ملفات مضافة بعد.</p>
          ) : null}
          {!loading && !error && files.length > 0 ? (
            <div className="mt-4 grid gap-3">
              {files.map((item) => (
                <div
                  key={item.id}
                  className="relative flex items-center justify-between gap-3 rounded-2xl border border-white/20 bg-white/10 px-4 py-3 transition hover:bg-white/15"
                >
                  <div className="flex-1">
                    <a href={item.url} target="_blank" rel="noreferrer" className="block">
                      <p className="text-lg font-semibold">{item.fileName}</p>
                    </a>
                  </div>
                  {canUpload ? (
                    <div className="relative">
                      <button
                        type="button"
                        onClick={() => {
                          setMenuId((prev) => (prev === item.id ? null : item.id));
                          setRenamingId(null);
                        }}
                        className="rounded-full px-2 py-1 text-2xl leading-none text-white"
                        aria-label="خيارات الملف"
                      >
                        ⋮
                      </button>
                      {menuId === item.id ? (
                        <div className="absolute left-0 top-10 z-20 w-44 rounded-2xl border border-white/20 bg-[#222]/95 p-2 shadow-lg">
                          {renamingId === item.id ? (
                            <div className="grid gap-2 p-1">
                              <input
                                className="rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-sm text-white outline-none"
                                value={renameValue}
                                onChange={(e) => setRenameValue(e.target.value)}
                                placeholder="الاسم الجديد"
                              />
                              <button
                                type="button"
                                className="rounded-xl bg-white px-3 py-2 text-sm font-semibold text-black"
                                onClick={() => handleRename(item.id)}
                              >
                                حفظ
                              </button>
                            </div>
                          ) : (
                            <div className="grid gap-1 p-1">
                              <button
                                type="button"
                                className="rounded-xl px-3 py-2 text-right text-sm text-white hover:bg-white/10"
                                onClick={() => {
                                  setRenamingId(item.id);
                                  setRenameValue(item.fileName);
                                }}
                              >
                                تعديل الاسم
                              </button>
                              <button
                                type="button"
                                className="rounded-xl px-3 py-2 text-right text-sm text-red-300 hover:bg-white/10"
                                onClick={() => handleDelete(item.id)}
                                disabled={deletingId === item.id}
                              >
                                {deletingId === item.id ? "جار الحذف..." : "حذف الملف"}
                              </button>
                            </div>
                          )}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}
        </section>
      </div>
    </main>
  );
}

