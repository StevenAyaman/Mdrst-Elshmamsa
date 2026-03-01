"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type ClassItem = { id: string; name: string };

const roleOptions = [
  { value: "student", label: "طالب" },
  { value: "parent", label: "ولي أمر" },
  { value: "teacher", label: "مدرس" },
  { value: "system", label: "خادم نظام" },
  { value: "admin", label: "Admin" },
];

export default function RequestAccountPage() {
  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [loadingClasses, setLoadingClasses] = useState(true);

  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [role, setRole] = useState("student");
  const [classId, setClassId] = useState("");
  const [password, setPassword] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    async function loadClasses() {
      try {
        const res = await fetch("/api/classes");
        const json = await res.json();
        if (res.ok && json.ok) {
          setClasses(json.data as ClassItem[]);
        }
      } finally {
        setLoadingClasses(false);
      }
    }
    loadClasses();
  }, []);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setError(null);
    setSuccess(null);

    if (!name.trim() || !code.trim() || !password.trim()) {
      setError("الاسم والكود وكلمة المرور مطلوبة.");
      return;
    }
    if (role !== "admin" && !classId.trim()) {
      setError("اختر الفصل.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/account-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          code: code.trim(),
          role,
          classId: role === "admin" ? "" : classId.trim(),
          startupPassword: password.trim(),
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(json?.message || "تعذر إرسال الطلب.");
        return;
      }
      setSuccess("تم إرسال الطلب بنجاح. سيتم مراجعته من الإدارة.");
      setName("");
      setCode("");
      setPassword("");
      setClassId("");
      setRole("student");
    } catch {
      setError("تعذر إرسال الطلب.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-8">
      <div className="w-full max-w-md rounded-3xl border border-white/20 bg-white/12 p-8 text-white shadow-2xl backdrop-blur-md">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-xl font-semibold">طلب إنشاء حساب</h1>
          <Link
            href="/login"
            className="back-btn rounded-full border border-white/30 px-4 py-1 text-sm text-white/90"
          >
            رجوع
          </Link>
        </div>

        <form onSubmit={handleSubmit} className="grid gap-3">
          <input
            className="rounded-2xl border border-white/30 bg-white/15 px-4 py-3 text-sm text-white"
            placeholder="الاسم"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <input
            className="rounded-2xl border border-white/30 bg-white/15 px-4 py-3 text-sm text-white"
            placeholder="كود المستخدم"
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
          <select
            className="rounded-2xl border border-white/30 bg-white/15 px-4 py-3 text-sm text-white"
            value={role}
            onChange={(e) => {
              setRole(e.target.value);
              if (e.target.value === "admin") {
                setClassId("");
              }
            }}
          >
            {roleOptions.map((item) => (
              <option key={item.value} value={item.value} className="text-black">
                {item.label}
              </option>
            ))}
          </select>

          {role !== "admin" ? (
            <select
              className="rounded-2xl border border-white/30 bg-white/15 px-4 py-3 text-sm text-white"
              value={classId}
              onChange={(e) => setClassId(e.target.value)}
              disabled={loadingClasses}
            >
              <option value="" className="text-black">
                {loadingClasses ? "جار تحميل الفصول..." : "اختر الفصل"}
              </option>
              {classes.map((cls) => (
                <option key={cls.id} value={cls.id} className="text-black">
                  {cls.name || cls.id}
                </option>
              ))}
            </select>
          ) : null}

          <input
            className="rounded-2xl border border-white/30 bg-white/15 px-4 py-3 text-sm text-white"
            placeholder="كلمة المرور"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />

          {error ? (
            <p className="rounded-2xl border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
              {error}
            </p>
          ) : null}
          {success ? (
            <p className="rounded-2xl border border-green-200 bg-green-50 px-4 py-2 text-sm text-green-700">
              {success}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={submitting}
            className="mt-2 rounded-full bg-[color:var(--accent-2)] px-6 py-3 text-sm font-semibold text-white"
          >
            {submitting ? "جار إرسال الطلب..." : "إرسال الطلب"}
          </button>
        </form>
      </div>
    </main>
  );
}

