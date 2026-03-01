"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type StoredUser = {
  name?: string;
  role?: string;
  studentCode?: string;
};

type InquiryThread = {
  id: string;
  title: string;
  status: string;
  createdAt: string;
  lastMessageAt?: string;
  lastMessageBy?: { name?: string; role?: string };
  createdBy?: { name?: string; role?: string; profilePhoto?: string; classLabel?: string };
};

type InquiryMessage = {
  id: string;
  text: string;
  fileUrl?: string;
  fileName?: string;
  mimeType?: string;
  createdAt: string;
  createdBy?: { code?: string; name?: string; role?: string };
};

function roleLabel(value?: string) {
  const role = String(value ?? "").trim().toLowerCase();
  if (role === "admin") return "ادمن";
  if (role === "system" || role === "nzam") return "خادم نظام";
  if (role === "teacher") return "مدرس";
  if (role === "parent") return "ولي أمر";
  if (role === "student") return "طالب";
  if (role === "notes") return "ملاحظات";
  return "مستخدم";
}

function displayNameForRole(name?: string, role?: string) {
  const normalized = String(role ?? "").trim().toLowerCase();
  if (normalized === "notes") return "إدارة مدرسة الشمامسة";
  return name || "مستخدم";
}

function formatDate(value: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("ar-EG");
}

function formatTime(value: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" });
}

function formatDateOnly(value: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("ar-EG");
}

