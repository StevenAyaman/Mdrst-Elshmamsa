"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

export default function NavTracker() {
  const pathname = usePathname();

  useEffect(() => {
    if (!pathname.startsWith("/portal")) return;
    const encoded = encodeURIComponent(pathname);
    document.cookie = `dsms_last_path=${encoded}; Path=/; Max-Age=${60 * 60 * 24 * 30}`;
  }, [pathname]);

  useEffect(() => {
    function handleClick() {
      // Allow any in-app navigation triggered by UI interactions.
      document.cookie = "dsms_allow_nav=1; Path=/; Max-Age=10";
    }
    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, []);

  return null;
}
