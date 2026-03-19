"use client";

import Link from "next/link";
import BackButton from "@/app/back-button";
import { useParams } from "next/navigation";

const gradeLabels: Record<string, string> = {
  "1": "مكتبة سنة أولى",
  "2": "مكتبة سنة ثانية",
  "3": "مكتبة سنة ثالثة",
  "4": "مكتبة سنة رابعة",
  "5": "مكتبة سنة خامسة",
};
const subjects = [
  { key: "alhan", label: "الالحان" },
  { key: "katamars", label: "القطمارس" },
  { key: "coptic", label: "القبطي" },
  { key: "taqs", label: "الطقس" },
  { key: "agbia", label: "الاجبية" },
];

export default function LibraryGradePage() {
  const params = useParams<{ grade: string }>();
  const grade = params?.grade ?? "general";
  const label = gradeLabels[grade] ?? "المكتبة";

  return (
    <main className="min-h-screen px-6 pb-24 pt-10">
      <div className="mx-auto w-full max-w-5xl">
        <header className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="app-heading mt-2">{label}</h1>
          </div>
          <BackButton
            className="back-btn rounded-full border border-black/10 bg-white px-4 py-2 text-sm font-semibold text-[color:var(--ink)] shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
            fallbackHref={"/portal/admin/library"}
            />
        </header>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {subjects.map((item) => (
            <Link
              key={item.key}
              href={`/portal/admin/library/${grade}/${item.key}`}
              className="rounded-3xl border border-white/20 bg-white/15 px-5 py-6 text-center text-white shadow-[var(--shadow)] backdrop-blur-md transition hover:-translate-y-0.5 hover:shadow-lg"
            >
              <p className="text-2xl font-semibold text-white">{item.label}</p>
            </Link>
          ))}
        </div>
      </div>
    </main>
  );
}

