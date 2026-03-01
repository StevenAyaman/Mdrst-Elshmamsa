"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type StoredUser = { role?: string; studentCode?: string };

type PeriodItem = {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  active: boolean;
};

type StudentItem = { code: string; name: string };
type StudentProfile = {
  code: string;
  name: string;
  className: string;
  parentCodes: string[];
  profilePhoto?: string;
};
type ClassItem = { id: string; name: string };

type AttendanceStatus = "present" | "absent" | "unset";
type AttendanceMap = Record<string, AttendanceStatus>;

function getTargetWeekday(classId: string) {
  const upper = classId.toUpperCase();
  if (upper.endsWith("B")) return 5; // Friday
  if (upper.endsWith("G")) return 4; // Thursday
  return 5;
}

function generateClassDates(startDate: string, endDate: string, classId: string) {
  const targetWeekday = getTargetWeekday(classId);
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) return [];

  const dates: string[] = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    if (cursor.getDay() === targetWeekday) {
      const yyyy = cursor.getFullYear();
      const mm = String(cursor.getMonth() + 1).padStart(2, "0");
      const dd = String(cursor.getDate()).padStart(2, "0");
      dates.push(`${yyyy}-${mm}-${dd}`);
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}

export default function AttendancePage() {
  const router = useRouter();
  const [me, setMe] = useState<StoredUser | null>(null);
  const [myClassId, setMyClassId] = useState("");
  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [selectedClassId, setSelectedClassId] = useState("");
  const [periods, setPeriods] = useState<PeriodItem[]>([]);
  const [periodId, setPeriodId] = useState("");
  const [date, setDate] = useState("");
  const [students, setStudents] = useState<StudentItem[]>([]);
  const [attendance, setAttendance] = useState<AttendanceMap>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scannedStudent, setScannedStudent] = useState<StudentProfile | null>(null);
  const [scannedPhoto, setScannedPhoto] = useState<string>("");
  const scannerRef = useRef<{ stop: () => Promise<void> } | null>(null);

  useEffect(() => {
    const stored = window.localStorage.getItem("dsms:user");
    if (!stored) {
      router.replace("/login");
      return;
    }
    try {
      const user = JSON.parse(stored) as StoredUser;
      const role = user.role === "nzam" ? "system" : user.role;
      if (role !== "system" && role !== "admin" && role !== "teacher") {
        router.replace(`/portal/${role ?? "student"}`);
        return;
      }
      setMe({ ...user, role });
    } catch {
      router.replace("/login");
    }
  }, [router]);

  useEffect(() => {
    async function loadInitialData() {
      if (!me?.studentCode || !me?.role) return;
      try {
        setLoading(true);
        setError(null);

        if (me.role === "admin") {
          const classesRes = await fetch("/api/classes");
          const classesJson = await classesRes.json();
          if (!classesRes.ok || !classesJson.ok) {
            setError(classesJson?.message || "تعذر تحميل الفصول.");
            return;
          }
          const loadedClasses = (classesJson.data as ClassItem[]) || [];
          setClasses(loadedClasses);
          const storedClass = window.localStorage.getItem("dsms:classId");
          const fallback = storedClass || loadedClasses[0]?.id || "";
          setSelectedClassId(fallback);
          setMyClassId(fallback);
        } else if (me.role === "teacher") {
          const userRes = await fetch(`/api/users?code=${encodeURIComponent(me.studentCode)}`);
          const userJson = await userRes.json();
          if (!userRes.ok || !userJson.ok) {
            setError(userJson?.message || "تعذر تحميل بيانات المدرس.");
            return;
          }
          const userClasses = Array.isArray(userJson.data?.classes)
            ? (userJson.data.classes as string[])
            : [];
          if (!userClasses.length) {
            setError("لا يوجد فصل مرتبط بحسابك.");
            return;
          }
          const ownClasses = userClasses.map((id) => ({ id: String(id), name: String(id) }));
          setClasses(ownClasses);
          const storedClass = window.localStorage.getItem("dsms:classId");
          const fallback =
            storedClass && ownClasses.some((item) => item.id === storedClass)
              ? storedClass
              : ownClasses[0]?.id || "";
          setSelectedClassId(fallback);
          setMyClassId(fallback);
        } else {
          const userRes = await fetch(`/api/users?code=${encodeURIComponent(me.studentCode)}`);
          const userJson = await userRes.json();
          if (!userRes.ok || !userJson.ok) {
            setError(userJson?.message || "تعذر تحميل بيانات خادم النظام.");
            return;
          }
          const userClasses = Array.isArray(userJson.data?.classes)
            ? (userJson.data.classes as string[])
            : [];
          if (!userClasses.length) {
            setError("لا يوجد فصل مرتبط بحسابك.");
            return;
          }
          const classId = String(userClasses[0]);
          setMyClassId(classId);
        }

        const periodQuery = new URLSearchParams({
          actorCode: me.studentCode,
          actorRole: me.role,
          status: "active",
        });
        const periodsRes = await fetch(`/api/service-periods?${periodQuery.toString()}`);
        const periodsJson = await periodsRes.json();
        if (!periodsRes.ok || !periodsJson.ok) {
          setError(periodsJson?.message || "تعذر تحميل الفترات.");
          return;
        }
        const loadedPeriods = periodsJson.data as PeriodItem[];
        setPeriods(loadedPeriods);
        if (loadedPeriods.length) {
          setPeriodId(loadedPeriods[0].id);
        } else {
          setError("لا توجد فترة خدمة مفعلة حالياً.");
        }
      } catch {
        setError("تعذر تحميل البيانات.");
      } finally {
        setLoading(false);
      }
    }
    loadInitialData();
  }, [me?.studentCode, me?.role]);

  useEffect(() => {
    if (me?.role !== "admin" && me?.role !== "teacher") return;
    if (selectedClassId) {
      setMyClassId(selectedClassId);
      window.localStorage.setItem("dsms:classId", selectedClassId);
      setDate("");
      setStudents([]);
      setAttendance({});
      setSearchTerm("");
    }
  }, [me?.role, selectedClassId]);

  useEffect(() => {
    async function startScanner() {
      if (!scannerOpen) return;
      setScanError(null);
      try {
        const { Html5Qrcode } = await import("html5-qrcode");
        const instance = new Html5Qrcode("qr-reader");
        scannerRef.current = instance;
        await instance.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: { width: 240, height: 240 } },
          async (decodedText: string) => {
            try {
              await instance.stop();
            } catch {
              // ignore
            }
            scannerRef.current = null;
            setScannerOpen(false);
            handleScannedCode(decodedText);
          },
          () => undefined
        );
      } catch {
        setScanError("تعذر تشغيل الكاميرا.");
      }
    }
    startScanner();
    return () => {
      if (scannerRef.current) {
        scannerRef.current.stop().catch(() => undefined);
        scannerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scannerOpen]);

  async function handleScannedCode(value: string) {
    const code = value.trim();
    if (!code) return;
    setScanError(null);
    try {
      const res = await fetch(`/api/students/${encodeURIComponent(code)}`);
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setScanError(json?.message || "تعذر تحميل ملف الطالب.");
        return;
      }
      const data = json.data as StudentProfile;
      if (myClassId && data.className && data.className !== myClassId) {
        setScanError("الطالب ليس من نفس الفصل.");
        return;
      }
      setScannedStudent({
        code: data.code,
        name: data.name,
        className: data.className || myClassId,
        parentCodes: Array.isArray(data.parentCodes) ? data.parentCodes : [],
        profilePhoto: data.profilePhoto,
      });
    } catch {
      setScanError("تعذر تحميل ملف الطالب.");
    }
  }

  useEffect(() => {
    if (!scannedStudent) {
      setScannedPhoto("");
      return;
    }
    setScannedPhoto(scannedStudent.profilePhoto ?? "");
  }, [scannedStudent]);

  const availableDates = useMemo(() => {
    const period = periods.find((item) => item.id === periodId);
    if (!period || !myClassId) return [];
    return generateClassDates(period.startDate, period.endDate, myClassId);
  }, [periodId, periods, myClassId]);

  useEffect(() => {
    if (!availableDates.length) {
      setDate("");
      return;
    }
    if (!date || !availableDates.includes(date)) {
      setDate(availableDates[0]);
    }
  }, [availableDates, date]);

  useEffect(() => {
    async function loadAttendanceForDate() {
      if (!me?.studentCode || !me?.role || !date) return;
      try {
        setError(null);
        setSuccess(null);
        const query = new URLSearchParams({
          actorCode: me.studentCode,
          actorRole: me.role,
          date,
        });
        if ((me.role === "admin" || me.role === "teacher") && myClassId) {
          query.set("classId", myClassId);
        }
        const res = await fetch(`/api/attendance/records?${query.toString()}`);
        const json = await res.json();
        if (!res.ok || !json.ok) {
          setError(json?.message || "تعذر تحميل كشف الحضور.");
          return;
        }
        const loadedStudents = json.data.students as StudentItem[];
        const loadedAttendance = (json.data.attendance ?? {}) as AttendanceMap;
        setStudents(loadedStudents);
        const defaultMap: AttendanceMap = {};
        loadedStudents.forEach((student) => {
          defaultMap[student.code] =
            loadedAttendance[student.code] === "present" || loadedAttendance[student.code] === "absent"
              ? loadedAttendance[student.code]
              : "unset";
        });
        setAttendance(defaultMap);
      } catch {
        setError("تعذر تحميل كشف الحضور.");
      }
    }
    loadAttendanceForDate();
  }, [date, me?.studentCode, me?.role]);

  function setStatus(code: string, status: "present" | "absent") {
    setAttendance((prev) => ({ ...prev, [code]: status }));
  }

  const filteredStudents = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) return students;
    return students.filter((student) => {
      const byName = student.name.toLowerCase().includes(term);
      const byCode = student.code.toLowerCase().includes(term);
      return byName || byCode;
    });
  }, [students, searchTerm]);

  async function saveAttendance() {
    if (!me?.studentCode || !me?.role || !date) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const entries = students.map((student) => ({
        code: student.code,
        status: attendance[student.code] === "present" ? "present" : "absent",
      }));
      const res = await fetch("/api/attendance/records", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          actorCode: me.studentCode,
          actorRole: me.role,
          date,
          classId: me.role === "admin" || me.role === "teacher" ? myClassId : undefined,
          entries,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(json?.message || "تعذر حفظ الحضور.");
        return;
      }
      setSuccess("تم حفظ الحضور والغياب بنجاح.");
    } catch {
      setError("تعذر حفظ الحضور.");
    } finally {
      setSaving(false);
    }
  }

  async function saveSingleAttendance(status: "present" | "absent") {
    if (!me?.studentCode || !me?.role || !date || !scannedStudent) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch("/api/attendance/records", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          actorCode: me.studentCode,
          actorRole: me.role,
          date,
          classId: me.role === "admin" || me.role === "teacher" ? myClassId : undefined,
          entries: [{ code: scannedStudent.code, status }],
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(json?.message || "تعذر حفظ الحضور.");
        return;
      }
      setSuccess("تم تسجيل الحضور.");
      setAttendance((prev) => ({ ...prev, [scannedStudent.code]: status }));
      setScannedStudent(null);
    } catch {
      setError("تعذر حفظ الحضور.");
    } finally {
      setSaving(false);
    }
  }

  async function clearAttendance() {
    if (!me?.studentCode || !me?.role || !date) return;
    setClearing(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch("/api/attendance/records", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          actorCode: me.studentCode,
          actorRole: me.role,
          date,
          classId: me.role === "admin" || me.role === "teacher" ? myClassId : undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(json?.message || "تعذر مسح الحضور.");
        return;
      }
      setSuccess("تم مسح حضور اليوم.");
      setAttendance({});
    } catch {
      setError("تعذر مسح الحضور.");
    } finally {
      setClearing(false);
    }
  }

  return (
    <main className="min-h-screen px-6 pb-24 pt-10">
      <div className="mx-auto w-full max-w-5xl">
        <header className="mb-8 flex items-center justify-between">
          <h1 className="app-heading mt-2">الغياب والحضور</h1>
          <Link
            href={
              me?.role === "admin"
                ? "/portal/admin"
                : me?.role === "teacher"
                  ? "/portal/teacher"
                  : "/portal/system"
            }
            className="back-btn rounded-full border border-black/10 bg-white px-4 py-2 text-sm font-semibold text-[color:var(--ink)] shadow-sm"
          >
            رجوع
          </Link>
        </header>

        <section className="rounded-3xl border border-white/20 bg-white/15 p-6 text-white shadow-[var(--shadow)] backdrop-blur-md">
          {loading ? <p className="text-sm text-white/80">جار التحميل...</p> : null}
          {!loading ? (
            <div className="grid gap-4">
              {me?.role === "admin" || me?.role === "teacher" ? (
                <select
                  className="rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-sm text-white"
                  value={selectedClassId}
                  onChange={(e) => setSelectedClassId(e.target.value)}
                >
                  <option value="" className="text-black">
                    اختر الفصل
                  </option>
                  {classes.map((cls) => (
                    <option key={cls.id} value={cls.id} className="text-black">
                      {cls.name}
                    </option>
                  ))}
                </select>
              ) : (
                <p className="text-sm text-white/90">الفصل: {myClassId || "-"}</p>
              )}

              <div className="grid gap-3 sm:grid-cols-2">
                <select
                  className="rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-sm text-white"
                  value={periodId}
                  onChange={(e) => setPeriodId(e.target.value)}
                >
                  <option value="" className="text-black">
                    اختر الفترة
                  </option>
                  {periods.map((period) => (
                    <option key={period.id} value={period.id} className="text-black">
                      {period.name} ({period.startDate} - {period.endDate})
                    </option>
                  ))}
                </select>

                <select
                  className="rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-sm text-white"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  disabled={!availableDates.length}
                >
                  <option value="" className="text-black">
                    {availableDates.length ? "اختر التاريخ" : "لا توجد تواريخ في هذه الفترة"}
                  </option>
                  {availableDates.map((item) => (
                    <option key={item} value={item} className="text-black">
                      {item}
                    </option>
                  ))}
                </select>
              </div>

              {error ? <p className="text-sm text-red-200">{error}</p> : null}
              {success ? <p className="text-sm text-green-200">{success}</p> : null}
              {scanError ? <p className="text-sm text-red-200">{scanError}</p> : null}

              <input
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="بحث بالاسم أو الكود"
                className="w-full rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-sm text-white placeholder:text-white/70"
              />

              <div className="grid gap-3">
                <button
                  type="button"
                  onClick={() => setScannerOpen((prev) => !prev)}
                  className="flex h-12 w-12 items-center justify-center rounded-full border border-white/25 bg-white/10 text-white transition hover:-translate-y-0.5"
                  aria-label={scannerOpen ? "إغلاق الكاميرا" : "مسح QR"}
                >
                  <img src="/scanner.png" alt="" className="h-6 w-6" aria-hidden="true" />
                </button>
                {scannerOpen ? (
                  <div className="rounded-3xl border border-white/20 bg-white/10 p-4">
                    <div id="qr-reader" className="mx-auto w-full max-w-xs" />
                  </div>
                ) : null}
              </div>

              {scannedStudent ? (
                <div className="relative rounded-3xl border border-white/20 bg-white/10 p-4 text-white">
                  <button
                    type="button"
                    onClick={() => setScannedStudent(null)}
                    className="absolute left-3 top-3 flex h-8 w-8 items-center justify-center rounded-full border border-white/20 bg-white/10 text-base text-white"
                    aria-label="إغلاق"
                  >
                    ×
                  </button>
                  <div className="flex flex-col items-center gap-3">
                    <div className="flex h-24 w-24 items-center justify-center rounded-full border-2 border-dashed border-white/60 bg-white/10 text-xs text-white/80">
                      {scannedPhoto ? (
                        <img
                          src={scannedPhoto}
                          alt=""
                          className="h-24 w-24 rounded-full object-cover"
                        />
                      ) : (
                        "لا توجد صورة"
                      )}
                    </div>
                    <p className="text-lg font-semibold">{scannedStudent.name}</p>
                    <p className="text-sm text-white/80">الكود: {scannedStudent.code}</p>
                    <p className="text-sm text-white/80">الفصل: {scannedStudent.className}</p>
                  </div>
                  <div className="mt-4 flex items-center justify-center gap-3">
                    <button
                      type="button"
                      onClick={() => saveSingleAttendance("present")}
                      className="rounded-full bg-green-600 px-5 py-2 text-sm font-semibold text-white"
                    >
                      حضور
                    </button>
                    <button
                      type="button"
                      onClick={() => saveSingleAttendance("absent")}
                      className="rounded-full bg-red-600 px-5 py-2 text-sm font-semibold text-white"
                    >
                      غياب
                    </button>
                  </div>
                </div>
              ) : null}

              <div className="grid gap-3">
                {filteredStudents.map((student) => {
                  const status = attendance[student.code] ?? "unset";
                  return (
                    <div
                      key={student.code}
                      className="flex items-center justify-between rounded-2xl border border-white/20 bg-white/10 px-4 py-3"
                    >
                      <div>
                        <p className="text-sm font-semibold">{student.name}</p>
                        <p className="text-xs text-white/80">{student.code}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setStatus(student.code, "present")}
                          className={`inline-flex items-center justify-center px-1 text-3xl leading-none ${
                            status === "present"
                              ? "text-green-500"
                              : "text-white/35"
                          }`}
                          aria-label={`تحديد ${student.name} حاضر`}
                        >
                          ✓
                        </button>
                        <button
                          type="button"
                          onClick={() => setStatus(student.code, "absent")}
                          className={`inline-flex items-center justify-center px-1 text-3xl leading-none ${
                            status === "absent"
                              ? "text-red-500"
                              : "text-white/35"
                          }`}
                          aria-label={`تحديد ${student.name} غائب`}
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={saveAttendance}
                  disabled={saving || !date || !students.length || !myClassId}
                  className="w-fit rounded-full bg-[color:var(--accent-2)] px-5 py-2 text-sm font-semibold text-white disabled:opacity-60"
                >
                  {saving ? "جار الحفظ..." : "حفظ الحضور"}
                </button>
                <button
                  type="button"
                  onClick={clearAttendance}
                  disabled={clearing || !date || !students.length || !myClassId}
                  className="w-fit rounded-full border border-red-200 bg-white/10 px-5 py-2 text-sm font-semibold text-red-200 disabled:opacity-60"
                >
                  {clearing ? "جار المسح..." : "مسح حضور اليوم"}
                </button>
              </div>

              <a
                href={
                  myClassId && periodId
                    ? `/api/classes/${myClassId}/attendance-export?periodId=${encodeURIComponent(periodId)}`
                    : "#"
                }
                className={`w-fit rounded-full px-5 py-2 text-sm font-semibold ${
                  myClassId && periodId
                    ? "border border-white/25 bg-white/10 text-white"
                    : "pointer-events-none border border-white/15 bg-white/5 text-white/60"
                }`}
              >
                تنزيل حضور الفصل
              </a>
            </div>
          ) : null}
        </section>
      </div>
    </main>
  );
}

