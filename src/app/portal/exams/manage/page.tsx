"use client";

import BackButton from "@/app/back-button";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { storage } from "@/lib/firebase/client";
import { getDownloadURL, ref as storageRef, uploadBytes } from "firebase/storage";

type StoredUser = {
  role?: string;
  studentCode?: string;
};

type ExamItem = {
  id: string;
  title?: string;
  subject?: string;
  classId?: string;
  questionCount?: number;
  submissionsCount?: number;
};

type QuestionDraft = {
  id: string;
  type: "mcq" | "image" | "text" | "order" | "match";
  text: string;
  options: string[];
  orderItems: string[];
  matchRows: string[];
  matchOptions: string[];
  matchCorrectIndices: number[];
  correctIndices: number[];
  timeLimitSeconds: string;
  imageUrl?: string;
  imagePreviewUrl?: string;
  points: string;
};

const SUBJECTS = ["طقس", "اجبيه", "قطمارس", "الحان", "قبطي"];

function randomId() {
  return Math.random().toString(36).slice(2, 9);
}

export default function ExamsManagePage() {
  const router = useRouter();
  const [actorRole] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    try {
      const stored = window.localStorage.getItem("dsms:user");
      if (!stored) return "";
      const parsed = JSON.parse(stored) as { role?: string };
      return String(parsed.role ?? "").trim().toLowerCase();
    } catch {
      return "";
    }
  });
  const normalizedRole = actorRole === "nzam" ? "system" : actorRole;
  const [role, setRole] = useState("");
  const [userCode, setUserCode] = useState("");
  const [subjects, setSubjects] = useState<string[]>([]);
  const [selectedSubject, setSelectedSubject] = useState("");
  const [classes, setClasses] = useState<string[]>([]);
  const [exams, setExams] = useState<ExamItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [classId, setClassId] = useState("");
  const [startAt, setStartAt] = useState("");
  const [endAt, setEndAt] = useState("");
  const [examRules, setExamRules] = useState("");
  const [showAnswers] = useState(false);
  const [showScores] = useState(false);
  const [questions, setQuestions] = useState<QuestionDraft[]>([]);
  const [saving, setSaving] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [deletingId, setDeletingId] = useState("");
  const [editingExamId, setEditingExamId] = useState<string | null>(null);
  const [editingDraft, setEditingDraft] = useState(false);

  useEffect(() => {
    const stored = window.localStorage.getItem("dsms:user");
    if (!stored) {
      router.replace("/login");
      return;
    }
    try {
      const parsed = JSON.parse(stored) as StoredUser;
      const normalized = parsed.role === "nzam" ? "system" : parsed.role;
      const nextRole = String(normalized ?? "");
      if (!["admin", "teacher"].includes(nextRole)) {
        router.replace(`/portal/${nextRole || "student"}`);
        return;
      }
      setRole(nextRole);
      setUserCode(String(parsed.studentCode ?? ""));
    } catch {
      router.replace("/login");
    }
  }, [router]);

  useEffect(() => {
    async function loadMeta() {
      if (!role) return;
      try {
        const userRes = await fetch(`/api/users?code=${encodeURIComponent(userCode)}`);
        const userJson = await userRes.json();
        if (userRes.ok && userJson.ok) {
          const userSubjects = Array.isArray(userJson.data?.subjects)
            ? (userJson.data.subjects as string[])
            : [];
          const availableSubjects = role === "admin" ? SUBJECTS : userSubjects;
          setSubjects(availableSubjects);
          setSelectedSubject(availableSubjects[0] || "");
          const classes = Array.isArray(userJson.data?.classes)
            ? (userJson.data.classes as string[])
            : [];
          setClasses(classes);
          if (!classId && classes.length) setClassId(classes[0]);
        }
        if (role === "admin") {
          const classesRes = await fetch("/api/classes");
          const classesJson = await classesRes.json();
          if (classesRes.ok && classesJson.ok) {
            const list = (classesJson.data as { id: string }[]) ?? [];
            const ids = list.map((c) => c.id);
            setClasses(ids);
            if (!classId && ids.length) setClassId(ids[0]);
          }
        }
      } catch {
        // ignore
      }
    }
    loadMeta();
  }, [role, userCode, classId]);

  useEffect(() => {
    async function loadExams() {
      if (!selectedSubject) return;
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/exams?subject=${encodeURIComponent(selectedSubject)}`);
        const json = await res.json();
        if (res.ok && json.ok) {
          setExams((json.data as ExamItem[]) ?? []);
        } else {
          setError(json?.message || "تعذر تحميل الاختبارات.");
        }
      } catch {
        setError("تعذر تحميل الاختبارات.");
      } finally {
        setLoading(false);
      }
    }
    loadExams();
  }, [selectedSubject]);

  function addQuestion(type: "mcq" | "image" | "text" | "order" | "match") {
    setQuestions((prev) => [
      ...prev,
      {
        id: randomId(),
        type,
        text: "",
        options: ["", "", "", ""],
        orderItems: ["", ""],
        matchRows: ["", ""],
        matchOptions: ["", ""],
        matchCorrectIndices: [0, 0],
        correctIndices: [0],
        timeLimitSeconds: "30",
        imageUrl: "",
        imagePreviewUrl: "",
        points: "1",
      },
    ]);
  }

  function updateQuestion(id: string, patch: Partial<QuestionDraft>) {
    setQuestions((prev) => prev.map((q) => (q.id === id ? { ...q, ...patch } : q)));
  }

  function removeQuestion(id: string) {
    setQuestions((prev) => {
      const target = prev.find((q) => q.id === id);
      if (target?.imagePreviewUrl) {
        URL.revokeObjectURL(target.imagePreviewUrl);
      }
      return prev.filter((q) => q.id !== id);
    });
  }

  async function handleSaveDraft() {
    setError(null);
    if (!title.trim() || !selectedSubject || !classId) {
      setError("برجاء إدخال عنوان الامتحان والمادة والفصل.");
      return;
    }
    const prepared = questions.map((q) => ({
      type: q.type,
      text: q.text.trim(),
      options: q.type === "mcq" ? q.options.map((o) => o.trim()) : [],
      orderItems: q.type === "order" ? q.orderItems.map((o) => o.trim()) : [],
      matchRows: q.type === "match" ? q.matchRows.map((r) => r.trim()) : [],
      matchOptions: q.type === "match" ? q.matchOptions.map((c) => c.trim()) : [],
      matchCorrectIndices: q.type === "match" ? q.matchCorrectIndices : [],
      correctIndices: q.correctIndices,
      timeLimitSeconds: Number(q.timeLimitSeconds || 0),
      imageUrl: q.imageUrl ?? "",
      points: Number(q.points || 0),
    }));
    setDrafting(true);
    try {
      const payload = {
        title: title.trim(),
        subject: selectedSubject,
        classId,
        startAt,
        endAt,
        examRules: examRules.trim(),
        showAnswers: false,
        showScores: false,
        questions: prepared,
        status: "draft",
      };
      const res = await fetch(editingExamId ? `/api/exams/${editingExamId}` : "/api/exams", {
        method: editingExamId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(json?.message || "تعذر حفظ المسودة.");
        return;
      }
      setEditingExamId(json?.data?.id ?? editingExamId);
      setEditingDraft(true);
      const reload = await fetch(`/api/exams?subject=${encodeURIComponent(selectedSubject)}`);
      const reloadJson = await reload.json();
      if (reload.ok && reloadJson.ok) {
        setExams((reloadJson.data as ExamItem[]) ?? []);
      }
    } catch {
      setError("تعذر حفظ المسودة.");
    } finally {
      setDrafting(false);
    }
  }

  async function handleCreateExam() {
    setError(null);
    if (!title.trim() || !selectedSubject || !classId || questions.length === 0) {
      setError("برجاء إدخال عنوان الامتحان والمادة والفصل وإضافة أسئلة.");
      return;
    }
    if (!startAt || !endAt) {
      setError("برجاء إدخال تاريخ ووقت بداية ونهاية الامتحان.");
      return;
    }
    if (!examRules.trim()) {
      setError("برجاء إدخال لائحة الاختبار.");
      return;
    }
    if (new Date(startAt).getTime() >= new Date(endAt).getTime()) {
      setError("وقت نهاية الامتحان يجب أن يكون بعد وقت البداية.");
      return;
    }
    const prepared = questions.map((q) => ({
      type: q.type,
      text: q.text.trim(),
      options: q.type === "mcq" ? q.options.map((o) => o.trim()) : [],
      orderItems: q.type === "order" ? q.orderItems.map((o) => o.trim()) : [],
      matchRows: q.type === "match" ? q.matchRows.map((r) => r.trim()) : [],
      matchOptions: q.type === "match" ? q.matchOptions.map((c) => c.trim()) : [],
      matchCorrectIndices: q.type === "match" ? q.matchCorrectIndices : [],
      correctIndices: q.correctIndices,
      timeLimitSeconds: Number(q.timeLimitSeconds),
      imageUrl: q.imageUrl ?? "",
      points: Number(q.points),
    }));
    if (prepared.some((q) => !q.text || q.timeLimitSeconds <= 0)) {
      setError("برجاء إدخال نص السؤال والوقت لكل سؤال.");
      return;
    }
    if (prepared.some((q) => !Number.isFinite(q.points) || q.points <= 0)) {
      setError("برجاء إدخال درجة السؤال.");
      return;
    }
    if (
      prepared.some(
        (q) =>
          q.type === "mcq" &&
          (q.options.length < 2 || q.options.length > 5 || q.options.some((o) => !o)),
      )
    ) {
      setError("أسئلة الاختيار المتعدد تحتاج من 2 إلى 5 خيارات صحيحة.");
      return;
    }
    if (prepared.some((q) => q.type === "order" && (q.orderItems.length < 2 || q.orderItems.some((o) => !o)))) {
      setError("سؤال الترتيب يحتاج على الأقل عنصرين معبأين.");
      return;
    }
    if (
      prepared.some(
        (q) =>
          q.type === "match" &&
          (q.matchRows.length < 2 ||
            q.matchOptions.length < 2 ||
            q.matchRows.some((r) => !r) ||
            q.matchOptions.some((c) => !c) ||
            q.matchCorrectIndices.length !== q.matchRows.length),
      )
    ) {
      setError("سؤال التوصيل يحتاج صفّين على الأقل وخيارات صحيحة لكل صف.");
      return;
    }
    if (
      prepared.some(
        (q) => q.type === "mcq" && (q.correctIndices?.length ?? 0) === 0,
      )
    ) {
      setError("برجاء تحديد الإجابة الصحيحة لكل سؤال.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(editingExamId ? `/api/exams/${editingExamId}` : "/api/exams", {
        method: editingExamId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          subject: selectedSubject,
          classId,
          startAt,
          endAt,
          examRules: examRules.trim(),
          showAnswers,
          showScores,
          questions: prepared,
          status: "published",
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(json?.message || "تعذر إنشاء الامتحان.");
        return;
      }
      setTitle("");
      setStartAt("");
      setEndAt("");
      setExamRules("");
      setQuestions([]);
      setEditingExamId(null);
      setEditingDraft(false);
      const reload = await fetch(`/api/exams?subject=${encodeURIComponent(selectedSubject)}`);
      const reloadJson = await reload.json();
      if (reload.ok && reloadJson.ok) {
        setExams((reloadJson.data as ExamItem[]) ?? []);
      }
    } catch {
      setError("تعذر إنشاء الامتحان.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteExam(examId: string) {
    if (!examId) return;
    const ok = window.confirm("سيتم حذف الامتحان وجميع التسليمات المرتبطة به. هل أنت متأكد؟");
    if (!ok) return;
    setDeletingId(examId);
    setError(null);
    try {
      const res = await fetch(`/api/exams/${examId}`, { method: "DELETE" });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(json?.message || "تعذر حذف الامتحان.");
        return;
      }
      setExams((prev) => prev.filter((item) => item.id !== examId));
    } catch {
      setError("تعذر حذف الامتحان.");
    } finally {
      setDeletingId("");
    }
  }

  async function handleEditDraft(examId: string) {
    if (!examId) return;
    setError(null);
    try {
      const res = await fetch(`/api/exams/${examId}`);
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(json?.message || "تعذر تحميل المسودة.");
        return;
      }
      const exam = json.data?.exam ?? {};
      const fetchedQuestions = Array.isArray(json.data?.questions) ? json.data.questions : [];
      setTitle(String(exam.title ?? ""));
      setSelectedSubject(String(exam.subject ?? ""));
      setClassId(String(exam.classId ?? ""));
      setStartAt(String(exam.startAt ?? ""));
      setEndAt(String(exam.endAt ?? ""));
      setExamRules(String(exam.examRules ?? ""));
      // تعطيل عرض الإجابات الصحيحة للطلاب دائماً
      // تعطيل عرض الدرجات للطلاب دائماً
      setQuestions(
        fetchedQuestions.map((q: Record<string, unknown>) => {
          const type = String(q.type ?? "mcq") as QuestionDraft["type"];
          const options = Array.isArray(q.options) ? q.options.map((o) => String(o ?? "")) : [];
          const correctOptions = Array.isArray(q.correctOptions)
            ? q.correctOptions.map((o) => String(o ?? ""))
            : [];
          const correctIndices =
            type === "mcq"
              ? options
                  .map((opt, idx) => (correctOptions.includes(opt) ? idx : -1))
                  .filter((idx) => idx >= 0)
              : [0];
          return {
            id: String(q.id ?? randomId()),
            type,
            text: String(q.text ?? ""),
            options: type === "mcq" ? options : ["", "", "", ""],
            orderItems: type === "order" && Array.isArray(q.orderItems) ? q.orderItems.map((o) => String(o ?? "")) : ["", ""],
            matchRows: type === "match" && Array.isArray(q.matchRows) ? q.matchRows.map((r) => String(r ?? "")) : ["", ""],
            matchOptions:
              type === "match" && Array.isArray(q.matchOptions) ? q.matchOptions.map((c) => String(c ?? "")) : ["", ""],
            matchCorrectIndices:
              type === "match" && Array.isArray(q.matchCorrectIndices) ? q.matchCorrectIndices.map((v) => Number(v ?? 0)) : [0, 0],
            correctIndices,
            timeLimitSeconds: String(q.timeLimitSeconds ?? "30"),
            imageUrl: String(q.imageUrl ?? ""),
            imagePreviewUrl: "",
            points: String(q.points ?? "1"),
          } as QuestionDraft;
        }),
      );
      setEditingExamId(examId);
      setEditingDraft(String(exam.status ?? "") === "draft");
    } catch {
      setError("تعذر تحميل المسودة.");
    }
  }

  return (
    <main className="min-h-screen px-6 pb-24 pt-10">
      <section className="mx-auto w-full max-w-5xl space-y-6">
        <header className="flex items-center justify-between">
          <BackButton fallbackHref={`/portal/${role || "teacher"}`} className="back-btn" />
          <h1 className="app-heading">إدارة الاختبارات</h1>
          <div className="h-8 w-8" />
        </header>

        <div className="rounded-3xl border border-white/20 bg-white/15 p-4 text-white shadow-[var(--shadow)] backdrop-blur-md">
          <div className="flex flex-wrap gap-2">
            {subjects.map((subject) => (
              <button
                key={subject}
                type="button"
                onClick={() => setSelectedSubject(subject)}
                className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                  selectedSubject === subject
                    ? "bg-white text-[color:var(--ink)]"
                    : "border border-white/20 text-white/80 hover:bg-white/10"
                }`}
              >
                {subject}
              </button>
            ))}
          </div>
        </div>

        {error ? <p className="text-sm text-red-200">{error}</p> : null}

        <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
        <div className="rounded-3xl border border-white/20 bg-white/10 p-6 text-white shadow-[var(--shadow)] backdrop-blur-md">
            <h2 className="text-lg font-semibold mb-4">الاختبارات الحالية</h2>
            {loading ? (
              <div className="grid gap-3">
                {Array.from({ length: 3 }).map((_, idx) => (
                  <div key={`s-${idx}`} className="h-20 rounded-2xl bg-white/10 animate-pulse" />
                ))}
              </div>
            ) : exams.length === 0 ? (
              <p className="text-sm text-white/70">لا توجد اختبارات بعد.</p>
            ) : (
              <div className="grid gap-3">
                {exams.map((exam) => (
                  <div
                    key={exam.id}
                    className="rounded-2xl border border-white/20 bg-white/10 p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-base font-semibold">{exam.title}</p>
                        <p className="text-xs text-white/70">
                          الفصل {exam.classId} · {exam.questionCount ?? 0} سؤال
                        </p>
                        <p className="text-xs text-white/60 mt-1">
                          تم التسليم: {exam.submissionsCount ?? 0}
                        </p>
                        {String((exam as { status?: string }).status ?? "") === "draft" ? (
                          <span className="mt-2 inline-flex rounded-full border border-amber-300/40 bg-amber-200/10 px-2 py-0.5 text-[10px] text-amber-200">
                            مسودة
                          </span>
                        ) : null}
                      </div>
                      <div className="flex items-center gap-2">
                        {String((exam as { status?: string }).status ?? "") === "draft" ? (
                          <button
                            type="button"
                            onClick={() => handleEditDraft(exam.id)}
                            className="rounded-full border border-white/30 px-3 py-1 text-xs text-white/80 hover:bg-white/10"
                          >
                            تعديل المسودة
                          </button>
                        ) : null}
                        <a
                          href={`/portal/exams/${exam.id}/submissions`}
                          className="rounded-full border border-white/30 px-3 py-1 text-xs text-white/80 hover:bg-white/10"
                        >
                          عرض التسليمات
                        </a>
                        <button
                          type="button"
                          onClick={() => handleDeleteExam(exam.id)}
                          disabled={deletingId === exam.id}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/20 bg-white/10 hover:bg-white/20 disabled:opacity-60"
                          title="حذف الامتحان"
                        >
                          <img src="/delete-2.png" alt="" className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-3xl border border-white/20 bg-white/10 p-6 text-white shadow-[var(--shadow)] backdrop-blur-md">
            <h2 className="text-lg font-semibold mb-4">إنشاء امتحان جديد</h2>
            <div className="grid gap-3">
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="عنوان الامتحان"
                className="w-full rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-sm text-white"
              />
              <div className="grid gap-3 md:grid-cols-2">
                <div className="grid gap-2">
                  <label className="text-xs text-white/70">بداية الاختبار</label>
                  <input
                    type="datetime-local"
                    value={startAt}
                    onChange={(e) => setStartAt(e.target.value)}
                    className="w-full min-w-0 rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-sm text-white"
                  />
                </div>
                <div className="grid gap-2">
                  <label className="text-xs text-white/70">نهاية الاختبار</label>
                  <input
                    type="datetime-local"
                    value={endAt}
                    onChange={(e) => setEndAt(e.target.value)}
                    className="w-full min-w-0 rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-sm text-white"
                  />
                </div>
              </div>
              <div className="grid gap-2">
                <label className="text-xs text-white/70">لائحة الاختبار</label>
                <textarea
                  value={examRules}
                  onChange={(e) => setExamRules(e.target.value)}
                  placeholder="اكتب تعليمات الامتحان التي يجب أن يوافق عليها الطالب قبل البدء..."
                  className="min-h-[110px] w-full rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-sm text-white"
                />
              </div>
                {/* تم تعطيل خيار عرض الإجابات الصحيحة للطلاب */}
              <div className="grid gap-3 md:grid-cols-2">
                <select
                  value={selectedSubject}
                  onChange={(e) => setSelectedSubject(e.target.value)}
                  className="w-full rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-sm text-white"
                >
                  {subjects.map((subject) => (
                    <option key={subject} value={subject} className="text-black">
                      {subject}
                    </option>
                  ))}
                </select>
                <select
                  value={classId}
                  onChange={(e) => setClassId(e.target.value)}
                  className="w-full rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-sm text-white"
                >
                  {classes.map((cls) => (
                    <option key={cls} value={cls} className="text-black">
                      {cls}
                    </option>
                  ))}
                </select>
              </div>
                <div className="grid gap-2">
                  <button
                    type="button"
                    onClick={() => addQuestion("mcq")}
                    className="w-full rounded-full border border-white/30 px-4 py-2 text-xs text-white/80 hover:bg-white/10"
                  >
                    إضافة سؤال اختيار من متعدد
                  </button>
                  <button
                    type="button"
                    onClick={() => addQuestion("image")}
                    className="w-full rounded-full border border-white/30 px-4 py-2 text-xs text-white/80 hover:bg-white/10"
                  >
                    إضافة سؤال صور
                  </button>
                  <button
                    type="button"
                    onClick={() => addQuestion("text")}
                    className="w-full rounded-full border border-white/30 px-4 py-2 text-xs text-white/80 hover:bg-white/10"
                  >
                    إضافة سؤال نص
                  </button>
                  <button
                    type="button"
                    onClick={() => addQuestion("order")}
                    className="w-full rounded-full border border-white/30 px-4 py-2 text-xs text-white/80 hover:bg-white/10"
                  >
                    إضافة سؤال ترتيب
                  </button>
                  <button
                    type="button"
                    onClick={() => addQuestion("match")}
                    className="w-full rounded-full border border-white/30 px-4 py-2 text-xs text-white/80 hover:bg-white/10"
                  >
                    إضافة سؤال توصيل
                  </button>
                </div>
            </div>
            <div className="mt-4 grid gap-4">
              {questions.map((q, index) => (
                <div key={q.id} className="rounded-2xl border border-white/15 bg-white/5 p-4">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold">سؤال {index + 1}</p>
                    <button
                      type="button"
                      onClick={() => removeQuestion(q.id)}
                      className="text-xs text-red-200 hover:text-red-100"
                    >
                      حذف
                    </button>
                  </div>
                  <div className="mt-3">
                    <label className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-white/30 px-3 py-2 text-xs text-white/80 hover:bg-white/10">
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={async (e) => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          try {
                            if (q.imagePreviewUrl) {
                              URL.revokeObjectURL(q.imagePreviewUrl);
                            }
                            const previewUrl = URL.createObjectURL(file);
                            updateQuestion(q.id, { imagePreviewUrl: previewUrl });
                            const objectName = `${Date.now()}_${file.name.replace(/\s+/g, "_")}`;
                            const uploadRef = storageRef(
                              storage,
                              `exam-questions/${userCode}/${q.id}/${objectName}`,
                            );
                            await uploadBytes(uploadRef, file);
                            const url = await getDownloadURL(uploadRef);
                            updateQuestion(q.id, { imageUrl: url });
                          } catch {
                            setError("تعذر رفع صورة السؤال.");
                          }
                        }}
                      />
                      إضافة صورة للسؤال
                    </label>
                    {q.imageUrl || q.imagePreviewUrl ? (
                      <div className="relative mt-2 w-full">
                        <img
                          src={q.imageUrl || q.imagePreviewUrl}
                          alt=""
                          className="h-44 w-full rounded-xl object-contain bg-white/5"
                        />
                        {normalizedRole === "admin" || normalizedRole === "teacher" ? (
                          <button
                            type="button"
                            onClick={() => {
                              if (q.imagePreviewUrl) {
                                URL.revokeObjectURL(q.imagePreviewUrl);
                              }
                              updateQuestion(q.id, { imageUrl: "", imagePreviewUrl: "" });
                            }}
                            className="absolute -left-2 -top-2 grid h-7 w-7 place-items-center rounded-full bg-black/70 text-xs text-white transition hover:bg-black"
                            aria-label="حذف الصورة"
                          >
                            ✕
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                  <input
                    value={q.text}
                    onChange={(e) => updateQuestion(q.id, { text: e.target.value })}
                    placeholder="نص السؤال"
                    className="mt-3 w-full rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-sm text-white"
                  />
                  <div className="mt-3 flex items-center gap-3 text-xs">
                    <span className="text-white/70">وقت السؤال (ث):</span>
                    <input
                      value={q.timeLimitSeconds}
                      onChange={(e) => updateQuestion(q.id, { timeLimitSeconds: e.target.value })}
                      className="w-24 rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-sm text-white"
                    />
                    <span className="text-white/70">درجة السؤال:</span>
                    <input
                      value={q.points}
                      onChange={(e) => updateQuestion(q.id, { points: e.target.value })}
                      className="w-20 rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-sm text-white"
                    />
                  </div>
                  {q.type === "mcq" ? (
                    <div className="mt-3 grid gap-2">
                      {q.options.map((opt, optIndex) => (
                        <label key={`${q.id}-${optIndex}`} className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={q.correctIndices.includes(optIndex)}
                            onChange={(e) => {
                              const current = new Set(q.correctIndices);
                              if (e.target.checked) {
                                current.add(optIndex);
                              } else {
                                current.delete(optIndex);
                              }
                              updateQuestion(q.id, { correctIndices: Array.from(current) });
                            }}
                          />
                          <input
                            value={opt}
                            onChange={(e) => {
                              const next = [...q.options];
                              next[optIndex] = e.target.value;
                              updateQuestion(q.id, { options: next });
                            }}
                            placeholder={`الاختيار ${optIndex + 1}`}
                            className="w-full rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-sm text-white"
                          />
                          <button
                            type="button"
                            onClick={() => {
                              if (q.options.length <= 2) return;
                              const next = q.options.filter((_, idx) => idx !== optIndex);
                              const nextCorrect = q.correctIndices
                                .filter((idx) => idx !== optIndex)
                                .map((idx) => (idx > optIndex ? idx - 1 : idx));
                              updateQuestion(q.id, { options: next, correctIndices: nextCorrect });
                            }}
                            className="ml-2 inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/20 bg-white/10 hover:bg-white/20"
                            title="حذف الاختيار"
                          >
                            <img src="/delete-2.png" alt="" className="h-4 w-4" />
                          </button>
                        </label>
                      ))}
                      {q.options.length < 5 ? (
                        <button
                          type="button"
                          onClick={() => updateQuestion(q.id, { options: [...q.options, ""] })}
                          className="self-start rounded-full border border-white/30 px-4 py-2 text-xs text-white/80 hover:bg-white/10"
                        >
                          إضافة اختيار
                        </button>
                      ) : null}
                    </div>
                  ) : q.type === "order" ? (
                    <div className="mt-3 grid gap-2">
                      {q.orderItems.map((item, itemIndex) => (
                        <label key={`${q.id}-order-${itemIndex}`} className="flex items-center gap-2">
                          <input
                            value={item}
                            onChange={(e) => {
                              const next = [...q.orderItems];
                              next[itemIndex] = e.target.value;
                              updateQuestion(q.id, { orderItems: next });
                            }}
                            placeholder={`البند ${itemIndex + 1}`}
                            className="w-full rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-sm text-white"
                          />
                          <button
                            type="button"
                            onClick={() => {
                              if (q.orderItems.length <= 2) return;
                              const next = q.orderItems.filter((_, idx) => idx !== itemIndex);
                              updateQuestion(q.id, { orderItems: next });
                            }}
                            className="ml-2 inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/20 bg-white/10 hover:bg-white/20"
                            title="حذف البند"
                          >
                            <img src="/delete-2.png" alt="" className="h-4 w-4" />
                          </button>
                        </label>
                      ))}
                      <button
                        type="button"
                        onClick={() => updateQuestion(q.id, { orderItems: [...q.orderItems, ""] })}
                        className="self-start rounded-full border border-white/30 px-4 py-2 text-xs text-white/80 hover:bg-white/10"
                      >
                        إضافة بند
                      </button>
                    </div>
                  ) : q.type === "match" ? (
                    <div className="mt-3 grid gap-4">
                      <div className="grid gap-2">
                        <p className="text-xs text-white/70">عمود السؤال (على الشمال)</p>
                        {q.matchRows.map((row, rowIndex) => (
                          <label key={`${q.id}-row-${rowIndex}`} className="flex items-center gap-2">
                            <input
                              value={row}
                              onChange={(e) => {
                                const next = [...q.matchRows];
                                next[rowIndex] = e.target.value;
                                updateQuestion(q.id, { matchRows: next });
                              }}
                              placeholder={`الصف ${rowIndex + 1}`}
                              className="w-full rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-sm text-white"
                            />
                            <select
                              value={q.matchCorrectIndices[rowIndex] ?? 0}
                              onChange={(e) => {
                                const next = [...q.matchCorrectIndices];
                                next[rowIndex] = Number(e.target.value ?? 0);
                                updateQuestion(q.id, { matchCorrectIndices: next });
                              }}
                              className="min-w-[140px] rounded-xl border border-white/20 bg-white/10 px-2 py-2 text-xs text-white"
                            >
                              {q.matchOptions.map((opt, optIndex) => (
                                <option key={`${q.id}-match-opt-${optIndex}`} value={optIndex} className="text-black">
                                  {opt || `الخيار ${optIndex + 1}`}
                                </option>
                              ))}
                            </select>
                            <button
                              type="button"
                              onClick={() => {
                                if (q.matchRows.length <= 2) return;
                                const next = q.matchRows.filter((_, idx) => idx !== rowIndex);
                                const nextCorrect = q.matchCorrectIndices.filter((_, idx) => idx !== rowIndex);
                                updateQuestion(q.id, { matchRows: next, matchCorrectIndices: nextCorrect });
                              }}
                              className="ml-2 inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/20 bg-white/10 hover:bg-white/20"
                              title="حذف الصف"
                            >
                              <img src="/delete-2.png" alt="" className="h-4 w-4" />
                            </button>
                          </label>
                        ))}
                        <button
                          type="button"
                          onClick={() =>
                            updateQuestion(q.id, {
                              matchRows: [...q.matchRows, ""],
                              matchCorrectIndices: [...q.matchCorrectIndices, 0],
                            })
                          }
                          className="self-start rounded-full border border-white/30 px-4 py-2 text-xs text-white/80 hover:bg-white/10"
                        >
                          إضافة صف
                        </button>
                      </div>
                      <div className="grid gap-2">
                        <p className="text-xs text-white/70">الاختيارات (على اليمين)</p>
                        {q.matchOptions.map((col, colIndex) => (
                          <label key={`${q.id}-col-${colIndex}`} className="flex items-center gap-2">
                            <input
                              value={col}
                              onChange={(e) => {
                                const next = [...q.matchOptions];
                                next[colIndex] = e.target.value;
                                updateQuestion(q.id, { matchOptions: next });
                              }}
                              placeholder={`العمود ${colIndex + 1}`}
                              className="w-full rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-sm text-white"
                            />
                            <button
                              type="button"
                              onClick={() => {
                                if (q.matchOptions.length <= 2) return;
                                const next = q.matchOptions.filter((_, idx) => idx !== colIndex);
                                const nextCorrect = q.matchCorrectIndices.map((idx) =>
                                  idx > colIndex ? idx - 1 : idx === colIndex ? 0 : idx,
                                );
                                updateQuestion(q.id, { matchOptions: next, matchCorrectIndices: nextCorrect });
                              }}
                              className="ml-2 inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/20 bg-white/10 hover:bg-white/20"
                              title="حذف العمود"
                            >
                              <img src="/delete-2.png" alt="" className="h-4 w-4" />
                            </button>
                          </label>
                        ))}
                        <button
                          type="button"
                          onClick={() => updateQuestion(q.id, { matchOptions: [...q.matchOptions, ""] })}
                          className="self-start rounded-full border border-white/30 px-4 py-2 text-xs text-white/80 hover:bg-white/10"
                        >
                          إضافة عمود
                        </button>
                      </div>
                      <p className="text-xs text-white/70">سيختار الطالب خيارًا واحدًا لكل صف (لا تتكرر الإجابات).</p>
                    </div>
                  ) : q.type === "text" ? (
                    <p className="mt-3 text-xs text-white/70">سؤال نصي: الطالب سيكتب إجابة نصية.</p>
                  ) : (
                    <p className="mt-3 text-xs text-white/70">
                      سؤال صور: الطالب سيرفع صورته كإجابة.
                    </p>
                  )}
                </div>
              ))}
            </div>
            <div className="mt-5 grid gap-2">
              <button
                type="button"
                onClick={handleSaveDraft}
                disabled={drafting}
                className="w-full rounded-2xl border border-white/30 px-4 py-3 text-sm font-semibold text-white/80 hover:bg-white/10 disabled:opacity-60"
              >
                {drafting ? "جارٍ الحفظ..." : "حفظ الامتحان (مسودة)"}
              </button>
              <button
                type="button"
                onClick={handleCreateExam}
                disabled={saving}
                className="w-full rounded-2xl bg-white px-4 py-3 text-sm font-semibold text-[color:var(--ink)] disabled:opacity-60"
              >
                {saving ? "جارٍ الحفظ..." : editingExamId ? "نشر الامتحان" : "نشر الامتحان"}
              </button>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