export default function InquiriesPage() {
  const router = useRouter();
  const [me, setMe] = useState<StoredUser | null>(null);
  const [role, setRole] = useState<string>("");
  const [threads, setThreads] = useState<InquiryThread[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");

  const [selectedId, setSelectedId] = useState<string>("");
  const [messages, setMessages] = useState<InquiryMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [contactsOpen, setContactsOpen] = useState(false);
  const [contactsLoading, setContactsLoading] = useState(false);
  const [contactsError, setContactsError] = useState<string | null>(null);
  const [contactNotes, setContactNotes] = useState<
    Array<{ code: string; name: string; role: string }>
  >([]);
  const [contactStaff, setContactStaff] = useState<
    Array<{ code: string; name: string; role: string; classIds: string[] }>
  >([]);
  const [targetName, setTargetName] = useState("");

  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sendSuccess, setSendSuccess] = useState<string | null>(null);

  useEffect(() => {
    const stored = window.localStorage.getItem("dsms:user");
    if (!stored) {
      router.replace("/login");
      return;
    }
    try {
      const parsed = JSON.parse(stored) as StoredUser;
      const normalized = parsed.role === "nzam" ? "system" : parsed.role;
      if (!["student", "parent", "notes", "admin"].includes(String(normalized))) {
        router.replace(`/portal/${normalized || "student"}`);
        return;
      }
      setMe(parsed);
      setRole(String(normalized));
    } catch {
      router.replace("/login");
    }
  }, [router]);

  async function loadThreads(query?: string) {
    try {
      setLoading(true);
      setError(null);
      const params = new URLSearchParams();
      if (query?.trim()) params.set("q", query.trim());
      const res = await fetch(`/api/inquiries${params.toString() ? `?${params.toString()}` : ""}`);
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(json.message || "تعذر تحميل الاستفسارات.");
        return;
      }
      setThreads(json.data as InquiryThread[]);
    } catch {
      setError("تعذر تحميل الاستفسارات.");
    } finally {
      setLoading(false);
    }
  }

  async function loadContacts() {
    if (contactsLoading) return;
    setContactsError(null);
    setContactsLoading(true);
    try {
      const res = await fetch("/api/inquiries/contacts");
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setContactsError(json.message || "تعذر تحميل القائمة.");
        return;
      }
      setContactNotes(Array.isArray(json.data?.notes) ? json.data.notes : []);
      setContactStaff(Array.isArray(json.data?.staff) ? json.data.staff : []);
    } catch {
      setContactsError("تعذر تحميل القائمة.");
    } finally {
      setContactsLoading(false);
    }
  }

  useEffect(() => {
    if (!role) return;
    loadThreads();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role]);

  useEffect(() => {
    if (!role) return;
    const handle = window.setTimeout(() => {
      loadThreads(searchTerm);
    }, 300);
    return () => window.clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchTerm, role]);

  async function loadThreadMessages(id: string) {
    if (!id) return;
    try {
      setMessagesLoading(true);
      const res = await fetch(`/api/inquiries?id=${encodeURIComponent(id)}`);
      const json = await res.json();
      if (res.ok && json.ok) {
        const data = json.data as { messages: InquiryMessage[]; title?: string };
        setMessages(data.messages || []);
      }
    } finally {
      setMessagesLoading(false);
    }
  }

  async function handleDeleteThread(id: string) {
    if (!id) return;
    const ok = window.confirm("تأكيد حذف المحادثة؟");
    if (!ok) return;
    setDeletingId(id);
    try {
      const res = await fetch(`/api/inquiries?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(json.message || "تعذر حذف المحادثة.");
        return;
      }
      setThreads((prev) => prev.filter((item) => item.id !== id));
      if (selectedId === id) {
        setSelectedId("");
        setMessages([]);
      }
    } catch {
      setError("تعذر حذف المحادثة.");
    } finally {
      setDeletingId(null);
    }
  }

  useEffect(() => {
    if (!selectedId) {
      setMessages([]);
      return;
    }
    loadThreadMessages(selectedId);
  }, [selectedId]);

  const canCreate = role === "student" || role === "parent";
  const canStaffReply = role === "notes" || role === "admin";
  const canUserFollowUp = role === "student" || role === "parent";

  async function handleCreateInquiry(e: React.FormEvent) {
    e.preventDefault();
    if (!canCreate) return;
    setSendError(null);
    setSendSuccess(null);
    if (!message.trim()) {
      setSendError("اكتب الرسالة أولاً.");
      return;
    }
    setSending(true);
    try {
      const form = new FormData();
      form.append("title", title.trim());
      form.append("message", message.trim());
      if (file) form.append("file", file);
      const res = await fetch("/api/inquiries", { method: "POST", body: form });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setSendError(json.message || "تعذر إرسال الاستفسار.");
        return;
      }
      setSendSuccess("تم إرسال الاستفسار.");
      setTitle("");
      setTargetName("");
      setMessage("");
      setFile(null);
      await loadThreads();
      if (json.data?.id) {
        setSelectedId(String(json.data.id));
      }
    } catch {
      setSendError("تعذر إرسال الاستفسار.");
    } finally {
      setSending(false);
    }
  }

  async function handleSendMessage(e: React.FormEvent) {
    e.preventDefault();
    if ((!canStaffReply && !canUserFollowUp) || !selectedId) return;
    setSendError(null);
    setSendSuccess(null);
    if (!message.trim()) {
      setSendError("اكتب الرد أولاً.");
      return;
    }
    setSending(true);
    try {
      const form = new FormData();
      form.append("id", selectedId);
      form.append("message", message.trim());
      if (file) form.append("file", file);
      const res = await fetch("/api/inquiries", { method: "PATCH", body: form });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setSendError(json.message || "تعذر إرسال الرد.");
        return;
      }
      setMessage("");
      setFile(null);
      await loadThreadMessages(selectedId);
      await loadThreads();
    } catch {
      setSendError("تعذر إرسال الرد.");
    } finally {
      setSending(false);
    }
  }

  const selectedThread = useMemo(
    () => threads.find((t) => t.id === selectedId) ?? null,
    [threads, selectedId]
  );

  return (
    <main className="min-h-screen px-6 pb-24 pt-10">
      <div className="mx-auto w-full max-w-6xl">
        <header className="mb-8 flex items-center justify-between">
          <h1 className="app-heading mt-2">الاستفسارات والشكاوي</h1>
          <button
            type="button"
            onClick={() => router.back()}
            className="back-btn rounded-full border border-black/10 bg-white px-4 py-2 text-sm font-semibold text-[color:var(--ink)] shadow-sm"
          >
            رجوع
          </button>
        </header>

        <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
          <section className="rounded-3xl border border-white/20 bg-white/15 p-4 text-white shadow-[var(--shadow)] backdrop-blur-md">
            <p className="mb-3 text-sm font-semibold">القائمة</p>
            <div className="mb-3 flex items-center gap-2">
              <input
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="بحث بالاسم أو الكود أو عنوان الشات أو كلمة داخل الشات"
                className="w-full rounded-2xl border border-white/20 bg-white/10 px-3 py-2 text-sm text-white placeholder:text-white/70"
              />
              {(role === "student" || role === "parent") ? (
                <button
                  type="button"
                  onClick={() => {
                    const next = !contactsOpen;
                    setContactsOpen(next);
                    if (next) loadContacts();
                  }}
                  className="text-3xl font-semibold text-white"
                  aria-label="بدء محادثة جديدة"
                >
                  +
                </button>
              ) : null}
            </div>
            {contactsOpen ? (
              <div className="mb-3 rounded-2xl border border-white/20 bg-white/10 p-3 text-sm text-white">
                {contactsLoading ? <p className="text-white/70">جار التحميل...</p> : null}
                {contactsError ? <p className="text-red-200">{contactsError}</p> : null}
                {!contactsLoading && !contactsError ? (
                  <div className="grid gap-3">
                    <div className="grid gap-2">
                      <p className="text-sm text-white/85">إدارة مدرسة الشمامسة</p>
                      {contactNotes.length === 0 ? null : (
                        <select
                          className="w-full rounded-xl border border-white/20 bg-white/5 px-3 py-2 text-sm text-white"
                          onChange={(e) => {
                            if (!e.target.value) return;
                            setTargetName("إدارة مدرسة الشمامسة");
                            setTitle("استفسار إلى إدارة مدرسة الشمامسة");
                            setContactsOpen(false);
                            setSelectedId("");
                            e.currentTarget.selectedIndex = 0;
                          }}
                        >
                          <option value="" className="text-black">
                            اختر الحساب
                          </option>
                          {contactNotes.map((item) => (
                            <option key={item.code} value={item.code} className="text-black">
                              إدارة مدرسة الشمامسة
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                    <div className="grid gap-2">
                      <p className="text-sm text-white/85">المدرسين وخدام النظام</p>
                      {contactStaff.length === 0 ? null : (
                        <select
                          className="w-full rounded-xl border border-white/20 bg-white/5 px-3 py-2 text-sm text-white"
                          onChange={(e) => {
                            const code = e.target.value;
                            if (!code) return;
                            const item = contactStaff.find((row) => row.code === code);
                            if (!item) return;
                            setTargetName(item.name);
                            setTitle(`استفسار إلى ${item.name}`);
                            setContactsOpen(false);
                            setSelectedId("");
                            e.currentTarget.selectedIndex = 0;
                          }}
                        >
                          <option value="" className="text-black">
                            اختر الحساب
                          </option>
                          {contactStaff.map((item) => (
                            <option key={item.code} value={item.code} className="text-black">
                              {item.name} - {roleLabel(item.role)}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
            {loading ? <p className="text-xs text-white/80">جار التحميل...</p> : null}
            {error ? <p className="text-xs text-red-200">{error}</p> : null}
            {!loading && threads.length === 0 ? (
              <p className="text-xs text-white/80">لا توجد محادثات بعد.</p>
            ) : null}
            <div className="mt-2 grid gap-2">
              {threads.map((thread) => {
                const isNotesView = role === "notes";
                return (
                <button
                  key={thread.id}
                  type="button"
                  onClick={() => setSelectedId(thread.id)}
                  className={`rounded-2xl border px-3 py-2 text-right text-sm transition ${
                    selectedId === thread.id
                      ? "border-white/60 bg-white/25"
                      : "border-white/20 bg-white/10"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full border border-white/25 bg-white/20">
                      {thread.createdBy?.role === "notes" ? (
                        <img
                          src="/elmdrsa.jpeg"
                          alt=""
                          className="h-full w-full object-cover"
                        />
                      ) : thread.createdBy?.profilePhoto ? (
                        <img
                          src={thread.createdBy.profilePhoto}
                          alt=""
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <span className="text-xs text-white/70">👤</span>
                      )}
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-semibold">
                        {displayNameForRole(thread.createdBy?.name, thread.createdBy?.role)}
                      </p>
                      {isNotesView ? (
                        <>
                          <p className="text-[11px] text-white/70">
                            {thread.createdBy?.classLabel || "-"}
                          </p>
                          <div className="mt-1 flex items-center justify-between gap-2 text-sm text-white/80">
                            <span className="truncate text-sm text-white/80">
                              {thread.title || "استفسار"}
                            </span>
                            <span className="text-sm text-white/70">
                              {formatDateOnly(thread.lastMessageAt || thread.createdAt)}{" "}
                              {formatTime(thread.lastMessageAt || thread.createdAt)}
                            </span>
                          </div>
                        </>
                      ) : (
                        <>
                          {thread.createdBy?.role === "notes" ? null : (
                            <p className="text-[11px] text-white/70">
                              {thread.createdBy?.classLabel
                                ? thread.createdBy.classLabel
                                : roleLabel(thread.createdBy?.role)}
                            </p>
                          )}
                          <p className="mt-1 text-[10px] text-white/70">
                            {thread.lastMessageBy?.name
                              ? `آخر رد: ${thread.lastMessageBy.name}`
                              : "بدون رد"}
                          </p>
                          <p className="text-[10px] text-white/60">
                            {formatDate(thread.lastMessageAt || thread.createdAt)}
                          </p>
                        </>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        handleDeleteThread(thread.id);
                      }}
                      className="flex h-9 w-9 items-center justify-center rounded-full border border-white/25 bg-white/10 text-white/80 transition hover:bg-white/20"
                      aria-label="حذف المحادثة"
                      disabled={deletingId === thread.id}
                    >
                      <img src="/delete-2.png" alt="" className="h-5 w-5" />
                    </button>
                  </div>
                </button>
              )})}
            </div>
          </section>

          <section className="rounded-3xl border border-white/20 bg-white/15 p-6 text-white shadow-[var(--shadow)] backdrop-blur-md">
            {!selectedThread ? (
              <div className="text-sm text-white/80">
                {canCreate
                  ? "اكتب استفسارك من النموذج بالأسفل."
                  : "اختر محادثة من القائمة لعرضها."}
              </div>
            ) : (
              <>
                <div className="mb-4 flex items-center justify-between">
                  <div>
                    <p className="text-lg font-semibold">{selectedThread.title || "استفسار"}</p>
                    <p className="text-xs text-white/70">
                      الحالة: {selectedThread.status === "answered" ? "تم الرد" : "مفتوح"}
                    </p>
                  </div>
                </div>
                <div className="grid gap-3">
                  {messagesLoading ? <p className="text-xs text-white/70">جار تحميل الرسائل...</p> : null}
                  {!messagesLoading && messages.length === 0 ? (
                    <p className="text-xs text-white/70">لا توجد رسائل بعد.</p>
                  ) : null}
                  {messages.map((msg) => {
                    const isMine =
                      me?.studentCode &&
                      String(msg.createdBy?.code ?? "").trim() === String(me.studentCode).trim();
                    return (
                      <div key={msg.id} className={`flex ${isMine ? "justify-end" : "justify-start"}`}>
                        <div
                          className={`w-full max-w-[520px] rounded-2xl border p-3 text-right ${
                            isMine
                              ? "border-white/30 bg-white/20"
                              : "border-white/15 bg-white/10"
                          }`}
                        >
                          <div className={`flex flex-col ${isMine ? "items-end" : "items-start"}`}>
                            <p className="text-sm font-semibold">
                              {displayNameForRole(msg.createdBy?.name, msg.createdBy?.role)}
                            </p>
                            {msg.createdBy?.role === "notes" ? null : (
                              <p className="text-[11px] text-white/70">
                                {roleLabel(msg.createdBy?.role)}
                              </p>
                            )}
                          </div>
                          <p className="mt-2 text-sm leading-relaxed">{msg.text}</p>
                          <p className="mt-2 text-[10px] text-white/60">
                            {formatDate(msg.createdAt)}
                          </p>
                          {msg.fileUrl ? (
                            msg.mimeType && msg.mimeType.startsWith("image/") ? (
                              <img
                                src={msg.fileUrl}
                                alt={msg.fileName || "صورة مرفقة"}
                                className="mt-3 max-h-64 w-full rounded-2xl object-cover"
                              />
                            ) : (
                              <a
                                href={msg.fileUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="mt-2 inline-flex items-center gap-2 rounded-full border border-white/30 px-3 py-1 text-xs text-white/90"
                              >
                                📎 {msg.fileName || "ملف مرفق"}
                              </a>
                            )
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}

            {canCreate && !selectedId ? (
              <form onSubmit={handleCreateInquiry} className="mt-6 grid gap-3">
                {targetName ? (
                  <p className="text-xs text-white/80">إلى: {targetName}</p>
                ) : null}
                <input
                  className="rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-sm text-white"
                  placeholder="عنوان الاستفسار (اختياري)"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
                <textarea
                  className="min-h-[120px] rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-sm text-white placeholder:text-white/70"
                  placeholder="اكتب الاستفسار أو الشكوى"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                />
                <input
                  type="file"
                  className="rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-xs text-white"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
                {sendError ? <p className="text-xs text-red-200">{sendError}</p> : null}
                {sendSuccess ? <p className="text-xs text-green-200">{sendSuccess}</p> : null}
                <button
                  type="submit"
                  disabled={sending}
                  className="w-fit rounded-full bg-white px-5 py-2 text-sm font-semibold text-black disabled:opacity-60"
                >
                  {sending ? "جار الإرسال..." : "إرسال الاستفسار"}
                </button>
              </form>
            ) : null}

            {(canStaffReply || canUserFollowUp) && selectedId ? (
              <form onSubmit={handleSendMessage} className="mt-6 grid gap-3">
                <textarea
                  className="min-h-[100px] rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-sm text-white placeholder:text-white/70"
                  placeholder={canUserFollowUp ? "اكتب متابعة على الاستفسار" : "اكتب الرد"}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                />
                <input
                  type="file"
                  className="rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-xs text-white"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
                {sendError ? <p className="text-xs text-red-200">{sendError}</p> : null}
                <button
                  type="submit"
                  disabled={sending}
                  className="w-fit rounded-full bg-white px-5 py-2 text-sm font-semibold text-black disabled:opacity-60"
                >
                  {sending ? "جار الإرسال..." : canUserFollowUp ? "إرسال متابعة" : "إرسال"}
                </button>
              </form>
            ) : null}
          </section>
        </div>
      </div>
    </main>
  );
}
