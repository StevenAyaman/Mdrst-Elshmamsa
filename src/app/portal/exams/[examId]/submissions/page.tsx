"use client";

import BackButton from "@/app/back-button";
import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";

type StoredUser = {
  role?: string;
  studentCode?: string;
};

type Question = {
  id: string;
  type: "mcq" | "image" | "text" | "order" | "match";
  text: string;
  options?: string[];
  orderItems?: string[];
  matchRows?: string[];
  matchOptions?: string[];
  points?: number;
  imageUrl?: string;
};

type ExamPayload = {
  exam: { id: string; title?: string; subject?: string; classId?: string };
  questions: Question[];
};

type AnswerPayload = {
  type?: string;
  selectedOption?: string;
  selectedOptions?: string[];
  correct?: boolean;
  imageUrls?: string[];
  answerText?: string;
  orderAnswer?: string[];
  rowSelections?: Record<string, string>;
  pending?: boolean;
  score?: number;
};

type SubmissionItem = {
  id: string;
  studentCode?: string;
  studentName?: string;
  studentClass?: string;
  score?: number;
  pendingCount?: number;
  answers?: Record<string, AnswerPayload>;
  finished?: boolean;
};

function formatName(name?: string) {
  return name && name.trim() ? name : "طالب بدون اسم";
}

