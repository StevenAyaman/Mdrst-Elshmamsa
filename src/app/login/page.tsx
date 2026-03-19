import LoginForm from "./login-form";
import Link from "next/link";

export default function LoginPage() {
  return (
    <main className="relative flex min-h-screen items-center justify-center px-4 overflow-hidden">
      {/* Decorative animated background elements just for the login page */}
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-[color:var(--accent)]/10 rounded-full blur-[100px] animate-pulse pointer-events-none" style={{ animationDuration: "8s" }} />
      <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-[color:var(--accent-2)]/10 rounded-full blur-[100px] animate-pulse pointer-events-none" style={{ animationDuration: "12s" }} />

      <div className="z-10 w-full max-w-md rounded-3xl glass-panel p-8 text-center text-white">
        <div className="mx-auto mb-8 flex items-center justify-center">
          <img
            src="/COPYRIGHT.png"
            alt="مدرسة الشمامسة"
            className="h-28 w-auto object-contain"
          />
        </div>

        <div className="mt-8">
          <LoginForm />
        </div>
        <div className="mt-6 text-center">
          <Link
            href="/request-account"
            className="inline-block text-sm font-semibold text-[color:var(--accent)]/90 hover:text-[color:var(--accent-glow)] transition-all hover:drop-shadow-[0_0_8px_rgba(226,183,110,0.6)]"
          >
            ليس لديك حساب؟ طلب الانضمام
          </Link>
        </div>
      </div>
    </main>
  );
}
