"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type StoredUser = {
  name?: string;
  role?: string;
  studentCode?: string;
};

type AlbumItem = {
  id: string;
  title: string;
  createdAt: string;
  photoCount: number;
  createdBy?: { name?: string };
};

const manageRoles = new Set(["admin"]);

function normalizeRole(role?: string) {
  return role === "nzam" ? "system" : role ?? "";
}

export default function PhotosPage() {
  const [user, setUser] = useState<StoredUser | null>(null);
  const [albums, setAlbums] = useState<AlbumItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [deletingAlbumId, setDeletingAlbumId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    const stored = window.localStorage.getItem("dsms:user");
    if (!stored) return;
    try {
      setUser(JSON.parse(stored) as StoredUser);
    } catch {
      setUser(null);
    }
  }, []);

  const canManage = manageRoles.has(normalizeRole(user?.role));

  const roleHome = useMemo(() => {
    const role = user?.role ? (user.role === "nzam" ? "system" : user.role) : "student";
    return `/portal/${role}`;
  }, [user?.role]);

  const filteredAlbums = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return albums;
    return albums.filter((album) =>
      String(album.title ?? "").toLowerCase().includes(query)
    );
  }, [albums, searchQuery]);

  useEffect(() => {
    async function loadAlbums() {
      try {
        setLoading(true);
        setError(null);
        const res = await fetch("/api/photo-albums");
        const json = await res.json();
        if (!res.ok || !json.ok) {
          setError(json?.message || "تعذر تحميل الألبومات.");
          return;
        }
        setAlbums(json.data as AlbumItem[]);
      } catch {
        setError("تعذر تحميل الألبومات.");
      } finally {
        setLoading(false);
      }
    }
    loadAlbums();
  }, []);

  async function handleCreateAlbum() {
    if (!canManage || !user?.studentCode || !user?.role || !user?.name) return;
    const cleanTitle = title.trim();
    if (!cleanTitle) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/photo-albums", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: cleanTitle,
          role: normalizeRole(user.role),
          code: user.studentCode,
          name: user.name,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(json?.message || "تعذر إنشاء الألبوم.");
        return;
      }
      setAlbums((prev) => [json.data as AlbumItem, ...prev]);
      setTitle("");
    } catch {
      setError("تعذر إنشاء الألبوم.");
    } finally {
      setCreating(false);
    }
  }

  async function handleDeleteAlbum(id: string) {
    if (!canManage) return;
    setDeletingAlbumId(id);
    setError(null);
    try {
      const res = await fetch("/api/photo-albums", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(json?.message || "تعذر حذف الألبوم.");
        return;
      }
      setAlbums((prev) => prev.filter((album) => album.id !== id));
    } catch {
      setError("تعذر حذف الألبوم.");
    } finally {
      setDeletingAlbumId(null);
    }
  }

  return (
    <main className="min-h-screen px-6 pb-24 pt-10">
      <div className="mx-auto w-full max-w-5xl">
        <header className="mb-8 flex items-center justify-between">
          <h1 className="app-heading mt-2">الصور</h1>
          <Link
            href={roleHome}
            className="back-btn rounded-full border border-black/10 bg-white px-4 py-2 text-sm font-semibold text-[color:var(--ink)] shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
          >
            رجوع
          </Link>
        </header>

        {canManage ? (
          <section className="mb-6 rounded-3xl border border-white/20 bg-white/15 p-5 text-white shadow-[var(--shadow)] backdrop-blur-md">
            <p className="text-lg font-semibold">إضافة ألبوم جديد</p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="اسم الألبوم"
                className="min-w-[200px] flex-1 rounded-2xl border border-white/20 bg-white/10 px-4 py-2 text-sm text-white placeholder:text-white/70"
              />
              <button
                type="button"
                onClick={handleCreateAlbum}
                disabled={creating}
                className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-black disabled:opacity-60"
              >
                {creating ? "جار الإضافة..." : "إضافة الألبوم"}
              </button>
            </div>
          </section>
        ) : null}

        <section className="mb-6 rounded-3xl border border-white/20 bg-white/15 p-5 text-white shadow-[var(--shadow)] backdrop-blur-md">
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="ابحث عن ألبوم بالاسم"
            className="w-full rounded-2xl border border-white/20 bg-white/10 px-4 py-2 text-sm text-white placeholder:text-white/70"
          />
        </section>

        {loading ? <p className="text-sm text-white/80">جار التحميل...</p> : null}
        {error ? <p className="text-sm text-red-200">{error}</p> : null}
        {!loading && !error && filteredAlbums.length === 0 ? (
          <p className="text-sm text-white/80">لا توجد ألبومات بعد.</p>
        ) : null}

        {!loading && !error && filteredAlbums.length > 0 ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filteredAlbums.map((album) => (
              <div
                key={album.id}
                className="rounded-3xl border border-white/20 bg-white/15 p-5 text-white shadow-[var(--shadow)] backdrop-blur-md transition hover:-translate-y-0.5 hover:shadow-lg"
              >
                <Link href={`/portal/photos/${album.id}`} className="block">
                  <p className="text-xl font-semibold">{album.title}</p>
                  <p className="mt-2 text-xs text-white/80">عدد الصور: {album.photoCount}</p>
                  <p className="mt-1 text-xs text-white/70">
                    بواسطة: {album.createdBy?.name ?? "غير معروف"}
                  </p>
                </Link>
                {canManage ? (
                  <button
                    type="button"
                    onClick={() => handleDeleteAlbum(album.id)}
                    disabled={deletingAlbumId === album.id}
                    className="mt-3 rounded-full border border-red-300 bg-white/10 px-3 py-1 text-xs font-semibold text-red-200 disabled:opacity-60"
                  >
                    {deletingAlbumId === album.id ? "جار الحذف..." : "حذف الألبوم"}
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </main>
  );
}

