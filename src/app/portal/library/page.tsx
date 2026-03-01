"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

const libraries = [
  { grade: "1", title: "مكتبة سنة أولى" },
  { grade: "2", title: "مكتبة سنة ثانية" },
  { grade: "3", title: "مكتبة سنة ثالثة" },
  { grade: "4", title: "مكتبة سنة رابعة" },
  { grade: "5", title: "مكتبة سنة خامسة" },
];

type StoredUser = { role?: string };

export default function LibraryIndexPage() {
  const [roleHome, setRoleHome] = useState("/portal/student");

  useEffect(() => {
    const stored = window.localStorage.getItem("dsms:user");
    if (!stored) return;
    try {
      const user = JSON.parse(stored) as StoredUser;
      const role = user?.role ? (user.role === "nzam" ? "system" : user.role) : "student";
      setRoleHome(`/portal/${role}`);
    } catch {
      setRoleHome("/portal/student");
    }
  }, []);

  return (
    <main className="min-h-screen px-6 pb-24 pt-10">
      <div className="mx-auto w-full max-w-5xl">
        <header className="mb-8 flex items-center justify-between">
          <h1 className="app-heading mt-2">المكتبة</h1>
          <Link
            href={roleHome}
            className="back-btn rounded-full border border-black/10 bg-white px-4 py-2 text-sm font-semibold text-[color:var(--ink)] shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
          >
            رجوع
          </Link>
        </header>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {libraries.map((item) => (
            <Link
              key={item.grade}
              href={`/portal/library/${item.grade}`}
              className="rounded-3xl border border-white/20 bg-white/15 p-6 text-white shadow-[var(--shadow)] backdrop-blur-md transition hover:-translate-y-0.5 hover:shadow-lg"
            >
              <p className="text-xl font-semibold">{item.title}</p>
            </Link>
          ))}
        </div>
      </div>
    </main>
  );
}

