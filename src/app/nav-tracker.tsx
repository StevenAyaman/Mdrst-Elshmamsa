"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

export default function NavTracker() {
  const pathname = usePathname();
  const [progressVisible, setProgressVisible] = useState(false);
  const [progressPhase, setProgressPhase] = useState<"start" | "done">("start");
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!pathname.startsWith("/portal")) return;
    const encoded = encodeURIComponent(pathname);
    document.cookie = `dsms_last_path=${encoded}; Path=/; Max-Age=${60 * 60 * 24 * 30}`;
  }, [pathname]);

  useEffect(() => {
    if (!pathname.startsWith("/portal")) return;
    if (!progressVisible) return;
    // Schedule state updates asynchronously to avoid sync setState in effect body.
    const enterId = window.setTimeout(() => setProgressPhase("done"), 16);
    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
    }
    timerRef.current = window.setTimeout(() => {
      setProgressVisible(false);
      setProgressPhase("start");
    }, 260);
    return () => {
      window.clearTimeout(enterId);
      if (timerRef.current) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [pathname, progressVisible]);

  useEffect(() => {
    function handleClick() {
      // Allow any in-app navigation triggered by UI interactions.
      document.cookie = "dsms_allow_nav=1; Path=/; Max-Age=10";
      setProgressVisible(true);
      setProgressPhase("start");
    }
    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, []);

  if (!progressVisible) return null;

  return (
    <div
      className={`pointer-events-none fixed top-0 left-0 z-[95] h-[3px] bg-[color:var(--accent)] shadow-[0_0_10px_rgba(201,166,107,0.55)] transition-all duration-200 ease-in-out ${
        progressPhase === "done" ? "w-full opacity-0" : "w-4/5 opacity-100"
      }`}
      aria-hidden="true"
    />
  );
}
