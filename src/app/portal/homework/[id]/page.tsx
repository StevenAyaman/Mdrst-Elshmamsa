"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";

type StoredUser = { role?: string; studentCode?: string; name?: string };

type HomeworkDetail = {
  id: string;
  title?: string;
  subject?: string;
  description?: string;
  dueAt?: string;
  classIds?: string[];
  fileUrl?: string;
  fileName?: string;
  mimeType?: string;
  maxScore?: number;
  submissions?: Array<{
    studentCode?: string;
    studentName?: string;
    className?: string;
    score?: number;
    maxScore?: number;
    updatedAt?: { _seconds?: number };
  }>;
  messages?: Array<{
    message?: string;
    fileUrl?: string;
    fileName?: string;
    mimeType?: string;
    createdAt?: { _seconds?: number; toDate?: () => Date };
    createdBy?: { name?: string; role?: string };
  }>;
  submission?: {
    score?: number;
    maxScore?: number;
    gradedAt?: { _seconds?: number; toDate?: () => Date };
  } | null;
};

function formatDateTime(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("ar-EG");
}

function formatTimestamp(value?: { _seconds?: number; toDate?: () => Date }) {
  if (!value) return "";
  if (value.toDate) return value.toDate().toLocaleString("ar-EG");
  if (typeof value._seconds === "number") {
    return new Date(value._seconds * 1000).toLocaleString("ar-EG");
  }
  return "";
}

