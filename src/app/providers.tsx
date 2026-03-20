"use client";

import { useEffect, useState } from "react";
import { getToken } from "firebase/messaging";
import { messaging } from "@/lib/firebase/client";

const DEFAULT_LANG = "ar";
const INSTALL_DISMISS_KEY = "dsms:installDismissed";
const PUSH_DONE_KEY = "dsms:push";
const PUSH_TOKEN_KEY = "dsms:pushToken";
const PUSH_USER_KEY = "dsms:pushUserCode";

type StoredUser = { role?: string; studentCode?: string };

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

function shouldAskInstall(): boolean {
  if (typeof window === "undefined") return false;
  const stored = window.localStorage.getItem("dsms:user");
  if (!stored) return false;
  try {
    const user = JSON.parse(stored) as StoredUser;
    const role = String(user.role ?? "").toLowerCase();
    if (role === "admin") return false;
    const isStandalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
    if (isStandalone) return false;
    return window.localStorage.getItem(INSTALL_DISMISS_KEY) !== "done";
  } catch {
    return false;
  }
}

export default function Providers({ children }: { children: React.ReactNode }) {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showInstallBox, setShowInstallBox] = useState(false);

  useEffect(() => {
    const storedLang = window.localStorage.getItem("dsms:lang") || DEFAULT_LANG;
    const lang = storedLang === "en" ? "en" : "ar";
    const storedDir = window.localStorage.getItem("dsms:dir");
    const dir = storedDir === "ltr" ? "ltr" : lang === "ar" ? "rtl" : "ltr";

    document.documentElement.lang = lang;
    document.documentElement.dir = dir;
  }, []);

  useEffect(() => {
    async function registerPush() {
      const stored = window.localStorage.getItem("dsms:user");
      if (!stored) return;

      if (!("Notification" in window)) return;
      if (Notification.permission === "denied") return;

      const permission =
        Notification.permission === "granted"
          ? "granted"
          : await Notification.requestPermission();
      if (permission !== "granted") return;

      let reg: ServiceWorkerRegistration | null = null;
      try {
        reg = await navigator.serviceWorker.register("/firebase-messaging-sw.js");
      } catch {
        return;
      }
      const msg = await messaging;
      if (!msg) return;

      let token = "";
      try {
        token =
          (await getToken(msg, {
            vapidKey:
              "BJuh9aGUeXOlIJV-UGzAwTvedlyCecYCvYtavkPTVlNtgxbUk9_9ShLiGOjHuE0Km3OMQGw9XolVVcwEe5R0XP8",
            serviceWorkerRegistration: reg ?? undefined,
          })) ?? "";
      } catch {
        // Skip push registration silently if token service fails.
        return;
      }

      if (!token) return;
      const storedUser = window.localStorage.getItem("dsms:user");
      const userCode = storedUser ? String((JSON.parse(storedUser) as { studentCode?: string }).studentCode ?? "").trim() : "";
      if (!userCode) return;

      const savedToken = window.localStorage.getItem(PUSH_TOKEN_KEY) ?? "";
      const savedUserCode = window.localStorage.getItem(PUSH_USER_KEY) ?? "";
      const hasRegistered = window.localStorage.getItem(PUSH_DONE_KEY) === "done";
      const shouldRegister = !hasRegistered || savedToken !== token || savedUserCode !== userCode;
      if (!shouldRegister) return;

      try {
        await fetch("/api/push/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token, userCode }),
        });
      } catch {
        return;
      }

      window.localStorage.setItem(PUSH_DONE_KEY, "done");
      window.localStorage.setItem(PUSH_TOKEN_KEY, token);
      window.localStorage.setItem(PUSH_USER_KEY, userCode);
    }

    registerPush();
  }, []);

  useEffect(() => {
    if (!shouldAskInstall()) return;

    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setDeferredPrompt(event as BeforeInstallPromptEvent);
      setShowInstallBox(true);
    };

    const onInstalled = () => {
      setShowInstallBox(false);
      setDeferredPrompt(null);
      window.localStorage.setItem(INSTALL_DISMISS_KEY, "done");
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onInstalled);

    const timer = window.setTimeout(() => {
      setShowInstallBox(true);
    }, 1000);

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onInstalled);
      window.clearTimeout(timer);
    };
  }, []);

  async function handleInstallNow() {
    if (!deferredPrompt) {
      alert("لو iPhone: Share > Add to Home Screen. لو Android: من قائمة المتصفح اختر Add to Home screen.");
      return;
    }
    await deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice;
    if (choice.outcome === "accepted") {
      window.localStorage.setItem(INSTALL_DISMISS_KEY, "done");
      setShowInstallBox(false);
    }
    setDeferredPrompt(null);
  }

  function handleInstallLater() {
    setShowInstallBox(false);
    window.localStorage.setItem(INSTALL_DISMISS_KEY, "done");
  }

  return (
    <>
      {children}
      {showInstallBox && shouldAskInstall() ? (
        <div className="fixed inset-0 z-[999] flex items-center justify-center bg-black/50 px-5">
          <div className="w-full max-w-sm rounded-2xl border border-white/20 bg-white p-4 text-right shadow-xl">
            <div className="mb-3 flex items-center justify-between">
              <img
                src="/Mdrstna.png"
                alt="Mdrstna"
                loading="lazy"
                decoding="async"
                className="h-10 w-10 rounded-lg object-cover"
              />
              <p className="text-sm font-semibold text-black">إضافة للتشغيل من الشاشة الرئيسية</p>
            </div>
            <p className="text-xs text-black/70">
              فضلاً أضف التطبيق للشاشة الرئيسية لاستخدام أسرع وإشعارات أفضل.
            </p>
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={handleInstallLater}
                className="rounded-full border border-black/20 px-3 py-1.5 text-xs font-semibold text-black"
              >
                لاحقًا
              </button>
              <button
                type="button"
                onClick={handleInstallNow}
                className="rounded-full bg-black px-3 py-1.5 text-xs font-semibold text-white"
              >
                إضافة الآن
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
