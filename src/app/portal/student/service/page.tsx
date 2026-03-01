"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

const MASS_OPTIONS = [
  "قداس الجمعة الاول",
  "قداس الجمعة الثاني",
  "قداس السبت الاول",
  "قداس السبت الثاني",
  "قداس الاحد الاول",
  "قداس الاحد الثاني",
  "قداس الثلاثاء",
];

const SERVICE_OPTIONS = ["خدمة مذبح", "خدمة القرائات"];
const RANK_OPTIONS = ["ابصالتس", "اغنسطس", "ابيدياكون", "دياكون"];

function isRememberChoice(value: string) {
  return value === "لا اتذكر";
}

export default function StudentServicePreferencePage() {
  const router = useRouter();
  const [isMandatoryFlow, setIsMandatoryFlow] = useState(false);
  const [preferredMass, setPreferredMass] = useState("");
  const [preferredService, setPreferredService] = useState("");
  const [lastServiceType, setLastServiceType] = useState("");
  const [currentRank, setCurrentRank] = useState("");
  const [ordinationDateMode, setOrdinationDateMode] = useState<"date" | "unknown">("date");
  const [ordinationDate, setOrdinationDate] = useState("");
  const [ordinationChurch, setOrdinationChurch] = useState("");
  const [ordainedBy, setOrdainedBy] = useState("");
  const [lastServiceDateMode, setLastServiceDateMode] = useState<"date" | "unknown">("date");
  const [lastServiceDate, setLastServiceDate] = useState("");
  const [requiresService, setRequiresService] = useState(true);
  const [requiresExtraFields, setRequiresExtraFields] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    const stored = window.localStorage.getItem("dsms:user");
    if (!stored) {
      router.replace("/login");
      return;
    }
    try {
      const user = JSON.parse(stored) as { role?: string; needsServicePref?: boolean };
      if (user.role !== "student") {
        router.replace(`/portal/${user.role ?? "student"}`);
        return;
      }
      setIsMandatoryFlow(Boolean(user.needsServicePref));
    } catch {
      router.replace("/login");
      return;
    }

    async function loadCurrentPreferences() {
      try {
        setLoading(true);
        setError(null);
        const res = await fetch("/api/student-preferences");
        const json = await res.json();
        if (!res.ok || !json.ok) {
          setError(json?.message || "تعذر تحميل البيانات.");
          return;
        }
        setPreferredMass(String(json.data?.preferredMass ?? ""));
        setPreferredService(String(json.data?.preferredService ?? ""));
        setLastServiceType(String(json.data?.lastServiceType ?? ""));
        setCurrentRank(String(json.data?.currentRank ?? ""));
        const loadedOrdinationDate = String(json.data?.ordinationDate ?? "");
        if (isRememberChoice(loadedOrdinationDate)) {
          setOrdinationDateMode("unknown");
          setOrdinationDate("");
        } else {
          setOrdinationDateMode("date");
          setOrdinationDate(loadedOrdinationDate);
        }
        setOrdinationChurch(String(json.data?.ordinationChurch ?? ""));
        setOrdainedBy(String(json.data?.ordainedBy ?? ""));
        const loadedLastServiceDate = String(json.data?.lastServiceDate ?? "");
        if (isRememberChoice(loadedLastServiceDate)) {
          setLastServiceDateMode("unknown");
          setLastServiceDate("");
        } else {
          setLastServiceDateMode("date");
          setLastServiceDate(loadedLastServiceDate);
        }
        setRequiresService(Boolean(json.data?.requiresService ?? true));
        setRequiresExtraFields(Boolean(json.data?.requiresExtraFields ?? false));
      } catch {
        setError("تعذر تحميل البيانات.");
      } finally {
        setLoading(false);
      }
    }
    loadCurrentPreferences();
  }, [router]);

  async function savePreferences(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setError(null);
    setSuccess(null);

    if (!preferredMass || (requiresService && !preferredService)) {
      setError(requiresService ? "اختر القداس والخدمة أولاً." : "اختر القداس أولاً.");
      return;
    }

    if (requiresExtraFields && !currentRank) {
      setError("اختر الرتبة الحالية.");
      return;
    }
    if (requiresExtraFields && !lastServiceType) {
      setError("اختر نوع آخر خدمة.");
      return;
    }
    if (requiresExtraFields && !ordinationChurch.trim()) {
      setError("اكتب كنيسة الرسامة.");
      return;
    }
    if (requiresExtraFields && !ordainedBy.trim()) {
      setError("اكتب على يد من تمت الرسامة.");
      return;
    }
    if (requiresExtraFields && ordinationDateMode === "date" && !ordinationDate) {
      setError("اختر تاريخ الرسامة أو الترقية.");
      return;
    }
    if (requiresExtraFields && lastServiceDateMode === "date" && !lastServiceDate) {
      setError("اختر تاريخ آخر خدمة.");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/student-preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          preferredMass,
          preferredService: requiresService ? preferredService : "",
          lastServiceType: requiresExtraFields ? lastServiceType : "",
          currentRank: requiresExtraFields ? currentRank : "",
          ordinationDate: requiresExtraFields
            ? (ordinationDateMode === "unknown" ? "لا اتذكر" : ordinationDate)
            : "",
          ordinationChurch: requiresExtraFields ? ordinationChurch.trim() : "",
          ordainedBy: requiresExtraFields ? ordainedBy.trim() : "",
          lastServiceDate: requiresExtraFields
            ? (lastServiceDateMode === "unknown" ? "لا اتذكر" : lastServiceDate)
            : "",
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(json?.message || "تعذر حفظ البيانات.");
        return;
      }
      setSuccess("تم حفظ الاختيارات بنجاح.");
      const stored = window.localStorage.getItem("dsms:user");
      if (stored) {
        try {
          const parsed = JSON.parse(stored) as Record<string, unknown>;
          parsed.needsServicePref = false;
          window.localStorage.setItem("dsms:user", JSON.stringify(parsed));
        } catch {
          // ignore
        }
      }
      router.replace("/portal/student");
    } catch {
      setError("تعذر حفظ البيانات.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="min-h-screen px-6 pb-24 pt-10">
      {!isMandatoryFlow ? (
        <button
          type="button"
          onClick={() => router.back()}
          className="back-btn"
          aria-label="رجوع"
        >
          رجوع
        </button>
      ) : null}

      <div className="mx-auto w-full max-w-3xl">
        <header className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="app-heading mt-2">اختيار خدمة القداس</h1>
            <p className="mt-1 text-sm text-white/80">يمكنك تغيير هذه الاختيارات لاحقاً في اي وقت .</p>
          </div>
        </header>

        <section className="rounded-3xl border border-white/20 bg-white/15 p-6 text-white shadow-[var(--shadow)] backdrop-blur-md">
          {loading ? <p className="text-sm text-white/80">جار التحميل...</p> : null}
          {!loading ? (
            <form onSubmit={savePreferences} className="grid gap-4">
              <div className="grid gap-2">
                <label className="text-sm text-white/90">القداس المفضل</label>
                <select
                  className="rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-sm text-white"
                  value={preferredMass}
                  onChange={(e) => setPreferredMass(e.target.value)}
                >
                  <option value="" className="text-black">
                    اختر القداس
                  </option>
                  {MASS_OPTIONS.map((item) => (
                    <option key={item} value={item} className="text-black">
                      {item}
                    </option>
                  ))}
                </select>
              </div>

              {requiresService ? (
                <div className="grid gap-2">
                  <label className="text-sm text-white/90">الخدمة المفضلة</label>
                  <select
                    className="rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-sm text-white"
                    value={preferredService}
                    onChange={(e) => setPreferredService(e.target.value)}
                  >
                    <option value="" className="text-black">
                      اختر الخدمة
                    </option>
                    {SERVICE_OPTIONS.map((item) => (
                      <option key={item} value={item} className="text-black">
                        {item}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}

              {requiresExtraFields ? (
                <>
                  <div className="grid gap-2">
                    <label className="text-sm text-white/90">الرتبة الحالية</label>
                    <select
                      className="rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-sm text-white"
                      value={currentRank}
                      onChange={(e) => setCurrentRank(e.target.value)}
                    >
                      <option value="" className="text-black">
                        اختر الرتبة
                      </option>
                      {RANK_OPTIONS.map((item) => (
                        <option key={item} value={item} className="text-black">
                          {item}
                        </option>
                      ))}
                    </select>
                  </div>


                  <div className="grid gap-2">
                    <label className="text-sm text-white/90">تاريخ الرسامة أو الترقية</label>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <select
                        className="rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-sm text-white"
                        value={ordinationDateMode}
                        onChange={(e) => setOrdinationDateMode(e.target.value === "unknown" ? "unknown" : "date")}
                      >
                        <option value="date" className="text-black">
                          تاريخ محدد
                        </option>
                        <option value="unknown" className="text-black">
                          لا اتذكر
                        </option>
                      </select>
                      {ordinationDateMode === "date" ? (
                        <input
                          type="date"
                          className="rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-sm text-white"
                          value={ordinationDate}
                          onChange={(e) => setOrdinationDate(e.target.value)}
                        />
                      ) : (
                        <div className="rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-sm text-white/90">
                          لا اتذكر
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="grid gap-2">
                    <label className="text-sm text-white/90">كنيسة الرسامة</label>
                    <input
                      className="rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-sm text-white"
                      placeholder="اكتب اسم الكنيسة التي تمت بها الرسامة الرسامة"
                      value={ordinationChurch}
                      onChange={(e) => setOrdinationChurch(e.target.value)}
                    />
                  </div>

                  <div className="grid gap-2">
                    <label className="text-sm text-white/90">الرسامة كانت على يد من؟</label>
                    <input
                      className="rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-sm text-white"
                      placeholder="اكتب اسم سيدنا من قام بالرسامة"
                      value={ordainedBy}
                      onChange={(e) => setOrdainedBy(e.target.value)}
                    />
                  </div>

                  <div className="grid gap-2">
                    <label className="text-sm text-white/90">نوع آخر خدمة</label>
                    <select
                      className="rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-sm text-white"
                      value={lastServiceType}
                      onChange={(e) => setLastServiceType(e.target.value)}
                    >
                      <option value="" className="text-black">
                        اختر اخر خدمة قمت بها
                      </option>
                      {SERVICE_OPTIONS.map((item) => (
                        <option key={`last-${item}`} value={item} className="text-black">
                          {item}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="grid gap-2">
                    <label className="text-sm text-white/90">تاريخ آخر خدمة</label>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <select
                        className="rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-sm text-white"
                        value={lastServiceDateMode}
                        onChange={(e) => setLastServiceDateMode(e.target.value === "unknown" ? "unknown" : "date")}
                      >
                        <option value="date" className="text-black">
                          تاريخ محدد
                        </option>
                        <option value="unknown" className="text-black">
                          لا اتذكر
                        </option>
                      </select>
                      {lastServiceDateMode === "date" ? (
                        <input
                          type="date"
                          className="rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-sm text-white"
                          value={lastServiceDate}
                          onChange={(e) => setLastServiceDate(e.target.value)}
                        />
                      ) : (
                        <div className="rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-sm text-white/90">
                          لا اتذكر
                        </div>
                      )}
                    </div>
                  </div>
                </>
              ) : null}

              {error ? <p className="text-sm text-red-200">{error}</p> : null}
              {success ? <p className="text-sm text-green-200">{success}</p> : null}

              <button
                type="submit"
                disabled={saving}
                className="w-fit rounded-full bg-[color:var(--accent-2)] px-6 py-3 text-sm font-semibold text-white"
              >
                {saving ? "جار الحفظ..." : "حفظ الاختيارات"}
              </button>
            </form>
          ) : null}
        </section>
      </div>
    </main>
  );
}
