"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import BackButton from "@/app/back-button";
import { useRouter } from "next/navigation";

type ClassItem = {
  id: string;
  name: string;
};

type StudentItem = {
  code: string;
  name: string;
  classes: string[];
  parentCodes: string[];
};

export default function ClassesPage() {
  const router = useRouter();
  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [students, setStudents] = useState<StudentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showResults, setShowResults] = useState(false);
  const labels: Record<string, string> = {
    "1B": "سنة أولى بنين",
    "2B": "سنة ثانية بنين",
    "3B": "سنة ثالثة بنين",
    "4B": "سنة رابعة بنين",
    "5B": "سنة خامسة بنين",
    "1G": "سنة أولى بنات",
    "2G": "سنة ثانية بنات",
    "3G": "سنة ثالثة بنات",
    "4G": "سنة رابعة بنات",
    "5G": "سنة خامسة بنات",
  };

  useEffect(() => {
    const stored = window.localStorage.getItem("dsms:user");
    if (!stored) {
      router.replace("/login");
      return;
    }
    try {
      const user = JSON.parse(stored) as { role?: string };
      const role = user.role === "nzam" ? "system" : user.role;
      if (role !== "admin") {
        router.replace(`/portal/${role ?? "student"}`);
        return;
      }
    } catch {
      router.replace("/login");
      return;
    }

    async function load() {
      try {
        const storedUser = window.localStorage.getItem("dsms:user");
        if (!storedUser) return;
        const user = JSON.parse(storedUser) as { role?: string; studentCode?: string };
        const res = await fetch("/api/classes");
        const json = await res.json();
        if (res.ok && json.ok) {
          setClasses(json.data as ClassItem[]);
        }

        if (user.studentCode && user.role) {
          const query = new URLSearchParams({
            role: "student",
            actorCode: String(user.studentCode),
            actorRole: String(user.role),
          });
          const studentsRes = await fetch(`/api/users?${query.toString()}`);
          const studentsJson = await studentsRes.json();
          if (studentsRes.ok && studentsJson.ok) {
            setStudents((studentsJson.data as StudentItem[]) ?? []);
          }
        }
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [router]);

  const filteredStudents = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return students
      .filter((student) => {
        const byName = student.name.toLowerCase().includes(q);
        const byCode = student.code.toLowerCase().includes(q);
        const byParentCode = (student.parentCodes ?? []).some((parentCode) =>
          String(parentCode).toLowerCase().includes(q)
        );
        return byName || byCode || byParentCode;
      })
      .slice(0, 12);
  }, [students, search]);

  return (
    <main className="min-h-screen px-6 pb-24 pt-10">
      <div className="mx-auto w-full max-w-5xl">
        <header className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="app-heading mt-2">قائمة الفصول</h1>
          </div>
          <BackButton
            className="back-btn rounded-full border border-black/10 bg-white px-4 py-2 text-sm font-semibold text-[color:var(--ink)] shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
            fallbackHref={"/portal/admin"}
            />
        </header>

        {loading ? (
          <p className="text-sm text-[color:var(--muted)]">جار التحميل...</p>
        ) : (
          <div className="grid gap-4">
            <div className="relative z-40 rounded-3xl border border-white/20 bg-white/15 p-4 text-white shadow-[var(--shadow)] backdrop-blur-md">
              <input
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setShowResults(true);
                }}
                onFocus={() => setShowResults(true)}
                placeholder="بحث طالب بالاسم أو الكود أو كود ولي الأمر"
                className="w-full rounded-2xl border border-white/25 bg-white/10 px-4 py-3 text-sm text-white placeholder:text-white/70 outline-none focus:border-white/60"
              />
              {showResults && search.trim() ? (
                <div className="absolute left-4 right-4 top-[calc(100%-6px)] z-50 max-h-80 overflow-auto rounded-2xl border border-white/20 bg-[#1a1a1a]/95 p-2 shadow-2xl">
                  {filteredStudents.length ? (
                    filteredStudents.map((student) => {
                      const classCode = student.classes?.[0] ?? "";
                      return (
                        <Link
                          key={student.code}
                          href={`/portal/admin/students/${student.code}`}
                          onClick={() => setShowResults(false)}
                          className="block rounded-xl px-3 py-2 text-sm text-white transition hover:bg-white/10"
                        >
                          <p className="font-semibold">{student.name}</p>
                          <p className="text-xs text-white/80">
                            الكود: {student.code}
                            {classCode ? ` - الفصل: ${classCode}` : ""}
                          </p>
                        </Link>
                      );
                    })
                  ) : (
                    <p className="px-3 py-2 text-sm text-white/80">لا توجد نتائج.</p>
                  )}
                </div>
              ) : null}
            </div>

            <div className="relative z-0 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {classes.map((item) => (
                <Link
                  key={item.id}
                  href={`/portal/admin/classes/${item.id}`}
                  className="rounded-3xl border border-white/20 bg-white/15 p-6 text-white shadow-[var(--shadow)] backdrop-blur-md transition hover:-translate-y-0.5 hover:shadow-lg"
                >
                  <div className="text-center">
                    <p className="text-2xl font-semibold">{item.name}</p>
                    <p className="mt-2 text-sm text-white/85">
                      {labels[item.name] ?? ""}
                    </p>
                  </div>
                </Link>
              ))}
            </div>
            {showResults && search.trim() ? (
              <button
                type="button"
                onClick={() => setShowResults(false)}
                className="w-fit rounded-full border border-white/20 bg-white/10 px-4 py-2 text-xs text-white"
              >
                إغلاق نتائج البحث
              </button>
            ) : null}
          </div>
        )}
      </div>
    </main>
  );
}

