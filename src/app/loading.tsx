export default function GlobalLoading() {
  return (
    <div className="min-h-screen px-6 py-16">
      <div className="mx-auto flex min-h-[60vh] w-full max-w-3xl flex-col items-center justify-center gap-6 rounded-3xl border border-white/30 bg-white/10 p-10 text-center backdrop-blur-xl shadow-[var(--shadow)]">
        <div className="loading-spinner" aria-label="تحميل" />
        <p className="text-sm text-[color:var(--muted)]">جار التحميل...</p>
        <div className="mt-2 grid w-full max-w-xl gap-3">
          <div className="loading-skeleton h-5 w-2/5" />
          <div className="loading-skeleton h-16 w-full" />
          <div className="loading-skeleton h-16 w-full" />
        </div>
      </div>
    </div>
  );
}
