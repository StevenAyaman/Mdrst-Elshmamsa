"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { useParams, useRouter } from "next/navigation";

type PersonItem = {
  id: string;
  code: string;
  name: string;
  role: string;
  subjects?: string[];
  parentCodes: string[];
};

export default function TeacherClassDetailsPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const classId = params?.id ?? "";

  const [groups, setGroups] = useState<{
    students: PersonItem[];
    teachers: PersonItem[];
    systems: PersonItem[];
    parents: PersonItem[];
  }>({ students: [], teachers: [], systems: [], parents: [] });
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [showSearchResults, setShowSearchResults] = useState(false);
  const [focusedStudentCode, setFocusedStudentCode] = useState<string | null>(null);
  const studentRefs = useRef<Record<string, HTMLDivElement | null>>({});

  useEffect(() => {
    async function load() {
      const stored = window.localStorage.getItem("dsms:user");
      if (!stored) {
        router.replace("/login");
        return;
      }
      try {
        const user = JSON.parse(stored) as { role?: string };
        const role = user.role === "nzam" ? "system" : user.role;
        if (role !== "teacher") {
          router.replace(`/portal/${role ?? "student"}`);
          return;
        }
      } catch {
        router.replace("/login");
        return;
      }

      try {
        const res = await fetch(`/api/classes/${classId}`);
        const json = await res.json();
        if (res.ok && json.ok) {
          setGroups(json.data.groups);
        }
      } finally {
        setLoading(false);
      }
    }
    if (classId) load();
  }, [classId, router]);

  useEffect(() => {
    if (classId) {
      window.localStorage.setItem("dsms:classId", classId);
    }
  }, [classId]);

  const filteredStudents = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) return [];
    return groups.students
      .filter((student) => {
        const byName = student.name.toLowerCase().includes(term);
        const byCode = student.code.toLowerCase().includes(term);
        const byParent = student.parentCodes.some((parentCode) =>
          parentCode.toLowerCase().includes(term)
        );
        return byName || byCode || byParent;
      })
      .slice(0, 12);
  }, [groups.students, searchTerm]);

  function jumpToStudent(code: string) {
    setShowSearchResults(false);
    const target = studentRefs.current[code];
    if (!target) return;
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    setFocusedStudentCode(code);
    window.setTimeout(() => setFocusedStudentCode((prev) => (prev === code ? null : prev)), 1800);
  }

  return (
    <main className="min-h-screen px-6 pb-24 pt-10">
      <div className="mx-auto w-full max-w-5xl">
        <header className="mb-6 grid gap-3">
          <h1 className="app-heading mt-2 text-center">الفصل {classId}</h1>
          <div className="flex justify-end">
            <Link
              href="/portal/teacher"
              className="back-btn ml-0 rounded-full border border-black/10 bg-white px-4 py-2 text-sm font-semibold text-[color:var(--ink)] shadow-sm"
            >
              رجوع
            </Link>
          </div>
        </header>

        <div className="relative z-40 mb-6 rounded-3xl border border-white/20 bg-white/15 p-4 text-white shadow-[var(--shadow)] backdrop-blur-md">
          <input
            value={searchTerm}
            onChange={(e) => {
              setSearchTerm(e.target.value);
              setShowSearchResults(true);
            }}
            onFocus={() => setShowSearchResults(true)}
            placeholder="ابحث عن طالب بالاسم أو الكود أو كود ولي الأمر"
            className="w-full rounded-2xl border border-white/25 bg-white/10 px-4 py-3 text-sm text-white placeholder:text-white/70 outline-none focus:border-white/60"
          />
          {showSearchResults && searchTerm.trim() ? (
            <div className="absolute left-4 right-4 top-[calc(100%-6px)] z-50 max-h-80 overflow-auto rounded-2xl border border-white/20 bg-[#1a1a1a]/95 p-2 shadow-2xl">
              {filteredStudents.length ? (
                filteredStudents.map((student) => (
                  <button
                    key={student.code}
                    type="button"
                    onClick={() => jumpToStudent(student.code)}
                    className="block w-full rounded-xl px-3 py-2 text-right text-sm text-white transition hover:bg-white/10"
                  >
                    <p className="font-semibold">{student.name}</p>
                    <p className="text-xs text-white/80">
                      الكود: {student.code}
                      {student.parentCodes.length ? ` - ولي الأمر: ${student.parentCodes.join(", ")}` : ""}
                    </p>
                  </button>
                ))
              ) : (
                <p className="px-3 py-2 text-sm text-white/80">لا توجد نتائج.</p>
              )}
            </div>
          ) : null}
        </div>

        {loading ? (
          <p className="text-sm text-white/80">جار التحميل...</p>
        ) : (
          <div className="grid gap-6">
            <Section title="المدرسين" items={groups.teachers} />
            <Section title="خدام النظام" items={groups.systems} />
            <Section title="أولياء الأمور" items={groups.parents} />
            <Section
              title="الطلاب"
              items={groups.students}
              showParentCodes
              studentRefs={studentRefs}
              focusedCode={focusedStudentCode}
              studentDetailsHrefPrefix="/portal/admin/students"
            />
          </div>
        )}
      </div>
    </main>
  );
}

function Section({
  title,
  items,
  showParentCodes,
  studentRefs,
  focusedCode,
  studentDetailsHrefPrefix,
}: {
  title: string;
  items: PersonItem[];
  showParentCodes?: boolean;
  studentRefs?: MutableRefObject<Record<string, HTMLDivElement | null>>;
  focusedCode?: string | null;
  studentDetailsHrefPrefix?: string;
}) {
  function renderDisplayName(person: PersonItem) {
    const subjects = Array.isArray(person.subjects) ? person.subjects : [];
    if (person.role === "teacher" && subjects.length) {
      return `${person.name} (${subjects.join(" - ")})`;
    }
    return person.name;
  }

  return (
    <section className="rounded-3xl border border-white/20 bg-white/15 p-6 text-white shadow-[var(--shadow)] backdrop-blur-md">
      <div className="flex items-center gap-2">
        <span className="min-w-[44px] rounded-full border border-white/60 bg-white px-3 py-1 text-center text-sm font-semibold text-[#111] shadow-sm">
          {items.length}
        </span>
        <p className="text-lg font-semibold">{title}</p>
      </div>
      {items.length === 0 ? (
        <p className="mt-3 text-sm text-white/75">لا توجد بيانات.</p>
      ) : (
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((person) => {
            const card = (
              <div
                ref={(el) => {
                  if (studentRefs) studentRefs.current[person.code] = el;
                }}
              className={`rounded-2xl border p-3 transition ${
                focusedCode === person.code
                  ? "border-yellow-300 bg-yellow-300/20"
                  : "border-white/20 bg-white/10"
              }`}
            >
                <p className="font-semibold">{renderDisplayName(person)}</p>
                <p className="text-xs text-white/80">كود: {person.code}</p>
                {showParentCodes ? (
                  <p className="text-xs text-white/80">
                    كود ولي الأمر: {person.parentCodes.length ? person.parentCodes.join(", ") : "-"}
                  </p>
                ) : null}
              </div>
            );

            if (studentDetailsHrefPrefix && person.role === "student") {
              return (
                <Link key={person.id} href={`${studentDetailsHrefPrefix}/${person.code}`}>
                  {card}
                </Link>
              );
            }
            return <div key={person.id}>{card}</div>;
          })}
        </div>
      )}
    </section>
  );
}
