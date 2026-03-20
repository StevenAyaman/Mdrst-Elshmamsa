"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type StoredUser = { role?: string; studentCode?: string };

type TeacherInfo = {
  code: string;
  name: string;
  classes: string[];
  subjects: string[];
};

type ClassInfo = { id: string; name: string };
type ClassStudent = { code: string; name: string; classworkScore?: number | null; examScore?: number | null; notes?: string };

type GradeScaleItem = { id?: string; name?: string; min?: number; max?: number };

type ResultRow = {
  subject: string;
  classId: string;
  studentName: string;
  minScore: number;
  maxScore: number;
  classworkScore: number;
  examScore: number;
  totalScore: number;
  notes: string;
};

type RecordsPayload = {
  role: string;
  period: { id: string; name: string; term1Name?: string; term2Name?: string; activeTerm?: "term1" | "term2" };
  published?: boolean;
  allowed?: boolean;
  classes?: string[];
  subjects?: string[];
  rows?: ResultRow[];
  rowsTerm1?: ResultRow[];
  rowsTerm2?: ResultRow[];
  childrenCodes?: string[];
  settings?: {
    allowedTeacherCodes?: string[];
    gradeScale?: GradeScaleItem[];
    currentTerm?: "term1" | "term2";
    term1SeasonalSubject?: "taks" | "katamars";
    term2SeasonalSubject?: "taks" | "katamars";
    availableSubjects?: Record<string, { term1?: string[]; term2?: string[] }>;
    copticYearLabel?: string;
  };
  teachers?: TeacherInfo[];
  classesList?: ClassInfo[];
};

type SubjectLimit = {
  id: string;
  classId: string;
  subject: string;
  term?: "term1" | "term2";
  minScore: number;
  maxScore: number;
  classworkMinScore: number;
  classworkMaxScore: number;
  updatedAt?: string;
};

const SUBJECTS = ["طقس", "اجبيه", "قطمارس", "الحان", "قبطي"];

