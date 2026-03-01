"use client";

import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export default function TopLogoutButton() {
  const router = useRouter();
  const pathname = usePathname();
  const [ready, setReady] = useState(false);
  const [hasSession, setHasSession] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const stored = window.localStorage.getItem("dsms:user");
    setHasSession(Boolean(stored));
    setReady(true);
  }, [pathname]);

  async function handleLogout() {
    if (loading) return;
    setLoading(true);
    try {
      await fetch("/api/logout", { method: "POST" });
    } finally {
      window.localStorage.removeItem("dsms:user");
      window.localStorage.removeItem("dsms:push");
      router.replace("/login");
      router.refresh();
      setLoading(false);
    }
  }

  if (!ready) return null;
  if (!hasSession) return null;
  if (pathname === "/login" || pathname === "/request-account") return null;

  return (
    <button
      type="button"
      onClick={handleLogout}
      disabled={loading}
      aria-label="تسجيل الخروج"
      className="fixed left-24 top-10 z-[70] flex h-11 w-11 items-center justify-center rounded-full border border-red-500/35 bg-red-600 shadow-lg disabled:opacity-60"
    >
      <Image src="/Logout.png" alt="Logout" width={18} height={18} />
    </button>
  );
}
