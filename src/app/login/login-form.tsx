"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { UserRole } from "@/lib/types";

type FormState = {
  studentCode: string;
  password: string;
};

export default function LoginForm() {
  const router = useRouter();
  const [form, setForm] = useState<FormState>({
    studentCode: "",
    password: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function handleChange<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setError(null);

    if (!form.studentCode.trim() || !form.password.trim()) {
      setError("كود المستخدم وكلمة المرور مطلوبان.");
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch("/api/code-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: form.studentCode.trim(),
          password: form.password.trim(),
        }),
      });

      const result = await response.json();
      if (!response.ok || !result.ok) {
        setError(result?.message || "حدث خطأ أثناء تسجيل الدخول.");
        return;
      }

      const payload = {
        studentCode: result.data.studentCode,
        role: result.data.role as UserRole,
        name: result.data.name,
        mustChangePassword: Boolean(result.data.mustChangePassword),
        needsServicePref: Boolean(result.data.needsServicePref),
        classes: [] as string[],
        createdAt: new Date().toISOString(),
      };

      window.localStorage.setItem("dsms:user", JSON.stringify(payload));
      router.replace(`/portal/${result.data.role}`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="grid gap-4" onSubmit={handleSubmit}>
      <label className="grid gap-2 text-right text-sm text-white">
        كود المستخدم
        <input
          className="rounded-2xl border border-white/30 bg-white/15 px-4 py-3 text-right text-white outline-none transition focus:border-white/60 focus:ring-2 focus:ring-white/30"
          type="text"
          value={form.studentCode}
          onChange={(event) => handleChange("studentCode", event.target.value)}
          placeholder="أدخل كود المستخدم"
          required
        />
      </label>
      <label className="grid gap-2 text-right text-sm text-white">
        كلمة المرور
        <input
          className="rounded-2xl border border-white/30 bg-white/15 px-4 py-3 text-right text-white outline-none transition focus:border-white/60 focus:ring-2 focus:ring-white/30"
          type="password"
          value={form.password}
          onChange={(event) => handleChange("password", event.target.value)}
          placeholder="أدخل كلمة المرور"
          required
        />
      </label>

      {error ? (
        <p className="rounded-2xl border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={submitting}
        className="rounded-full bg-[color:var(--accent-2)] px-6 py-3 text-sm font-semibold text-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
      >
        {submitting ? "جار الدخول..." : "تسجيل الدخول"}
      </button>
    </form>
  );
}
