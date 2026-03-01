"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type StoredUser = {
  role?: string;
  studentCode?: string;
};

type UserPayload = {
  code: string;
  classes: string[];
};

export default function TeacherClassesEntryPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [classes, setClasses] = useState<string[]>([]);

  const classCards = useMemo(
    () =>
      classes.map((id) => ({
        id,
        label: `فصل ${id}`,
      })),
    [classes]
  );

  useEffect(() => {
    async function load() {
      const stored = window.localStorage.getItem("dsms:user");
      if (!stored) {
        router.replace("/login");
        return;
      }

      let session: StoredUser;
      try {
        session = JSON.parse(stored) as StoredUser;
      } catch {
        router.replace("/login");
        return;
      }

      const role = session.role === "nzam" ? "system" : session.role;
      if (role !== "teacher" || !session.studentCode) {
        router.replace(`/portal/${role ?? "student"}`);
        return;
      }

      try {
        const query = new URLSearchParams({ code: session.studentCode });
        const res = await fetch(`/api/users?${query.toString()}`);
        const json = await res.json();
        if (!res.ok || !json.ok) {
          setClasses([]);
          return;
        }
        const user = json.data as UserPayload;
        const assignedClasses =
          Array.isArray(user.classes) && user.classes.length
            ? user.classes.map((item) => String(item).trim()).filter(Boolean)
            : [];
        setClasses(assignedClasses);
      } catch {
        setClasses([]);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [router]);

  return (
    <main className="min-h-screen px-6 pb-24 pt-10">
      <section className="mx-auto w-full max-w-5xl">
        <header className="mb-6 flex items-center justify-between">
          <h1 className="app-heading mt-2">الفصول</h1>
          <Link
            href="/portal/teacher"
            className="back-btn rounded-full border border-black/10 bg-white px-4 py-2 text-sm font-semibold text-[color:var(--ink)] shadow-sm"
          >
            رجوع
          </Link>
        </header>

        {loading ? <p className="text-sm text-white/80">جار التحميل...</p> : null}

        {!loading && classCards.length === 0 ? (
          <div className="rounded-3xl border border-white/20 bg-white/15 p-6 text-white shadow-[var(--shadow)] backdrop-blur-md">
            لا توجد فصول مسجلة لهذا الحساب.
          </div>
        ) : null}

        {!loading && classCards.length > 0 ? (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {classCards.map((item) => (
              <Link
                key={item.id}
                href={`/portal/teacher/classes/${encodeURIComponent(item.id)}`}
                className="flex min-h-28 items-center justify-center rounded-3xl border border-white/20 bg-white/15 px-5 py-8 text-center text-white shadow-[var(--shadow)] backdrop-blur-md transition hover:-translate-y-0.5 hover:shadow-lg"
              >
                <span className="text-xl font-semibold">{item.label}</span>
              </Link>
            ))}
          </div>
        ) : null}
      </section>
    </main>
  );
}