export default function ExamSubmissionsPage() {
  const router = useRouter();
  const params = useParams();
  const examId = String(params?.examId ?? "").trim();
  const [role, setRole] = useState("");
  const [exam, setExam] = useState<ExamPayload | null>(null);
  const [submissions, setSubmissions] = useState<SubmissionItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [grading, setGrading] = useState<Record<string, boolean>>({});
  const [scoreDrafts, setScoreDrafts] = useState<Record<string, number>>({});

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
    } catch {
      router.replace("/login");
    }
  }, [router]);

  useEffect(() => {
    async function loadData() {
      if (!role || !examId) return;
      setLoading(true);
      setError(null);
      try {
        const [examRes, subsRes] = await Promise.all([
          fetch(`/api/exams/${examId}`),
          fetch(`/api/exams/${examId}/submissions`),
        ]);
        const examJson = await examRes.json();
        const subsJson = await subsRes.json();
        if (!examRes.ok || !examJson.ok) {
          setError(examJson?.message || "تعذر تحميل بيانات الامتحان.");
          return;
        }
        if (!subsRes.ok || !subsJson.ok) {
          setError(subsJson?.message || "تعذر تحميل التسليمات.");
          return;
        }
        setExam(examJson.data as ExamPayload);
        const list = (subsJson.data as SubmissionItem[]) ?? [];
        setSubmissions(list);
        if (list.length && !selectedId) setSelectedId(list[0].id);
      } catch {
        setError("تعذر تحميل بيانات الامتحان.");
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, [role, examId, selectedId]);

  const questionMap = useMemo(() => {
    const map = new Map<string, Question>();
    const questions = exam?.questions ?? [];
    questions.forEach((q) => map.set(q.id, q));
    return map;
  }, [exam]);

  const selectedSubmission = useMemo(
    () => submissions.find((item) => item.id === selectedId) || null,
    [submissions, selectedId],
  );

  async function handleGrade(questionId: string, scoreValue: number) {
    if (!selectedSubmission?.studentCode) return;
    const key = `${selectedSubmission.studentCode}_${questionId}`;
    setGrading((prev) => ({ ...prev, [key]: true }));
    try {
      const res = await fetch(`/api/exams/${examId}/grade`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          studentCode: selectedSubmission.studentCode,
          questionId,
          score: scoreValue,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(json?.message || "تعذر حفظ التقييم.");
        return;
      }
      setSubmissions((prev) =>
        prev.map((item) => {
          if (item.id !== selectedSubmission.id) return item;
          const answers = { ...(item.answers ?? {}) };
          const existing = answers[questionId] ?? {};
          answers[questionId] = {
            ...existing,
            score: scoreValue,
            pending: false,
          };
          const scores = Object.values(answers).map((a) => Number(a?.score ?? 0));
          const pendingCount = Object.values(answers).filter((a) => a?.pending).length;
          const total = scores.reduce((sum, value) => sum + value, 0);
          return {
            ...item,
            answers,
            pendingCount,
            score: total,
          };
        }),
      );
      setScoreDrafts((prev) => ({ ...prev, [questionId]: scoreValue }));
    } catch {
      setError("تعذر حفظ التقييم.");
    } finally {
      setGrading((prev) => ({ ...prev, [key]: false }));
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen px-6 pb-24 pt-10">
        <div className="mx-auto w-full max-w-4xl rounded-3xl border border-white/20 bg-white/10 p-8 text-center text-white/70 animate-pulse">
          جارٍ تحميل التسليمات...
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen px-6 pb-24 pt-10">
      <section className="mx-auto w-full max-w-6xl space-y-6">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <BackButton fallbackHref="/portal/exams" className="back-btn" />
          <div>
            <h1 className="app-heading">تسليمات الامتحان</h1>
            <p className="text-sm text-white/70 mt-1">
              {exam?.exam?.title ?? "اختبار"}
            </p>
          </div>
          <a
            href={`/api/exams/${examId}/submissions-export`}
            className="w-full sm:w-auto rounded-full border border-white/30 px-4 py-2 text-xs font-semibold text-white/80 hover:bg-white/10 transition text-center"
          >
            تنزيل Excel
          </a>
        </header>

        {error ? <p className="text-sm text-red-200">{error}</p> : null}

        <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
          <div className="rounded-3xl border border-white/20 bg-white/10 p-4 text-white shadow-[var(--shadow)] backdrop-blur-md">
            <h2 className="text-base font-semibold mb-3">قائمة الطلاب</h2>
            {submissions.length === 0 ? (
              <p className="text-sm text-white/70">لا توجد تسليمات بعد.</p>
            ) : (
              <div className="grid gap-2">
                {submissions.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setSelectedId(item.id)}
                    className={`rounded-2xl border px-3 py-3 text-right text-sm transition ${
                      selectedId === item.id
                        ? "border-[color:var(--accent)] bg-white/20"
                        : "border-white/15 bg-white/5 hover:bg-white/10"
                    }`}
                  >
                    <p className="font-semibold">{formatName(item.studentName)}</p>
                    <p className="text-xs text-white/70">
                      {item.studentClass || "—"} · كود {item.studentCode || "—"}
                    </p>
                    <p className="text-xs text-white/70 mt-1">
                      الدرجة: {item.score ?? 0} · المعلقة: {item.pendingCount ?? 0}
                    </p>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-3xl border border-white/20 bg-white/10 p-6 text-white shadow-[var(--shadow)] backdrop-blur-md">
            {!selectedSubmission ? (
              <div className="text-center text-white/70">اختر طالباً لعرض الإجابات.</div>
            ) : (
              <div className="space-y-5">
                <div className="rounded-2xl border border-white/15 bg-white/5 p-4">
                  <p className="text-lg font-semibold">
                    {formatName(selectedSubmission.studentName)}
                  </p>
                  <p className="text-xs text-white/70">
                    {selectedSubmission.studentClass || "—"} · كود{" "}
                    {selectedSubmission.studentCode || "—"}
                  </p>
                  <p className="mt-2 text-sm text-white/80">
                    الدرجة الحالية: {selectedSubmission.score ?? 0}
                  </p>
                </div>

                <div className="grid gap-4">
                  {(exam?.questions ?? []).map((question, index) => {
                    const answer =
                      selectedSubmission.answers?.[question.id] ?? ({} as AnswerPayload);
                    const isImage = question.type === "image";
                    const isPending = Boolean(answer.pending);
                    return (
                      <div
                        key={question.id}
                        className="rounded-2xl border border-white/15 bg-white/5 p-4"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold">
                              سؤال {index + 1}
                            </p>
                    <p className="text-xs text-white/70 mt-1">
                      {question.text}
                    </p>
                  </div>
                  <span className="rounded-full border border-white/20 px-3 py-1 text-xs text-white/70">
                    {question.type === "mcq"
                      ? "اختيار من متعدد"
                      : question.type === "image"
                        ? "صور"
                        : question.type === "text"
                          ? "سؤال نص"
                          : question.type === "order"
                            ? "سؤال ترتيب"
                            : "سؤال توصيل"}
                  </span>
                </div>
                {question.imageUrl ? (
                  <div className="mt-3">
                    <img
                      src={question.imageUrl}
                      alt=""
                      className="h-28 w-full rounded-xl object-cover"
                    />
                  </div>
                ) : null}

                        {question.type === "mcq" ? (
                          <div className="mt-3 text-sm text-white/80">
                            <p>
                              الإجابات المختارة:{" "}
                              <span className="font-semibold">
                                {(answer.selectedOptions && answer.selectedOptions.length
                                  ? answer.selectedOptions
                                  : answer.selectedOption
                                    ? [answer.selectedOption]
                                    : ["—"]
                                ).join("، ")}
                              </span>
                            </p>
                            <p className="mt-1">
                              التقييم:{" "}
                              <span className={answer.correct ? "text-emerald-300" : "text-red-200"}>
                                {answer.correct ? "صحيح" : "خاطئ"}
                              </span>
                            </p>
                            <p className="mt-1 text-xs text-white/70">
                              درجة السؤال: {Number(answer.score ?? 0)} / {Number(question.points ?? 1)}
                            </p>
                          </div>
                        ) : (
                          <div className="mt-3 space-y-3">
                            {question.type === "image" ? (
                              Array.isArray(answer.imageUrls) && answer.imageUrls.length ? (
                                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                                  {answer.imageUrls.map((url) => (
                                    <img
                                      key={url}
                                      src={url}
                                      alt=""
                                      className="h-28 w-full rounded-xl object-cover"
                                    />
                                  ))}
                                </div>
                              ) : (
                                <p className="text-xs text-white/70">لا توجد صور مرفوعة.</p>
                              )
                            ) : question.type === "text" ? (
                              <div className="rounded-xl border border-white/10 bg-white/5 p-3 text-sm text-white/80">
                                {answer.answerText || "—"}
                              </div>
                            ) : question.type === "order" ? (
                              <ol className="list-decimal space-y-1 rounded-xl border border-white/10 bg-white/5 p-3 text-sm text-white/80">
                                {(answer.orderAnswer ?? []).map((item, idx) => (
                                  <li key={`${question.id}-order-${idx}`}>{item}</li>
                                ))}
                              </ol>
                            ) : (
                              <div className="rounded-xl border border-white/10 bg-white/5 p-3 text-sm text-white/80">
                                {(question.matchRows ?? []).map((row) => (
                                  <div
                                    key={`${question.id}-row-${row}`}
                                    className="flex items-center justify-between border-b border-white/10 py-2 last:border-b-0"
                                  >
                                    <span>{row}</span>
                                    <span className="text-white/70">
                                      {answer.rowSelections?.[row] ?? "—"}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            )}
                            <div className="flex flex-wrap items-center gap-3 text-sm">
                              <span className="text-white/70">الدرجة:</span>
                              <input
                                type="number"
                                value={
                                  Number.isFinite(scoreDrafts[question.id])
                                    ? scoreDrafts[question.id]
                                    : Number(answer.score ?? 0)
                                }
                                min={0}
                                className="w-24 rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-sm text-white"
                                onChange={(e) => {
                                  const value = Number(e.target.value ?? 0);
                                  setScoreDrafts((prev) => ({ ...prev, [question.id]: value }));
                                }}
                              />
                              <span className="text-xs text-white/70">
                                / {Number(question.points ?? 1)}
                              </span>
                              <button
                                type="button"
                                onClick={() => {
                                  const value = Number.isFinite(scoreDrafts[question.id])
                                    ? scoreDrafts[question.id]
                                    : Number(answer.score ?? 0);
                                  handleGrade(question.id, value);
                                }}
                                disabled={grading[`${selectedSubmission.studentCode}_${question.id}`]}
                                className="rounded-full border border-white/30 px-4 py-2 text-xs text-white/80 hover:bg-white/10 disabled:opacity-60"
                              >
                                {grading[`${selectedSubmission.studentCode}_${question.id}`]
                                  ? "جارٍ الحفظ..."
                                  : isPending
                                    ? "اعتماد الدرجة"
                                    : "تحديث الدرجة"}
                              </button>
                              {isPending ? (
                                <span className="text-xs text-amber-200">بانتظار المراجعة</span>
                              ) : null}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
