"use client";

import Link from "next/link";
import BackButton from "@/app/back-button";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type StoredUser = { role?: string };
type CompetitionAttachment = { fileUrl: string; fileName?: string; mimeType?: string };
type CompetitionPost = {
  id: string;
  title?: string;
  body?: string;
  link?: string;
  createdBy?: { name?: string; role?: string; code?: string };
  attachments?: CompetitionAttachment[];
  createdAt?: { _seconds?: number };
};

function formatDate(value?: { _seconds?: number }) {
  if (!value?._seconds) return "-";
  return new Date(value._seconds * 1000).toLocaleString("ar-EG");
}

export default function CompetitionsPage() {
  const router = useRouter();
  const [role, setRole] = useState("");
  const [userCode, setUserCode] = useState("");
  const [items, setItems] = useState<CompetitionPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [link, setLink] = useState("");
  const [files, setFiles] = useState<FileList | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const stored = window.localStorage.getItem("dsms:user");
    if (!stored) {
      router.replace("/login");
      return;
    }
    try {
      const parsed = JSON.parse(stored) as StoredUser & { studentCode?: string };
      const normalizedRole = parsed.role === "nzam" ? "system" : String(parsed.role ?? "");
      if (!normalizedRole) {
        router.replace("/login");
        return;
      }
      setRole(normalizedRole);
      setUserCode(String(parsed.studentCode ?? ""));
    } catch {
      router.replace("/login");
    }
  }, [router]);

  useEffect(() => {
    async function loadPosts() {
      if (!role) return;
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/competitions");
        const json = await res.json();
        if (!res.ok || !json.ok) {
          setError(json?.message || "تعذر تحميل المسابقة.");
          setItems([]);
          return;
        }
        setItems((json.data as CompetitionPost[]) ?? []);
      } catch {
        setError("تعذر تحميل المسابقة.");
      } finally {
        setLoading(false);
      }
    }
    loadPosts();
  }, [role]);

  const canPublish = role === "katamars" || role === "admin";
  const backHref = useMemo(() => `/portal/${role || "student"}`, [role]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!canPublish) return;
    if (!title.trim() && !body.trim() && !link.trim() && (!files || files.length === 0)) {
      setError("اكتب رسالة أو عنوان أو رابط أو أضف ملف.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("title", title.trim());
      form.append("body", body.trim());
      form.append("link", link.trim());
      if (files) {
        Array.from(files).forEach((file) => form.append("files", file));
      }

      const res = await fetch("/api/competitions", { method: "POST", body: form });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(json?.message || "تعذر نشر المحتوى.");
        return;
      }
      setItems((prev) => [json.data as CompetitionPost, ...prev]);
      setTitle("");
      setBody("");
      setLink("");
      setFiles(null);
      const input = document.getElementById("competition-files") as HTMLInputElement | null;
      if (input) input.value = "";
    } catch {
      setError("تعذر نشر المحتوى.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    const ok = window.confirm("حذف هذا المنشور؟");
    if (!ok) return;
    try {
      const res = await fetch(`/api/competitions?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(json?.message || "تعذر الحذف.");
        return;
      }
      setItems((prev) => prev.filter((item) => item.id !== id));
    } catch {
      setError("تعذر الحذف.");
    }
  }

  return (
    <main className="min-h-screen px-6 pb-24 pt-10">
      <section className="mx-auto w-full max-w-5xl space-y-6">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="app-heading mt-2">مسابقة القطمارس</h1>
            <p className="text-sm text-white/80">روابط وملفات ورسائل مسابقة القطمارس.</p>
          </div>
          <BackButton
            className="back-btn rounded-full border border-black/10 bg-white px-4 py-1 text-sm font-semibold text-[color:var(--ink)] shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
            fallbackHref={backHref}
            />
        </header>

        {canPublish ? (
          <form
            onSubmit={handleCreate}
            className="grid gap-3 rounded-3xl border border-white/20 bg-white/15 p-6 text-white shadow-[var(--shadow)] backdrop-blur-md"
          >
            <p className="text-sm font-semibold text-white/90">نشر محتوى جديد للمسابقة</p>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="العنوان (اختياري)"
              className="rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-sm text-white placeholder:text-white/70"
            />
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="الرسالة"
              className="min-h-[100px] rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-sm text-white placeholder:text-white/70"
            />
            <input
              value={link}
              onChange={(e) => setLink(e.target.value)}
              placeholder="رابط (اختياري)"
              className="rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-sm text-white placeholder:text-white/70"
            />
            <input
              id="competition-files"
              type="file"
              multiple
              onChange={(e) => setFiles(e.target.files)}
              className="rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-xs text-white"
            />
            <div className="flex justify-end">
              <button
                type="submit"
                disabled={saving}
                className="rounded-full bg-white px-5 py-2 text-sm font-semibold text-black disabled:opacity-60"
              >
                {saving ? "جار النشر..." : "نشر"}
              </button>
            </div>
          </form>
        ) : null}

        {error ? <p className="text-sm text-red-200">{error}</p> : null}
        {loading ? <p className="text-sm text-white/80">جار التحميل...</p> : null}

        <div className="grid gap-4">
          {!loading && items.length === 0 ? (
            <div className="rounded-3xl border border-white/20 bg-white/15 p-6 text-sm text-white/80 shadow-[var(--shadow)] backdrop-blur-md">
              لا يوجد محتوى بعد.
            </div>
          ) : null}
          {items.map((item) => {
            const canDelete = role === "admin" || (role === "katamars" && String(item.createdBy?.code ?? "") === userCode);
            return (
              <article
                key={item.id}
                className="rounded-3xl border border-white/20 bg-white/15 p-5 text-white shadow-[var(--shadow)] backdrop-blur-md"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-base font-semibold">{item.title || "رسالة مسابقة"}</p>
                    {item.body ? <p className="mt-2 whitespace-pre-wrap text-sm text-white/90">{item.body}</p> : null}
                    {item.link ? (
                      <a
                        href={item.link}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-3 inline-flex rounded-full border border-white/30 px-3 py-1 text-xs text-white/90"
                      >
                        فتح الرابط
                      </a>
                    ) : null}
                    {Array.isArray(item.attachments) && item.attachments.length ? (
                      <div className="mt-3 grid gap-2">
                        {item.attachments.map((att, idx) => (
                          <a
                            key={`${att.fileUrl}-${idx}`}
                            href={att.fileUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-xs text-white/90"
                          >
                            {att.fileName || "مرفق"}
                          </a>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  {canDelete ? (
                    <button
                      type="button"
                      onClick={() => handleDelete(item.id)}
                      className="rounded-full border border-red-300/60 bg-red-500/20 px-3 py-1 text-xs font-semibold text-red-100"
                    >
                      حذف
                    </button>
                  ) : null}
                </div>
                <p className="mt-3 text-[11px] text-white/70">

                </p>
              </article>
            );
          })}
        </div>
      </section>
    </main>
  );
}