export default function HomeworkDetailPage() {
  const router = useRouter();
  const params = useParams();
  const homeworkId = Array.isArray(params?.id)
    ? String(params?.id[0] ?? "")
    : String(params?.id ?? "");
  const [user, setUser] = useState<StoredUser | null>(null);
  const [role, setRole] = useState("");
  const [detail, setDetail] = useState<HomeworkDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [message, setMessage] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [sending, setSending] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);

  const [selectedStudent, setSelectedStudent] = useState("");
  const [parentChildren, setParentChildren] = useState<string[]>([]);
  const [submissionQuery, setSubmissionQuery] = useState("");
  const [gradeValue, setGradeValue] = useState("");
  const [savingGrade, setSavingGrade] = useState(false);
  const [extendDate, setExtendDate] = useState("");
  const [extendTime, setExtendTime] = useState("");
  const [extending, setExtending] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [voiceDraft, setVoiceDraft] = useState<File | null>(null);
  const [showVoiceActions, setShowVoiceActions] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordChunksRef = useRef<BlobPart[]>([]);
  const audioStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationRef = useRef<number | null>(null);
  const [waveLevels, setWaveLevels] = useState<number[]>(Array.from({ length: 28 }, () => 8));
  const isExpiredForStudent = role !== "teacher" && Boolean(detail?.dueAt) && new Date(String(detail?.dueAt)).getTime() < Date.now();

  useEffect(() => {
    const stored = window.localStorage.getItem("dsms:user");
    if (!stored) {
      router.replace("/login");
      return;
    }
    try {
      const parsed = JSON.parse(stored) as StoredUser;
      const normalized = parsed.role === "nzam" ? "system" : parsed.role;
      setUser(parsed);
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
    async function loadParentChildren() {
      if (role !== "parent" || !user?.studentCode) return;
      const res = await fetch(`/api/users?code=${encodeURIComponent(user.studentCode)}`);
      const json = await res.json();
      if (res.ok && json.ok) {
        const list = Array.isArray(json.data?.childrenCodes) ? (json.data.childrenCodes as string[]) : [];
        setParentChildren(list);
        if (!selectedStudent && list.length) setSelectedStudent(list[0]);
      }
    }
    loadParentChildren();
  }, [role, user?.studentCode, selectedStudent]);

  async function loadDetail(studentCodeParam?: string) {
    if (!homeworkId) {
      setError("واجب غير صالح.");
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      setError(null);
      const query = new URLSearchParams();
      if (studentCodeParam) query.set("studentCode", studentCodeParam);
      const res = await fetch(
        `/api/homework/${homeworkId}${query.toString() ? `?${query.toString()}` : ""}`
      );
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(json.message || "تعذر تحميل الواجب.");
        return;
      }
      setDetail(json.data as HomeworkDetail);
    } catch {
      setError("تعذر تحميل الواجب.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!role) return;
    if (role === "parent") {
      if (!selectedStudent) return;
      loadDetail(selectedStudent);
      return;
    }
    if (role === "teacher") {
      if (selectedStudent) {
        loadDetail(selectedStudent);
        return;
      }
      loadDetail();
      return;
    }
    loadDetail();
  }, [role, selectedStudent, homeworkId]);

  useEffect(() => {
    if (role !== "student" && role !== "parent") return;
    const timer = window.setInterval(() => {
      if (role === "parent") {
        if (!selectedStudent) return;
        void loadDetail(selectedStudent);
      } else {
        void loadDetail();
      }
    }, 15000);
    return () => window.clearInterval(timer);
  }, [role, selectedStudent, homeworkId]);

  async function submitMessage(payload: { text?: string; upload?: File | null }) {
    if (!homeworkId) return false;
    const text = String(payload.text ?? "").trim();
    const upload = payload.upload ?? null;
    if (!text && !upload) {
      setSubmitError("اكتب رسالة أو ارفع ملفاً.");
      return false;
    }
    setSubmitError(null);
    setSending(true);
    try {
      const form = new FormData();
      form.append("message", text);
      if (upload) form.append("file", upload);
      if (role === "teacher") {
        if (!selectedStudent) {
          setSubmitError("اختر الطالب أولاً.");
          return false;
        }
        form.append("studentCode", selectedStudent);
      }
      if (role === "parent") {
        if (!selectedStudent) {
          setSubmitError("اختر الطالب أولاً.");
          return false;
        }
        form.append("studentCode", selectedStudent);
      }
      const res = await fetch(`/api/homework/${homeworkId}`, { method: "POST", body: form });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setSubmitError(json.message || "تعذر إرسال الواجب.");
        return false;
      }
      setMessage("");
      setFile(null);
      await loadDetail(role === "parent" || role === "teacher" ? selectedStudent : undefined);
      return true;
    } catch {
      setSubmitError("تعذر إرسال الواجب.");
      return false;
    } finally {
      setSending(false);
    }
  }

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    await submitMessage({ text: message, upload: file });
  }

  function stopWaveAnimation() {
    if (animationRef.current !== null) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }
    analyserRef.current = null;
    if (audioContextRef.current) {
      void audioContextRef.current.close();
      audioContextRef.current = null;
    }
  }

  function stopAudioTracks() {
    if (audioStreamRef.current) {
      audioStreamRef.current.getTracks().forEach((track) => track.stop());
      audioStreamRef.current = null;
    }
  }

  async function toggleVoiceRecord() {
    if (isRecording) {
      mediaRecorderRef.current?.stop();
      return;
    }
    try {
      setVoiceDraft(null);
      setShowVoiceActions(false);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioStreamRef.current = stream;
      const recorder = new MediaRecorder(stream);
      recordChunksRef.current = [];
      const audioContext = new AudioContext();
      audioContextRef.current = audioContext;
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 128;
      source.connect(analyser);
      analyserRef.current = analyser;
      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      const draw = () => {
        const node = analyserRef.current;
        if (!node) return;
        node.getByteFrequencyData(dataArray);
        const bars: number[] = [];
        const barCount = 28;
        const bucket = Math.max(1, Math.floor(dataArray.length / barCount));
        for (let i = 0; i < barCount; i += 1) {
          let sum = 0;
          for (let j = 0; j < bucket; j += 1) {
            sum += dataArray[i * bucket + j] ?? 0;
          }
          const avg = sum / bucket;
          bars.push(Math.max(6, Math.min(42, Math.round((avg / 255) * 42))));
        }
        setWaveLevels(bars);
        animationRef.current = requestAnimationFrame(draw);
      };
      draw();
      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          recordChunksRef.current.push(event.data);
        }
      };
      recorder.onstop = async () => {
        stopWaveAnimation();
        stopAudioTracks();
        const audioBlob = new Blob(recordChunksRef.current, { type: "audio/webm" });
        const audioFile = new File([audioBlob], `voice-${Date.now()}.webm`, {
          type: "audio/webm",
        });
        setIsRecording(false);
        setWaveLevels(Array.from({ length: 28 }, () => 8));
        setVoiceDraft(audioFile);
        setShowVoiceActions(true);
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setIsRecording(true);
    } catch {
      setSubmitError("تعذر تشغيل الميكروفون.");
      stopWaveAnimation();
      stopAudioTracks();
    }
  }

  async function handleSendVoiceDraft() {
    if (!voiceDraft) return;
    const ok = await submitMessage({ text: "", upload: voiceDraft });
    if (ok) {
      setVoiceDraft(null);
      setShowVoiceActions(false);
    }
  }

  function handleCancelVoiceDraft() {
    setVoiceDraft(null);
    setShowVoiceActions(false);
  }

  useEffect(() => {
    return () => {
      mediaRecorderRef.current?.stop();
      stopWaveAnimation();
      stopAudioTracks();
    };
  }, []);

  async function handleDeleteConversation() {
    if (!homeworkId || !selectedStudent) return;
    setDeleting(true);
    try {
      const res = await fetch(
        `/api/homework/${homeworkId}?studentCode=${encodeURIComponent(selectedStudent)}`,
        { method: "DELETE" }
      );
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setSubmitError(json.message || "تعذر حذف المحادثة.");
        return;
      }
      setSelectedStudent("");
      await loadDetail();
    } catch {
      setSubmitError("تعذر حذف المحادثة.");
    } finally {
      setDeleting(false);
    }
  }

  async function handleClearAllSubmissions() {
    if (!homeworkId) return;
    setDeleting(true);
    setSubmitError(null);
    try {
      const res = await fetch(`/api/homework/${homeworkId}?action=clear-submissions`, {
        method: "DELETE",
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setSubmitError(json.message || "تعذر حذف كل التسليمات.");
        return;
      }
      setSelectedStudent("");
      setConfirmClearOpen(false);
      await loadDetail();
    } catch {
      setSubmitError("تعذر حذف كل التسليمات.");
    } finally {
      setDeleting(false);
    }
  }

  const submissionList = useMemo(() => detail?.submissions ?? [], [detail?.submissions]);
  const filteredSubmissions = useMemo(() => {
    if (!submissionQuery.trim()) return submissionList;
    const query = submissionQuery.trim().toLowerCase();
    return submissionList.filter((sub) => {
      const code = String(sub.studentCode ?? "").toLowerCase();
      const name = String(sub.studentName ?? "").toLowerCase();
      const className = String(sub.className ?? "").toLowerCase();
      return code.includes(query) || name.includes(query) || className.includes(query);
    });
  }, [submissionList, submissionQuery]);

  useEffect(() => {
    if (role !== "teacher") return;
    if (!submissionList.length) return;
    if (!selectedStudent) {
      const first = String(submissionList[0]?.studentCode ?? "");
      if (first) setSelectedStudent(first);
    }
  }, [role, submissionList, selectedStudent]);

  useEffect(() => {
    if (role !== "teacher") return;
    if (!selectedStudent) {
      setGradeValue("");
      return;
    }
    const current = submissionList.find(
      (sub) => String(sub.studentCode ?? "") === selectedStudent
    );
    if (current && typeof current.score === "number") {
      setGradeValue(String(current.score));
    } else {
      setGradeValue("");
    }
  }, [role, selectedStudent, submissionList]);

  async function handleSaveGrade() {
    if (!selectedStudent || !detail) return;
    const homeworkMaxScore = Number(detail.maxScore ?? 20);
    const score = Number(gradeValue);
    if (Number.isNaN(score) || score < 0 || score > homeworkMaxScore) {
      setSubmitError(`الدرجة يجب أن تكون بين 0 و ${homeworkMaxScore}.`);
      return;
    }
    setSubmitError(null);
    setSavingGrade(true);
    try {
      const res = await fetch(`/api/homework/${detail.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          studentCode: selectedStudent,
          score,
          maxScore: homeworkMaxScore,
          subject: detail.subject ?? "",
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setSubmitError(json.message || "تعذر حفظ الدرجة.");
        return;
      }
      await loadDetail(selectedStudent);
    } catch {
      setSubmitError("تعذر حفظ الدرجة.");
    } finally {
      setSavingGrade(false);
    }
  }

  async function handleExtendHomework() {
    if (!detail?.id) return;
    if (!extendDate || !extendTime) {
      setSubmitError("من فضلك اختر التاريخ والوقت.");
      return;
    }
    setSubmitError(null);
    setExtending(true);
    try {
      const res = await fetch(`/api/homework/${detail.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dueAt: `${extendDate}T${extendTime}` }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setSubmitError(json.message || "تعذر تمديد الواجب.");
        return;
      }
      const nextDue = `${extendDate}T${extendTime}`;
      setDetail((prev) => (prev ? { ...prev, dueAt: nextDue } : prev));
      setExtendDate("");
      setExtendTime("");
    } catch {
      setSubmitError("تعذر تمديد الواجب.");
    } finally {
      setExtending(false);
    }
  }

  return (
    <main className="min-h-screen px-6 pb-24 pt-10">
      <div className="mx-auto w-full max-w-5xl">
        <header className="mb-8 flex items-center justify-between">
          <h1 className="app-heading mt-2">تفاصيل الواجب</h1>
          <Link
            href="/portal/homework"
            className="back-btn rounded-full border border-black/10 bg-white px-4 py-2 text-sm font-semibold text-[color:var(--ink)] shadow-sm"
          >
            رجوع
          </Link>
        </header>

        {loading ? <p className="text-sm text-white/70">جار التحميل...</p> : null}
        {error ? <p className="text-sm text-red-200">{error}</p> : null}

        {detail ? (
          <div className="grid gap-4">
            <section className="rounded-3xl border border-white/20 bg-white/15 p-6 text-white shadow-[var(--shadow)] backdrop-blur-md">
              <p className="text-lg font-semibold">{detail.title || "واجب"}</p>
              <p className="mt-1 text-sm text-white/80">المادة: {detail.subject || "-"}</p>
              <p className="mt-1 text-sm text-white/80">الدرجة القصوى: {detail.maxScore ?? 20}</p>
              <p className="mt-1 text-sm text-white/80">
                آخر موعد للتسليم: {formatDateTime(detail.dueAt)}
              </p>
              {detail.description ? (
                <p className="mt-3 text-sm text-white/90">{detail.description}</p>
              ) : null}
              {detail.fileUrl ? (
                detail.mimeType && detail.mimeType.startsWith("image/") ? (
                  <img src={detail.fileUrl} alt="" className="mt-3 max-h-80 rounded-2xl object-cover" />
                ) : detail.mimeType && detail.mimeType.startsWith("audio/") ? (
                  <audio src={detail.fileUrl} controls className="mt-3 w-full" />
                ) : (
                  <a
                    href={detail.fileUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-3 inline-flex items-center gap-2 rounded-full border border-white/30 px-3 py-1 text-xs text-white/90"
                  >
                    📎 {detail.fileName || "ملف الواجب"}
                  </a>
                )
              ) : null}
              {role === "teacher" ? (
                <div className="mt-4 grid gap-2 md:grid-cols-2">
                  <label className="grid gap-1 text-xs text-white/80">
                    تمديد (تاريخ)
                    <input
                      type="date"
                      className="rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-sm text-white"
                      value={extendDate}
                      onChange={(e) => setExtendDate(e.target.value)}
                    />
                  </label>
                  <label className="grid gap-1 text-xs text-white/80">
                    تمديد (وقت)
                    <input
                      type="time"
                      className="rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-sm text-white"
                      value={extendTime}
                      onChange={(e) => setExtendTime(e.target.value)}
                    />
                  </label>
                  <button
                    type="button"
                    onClick={handleExtendHomework}
                    disabled={extending}
                    className="w-fit rounded-full bg-white px-4 py-2 text-xs font-semibold text-black disabled:opacity-60"
                  >
                    {extending ? "جار التمديد..." : "تمديد الموعد"}
                  </button>
                </div>
              ) : null}
            </section>

            {role === "teacher" ? (
              <section className="rounded-3xl border border-white/20 bg-white/15 p-6 text-white shadow-[var(--shadow)] backdrop-blur-md">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm text-white/90">تسليمات الطلاب</p>
                  <button
                    type="button"
                    onClick={() => setConfirmClearOpen(true)}
                    className="rounded-full border border-red-200 bg-red-600/90 px-4 py-2 text-xs font-semibold text-white"
                  >
                    حذف كل التسليمات
                  </button>
                </div>
                <input
                  className="mt-3 rounded-2xl border border-white/20 bg-white/10 px-4 py-2 text-xs text-white placeholder:text-white/60"
                  placeholder="ابحث بالكود أو بالاسم أو الفصل"
                  value={submissionQuery}
                  onChange={(e) => setSubmissionQuery(e.target.value)}
                />
                {submissionList.length === 0 ? (
                  <p className="mt-3 text-sm text-white/70">لا توجد تسليمات بعد.</p>
                ) : (
                  <div className="mt-3 grid gap-2">
                    {filteredSubmissions.map((sub) => (
                      <button
                        key={String(sub.studentCode ?? "")}
                        type="button"
                        onClick={() => {
                          const code = String(sub.studentCode ?? "");
                          setSelectedStudent((prev) => (prev === code ? "" : code));
                        }}
                        className={`rounded-2xl border px-4 py-3 text-right text-sm ${
                          selectedStudent === sub.studentCode
                            ? "border-white/60 bg-white/25"
                            : "border-white/20 bg-white/10"
                        }`}
                      >
                        <p className="text-white">
                          {sub.studentName || "طالب"} ({sub.studentCode})
                        </p>
                        {sub.className ? (
                          <p className="mt-1 text-[10px] text-white/70">الفصل: {sub.className}</p>
                        ) : null}
                        {sub.updatedAt ? (
                          <p className="mt-1 text-[10px] text-white/70">
                            آخر تسليم: {formatTimestamp(sub.updatedAt)}
                          </p>
                        ) : null}
                      </button>
                    ))}
                  </div>
                )}
              </section>
            ) : null}

            {(role === "parent" && parentChildren.length > 0) ? (
              <section className="rounded-3xl border border-white/20 bg-white/15 p-6 text-white shadow-[var(--shadow)] backdrop-blur-md">
                <p className="text-sm text-white/90">اختر الطالب</p>
                <select
                  className="mt-2 w-full rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-sm text-white"
                  value={selectedStudent}
                  onChange={(e) => setSelectedStudent(e.target.value)}
                >
                  {parentChildren.map((code) => (
                    <option key={code} value={code} className="text-black">
                      {code}
                    </option>
                  ))}
                </select>
              </section>
            ) : null}

            <section className="rounded-3xl border border-white/20 bg-white/15 p-6 text-white shadow-[var(--shadow)] backdrop-blur-md">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm text-white/90">
                  {role === "teacher" ? "تسليم الطالب المختار" : "تسليم الواجب"}
                </p>
                {role === "teacher" && selectedStudent ? (
                  <button
                    type="button"
                    onClick={handleDeleteConversation}
                    disabled={deleting}
                    className="rounded-full border border-white/40 bg-white/10 p-2 text-xs text-white disabled:opacity-60"
                    title="حذف المحادثة"
                  >
                    <img src="/delete.png" alt="حذف" className="h-5 w-5" />
                  </button>
                ) : null}
              </div>
              {role === "teacher" && !selectedStudent ? (
                <p className="mt-3 text-sm text-white/70">اختر طالباً لعرض التسليم.</p>
              ) : (
                <>
                  {(role === "student" || role === "parent") ? (
                    <div className="mb-3 rounded-2xl border border-white/20 bg-white/10 p-3">
                      {typeof detail.submission?.score === "number" ? (
                        <>
                          <p className="text-sm text-white">
                            درجتك: {detail.submission.score}/{detail.submission.maxScore ?? 20}
                          </p>
                          <p className="mt-1 text-xs text-white/70">
                            آخر تعديل: {formatTimestamp(detail.submission.gradedAt)}
                          </p>
                        </>
                      ) : (
                        <p className="text-sm text-white/80">لم يتم رصد درجة بعد.</p>
                      )}
                    </div>
                  ) : null}
                  {role === "teacher" && selectedStudent ? (
                    <div className="mb-3 flex flex-wrap items-end gap-2">
                      <label className="grid gap-1 text-xs text-white/80">
                        الدرجة (من {detail.maxScore ?? 20})
                        <input
                          type="number"
                          min={0}
                          max={detail.maxScore ?? 20}
                          className="w-28 rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-sm text-white"
                          value={gradeValue}
                          onChange={(e) => setGradeValue(e.target.value)}
                        />
                      </label>
                      <button
                        type="button"
                        onClick={handleSaveGrade}
                        disabled={savingGrade}
                        className="rounded-full bg-white px-4 py-2 text-xs font-semibold text-black disabled:opacity-60"
                      >
                        {savingGrade ? "جار الحفظ..." : "حفظ الدرجة"}
                      </button>
                    </div>
                  ) : null}
                  <div className="mt-3 grid gap-3">
                    {(detail.messages ?? []).length === 0 ? (
                      <p className="text-sm text-white/70">لا توجد رسائل بعد.</p>
                    ) : (
                      (detail.messages ?? []).map((msg, index) => (
                        <div key={index} className="rounded-2xl border border-white/20 bg-white/10 p-3 text-sm">
                      <p className="text-[18px] text-white/80">{msg.message}</p>
                      {msg.fileUrl ? (
                        msg.mimeType && msg.mimeType.startsWith("image/") ? (
                          <img src={msg.fileUrl} alt="" className="mt-2 max-h-64 rounded-2xl object-cover" />
                        ) : msg.mimeType && msg.mimeType.startsWith("audio/") ? (
                          <audio src={msg.fileUrl} controls className="mt-2 w-full" />
                        ) : msg.mimeType && msg.mimeType.startsWith("video/") ? (
                          <video
                            src={msg.fileUrl}
                            controls
                            className="mt-2 w-full max-h-80 rounded-2xl bg-black/40"
                          />
                        ) : (
                          <a
                            href={msg.fileUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-2 inline-flex items-center gap-2 rounded-full border border-white/30 px-3 py-1 text-xs text-white/90"
                          >
                            📎 {msg.fileName || "ملف"}
                          </a>
                        )
                      ) : null}
                      <p className="mt-2 text-[11px] text-white/70">
                        {msg.createdBy?.name ? `— ${msg.createdBy?.name}` : ""}
                      </p>
                    </div>
                      ))
                    )}
                  </div>

                  {isExpiredForStudent ? (
                    <p className="mt-4 text-sm text-orange-200">
                      انتهى موعد التسليم. يمكنك عرض الواجب والتسليمات فقط.
                    </p>
                  ) : (
                    <form onSubmit={handleSend} className="mt-4 grid gap-3">
                      <textarea
                        className="min-h-[100px] rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-sm text-white placeholder:text-white/70"
                        placeholder={role === "teacher" ? "اكتب ملاحظة أو تصحيح" : "اكتب ملاحظة أو إجابة"}
                        value={message}
                        onChange={(e) => setMessage(e.target.value)}
                      />
                      <input
                        type="file"
                        className="rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-xs text-white"
                        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                      />
                      <div className="relative inline-flex w-fit items-center gap-2">
                        <button
                          type="button"
                          onClick={toggleVoiceRecord}
                          className={`rounded-full border border-white/40 p-2 ${
                            isRecording ? "bg-red-600/80" : "bg-white/10"
                          }`}
                          title={isRecording ? "إيقاف التسجيل" : "تسجيل صوتي"}
                        >
                          <img src="/record.png" alt="تسجيل" className="h-6 w-6" />
                        </button>
                        {isRecording ? <span className="text-xs text-red-100">جاري التسجيل...</span> : null}

                        {isRecording ? (
                          <div className="absolute right-full z-10 mr-2 flex h-12 items-end gap-1 rounded-2xl border border-white/20 bg-black/40 px-3 py-2 backdrop-blur-md">
                            {waveLevels.map((level, index) => (
                              <span
                                key={index}
                                className="w-1 rounded-full bg-red-300/90 transition-all duration-75"
                                style={{ height: `${level}px` }}
                              />
                            ))}
                          </div>
                        ) : null}

                        {showVoiceActions && voiceDraft ? (
                          <div className="absolute right-full z-10 mr-2 flex items-center gap-2 rounded-2xl border border-white/20 bg-black/40 px-3 py-2 backdrop-blur-md">
                            <button
                              type="button"
                              onClick={handleSendVoiceDraft}
                              disabled={sending}
                              className="rounded-full bg-emerald-500 px-3 py-1 text-xs font-semibold text-white disabled:opacity-60"
                            >
                              إرسال
                            </button>
                            <button
                              type="button"
                              onClick={handleCancelVoiceDraft}
                              className="rounded-full bg-white/20 px-3 py-1 text-xs font-semibold text-white"
                            >
                              إلغاء
                            </button>
                          </div>
                        ) : null}
                      </div>
                      {submitError ? <p className="text-xs text-red-200">{submitError}</p> : null}
                      <button
                        type="submit"
                        disabled={sending}
                        className="w-fit rounded-full bg-white px-5 py-2 text-sm font-semibold text-black disabled:opacity-60"
                      >
                        {sending ? "جار الإرسال..." : "إرسال"}
                      </button>
                    </form>
                  )}
                </>
              )}
            </section>
          </div>
        ) : null}
      </div>

      {confirmClearOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-sm rounded-3xl border border-white/20 bg-white p-6 text-black shadow-[var(--shadow)]">
            <p className="text-base font-semibold">تأكيد الحذف</p>
            <p className="mt-2 text-sm text-black/70">
              هل تريد حذف كل تسليمات هذا الواجب؟ لن يتم حذف الواجب نفسه.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                className="rounded-full border border-black/10 px-4 py-2 text-sm font-semibold"
                onClick={() => setConfirmClearOpen(false)}
                disabled={deleting}
              >
                إلغاء
              </button>
              <button
                type="button"
                className="rounded-full bg-red-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                onClick={handleClearAllSubmissions}
                disabled={deleting}
              >
                {deleting ? "جار الحذف..." : "حذف"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
