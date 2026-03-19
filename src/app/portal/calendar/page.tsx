"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type StoredUser = {
  role?: string;
  studentCode?: string;
  classes?: string[];
};

type ClassItem = { id: string; name: string };

type CalendarEvent = {
  id: string;
  title: string;
  date: string;
  time: string;
  endTime?: string;
  details: string;
  type: "exam" | "outing" | "conference" | "weekly";
  classIds?: string[];
  allSchool?: boolean;
  createdBy?: { code?: string; name?: string; role?: string };
};

type ActivePeriod = { id: string; name: string; startDate: string; endDate: string };

const dayNames = ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
const monthNames = [
  "يناير",
  "فبراير",
  "مارس",
  "أبريل",
  "مايو",
  "يونيو",
  "يوليو",
  "أغسطس",
  "سبتمبر",
  "أكتوبر",
  "نوفمبر",
  "ديسمبر",
];

const eventTypeLabels: Record<string, string> = {
  exam: "امتحان",
  outing: "يوم روحي أو ترفيهي",
  conference: "مؤتمر",
  weekly: "حصة أسبوعية",
};

const eventTypeOptionsAdmin = ["exam", "outing", "conference", "weekly"];
const eventTypeOptionsTeacher = ["exam"];

const toIsoDate = (date: Date) => date.toISOString().slice(0, 10);

function getMonthRange(date: Date) {
  const start = new Date(date.getFullYear(), date.getMonth(), 1);
  const end = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  return { start: toIsoDate(start), end: toIsoDate(end) };
}

function buildCalendarGrid(date: Date) {
  const firstDay = new Date(date.getFullYear(), date.getMonth(), 1);
  const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  const days: Array<{ date: Date; inMonth: boolean }> = [];
  const startOffset = firstDay.getDay();
  for (let i = 0; i < startOffset; i += 1) {
    const d = new Date(firstDay);
    d.setDate(firstDay.getDate() - (startOffset - i));
    days.push({ date: d, inMonth: false });
  }
  for (let day = 1; day <= lastDay.getDate(); day += 1) {
    days.push({ date: new Date(date.getFullYear(), date.getMonth(), day), inMonth: true });
  }
  const remainder = days.length % 7;
  const remaining = remainder === 0 ? 0 : 7 - remainder;
  for (let i = 1; i <= remaining; i += 1) {
    const d = new Date(lastDay);
    d.setDate(lastDay.getDate() + i);
    days.push({ date: d, inMonth: false });
  }
  while (days.length < 42) {
    const d = new Date(days[days.length - 1].date);
    d.setDate(d.getDate() + 1);
    days.push({ date: d, inMonth: false });
  }
  return days;
}

function getEventDotColor(event: CalendarEvent) {
  if (event.type === "exam") return "bg-red-500";
  if (event.type === "outing") return "bg-green-500";
  if (event.type === "conference") return "bg-yellow-400";
  if (event.type === "weekly") {
    const classId = event.classIds?.[0] ?? "";
    if (classId.toUpperCase().endsWith("G")) return "bg-pink-300";
    if (classId.toUpperCase().endsWith("B")) return "bg-sky-300";
    return "bg-sky-300";
  }
  return "bg-white/70";
}

function getDayCircleClass(events: CalendarEvent[]) {
  if (!events.length) return "bg-transparent border-transparent";
  return "bg-transparent border-white/40";
}

function getEventColor(event: CalendarEvent) {
  if (event.type === "exam") return "rgba(239, 68, 68, 0.65)";
  if (event.type === "outing") return "rgba(34, 197, 94, 0.6)";
  if (event.type === "conference") return "rgba(250, 204, 21, 0.65)";
  if (event.type === "weekly") {
    const classId = String(event.classIds?.[0] ?? "").toUpperCase();
    if (classId.endsWith("G")) return "rgba(244, 114, 182, 0.65)";
    return "rgba(125, 211, 252, 0.65)";
  }
  return "rgba(255,255,255,0.35)";
}

