"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import BackButton from "@/app/back-button";

type StoredUser = { role?: string };
type ClassItem = { id: string; name: string };
type StudentRow = {
  code: string;
  name: string;
  classId: string;
  score?: number | null;
  updatedAt?: string;
};

const COPTIC_MONTHS = [
  "توت",
  "بابه",
  "هاتور",
  "كيهك",
  "طوبه",
  "أمشير",
  "برمهات",
  "برموده",
  "بشنس",
  "بؤونه",
  "أبيب",
  "مسرى",
  "النسيء",
];

export default function KatamarsResultsPage() {
  const router = useRouter();
  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [selectedMonth, setSelectedMonth] = useState("");
  const [selectedClass, setSelectedClass] = useState("");
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [selectedStudentCode, setSelectedStudentCode] = useState("");
  const [scoreDraft, setScoreDraft] = useState("");
  const [rowDrafts, setRowDrafts] = useState<Record<string, string>>({});
  const [templateFile, setTemplateFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [skipped, setSkipped] = useState<string[]>([]);

  useEffect(() => {
    const stored = window.localStorage.getItem("dsms:user");
    if (!stored) {
      router.replace("/login");
      return;
    }
    try {
      const parsed = JSON.parse(stored) as StoredUser;
      if (parsed.role !== "katamars") {
        router.replace(`/portal/${parsed.role ?? "student"}`);
      }
    } catch {
      router.replace("/login");
    }
  }, [router]);

  useEffect(() => {
    let cancelled = false;
    async function loadClasses() {
      try {
        setLoading(true);
        const res = await fetch("/api/classes");
        const json = await res.json();
        if (!res.ok || !json.ok || cancelled) {
          setError(json?.message || "تعذر تحميل الفصول.");
          return;
        }
        const list = ((json.data as ClassItem[]) ?? []).sort((a, b) => a.name.localeCompare(b.name, "ar"));
        setClasses(list);
        setSelectedMonth((prev) => prev || COPTIC_MONTHS[0]);
        setSelectedClass((prev) => prev || list[0]?.id || "");
      } catch {
        if (!cancelled) setError("تعذر تحميل الفصول.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    loadClasses();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadStudents() {
      if (!selectedMonth || !selectedClass) {
        setStudents([]);
        setSelectedStudentCode("");
        setScoreDraft("");
        return;
      }
      try {
        setError(null);
        const res = await fetch(
          `/api/katamars-competition/manual?month=${encodeURIComponent(selectedMonth)}&classId=${encodeURIComponent(selectedClass)}`,
        );
        const json = await res.json();
        if (!res.ok || !json.ok || cancelled) {
          setError(json?.message || "تعذر تحميل طلاب الصف.");
          return;
        }
        const nextStudents = (json.data?.students ?? []) as StudentRow[];
        setStudents(nextStudents);
        setRowDrafts(
          Object.fromEntries(
            nextStudents.map((student) => [student.code, student.score == null ? "" : String(student.score)]),
          ),
        );
        setSelectedStudentCode((prev) => {
          if (prev && nextStudents.some((student) => student.code === prev)) return prev;
          return nextStudents[0]?.code ?? "";
        });
      } catch {
        if (!cancelled) setError("تعذر تحميل طلاب الصف.");
      }
    }
    loadStudents();
    return () => {
      cancelled = true;
    };
  }, [selectedMonth, selectedClass]);

  const selectedStudent = useMemo(
    () => students.find((student) => student.code === selectedStudentCode) ?? null,
    [students, selectedStudentCode],
  );

  useEffect(() => {
    if (!selectedStudent) {
      setScoreDraft("");
      return;
    }
    setScoreDraft(selectedStudent.score == null ? "" : String(selectedStudent.score));
  }, [selectedStudent]);

  async function saveManualScore() {
    if (!selectedMonth || !selectedClass || !selectedStudentCode || !scoreDraft.trim()) return;
    try {
      setSaving(true);
      setError(null);
      setMsg(null);
      const res = await fetch("/api/katamars-competition/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          month: selectedMonth,
          classId: selectedClass,
          studentCode: selectedStudentCode,
          score: Number(scoreDraft),
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(json?.message || "تعذر حفظ الدرجة.");
        return;
      }
      setMsg(`تم حفظ درجة ${selectedStudent?.name ?? selectedStudentCode}.`);
      setStudents((prev) =>
        prev.map((student) =>
          student.code === selectedStudentCode
            ? { ...student, score: Number(scoreDraft), updatedAt: new Date().toISOString() }
            : student,
        ),
      );
      setRowDrafts((prev) => ({ ...prev, [selectedStudentCode]: scoreDraft }));
    } catch {
      setError("تعذر حفظ الدرجة.");
    } finally {
      setSaving(false);
    }
  }

  async function saveRowScore(studentCode: string) {
    const nextScore = String(rowDrafts[studentCode] ?? "").trim();
    if (!selectedMonth || !selectedClass || !studentCode || !nextScore) return;
    try {
      setSaving(true);
      setError(null);
      setMsg(null);
      const res = await fetch("/api/katamars-competition/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          month: selectedMonth,
          classId: selectedClass,
          studentCode,
          score: Number(nextScore),
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(json?.message || "تعذر حفظ الدرجة.");
        return;
      }
      const studentName = students.find((student) => student.code === studentCode)?.name ?? studentCode;
      setMsg(`تم حفظ درجة ${studentName}.`);
      setStudents((prev) =>
        prev.map((student) =>
          student.code === studentCode
            ? { ...student, score: Number(nextScore), updatedAt: new Date().toISOString() }
            : student,
        ),
      );
      if (selectedStudentCode === studentCode) setScoreDraft(nextScore);
    } catch {
      setError("تعذر حفظ الدرجة.");
    } finally {
      setSaving(false);
    }
  }

  async function saveAllScores() {
    if (!selectedMonth || !selectedClass || !students.length) return;
    try {
      setSaving(true);
      setError(null);
      setMsg(null);
      let updated = 0;
      for (const student of students) {
        const nextScore = String(rowDrafts[student.code] ?? "").trim();
        if (!nextScore) continue;
        const res = await fetch("/api/katamars-competition/manual", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            month: selectedMonth,
            classId: selectedClass,
            studentCode: student.code,
            score: Number(nextScore),
          }),
        });
        const json = await res.json();
        if (!res.ok || !json.ok) {
          setError(json?.message || `تعذر حفظ درجة ${student.name}.`);
          return;
        }
        updated += 1;
      }
      setStudents((prev) =>
        prev.map((student) => ({
          ...student,
          score: String(rowDrafts[student.code] ?? "").trim()
            ? Number(rowDrafts[student.code])
            : student.score ?? null,
          updatedAt: String(rowDrafts[student.code] ?? "").trim() ? new Date().toISOString() : student.updatedAt,
        })),
      );
      if (selectedStudentCode) {
        const selectedDraft = String(rowDrafts[selectedStudentCode] ?? "").trim();
        if (selectedDraft) setScoreDraft(selectedDraft);
      }
      setMsg(`تم حفظ ${updated} درجة.`);
    } catch {
      setError("تعذر حفظ الدرجات.");
    } finally {
      setSaving(false);
    }
  }

  async function clearAllScores() {
    if (!selectedMonth || !selectedClass) return;
    try {
      setSaving(true);
      setError(null);
      setMsg(null);
      const res = await fetch(
        `/api/katamars-competition/manual?month=${encodeURIComponent(selectedMonth)}&classId=${encodeURIComponent(selectedClass)}`,
        { method: "DELETE" },
      );
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(json?.message || "تعذر مسح الدرجات.");
        return;
      }
      setStudents((prev) => prev.map((student) => ({ ...student, score: null, updatedAt: "" })));
      setRowDrafts((prev) =>
        Object.fromEntries(Object.keys(prev).map((studentCode) => [studentCode, ""])),
      );
      setScoreDraft("");
      setMsg("تم مسح درجات الصف والشهر المختارين.");
    } catch {
      setError("تعذر مسح الدرجات.");
    } finally {
      setSaving(false);
    }
  }

  async function importTemplate() {
    if (!templateFile || !selectedMonth || !selectedClass) return;
    try {
      setSaving(true);
      setError(null);
      setMsg(null);
      setSkipped([]);
      const form = new FormData();
      form.append("month", selectedMonth);
      form.append("classId", selectedClass);
      form.append("file", templateFile);
      const res = await fetch("/api/katamars-competition/import", { method: "POST", body: form });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(json?.message || "تعذر رفع الدرجات.");
        return;
      }
      setMsg(`تم تحديث ${json.data?.updated ?? 0} طالب.`);
      setSkipped(Array.isArray(json.data?.skipped) ? json.data.skipped : []);
      setTemplateFile(null);

      const reloadRes = await fetch(
        `/api/katamars-competition/manual?month=${encodeURIComponent(selectedMonth)}&classId=${encodeURIComponent(selectedClass)}`,
      );
      const reloadJson = await reloadRes.json();
      if (reloadRes.ok && reloadJson.ok) {
        setStudents((reloadJson.data?.students ?? []) as StudentRow[]);
      }
    } catch {
      setError("تعذر رفع الدرجات.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="min-h-screen px-6 pb-24 pt-10">
      <section className="mx-auto w-full max-w-5xl">
        <header className="mb-6 flex items-center justify-between">
          <h1 className="app-heading mt-2">إدارة مسابقة القطمارس</h1>
          <BackButton
            className="back-btn rounded-full border border-black/10 bg-white px-4 py-2 text-sm font-semibold text-[color:var(--ink)] shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
            fallbackHref={"/portal/katamars"}
            />
        </header>

        <div className="mt-6 rounded-3xl border border-white/20 bg-white/15 p-6 text-white shadow-[var(--shadow)] backdrop-blur-md">
          {loading ? <p className="text-sm text-white/80">جار التحميل...</p> : null}
          {error ? <p className="text-sm text-red-200">{error}</p> : null}
          {msg ? <p className="text-sm text-emerald-200">{msg}</p> : null}

          <div className="grid gap-4 md:grid-cols-3">
            <div>
              <label className="mb-2 block text-sm text-white/85">الشهر القبطي</label>
              <select
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
                className="w-full rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-sm text-white"
              >
                {COPTIC_MONTHS.map((month) => (
                  <option key={month} value={month} className="text-black">
                    {month}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-2 block text-sm text-white/85">الصف</label>
              <select
                value={selectedClass}
                onChange={(e) => setSelectedClass(e.target.value)}
                className="w-full rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-sm text-white"
              >
                {classes.map((item) => (
                  <option key={item.id} value={item.id} className="text-black">
                    {item.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-2 block text-sm text-white/85">الطالب</label>
              <select
                value={selectedStudentCode}
                onChange={(e) => setSelectedStudentCode(e.target.value)}
                className="w-full rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-sm text-white"
              >
                <option value="" className="text-black">
                  اختر الطالب
                </option>
                {students.map((student) => (
                  <option key={student.code} value={student.code} className="text-black">
                    {student.name} - {student.code}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="mt-5 grid gap-4 md:grid-cols-[1fr_220px_auto] md:items-end">
            <div>
              <label className="mb-2 block text-sm text-white/85">الدرجة</label>
              <input
                value={scoreDraft}
                onChange={(e) => setScoreDraft(e.target.value)}
                inputMode="decimal"
                className="w-full rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-sm text-white"
                placeholder="اكتب الدرجة"
              />
            </div>
            <div className="rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-sm text-white/85">
              {selectedStudent ? `الطالب المختار: ${selectedStudent.name}` : "اختر الطالب أولاً"}
            </div>
            <button
              type="button"
              onClick={saveManualScore}
              disabled={!selectedMonth || !selectedClass || !selectedStudentCode || !scoreDraft.trim() || saving}
              className="rounded-full bg-emerald-600 px-5 py-3 text-sm font-semibold text-white disabled:opacity-60"
            >
              حفظ الدرجة
            </button>
          </div>

          <div className="mt-6 grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
            <div>
              <label className="mb-2 block text-sm text-white/85">رفع ملف Excel</label>
              <input
                type="file"
                accept=".xlsx,.xls"
                onChange={(e) => setTemplateFile(e.target.files?.[0] ?? null)}
                className="block w-full rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-sm text-white file:mr-3 file:rounded-full file:border-0 file:bg-white file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-black"
              />
            </div>
            <button
              type="button"
              onClick={importTemplate}
              disabled={!selectedMonth || !templateFile || saving}
              className="rounded-full bg-white px-4 py-3 text-sm font-semibold text-black disabled:opacity-60"
            >
              رفع Excel
            </button>
          </div>

          <div className="mt-4 flex flex-wrap gap-3">
            <a
              href={
                selectedMonth && selectedClass
                  ? `/api/katamars-competition/export?month=${encodeURIComponent(selectedMonth)}&classId=${encodeURIComponent(selectedClass)}`
                  : "#"
              }
              className={`rounded-full px-4 py-3 text-sm font-semibold ${
                selectedMonth && selectedClass
                  ? "bg-sky-500 text-white"
                  : "pointer-events-none bg-white/20 text-white/40"
              }`}
            >
              تنزيل درجات الفصل في الشهر المختار
            </a>
          </div>

          {skipped.length ? (
            <div className="mt-4 rounded-2xl border border-amber-200/30 bg-amber-500/10 p-4 text-xs text-amber-100">
              {skipped.map((item) => (
                <p key={item}>{item}</p>
              ))}
            </div>
          ) : null}
        </div>

        <div className="mt-6 rounded-3xl border border-white/20 bg-white/15 p-6 text-white shadow-[var(--shadow)] backdrop-blur-md">
          <p className="text-lg font-semibold">درجات الشهر المختار</p>
          {!students.length ? (
            <p className="mt-4 text-sm text-white/80">لا يوجد طلاب في هذا الصف.</p>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[680px] text-right text-sm text-white">
                <thead>
                  <tr className="border-b border-white/20 text-white/85">
                    <th className="px-3 py-2">الاسم</th>
                    <th className="px-3 py-2">الصف</th>
                    <th className="px-3 py-2">الكود</th>
                    <th className="px-3 py-2">الدرجة</th>
                    <th className="px-3 py-2">الشهر</th>
                    <th className="px-3 py-2">حفظ</th>
                  </tr>
                </thead>
                <tbody>
                  {students.map((student) => (
                    <tr key={student.code} className="border-b border-white/10">
                      <td className="px-3 py-2">{student.name}</td>
                      <td className="px-3 py-2">{student.classId}</td>
                      <td className="px-3 py-2">{student.code}</td>
                      <td className="px-3 py-2">
                        <input
                          value={rowDrafts[student.code] ?? ""}
                          onChange={(e) =>
                            setRowDrafts((prev) => ({
                              ...prev,
                              [student.code]: e.target.value,
                            }))
                          }
                          inputMode="decimal"
                          className="w-24 rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-center text-sm text-white"
                          placeholder="-"
                        />
                      </td>
                      <td className="px-3 py-2">{selectedMonth}</td>
                      <td className="px-3 py-2">
                        <button
                          type="button"
                          onClick={() => saveRowScore(student.code)}
                          disabled={!String(rowDrafts[student.code] ?? "").trim() || saving}
                          className="rounded-full bg-emerald-600 px-4 py-2 text-xs font-semibold text-white disabled:opacity-60"
                        >
                          حفظ
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {students.length ? (
            <div className="mt-5 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={saveAllScores}
                disabled={!selectedMonth || !selectedClass || saving}
                className="rounded-full bg-white px-5 py-3 text-sm font-semibold text-black disabled:opacity-60"
              >
                حفظ الدرجات
              </button>
              <button
                type="button"
                onClick={clearAllScores}
                disabled={!selectedMonth || !selectedClass || saving}
                className="rounded-full border border-red-300 px-5 py-3 text-sm font-semibold text-red-200 disabled:opacity-60"
              >
                مسح الدرجات
              </button>
            </div>
          ) : null}
        </div>
      </section>
    </main>
  );
}