export default function ResultsPage() {
  const router = useRouter();
  const [user, setUser] = useState<StoredUser | null>(null);
  const [data, setData] = useState<RecordsPayload | null>(null);
  const [limits, setLimits] = useState<SubjectLimit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedClass, setSelectedClass] = useState("");
  const [selectedSubject, setSelectedSubject] = useState("");
  const [templateFile, setTemplateFile] = useState<File | null>(null);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const [importSkipped, setImportSkipped] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [manualMsg, setManualMsg] = useState<string | null>(null);
  const [classStudents, setClassStudents] = useState<ClassStudent[]>([]);
  const [manualDrafts, setManualDrafts] = useState<Record<string, { classwork: string; exam: string; notes: string }>>({});

  const [availableYear, setAvailableYear] = useState("");
  const [availableTerm, setAvailableTerm] = useState<"term1" | "term2">("term1");
  const [availableSubjects, setAvailableSubjects] = useState<string[]>([]);
  const [availableMap, setAvailableMap] = useState<Record<string, { term1?: string[]; term2?: string[] }>>({});

  const [limitYear, setLimitYear] = useState("");
  const [limitTerm, setLimitTerm] = useState<"term1" | "term2">("term1");
  const [limitClass, setLimitClass] = useState("");
  const [limitSubject, setLimitSubject] = useState("");
  const [limitMin, setLimitMin] = useState("0");
  const [limitMax, setLimitMax] = useState("20");
  const [limitClassworkMin, setLimitClassworkMin] = useState("0");
  const [limitClassworkMax, setLimitClassworkMax] = useState("20");
  const [teacherSearch, setTeacherSearch] = useState("");
  const [currentTerm, setCurrentTerm] = useState<"term1" | "term2">("term1");
  const [term1SeasonalSubject, setTerm1SeasonalSubject] = useState<"taks" | "katamars">("taks");
  const [term2SeasonalSubject, setTerm2SeasonalSubject] = useState<"taks" | "katamars">("katamars");
  const [copticYearLabel, setCopticYearLabel] = useState("");

  const [selectedChild, setSelectedChild] = useState("");
  const [parentChildrenOptions, setParentChildrenOptions] = useState<Array<{ code: string; name: string }>>([]);
  const [parentRowsTerm1, setParentRowsTerm1] = useState<ResultRow[]>([]);
  const [parentRowsTerm2, setParentRowsTerm2] = useState<ResultRow[]>([]);
  const [parentLoading, setParentLoading] = useState(false);

  useEffect(() => {
    const stored = window.localStorage.getItem("dsms:user");
    if (!stored) {
      router.replace("/login");
      return;
    }
    try {
      const parsed = JSON.parse(stored) as StoredUser;
      const role = parsed.role === "nzam" ? "system" : parsed.role;
      if (!["admin", "teacher", "student", "parent"].includes(String(role ?? ""))) {
        router.replace(`/portal/${role ?? "student"}`);
        return;
      }
      setUser({ ...parsed, role });
    } catch {
      router.replace("/login");
    }
  }, [router]);

  async function loadData() {
    try {
      setLoading(true);
      setError(null);
      const recordsRes = await fetch("/api/results/records");
      const recordsJson = await recordsRes.json();
      if (!recordsRes.ok || !recordsJson.ok) {
        setError(recordsJson?.message || "تعذر تحميل صفحة النتائج.");
        setLoading(false);
        return;
      }

      const payloadRaw = recordsJson.data as RecordsPayload & { classes?: ClassInfo[] };
      const payload: RecordsPayload = {
        ...payloadRaw,
        classesList: payloadRaw.classes,
      };
      setData(payload);

      const activeTerm = payload.period?.activeTerm === "term2" ? "term2" : "term1";
      const savedTerm =
        payload.settings?.currentTerm === "term2"
          ? "term2"
          : payload.settings?.currentTerm === "term1"
            ? "term1"
            : activeTerm;
      setCurrentTerm(savedTerm);

      const limitsRes = await fetch(`/api/results/subject-limits?term=${encodeURIComponent(savedTerm)}`);
      if (limitsRes.ok) {
        const limitsJson = await limitsRes.json();
        if (limitsJson.ok) {
          setLimits((limitsJson.data?.limits as SubjectLimit[]) ?? []);
        }
      }

      if (payload.role === "student" && !payload.published) {
        router.replace("/portal/student");
        return;
      }
      if (payload.role === "parent" && !payload.published) {
        router.replace("/portal/parent");
        return;
      }

      if (payload.role === "teacher") {
        const cls = payload.classes?.[0] ?? "";
        const sub = payload.subjects?.[0] ?? "";
        setSelectedClass(cls);
        setSelectedSubject(sub);
      }
      if (payload.settings?.copticYearLabel != null) {
        setCopticYearLabel(payload.settings?.copticYearLabel ?? "");
      }
      if (payload.role === "admin") {
        const firstYear = (payload.classesList ?? [])
          .map((c) => String(c.id ?? "").trim().toUpperCase())
          .find((id) => /^[1-9]/.test(id))
          ?.charAt(0);
        setLimitYear(firstYear ?? "");
        setAvailableYear(firstYear ?? "");
        setLimitTerm(savedTerm);
        setCurrentTerm(savedTerm);
        setAvailableTerm(savedTerm);
        setTerm1SeasonalSubject(payload.settings?.term1SeasonalSubject === "katamars" ? "katamars" : "taks");
        setTerm2SeasonalSubject(payload.settings?.term2SeasonalSubject === "taks" ? "taks" : "katamars");
      }
      if (payload.role === "parent") {
        setSelectedChild(payload.childrenCodes?.[0] ?? "");
      }
    } catch {
      setError("تعذر تحميل صفحة النتائج.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!user?.role) return;
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.role]);

  const role = String(data?.role ?? user?.role ?? "");
  const termForOps = role === "admin" ? currentTerm : data?.settings?.currentTerm ?? "term1";
  const term1Label = (data?.period?.term1Name ?? "").trim() || "التيرم الأول";
  const term2Label = (data?.period?.term2Name ?? "").trim() || "التيرم الثاني";
  const activeTermLabel = currentTerm === "term2" ? term2Label : term1Label;
  const displayYear = (
    copticYearLabel ||
    data?.settings?.copticYearLabel ||
    (data?.period as { copticYearLabel?: string } | undefined)?.copticYearLabel ||
    ""
  ).trim();
  const displayYearText = displayYear || "—";

  useEffect(() => {
    if (!data || role !== "admin") return;
    async function reloadLimits() {
      try {
        const res = await fetch(`/api/results/subject-limits?term=${encodeURIComponent(limitTerm)}`);
        const json = await res.json();
        if (res.ok && json.ok) {
          setLimits((json.data?.limits as SubjectLimit[]) ?? []);
        }
      } catch {
        // ignore
      }
    }
    reloadLimits();
  }, [data, role, limitTerm]);
  useEffect(() => {
    if (role !== "parent") return;
    const codes = (data?.childrenCodes ?? []).map((c) => String(c).trim()).filter(Boolean);
    if (!codes.length) {
      setParentChildrenOptions([]);
      return;
    }
    let cancelled = false;
    async function loadChildrenNames() {
      const results = await Promise.all(
        codes.map(async (code) => {
          try {
            const res = await fetch(`/api/users?code=${encodeURIComponent(code)}`);
            const json = await res.json();
            const name = String(json?.data?.user?.name ?? "").trim();
            return { code, name: name || code };
          } catch {
            return { code, name: code };
          }
        })
      );
      if (!cancelled) setParentChildrenOptions(results);
    }
    loadChildrenNames();
    return () => {
      cancelled = true;
    };
  }, [role, data?.childrenCodes]);

  const selectedLimit = useMemo(() => {
    if (!selectedClass || !selectedSubject) return null;
    const activeLimitTerm = role === "admin" ? limitTerm : termForOps;
    return (
      limits.find(
        (l) =>
          String(l.classId).trim().toUpperCase() === selectedClass.trim().toUpperCase() &&
          String(l.subject).trim() === selectedSubject.trim() &&
          (l.term ? l.term === activeLimitTerm : true)
      ) ?? null
    );
  }, [limits, selectedClass, selectedSubject, role, limitTerm, termForOps]);

  const latestLimit = useMemo(() => {
    if (!limits.length) return null;
    return limits[0];
  }, [limits]);

  useEffect(() => {
    if (!["teacher", "admin"].includes(role) || !selectedClass || !selectedSubject) {
      setClassStudents([]);
      setManualDrafts({});
      return;
    }
    const termToUse = role === "admin" ? currentTerm : termForOps;
    if (!isSubjectAvailableFor(selectedClass, selectedSubject, termToUse)) {
      setClassStudents([]);
      setManualDrafts({});
      setError("لا يوجد درجات لهذه المادة لهذا الفصل.");
      return;
    }
    let cancelled = false;
    (async () => {
      try {
          const res = await fetch(
            `/api/results/manual?classId=${encodeURIComponent(selectedClass)}&subject=${encodeURIComponent(
              selectedSubject
            )}&term=${encodeURIComponent(termForOps)}`
          );
        const json = await res.json();
        if (!res.ok || !json?.ok) return;
        const students = (json?.data?.students ?? []) as ClassStudent[];
        if (cancelled) return;
        setClassStudents(students);
        const next: Record<string, { classwork: string; exam: string; notes: string }> = {};
        for (const student of students) {
          next[student.code] = {
            classwork: student.classworkScore == null ? "" : String(student.classworkScore),
            exam: student.examScore == null ? "" : String(student.examScore),
            notes: String(student.notes ?? ""),
          };
        }
        setManualDrafts(next);
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [role, selectedClass, selectedSubject, currentTerm, termForOps]);

  const adminAllowedTeachers = useMemo(
    () => new Set((data?.settings?.allowedTeacherCodes ?? []).map((v) => String(v).trim())),
    [data?.settings?.allowedTeacherCodes]
  );

  const yearOptions = useMemo(() => {
    const years = new Set<string>();
    for (const cls of data?.classesList ?? []) {
      const id = String(cls.id ?? "").trim().toUpperCase();
      if (/^[1-9]/.test(id)) years.add(id.charAt(0));
    }
    return Array.from(years).sort((a, b) => Number(a) - Number(b));
  }, [data?.classesList]);

  const classesForSelectedYear = useMemo(() => {
    if (!limitYear) return [];
    return (data?.classesList ?? []).filter((cls) =>
      String(cls.id ?? "")
        .trim()
        .toUpperCase()
        .startsWith(limitYear.toUpperCase())
    );
  }, [data?.classesList, limitYear]);

  const classesForAvailableYear = useMemo(() => {
    if (!availableYear) return [];
    return (data?.classesList ?? []).filter((cls) =>
      String(cls.id ?? "")
        .trim()
        .toUpperCase()
        .startsWith(availableYear.toUpperCase())
    );
  }, [data?.classesList, availableYear]);

  const filteredTeachers = useMemo(() => {
    const query = teacherSearch.trim().toLowerCase();
    if (!query) return data?.teachers ?? [];
    return (data?.teachers ?? []).filter((teacher) => {
      const name = String(teacher.name ?? "").toLowerCase();
      const code = String(teacher.code ?? "").toLowerCase();
      return name.includes(query) || code.includes(query);
    });
  }, [data?.teachers, teacherSearch]);

  const adminGradeScale = useMemo(
    () =>
      Array.isArray(data?.settings?.gradeScale) && data.settings?.gradeScale?.length
        ? data.settings.gradeScale.map((item, idx) => ({
            id: String(item.id ?? `scale-${idx + 1}`),
            name: String(item.name ?? "").trim(),
            min: Number(item.min ?? 0),
            max: Number(item.max ?? 0),
          }))
        : [
            { id: "excellent", name: "امتياز", min: 90, max: 100 },
            { id: "very-good", name: "جيد جدا", min: 80, max: 89.99 },
            { id: "good", name: "جيد", min: 65, max: 79.99 },
            { id: "acceptable", name: "مقبول", min: 50, max: 64.99 },
            { id: "fail", name: "راسب", min: 0, max: 49.99 },
          ],
    [data?.settings?.gradeScale]
  );

  const [editableAllowed, setEditableAllowed] = useState<string[]>([]);
  const [editableScale, setEditableScale] = useState<Array<{ id: string; name: string; min: string; max: string }>>([]);

  const allowedTeachers = useMemo(() => {
    const teacherMap = new Map((data?.teachers ?? []).map((t) => [t.code, t]));
    return editableAllowed.map((code) => {
      const teacher = teacherMap.get(code);
      return {
        code,
        name: teacher?.name || `كود: ${code}`,
      };
    });
  }, [data?.teachers, editableAllowed]);

  const teacherCandidates = useMemo(() => {
    const query = teacherSearch.trim().toLowerCase();
    if (!query) return [];
    return filteredTeachers
      .filter((teacher) => !editableAllowed.includes(teacher.code))
      .slice(0, 8);
  }, [filteredTeachers, editableAllowed, teacherSearch]);

  const normalizedTeacherSearch = teacherSearch.trim();
  const canAddTypedCode =
    Boolean(normalizedTeacherSearch) &&
    !editableAllowed.includes(normalizedTeacherSearch) &&
    !teacherCandidates.some((t) => t.code === normalizedTeacherSearch);

  useEffect(() => {
    if (role !== "admin") return;
    setEditableAllowed(Array.from(adminAllowedTeachers));
    setEditableScale(
      adminGradeScale.map((item) => ({
        id: item.id,
        name: item.name,
        min: String(item.min),
        max: String(item.max),
      }))
    );
  }, [role, adminAllowedTeachers, adminGradeScale]);

  useEffect(() => {
    if (!data?.settings?.availableSubjects) return;
    setAvailableMap(data.settings.availableSubjects);
  }, [data?.settings?.availableSubjects]);

  useEffect(() => {
    if (role !== "parent") return;
    if (!selectedChild) {
      setParentRowsTerm1([]);
      setParentRowsTerm2([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        setParentLoading(true);
        const res = await fetch(`/api/results/records?studentCode=${encodeURIComponent(selectedChild)}`);
        const json = await res.json();
        if (!res.ok || !json?.ok || cancelled) {
          setParentRowsTerm1([]);
          setParentRowsTerm2([]);
          return;
        }
        setParentRowsTerm1((json.data?.rowsTerm1 ?? []) as ResultRow[]);
        setParentRowsTerm2((json.data?.rowsTerm2 ?? []) as ResultRow[]);
      } finally {
        if (!cancelled) setParentLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [role, selectedChild]);

  const selectedChildName = useMemo(() => {
    if (parentRowsTerm1.length) return parentRowsTerm1[0]?.studentName || selectedChild;
    if (parentRowsTerm2.length) return parentRowsTerm2[0]?.studentName || selectedChild;
    return selectedChild;
  }, [parentRowsTerm1, parentRowsTerm2, selectedChild]);

  async function saveAdminSettings(nextPublished?: boolean) {
    setSaving(true);
    setError(null);
    try {
        const res = await fetch("/api/results/settings", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...(typeof nextPublished === "boolean" ? { published: nextPublished } : {}),
            allowedTeacherCodes: editableAllowed,
            currentTerm,
            term1SeasonalSubject,
            term2SeasonalSubject,
            copticYearLabel,
            gradeScale: editableScale
              .map((item) => ({
                id: item.id,
                name: item.name.trim(),
                min: Number(item.min),
              max: Number(item.max),
            }))
            .filter((item) => item.name && !Number.isNaN(item.min) && !Number.isNaN(item.max)),
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(json?.message || "تعذر الحفظ.");
        return;
      }
      await loadData();
    } catch {
      setError("تعذر الحفظ.");
    } finally {
      setSaving(false);
    }
  }

  async function saveAllowedTeachers(nextAllowed: string[]) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/results/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ allowedTeacherCodes: nextAllowed }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(json?.message || "تعذر حفظ تصاريح المدرسين.");
        return false;
      }
      return true;
    } catch {
      setError("تعذر حفظ تصاريح المدرسين.");
      return false;
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    if (!availableYear) {
      setAvailableSubjects([]);
      return;
    }
    const termKey = availableTerm === "term2" ? "term2" : "term1";
    const yearMap = availableMap[availableYear] ?? {};
    const list = Array.isArray(yearMap[termKey]) ? yearMap[termKey] : [];
    setAvailableSubjects(list);
  }, [availableYear, availableTerm, availableMap]);

  function isSubjectAvailableFor(classId: string, subject: string, term: "term1" | "term2") {
    if (!classId || !subject) return false;
    const year = classId.trim().toUpperCase().charAt(0);
    if (!year || !/^[1-9]$/.test(year)) return false;
    const map = availableMap?.[year] ?? {};
    const list = Array.isArray(map[term]) ? map[term] : [];
    return list.includes(subject);
  }

  async function saveAvailableSubjects() {
    if (!availableYear || !availableSubjects.length) {
      setError("اختر السنة والمواد أولاً.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const nextMap = {
        ...availableMap,
        [availableYear]: {
          ...(availableMap[availableYear] ?? {}),
          [availableTerm]: availableSubjects,
        },
      };
      const res = await fetch("/api/results/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ availableSubjects: nextMap }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(json?.message || "تعذر حفظ المواد المتاحة.");
        return;
      }
      setAvailableMap(nextMap);
    } catch {
      setError("تعذر حفظ المواد المتاحة.");
    } finally {
      setSaving(false);
    }
  }

  async function saveSubjectLimit() {
    if (!limitYear || !limitSubject || !limitClass) {
      setError("اختر السنة والفصل والمادة أولاً.");
      return;
    }
    if (!classesForSelectedYear.length) {
      setError("لا توجد فصول لهذه السنة.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/results/subject-limits", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          classId: limitClass,
          subject: limitSubject,
          term: role === "admin" ? limitTerm : termForOps,
          minScore: Number(limitMin),
          maxScore: Number(limitMax),
          classworkMinScore: Number(limitClassworkMin),
          classworkMaxScore: Number(limitClassworkMax),
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(json?.message || "تعذر حفظ درجات المادة.");
        return;
      }
      await loadData();
    } catch {
      setError("تعذر حفظ درجات المادة.");
    } finally {
      setSaving(false);
    }
  }

  async function uploadTemplate() {
    if (!templateFile || !selectedClass || !selectedSubject) return;
    if (!isSubjectAvailableFor(selectedClass, selectedSubject, termForOps)) {
      setError("لا يوجد درجات لهذه المادة لهذا الفصل.");
      return;
    }
    setSaving(true);
    setImportMsg(null);
    setImportSkipped([]);
    setManualMsg(null);
    setError(null);
    try {
        const form = new FormData();
        form.append("classId", selectedClass);
        form.append("subject", selectedSubject);
        form.append("file", templateFile);
        form.append("term", termForOps);
        const res = await fetch("/api/results/import", { method: "POST", body: form });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(json?.message || "تعذر رفع الدرجات.");
        return;
      }
      setImportMsg(`تم تحديث ${json.data?.updated ?? 0} طالب.`);
      setImportSkipped(Array.isArray(json.data?.skipped) ? json.data.skipped : []);
      setTemplateFile(null);
    } catch {
      setError("تعذر رفع الدرجات.");
    } finally {
      setSaving(false);
    }
  }

  async function saveManualGradeForStudent(studentCode: string) {
    const draft = manualDrafts[studentCode] ?? { classwork: "", exam: "", notes: "" };
    if (!selectedClass || !selectedSubject || !studentCode.trim()) {
      setError("من فضلك اختر الفصل والمادة.");
      return;
    }
    if (!isSubjectAvailableFor(selectedClass, selectedSubject, termForOps)) {
      setError("لا يوجد درجات لهذه المادة لهذا الفصل.");
      return;
    }
    if (draft.classwork.trim() === "" || draft.exam.trim() === "") {
      setError("من فضلك اكتب درجة الأعمال ودرجة الاختبار.");
      return;
    }
    setSaving(true);
    setError(null);
    setManualMsg(null);
    try {
      const res = await fetch("/api/results/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          classId: selectedClass,
          subject: selectedSubject,
            studentCode: studentCode.trim(),
            classworkScore: Number(draft.classwork),
            examScore: Number(draft.exam),
            notes: draft.notes.trim(),
            term: role === "admin" ? termForOps : undefined,
          }),
        });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(json?.message || "تعذر حفظ الدرجة يدويًا.");
        return;
      }
      setManualMsg(`تم حفظ الدرجة للطالب ${studentCode.trim()}.`);
      await loadData();
    } catch {
      setError("تعذر حفظ الدرجة يدويًا.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteManualGradeForStudent(studentCode: string) {
    if (!selectedClass || !selectedSubject || !studentCode) return;
    if (!isSubjectAvailableFor(selectedClass, selectedSubject, termForOps)) {
      setError("لا يوجد درجات لهذه المادة لهذا الفصل.");
      return;
    }
    setSaving(true);
    setError(null);
    setManualMsg(null);
    try {
        const res = await fetch("/api/results/manual", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            classId: selectedClass,
            subject: selectedSubject,
            studentCode,
            term: role === "admin" ? termForOps : undefined,
          }),
        });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(json?.message || "تعذر مسح درجة الطالب.");
        return;
      }
      setManualMsg(`تم مسح درجة الطالب ${studentCode}.`);
      await loadData();
    } catch {
      setError("تعذر مسح درجة الطالب.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteAllClassSubjectGrades() {
    if (!selectedClass || !selectedSubject) {
      setError("اختر الفصل والمادة أولاً.");
      return;
    }
    if (!isSubjectAvailableFor(selectedClass, selectedSubject, termForOps)) {
      setError("لا يوجد درجات لهذه المادة لهذا الفصل.");
      return;
    }
    const okConfirm = window.confirm(`سيتم مسح درجات مادة ${selectedSubject} لفصل ${selectedClass} بالكامل. هل أنت متأكد؟`);
    if (!okConfirm) return;

    setSaving(true);
    setError(null);
    setManualMsg(null);
    try {
        const res = await fetch("/api/results/manual", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            classId: selectedClass,
            subject: selectedSubject,
            term: role === "admin" ? termForOps : undefined,
          }),
        });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(json?.message || "تعذر مسح درجات المادة.");
        return;
      }
      setManualMsg(`تم مسح ${json.data?.deleted ?? 0} سجل.`);
      await loadData();
    } catch {
      setError("تعذر مسح درجات المادة.");
    } finally {
      setSaving(false);
    }
  }

  async function saveAllManualGrades() {
    if (!selectedClass || !selectedSubject) {
      setError("اختر الفصل والمادة أولاً.");
      return;
    }
    if (!isSubjectAvailableFor(selectedClass, selectedSubject, termForOps)) {
      setError("لا يوجد درجات لهذه المادة لهذا الفصل.");
      return;
    }
    const payloads = classStudents
      .map((student) => {
        const draft = manualDrafts[student.code] ?? { classwork: "", exam: "", notes: "" };
        return {
          studentCode: student.code,
          classworkScore: draft.classwork.trim(),
          examScore: draft.exam.trim(),
          notes: draft.notes.trim(),
        };
      })
      .filter((item) => item.classworkScore !== "" && item.examScore !== "");

    if (!payloads.length) {
      setError("لا توجد درجات مكتملة للحفظ.");
      return;
    }

    setSaving(true);
    setError(null);
    setManualMsg(null);
    try {
      const results = await Promise.allSettled(
        payloads.map((item) =>
          fetch("/api/results/manual", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                classId: selectedClass,
                subject: selectedSubject,
                studentCode: item.studentCode,
                classworkScore: Number(item.classworkScore),
                examScore: Number(item.examScore),
                notes: item.notes,
                term: role === "admin" ? termForOps : undefined,
              }),
            }).then(async (res) => {
            const json = await res.json().catch(() => ({}));
            return { ok: res.ok && json?.ok, message: json?.message as string | undefined };
          })
        )
      );

      let success = 0;
      let fail = 0;
      let firstError = "";
      for (const r of results) {
        if (r.status === "fulfilled" && r.value.ok) success += 1;
        else {
          fail += 1;
          if (!firstError && r.status === "fulfilled" && r.value.message) firstError = r.value.message;
        }
      }

      if (fail > 0 && firstError) setError(firstError);
      setManualMsg(`تم حفظ ${success} طالب${fail > 0 ? `، وفشل ${fail}` : ""}.`);
      await loadData();
    } catch {
      setError("تعذر حفظ الدرجات.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen px-6 pb-24 pt-10">
        <div className="mx-auto w-full max-w-5xl rounded-3xl border border-white/20 bg-white/15 p-6 text-white backdrop-blur-md">
          جار تحميل النتائج...
        </div>
      </main>
    );
  }

  if (!data) {
    return (
      <main className="min-h-screen px-6 pb-24 pt-10">
        <div className="mx-auto w-full max-w-5xl rounded-3xl border border-white/20 bg-white/15 p-6 text-white backdrop-blur-md">
          {error || "تعذر تحميل الصفحة."}
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen px-6 pb-24 pt-10">
      <section className="mx-auto w-full max-w-5xl rounded-3xl border border-white/20 bg-white/15 p-6 text-white shadow-[var(--shadow)] backdrop-blur-md">
        <h1 className="app-heading mt-2">النتائج</h1>
        {role === "admin" ? (
          <div className="mt-4 rounded-2xl border border-white/20 bg-white/10 p-4">
            <p className="text-sm font-semibold">السنة القبطية الحالية</p>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <label className="grid gap-1 text-xs text-white/90">
                <span>اكتب السنة القبطية كما تريد ظهورها في الشهادة</span>
                <input
                  value={copticYearLabel}
                  onChange={(e) => setCopticYearLabel(e.target.value)}
                  className="rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-xs text-white"
                  placeholder="مثال: 1742 ش"
                />
              </label>
            </div>
            <button
              type="button"
              onClick={() => saveAdminSettings(undefined)}
              disabled={saving}
              className="mt-3 rounded-full bg-white px-4 py-2 text-xs font-semibold text-black disabled:opacity-60"
            >
              حفظ العام القبطي
            </button>
          </div>
        ) : null}
        {/* period label removed for student/parent view */}
        {error ? <p className="mt-2 text-xs text-red-200">{error}</p> : null}

        {role === "admin" ? (
          <div className="mt-6 grid gap-5">
            <div className="rounded-2xl border border-white/20 bg-white/10 p-4">
              <p className="text-sm font-semibold">نشر الشهادات</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => saveAdminSettings(true)}
                  disabled={saving}
                  className="rounded-full bg-emerald-600 px-4 py-2 text-xs font-semibold text-white disabled:opacity-60"
                >
                  فتح الشهادات
                </button>
                <button
                  type="button"
                  onClick={() => saveAdminSettings(false)}
                  disabled={saving}
                  className="rounded-full bg-red-600 px-4 py-2 text-xs font-semibold text-white disabled:opacity-60"
                >
                  إغلاق الشهادات
                </button>
                <span className="rounded-full border border-white/30 px-3 py-2 text-xs">
                  الحالة: {data.published ? "مفتوحة" : "مغلقة"}
                </span>
              </div>
            </div>

            <div className="rounded-2xl border border-white/20 bg-white/10 p-4">
              <p className="text-sm font-semibold">تصاريح المدرسين لرفع الدرجات</p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <label className="text-xs text-white/80">
                  التيرم الذي سيرفع فيه المدرسون الدرجات
                  <select
                    value={currentTerm}
                    onChange={(e) => {
                      const next = e.target.value === "term2" ? "term2" : "term1";
                      setCurrentTerm(next);
                      // admin term for teachers (and admin) uploads
                    }}
                    className="mt-1 w-full rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-xs text-white"
                  >
                    <option value="term1" className="text-black">
                      {term1Label}
                    </option>
                    <option value="term2" className="text-black">
                      {term2Label}
                    </option>
                  </select>
                </label>
                <div className="flex items-end">
                  <button
                    type="button"
                    onClick={() => saveAdminSettings()}
                    disabled={saving}
                    className="w-full rounded-full bg-white px-4 py-2 text-xs font-semibold text-black disabled:opacity-60"
                  >
                    حفظ اختيار التيرم
                  </button>
                </div>
              </div>
              <input
                value={teacherSearch}
                onChange={(e) => setTeacherSearch(e.target.value)}
                className="mt-3 w-full rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-xs text-white"
                placeholder="ابحث باسم المدرس أو كوده"
              />
              {teacherCandidates.length ? (
                <div className="mt-3 grid gap-2">
                  {teacherCandidates.map((teacher) => (
                    <button
                      key={teacher.code}
                      type="button"
                      onClick={async () => {
                        const nextAllowed = editableAllowed.includes(teacher.code)
                          ? editableAllowed
                          : [...editableAllowed, teacher.code];
                        setEditableAllowed(nextAllowed);
                        setTeacherSearch("");
                        const ok = await saveAllowedTeachers(nextAllowed);
                        if (!ok) return;
                        await loadData();
                      }}
                      className="flex items-center justify-between rounded-xl border border-white/20 bg-white/5 px-3 py-2 text-xs text-white hover:bg-white/10"
                    >
                      <span>{teacher.name}</span>
                      <span className="text-white/70">{teacher.code}</span>
                    </button>
                  ))}
                </div>
              ) : null}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={async () => {
                    const code = normalizedTeacherSearch;
                    if (!code || editableAllowed.includes(code)) return;
                    const nextAllowed = [...editableAllowed, code];
                    setEditableAllowed(nextAllowed);
                    setTeacherSearch("");
                    const ok = await saveAllowedTeachers(nextAllowed);
                    if (!ok) return;
                    await loadData();
                  }}
                  disabled={!canAddTypedCode || saving}
                  className={`rounded-full border px-4 py-2 text-xs ${
                    canAddTypedCode && !saving
                      ? "border-white/30 text-white"
                      : "border-white/20 text-white/50"
                  }`}
                >
                  إضافة الكود المكتوب
                </button>
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {allowedTeachers.map((teacher) => (
                  <div
                    key={teacher.code}
                    className="flex items-center justify-between gap-2 rounded-xl border border-emerald-300/60 bg-emerald-500/20 px-3 py-2 text-xs"
                  >
                    <div className="min-w-0">
                      <p className="truncate">{teacher.name}</p>
                      <p className="truncate text-[10px] text-white/80">{teacher.code}</p>
                    </div>
                    <button
                      type="button"
                      onClick={async () => {
                        const nextAllowed = editableAllowed.filter((v) => v !== teacher.code);
                        setEditableAllowed(nextAllowed);
                        const ok = await saveAllowedTeachers(nextAllowed);
                        if (!ok) return;
                        await loadData();
                      }}
                      className="rounded-full border border-red-300/60 bg-red-500/20 px-2 py-1 text-[10px] text-red-100"
                    >
                      إزالة
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-white/20 bg-white/10 p-4">
              <p className="text-sm font-semibold">سلم التقديرات</p>
              <div className="mt-3 grid gap-2">
                <div className="grid grid-cols-12 gap-2 px-1 text-[11px] text-white/80">
                  <span className="col-span-5">اسم التقدير</span>
                  <span className="col-span-3">الدرجة الصغرى</span>
                  <span className="col-span-3">الدرجة العظمى</span>
                  <span className="col-span-1 text-center"></span>
                </div>
                {editableScale.map((item, idx) => (
                  <div key={item.id} className="grid grid-cols-12 gap-2">
                    <input
                      value={item.name}
                      onChange={(e) =>
                        setEditableScale((prev) =>
                          prev.map((it, i) => (i === idx ? { ...it, name: e.target.value } : it))
                        )
                      }
                      className="col-span-5 rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-xs text-white"
                      placeholder="اسم التقدير"
                    />
                    <input
                      value={item.min}
                      onChange={(e) =>
                        setEditableScale((prev) =>
                          prev.map((it, i) => (i === idx ? { ...it, min: e.target.value } : it))
                        )
                      }
                      className="col-span-3 rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-xs text-white"
                      placeholder="من"
                    />
                    <input
                      value={item.max}
                      onChange={(e) =>
                        setEditableScale((prev) =>
                          prev.map((it, i) => (i === idx ? { ...it, max: e.target.value } : it))
                        )
                      }
                      className="col-span-3 rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-xs text-white"
                      placeholder="إلى"
                    />
                    <button
                      type="button"
                      onClick={() => setEditableScale((prev) => prev.filter((_, i) => i !== idx))}
                      className="col-span-1 flex items-center justify-center px-1 py-1"
                      title="حذف التقدير"
                    >
                      <img src="/delete-2.png" alt="حذف" className="h-7 w-7 object-contain" />
                    </button>
                  </div>
                ))}
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setEditableScale((prev) => [
                        ...prev,
                        { id: `scale-${Date.now()}`, name: "", min: "0", max: "0" },
                      ])
                    }
                    className="rounded-full border border-white/30 px-3 py-1 text-xs"
                  >
                    إضافة تقدير
                  </button>
                  <button
                    type="button"
                    onClick={() => saveAdminSettings()}
                    disabled={saving}
                    className="rounded-full bg-white px-4 py-1 text-xs font-semibold text-black disabled:opacity-60"
                  >
                    حفظ إعدادات النتائج
                  </button>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-white/20 bg-white/10 p-4">
              <p className="text-sm font-semibold">المواد المتاحة لكل سنة</p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <select
                  value={availableYear}
                  onChange={(e) => setAvailableYear(e.target.value)}
                  className="rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-xs text-white"
                >
                  <option value="" className="text-black">اختر السنة</option>
                  {yearOptions.map((year) => (
                    <option key={year} value={year} className="text-black">
                      سنة {year}
                    </option>
                  ))}
                </select>
                <select
                  value={availableTerm}
                  onChange={(e) => setAvailableTerm(e.target.value === "term2" ? "term2" : "term1")}
                  className="rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-xs text-white"
                >
                  <option value="term1" className="text-black">{term1Label}</option>
                  <option value="term2" className="text-black">{term2Label}</option>
                </select>
              </div>
              <div className="mt-3 rounded-xl border border-white/15 bg-white/5 p-3">
                <p className="text-xs text-white/80">
                  اختر المواد المتاحة لهذه السنة في {availableTerm === "term2" ? term2Label : term1Label}:
                </p>
                <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {SUBJECTS.map((subject) => (
                    <label key={subject} className="flex items-center gap-2 text-xs text-white/90">
                      <input
                        type="checkbox"
                        checked={availableSubjects.includes(subject)}
                        onChange={(e) => {
                          setAvailableSubjects((prev) =>
                            e.target.checked ? [...prev, subject] : prev.filter((s) => s !== subject)
                          );
                        }}
                      />
                      {subject}
                    </label>
                  ))}
                </div>
              </div>
              <button
                type="button"
                onClick={saveAvailableSubjects}
                disabled={saving}
                className="mt-3 rounded-full bg-white px-4 py-2 text-xs font-semibold text-black disabled:opacity-60"
              >
                حفظ المواد المتاحة
              </button>
            </div>

            <div className="rounded-2xl border border-white/20 bg-white/10 p-4">
              <p className="text-sm font-semibold">إعداد الدرجات الصغرى/العظمى حسب السنة</p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <select
                  value={limitYear}
                  onChange={(e) => {
                    setLimitYear(e.target.value);
                    setLimitClass("");
                  }}
                  className="rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-xs text-white"
                >
                  <option value="" className="text-black">اختر السنة</option>
                  {yearOptions.map((year) => (
                    <option key={year} value={year} className="text-black">
                      سنة {year}
                    </option>
                  ))}
                </select>
                <select
                  value={limitTerm}
                  onChange={(e) => setLimitTerm(e.target.value === "term2" ? "term2" : "term1")}
                  className="rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-xs text-white"
                >
                  <option value="term1" className="text-black">{term1Label}</option>
                  <option value="term2" className="text-black">{term2Label}</option>
                </select>
                <select
                  value={limitClass}
                  onChange={(e) => setLimitClass(e.target.value)}
                  className="rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-xs text-white"
                >
                  <option value="" className="text-black">اختر الفصل</option>
                  {classesForSelectedYear.map((cls) => (
                    <option key={cls.id} value={cls.id} className="text-black">
                      {cls.name}
                    </option>
                  ))}
                </select>
                <select
                  value={limitSubject}
                  onChange={(e) => setLimitSubject(e.target.value)}
                  className="rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-xs text-white"
                >
                  <option value="" className="text-black">اختر المادة</option>
                  {SUBJECTS.map((s) => (
                    <option key={s} value={s} className="text-black">{s}</option>
                  ))}
                </select>
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <label className="grid gap-1 text-xs text-white/90">
                  <span>الدرجة الصغرى للاختبار</span>
                  <input
                    value={limitMin}
                    onChange={(e) => setLimitMin(e.target.value)}
                    className="rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-xs text-white"
                    placeholder="مثال: 10"
                  />
                </label>
                <label className="grid gap-1 text-xs text-white/90">
                  <span>الدرجة العظمى للاختبار</span>
                  <input
                    value={limitMax}
                    onChange={(e) => setLimitMax(e.target.value)}
                    className="rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-xs text-white"
                    placeholder="مثال: 20"
                  />
                </label>
                <label className="grid gap-1 text-xs text-white/90">
                  <span>الدرجة الصغرى للأعمال</span>
                  <input
                    value={limitClassworkMin}
                    onChange={(e) => setLimitClassworkMin(e.target.value)}
                    className="rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-xs text-white"
                    placeholder="مثال: 0"
                  />
                </label>
                <label className="grid gap-1 text-xs text-white/90">
                  <span>الدرجة العظمى للأعمال</span>
                  <input
                    value={limitClassworkMax}
                    onChange={(e) => setLimitClassworkMax(e.target.value)}
                    className="rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-xs text-white"
                    placeholder="مثال: 20"
                  />
                </label>
              </div>
              <p className="mt-2 text-xs text-white/70">
                سيتم تطبيق الدرجات على: {limitClass || "اختر الفصل أولاً"}
              </p>
              <button
                type="button"
                onClick={saveSubjectLimit}
                disabled={saving}
                className="mt-3 rounded-full bg-white px-4 py-2 text-xs font-semibold text-black disabled:opacity-60"
              >
                حفظ درجات المادة
              </button>
              <div className="mt-3 rounded-xl border border-white/20 bg-white/5 p-3 text-xs text-white/90">
                <p className="font-semibold">آخر عملية حفظ لإعدادات الدرجات</p>
                {latestLimit ? (
                  <p className="mt-1">
                    {latestLimit.classId} - {latestLimit.subject}: الاختبار {latestLimit.minScore}/{latestLimit.maxScore} | الأعمال{" "}
                    {latestLimit.classworkMinScore}/{latestLimit.classworkMaxScore}
                    {latestLimit.updatedAt ? ` (${new Date(latestLimit.updatedAt).toLocaleString("ar-KW")})` : ""}
                  </p>
                ) : (
                  <p className="mt-1 text-white/70">لا يوجد حفظ بعد.</p>
                )}
              </div>
            </div>

            <div className="rounded-2xl border border-white/20 bg-white/10 p-4">
              <p className="text-sm font-semibold">تصدير درجات فصل</p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <select
                  value={selectedClass}
                  onChange={(e) => setSelectedClass(e.target.value)}
                  className="rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-xs text-white"
                >
                  <option value="" className="text-black">اختر الفصل</option>
                  {(data.classesList ?? []).map((cls) => (
                    <option key={cls.id} value={cls.id} className="text-black">{cls.name}</option>
                  ))}
                </select>
                <select
                  value={selectedSubject}
                  onChange={(e) => setSelectedSubject(e.target.value)}
                  className="rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-xs text-white"
                >
                  <option value="" className="text-black">اختر المادة</option>
                  {SUBJECTS.map((sub) => (
                    <option key={sub} value={sub} className="text-black">{sub}</option>
                  ))}
                </select>
                <a
                  href={
                    selectedClass
                      ? `/api/results/class-export?classId=${encodeURIComponent(selectedClass)}&term=${encodeURIComponent(
                          termForOps
                        )}`
                      : "#"
                  }
                  className={`rounded-full px-4 py-2 text-xs font-semibold ${
                    selectedClass ? "bg-white text-black" : "pointer-events-none bg-white/30 text-white/70"
                  }`}
                >
                  تنزيل Excel الدرجات
                </a>
                <button
                  type="button"
                  onClick={deleteAllClassSubjectGrades}
                  disabled={!selectedClass || !selectedSubject || saving}
                  className="rounded-full border border-red-300/50 bg-red-500/20 px-4 py-2 text-xs font-semibold text-red-100 disabled:opacity-60"
                >
                  مسح كل درجات المادة للفصل
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {["teacher", "admin"].includes(role) ? (
          <div className="mt-6 rounded-2xl border border-white/20 bg-white/10 p-4">
            {role === "admin" || data.allowed ? (
              <>
                <p className="text-sm font-semibold">رفع درجات الطلاب</p>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    <select
                      value={selectedClass}
                      onChange={(e) => setSelectedClass(e.target.value)}
                      className="rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-xs text-white"
                    >
                    <option value="" className="text-black">اختر الفصل</option>
                    {(role === "admin" ? (data.classesList ?? []).map((c) => c.id) : (data.classes ?? [])).map((cls) => (
                      <option key={cls} value={cls} className="text-black">{cls}</option>
                    ))}
                    </select>
                    <select
                      value={selectedSubject}
                      onChange={(e) => setSelectedSubject(e.target.value)}
                      className="rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-xs text-white"
                    >
                      <option value="" className="text-black">اختر المادة</option>
                      {(role === "admin" ? SUBJECTS : data.subjects ?? []).map((sub) => (
                        <option key={sub} value={sub} className="text-black">{sub}</option>
                      ))}
                    </select>
                    {role === "admin" ? (
                      <div className="rounded-xl border border-white/20 bg-white/5 px-3 py-2 text-xs text-white/90">
                        التيرم الفعّال للرفع: <span className="font-semibold text-white">{activeTermLabel}</span>
                      </div>
                    ) : null}
                  </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <a
                    href={
                      selectedClass && selectedSubject
                        ? `/api/results/template?classId=${encodeURIComponent(selectedClass)}&subject=${encodeURIComponent(
                            selectedSubject
                          )}&term=${encodeURIComponent(termForOps)}`
                        : "#"
                    }
                    className={`rounded-full px-4 py-2 text-xs font-semibold ${
                      selectedClass && selectedSubject
                        ? "bg-white text-black"
                        : "pointer-events-none bg-white/30 text-white/70"
                    }`}
                  >
                    تنزيل تيمبليت الدرجات
                  </a>
                  <input
                    type="file"
                    accept=".xlsx,.xls"
                    onChange={(e) => setTemplateFile(e.target.files?.[0] ?? null)}
                    className="rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-xs text-white"
                  />
                  <button
                    type="button"
                    onClick={uploadTemplate}
                    disabled={!templateFile || !selectedClass || !selectedSubject || saving}
                    className="rounded-full bg-emerald-600 px-4 py-2 text-xs font-semibold text-white disabled:opacity-60"
                  >
                    رفع الدرجات
                  </button>
                </div>
                {importMsg ? <p className="mt-3 text-xs text-emerald-200">{importMsg}</p> : null}
                {importSkipped.length ? (
                  <div className="mt-3 rounded-xl border border-amber-300/50 bg-amber-500/10 p-3">
                    <p className="text-xs font-semibold text-amber-100">سبب رفض بعض الصفوف:</p>
                    <ul className="mt-2 list-disc space-y-1 pr-4 text-[11px] text-amber-100/90">
                      {importSkipped.slice(0, 12).map((reason, idx) => (
                        <li key={`${reason}-${idx}`}>{reason}</li>
                      ))}
                    </ul>
                    {importSkipped.length > 12 ? (
                      <p className="mt-1 text-[10px] text-amber-100/80">...و{importSkipped.length - 12} صف إضافي.</p>
                    ) : null}
                  </div>
                ) : null}

                <div className="mt-4 rounded-xl border border-white/20 bg-white/5 p-3">
                  <p className="text-sm font-semibold">إضافة درجة يدويًا</p>
                  <p className="mt-1 text-[11px] text-white/75">
                    درجة الأعمال (العظمى: {selectedLimit?.classworkMaxScore ?? 20}) - درجة الاختبار (العظمى:{" "}
                    {selectedLimit?.maxScore ?? 20})
                  </p>
                  <div className="mt-3 overflow-x-auto">
                    <table className="min-w-full border-collapse text-xs text-white">
                      <thead>
                        <tr>
                          <th className="border border-white/20 px-2 py-2">الطالب</th>
                          <th className="border border-white/20 px-2 py-2">الكود</th>
                          <th className="border border-white/20 px-2 py-2">
                            درجة الأعمال ({selectedLimit?.classworkMaxScore ?? 20})
                          </th>
                          <th className="border border-white/20 px-2 py-2">درجة الاختبار ({selectedLimit?.maxScore ?? 20})</th>
                          <th className="border border-white/20 px-2 py-2">ملاحظات</th>
                          <th className="border border-white/20 px-2 py-2">إجراء</th>
                        </tr>
                      </thead>
                      <tbody>
                        {classStudents.map((student) => (
                          <tr key={student.code}>
                            <td className="border border-white/20 px-2 py-1">{student.name}</td>
                            <td className="border border-white/20 px-2 py-1 text-center">{student.code}</td>
                            <td className="border border-white/20 px-2 py-1">
                              <input
                                value={manualDrafts[student.code]?.classwork ?? ""}
                                onChange={(e) =>
                                  setManualDrafts((prev) => ({
                                    ...prev,
                                    [student.code]: { ...(prev[student.code] ?? { classwork: "", exam: "", notes: "" }), classwork: e.target.value },
                                  }))
                                }
                                className="w-24 rounded-lg border border-white/20 bg-white/10 px-2 py-1 text-center text-xs text-white"
                                placeholder="0"
                              />
                            </td>
                            <td className="border border-white/20 px-2 py-1">
                              <input
                                value={manualDrafts[student.code]?.exam ?? ""}
                                onChange={(e) =>
                                  setManualDrafts((prev) => ({
                                    ...prev,
                                    [student.code]: { ...(prev[student.code] ?? { classwork: "", exam: "", notes: "" }), exam: e.target.value },
                                  }))
                                }
                                className="w-24 rounded-lg border border-white/20 bg-white/10 px-2 py-1 text-center text-xs text-white"
                                placeholder="0"
                              />
                            </td>
                            <td className="border border-white/20 px-2 py-1">
                              <input
                                value={manualDrafts[student.code]?.notes ?? ""}
                                onChange={(e) =>
                                  setManualDrafts((prev) => ({
                                    ...prev,
                                    [student.code]: { ...(prev[student.code] ?? { classwork: "", exam: "", notes: "" }), notes: e.target.value },
                                  }))
                                }
                                className="w-40 rounded-lg border border-white/20 bg-white/10 px-2 py-1 text-xs text-white"
                                placeholder="اختياري"
                              />
                            </td>
                            <td className="border border-white/20 px-2 py-1 text-center">
                              <div className="flex items-center justify-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => saveManualGradeForStudent(student.code)}
                                  disabled={saving || !selectedClass || !selectedSubject}
                                  className="rounded-full bg-sky-600 px-3 py-1 text-[11px] font-semibold text-white disabled:opacity-60"
                                >
                                  حفظ
                                </button>
                                <button
                                  type="button"
                                  onClick={() => deleteManualGradeForStudent(student.code)}
                                  disabled={saving || !selectedClass || !selectedSubject}
                                  className="rounded-full border border-red-300/50 bg-red-500/20 px-3 py-1 text-[11px] font-semibold text-red-100 disabled:opacity-60"
                                >
                                  مسح
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                        {!classStudents.length ? (
                          <tr>
                            <td colSpan={6} className="border border-white/20 px-2 py-3 text-center text-white/70">
                              لا يوجد طلاب في الفصل المختار.
                            </td>
                          </tr>
                        ) : null}
                      </tbody>
                    </table>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={saveAllManualGrades}
                      disabled={saving || !selectedClass || !selectedSubject || !classStudents.length}
                      className="rounded-full bg-emerald-600 px-4 py-2 text-xs font-semibold text-white disabled:opacity-60"
                    >
                      حفظ الكل
                    </button>
                    <button
                      type="button"
                      onClick={deleteAllClassSubjectGrades}
                      disabled={saving || !selectedClass || !selectedSubject}
                      className="rounded-full border border-red-300/50 bg-red-500/20 px-4 py-2 text-xs font-semibold text-red-100 disabled:opacity-60"
                    >
                      مسح الكل
                    </button>
                  </div>
                  {manualMsg ? <p className="mt-2 text-xs text-emerald-200">{manualMsg}</p> : null}
                </div>
              </>
            ) : (
              <div className="rounded-2xl border border-red-300/40 bg-red-500/10 px-4 py-4 text-sm text-red-100">
                للأسف، غير مسموح لك الدخول.
                <p className="mt-1 text-xs text-red-200/90">يمكنك التواصل مع الأدمن بشأن ذلك.</p>
              </div>
            )}
          </div>
        ) : null}

        {role === "student" ? (
          <div className="mt-6 rounded-2xl border border-white/20 bg-white/10 p-4">
            <p className="text-sm font-semibold">نتيجة الطالب للعام الدراسي / {displayYearText}</p>
            <div className="mt-3 space-y-3">
              {(data?.rowsTerm1 ?? []).length ? (
                <div className="rounded-2xl border border-white/15 bg-white/5 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-semibold">نتيجة الفصل الدراسي الأول</p>
                  </div>
                  <a
                    href="/api/results/certificate"
                    className="mt-3 inline-flex rounded-full bg-white px-4 py-2 text-xs font-semibold text-black"
                  >
                    تنزيل النتيجة
                  </a>
                </div>
              ) : null}
              {(data?.rowsTerm2 ?? []).length ? (
                <div className="rounded-2xl border border-white/15 bg-white/5 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-semibold">نتيجة الفصل الدراسي الثاني</p>
                  </div>
                  <a
                    href="/api/results/certificate"
                    className="mt-3 inline-flex rounded-full bg-white px-4 py-2 text-xs font-semibold text-black"
                  >
                    تنزيل النتيجة
                  </a>
                </div>
              ) : null}
              {!(data?.rowsTerm1 ?? []).length && !(data?.rowsTerm2 ?? []).length ? (
                <p className="text-xs text-white/70">لا توجد نتائج بعد.</p>
              ) : null}
            </div>
          </div>
        ) : null}

        {role === "parent" ? (
          <div className="mt-6 rounded-2xl border border-white/20 bg-white/10 p-4">
            <p className="text-sm font-semibold">نتائج الأبناء للعام الدراسي / {displayYearText}</p>
            {(data.childrenCodes ?? []).length === 0 ? (
              <p className="mt-2 text-xs text-white/70">لا يوجد أبناء مرتبطون بهذا الحساب.</p>
            ) : (
              <div className="mt-3">
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    value={selectedChild}
                    onChange={(e) => setSelectedChild(e.target.value)}
                    className="rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-xs text-white"
                  >
                    {parentChildrenOptions.map((child) => (
                      <option key={child.code} value={child.code} className="text-black">
                        {child.name} - {child.code}
                      </option>
                    ))}
                  </select>
                  <a
                    href={selectedChild ? `/api/results/certificate?studentCode=${encodeURIComponent(selectedChild)}` : "#"}
                    className={`rounded-full px-4 py-2 text-xs font-semibold ${
                      selectedChild ? "bg-white text-black" : "pointer-events-none bg-white/30 text-white/70"
                    }`}
                  >
                    تنزيل الشهادة
                  </a>
                </div>
                <div className="mt-4 space-y-3">
                  {parentLoading ? (
                    <p className="text-xs text-white/70">جارٍ تحميل النتائج...</p>
                  ) : (
                    <>
                      {parentRowsTerm1.length ? (
                        <div className="rounded-2xl border border-white/15 bg-white/5 p-3">
                          <p className="text-xs text-white/80">اسم الطالب: {selectedChildName}</p>
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="text-sm font-semibold">نتيجة الفصل الدراسي الأول</p>
                          </div>
                          <a
                            href={
                              selectedChild
                                ? `/api/results/certificate?studentCode=${encodeURIComponent(selectedChild)}`
                                : "#"
                            }
                            className={`mt-3 inline-flex rounded-full px-4 py-2 text-xs font-semibold ${
                              selectedChild ? "bg-white text-black" : "pointer-events-none bg-white/30 text-white/70"
                            }`}
                          >
                            تنزيل النتيجة
                          </a>
                        </div>
                      ) : null}
                      {parentRowsTerm2.length ? (
                        <div className="rounded-2xl border border-white/15 bg-white/5 p-3">
                          <p className="text-xs text-white/80">اسم الطالب: {selectedChildName}</p>
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="text-sm font-semibold">نتيجة الفصل الدراسي الثاني</p>
                          </div>
                          <a
                            href={
                              selectedChild
                                ? `/api/results/certificate?studentCode=${encodeURIComponent(selectedChild)}`
                                : "#"
                            }
                            className={`mt-3 inline-flex rounded-full px-4 py-2 text-xs font-semibold ${
                              selectedChild ? "bg-white text-black" : "pointer-events-none bg-white/30 text-white/70"
                            }`}
                          >
                            تنزيل النتيجة
                          </a>
                        </div>
                      ) : null}
                      {!parentRowsTerm1.length && !parentRowsTerm2.length ? (
                        <p className="text-xs text-white/70">لا توجد نتائج بعد.</p>
                      ) : null}
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        ) : null}
      </section>
    </main>
  );
}





