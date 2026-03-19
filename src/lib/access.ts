import type { UserRole } from "./types";

export const accessCodes: Record<UserRole, string> = {
  admin: "1111",
  system: "3333",
  teacher: "2222",
  parent: "4444",
  student: "5555",
  nzam: "3333",
  notes: "6666",
  katamars: "7777",
};

export const roleLabels: Record<UserRole, string> = {
  admin: "مدير",
  system: "مدير النظام",
  teacher: "مدرس",
  parent: "ولي أمر",
  student: "طالب",
  nzam: "نظام",
  notes: "ملاحظات",
  katamars: "قطمارس",
};
