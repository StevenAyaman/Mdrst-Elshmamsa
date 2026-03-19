"use client";

import { memo, useMemo, useState } from "react";
import type { AttendanceAnalyticsClass, AttendanceAnalyticsPoint, AttendanceGroup } from "@/hooks/use-attendance-analytics";

type Props = {
  loading: boolean;
  error: string | null;
  points: AttendanceAnalyticsPoint[];
  classes: AttendanceAnalyticsClass[];
  group: AttendanceGroup;
  classId: string;
  startDate: string;
  endDate: string;
  periodName?: string;
  onGroupChange: (value: AttendanceGroup) => void;
  onClassChange: (value: string) => void;
  onStartDateChange: (value: string) => void;
  onEndDateChange: (value: string) => void;
};

type ChartPoint = AttendanceAnalyticsPoint & { x: number; y: number };

function buildSmoothPath(points: ChartPoint[]) {
  if (!points.length) return "";
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
  let path = `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;
  for (let i = 1; i < points.length; i += 1) {
    const prev = points[i - 1];
    const curr = points[i];
    const midX = (prev.x + curr.x) / 2;
    path += ` C ${midX.toFixed(2)} ${prev.y.toFixed(2)}, ${midX.toFixed(2)} ${curr.y.toFixed(2)}, ${curr.x.toFixed(2)} ${curr.y.toFixed(2)}`;
  }
  return path;
}

function AttendanceAnalyticsChartComponent({
  loading,
  error,
  points,
  classes,
  group,
  classId,
  startDate,
  endDate,
  periodName,
  onGroupChange,
  onClassChange,
  onStartDateChange,
  onEndDateChange,
}: Props) {
  const [activePoint, setActivePoint] = useState<ChartPoint | null>(null);

  const scopeOptions = useMemo(() => {
    const classOptions = classes
      .map((item) => ({ value: `class:${item.id}`, label: item.id }))
      .sort((a, b) => a.label.localeCompare(b.label, "en"));
    return [
      { value: "school", label: "المدرسة كلها" },
      { value: "boys", label: "بنين فقط" },
      { value: "girls", label: "بنات فقط" },
      ...classOptions,
    ];
  }, [classes]);

  const selectedScopeValue = group === "class" ? `class:${classId}` : group;

  const model = useMemo(() => {
    const width = 980;
    const height = 330;
    const padLeft = 42;
    const padRight = 26;
    const padTop = 24;
    const padBottom = 66;
    const innerW = width - padLeft - padRight;
    const innerH = height - padTop - padBottom;
    const maxY = Math.max(1, ...points.map((p) => p.count));
    const stepX = points.length > 1 ? innerW / (points.length - 1) : 0;
    const chartPoints: ChartPoint[] = points.map((point, idx) => ({
      ...point,
      x: padLeft + idx * stepX,
      y: padTop + innerH - (point.count / maxY) * innerH,
    }));
    const yTicks = 5;
    const horizontal = Array.from({ length: yTicks + 1 }, (_, idx) => {
      const ratio = idx / yTicks;
      return {
        y: padTop + ratio * innerH,
        value: Math.round((1 - ratio) * maxY),
      };
    });
    const vertical = chartPoints.map((p) => ({ x: p.x, label: p.label }));
    return {
      width,
      height,
      path: buildSmoothPath(chartPoints),
      points: chartPoints,
      horizontal,
      vertical,
    };
  }, [points]);

  return (
    <section className="mt-6 rounded-3xl border border-white/20 bg-white/15 p-6 text-white shadow-[var(--shadow)] backdrop-blur-md">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-lg font-semibold">تحليلات الحضور</p>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={selectedScopeValue}
            onChange={(e) => {
              const value = e.target.value;
              if (value.startsWith("class:")) {
                onGroupChange("class");
                onClassChange(value.slice("class:".length));
                return;
              }
              onGroupChange(value as AttendanceGroup);
              onClassChange("");
            }}
            className="rounded-xl border border-white/25 bg-white/10 px-3 py-2 text-sm text-white"
          >
            {scopeOptions.map((option) => (
              <option key={option.value} value={option.value} className="text-black">
                {option.label}
              </option>
            ))}
          </select>
          {periodName ? (
            <span className="rounded-xl border border-white/25 bg-white/10 px-3 py-2 text-xs text-white/90">
              {periodName}
            </span>
          ) : null}
        </div>
      </div>

      {loading ? <p className="text-sm text-white/80">جار تحميل التحليلات...</p> : null}
      {error ? <p className="text-sm text-red-200">{error}</p> : null}
      {!loading && !error && !points.length ? (
        <p className="text-sm text-white/80">لا توجد بيانات متاحة</p>
      ) : null}

      {!loading && !error && points.length ? (
        <div className="relative overflow-x-auto rounded-2xl border border-white/20 bg-transparent p-3">
          <svg
            viewBox={`0 0 ${model.width} ${model.height}`}
            className="h-[280px] w-[980px] min-w-full"
            role="img"
            aria-label="مخطط تحليلات الحضور"
          >
            <defs>
              <linearGradient id="neon-line-single" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#3bf0ff" />
                <stop offset="100%" stopColor="#a8ffbe" />
              </linearGradient>
              <filter id="line-glow" x="-50%" y="-50%" width="200%" height="200%">
                <feGaussianBlur stdDeviation="2.6" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>

            {model.horizontal.map((tick) => (
              <g key={`h-${tick.y}`}>
                <line
                  x1={42}
                  y1={tick.y}
                  x2={model.width - 26}
                  y2={tick.y}
                  stroke="rgba(255,255,255,0.16)"
                  strokeWidth="1"
                />
                <text x={10} y={tick.y + 4} fontSize="11" fill="rgba(255,255,255,0.75)">
                  {tick.value}
                </text>
              </g>
            ))}

            {model.vertical.map((tick) => (
              <line
                key={`v-${tick.x}`}
                x1={tick.x}
                y1={24}
                x2={tick.x}
                y2={model.height - 66}
                stroke="rgba(255,255,255,0.08)"
                strokeWidth="1"
              />
            ))}

            <path
              d={model.path}
              fill="none"
              stroke="url(#neon-line-single)"
              strokeWidth="3.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              filter="url(#line-glow)"
              style={{ animation: "drawLine 700ms ease-out forwards" }}
            />

            {model.points.map((point) => (
              <g key={`pt-${point.label}-${point.weekNumber}`}>
                <circle
                  cx={point.x}
                  cy={point.y}
                  r="5"
                  fill="#9bffd1"
                  onClick={() => setActivePoint(point)}
                  className="cursor-pointer"
                />
                <text
                  x={point.x}
                  y={model.height - 40}
                  fontSize="11"
                  textAnchor="middle"
                  fill="rgba(255,255,255,0.9)"
                >
                  {point.label}
                </text>
              </g>
            ))}
          </svg>

          {activePoint ? (
            <div
              className="pointer-events-none absolute z-20 w-[220px] rounded-xl border border-cyan-300/30 bg-[#071423]/95 p-3 text-xs text-white shadow-lg"
              style={{
                left: `calc(${(activePoint.x / model.width) * 100}% - 110px)`,
                top: `calc(${(activePoint.y / model.height) * 100}% - 80px)`,
              }}
            >
              <p className="font-semibold">تفاصيل الأسبوع {activePoint.weekNumber}</p>
              <p className="mt-1">عدد الحضور: {activePoint.count}</p>
              <p className="mt-1">من {activePoint.startDate} إلى {activePoint.endDate}</p>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

export const AttendanceAnalyticsChart = memo(AttendanceAnalyticsChartComponent);
