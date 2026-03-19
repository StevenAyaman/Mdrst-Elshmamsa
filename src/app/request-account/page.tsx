"use client";

import Link from "next/link";
import BackButton from "@/app/back-button";
import { useEffect, useState } from "react";

type ClassItem = { id: string; name: string };

const roleOptions = [
  { value: "student", label: "طالب" },
  { value: "parent", label: "ولي أمر" },
  { value: "teacher", label: "مدرس" },
  { value: "system", label: "خادم نظام" },
  { value: "notes", label: "الملاحظات و الشكاوي" },
  { value: "katamars", label: "إدارة القطمارس" },
  { value: "admin", label: "Admin" },
];

export default function RequestAccountPage() {
  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [loadingClasses, setLoadingClasses] = useState(true);

  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("student");
  const [classId, setClassId] = useState("");
  const [password, setPassword] = useState("");
  const [consent, setConsent] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [classesError, setClassesError] = useState<string | null>(null);

  useEffect(() => {
    async function loadClasses() {
      try {
        const res = await fetch("/api/classes");
        const json = await res.json();
        if (res.ok && json.ok) {
          setClasses(json.data as ClassItem[]);
        } else {
          setClassesError("تعذر تحميل الفصول.");
        }
      } catch {
        setClassesError("تعذر تحميل الفصول.");
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

    if (!name.trim() || !code.trim() || !password.trim() || !email.trim()) {
      setError("الاسم والكود والباسورد المبدأي والإيميل مطلوبة.");
      return;
    }
    if (!consent) {
      setError(
        "لازم توافق على الإقرار قبل إرسال الطلب."
      );
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError("صيغة الإيميل غير صحيحة.");
      return;
    }
    if (!["admin", "notes", "katamars"].includes(role) && !classId.trim()) {
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
          email: email.trim().toLowerCase(),
          role,
          classId: ["admin", "notes", "katamars"].includes(role) ? "" : classId.trim(),
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
      setEmail("");
      setPassword("");
      setClassId("");
      setRole("student");
      setConsent(false);
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
          <BackButton
            className="rounded-full border border-white/40 bg-white px-4 py-1 text-sm font-semibold text-black shadow-sm"
            fallbackHref={"/login"}
            />
        </div>

        <form onSubmit={handleSubmit} className="grid gap-3">
          <input
            className="rounded-2xl border border-white/30 bg-white/15 px-4 py-3 text-sm text-white"
            placeholder="الاسم الكامل"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <input
            className="rounded-2xl border border-white/30 bg-white/15 px-4 py-3 text-sm text-white"
            placeholder="كود المستخدم"
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
          <input
            className="rounded-2xl border border-white/30 bg-white/15 px-4 py-3 text-sm text-white"
            placeholder="البريد الإلكتروني"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <select
            className="rounded-2xl border border-white/30 bg-white/15 px-4 py-3 text-sm text-white"
            value={role}
            onChange={(e) => {
              setRole(e.target.value);
              if (["admin", "notes", "katamars"].includes(e.target.value)) {
                setClassId("");
              }
            }}
          >
            {roleOptions.map((item) => (
              <option key={item.value} value={item.value} className="bg-[#0f2545] text-white">
                {item.label}
              </option>
            ))}
          </select>

          {!["admin", "notes", "katamars"].includes(role) ? (
            <select
              className="rounded-2xl border border-white/30 bg-white/15 px-4 py-3 text-sm text-white"
              value={classId}
              onChange={(e) => setClassId(e.target.value)}
              disabled={loadingClasses}
            >
              <option value="" className="bg-[#0f2545] text-white">
                {loadingClasses ? "جار تحميل الفصول..." : "اختر الفصل"}
              </option>
              {classes.map((cls) => (
                <option key={cls.id} value={cls.id} className="bg-[#0f2545] text-white">
                  {cls.name || cls.id}
                </option>
              ))}
            </select>
          ) : null}

          {classesError ? (
            <p className="rounded-2xl border border-yellow-200 bg-yellow-50 px-4 py-2 text-sm text-yellow-800">
              {classesError}
            </p>
          ) : null}

          <input
            className="rounded-2xl border border-white/30 bg-white/15 px-4 py-3 text-sm text-white"
            placeholder="الباسورد المبدأي"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />

          <label className="flex items-start gap-2 rounded-2xl border border-white/20 bg-white/10 px-3 py-2 text-xs text-white/95">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
              className="mt-0.5 h-4 w-4"
            />
            <span>
              أقر أنا مقدم طلب إنشاء الحساب أعلاه، بأن جميع البيانات السابقة صحيحة، وأوافق على التواصل معي عبر البريد الإلكتروني بشأن قبول أو رفض طلب إنشاء الحساب.
            </span>
          </label>

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
