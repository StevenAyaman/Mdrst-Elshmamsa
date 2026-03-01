import LoginForm from "./login-form";
import Link from "next/link";

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-md rounded-3xl border border-white/20 bg-white/12 p-8 text-center text-white shadow-2xl backdrop-blur-md">
        <div className="mx-auto mb-6 flex h-32 w-32 items-center justify-center overflow-hidden rounded-full border border-white/30 bg-white/10 shadow-lg">
          <img
            src="/elmdrsa.jpeg"
            alt="شعار مدرسة الشمامسة"
            className="h-full w-full object-cover"
          />
        </div>
        <h1 className="font-['DecoType_Naskh_Variants'] text-3xl font-normal">
          مدرسة الشمامسة
        </h1>
        <p className="mt-2 text-lg text-white/90 font-['DecoType_Naskh_Variants']">
          كاتدرائية مارمرقس الرسول بالكويت
        </p>

        <div className="mt-8">
          <LoginForm />
        </div>
        <div className="mt-4 text-center">
          <Link
            href="/request-account"
            className="text-sm text-white/90 underline underline-offset-4"
          >
            ليس لديك حساب؟
          </Link>
        </div>
      </div>
    </main>
  );
}
