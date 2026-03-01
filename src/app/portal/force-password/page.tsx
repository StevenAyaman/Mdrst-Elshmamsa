"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type StoredUser = {
  studentCode?: string;
  role?: string;
};

export default function ForcePasswordPage() {
  const router = useRouter();
  const [nextPassword, setNextPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const storedUser = useMemo<StoredUser | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      const stored = window.localStorage.getItem("dsms:user");
      return stored ? (JSON.parse(stored) as StoredUser) : null;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    if (!storedUser?.studentCode || !storedUser?.role) {
      router.replace("/login");
    }
  }, [router, storedUser?.role, storedUser?.studentCode]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setError(null);
    setSuccess(null);

    if (!nextPassword || !confirmPassword) {
      setError("اكتب كلمة المرور الجديد وتأكيدها.");
      return;
    }
    if (nextPassword !== confirmPassword) {
      setError("كلمة المرور الجديدة غير متطابقة.");
      return;
    }
    if (!storedUser?.studentCode || !storedUser?.role) {
      setError("تعذر تحميل بيانات الحساب.");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/users/force-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          actorCode: storedUser.studentCode,
          actorRole: storedUser.role,
          nextPassword,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(json.message || "فشل تغيير كلمة المرور.");
        return;
      }
      setSuccess("تم حفظ كلمة المرور الجديدة..");
      const stored = window.localStorage.getItem("dsms:user");
      if (stored) {
        try {
          const parsed = JSON.parse(stored) as Record<string, unknown>;
          parsed.mustChangePassword = false;
          window.localStorage.setItem("dsms:user", JSON.stringify(parsed));
        } catch {
          // ignore
        }
      }
      const effectiveRole = storedUser.role === "nzam" ? "system" : storedUser.role;
      if (effectiveRole === "student") {
        router.replace("/portal/student/service");
        return;
      }
      router.replace(`/portal/${effectiveRole}`);
      router.refresh();
    } catch {
      setError("تعذر الاتصال بالسيرفر.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="min-h-screen px-6">
      <div className="mx-auto flex min-h-screen w-full max-w-xl items-center justify-center text-white">
        <section className="rounded-3xl border border-white/20 bg-white/15 p-8 shadow-[var(--shadow)] backdrop-blur-md">
          <h1 className="greeting-text mb-4 text-center text-2xl font-semibold">
            اهلا وسهلاً بك في مدرسة الشمامسة
          </h1>
          <p className="mb-6 text-center text-sm text-white/80">
            الرجاء اختيار كلمة المرور جديية خاصة لحسابك يمكنك تغييرها لاحقاً.
          </p>

          <form onSubmit={handleSubmit} className="grid gap-3">
            <input
              type="password"
              className="rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-sm text-white"
              placeholder="كلمة المرور الجديدة"
              value={nextPassword}
              onChange={(e) => setNextPassword(e.target.value)}
            />
            <input
              type="password"
              className="rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-sm text-white"
              placeholder="تأكيد كلمة المرور الجديدة"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />

            {error ? <p className="text-sm text-red-200">{error}</p> : null}
            {success ? <p className="text-sm text-green-200">{success}</p> : null}

            <button
              type="submit"
              disabled={saving}
              className="mt-2 rounded-full bg-[color:var(--accent-2)] px-6 py-3 text-sm font-semibold text-white"
            >
              {saving ? "جار الحفظ..." : "حفظ كلمة المرور"}
            </button>
          </form>
        </section>
      </div>
    </main>
  );
}
