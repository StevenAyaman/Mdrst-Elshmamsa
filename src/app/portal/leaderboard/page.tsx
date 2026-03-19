"use client";

import BackButton from "@/app/back-button";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type StoredUser = {
  role?: string;
  studentCode?: string;
  classes?: string[];
  name?: string;
};

type ClassItem = { id: string; name: string };

type LeaderboardEntry = {
  rank: number;
  code: string;
  name: string;
  classId: string;
  className: string;
  score: number;
  percent?: number;
  profilePhoto?: string;
};

type LeaderboardResponse = {
  ok: boolean;
  data?: {
    competition: string;
    scope: { type: string; classId?: string };
    period: { name: string; start: string; end: string; term: string };
    resetAt?: string | null;
    leaderboard: LeaderboardEntry[];
  };
  message?: string;
};

const competitions = [
  { key: "attendance", label: "الحضور" },
  { key: "commitment", label: "الالتزام" },
  { key: "katamars", label: "درجات القطمارس" },
] as const;

const scopeOptionsBase = [
  { value: "school", label: "المدرسة كلها" },
  { value: "boys", label: "بنين فقط" },
  { value: "girls", label: "بنات فقط" },
];

export default function LeaderboardPage() {
  const router = useRouter();
  const [role, setRole] = useState<string>("");
  const [userCode, setUserCode] = useState<string>("");
  const [userClasses, setUserClasses] = useState<string[]>([]);
  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [competition, setCompetition] = useState<string>("attendance");
  const [scope, setScope] = useState<string>("school");
  const [loading, setLoading] = useState(true);
  const [resetting, setResetting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<LeaderboardEntry[]>([]);

  useEffect(() => {
    const stored = window.localStorage.getItem("dsms:user");
    if (!stored) {
      router.replace("/login");
      return;
    }
    try {
      const parsed = JSON.parse(stored) as StoredUser;
      const normalizedRole = parsed.role === "nzam" ? "system" : String(parsed.role ?? "");
      if (!normalizedRole) {
        router.replace("/login");
        return;
      }
      setRole(normalizedRole);
      setUserCode(String(parsed.studentCode ?? ""));
      setUserClasses(
        Array.isArray(parsed.classes)
          ? parsed.classes.map((c) => String(c).trim()).filter(Boolean)
          : [],
      );
    } catch {
      router.replace("/login");
    }
  }, [router]);

  useEffect(() => {
    async function hydrateClasses() {
      if (!userCode) return;
      try {
        const res = await fetch(`/api/users?code=${encodeURIComponent(userCode)}`);
        const json = await res.json();
        if (!res.ok || !json.ok) return;
        const apiClasses = Array.isArray(json.data?.classes)
          ? (json.data.classes as string[]).map((c) => String(c).trim()).filter(Boolean)
          : [];
        if (apiClasses.length) {
          setUserClasses(apiClasses);
          return;
        }
        const children = Array.isArray(json.data?.childrenCodes)
          ? (json.data.childrenCodes as string[]).map((c) => String(c).trim()).filter(Boolean)
          : [];
        if (!children.length) return;
        const childSnaps = await Promise.all(
          children.map((code) => fetch(`/api/users?code=${encodeURIComponent(code)}`).then((r) => r.json())),
        );
        const classSet = new Set<string>();
        childSnaps.forEach((childJson) => {
          if (!childJson?.ok) return;
          const childClasses = Array.isArray(childJson.data?.classes)
            ? (childJson.data.classes as string[]).map((c) => String(c).trim()).filter(Boolean)
            : [];
          childClasses.forEach((cls) => classSet.add(cls));
        });
        if (classSet.size) setUserClasses(Array.from(classSet));
      } catch {
        // ignore
      }
    }
    hydrateClasses();
  }, [userCode]);

  useEffect(() => {
    async function loadClasses() {
      try {
        const res = await fetch("/api/classes");
        const json = await res.json();
        if (res.ok && json.ok) {
          setClasses((json.data as ClassItem[]) ?? []);
        }
      } catch {
        // ignore
      }
    }
    loadClasses();
  }, []);

  const allowedClassOptions = useMemo(() => {
    if (role === "admin") return classes;
    if (userClasses.length) {
      return classes.filter((cls) => userClasses.includes(cls.id));
    }
    return [];
  }, [classes, role, userClasses]);

  const scopeOptions = useMemo(() => {
    const classOptions = allowedClassOptions.map((cls) => ({
      value: `class:${cls.id}`,
      label: cls.name || cls.id,
    }));
    return [...scopeOptionsBase, ...classOptions];
  }, [allowedClassOptions]);

  useEffect(() => {
    if (!role) return;
    if (scope.startsWith("class:")) {
      const classId = scope.split(":")[1] || "";
      if (role !== "admin" && classId && !userClasses.includes(classId)) {
        setScope("school");
      }
    }
  }, [role, scope, userClasses]);

  useEffect(() => {
    async function loadLeaderboard() {
      if (!role) return;
      setLoading(true);
      setError(null);
      try {
        const url = new URL("/api/leaderboard", window.location.origin);
        url.searchParams.set("competition", competition);
        url.searchParams.set("scope", scope);
        const res = await fetch(url.toString());
        const json = (await res.json()) as LeaderboardResponse;
        if (!res.ok || !json.ok) {
          setError(json?.message || "تعذر تحميل لوحة المتصدرين.");
          setItems([]);
          return;
        }
        setItems(json.data?.leaderboard ?? []);
      } catch {
        setError("تعذر تحميل لوحة المتصدرين.");
      } finally {
        setLoading(false);
      }
    }
    loadLeaderboard();
  }, [competition, role, scope]);

  async function handleReset() {
    if (role !== "admin") return;
    const ok = window.confirm("تأكيد إعادة ضبط المنافسة؟ سيتم بدء التنافس من جديد.");
    if (!ok) return;
    setResetting(true);
    try {
      const res = await fetch("/api/leaderboard/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ competition }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(json?.message || "تعذر إعادة الضبط.");
        return;
      }
      setCompetition((prev) => prev);
    } catch {
      setError("تعذر إعادة الضبط.");
    } finally {
      setResetting(false);
    }
  }

  const topThree = items.slice(0, 3);
  const rest = items.slice(3);

  const backHref = useMemo(() => `/portal/${role || "student"}`, [role]);

  return (
    <main className="min-h-screen px-6 pb-24 pt-10">
      <section className="mx-auto w-full max-w-3xl space-y-6">
        <header className="flex items-center justify-between">
          <BackButton fallbackHref={backHref} className="back-btn" />
          <h1 className="app-heading">المتميزين</h1>
          <div className="h-8 w-8" />
        </header>

        <div className="rounded-3xl border border-white/20 bg-white/15 p-5 text-white shadow-[var(--shadow)] backdrop-blur-md">
          <div className="flex flex-wrap items-center gap-2">
            {competitions.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => setCompetition(item.key)}
                className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                  competition === item.key
                    ? "bg-white text-[color:var(--ink)]"
                    : "border border-white/20 text-white/80 hover:bg-white/10"
                }`}
              >
                {item.label}
              </button>
            ))}
            <select
              value={scope}
              onChange={(e) => setScope(e.target.value)}
              className="ml-auto min-w-[180px] rounded-full border border-white/20 bg-white/10 px-3 py-2 text-sm text-white"
            >
              {scopeOptions.map((item) => (
                <option key={item.value} value={item.value} className="text-black">
                  {item.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {error ? <p className="text-sm text-red-200">{error}</p> : null}

        <div className="leaderboard-top-wrap rounded-3xl border border-white/20 bg-white/15 p-6 text-white shadow-[var(--shadow)] backdrop-blur-md">
          {loading ? (
            <div className="grid grid-cols-3 gap-4">
              {Array.from({ length: 3 }).map((_, idx) => (
                <div key={`s-${idx}`} className="h-32 rounded-2xl bg-white/10 animate-pulse" />
              ))}
            </div>
          ) : topThree.length === 0 ? (
            <p className="text-center text-sm text-white/70">لا توجد بيانات بعد.</p>
          ) : (
            <div className="grid grid-cols-3 gap-4">
              {[1, 0, 2].map((posIndex, slot) => {
                const item = topThree[posIndex];
                if (!item) return <div key={`empty-${slot}`} />;
                const isFirst = posIndex === 0;
                const ordinal = isFirst ? "1st" : posIndex === 1 ? "2nd" : "3rd";
                return (
                <div
                  key={item.code}
                  className={`leaderboard-top flex flex-col items-center justify-center rounded-2xl border px-3 py-4 text-center ${
                    isFirst
                      ? "leaderboard-top-1 leaderboard-top-center"
                      : posIndex === 1
                      ? "leaderboard-top-2"
                      : "leaderboard-top-3"
                  }`}
                >
                  <span className="leaderboard-rank-tag">{ordinal}</span>
                  {isFirst ? <span className="leaderboard-sparkles" aria-hidden="true" /> : null}
                  <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-full border-2 border-white/40 bg-white/10">
                    {item.profilePhoto ? (
                      <img src={item.profilePhoto} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <span className="text-2xl">👤</span>
                    )}
                  </div>
                  <p className="mt-2 text-sm font-semibold">{item.name || "طالب"}</p>
                  <p className="text-[10px] text-white/70">{item.className || item.classId}</p>
                  <p className="mt-1 text-sm font-semibold text-[color:var(--accent)]">
                    {competition === "katamars" ? item.score : `${item.score.toFixed(2)}%`}
                  </p>
                </div>
              );})}
            </div>
          )}
        </div>

        <div className="rounded-3xl border border-white/20 bg-white/15 p-6 text-white shadow-[var(--shadow)] backdrop-blur-md">
          {loading ? (
            <div className="grid gap-3">
              {Array.from({ length: 5 }).map((_, idx) => (
                <div key={`row-${idx}`} className="h-12 rounded-2xl bg-white/10 animate-pulse" />
              ))}
            </div>
          ) : rest.length === 0 ? (
            <p className="text-center text-sm text-white/70">لا توجد أسماء إضافية.</p>
          ) : (
            <div className="grid gap-3">
              {rest.map((item) => (
                <div
                  key={item.code}
                  className="flex items-center justify-between rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-sm"
                >
                  <div className="flex items-center gap-3">
                    <span className="rounded-full border border-white/30 px-2 py-1 text-xs text-white/80">
                      {item.rank}
                    </span>
                    <div>
                      <p className="font-semibold text-white">{item.name || "طالب"}</p>
                      <p className="text-[10px] text-white/60">{item.className || item.classId}</p>
                    </div>
                  </div>
                  <div className="text-sm font-semibold text-[color:var(--accent)]">
                    {competition === "katamars" ? item.score : `${item.score.toFixed(2)}%`}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
