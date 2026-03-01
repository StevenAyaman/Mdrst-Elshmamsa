"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

type StoredUser = {
  name?: string;
  role?: string;
  studentCode?: string;
};

type AlbumItem = {
  id: string;
  title: string;
};

type PhotoItem = {
  id: string;
  fileName: string;
  url: string;
  createdAt: string;
  createdBy?: { name?: string };
};

const manageRoles = new Set(["admin", "teacher", "system"]);

function normalizeRole(role?: string) {
  return role === "nzam" ? "system" : role ?? "";
}

export default function AlbumPhotosPage() {
  const params = useParams<{ albumId: string }>();
  const albumId = params?.albumId ?? "";
  const [user, setUser] = useState<StoredUser | null>(null);
  const [album, setAlbum] = useState<AlbumItem | null>(null);
  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deletingPhotoId, setDeletingPhotoId] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    photoId: string;
    x: number;
    y: number;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

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

  useEffect(() => {
    async function loadAlbum() {
      if (!albumId) return;
      try {
        const res = await fetch(`/api/photo-albums?id=${encodeURIComponent(albumId)}`);
        const json = await res.json();
        if (!res.ok || !json.ok) {
          setError(json?.message || "تعذر تحميل الألبوم.");
          return;
        }
        setAlbum(json.data as AlbumItem);
      } catch {
        setError("تعذر تحميل الألبوم.");
      }
    }
    loadAlbum();
  }, [albumId]);

  useEffect(() => {
    async function loadPhotos() {
      if (!albumId) return;
      try {
        setLoading(true);
        setError(null);
        const res = await fetch(`/api/photo-photos?albumId=${encodeURIComponent(albumId)}`);
        const json = await res.json();
        if (!res.ok || !json.ok) {
          setError(json?.message || "تعذر تحميل الصور.");
          return;
        }
        setPhotos(json.data as PhotoItem[]);
      } catch {
        setError("تعذر تحميل الصور.");
      } finally {
        setLoading(false);
      }
    }
    loadPhotos();
  }, [albumId]);

  async function uploadPhoto(file: File) {
    setUploadError(null);
    if (!canManage) {
      setUploadError("غير مسموح لك برفع صور.");
      return;
    }
    if (!user?.name || !user?.studentCode || !user?.role) {
      setUploadError("لا توجد جلسة مستخدم صالحة.");
      return;
    }
    const formData = new FormData();
    formData.append("albumId", albumId);
    formData.append("role", normalizeRole(user.role));
    formData.append("code", user.studentCode);
    formData.append("name", user.name);
    formData.append("file", file);

    setUploading(true);
    try {
      const res = await fetch("/api/photo-photos", {
        method: "POST",
        body: formData,
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setUploadError(json?.message || "فشل رفع الصورة.");
        return;
      }
      setPhotos((prev) => [json.data as PhotoItem, ...prev]);
    } catch {
      setUploadError("فشل رفع الصورة.");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function handlePickFileClick() {
    if (!canManage || uploading) return;
    fileInputRef.current?.click();
  }

  async function handleFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    await uploadPhoto(file);
  }

  async function handleDeletePhoto(photoId: string) {
    if (!canManage || !user?.studentCode || !user?.role) return;
    setDeleteError(null);
    setDeletingPhotoId(photoId);
    try {
      const res = await fetch("/api/photo-photos", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: photoId,
          role: normalizeRole(user.role),
          code: user.studentCode,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setDeleteError(json?.message || "فشل حذف الصورة.");
        return;
      }
      setPhotos((prev) => prev.filter((photo) => photo.id !== photoId));
    } catch {
      setDeleteError("فشل حذف الصورة.");
    } finally {
      setDeletingPhotoId(null);
      setContextMenu(null);
    }
  }

  useEffect(() => {
    function closeMenu() {
      setContextMenu(null);
    }
    window.addEventListener("click", closeMenu);
    window.addEventListener("scroll", closeMenu, true);
    return () => {
      window.removeEventListener("click", closeMenu);
      window.removeEventListener("scroll", closeMenu, true);
    };
  }, []);

  return (
    <main className="min-h-screen px-6 pb-24 pt-10">
      <div className="mx-auto w-full max-w-5xl">
        <header className="mb-8 flex items-center justify-between">
          <h1 className="app-heading mt-2">{album?.title ?? "الألبوم"}</h1>
          <Link
            href="/portal/photos"
            className="back-btn rounded-full border border-black/10 bg-white px-4 py-2 text-sm font-semibold text-[color:var(--ink)] shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
          >
            رجوع
          </Link>
        </header>

        <section className="rounded-3xl border border-white/20 bg-white/15 p-5 text-white shadow-[var(--shadow)] backdrop-blur-md">
          <div className="flex items-center justify-between">
            <p className="text-lg font-semibold">صور الألبوم</p>
            {canManage ? (
              <button
                type="button"
                onClick={handlePickFileClick}
                disabled={uploading}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-3xl leading-none text-black disabled:opacity-60"
                aria-label="إضافة صورة"
              >
                +
              </button>
            ) : null}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleFilePicked}
          />
          {uploading ? <p className="mt-3 text-sm text-white/85">جار الرفع...</p> : null}
          {uploadError ? <p className="mt-3 text-sm text-red-200">{uploadError}</p> : null}
          {deleteError ? <p className="mt-3 text-sm text-red-200">{deleteError}</p> : null}
        </section>

        {loading ? <p className="mt-4 text-sm text-white/80">جار التحميل...</p> : null}
        {error ? <p className="mt-4 text-sm text-red-200">{error}</p> : null}
        {!loading && !error && photos.length === 0 ? (
          <p className="mt-4 text-sm text-white/80">لا توجد صور بعد.</p>
        ) : null}

        {!loading && !error && photos.length > 0 ? (
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {photos.map((photo) => (
              <button
                key={photo.id}
                type="button"
                onClick={() => setPreviewUrl(photo.url)}
                onContextMenu={(e) => {
                  if (!canManage) return;
                  e.preventDefault();
                  setContextMenu({
                    photoId: photo.id,
                    x: e.clientX,
                    y: e.clientY,
                  });
                }}
                className="group overflow-hidden rounded-3xl border border-white/20 bg-white/10 shadow-[var(--shadow)]"
              >
                <img
                  src={photo.url}
                  alt={photo.fileName}
                  className="h-48 w-full object-cover transition group-hover:scale-105"
                />
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {previewUrl ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
          onClick={() => setPreviewUrl(null)}
        >
          <a
            href={previewUrl}
            download
            className="absolute left-4 top-4 rounded-full bg-white px-3 py-1 text-sm font-semibold text-black"
            onClick={(e) => e.stopPropagation()}
          >
            تحميل
          </a>
          <button
            type="button"
            className="absolute right-4 top-4 rounded-full bg-white px-3 py-1 text-sm font-semibold text-black"
            onClick={() => setPreviewUrl(null)}
          >
            اغلاق
          </button>
          <img
            src={previewUrl}
            alt="معاينة الصورة"
            className="max-h-[90vh] max-w-[95vw] rounded-2xl object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      ) : null}

      {contextMenu ? (
        <div
          className="fixed z-50"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={() => handleDeletePhoto(contextMenu.photoId)}
            disabled={deletingPhotoId === contextMenu.photoId}
            className="rounded-lg border border-red-300 bg-white px-3 py-2 text-sm font-semibold text-red-700 shadow-lg disabled:opacity-60"
          >
            {deletingPhotoId === contextMenu.photoId ? "جار الحذف..." : "حذف"}
          </button>
        </div>
      ) : null}
    </main>
  );
}

