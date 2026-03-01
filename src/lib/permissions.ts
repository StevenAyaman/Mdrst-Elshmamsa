import type { UserRole } from "./types";

export type Permission =
  | "users.manage"
  | "students.manage"
  | "teachers.manage"
  | "parents.manage"
  | "academics.manage"
  | "assignments.manage"
  | "grades.manage"
  | "attendance.manage"
  | "behavior.manage"
  | "announcements.manage"
  | "reports.view"
  | "settings.manage";

const rolePermissions: Record<UserRole, Permission[]> = {
  admin: [
    "users.manage",
    "students.manage",
    "teachers.manage",
    "parents.manage",
    "academics.manage",
    "assignments.manage",
    "grades.manage",
    "attendance.manage",
    "behavior.manage",
    "announcements.manage",
    "reports.view",
    "settings.manage",
  ],
  system: [
    "users.manage",
    "students.manage",
    "teachers.manage",
    "parents.manage",
    "academics.manage",
    "assignments.manage",
    "grades.manage",
    "attendance.manage",
    "behavior.manage",
    "announcements.manage",
    "reports.view",
    "settings.manage",
  ],
  nzam: ["attendance.manage", "behavior.manage"],
  teacher: [
    "assignments.manage",
    "grades.manage",
    "attendance.manage",
    "behavior.manage",
    "announcements.manage",
  ],
  notes: ["behavior.manage", "announcements.manage"],
  parent: ["reports.view"],
  student: [],
};

export function hasPermission(role: UserRole, permission: Permission) {
  return rolePermissions[role]?.includes(permission) ?? false;
}
