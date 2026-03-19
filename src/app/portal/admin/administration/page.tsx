"use client";

import Link from "next/link";
import BackButton from "@/app/back-button";
import { useEffect, useMemo, useState } from "react";

type ClassItem = { id: string; name: string };
type StoredUser = { studentCode?: string; role?: string };
type TeacherItem = { code: string; name: string; classes: string[]; subjects: string[] };

const SUBJECT_OPTIONS = ["طقس", "اجبيه", "قطمارس", "الحان", "قبطي"];

const roleOptions = [
  { value: "admin", label: "Admin" },
  { value: "system", label: "نظام" },
  { value: "teacher", label: "مدرس" },
  { value: "parent", label: "ولي أمر" },
  { value: "notes", label: "ملاحظات" },
  { value: "katamars", label: "قطمارس" },
  { value: "student", label: "طالب" },
];

export default function AdministrationPage() {
  const [me, setMe] = useState<StoredUser | null>(null);
  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [loadingClasses, setLoadingClasses] = useState(true);

  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [role, setRole] = useState("student");
  const [password, setPassword] = useState("");
  const [parentCode, setParentCode] = useState("");
  const [studentCodes, setStudentCodes] = useState("");
  const [singleClass, setSingleClass] = useState("");
  const [teacherClasses, setTeacherClasses] = useState<string[]>([]);
  const [teacherSubjects, setTeacherSubjects] = useState<string[]>([]);
  const [manualLoading, setManualLoading] = useState(false);
  const [manualError, setManualError] = useState<string | null>(null);
  const [createdCode, setCreatedCode] = useState<string | null>(null);

  const [excelFile, setExcelFile] = useState<File | null>(null);
  const [importLoading, setImportLoading] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<{
    imported: number;
    skipped: number;
    createdCodes: string[];
    skipDetails: string[];
  } | null>(null);
  const [promoteCode, setPromoteCode] = useState("");
  const [promoteOldClass, setPromoteOldClass] = useState("");
  const [promoteNewClass, setPromoteNewClass] = useState("");
  const [promoteLoading, setPromoteLoading] = useState(false);
  const [promoteError, setPromoteError] = useState<string | null>(null);
  const [promoteResult, setPromoteResult] = useState<string | null>(null);

  const [promoteExcelFile, setPromoteExcelFile] = useState<File | null>(null);
  const [promoteImportLoading, setPromoteImportLoading] = useState(false);
  const [promoteImportError, setPromoteImportError] = useState<string | null>(null);
  const [promoteImportResult, setPromoteImportResult] = useState<{
    updated: number;
    updatedParents?: number;
    skipped: number;
    skipDetails: string[];
  } | null>(null);
  const [newClassCode, setNewClassCode] = useState("");
  const [newClassName, setNewClassName] = useState("");
  const [classCreateLoading, setClassCreateLoading] = useState(false);
  const [classCreateError, setClassCreateError] = useState<string | null>(null);
  const [classCreateSuccess, setClassCreateSuccess] = useState<string | null>(null);
  const [teachers, setTeachers] = useState<TeacherItem[]>([]);
  const [selectedTeacherCode, setSelectedTeacherCode] = useState("");
  const [teacherClassToAdd, setTeacherClassToAdd] = useState("");
  const [teacherClassLoading, setTeacherClassLoading] = useState(false);
  const [teacherClassError, setTeacherClassError] = useState<string | null>(null);
  const [teacherClassSuccess, setTeacherClassSuccess] = useState<string | null>(null);

  useEffect(() => {
    const stored = window.localStorage.getItem("dsms:user");
    if (!stored) return;
    try {
      setMe(JSON.parse(stored) as StoredUser);
    } catch {
      setMe(null);
    }
  }, []);

  useEffect(() => {
    async function loadClasses() {
      try {
        const res = await fetch("/api/classes");
        const json = await res.json();
        if (res.ok && json.ok) {
          setClasses(json.data as ClassItem[]);
        }
      } finally {
        setLoadingClasses(false);
      }
    }
    loadClasses();
  }, []);

  useEffect(() => {
    async function loadTeachers() {
      if (me?.role !== "admin" || !me?.studentCode || !me?.role) return;
      try {
        const query = new URLSearchParams({
          role: "teacher",
          actorCode: me.studentCode,
          actorRole: me.role,
        });
        const res = await fetch(`/api/users?${query.toString()}`);
        const json = await res.json();
        if (!res.ok || !json.ok) return;
        const rows = Array.isArray(json.data)
          ? (json.data as Array<{ code?: string; name?: string; classes?: string[]; subjects?: string[] }>).map((item) => ({
              code: String(item.code ?? "").trim(),
              name: String(item.name ?? "").trim(),
              classes: Array.isArray(item.classes)
                ? item.classes.map((c) => String(c).trim()).filter(Boolean)
                : [],
              subjects: Array.isArray(item.subjects)
                ? item.subjects.map((s) => String(s).trim()).filter(Boolean)
                : [],
            }))
          : [];
        setTeachers(rows.filter((item) => item.code));
      } catch {
        // ignore
      }
    }
    loadTeachers();
  }, [me?.role, me?.studentCode]);

  const isAdmin = me?.role === "admin";
  const selectedClasses = useMemo(() => {
    if (role === "admin") return [];
    if (role === "parent") return [];
    if (role === "notes") return [];
    if (role === "katamars") return [];
    if (role === "teacher") return teacherClasses;
    return singleClass ? [singleClass] : [];
  }, [role, teacherClasses, singleClass]);

  async function submitManual(e: React.FormEvent) {
    e.preventDefault();
    setManualError(null);
    setCreatedCode(null);

    if (!name.trim() || !code.trim() || !password.trim()) {
      setManualError("الاسم وكود المستخدم والباسورد المبدئي مطلوبين.");
      return;
    }
    if (!["admin", "parent", "notes", "katamars"].includes(role) && selectedClasses.length === 0) {
      setManualError("اختر فصل واحد على الأقل.");
      return;
    }
    if (role !== "teacher" && role !== "admin" && role !== "notes" && selectedClasses.length > 1) {
      setManualError("هذا الدور يسمح بفصل واحد فقط.");
      return;
    }
    if (role === "teacher" && teacherSubjects.length === 0) {
      setManualError("اختر مادة واحدة على الأقل للمدرس.");
      return;
    }
    if (!me?.studentCode || !me?.role) {
      setManualError("جلسة المستخدم غير متاحة.");
      return;
    }

    setManualLoading(true);
    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          actorCode: me.studentCode,
          actorRole: me.role,
          code: code.trim(),
          name: name.trim(),
          role,
          startupPassword: password.trim(),
          classes: selectedClasses,
          subjects: role === "teacher" ? teacherSubjects : [],
          parentCodes:
            role === "student" && parentCode.trim()
              ? parentCode
                  .split(/[,،]/)
                  .map((v) => v.trim())
                  .filter(Boolean)
              : role === "parent" && studentCodes.trim()
              ? studentCodes
                  .split(/[,،]/)
                  .map((v) => v.trim())
                  .filter(Boolean)
              : [],
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setManualError(json?.message || "فشل إضافة الحساب.");
        return;
      }
      setCreatedCode(json.data.code as string);
      setName("");
      setCode("");
      setPassword("");
      setParentCode("");
      setStudentCodes("");
      setSingleClass("");
      setTeacherClasses([]);
      setTeacherSubjects([]);
    } catch {
      setManualError("فشل إضافة الحساب.");
    } finally {
      setManualLoading(false);
    }
  }

  async function submitExcel(e: React.FormEvent) {
    e.preventDefault();
    setImportError(null);
    setImportResult(null);
    if (!excelFile) {
      setImportError("اختر ملف Excel أولاً.");
      return;
    }
    if (!me?.studentCode || !me?.role) {
      setImportError("جلسة المستخدم غير متاحة.");
      return;
    }

    const form = new FormData();
    form.append("file", excelFile);
    form.append("actorCode", me.studentCode);
    form.append("actorRole", me.role);

    setImportLoading(true);
    try {
      const res = await fetch("/api/users/import", {
        method: "POST",
        body: form,
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setImportError(json?.message || "فشل استيراد الملف.");
        return;
      }
      setImportResult(json.data);
      setExcelFile(null);
      const input = document.getElementById("excel-input") as HTMLInputElement | null;
      if (input) input.value = "";
    } catch {
      setImportError("فشل استيراد الملف.");
    } finally {
      setImportLoading(false);
    }
  }

  async function submitPromoteManual(e: React.FormEvent) {
    e.preventDefault();
    setPromoteError(null);
    setPromoteResult(null);

    if (!promoteCode.trim() || !promoteOldClass.trim() || !promoteNewClass.trim()) {
      setPromoteError("كود المستخدم والفصل الحالي والفصل الجديد مطلوبين.");
      return;
    }
    if (!me?.studentCode || !me?.role) {
      setPromoteError("جلسة المستخدم غير متاحة.");
      return;
    }

    setPromoteLoading(true);
    try {
      const res = await fetch("/api/users/promote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          actorCode: me.studentCode,
          actorRole: me.role,
          code: promoteCode.trim(),
          oldClass: promoteOldClass.trim(),
          newClass: promoteNewClass.trim(),
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
      setPromoteError(json?.message || "فشل نقل الحساب.");
      return;
    }
      const destination = Array.isArray(json.data.newClasses)
        ? json.data.newClasses.join(", ")
        : promoteNewClass.trim();
      const parentPart =
        Number(json.data.updatedParents ?? 0) > 0
          ? ` وتم نقل ${json.data.updatedParents} من أولياء الأمور المرتبطين.`
          : "";
      setPromoteResult(`تم نقل الحساب ${json.data.code} إلى ${destination}${parentPart}`);
      setPromoteCode("");
      setPromoteOldClass("");
      setPromoteNewClass("");
    } catch {
      setPromoteError("فشل نقل الحساب.");
    } finally {
      setPromoteLoading(false);
    }
  }

  async function submitPromoteExcel(e: React.FormEvent) {
    e.preventDefault();
    setPromoteImportError(null);
    setPromoteImportResult(null);
    if (!promoteExcelFile) {
      setPromoteImportError("اختر ملف Excel أولاً.");
      return;
    }
    if (!me?.studentCode || !me?.role) {
      setPromoteImportError("جلسة المستخدم غير متاحة.");
      return;
    }

    const form = new FormData();
    form.append("file", promoteExcelFile);
    form.append("actorCode", me.studentCode);
    form.append("actorRole", me.role);

    setPromoteImportLoading(true);
    try {
      const res = await fetch("/api/users/promote/import", {
        method: "POST",
        body: form,
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
      setPromoteImportError(json?.message || "فشل استيراد النقل.");
      return;
      }
      setPromoteImportResult(json.data);
      setPromoteExcelFile(null);
      const input = document.getElementById("promote-excel-input") as HTMLInputElement | null;
      if (input) input.value = "";
    } catch {
      setPromoteImportError("فشل استيراد النقل.");
    } finally {
      setPromoteImportLoading(false);
    }
  }

  async function submitClassCreate(e: React.FormEvent) {
    e.preventDefault();
    setClassCreateError(null);
    setClassCreateSuccess(null);

    const code = newClassCode.trim().toUpperCase();
    const name = newClassName.trim();
    if (!code || !name) {
      setClassCreateError("اكتب رمز الفصل واسم الفصل.");
      return;
    }

    setClassCreateLoading(true);
    try {
      const res = await fetch("/api/classes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: code, name }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setClassCreateError(json?.message || "فشل إضافة الفصل.");
        return;
      }

      setClasses((prev) => {
        if (prev.some((item) => item.id === code)) return prev;
        const next = [...prev, { id: code, name }];
        return next.sort((a, b) => String(a.name).localeCompare(String(b.name), "ar"));
      });
      setClassCreateSuccess(`تم إضافة الفصل ${code}.`);
      setNewClassCode("");
      setNewClassName("");
    } catch {
      setClassCreateError("فشل إضافة الفصل.");
    } finally {
      setClassCreateLoading(false);
    }
  }

  async function submitTeacherClass(e: React.FormEvent) {
    e.preventDefault();
    setTeacherClassError(null);
    setTeacherClassSuccess(null);

    if (!selectedTeacherCode || !teacherClassToAdd) {
      setTeacherClassError("اختر المدرس والفصل.");
      return;
    }
    if (!me?.studentCode || !me?.role) {
      setTeacherClassError("جلسة المستخدم غير متاحة.");
      return;
    }

    setTeacherClassLoading(true);
    try {
      const res = await fetch("/api/users/classes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          actorCode: me.studentCode,
          actorRole: me.role,
          teacherCode: selectedTeacherCode,
          classId: teacherClassToAdd,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setTeacherClassError(json?.message || "فشل إضافة الفصل للمدرس.");
        return;
      }

      setTeacherClassSuccess("تم إضافة الفصل للمدرس.");
      setTeachers((prev) =>
        prev.map((item) =>
          item.code === selectedTeacherCode
            ? {
                ...item,
                classes: item.classes.includes(teacherClassToAdd)
                  ? item.classes
                  : [...item.classes, teacherClassToAdd],
              }
            : item
        )
      );
    } catch {
      setTeacherClassError("فشل إضافة الفصل للمدرس.");
    } finally {
      setTeacherClassLoading(false);
    }
  }

  return (
    <main className="min-h-screen px-6 pb-24 pt-10">
      <div className="mx-auto w-full max-w-5xl">
        <header className="mb-8 flex items-center justify-between">
          <h1 className="app-heading mt-2">الإدارة</h1>
          <div className="flex items-center gap-2">
            <BackButton
              className="back-btn rounded-full border border-black/10 bg-white px-4 py-2 text-sm font-semibold text-[color:var(--ink)] shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
              fallbackHref={"/portal/admin"}
            />
          </div>
        </header>

        {!isAdmin ? (
          <div className="rounded-3xl border border-white/20 bg-white/15 p-6 text-white shadow-[var(--shadow)] backdrop-blur-md">
            هذه الصفحة متاحة للأدمن فقط.
          </div>
        ) : (
          <div className="grid gap-6">
            <section className="rounded-3xl border border-white/20 bg-white/15 p-6 text-white shadow-[var(--shadow)] backdrop-blur-md">
              <p className="text-xl font-semibold">إضافة حساب </p>
              <form onSubmit={submitManual} className="mt-4 grid gap-3">
                <input
                  className="rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-sm text-white"
                  placeholder="الاسم"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
                <input
                  className="rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-sm text-white"
                  placeholder="كود المستخدم"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                />
                <select
                  className="rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-sm text-white"
                  value={role}
                  onChange={(e) => {
                    setRole(e.target.value);
                    setParentCode("");
                    setStudentCodes("");
                    setSingleClass("");
                    setTeacherClasses([]);
                    setTeacherSubjects([]);
                  }}
                >
                  {roleOptions.map((item) => (
                    <option key={item.value} value={item.value} className="text-black">
                      {item.label}
                    </option>
                  ))}
                </select>
                <input
                  className="rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-sm text-white"
                  placeholder="الباسورد المبدئي"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                {role === "student" ? (
                  <input
                    className="rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-sm text-white"
                    placeholder="كود ولي الأمر"
                    value={parentCode}
                    onChange={(e) => setParentCode(e.target.value)}
                  />
                ) : null}
                {role === "parent" ? (
                  <input
                    className="rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-sm text-white"
                    placeholder="Student Codes (مثال: 121212,212121)"
                    value={studentCodes}
                    onChange={(e) => setStudentCodes(e.target.value)}
                  />
                ) : null}

                {role === "admin" || role === "parent" || role === "notes" || role === "katamars" ? (
                  <p className="text-sm text-white/80">
                    {role === "admin"
                      ? "الأدمن بدون فصل."
                      : role === "notes"
                        ? "حساب الملاحظات بدون فصل."
                        : role === "katamars"
                          ? "حساب القطمارس بدون فصل."
                        : "ولي الأمر بدون فصل."}
                  </p>
                ) : role === "teacher" ? (
                  <div className="grid gap-3">
                    <div className="rounded-2xl border border-white/20 bg-white/10 p-4">
                      <p className="mb-2 text-sm text-white/90">الفصول (اختيار متعدد)</p>
                      {loadingClasses ? (
                        <p className="text-sm text-white/70">جار التحميل...</p>
                      ) : (
                        <div className="grid gap-2 sm:grid-cols-2">
                          {classes.map((cls) => (
                            <label key={cls.id} className="flex items-center gap-2 text-sm">
                              <input
                                type="checkbox"
                                checked={teacherClasses.includes(cls.id)}
                                onChange={(e) => {
                                  setTeacherClasses((prev) =>
                                    e.target.checked
                                      ? Array.from(new Set([...prev, cls.id]))
                                      : prev.filter((v) => v !== cls.id)
                                  );
                                }}
                              />
                              <span>{cls.name}</span>
                            </label>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="rounded-2xl border border-white/20 bg-white/10 p-4">
                      <p className="mb-2 text-sm text-white/90">المواد (اختيار متعدد)</p>
                      <div className="grid gap-2 sm:grid-cols-2">
                        {SUBJECT_OPTIONS.map((subject) => (
                          <label key={subject} className="flex items-center gap-2 text-sm">
                            <input
                              type="checkbox"
                              checked={teacherSubjects.includes(subject)}
                              onChange={(e) => {
                                setTeacherSubjects((prev) =>
                                  e.target.checked
                                    ? Array.from(new Set([...prev, subject]))
                                    : prev.filter((v) => v !== subject)
                                );
                              }}
                            />
                            <span>{subject}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : (
                  <select
                    className="rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-sm text-white"
                    value={singleClass}
                    onChange={(e) => setSingleClass(e.target.value)}
                  >
                    <option value="" className="text-black">
                      اختر الفصل
                    </option>
                    {classes.map((cls) => (
                      <option key={cls.id} value={cls.id} className="text-black">
                        {cls.name}
                      </option>
                    ))}
                  </select>
                )}

                {manualError ? <p className="text-sm text-red-200">{manualError}</p> : null}
                {createdCode ? (
                  <p className="text-sm text-green-200">تم إنشاء الحساب. الكود: {createdCode}</p>
                ) : null}

                <button
                  type="submit"
                  disabled={manualLoading}
                  className="w-fit rounded-full bg-white px-5 py-2 text-sm font-semibold text-black disabled:opacity-60"
                >
                  {manualLoading ? "جار الإضافة..." : "إضافة حساب"}
                </button>
              </form>
            </section>

            <section className="rounded-3xl border border-white/20 bg-white/15 p-6 text-white shadow-[var(--shadow)] backdrop-blur-md">
              <p className="text-xl font-semibold">استيراد حسابات من Excel</p>
              <p className="mt-2 text-sm text-white/80">
                الأعمدة المدعومة: Code, Name, Role, Startup Password, Classes, Subject, Parent Codes, Student Codes
              </p>
              <a
                href="/api/templates/users-import"
                className="mt-3 inline-flex w-fit rounded-full border border-white/25 bg-white/10 px-4 py-2 text-xs font-semibold text-white"
              >
                تنزيل فورم الاستيراد الجاهز
              </a>
              <form onSubmit={submitExcel} className="mt-4 grid gap-3">
                <input
                  id="excel-input"
                  type="file"
                  accept=".xlsx,.xls"
                  className="rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-sm text-white"
                  onChange={(e) => setExcelFile(e.target.files?.[0] ?? null)}
                />
                {importError ? <p className="text-sm text-red-200">{importError}</p> : null}
                {importResult ? (
                  <div className="rounded-2xl border border-white/20 bg-white/10 p-3 text-sm">
                    <p>تم الاستيراد: {importResult.imported}</p>
                    <p>تم التخطي: {importResult.skipped}</p>
                    {importResult.skipDetails.length ? (
                      <div className="mt-2">
                        {importResult.skipDetails.map((line) => (
                          <p key={line} className="text-xs text-white/85">
                            - {line}
                          </p>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : null}
                <button
                  type="submit"
                  disabled={importLoading}
                  className="w-fit rounded-full bg-white px-5 py-2 text-sm font-semibold text-black disabled:opacity-60"
                >
                  {importLoading ? "جار الاستيراد..." : "استيراد الملف"}
                </button>
              </form>
            </section>

            <section className="rounded-3xl border border-white/20 bg-white/15 p-6 text-white shadow-[var(--shadow)] backdrop-blur-md">
              <p className="text-xl font-semibold">نقل الحسابات</p>
              <form onSubmit={submitPromoteManual} className="mt-4 grid gap-3">
                <input
                  className="rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-sm text-white"
                  placeholder="كود المستخدم"
                  value={promoteCode}
                  onChange={(e) => setPromoteCode(e.target.value)}
                />
                <select
                  className="rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-sm text-white"
                  value={promoteOldClass}
                  onChange={(e) => setPromoteOldClass(e.target.value)}
                >
                  <option value="" className="text-black">
                    اختر الفصل الحالي
                  </option>
                  {classes.map((cls) => (
                    <option key={`old-${cls.id}`} value={cls.id} className="text-black">
                      {cls.name}
                    </option>
                  ))}
                </select>
                <select
                  className="rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-sm text-white"
                  value={promoteNewClass}
                  onChange={(e) => setPromoteNewClass(e.target.value)}
                >
                  <option value="" className="text-black">
                    اختر الفصل الجديد
                  </option>
                  {classes.map((cls) => (
                    <option key={`new-${cls.id}`} value={cls.id} className="text-black">
                      {cls.name}
                    </option>
                  ))}
                </select>
                {promoteError ? <p className="text-sm text-red-200">{promoteError}</p> : null}
                {promoteResult ? <p className="text-sm text-green-200">{promoteResult}</p> : null}
                <button
                  type="submit"
                  disabled={promoteLoading}
                  className="w-fit rounded-full bg-white px-5 py-2 text-sm font-semibold text-black disabled:opacity-60"
                >
                  {promoteLoading ? "جار النقل..." : "نقل الحساب"}
                </button>
              </form>
            </section>

            <section className="rounded-3xl border border-white/20 bg-white/15 p-6 text-white shadow-[var(--shadow)] backdrop-blur-md">
              <p className="text-xl font-semibold">نقل الحسابات من Excel</p>
              <p className="mt-2 text-sm text-white/80">
                الأعمدة المطلوبة: Code, Name, Old Class, New Class
              </p>
              <a
                href="/api/templates/users-promote-import"
                className="mt-3 inline-flex w-fit rounded-full border border-white/25 bg-white/10 px-4 py-2 text-xs font-semibold text-white"
              >
                تنزيل فورم النقل الجاهز
              </a>
              <form onSubmit={submitPromoteExcel} className="mt-4 grid gap-3">
                <input
                  id="promote-excel-input"
                  type="file"
                  accept=".xlsx,.xls"
                  className="rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-sm text-white"
                  onChange={(e) => setPromoteExcelFile(e.target.files?.[0] ?? null)}
                />
                {promoteImportError ? (
                  <p className="text-sm text-red-200">{promoteImportError}</p>
                ) : null}
                {promoteImportResult ? (
                  <div className="rounded-2xl border border-white/20 bg-white/10 p-3 text-sm">
                    <p>تم النقل: {promoteImportResult.updated}</p>
                    <p>أولياء أمور تم نقلهم: {promoteImportResult.updatedParents ?? 0}</p>
                    <p>تم التخطي: {promoteImportResult.skipped}</p>
                    {promoteImportResult.skipDetails.length ? (
                      <div className="mt-2">
                        {promoteImportResult.skipDetails.map((line) => (
                          <p key={line} className="text-xs text-white/85">
                            - {line}
                          </p>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : null}
                <button
                  type="submit"
                  disabled={promoteImportLoading}
                  className="w-fit rounded-full bg-white px-5 py-2 text-sm font-semibold text-black disabled:opacity-60"
                >
                  {promoteImportLoading ? "جار الاستيراد..." : "استيراد النقل"}
                </button>
              </form>
            </section>

            <section className="rounded-3xl border border-white/20 bg-white/15 p-6 text-white shadow-[var(--shadow)] backdrop-blur-md">
              <p className="text-xl font-semibold">إضافة فصل</p>
              <form onSubmit={submitClassCreate} className="mt-4 grid gap-3">
                <input
                  className="rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-sm text-white"
                  placeholder="رمز الفصل (مثال: 6B)"
                  value={newClassCode}
                  onChange={(e) => setNewClassCode(e.target.value)}
                />
                <input
                  className="rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-sm text-white"
                  placeholder="اسم الفصل (مثال: سنة سادسة بنين)"
                  value={newClassName}
                  onChange={(e) => setNewClassName(e.target.value)}
                />
                {classCreateError ? <p className="text-sm text-red-200">{classCreateError}</p> : null}
                {classCreateSuccess ? (
                  <p className="text-sm text-green-200">{classCreateSuccess}</p>
                ) : null}
                <button
                  type="submit"
                  disabled={classCreateLoading}
                  className="w-fit rounded-full bg-white px-5 py-2 text-sm font-semibold text-black disabled:opacity-60"
                >
                  {classCreateLoading ? "جار الإضافة..." : "إضافة الفصل"}
                </button>
              </form>
            </section>

            <section className="rounded-3xl border border-white/20 bg-white/15 p-6 text-white shadow-[var(--shadow)] backdrop-blur-md">
              <p className="text-xl font-semibold">إضافة فصل لمدرس</p>
              <form onSubmit={submitTeacherClass} className="mt-4 grid gap-3">
                <select
                  className="rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-sm text-white"
                  value={selectedTeacherCode}
                  onChange={(e) => setSelectedTeacherCode(e.target.value)}
                >
                  <option value="" className="text-black">
                    اختر المدرس
                  </option>
                  {teachers.map((teacher) => (
                    <option key={teacher.code} value={teacher.code} className="text-black">
                      {teacher.name || teacher.code} ({teacher.code})
                    </option>
                  ))}
                </select>
                <select
                  className="rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-sm text-white"
                  value={teacherClassToAdd}
                  onChange={(e) => setTeacherClassToAdd(e.target.value)}
                >
                  <option value="" className="text-black">
                    اختر الفصل
                  </option>
                  {classes.map((cls) => (
                    <option key={`teacher-class-${cls.id}`} value={cls.id} className="text-black">
                      {cls.name}
                    </option>
                  ))}
                </select>
                {selectedTeacherCode ? (
                  <p className="text-xs text-white/80">
                    الفصول الحالية:{" "}
                    {teachers.find((t) => t.code === selectedTeacherCode)?.classes.join(" - ") || "لا يوجد"}
                  </p>
                ) : null}
                {teacherClassError ? <p className="text-sm text-red-200">{teacherClassError}</p> : null}
                {teacherClassSuccess ? (
                  <p className="text-sm text-green-200">{teacherClassSuccess}</p>
                ) : null}
                <button
                  type="submit"
                  disabled={teacherClassLoading}
                  className="w-fit rounded-full bg-white px-5 py-2 text-sm font-semibold text-black disabled:opacity-60"
                >
                  {teacherClassLoading ? "جار الإضافة..." : "إضافة الفصل للمدرس"}
                </button>
              </form>
            </section>
          </div>
        )}
      </div>
    </main>
  );
}
