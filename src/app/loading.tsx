export default function GlobalLoading() {
  return (
    <div className="min-h-screen px-6 py-16">
      <div className="mx-auto flex min-h-[60vh] w-full max-w-3xl flex-col items-center justify-center gap-6 rounded-3xl border border-black/10 bg-white/90 p-10 text-center shadow-[var(--shadow)]">
        <video
          className="h-28 w-28"
          src="/loading.mp4"
          autoPlay
          muted
          loop
          playsInline
          aria-label="تحميل"
        />
        <p className="text-sm text-[color:var(--muted)]">جار التحميل...</p>
      </div>
    </div>
  );
}
