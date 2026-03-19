import type { UserRole } from "./types";

export function normalizeValue(value: unknown) {
  return String(value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function mapRole(rawRole: unknown): UserRole | null {
  const role = normalizeValue(rawRole);

  if (!role) return null;

  if (["admin", "مدير"].includes(role)) return "admin";
  if (["system", "system admin", "مدير النظام"].includes(role)) return "system";
  if (["nzam", "نزام", "نطام"].includes(role)) return "nzam";
  if (["teacher", "مدرس"].includes(role)) return "teacher";
  if (["notes", "ملاحظات", "تنبيهات"].includes(role)) return "notes";
  if (["katamars", "qatmaros", "qatmars", "قطمارس"].includes(role)) return "katamars";
  if (["parent", "ولي امر", "ولي أمر", "وليالامر"].includes(role)) return "parent";
  if (["student", "طالب"].includes(role)) return "student";

  return null;
}