function buildSegments(colors: string[]) {
  if (colors.length === 0) return "";
  const count = Math.min(colors.length, 4);
  const step = 360 / count;
  const parts: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const start = i * step;
    const end = start + step;
    parts.push(`${colors[i]} ${start}deg ${end}deg`);
  }
  return `conic-gradient(${parts.join(", ")})`;
}

function getDayCircleStyle(events: CalendarEvent[]) {
  if (!events.length) return undefined;
  const colors = Array.from(
    new Set(
      events.map((event) => getEventColor(event))
    )
  );
  const gradient = buildSegments(colors);
  if (!gradient) return undefined;
  return {
    backgroundImage: gradient,
  } as React.CSSProperties;
}

export default function CalendarPage() {
  const router = useRouter();
  const [role, setRole] = useState<string>("student");
  const [userCode, setUserCode] = useState<string>("");
  const [userClasses, setUserClasses] = useState<string[]>([]);
  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [activePeriod, setActivePeriod] = useState<ActivePeriod | null>(null);
  const [monthDate, setMonthDate] = useState<Date>(() => new Date());
  const [selectedDate, setSelectedDate] = useState<string>(toIsoDate(new Date()));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [monthSlide, setMonthSlide] = useState<{
    direction: "next" | "prev";
    prevDays: Array<{ date: Date; inMonth: boolean }>;
    prevEventsByDate: Record<string, CalendarEvent[]>;
  } | null>(null);

  const [formTitle, setFormTitle] = useState("");
  const [formDateFrom, setFormDateFrom] = useState(toIsoDate(new Date()));
  const [formDateTo, setFormDateTo] = useState(toIsoDate(new Date()));
  const [formStartTime, setFormStartTime] = useState("");
  const [formEndTime, setFormEndTime] = useState("");
  const [formDetails, setFormDetails] = useState("");
  const [formType, setFormType] = useState("exam");
  const [formAllSchool, setFormAllSchool] = useState(false);
  const [formClassIds, setFormClassIds] = useState<string[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [weeklyClassIds, setWeeklyClassIds] = useState<string[]>([]);
  const [weeklyDay, setWeeklyDay] = useState<number | "">("");
  const [weeklyStartTime, setWeeklyStartTime] = useState("");
  const [weeklyEndTime, setWeeklyEndTime] = useState("");
  const [weeklyDetails, setWeeklyDetails] = useState("");
  const [savingWeekly, setSavingWeekly] = useState(false);
  const [weeklyMessage, setWeeklyMessage] = useState<string | null>(null);

  useEffect(() => {
    if (editingId) return;
    setFormDateFrom(selectedDate);
    setFormDateTo(selectedDate);
  }, [selectedDate, editingId]);

  useEffect(() => {
    if (editingId) return;
    if (!formDateFrom) return;
    if (!formDateTo || formDateTo < formDateFrom) {
      setFormDateTo(formDateFrom);
    }
  }, [formDateFrom, formDateTo, editingId]);

  function addMinutesToTime(value: string, minutesToAdd: number) {
    if (!/^\d{2}:\d{2}$/.test(value)) return value;
    const [hh, mm] = value.split(":");
    const total = Number(hh) * 60 + Number(mm) + minutesToAdd;
    const normalized = ((total % 1440) + 1440) % 1440;
    const nextH = String(Math.floor(normalized / 60)).padStart(2, "0");
    const nextM = String(normalized % 60).padStart(2, "0");
    return `${nextH}:${nextM}`;
  }

  useEffect(() => {
    const stored = window.localStorage.getItem("dsms:user");
    if (!stored) {
      router.replace("/login");
      return;
    }
    try {
      const user = JSON.parse(stored) as StoredUser;
      const nextRole = user?.role ? (user.role === "nzam" ? "system" : user.role) : "student";
      setRole(nextRole);
      setUserCode(user?.studentCode ? String(user.studentCode) : "");
      setUserClasses(
        Array.isArray(user?.classes)
          ? user.classes.map((c) => String(c).trim()).filter(Boolean)
          : []
      );
    } catch {
      router.replace("/login");
    }
  }, [router]);

  useEffect(() => {
    async function loadClasses() {
      try {
        if (role === "admin") {
          const res = await fetch("/api/classes");
          const json = await res.json();
          if (res.ok && json.ok) {
            setClasses((json.data as ClassItem[]) ?? []);
          }
          return;
        }
        if ((role === "teacher" || role === "system") && userCode) {
          const res = await fetch(`/api/users?code=${encodeURIComponent(userCode)}`);
          const json = await res.json();
          if (res.ok && json.ok) {
            const own = Array.isArray(json.data?.classes)
              ? (json.data.classes as string[]).map((c) => String(c).trim()).filter(Boolean)
              : [];
            setClasses(own.map((id) => ({ id, name: id })));
          }
        }
      } catch {
        // ignore
      }
    }
    loadClasses();
  }, [role, userCode]);

  useEffect(() => {
    if (role === "admin" && classes.length && weeklyClassIds.length === 0) {
      setWeeklyClassIds([classes[0].id]);
    }
  }, [classes, role, weeklyClassIds.length]);

  useEffect(() => {
    async function loadEvents() {
      try {
        setLoading(true);
        setError(null);
        const range = getMonthRange(monthDate);
        const res = await fetch(
          `/api/calendar-events?start=${encodeURIComponent(range.start)}&end=${encodeURIComponent(
            range.end
          )}`
        );
        const json = await res.json();
        if (!res.ok || !json.ok) {
          setError(json.message || "تعذر تحميل التقويم.");
          setEvents([]);
          return;
        }
        setEvents((json.data as CalendarEvent[]) ?? []);
        if (json.meta?.period) {
          const period = json.meta.period as ActivePeriod;
          setActivePeriod(period);
          const today = toIsoDate(new Date());
          if (today < period.startDate || today > period.endDate) {
            const startDate = new Date(`${period.startDate}T00:00:00`);
            setMonthDate(startDate);
            setSelectedDate(period.startDate);
          }
        }
      } catch {
        setError("تعذر تحميل التقويم.");
        setEvents([]);
      } finally {
        setLoading(false);
      }
    }
    loadEvents();
  }, [monthDate]);

  useEffect(() => {
    async function loadWeekly() {
      if (role !== "admin") return;
      try {
        const res = await fetch("/api/calendar-weekly");
        const json = await res.json();
        if (!res.ok || !json.ok) return;
        if (json.meta?.period) setActivePeriod(json.meta.period as ActivePeriod);
        const data = Array.isArray(json.data) ? (json.data as Array<Record<string, unknown>>) : [];
        if (weeklyClassIds.length === 1) {
          const current = data.find((item: Record<string, unknown>) => String(item.classId ?? "") === weeklyClassIds[0]);
          if (current) {
            setWeeklyDay(typeof current.dayOfWeek === "number" ? current.dayOfWeek : "");
            setWeeklyStartTime(String(current.time ?? ""));
            setWeeklyEndTime(String(current.endTime ?? ""));
            setWeeklyDetails(String(current.details ?? ""));
          } else {
            setWeeklyDay("");
            setWeeklyStartTime("");
            setWeeklyEndTime("");
            setWeeklyDetails("");
          }
        }
      } catch {
        // ignore
      }
    }
    loadWeekly();
  }, [role, weeklyClassIds]);

  const days = useMemo(() => buildCalendarGrid(monthDate), [monthDate]);
  const eventsByDate = useMemo(() => {
    const map: Record<string, CalendarEvent[]> = {};
    for (const event of events) {
      const key = String(event.date ?? "");
      if (!key) continue;
      if (!map[key]) map[key] = [];
      map[key].push(event);
    }
    return map;
  }, [events]);

  const selectedEvents = eventsByDate[selectedDate] ?? [];
  const canEdit = role === "admin" || role === "teacher";
  const classNameById = useMemo(() => {
    const map: Record<string, string> = {};
    for (const cls of classes) map[cls.id] = cls.name;
    return map;
  }, [classes]);

  const eventTypeOptions = role === "teacher" ? eventTypeOptionsTeacher : eventTypeOptionsAdmin;

  function changeMonth(direction: "next" | "prev") {
    setMonthSlide({
      direction,
      prevDays: days,
      prevEventsByDate: eventsByDate,
    });
    setMonthDate((prev) => {
      const d = new Date(prev);
      d.setMonth(d.getMonth() + (direction === "next" ? 1 : -1));
      return d;
    });
    setTimeout(() => setMonthSlide(null), 260);
  }

  function renderDaysGrid(
    daysInput: Array<{ date: Date; inMonth: boolean }>,
    eventsMap: Record<string, CalendarEvent[]>,
    isOldLayer = false
  ) {
    return (
      <div className="mt-2 grid grid-cols-7 gap-y-3 text-center">
        {daysInput.map((day) => {
          if (!day.inMonth) {
            return (
              <div
                key={`${toIsoDate(day.date)}-${isOldLayer ? "old" : "new"}-empty`}
                className="mx-auto h-11 w-11"
              />
            );
          }
          const iso = toIsoDate(day.date);
          const dayEvents = eventsMap[iso] ?? [];
          const isSelected = selectedDate === iso;
          const hasEvent = dayEvents.length > 0;
          const dayStyle = hasEvent ? getDayCircleStyle(dayEvents) : undefined;
          return (
            <button
              key={`${iso}-${isOldLayer ? "old" : "new"}`}
              type="button"
              onClick={() => setSelectedDate(iso)}
              style={dayStyle}
              className={`mx-auto flex h-11 w-11 items-center justify-center rounded-full border text-sm transition text-white ${
                hasEvent ? getDayCircleClass(dayEvents) : "bg-transparent border-transparent"
              } ${
                isSelected ? "ring-2 ring-[color:var(--accent)]/80 font-bold text-[color:var(--accent)]" : ""
              }`}
            >
              <span>{day.date.getDate()}</span>
            </button>
          );
        })}
      </div>
    );
  }

  function resetForm() {
    setFormTitle("");
    setFormDateFrom(selectedDate);
    setFormDateTo(selectedDate);
    setFormStartTime("");
    setFormEndTime("");
    setFormDetails("");
    setFormType(role === "teacher" ? "exam" : "exam");
    setFormAllSchool(false);
    setFormClassIds([]);
    setEditingId(null);
  }

  async function handleSaveEvent() {
    const title = formTitle.trim();
    const details = formDetails.trim();
    const missing: string[] = [];
    if (!title) missing.push("عنوان الحدث");
    if (!formDateFrom) missing.push("من تاريخ");
    if (!formDateTo) missing.push("إلى تاريخ");
    if (!formStartTime) missing.push("وقت البداية");
    if (!formEndTime) missing.push("وقت النهاية");
    if (!details) missing.push("تفاصيل الحدث");
    if (missing.length) {
      setError(`الحقول الناقصة: ${missing.join(" - ")}`);
      return;
    }
    if (formDateFrom > formDateTo) {
      setError("تاريخ البداية يجب أن يكون قبل أو يساوي تاريخ النهاية.");
      return;
    }
    if (formStartTime && formEndTime && formStartTime >= formEndTime) {
      const adjusted = addMinutesToTime(formStartTime, 60);
      setFormEndTime(adjusted);
    }
    if (!formAllSchool && formClassIds.length === 0) {
      setError("اختر الفصل أو المدرسة كلها.");
      return;
    }
    try {
      setSaving(true);
      setError(null);
      const payload = {
        title,
        date: formDateFrom,
        dateFrom: formDateFrom,
        dateTo: formDateTo,
        time: formStartTime,
        endTime: formEndTime,
        details,
        type: formType,
        allSchool: formAllSchool,
        classIds: formAllSchool ? [] : formClassIds,
      };
      if (editingId) {
        const res = await fetch("/api/calendar-events", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...payload, id: editingId }),
        });
        const json = await res.json();
        if (!res.ok || !json.ok) {
          setError(json.message || "تعذر حفظ الحدث.");
          return;
        }
      } else {
        const res = await fetch("/api/calendar-events", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const json = await res.json();
        if (!res.ok || !json.ok) {
          setError(json.message || "تعذر حفظ الحدث.");
          return;
        }
      }
      resetForm();
      const range = getMonthRange(monthDate);
      const reload = await fetch(
        `/api/calendar-events?start=${encodeURIComponent(range.start)}&end=${encodeURIComponent(
          range.end
        )}`
      );
      const reloadJson = await reload.json();
      if (reload.ok && reloadJson.ok) {
        setEvents((reloadJson.data as CalendarEvent[]) ?? []);
      }
    } catch {
      setError("تعذر حفظ الحدث.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteEvent(id: string) {
    try {
      const res = await fetch("/api/calendar-events", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(json.message || "تعذر حذف الحدث.");
        return;
      }
      setEvents((prev) => prev.filter((item) => item.id !== id));
    } catch {
      setError("تعذر حذف الحدث.");
    }
  }

  async function saveWeeklySchedule() {
    if (role !== "admin") return;
    if (!weeklyClassIds.length) {
      setWeeklyMessage("اختر فصل واحد على الأقل.");
      return;
    }
    if (weeklyDay === "" || !weeklyStartTime || !weeklyEndTime) {
      setWeeklyMessage("اختر اليوم ووقت البداية ووقت النهاية.");
      return;
    }
    if (weeklyStartTime >= weeklyEndTime) {
      setWeeklyMessage("وقت النهاية يجب أن يكون بعد وقت البداية.");
      return;
    }
    try {
      setSavingWeekly(true);
      setWeeklyMessage(null);
      const res = await fetch("/api/calendar-weekly", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          classIds: weeklyClassIds,
          dayOfWeek: weeklyDay,
          time: weeklyStartTime,
          endTime: weeklyEndTime,
          details: weeklyDetails,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setWeeklyMessage(json.message || "تعذر حفظ الحصة الأسبوعية.");
        return;
      }
      setWeeklyMessage("تم حفظ الحصة الأسبوعية.");
      const range = getMonthRange(monthDate);
      const reload = await fetch(
        `/api/calendar-events?start=${encodeURIComponent(range.start)}&end=${encodeURIComponent(
          range.end
        )}`
      );
      const reloadJson = await reload.json();
      if (reload.ok && reloadJson.ok) {
        setEvents((reloadJson.data as CalendarEvent[]) ?? []);
      }
    } catch {
      setWeeklyMessage("تعذر حفظ الحصة الأسبوعية.");
    } finally {
      setSavingWeekly(false);
    }
  }

  return (
    <main className="calendar-page min-h-screen px-6 pb-24 pt-10">
      <div className="mx-auto w-full max-w-5xl">
        <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="app-heading mt-2">التقويم</h1>
            {activePeriod ? (
              <p className="text-sm text-white/70">الفترة الفعالة: {activePeriod.name}</p>
            ) : null}
          </div>
        </header>

        <section className="rounded-3xl border border-white/20 bg-white/15 p-5 text-white shadow-[var(--shadow)] backdrop-blur-md">
          <div className="relative mb-4 flex items-center justify-center">
            <button
              type="button"
              onClick={() => changeMonth("prev")}
              className="absolute left-2 flex h-10 w-10 items-center justify-center bg-transparent"
              aria-label="الشهر السابق"
            >
              <img
                src="/arrow_left_30dp_FFFFFF_FILL0_wght400_GRAD0_opsz24.png"
                alt=""
                className="h-7 w-7 object-contain"
              />
            </button>
            <p className="text-center text-lg font-semibold">
              {monthNames[monthDate.getMonth()]} {monthDate.getFullYear()}
            </p>
            <button
              type="button"
              onClick={() => changeMonth("next")}
              className="absolute right-2 flex h-10 w-10 items-center justify-center bg-transparent"
              aria-label="الشهر التالي"
            >
              <img
                src="/arrow_right_30dp_FFFFFF_FILL0_wght400_GRAD0_opsz24.png"
                alt=""
                className="h-7 w-7 object-contain"
              />
            </button>
          </div>
          <div className="grid grid-cols-7 gap-2 text-center text-xs text-white/70">
            {dayNames.map((day) => (
              <div key={day}>{day}</div>
            ))}
          </div>
          <div className="relative mt-1 min-h-[340px] overflow-hidden">
            {monthSlide ? (
              <div
                className={`absolute inset-0 ${
                  monthSlide.direction === "next" ? "calendar-month-out-left" : "calendar-month-out-right"
                }`}
              >
                {renderDaysGrid(monthSlide.prevDays, monthSlide.prevEventsByDate, true)}
              </div>
            ) : null}
            <div
              className={`absolute inset-0 ${
                monthSlide
                  ? monthSlide.direction === "next"
                    ? "calendar-month-in-right"
                    : "calendar-month-in-left"
                  : ""
              }`}
            >
              {renderDaysGrid(days, eventsByDate)}
            </div>
          </div>
          <div className="mt-0 flex flex-wrap items-center justify-center gap-2 text-[11px] text-white/80">
            <span className="inline-flex items-center gap-1 rounded-full border border-red-400/60 bg-red-500/30 px-2 py-1">
              <span className="h-2 w-2 rounded-full bg-red-400" />
              امتحان
            </span>
            <span className="inline-flex items-center gap-1 rounded-full border border-green-400/60 bg-green-500/25 px-2 py-1">
              <span className="h-2 w-2 rounded-full bg-green-400" />
              يوم روحي/ترفيهي
            </span>
            <span className="inline-flex items-center gap-1 rounded-full border border-yellow-300/70 bg-yellow-400/25 px-2 py-1">
              <span className="h-2 w-2 rounded-full bg-yellow-300" />
              مؤتمر
            </span>
            <span className="inline-flex items-center gap-1 rounded-full border border-sky-200/70 bg-sky-300/30 px-2 py-1">
              <span className="h-2 w-2 rounded-full bg-sky-200" />
              حصة أولاد
            </span>
            <span className="inline-flex items-center gap-1 rounded-full border border-pink-200/70 bg-pink-300/35 px-2 py-1">
              <span className="h-2 w-2 rounded-full bg-pink-200" />
              حصة بنات
            </span>
          </div>
        </section>

        {loading ? <p className="mt-4 text-sm text-white/80">جار التحميل...</p> : null}
        {error ? <p className="mt-4 text-sm text-red-200">{error}</p> : null}

        <section className="mt-6 rounded-3xl border border-white/20 bg-white/15 p-5 text-white shadow-[var(--shadow)] backdrop-blur-md">
          <div className="flex items-center justify-between">
            <p className="text-lg font-semibold">أحداث يوم {selectedDate}</p>
            <span className="text-xs text-white/70">{selectedEvents.length} حدث</span>
          </div>
          <div className="mt-4 grid gap-3">
            {selectedEvents.length === 0 ? (
              <div className="rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-sm text-white/70">
                لا يوجد أحداث لهذا اليوم.
              </div>
            ) : (
              selectedEvents.map((event) => {
                const canEditItem =
                  role === "admin" || (role === "teacher" && event.createdBy?.code === userCode);
                const targetClasses = Array.isArray(event.classIds)
                  ? event.classIds.map((id) => classNameById[id] ?? id).filter(Boolean)
                  : [];
                const targetsLabel = event.allSchool
                  ? "المدرسة كلها"
                  : targetClasses.length
                    ? targetClasses.join(" - ")
                    : "غير محدد";
                return (
                  <div key={event.id} className="rounded-2xl border border-white/20 bg-white/10 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold">
                          {event.title} <span className="text-white/70">- {targetsLabel}</span>
                        </p>
                        <p className="mt-1 text-xs text-white/70">
                          {eventTypeLabels[event.type] ?? event.type} •{" "}
                          {event.endTime ? `${event.time} - ${event.endTime}` : event.time}
                        </p>
                      </div>
                      <span className={`h-3 w-3 rounded-full ${getEventDotColor(event)}`} />
                    </div>
                    <p className="mt-3 whitespace-pre-wrap text-sm text-white/85">{event.details}</p>
                    {canEditItem ? (
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          type="button"
                          className="rounded-full border border-white/30 bg-white/10 px-4 py-1.5 text-xs font-semibold"
                          onClick={() => {
                            setEditingId(event.id);
                            setFormTitle(event.title);
                            setFormDateFrom(event.date);
                            setFormDateTo(event.date);
                            setFormStartTime(event.time);
                            setFormEndTime(String(event.endTime ?? ""));
                            setFormDetails(event.details);
                            setFormType(event.type);
                            setFormAllSchool(Boolean(event.allSchool));
                            setFormClassIds(event.classIds ?? []);
                          }}
                        >
                          تعديل
                        </button>
                        <button
                          type="button"
                          className="rounded-full border border-red-500/60 bg-red-600/20 px-4 py-1.5 text-xs font-semibold text-red-200"
                          onClick={() => handleDeleteEvent(event.id)}
                        >
                          حذف
                        </button>
                      </div>
                    ) : null}
                  </div>
                );
              })
            )}
          </div>
        </section>

        {canEdit ? (
          <section className="mt-6 rounded-3xl border border-white/20 bg-white/15 p-5 text-white shadow-[var(--shadow)] backdrop-blur-md">
            <p className="text-lg font-semibold">إضافة حدث</p>
            <div className="mt-4 grid gap-3">
              <input
                className="rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-sm text-white placeholder:text-white/60"
                placeholder="عنوان الحدث"
                value={formTitle}
                onChange={(e) => setFormTitle(e.target.value)}
              />
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="grid gap-1">
                  <span className="text-xs text-white/80">من تاريخ</span>
                  <input
                    className="rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-sm text-white"
                    type="date"
                    value={formDateFrom}
                    onChange={(e) => {
                      const next = e.target.value;
                      setFormDateFrom(next);
                      if (!formDateTo || formDateTo < next) {
                        setFormDateTo(next);
                      }
                    }}
                  />
                </div>
                <div className="grid gap-1">
                  <span className="text-xs text-white/80">إلى تاريخ</span>
                  <input
                    className="rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-sm text-white"
                    type="date"
                    value={formDateTo}
                    onChange={(e) => setFormDateTo(e.target.value)}
                  />
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="grid gap-1">
                  <span className="text-xs text-white/80">وقت البداية</span>
                  <input
                    className="rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-sm text-white"
                    type="time"
                    value={formStartTime}
                    onChange={(e) => {
                      const next = e.target.value;
                      setFormStartTime(next);
                      if (formEndTime && next && formEndTime <= next) {
                        setFormEndTime(addMinutesToTime(next, 60));
                      }
                    }}
                  />
                </div>
                <div className="grid gap-1">
                  <span className="text-xs text-white/80">وقت النهاية</span>
                  <input
                    className="rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-sm text-white"
                    type="time"
                    value={formEndTime}
                    onChange={(e) => setFormEndTime(e.target.value)}
                  />
                </div>
              </div>
              <textarea
                className="rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-sm text-white placeholder:text-white/60"
                rows={4}
                placeholder="تفاصيل الحدث"
                value={formDetails}
                onChange={(e) => setFormDetails(e.target.value)}
              />
              <select
                className="rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-sm text-white"
                value={formType}
                onChange={(e) => setFormType(e.target.value)}
              >
                {eventTypeOptions.map((type) => (
                  <option key={type} value={type} className="text-black">
                    {eventTypeLabels[type]}
                  </option>
                ))}
              </select>

              <div className="rounded-2xl border border-white/20 bg-white/10 p-3">
                <label className="flex items-center gap-2 text-xs text-white/80">
                  <input
                    type="checkbox"
                    checked={formAllSchool}
                    onChange={(e) => {
                      setFormAllSchool(e.target.checked);
                      if (e.target.checked) setFormClassIds([]);
                    }}
                  />
                  المدرسة كلها
                </label>
                {!formAllSchool ? (
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    {classes.map((cls) => (
                      <label key={cls.id} className="flex items-center gap-2 text-xs text-white/80">
                        <input
                          type="checkbox"
                          checked={formClassIds.includes(cls.id)}
                          onChange={(e) => {
                            setFormClassIds((prev) =>
                              e.target.checked
                                ? [...prev, cls.id]
                                : prev.filter((id) => id !== cls.id)
                            );
                          }}
                        />
                        {cls.name}
                      </label>
                    ))}
                  </div>
                ) : null}
              </div>

              <button
                type="button"
                disabled={saving}
                onClick={handleSaveEvent}
                className="w-fit rounded-full bg-white px-5 py-2 text-sm font-semibold text-black disabled:opacity-60"
              >
                {saving ? "جار الحفظ..." : editingId ? "حفظ التعديل" : "نشر الحدث"}
              </button>
            </div>
          </section>
        ) : null}

        {role === "admin" ? (
          <section className="mt-6 rounded-3xl border border-white/20 bg-white/15 p-5 text-white shadow-[var(--shadow)] backdrop-blur-md">
            <p className="text-lg font-semibold">الحصة الأسبوعية لكل فصل</p>
            <div className="mt-4 grid gap-3">
              <div className="rounded-2xl border border-white/20 bg-white/10 p-3">
                <p className="mb-2 text-xs text-white/80">الفصول المستهدفة</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {classes.map((cls) => (
                    <label key={cls.id} className="flex items-center gap-2 text-xs text-white/90">
                      <input
                        type="checkbox"
                        checked={weeklyClassIds.includes(cls.id)}
                        onChange={(e) => {
                          setWeeklyClassIds((prev) =>
                            e.target.checked ? [...prev, cls.id] : prev.filter((id) => id !== cls.id)
                          );
                        }}
                      />
                      {cls.name}
                    </label>
                  ))}
                </div>
              </div>
              <select
                className="rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-sm text-white"
                value={weeklyDay}
                onChange={(e) => {
                  const value = e.target.value;
                  setWeeklyDay(value === "" ? "" : Number(value));
                }}
              >
                <option value="" className="text-black">
                  اليوم
                </option>
                {dayNames.map((day, idx) => (
                  <option key={day} value={idx} className="text-black">
                    {day}
                  </option>
                ))}
              </select>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="grid gap-1">
                    <span className="text-xs text-white/80">وقت البداية</span>
                    <input
                      type="time"
                      className="rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-sm text-white"
                      value={weeklyStartTime}
                      onChange={(e) => setWeeklyStartTime(e.target.value)}
                    />
                  </div>
                  <div className="grid gap-1">
                    <span className="text-xs text-white/80">وقت النهاية</span>
                    <input
                      type="time"
                      className="rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-sm text-white"
                      value={weeklyEndTime}
                      onChange={(e) => setWeeklyEndTime(e.target.value)}
                    />
                  </div>
                </div>
              <textarea
                className="rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-sm text-white placeholder:text-white/60"
                rows={3}
                placeholder="تفاصيل الحصة الأسبوعية"
                value={weeklyDetails}
                onChange={(e) => setWeeklyDetails(e.target.value)}
              />
              {weeklyMessage ? <p className="text-sm text-white/80">{weeklyMessage}</p> : null}
              <button
                type="button"
                disabled={savingWeekly}
                onClick={saveWeeklySchedule}
                className="w-fit rounded-full bg-white px-5 py-2 text-sm font-semibold text-black disabled:opacity-60"
              >
                {savingWeekly ? "جار الحفظ..." : "حفظ الحصة الأسبوعية"}
              </button>
            </div>
          </section>
        ) : null}
      </div>
    </main>
  );
}

