"use client";

import BackButton from "@/app/back-button";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type StoredUser = {
  role?: string;
  studentCode?: string;
  name?: string;
};

type ExamItem = {
  id: string;
  title?: string;
  subject?: string;
  classId?: string;
  questionCount?: number;
  createdBy?: { name?: string };
  createdAt?: string;
  startAt?: string;
  endAt?: string;
  submissionsCount?: number;
  submissionStatus?: "new" | "in_progress" | "finished";
  score?: number | null;
  pendingCount?: number;
};

type ResultItem = {
  examId: string;
  title: string;
  subject: string;
  classId: string;
  score: number;
  pendingCount: number;
  submittedAt?: string | null;
  studentCode?: string;
};

type ChildOption = { code: string; name: string };

function formatDate(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("ar-EG");
}

function formatDateTime(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("ar-EG", { dateStyle: "short", timeStyle: "short" });
}

export default function ExamsPage() {
  const router = useRouter();
  const [role, setRole] = useState("");
  const [userCode, setUserCode] = useState("");
  const [exams, setExams] = useState<ExamItem[]>([]);
  const [results, setResults] = useState<ResultItem[]>([]);
  const [children, setChildren] = useState<ChildOption[]>([]);
  const [selectedChild, setSelectedChild] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
      setRole(nextRole);
      setUserCode(String(parsed.studentCode ?? ""));
      if (nextRole === "teacher" || nextRole === "admin") return;
      if (!["student", "parent"].includes(nextRole)) {
        router.replace(`/portal/${nextRole || "student"}`);
      }
    } catch {
      router.replace("/login");
    }
  }, [router]);

  useEffect(() => {
    async function loadData() {
      if (!role) return;
      setLoading(true);
      setError(null);
      try {
        if (role === "student" || role === "teacher" || role === "admin") {
          const res = await fetch("/api/exams");
          const json = await res.json();
          if (res.ok && json.ok) {
            setExams((json.data as ExamItem[]) ?? []);
          } else {
            setError(json?.message || "تعذر تحميل الاختبارات.");
          }
        }

        if (role === "parent") {
          const userRes = await fetch(`/api/users?code=${encodeURIComponent(userCode)}`);
          const userJson = await userRes.json();
          if (userRes.ok && userJson.ok) {
            const childCodes = Array.isArray(userJson.data?.childrenCodes)
              ? (userJson.data.childrenCodes as string[])
              : [];
            const childList: ChildOption[] = [];
            for (const code of childCodes) {
              const childRes = await fetch(`/api/users?code=${encodeURIComponent(code)}`);
              const childJson = await childRes.json();
              if (childRes.ok && childJson.ok) {
                childList.push({ code: String(code), name: String(childJson.data?.name ?? code) });
              }
            }
            setChildren(childList);
            if (!selectedChild && childList.length) setSelectedChild(childList[0].code);
          }
        }

        if (role === "student") {
          const res = await fetch("/api/exams/results");
          const json = await res.json();
          if (res.ok && json.ok) {
            setResults((json.data as ResultItem[]) ?? []);
          }
        }
      } catch {
        setError("تعذر تحميل الاختبارات.");
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, [role, userCode, selectedChild]);

  useEffect(() => {
    async function loadParentResults() {
      if (role !== "parent" || !selectedChild) return;
      try {
        const res = await fetch(`/api/exams/results?studentCode=${encodeURIComponent(selectedChild)}`);
        const json = await res.json();
        if (res.ok && json.ok) {
          setResults((json.data as ResultItem[]) ?? []);
        }
      } catch {
        setError("تعذر تحميل النتائج.");
      }
    }
    loadParentResults();
  }, [role, selectedChild]);

  const manageLink = useMemo(() => {
    if (role === "admin" || role === "teacher") return "/portal/exams/manage";
    return null;
  }, [role]);

  return (
    <main className="min-h-screen px-6 pb-24 pt-10">
      <section className="mx-auto w-full max-w-4xl space-y-6">
        <header className="flex items-center justify-between">
          <BackButton fallbackHref={`/portal/${role || "student"}`} className="back-btn" />
          <h1 className="app-heading">الاختبارات</h1>
          <div className="h-8 w-8" />
        </header>

        {manageLink ? (
          <Link
            href={manageLink}
            className="block rounded-3xl border border-white/20 bg-white/15 px-6 py-4 text-center text-white shadow-[var(--shadow)] backdrop-blur-md transition hover:-translate-y-0.5 hover:bg-white/20"
          >
            إدارة الاختبارات وإنشاء امتحانات جديدة
          </Link>
        ) : null}

        {error ? <p className="text-sm text-red-200">{error}</p> : null}

        {role === "parent" ? (
          <div className="rounded-3xl border border-white/20 bg-white/15 p-6 text-white shadow-[var(--shadow)] backdrop-blur-md">
            <p className="mb-3 text-sm font-semibold">اختر اسم الطالب</p>
            <select
              className="w-full rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-sm text-white"
              value={selectedChild}
              onChange={(e) => setSelectedChild(e.target.value)}
            >
              {children.map((child) => (
                <option key={child.code} value={child.code} className="text-black">
                  {child.name}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        {loading ? (
          <div className="grid gap-4">
            {Array.from({ length: 4 }).map((_, idx) => (
              <div key={`s-${idx}`} className="h-24 rounded-3xl bg-white/10 animate-pulse" />
            ))}
          </div>
        ) : role === "student" ? (
          <div className="grid gap-4">
            {exams.length === 0 ? (
              <div className="rounded-3xl border border-white/20 bg-white/10 p-6 text-center text-white/70">
                لا توجد اختبارات متاحة حالياً.
              </div>
            ) : (
              exams.map((exam) => (
                <div
                  key={exam.id}
                  className="relative rounded-3xl border border-white/20 bg-white/10 p-5 text-white shadow-[var(--shadow)] backdrop-blur-md"
                >
                  {exam.submissionStatus === "finished" || exam.submissionStatus === "in_progress" ? (
                    <span className="absolute left-4 top-4 rounded-full border border-white/30 px-3 py-1 text-xs text-white/80">
                      تم التسليم
                    </span>
                  ) : null}
                  {exam.submissionStatus === "finished" || exam.submissionStatus === "in_progress" ? (
                    <Link
                      href={`/portal/exams/${exam.id}?review=1`}
                      className="absolute left-4 bottom-4 rounded-full border border-white/30 px-3 py-1 text-xs text-white/80 hover:bg-white/10"
                    >
                      مراجعة الاختبار
                    </Link>
                  ) : null}
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-lg font-semibold">{exam.title}</p>
                      <p className="text-xs text-white/70">
                        {exam.subject} · الفصل {exam.classId}
                      </p>
                      <p className="text-xs text-white/70 mt-1">
                        بداية الاختبار: {formatDateTime(exam.startAt)}
                      </p>
                      <p className="text-xs text-white/70">
                        نهاية الاختبار: {formatDateTime(exam.endAt)}
                      </p>
                      <p className="text-xs text-white/60 mt-1">
                        {exam.questionCount ?? 0} سؤال · {formatDate(exam.createdAt)}
                      </p>
                    </div>
                  </div>
                  <div className="mt-4 flex items-center justify-between">
                    <span className="text-sm text-white/70">
                      {exam.submissionStatus === "new" ? "جاهز للبدء" : ""}
                    </span>
                    {exam.submissionStatus === "new" ? (
                      <Link
                        href={`/portal/exams/${exam.id}`}
                        className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-[color:var(--ink)]"
                      >
                        ابدأ
                      </Link>
                    ) : (
                      <span className="h-9 w-24" />
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        ) : role === "parent" ? (
          <div className="grid gap-4">
            {results.length === 0 ? (
              <div className="rounded-3xl border border-white/20 bg-white/10 p-6 text-center text-white/70">
                لا توجد نتائج بعد.
              </div>
            ) : (
              results.map((result) => (
                <div
                  key={`${result.examId}-${result.studentCode}`}
                  className="rounded-3xl border border-white/20 bg-white/10 p-5 text-white shadow-[var(--shadow)] backdrop-blur-md"
                >
                  <p className="text-lg font-semibold">{result.title}</p>
                  <p className="text-xs text-white/70">
                    {result.subject} · الفصل {result.classId}
                  </p>
                  <p className="mt-2 text-sm text-white/80">
                    الدرجة: {result.score} {result.pendingCount ? `· أسئلة معلقة: ${result.pendingCount}` : ""}
                  </p>
                </div>
              ))
            )}
          </div>
        ) : (
          <div className="grid gap-4">
            {exams.length === 0 ? (
              <div className="rounded-3xl border border-white/20 bg-white/10 p-6 text-center text-white/70">
                لا توجد اختبارات بعد.
              </div>
            ) : (
              exams.map((exam) => (
                <div
                  key={exam.id}
                  className="rounded-3xl border border-white/20 bg-white/10 p-5 text-white shadow-[var(--shadow)] backdrop-blur-md"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-lg font-semibold">{exam.title}</p>
                      <p className="text-xs text-white/70">
                        {exam.subject} · الفصل {exam.classId}
                      </p>
                      <p className="text-xs text-white/60 mt-1">
                        {exam.questionCount ?? 0} سؤال · تم التسليم {exam.submissionsCount ?? 0}
                      </p>
                    </div>
                    <Link
                      href={`/portal/exams/${exam.id}/submissions`}
                      className="rounded-full border border-white/30 px-4 py-2 text-xs text-white/80 hover:bg-white/10"
                    >
                      عرض التسليمات
                    </Link>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </section>
    </main>
  );
}
