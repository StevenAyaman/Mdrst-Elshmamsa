"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function CompetitionsPage() {
  const router = useRouter();

  useEffect(() => {
    const stored = window.localStorage.getItem("dsms:user");
    if (!stored) {
      router.replace("/login");
    }
  }, [router]);

  return (
    <main className="min-h-screen px-6 pb-24 pt-10">
      <section className="mx-auto w-full max-w-5xl space-y-6">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="app-heading mt-2">مسابقة القطمارس</h1>
            <p className="text-sm text-white/80">
              جميع تفاصيل المسابقة والمواضيع والألبومات متاحة هنا، سجل حضورك وشارك.
            </p>
          </div>
          <Link
            href="/portal/system"
            className="back-btn rounded-full border border-white/20 bg-white px-4 py-1 text-sm font-semibold text-[color:var(--ink)] shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
          >
            رجوع
          </Link>
        </header>

        <div className="grid gap-4 rounded-3xl border border-white/20 bg-white/15 p-6 shadow-[var(--shadow)] backdrop-blur-md">
          <p className="text-base font-semibold text-white">آخر التحديثات</p>
          <ul className="space-y-3 text-sm text-white/70">
            <li>• ميعاد التصفيات النهائية: الخميس الساعة 6 مساءً.</li>
            <li>• حصص مراجعة مفتوحة الأسبوع القادم للفصلين 1B و1G.</li>
            <li>• سجل دخولك واختبر مهاراتك في القراءات والطقس والالحان.</li>
          </ul>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button className="rounded-full border border-[#ffe2c4] px-4 py-2 text-xs font-semibold text-white transition hover:bg-white/10">
              سجل فريقك
            </button>
            <button className="rounded-full border border-white/40 px-4 py-2 text-xs font-semibold text-white transition hover:bg-white/10">
              جدول الفعاليات
            </button>
          </div>
        </div>
      </section>
    </main>
  );
}
