"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import BackButton from "@/app/back-button";
import { useParams } from "next/navigation";

type NotificationItem = {
  id: string;
  title: string;
  body: string;
  createdAt: string;
  createdBy: { name?: string };
  audience?: {
    type?: "all" | "class";
    classId?: string;
    className?: string;
  };
};

function timeAgo(iso: string) {
  const diff = Math.max(0, Date.now() - new Date(iso).getTime());
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "منذ لحظات";
  if (minutes < 60) return `منذ ${minutes} دقيقة`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `منذ ${hours} ساعة`;
  const days = Math.floor(hours / 24);
  return `منذ ${days} يوم`;
}

export default function NotificationDetails() {
  const params = useParams<{ id: string }>();
  const [item, setItem] = useState<NotificationItem | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const cached = window.localStorage.getItem("dsms:notifications-cache");
        if (cached && params?.id) {
          try {
            const list = JSON.parse(cached) as NotificationItem[];
            const found = list.find((n) => n.id === params.id);
            if (found) setItem(found);
          } catch {
            // ignore
          }
        }
        if (!params?.id) return;
        const res = await fetch(`/api/notifications/${params.id}`);
        const json = await res.json();
        if (res.ok && json.ok) setItem(json.data as NotificationItem);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [params?.id]);

  return (
    <main className="min-h-screen px-6 pb-24 pt-10">
      <div className="mx-auto w-full max-w-3xl">
        <header className="mb-6 flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-[color:var(--accent-2)]">
              التنبيه
            </p>
            <h1 className="app-heading mt-2">تفاصيل التنبيه</h1>
          </div>
          <BackButton
            className="back-btn rounded-full border border-black/10 bg-white px-4 py-2 text-sm font-semibold text-[color:var(--ink)] shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
            fallbackHref={"/portal/notifications"}
            />
        </header>

        {loading ? (
          <p className="text-sm text-[color:var(--muted)]">جار التحميل...</p>
        ) : !item ? (
          <p className="text-sm text-[color:var(--muted)]">التنبيه غير موجود.</p>
        ) : (
          <div className="notif-card rounded-3xl border border-black/10 bg-white/90 p-6 shadow-[var(--shadow)]">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="notif-card-title text-lg font-semibold">
                {item.title}
              </p>
              <span className="notif-card-meta text-xs">
                {timeAgo(item.createdAt)}
              </span>
            </div>
            <p className="notif-card-body mt-3 text-sm whitespace-pre-wrap">
              {item.body}
            </p>
            {item.audience?.type === "class" ? (
              <p className="notif-card-meta mt-4 text-xs">
                إلى: {item.audience.className ?? item.audience.classId}
              </p>
            ) : (
              <p className="notif-card-meta mt-4 text-xs">
                إلى: المدرسة كلها
              </p>
            )}
          </div>
        )}
      </div>
    </main>
  );
}

