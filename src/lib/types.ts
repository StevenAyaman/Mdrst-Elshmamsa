export type UserRole =
  | "admin"
  | "system"
  | "teacher"
  | "parent"
  | "student"
  | "nzam"
  | "notes";

export type SystemUser = {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
  active: boolean;
};

export type AcademicYear = {
  id: string;
  name: string;
  level: "primary" | "preparatory" | "secondary";
  active: boolean;
};

export type SchoolClass = {
  id: string;
  academicYearId: string;
  name: string;
  room?: string;
};

export type Subject = {
  id: string;
  name: string;
  active: boolean;
};

export type StudentProfile = {
  id: string;
  userId: string;
  academicYearId: string;
  classId: string;
  parentIds: string[];
  birthDate?: string;
};

export type TeacherProfile = {
  id: string;
  userId: string;
  subjectIds: string[];
  classIds: string[];
};

export type ParentProfile = {
  id: string;
  userId: string;
  studentIds: string[];
};
