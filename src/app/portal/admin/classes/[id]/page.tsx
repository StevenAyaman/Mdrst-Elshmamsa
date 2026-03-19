"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import BackButton from "@/app/back-button";
import { useParams, useRouter } from "next/navigation";

type PersonItem = {
  id: string;
  code: string;
  name: string;
  role: string;
  subjects?: string[];
  parentCodes: string[];
};

export default function ClassDetailsPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const classId = params?.id ?? "";
  const classNames: Record<string, string> = {
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
  const [groups, setGroups] = useState<{
    students: PersonItem[];
    teachers: PersonItem[];
    systems: PersonItem[];
    parents: PersonItem[];
  }>({ students: [], teachers: [], systems: [], parents: [] });
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");

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
        if (!classId) return;
        const res = await fetch(`/api/classes/${classId}`);
        const json = await res.json();
        if (res.ok && json.ok) {
          setGroups(json.data.groups as typeof groups);
        }
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [classId, router]);

  useEffect(() => {
    if (classId) {
      window.localStorage.setItem("dsms:classId", classId);
    }
  }, [classId]);

  const filteredGroups = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return groups;

    const filterList = (items: PersonItem[]) =>
      items.filter((person) => {
        const byName = person.name.toLowerCase().includes(q);
        const byCode = person.code.toLowerCase().includes(q);
        const byParentCode = person.parentCodes.some((parentCode) =>
          parentCode.toLowerCase().includes(q)
        );
        return byName || byCode || byParentCode;
      });

    return {
      teachers: filterList(groups.teachers),
      systems: filterList(groups.systems),
      parents: filterList(groups.parents),
      students: filterList(groups.students),
    };
  }, [groups, searchTerm]);

  return (
    <main className="min-h-screen px-6 pb-24 pt-10">
      <div className="mx-auto w-full max-w-5xl">
        <header className="mb-6 grid gap-3">
          <div className="flex items-center justify-center gap-3">
            <h1 className="app-heading">{classId}</h1>
            <h1 className="app-heading">{classNames[classId] ?? ""}</h1>
          </div>
          <div className="flex justify-end">
            <BackButton
              className="back-btn ml-0 rounded-full border border-black/10 bg-white px-4 py-2 text-sm font-semibold text-[color:var(--ink)] shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
              fallbackHref={"/portal/admin/classes"}
            />
          </div>
        </header>

        {loading ? (
          <p className="text-sm text-[color:var(--muted)]">جار التحميل...</p>
        ) : (
          <div className="grid gap-6">
            <div className="rounded-3xl border border-white/20 bg-white/15 p-4 text-white shadow-[var(--shadow)] backdrop-blur-md">
              <input
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="ابحث بالاسم أو الكود أو كود ولي الأمر"
                className="w-full rounded-2xl border border-white/25 bg-white/10 px-4 py-3 text-sm text-white placeholder:text-white/70 outline-none focus:border-white/60"
              />
            </div>

            <Section title="المدرسين" items={filteredGroups.teachers} />
            <Section title="خدام النظام" items={filteredGroups.systems} />
            <Section title="أولياء الأمور" items={filteredGroups.parents} />
            <Section title="الطلاب" items={filteredGroups.students} showParents studentLink />
          </div>
        )}
      </div>
    </main>
  );
}

function Section({
  title,
  items,
  showParents,
  studentLink,
}: {
  title: string;
  items: PersonItem[];
  showParents?: boolean;
  studentLink?: boolean;
}) {
  function renderDisplayName(person: PersonItem) {
    const subjects = Array.isArray(person.subjects) ? person.subjects : [];
    if (person.role === "teacher" && subjects.length) {
      return `${person.name} (${subjects.join(" - ")})`;
    }
    return person.name;
  }

  if (!items.length) {
    return (
      <div className="rounded-3xl border border-white/20 bg-white/10 p-5 text-white/70">
        <div className="mb-3 flex items-center justify-between text-white">
          <div className="flex items-center gap-2">
            <span className="min-w-[44px] rounded-full border border-white/60 bg-white px-3 py-1 text-center text-sm font-semibold text-[#111] shadow-sm">
              {items.length}
            </span>
            <p className="text-lg font-semibold">{title}</p>
          </div>
        </div>
        لا توجد بيانات لــ {title}.
      </div>
    );
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between text-white">
        <div className="flex items-center gap-2">
          <span className="min-w-[44px] rounded-full border border-white/60 bg-white px-3 py-1 text-center text-sm font-semibold text-[#111] shadow-sm">
            {items.length}
          </span>
          <p className="text-lg font-semibold">{title}</p>
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((person) =>
          studentLink ? (
            <Link
              key={person.id}
              href={`/portal/admin/students/${person.code}`}
              className="rounded-3xl border border-white/20 bg-white/15 p-5 text-white shadow-[var(--shadow)] backdrop-blur-md transition hover:-translate-y-0.5 hover:shadow-lg"
            >
              <p className="text-lg font-semibold">{renderDisplayName(person)}</p>
              <p className="mt-1 text-xs text-white/80">كود: {person.code}</p>
              {showParents ? (
                person.parentCodes.length ? (
                  <p className="mt-2 text-xs text-white/80">
                    أولياء الأمور: {person.parentCodes.join(", ")}
                  </p>
                ) : (
                  <p className="mt-2 text-xs text-white/60">
                    لا يوجد أولياء أمور
                  </p>
                )
              ) : null}
            </Link>
          ) : (
            <div
              key={person.id}
              className="rounded-3xl border border-white/20 bg-white/15 p-5 text-white shadow-[var(--shadow)] backdrop-blur-md"
            >
              <p className="text-lg font-semibold">{renderDisplayName(person)}</p>
              <p className="mt-1 text-xs text-white/80">كود: {person.code}</p>
              {showParents ? (
                person.parentCodes.length ? (
                  <p className="mt-2 text-xs text-white/80">
                    أولياء الأمور: {person.parentCodes.join(", ")}
                  </p>
                ) : (
                  <p className="mt-2 text-xs text-white/60">
                    لا يوجد أولياء أمور
                  </p>
                )
              ) : null}
            </div>
          )
        )}
      </div>
    </div>
  );
}

