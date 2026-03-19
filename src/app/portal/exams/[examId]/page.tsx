"use client";

import BackButton from "@/app/back-button";
import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { storage } from "@/lib/firebase/client";
import { getDownloadURL, ref as storageRef, uploadBytes } from "firebase/storage";

type StoredUser = {
  role?: string;
  studentCode?: string;
  name?: string;
};

type Question = {
  id: string;
  type: "mcq" | "image" | "text" | "order" | "match";
  text: string;
  timeLimitSeconds: number;
  options?: string[];
  orderItems?: string[];
  matchRows?: string[];
  matchOptions?: string[];
  points?: number;
  imageUrl?: string;
  allowMultiple?: boolean;
};

type ExamPayload = {
  exam: { id: string; title?: string; showAnswers?: boolean; examRules?: string; startAt?: string; endAt?: string };
  submission: { currentIndex?: number; questionOrder?: string[] };
  questions: Question[];
};

function formatTime(value: number) {
  const minutes = Math.floor(value / 60);
  const seconds = value % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

async function compressImage(file: File) {
  const img = document.createElement("img");
  const url = URL.createObjectURL(file);
  try {
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject();
      img.src = url;
    });
    const maxWidth = 1280;
    const ratio = Math.min(1, maxWidth / img.width);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.width * ratio);
    canvas.height = Math.round(img.height * ratio);
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob: Blob | null = await new Promise((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.8),
    );
    return blob ?? file;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export default function ExamTakePage() {
  const router = useRouter();
  const params = useParams<{ examId?: string }>();
  const searchParams = useSearchParams();
  const reviewMode = searchParams?.get("review") === "1";
  const examId = useMemo(() => String(params?.examId ?? "").trim(), [params]);
  const [role, setRole] = useState("");
  const [studentCode, setStudentCode] = useState("");
  const [examData, setExamData] = useState<ExamPayload | null>(null);
  const [examMeta, setExamMeta] = useState<{ title?: string; examRules?: string; startAt?: string; endAt?: string } | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [timeLeft, setTimeLeft] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [finished, setFinished] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploadingImages, setUploadingImages] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [starting, setStarting] = useState(false);
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [selectedOptionIndex, setSelectedOptionIndex] = useState<number | null>(null);
  const [selectedOptions, setSelectedOptions] = useState<string[]>([]);
  const [images, setImages] = useState<string[]>([]);
  const [imagePreviews, setImagePreviews] = useState<string[]>([]);
  const [textAnswer, setTextAnswer] = useState("");
  const [orderAnswer, setOrderAnswer] = useState<string[]>([]);
  const [matchAnswer, setMatchAnswer] = useState<Record<string, string>>({});
  const [review, setReview] = useState<{
    questions: Question[];
    answers: Record<
      string,
      {
        selectedOptions?: string[];
        imageUrls?: string[];
        answerText?: string;
        orderAnswer?: string[];
        rowSelections?: Record<string, string>;
        matchSelections?: Record<string, string>;
        score?: number;
      }
    >;
    correctMap: Record<string, string[]>;
    matchCorrectMap: Record<string, Record<string, string>>;
    pointsMap: Record<string, number>;
    showAnswers: boolean;
    showScores: boolean;
  } | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const pendingAutoAdvanceRef = useRef(false);

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
      if (nextRole !== "student") {
        router.replace(`/portal/${nextRole || "student"}`);
        return;
      }
      setRole(nextRole);
      setStudentCode(String(parsed.studentCode ?? ""));
    } catch {
      router.replace("/login");
    }
  }, [router]);

  useEffect(() => {
    if (!examId) {
      setLoading(false);
      setError("تعذر تحميل الامتحان.");
      return;
    }
    async function loadExamMeta() {
      if (!role || !examId) return;
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/exams");
        const json = await res.json();
        if (!res.ok || !json.ok) {
          setError(json?.message || "تعذر تحميل الامتحان.");
          return;
        }
        const list = (json.data as { id: string; title?: string; examRules?: string; startAt?: string; endAt?: string }[]) ?? [];
        const found = list.find((item) => String(item.id) === examId);
        if (!found) {
          setError("تعذر تحميل الامتحان.");
          return;
        }
        setExamMeta(found);
      } catch {
        setError("تعذر تحميل الامتحان.");
      } finally {
        setLoading(false);
      }
    }
    loadExamMeta();
  }, [examId, role]);

  useEffect(() => {
    if (!examId || !role || !reviewMode) return;
    let cancelled = false;
    async function loadReviewDirect() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/exams/${examId}/review`);
        const json = await res.json();
        if (!res.ok || !json.ok) {
          setError(json?.message || "تعذر عرض الإجابات.");
          return;
        }
        if (cancelled) return;
        setReview(json.data);
        setFinished(true);
      } catch {
        setError("تعذر عرض الإجابات.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    loadReviewDirect();
    return () => {
      cancelled = true;
    };
  }, [examId, role, reviewMode]);

  async function handleStartExam() {
    if (!role || !examId) return;
    setStarting(true);
    setError(null);
    try {
      const res = await fetch(`/api/exams/${examId}/start`, { method: "POST" });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        if (json?.finished) setFinished(true);
        setError(json?.message || "تعذر تحميل الامتحان.");
        return;
      }
      const payload = json.data as ExamPayload;
      setExamData(payload);
      const startIndex = Number(payload.submission?.currentIndex ?? 0);
      setCurrentIndex(startIndex);
      const firstQuestion = payload.questions[startIndex];
      setTimeLeft(Number(firstQuestion?.timeLimitSeconds ?? 0));
    } catch {
      setError("تعذر تحميل الامتحان.");
    } finally {
      setStarting(false);
    }
  }

  useEffect(() => {
    if (!examData) return;
    const question = examData.questions[currentIndex];
    if (!question) return;
    setSelectedOption(null);
    setSelectedOptionIndex(null);
    setSelectedOptions([]);
    setImages([]);
    setImagePreviews([]);
    setTextAnswer("");
    if (question.type === "order") {
      setOrderAnswer([...(question.orderItems ?? [])]);
    } else {
      setOrderAnswer([]);
    }
    if (question.type === "match") {
      const rows = question.matchRows ?? [];
      const initial: Record<string, string> = {};
      rows.forEach((row) => {
        initial[row] = "";
      });
      setMatchAnswer(initial);
    } else {
      setMatchAnswer({});
    }
    setTimeLeft(Number(question.timeLimitSeconds ?? 0));
  }, [currentIndex, examData]);

  useEffect(() => {
    if (!examData) return;
    if (currentIndex >= examData.questions.length) {
      setFinished(true);
    }
  }, [currentIndex, examData]);

  useEffect(() => {
    if (!examData || finished) return;
    document.body.classList.add("exam-in-progress");
    return () => {
      document.body.classList.remove("exam-in-progress");
    };
  }, [examData, finished]);

  useEffect(() => {
    if (!examData || finished) return;
    const question = examData.questions[currentIndex];
    if (!question) return;
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setTimeLeft((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [examData, finished, currentIndex]);

  useEffect(() => {
    if (timeLeft === 0 && examData && !finished) {
      handleAutoAdvance();
    }
  }, [timeLeft]);

  const currentQuestion = examData?.questions[currentIndex];
  const progressLabel = useMemo(() => {
    if (!examData) return "";
    const remaining = Math.max(0, examData.questions.length - (currentIndex + 1));
    if (remaining === 0) return "باقي 0 سؤال";
    if (remaining === 1) return "باقي سؤال";
    return `باقي ${remaining} أسئلة`;
  }, [currentIndex, examData]);

  async function uploadImages(files: File[]) {
    const urls: string[] = [];
    for (const file of files) {
      const compressed = await compressImage(file);
      const objectName = `${Date.now()}_${file.name.replace(/\s+/g, "_")}`;
      const uploadRef = storageRef(
        storage,
        `exam-answers/${examId}/${studentCode}/${currentQuestion?.id}/${objectName}`,
      );
      await uploadBytes(uploadRef, compressed);
      const url = await getDownloadURL(uploadRef);
      urls.push(url);
    }
    return urls;
  }

  async function handleAnswerSubmit(autoAdvance = true, imageUrlsOverride?: string[]) {
    if (!currentQuestion) return;
    setSaving(true);
    try {
      let imageUrls: string[] = [];
      if (currentQuestion.type === "image") {
        const source = imageUrlsOverride ?? images;
        if (source.length) imageUrls = source;
      }
      let payload: Record<string, unknown> = {
        questionId: currentQuestion.id,
        questionIndex: currentIndex,
        selectedOption: selectedOption ?? "",
        selectedOptions,
        imageUrls,
        autoAdvance,
      };
      if (currentQuestion.type === "text") {
        payload = { ...payload, answerText: textAnswer };
      }
      if (currentQuestion.type === "order") {
        payload = { ...payload, orderAnswer };
      }
      if (currentQuestion.type === "match") {
        payload = { ...payload, rowSelections: matchAnswer };
      }
      const res = await fetch(`/api/exams/${examId}/answer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        const msg = String(json?.message || "تعذر حفظ الإجابة.");
        setError(msg);
        if (msg.includes("لا يمكنك الرجوع")) {
          try {
            const syncRes = await fetch(`/api/exams/${examId}/start`, { method: "POST" });
            const syncJson = await syncRes.json();
            if (syncRes.ok && syncJson.ok) {
              const payload = syncJson.data as ExamPayload;
              setExamData(payload);
              const startIndex = Number(payload.submission?.currentIndex ?? 0);
              setCurrentIndex(startIndex);
              const firstQuestion = payload.questions[startIndex];
              setTimeLeft(Number(firstQuestion?.timeLimitSeconds ?? 0));
              setError(null);
            }
          } catch {
            // ignore sync errors
          }
        }
        return false;
      }
      return true;
    } catch {
      setError("تعذر حفظ الإجابة.");
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function handleAutoAdvance() {
    if (!currentQuestion) return;
    if (saving || uploadingImages) {
      pendingAutoAdvanceRef.current = true;
      return;
    }
    const ok = await handleAnswerSubmit(true);
    if (ok) moveNext();
  }

  useEffect(() => {
    if (!pendingAutoAdvanceRef.current) return;
    if (saving || uploadingImages) return;
    pendingAutoAdvanceRef.current = false;
    handleAutoAdvance();
  }, [saving, uploadingImages]);

  async function moveNext() {
    if (!examData) return;
    if (currentIndex + 1 >= examData.questions.length) {
      await fetch(`/api/exams/${examId}/submit`, { method: "POST" });
      setFinished(true);
      return;
    }
    setCurrentIndex((prev) => prev + 1);
  }

  async function handleImageSelection(files: FileList | null) {
    if (!files || !currentQuestion) return;
    setUploadingImages(true);
    const localPreviews = Array.from(files).map((file) => URL.createObjectURL(file));
    setImagePreviews((prev) => [...prev, ...localPreviews]);
    try {
      const urls = await uploadImages(Array.from(files));
      const nextImages = [...images, ...urls];
      setImages(nextImages);
      localPreviews.forEach((url) => URL.revokeObjectURL(url));
      setImagePreviews(nextImages);
      // Save immediately so الصور تظهر للمصحح حتى قبل الضغط على التالي
      await handleAnswerSubmit(false, nextImages);
    } catch {
      setError("تعذر رفع الصور.");
      setImagePreviews((prev) => prev.filter((p) => !localPreviews.includes(p)));
      localPreviews.forEach((url) => URL.revokeObjectURL(url));
    } finally {
      setUploadingImages(false);
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen px-6 pb-24 pt-10">
        <div className="mx-auto w-full max-w-2xl rounded-3xl border border-white/20 bg-white/10 p-10 text-center text-white/70 animate-pulse">
          جارٍ تحميل الامتحان...
        </div>
      </main>
    );
  }

  if (!examData && !finished && !review && !reviewMode) {
    return (
      <main className="min-h-screen px-6 pb-24 pt-10">
        <section className="mx-auto w-full max-w-2xl space-y-6">
          <header className="flex flex-col items-center gap-2">
            <img
              src="/COPYRIGHT.png"
              alt=""
              className="h-12 w-auto object-contain"
              loading="lazy"
            />
            <div className="flex w-full items-center justify-between">
              <BackButton fallbackHref="/portal/exams" className="back-btn" />
              <h1 className="app-heading">{examMeta?.title ?? "اختبار"}</h1>
              <div className="h-8 w-8" />
            </div>
          </header>
          {error ? <p className="text-sm text-red-200">{error}</p> : null}
          <div className="rounded-3xl border border-white/20 bg-white/10 p-6 text-white shadow-[var(--shadow)] backdrop-blur-md">
            <p className="text-sm text-white/80">
              بداية الاختبار: {examMeta?.startAt ? new Date(examMeta.startAt).toLocaleString("ar-EG", { dateStyle: "short", timeStyle: "short" }) : "—"}
            </p>
            <p className="text-sm text-white/80 mt-1">
              نهاية الاختبار: {examMeta?.endAt ? new Date(examMeta.endAt).toLocaleString("ar-EG", { dateStyle: "short", timeStyle: "short" }) : "—"}
            </p>
            <div className="mt-4 rounded-2xl border border-white/15 bg-white/5 p-4 text-sm text-white/80 whitespace-pre-wrap">
              {examMeta?.examRules || "لا توجد لائحة اختبار."}
            </div>
            <label className="mt-4 flex items-center gap-2 text-sm text-white/80">
              <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
              أوافق على لائحة الاختبار.
            </label>
            <button
              type="button"
              disabled={!agreed || starting}
              onClick={handleStartExam}
              className="mt-4 w-full rounded-full bg-white px-4 py-3 text-sm font-semibold text-[color:var(--ink)] disabled:opacity-60"
            >
              {starting ? "جارٍ البدء..." : "بدء الاختبار"}
            </button>
          </div>
        </section>
      </main>
    );
  }

  if (reviewMode && !review && !finished) {
    return (
      <main className="min-h-screen px-6 pb-24 pt-10">
        <section className="mx-auto w-full max-w-2xl space-y-6 text-center text-white">
          <img
            src="/COPYRIGHT.png"
            alt=""
            className="mx-auto h-12 w-auto object-contain"
            loading="lazy"
          />
          {error ? (
            <p className="text-sm text-red-200">{error}</p>
          ) : (
            <p className="text-sm text-white/70">جارٍ تحميل مراجعة الاختبار...</p>
          )}
        </section>
      </main>
    );
  }

  if (finished) {
    return (
      <main className="min-h-screen px-6 pb-24 pt-10">
        <div className="mx-auto w-full max-w-2xl rounded-3xl border border-white/20 bg-white/10 p-8 text-center text-white">
          <img
            src="/COPYRIGHT.png"
            alt=""
            className="mx-auto h-12 w-auto object-contain"
            loading="lazy"
          />
          <h2 className="mt-2 text-xl font-semibold">انتهاء الامتحان</h2>
          <p className="mt-2 text-sm text-white/70">يمكنك مراجعة إجاباتك الآن.</p>
          <button
            type="button"
            onClick={async () => {
              try {
                const res = await fetch(`/api/exams/${examId}/review`);
                const json = await res.json();
                if (res.ok && json.ok) {
                  setReview(json.data);
                } else {
                  setError(json?.message || "تعذر عرض الإجابات.");
                }
              } catch {
                setError("تعذر عرض الإجابات.");
              }
            }}
            className="mt-3 rounded-full border border-white/30 px-4 py-2 text-sm text-white/80 hover:bg-white/10"
          >
            مراجعة الإجابات
          </button>
          {review ? (
            <div className="mt-6 space-y-4 text-right">
              {review.questions.map((q, idx) => {
                const ans = review.answers[q.id] ?? {};
                const correct = review.correctMap[q.id] ?? [];
                const points = Number(review.pointsMap?.[q.id] ?? 0);
                return (
                  <div key={q.id} className="rounded-2xl border border-white/15 bg-white/5 p-4 text-sm">
                    <p className="font-semibold">
                      السؤال {idx + 1}: {q.text}
                    </p>
                    {q.type === "mcq" ? (
                      <div className="mt-3 grid gap-2">
                        {(q.options ?? []).map((opt) => {
                          const chosen =
                            String((ans as any).selectedOption ?? "") ||
                            String(((ans as any).selectedOptions ?? [])[0] ?? "");
                          const picked = q.allowMultiple
                            ? (ans.selectedOptions ?? []).includes(opt)
                            : chosen === opt;
                          return (
                            <div
                              key={opt}
                              className={`rounded-xl border px-3 py-2 ${
                                picked
                                  ? "border-[color:var(--accent)] bg-[color:var(--accent)]/20"
                                  : "border-white/10 bg-white/5"
                              }`}
                            >
                              {opt}
                            </div>
                          );
                        })}
                      </div>
                    ) : q.type === "text" ? (
                      <div className="mt-3 text-white/80">
                        <p className="text-xs text-white/70">إجابتك:</p>
                        <div className="mt-2 rounded-xl border border-white/10 bg-white/5 p-3 text-sm">
                          {(ans as any).answerText || "—"}
                        </div>
                      </div>
                    ) : q.type === "order" ? (
                      <div className="mt-3 text-white/80">
                        <p className="text-xs text-white/70">ترتيبك:</p>
                        <ol className="mt-2 list-decimal space-y-1 rounded-xl border border-white/10 bg-white/5 p-3 text-sm">
                          {((ans as any).orderAnswer ?? []).map((item: string, idx: number) => (
                            <li key={`${q.id}-order-${idx}`}>{item}</li>
                          ))}
                        </ol>
                      </div>
                    ) : q.type === "match" ? (
                      <div className="mt-3 text-white/80">
                        <p className="text-xs text-white/70">اختياراتك:</p>
                        <div className="mt-2 rounded-xl border border-white/10 bg-white/5 p-3 text-sm">
                          {(q.matchRows ?? []).map((row) => {
                            const picked = String((ans as any).rowSelections?.[row] ?? "");
                            return (
                              <div
                                key={`${q.id}-row-${row}`}
                                className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 py-2 last:border-b-0"
                              >
                                <span>{row}</span>
                                <span className="text-white/70">{picked || "—"}</span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ) : (
                      <div className="mt-3 text-white/70">
                        <p className="mb-2 text-xs">سؤال صور (بانتظار التصحيح):</p>
                        {Array.isArray((ans as any).imageUrls) && (ans as any).imageUrls.length > 0 ? (
                          <div className="grid grid-cols-2 lg:grid-cols-3 gap-2 mt-2">
                            {((ans as any).imageUrls as string[]).map((u) => (
                              <img key={u} src={u} alt="" className="h-20 w-full rounded-xl object-cover border border-white/20" />
                            ))}
                          </div>
                        ) : (
                          <span className="text-sm">لم يتم رفع صور</span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : null}
          <button
            type="button"
            onClick={() => router.push("/portal/exams")}
            className="mt-4 rounded-full bg-white px-4 py-2 text-sm font-semibold text-[color:var(--ink)]"
          >
            العودة للاختبارات
          </button>
        </div>
      </main>
    );
  }

  return (
    <main
      className="min-h-screen px-6 pb-24 pt-10 select-none"
      onCopy={(e) => e.preventDefault()}
      onCut={(e) => e.preventDefault()}
      onContextMenu={(e) => e.preventDefault()}
    >
      <section className="mx-auto w-full max-w-2xl space-y-6">
        <header className="flex flex-col items-center gap-2">
          <img
            src="/COPYRIGHT.png"
            alt=""
            className="h-12 w-auto object-contain"
            loading="lazy"
          />
          <div className="flex w-full items-center justify-between">
            <div className="h-8 w-8" />
            <h1 className="app-heading">{examData?.exam?.title ?? "اختبار"}</h1>
            <div className="h-8 w-8" />
          </div>
        </header>

        {error ? <p className="text-sm text-red-200">{error}</p> : null}

        <div className="rounded-3xl border border-white/20 bg-white/10 p-5 text-white shadow-[var(--shadow)] backdrop-blur-md">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold">{progressLabel}</p>
            </div>
            <div className="relative flex h-16 w-16 items-center justify-center">
              <div
                className="absolute inset-0 rounded-full"
                style={{
                  background: `conic-gradient(#f8fbff ${Math.max(
                    0,
                    (timeLeft / (currentQuestion?.timeLimitSeconds || 1)) * 360,
                  )}deg, rgba(255,255,255,0.1) 0deg)`,
                }}
              />
              <div className="absolute inset-1 rounded-full bg-[color:var(--bg)]" />
              <span className="relative z-10 text-xs">{formatTime(timeLeft)}</span>
            </div>
          </div>
        </div>

        {currentQuestion ? (
          <div className="rounded-3xl border border-white/20 bg-white/10 p-6 text-white shadow-[var(--shadow)] backdrop-blur-md transition-all">
            <p className="text-base font-semibold">{currentQuestion.text}</p>
            <p className="mt-1 text-xs text-white/70">درجة السؤال: {Number(currentQuestion.points ?? 1)}</p>
            {currentQuestion.imageUrl ? (
              <div className="mt-3 rounded-2xl border border-white/15 bg-white/5 p-2">
                <img
                  src={currentQuestion.imageUrl}
                  data-exam-image="true"
                  alt=""
                  loading="lazy"
                  className="w-full max-h-64 rounded-xl object-contain"
                />
              </div>
            ) : null}

            {currentQuestion.type === "mcq" ? (
              <div className="mt-4 grid gap-3">
                {(currentQuestion.options ?? []).map((option, idx) => {
                  const isSelected = currentQuestion.allowMultiple
                    ? selectedOptions.includes(option)
                    : selectedOptionIndex === idx;
                  return (
                    <button
                      key={`${option}-${idx}`}
                      type="button"
                      onClick={() => {
                        if (saving) return;
                        if (currentQuestion.allowMultiple) {
                          setSelectedOptions((prev) =>
                            prev.includes(option) ? prev.filter((o) => o !== option) : [...prev, option],
                          );
                          return;
                        }
                        setSelectedOptionIndex(idx);
                        setSelectedOption(option);
                        setSelectedOptions([]);
                      }}
                      className={`w-full rounded-2xl border px-4 py-3 text-sm text-right transition ${
                        isSelected
                          ? "border-[color:var(--accent)] bg-[color:var(--accent)]/20"
                          : "border-white/20 bg-white/10 hover:bg-white/15"
                      }`}
                    >
                      {option}
                    </button>
                  );
                })}
                <button
                  type="button"
                  onClick={async () => {
                    const ok = await handleAnswerSubmit(true);
                    if (ok) moveNext();
                  }}
                  disabled={saving}
                  className="mt-2 w-full rounded-full bg-white px-4 py-3 text-sm font-semibold text-[color:var(--ink)]"
                >
                  السؤال التالي
                </button>
              </div>
            ) : currentQuestion.type === "text" ? (
              <div className="mt-4 space-y-4">
                <textarea
                  value={textAnswer}
                  onChange={(e) => setTextAnswer(e.target.value)}
                  placeholder="اكتب إجابتك هنا..."
                  className="min-h-[120px] w-full rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-sm text-white"
                />
                <button
                  type="button"
                  onClick={async () => {
                    const ok = await handleAnswerSubmit(true);
                    if (ok) moveNext();
                  }}
                  disabled={saving}
                  className="w-full rounded-full bg-white px-4 py-3 text-sm font-semibold text-[color:var(--ink)]"
                >
                  السؤال التالي
                </button>
              </div>
            ) : currentQuestion.type === "order" ? (
              <div className="mt-4 space-y-3">
                <p className="text-xs text-white/70">رتّب العناصر بالترتيب الصحيح.</p>
                <div className="grid gap-2">
                  {orderAnswer.map((item, idx) => (
                    <div
                      key={`${currentQuestion.id}-order-${idx}`}
                      className="flex items-center justify-between rounded-2xl border border-white/20 bg-white/10 px-3 py-2 text-sm"
                    >
                      <span>{item || "—"}</span>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            if (idx === 0) return;
                            const next = [...orderAnswer];
                            [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
                            setOrderAnswer(next);
                          }}
                          className="rounded-full border border-white/20 px-2 py-1 text-xs text-white/80 hover:bg-white/10"
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            if (idx === orderAnswer.length - 1) return;
                            const next = [...orderAnswer];
                            [next[idx + 1], next[idx]] = [next[idx], next[idx + 1]];
                            setOrderAnswer(next);
                          }}
                          className="rounded-full border border-white/20 px-2 py-1 text-xs text-white/80 hover:bg-white/10"
                        >
                          ↓
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    const ok = await handleAnswerSubmit(true);
                    if (ok) moveNext();
                  }}
                  disabled={saving}
                  className="w-full rounded-full bg-white px-4 py-3 text-sm font-semibold text-[color:var(--ink)]"
                >
                  السؤال التالي
                </button>
              </div>
            ) : currentQuestion.type === "match" ? (
              <div className="mt-4 space-y-4">
                <div className="rounded-2xl border border-white/20 bg-white/10 p-3">
                  {(currentQuestion.matchRows ?? []).map((row) => (
                    <div key={`${currentQuestion.id}-match-${row}`} className="mb-3 grid items-center gap-3 md:grid-cols-[1fr_220px]">
                      <div className="rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm text-white/90">
                        {row}
                      </div>
                      <select
                        value={matchAnswer[row] ?? ""}
                        onChange={(e) => {
                          const value = String(e.target.value ?? "");
                          setMatchAnswer((prev) => {
                            const next = { ...prev };
                            Object.keys(next).forEach((key) => {
                              if (key !== row && next[key] === value) {
                                next[key] = "";
                              }
                            });
                            next[row] = value;
                            return next;
                          });
                        }}
                        className="w-full rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-sm text-white"
                      >
                        <option value="" className="text-black">
                          اختر الإجابة
                        </option>
                        {(currentQuestion.matchOptions ?? []).map((opt) => (
                          <option key={`${currentQuestion.id}-opt-${opt}`} value={opt} className="text-black">
                            {opt}
                          </option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    const ok = await handleAnswerSubmit(true);
                    if (ok) moveNext();
                  }}
                  disabled={saving}
                  className="w-full rounded-full bg-white px-4 py-3 text-sm font-semibold text-[color:var(--ink)]"
                >
                  السؤال التالي
                </button>
              </div>
            ) : (
              <div className="mt-4 space-y-4">
                <div className="rounded-2xl border border-white/20 bg-white/10 p-4 text-sm text-white/80">
                  ارفع صور إجابتك هنا. يمكنك إضافة أكثر من صورة.
                </div>
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-white/30 px-4 py-2 text-sm text-white/80 hover:bg-white/10">
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={(e) => handleImageSelection(e.target.files)}
                  />
                  رفع الصور
                </label>
                {(imagePreviews.length || images.length) ? (
                  <div className="grid grid-cols-3 gap-2">
                    {(imagePreviews.length ? imagePreviews : images).map((url) => (
                      <img key={url} src={url} alt="" className="h-20 w-full rounded-xl object-cover" />
                    ))}
                  </div>
                ) : null}
                {uploadingImages ? (
                  <p className="text-xs text-white/70">جارٍ رفع الصور...</p>
                ) : null}
                <button
                  type="button"
                  onClick={async () => {
                    const ok = await handleAnswerSubmit(true);
                    if (ok) moveNext();
                  }}
                  disabled={saving || uploadingImages}
                  className="w-full rounded-full bg-white px-4 py-3 text-sm font-semibold text-[color:var(--ink)]"
                >
                  السؤال التالي
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="rounded-3xl border border-white/20 bg-white/10 p-6 text-center text-white/70">
            لا يوجد سؤال حالياً.
          </div>
        )}
      </section>
    </main>
  );
}
