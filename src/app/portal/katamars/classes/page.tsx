"use client";

import Link from "next/link";
import BackButton from "@/app/back-button";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type ClassItem = {
  id: string;
  name: string;
};

export default function KatamarsClassesPage() {
  const router = useRouter();
  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [loading, setLoading] = useState(true);
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
      if (user.role !== "katamars") {
        router.replace(`/portal/${user.role ?? "student"}`);
        return;
      }
    } catch {
      router.replace("/login");
      return;
    }

    async function load() {
      try {
        const res = await fetch("/api/classes");
        const json = await res.json();
        if (res.ok && json.ok) {
          setClasses(json.data as ClassItem[]);
        }
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [router]);

  return (
    <main className="min-h-screen px-6 pb-24 pt-10">
      <div className="mx-auto w-full max-w-5xl">
        <header className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="app-heading mt-2">الفصول</h1>
          </div>
          <BackButton
            className="back-btn rounded-full border border-black/10 bg-white px-4 py-2 text-sm font-semibold text-[color:var(--ink)] shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
            fallbackHref={"/portal/katamars"}
            />
        </header>

        {loading ? (
          <p className="text-sm text-[color:var(--muted)]">جار التحميل...</p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {classes.map((item) => (
              <Link
                key={item.id}
                href={`/portal/katamars/classes/${item.id}`}
                className="rounded-3xl border border-white/20 bg-white/15 p-6 text-white shadow-[var(--shadow)] backdrop-blur-md transition hover:-translate-y-0.5 hover:shadow-lg"
              >
                <div className="text-center">
                  <p className="text-2xl font-semibold">{item.name}</p>
                  <p className="mt-2 text-sm text-white/85">{labels[item.name] ?? ""}</p>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
