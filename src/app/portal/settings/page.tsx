"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import BackButton from "@/app/back-button";

type StoredUser = {
  name?: string;
  role?: string;
  studentCode?: string;
};

export default function SettingsPage() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [profilePhoto, setProfilePhoto] = useState<string | null>(null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [nextPassword, setNextPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [profileName, setProfileName] = useState<string>("");
  const [primaryClass, setPrimaryClass] = useState<string | null>(null);
  const [childrenInfo, setChildrenInfo] = useState<
    Array<{ code: string; name: string; className: string }>
  >([]);
  const [teacherSubjects, setTeacherSubjects] = useState<string[]>([]);

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
    async function loadPhoto() {
      if (typeof window === "undefined") return;
      try {
        const res = await fetch("/api/users/profile-photo");
        const json = await res.json();
        if (res.ok && json.ok) {
          setProfilePhoto(String(json.data?.profilePhoto ?? ""));
        }
      } catch {
        // ignore
      }
    }
    loadPhoto();
  }, []);

  useEffect(() => {
    async function loadProfileClass() {
      if (!storedUser?.studentCode) return;
      try {
        const res = await fetch(`/api/users?code=${encodeURIComponent(storedUser.studentCode)}`);
        const json = await res.json();
        if (res.ok && json.ok) {
          const fullName = String(json.data?.name ?? "").trim();
          if (fullName) {
            setProfileName(fullName);
            try {
              const stored = window.localStorage.getItem("dsms:user");
              if (stored) {
                const parsed = JSON.parse(stored) as StoredUser;
                window.localStorage.setItem(
                  "dsms:user",
                  JSON.stringify({ ...parsed, name: fullName })
                );
              }
            } catch {
              // ignore
            }
          }
          const classes = Array.isArray(json.data?.classes) ? json.data.classes : [];
          setPrimaryClass(classes[0] ? String(classes[0]) : null);
          const subjects = Array.isArray(json.data?.subjects)
            ? json.data.subjects.map((v: string) => String(v).trim()).filter(Boolean)
            : [];
          setTeacherSubjects(subjects);
        }
      } catch {
        // ignore
      }
    }
    loadProfileClass();
  }, [storedUser?.studentCode]);

  useEffect(() => {
    async function loadChildren() {
      if (!storedUser?.studentCode) return;
      if (String(storedUser?.role ?? "").toLowerCase() !== "parent") return;
      try {
        const parentRes = await fetch(
          `/api/users?code=${encodeURIComponent(storedUser.studentCode)}`
        );
        const parentJson = await parentRes.json();
        if (!parentRes.ok || !parentJson.ok) return;
        const childrenCodes = Array.isArray(parentJson.data?.childrenCodes)
          ? parentJson.data.childrenCodes.map((v: string) => String(v).trim()).filter(Boolean)
          : [];
        if (!childrenCodes.length) {
          setChildrenInfo([]);
          return;
        }
        const results = await Promise.all(
          childrenCodes.map(async (childCode: string) => {
            try {
              const res = await fetch(`/api/users?code=${encodeURIComponent(childCode)}`);
              const json = await res.json();
              if (!res.ok || !json.ok) return null;
              const classes = Array.isArray(json.data?.classes) ? json.data.classes : [];
              return {
                code: childCode,
                name: String(json.data?.name ?? ""),
                className: classes[0] ? String(classes[0]) : "-",
              };
            } catch {
              return null;
            }
          })
        );
        setChildrenInfo(results.filter(Boolean) as Array<{
          code: string;
          name: string;
          className: string;
        }>);
      } catch {
        // ignore
      }
    }
    loadChildren();
  }, [storedUser?.role, storedUser?.studentCode]);


  function handlePickPhoto() {
    fileRef.current?.click();
  }

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      if (!result) return;
      setProfilePhoto(result);
      try {
        await fetch("/api/users/profile-photo", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ profilePhoto: result }),
        });
      } catch {
        // ignore
      }
    };
    reader.readAsDataURL(file);
  }

  async function handleChangePassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPasswordError(null);
    setPasswordMessage(null);

    if (!currentPassword || !nextPassword || !confirmPassword) {
      setPasswordError("من فضلك اكتب كل الخانات.");
      return;
    }
    if (nextPassword !== confirmPassword) {
      setPasswordError("الباسورد الجديد غير متطابق.");
      return;
    }
    if (!storedUser?.studentCode || !storedUser?.role) {
      setPasswordError("تعذر تحميل بيانات الحساب.");
      return;
    }

    setSavingPassword(true);
    try {
      const res = await fetch("/api/users/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          actorCode: storedUser.studentCode,
          actorRole: storedUser.role,
          currentPassword,
          nextPassword,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setPasswordError(json.message || "فشل تغيير الباسورد.");
        return;
      }
      setPasswordMessage("تم تغيير الباسورد بنجاح.");
      setCurrentPassword("");
      setNextPassword("");
      setConfirmPassword("");
    } catch {
      setPasswordError("تعذر الاتصال بالسيرفر.");
    } finally {
      setSavingPassword(false);
    }
  }

  const displayName = profileName || storedUser?.name || "غير معروف";
  const displayCode = storedUser?.studentCode ?? "-";
  const roleMap: Record<string, string> = {
    admin: "أدمن",
    system: "خادم نظام",
    nzam: "خادم نظام",
    teacher: "مدرس",
    parent: "ولي أمر",
    student: "طالب",
    notes: "ملاحظات",
    katamars: "قطمارس",
  };
  const displayRole = roleMap[String(storedUser?.role ?? "").toLowerCase()] ?? "-";

  return (
    <main className="min-h-screen px-6 pb-24 pt-10">
      <div className="mx-auto w-full max-w-3xl">
        <header className="mb-8 flex items-center justify-between">
          <h1 className="app-heading mt-2">الإعدادات</h1>
          <BackButton
            type="button"
            className="back-btn rounded-full border border-black/10 bg-white px-4 py-2 text-sm font-semibold text-[color:var(--ink)] shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
          />
        </header>

        <section className="grid gap-4">
          <div className="rounded-3xl border border-white/20 bg-white/15 p-6 text-white shadow-[var(--shadow)] backdrop-blur-md">
            <p className="text-lg font-semibold">حسابي :</p>
            <div className="mt-6 flex flex-col items-center gap-3 text-center">
              <button
                type="button"
                onClick={handlePickPhoto}
                className="flex h-28 w-28 items-center justify-center rounded-full border-2 border-dashed border-white/70 bg-white/10 text-xs text-white/80"
              >
                {profilePhoto ? (
                  <img
                    src={profilePhoto}
                    alt="صورة الحساب"
                    className="h-full w-full rounded-full object-cover"
                  />
                ) : (
                  "اضف صورة"
                )}
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleFileChange}
              />
              <p className="text-lg font-semibold">{displayName}</p>
              <p className="text-sm text-white/80">الكود: {displayCode}</p>
              {String(storedUser?.role ?? "").toLowerCase() === "student" ? (
                <p className="text-sm text-white/80">
                  الفصل: {primaryClass ?? "-"}
                </p>
              ) : null}
              {String(storedUser?.role ?? "").toLowerCase() === "teacher" ? (
                <p className="text-sm text-white/80">
                  المواد: {teacherSubjects.length ? teacherSubjects.join(" - ") : "-"}
                </p>
              ) : null}
              {String(storedUser?.role ?? "").toLowerCase() === "parent" ? (
                <div className="mt-3 w-full max-w-md overflow-hidden rounded-2xl border border-white/30">
                  <div className="grid grid-cols-3 bg-white/20 text-sm font-semibold text-white">
                    <div className="px-3 py-2">اسم الابن</div>
                    <div className="px-3 py-2">الفصل</div>
                    <div className="px-3 py-2">الكود</div>
                  </div>
                  {childrenInfo.length ? (
                    childrenInfo.map((child) => (
                      <div
                        key={child.code}
                        className="grid grid-cols-3 border-t border-white/20 text-sm text-white/90"
                      >
                        <div className="px-3 py-2">{child.name || "-"}</div>
                        <div className="px-3 py-2">{child.className || "-"}</div>
                        <div className="px-3 py-2">{child.code || "-"}</div>
                      </div>
                    ))
                  ) : (
                    <div className="border-t border-white/20 px-3 py-2 text-sm text-white/70">
                      لا يوجد أبناء مسجلين
                    </div>
                  )}
                </div>
              ) : null}
              <p className="text-sm text-white/80">الدور: {displayRole}</p>
            </div>
          </div>

          <div className="rounded-3xl border border-white/20 bg-white/15 p-6 text-white shadow-[var(--shadow)] backdrop-blur-md">
            <p className="text-lg font-semibold">تغيير الباسورد</p>
            <form onSubmit={handleChangePassword} className="mt-4 grid gap-3">
              <input
                type="password"
                className="rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-sm text-white"
                placeholder="الباسورد الحالي"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
              />
              <input
                type="password"
                className="rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-sm text-white"
                placeholder="الباسورد الجديد"
                value={nextPassword}
                onChange={(e) => setNextPassword(e.target.value)}
              />
              <input
                type="password"
                className="rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-sm text-white"
                placeholder="تأكيد الباسورد الجديد"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
              {passwordError ? (
                <p className="text-sm text-red-200">{passwordError}</p>
              ) : null}
              {passwordMessage ? (
                <p className="text-sm text-green-200">{passwordMessage}</p>
              ) : null}
              <button
                type="submit"
                disabled={savingPassword}
                className="rounded-full bg-white px-5 py-2 text-sm font-semibold text-[color:var(--ink)] disabled:opacity-60"
              >
                {savingPassword ? "جارٍ الحفظ..." : "تغيير الباسورد"}
              </button>
            </form>
          </div>

        </section>
      </div>
    </main>
  );
}
