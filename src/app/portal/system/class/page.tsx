"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

type StoredUser = {
  role?: string;
  studentCode?: string;
};

type UserPayload = {
  code: string;
  classes: string[];
};

export default function SystemClassEntryPage() {
  const router = useRouter();

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
      if (role !== "system" || !session.studentCode) {
        router.replace(`/portal/${role ?? "student"}`);
        return;
      }

      try {
        const query = new URLSearchParams({ code: session.studentCode });
        const res = await fetch(`/api/users?${query.toString()}`);
        const json = await res.json();
        if (!res.ok || !json.ok) {
          router.replace("/portal/system");
          return;
        }
        const user = json.data as UserPayload;
        const classId = Array.isArray(user.classes) && user.classes.length ? String(user.classes[0]) : "";
        if (!classId) {
          router.replace("/portal/system");
          return;
        }
        router.replace(`/portal/system/class/${classId}`);
      } catch {
        router.replace("/portal/system");
      }
    }
    load();
  }, [router]);

  return (
    <main className="min-h-screen px-6 pb-24 pt-10">
      <p className="text-sm text-white/80">جار التحويل...</p>
    </main>
  );
}

