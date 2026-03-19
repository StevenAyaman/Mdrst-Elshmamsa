"use client";

import Link from "next/link";
import BackButton from "@/app/back-button";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import QRCode from "qrcode"

type StudentFile = {
  code: string;
  name: string;
  className: string;
  parentCodes: string[];
  preferredMass: string;
  preferredService: string;
  lastServiceType?: string;
  currentRank?: string;
  ordinationDate?: string;
  ordinationChurch?: string;
  ordainedBy?: string;
  lastServiceDate?: string;
  civilId?: string;
  civilCardPhoto?: string;
  profilePhoto?: string;
  attendance: {
    present: number;
    absent: number;
    absentDays: string[];
  };
  grades: Array<{
    id: string;
    title: string;
    subject: string;
    score: number;
    maxScore: number;
    createdByRole: string;
    createdAt: string;
  }>;
  katamarsGrades?: Array<{
    id: string;
    month: string;
    classId: string;
    score: number;
    updatedAt: string;
  }>;
};

export default function StudentFilePage() {
  const router = useRouter();
  const params = useParams<{ code: string }>();
  const code = params?.code ?? "";
  const [backHref, setBackHref] = useState("/portal/admin/classes");

  const [data, setData] = useState<StudentFile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string>("");
  const [photoSaving, setPhotoSaving] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);

  useEffect(() => {
    const stored = window.localStorage.getItem("dsms:user");
    if (!stored) {
      router.replace("/login");
      return;
    }
    try {
      const user = JSON.parse(stored) as { role?: string };
      const role = user.role === "nzam" ? "system" : user.role;
      if (role !== "admin" && role !== "system" && role !== "teacher" && role !== "katamars") {
        router.replace(`/portal/${role ?? "student"}`);
        return;
      }
      const storedClassId = window.localStorage.getItem("dsms:classId");
      if (role === "system") {
        setBackHref(
          storedClassId
            ? `/portal/system/class/${encodeURIComponent(storedClassId)}`
            : "/portal/system/class"
        );
      } else if (role === "teacher") {
        setBackHref(
          storedClassId
            ? `/portal/teacher/classes/${encodeURIComponent(storedClassId)}`
            : "/portal/teacher/classes"
        );
      } else if (role === "katamars") {
        setBackHref(
          storedClassId
            ? `/portal/katamars/classes/${encodeURIComponent(storedClassId)}`
            : "/portal/katamars/classes"
        );
      } else {
        setBackHref("/portal/admin/classes");
      }
    } catch {
      router.replace("/login");
    }
  }, [router]);

  useEffect(() => {
    async function load() {
      if (!code) return;
      try {
        setLoading(true);
        setError(null);
        const res = await fetch(`/api/students/${code}`);
        const json = await res.json();
        if (!res.ok || !json.ok) {
          setError(json?.message || "تعذر تحميل ملف الطالب.");
          return;
        }
        setData(json.data as StudentFile);
      } catch {
        setError("تعذر تحميل ملف الطالب.");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [code]);

  async function updateStudentPhoto(file: File | null) {
    if (!file || !code) return;
    if (!file.type.startsWith("image/")) {
      setPhotoError("الملف لازم يكون صورة.");
      return;
    }
    setPhotoError(null);
    const reader = new FileReader();
    reader.onload = async () => {
      const result = String(reader.result ?? "");
      if (!result.startsWith("data:image/")) {
        setPhotoError("تعذر قراءة الصورة.");
        return;
      }
      try {
        setPhotoSaving(true);
        const res = await fetch(`/api/students/${code}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ profilePhoto: result }),
        });
        const json = await res.json();
        if (!res.ok || !json.ok) {
          setPhotoError(json?.message || "فشل تحديث الصورة.");
          return;
        }
        setData((prev) => (prev ? { ...prev, profilePhoto: result } : prev));
      } catch {
        setPhotoError("فشل تحديث الصورة.");
      } finally {
        setPhotoSaving(false);
      }
    };
    reader.readAsDataURL(file);
  }

  useEffect(() => {
    async function makeQr() {
      if (!code) return;
      try {
        const url = await QRCode.toDataURL(String(code), { margin: 1, width: 220 });
        setQrDataUrl(url);
      } catch {
        setQrDataUrl("");
      }
    }
    makeQr();
  }, [code]);

  return (
    <main className="min-h-screen px-6 pb-24 pt-10">
      <div className="mx-auto w-full max-w-5xl">
        <header className="mb-8 flex items-center justify-between">
          <h1 className="app-heading mt-2">ملف الطالب</h1>
          <BackButton
            className="back-btn rounded-full border border-black/10 bg-white px-4 py-2 text-sm font-semibold text-[color:var(--ink)] shadow-sm"
            fallbackHref={backHref}
            />
        </header>

        {loading ? <p className="text-sm text-white/80">جار التحميل...</p> : null}
        {error ? <p className="text-sm text-red-200">{error}</p> : null}

        {!loading && !error && data ? (
          <div className="grid gap-6">
            <section className="rounded-3xl border border-white/20 bg-white/15 p-6 text-white shadow-[var(--shadow)] backdrop-blur-md">
              <div className="flex flex-row items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <p className="text-2xl font-semibold">{data.name}</p>
                  <div className="mt-3 grid gap-2 text-lg text-white/95">
                    <p>الكود: {data.code}</p>
                    <p>الفصل: {data.className || "-"}</p>
                    <p>كود ولي الأمر: {data.parentCodes.length ? data.parentCodes.join(", ") : "-"}</p>
                    <p>القداس المفضل: {data.preferredMass || "-"}</p>
                    {!String(data.className ?? "").toUpperCase().endsWith("G") ? (
                      <p>الخدمة المفضلة: {data.preferredService || "-"}</p>
                    ) : null}
                    {String(data.className ?? "").toUpperCase().endsWith("B") ? (
                      <>
                        <p>الرتبة الحالية: {data.currentRank || "-"}</p>
                        <p>نوع آخر خدمة: {data.lastServiceType || "-"}</p>
                        <p>تاريخ الرسامة/الترقية: {data.ordinationDate || "-"}</p>
                        <p>كنيسة الرسامة: {data.ordinationChurch || "-"}</p>
                        <p>الرسامة على يد: {data.ordainedBy || "-"}</p>
                        <p>تاريخ آخر خدمة: {data.lastServiceDate || "-"}</p>
                      </>
                    ) : null}
                    <p>الرقم المدني للشماس: {data.civilId || "-"}</p>
                  </div>
                </div>
                <div className="mt-2 flex shrink-0 items-start justify-start">
                  <div className="flex h-32 w-32 items-center justify-center rounded-full border-2 border-dashed border-white/60 bg-white/10 text-xs text-white/80">
                    {data.profilePhoto ? (
                      <img
                        src={data.profilePhoto}
                        alt="صورة الطالب"
                        className="h-32 w-32 rounded-full object-cover"
                      />
                    ) : (
                      "لا توجد صورة"
                    )}
                  </div>
                </div>
              </div>
              <div className="mt-3">
                <label className="text-sm text-white/85">تحديث صورة الطالب</label>
                <input
                  type="file"
                  accept="image/*"
                  className="mt-2 block w-full rounded-2xl border border-white/20 bg-white/10 px-4 py-2 text-sm text-white file:mr-3 file:rounded-full file:border-0 file:bg-white file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-black"
                  onChange={(e) => updateStudentPhoto(e.target.files?.[0] ?? null)}
                  disabled={photoSaving}
                />
                {photoSaving ? <p className="mt-2 text-xs text-white/75">جار الحفظ...</p> : null}
                {photoError ? <p className="mt-2 text-xs text-red-200">{photoError}</p> : null}
              </div>
              {data.civilCardPhoto ? (
                <div className="mt-4 rounded-2xl border border-white/20 bg-white/10 p-3">
                  <p className="text-sm font-semibold">صورة المدنية (هويتي)</p>
                  <img
                    src={data.civilCardPhoto}
                    alt="صورة المدنية"
                    className="mt-2 h-40 w-full rounded-xl object-contain bg-black/10"
                  />
                </div>
              ) : null}
              <div className="mt-6 flex flex-col items-center gap-3 rounded-2xl border border-white/20 bg-white/10 p-4">
                <p className="text-sm font-semibold">QR كود الطالب</p>
                {qrDataUrl ? (
                  <img
                    src={qrDataUrl}
                    alt={`QR ${data.code}`}
                    className="h-40 w-40 rounded-xl bg-white p-2"
                  />
                ) : (
                  <div className="flex h-40 w-40 items-center justify-center rounded-xl border border-white/30 text-xs text-white/80">
                    غير متاح
                  </div>
                )}
              </div>
            </section>

            <section className="rounded-3xl border border-white/20 bg-white/15 p-6 text-white shadow-[var(--shadow)] backdrop-blur-md">
              <p className="text-lg font-semibold">الحضور والغياب</p>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <div className="rounded-2xl border border-white/20 bg-white/10 p-4 text-center">
                  <p className="text-2xl font-semibold">{data.attendance.present}</p>
                  <p className="text-sm text-white/85">حضور</p>
                </div>
                <div className="rounded-2xl border border-white/20 bg-white/10 p-4 text-center">
                  <p className="text-2xl font-semibold">{data.attendance.absent}</p>
                  <p className="text-sm text-white/85">غياب</p>
                </div>
              </div>
            </section>

            <section className="rounded-3xl border border-white/20 bg-white/15 p-6 text-white shadow-[var(--shadow)] backdrop-blur-md">
              <p className="text-lg font-semibold">أيام الغياب المسجلة</p>
              {data.attendance.absentDays.length === 0 ? (
                <p className="mt-3 text-sm text-white/80">لا توجد أيام غياب مسجلة.</p>
              ) : (
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {data.attendance.absentDays.map((day, index) => (
                    <div
                      key={`${day}-${index}`}
                      className="rounded-2xl border border-white/20 bg-white/10 px-3 py-2 text-sm"
                    >
                      {day}
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="rounded-3xl border border-white/20 bg-white/15 p-6 text-white shadow-[var(--shadow)] backdrop-blur-md">
              <p className="text-lg font-semibold">درجات الواجبات</p>
              {data.grades.length === 0 ? (
                <p className="mt-3 text-sm text-white/80">لا توجد درجات واجبات حالياً.</p>
              ) : (
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full min-w-[680px] text-right text-sm text-white">
                    <thead>
                      <tr className="border-b border-white/20 text-white/85">
                        <th className="px-3 py-2">الواجب</th>
                        <th className="px-3 py-2">المادة</th>
                        <th className="px-3 py-2">الدرجة</th>
                        <th className="px-3 py-2">من</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.grades.map((g) => (
                        <tr key={g.id} className="border-b border-white/10">
                          <td className="px-3 py-2">{g.title || "-"}</td>
                          <td className="px-3 py-2">{g.subject || "-"}</td>
                          <td className="px-3 py-2">{g.score} / {g.maxScore}</td>
                          <td className="px-3 py-2">{g.createdByRole || "-"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section className="rounded-3xl border border-white/20 bg-white/15 p-6 text-white shadow-[var(--shadow)] backdrop-blur-md">
              <p className="text-lg font-semibold">درجات مسابقة القطمارس</p>
              {!data.katamarsGrades?.length ? (
                <p className="mt-3 text-sm text-white/80">لا توجد درجات مسابقة القطمارس حالياً.</p>
              ) : (
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full min-w-[560px] text-right text-sm text-white">
                    <thead>
                      <tr className="border-b border-white/20 text-white/85">
                        <th className="px-3 py-2">الشهر القبطي</th>
                        <th className="px-3 py-2">الفصل</th>
                        <th className="px-3 py-2">الدرجة</th>
                        <th className="px-3 py-2">آخر تحديث</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.katamarsGrades.map((grade) => (
                        <tr key={grade.id} className="border-b border-white/10">
                          <td className="px-3 py-2">{grade.month || "-"}</td>
                          <td className="px-3 py-2">{grade.classId || "-"}</td>
                          <td className="px-3 py-2">{grade.score}</td>
                          <td className="px-3 py-2">{grade.updatedAt || "-"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>
        ) : null}
      </div>
    </main>
  );
}
