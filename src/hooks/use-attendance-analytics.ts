"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

export type AttendanceGroup = "school" | "boys" | "girls" | "class";

export type AttendanceAnalyticsPoint = {
  weekNumber: number;
  label: string;
  startDate: string;
  endDate: string;
  count: number;
};

export type AttendanceAnalyticsClass = {
  id: string;
  name: string;
};

type ApiResponse = {
  ok: boolean;
  message?: string;
  data?: {
    period: { id: string; name: string; startDate: string; endDate: string } | null;
    classes: AttendanceAnalyticsClass[];
    filter: { group: AttendanceGroup; classId: string; startDate: string; endDate: string };
    points: AttendanceAnalyticsPoint[];
  };
};

type Params = {
  initialStartDate?: string;
  initialEndDate?: string;
};

export function useAttendanceAnalytics(params: Params = {}) {
  const [group, setGroup] = useState<AttendanceGroup>("school");
  const [classId, setClassId] = useState("");
  const [startDate, setStartDate] = useState(params.initialStartDate ?? "");
  const [endDate, setEndDate] = useState(params.initialEndDate ?? "");
  const [classes, setClasses] = useState<AttendanceAnalyticsClass[]>([]);
  const [points, setPoints] = useState<AttendanceAnalyticsPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const query = useMemo(() => {
    const search = new URLSearchParams();
    search.set("group", group);
    if (group === "class" && classId) search.set("classId", classId);
    if (startDate) search.set("startDate", startDate);
    if (endDate) search.set("endDate", endDate);
    return search.toString();
  }, [group, classId, startDate, endDate]);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch(`/api/attendance/analytics?${query}`);
      const json = (await res.json()) as ApiResponse;
      if (!res.ok || !json.ok || !json.data) {
        setError(json.message || "Failed to load analytics.");
        setPoints([]);
        return;
      }
      setClasses(json.data.classes ?? []);
      setPoints(json.data.points ?? []);
      if (!startDate && json.data.filter.startDate) setStartDate(json.data.filter.startDate);
      if (!endDate && json.data.filter.endDate) setEndDate(json.data.filter.endDate);
    } catch {
      setError("Failed to load analytics.");
      setPoints([]);
    } finally {
      setLoading(false);
    }
  }, [query, startDate, endDate]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (group !== "class" && classId) {
      setClassId("");
    }
  }, [group, classId]);

  return {
    group,
    setGroup,
    classId,
    setClassId,
    startDate,
    setStartDate,
    endDate,
    setEndDate,
    classes,
    points,
    loading,
    error,
    reload: load,
  };
}

