"use client";

import { useRouter } from "next/navigation";
import { useCallback } from "react";

type BackButtonProps = {
  fallbackHref?: string;
  className?: string;
  label?: string;
  ariaLabel?: string;
};

export default function BackButton({
  fallbackHref = "/",
  className,
  label = "رجوع",
  ariaLabel,
}: BackButtonProps) {
  const router = useRouter();

  const handleClick = useCallback(() => {
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
      return;
    }
    router.push(fallbackHref);
  }, [fallbackHref, router]);

  return (
    <button type="button" onClick={handleClick} className={className} aria-label={ariaLabel ?? label}>
      {label}
    </button>
  );
}
