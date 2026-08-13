import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { SCHEDULE_ROW_HEIGHT, sortActivities, type ActivityGridRow } from "./activityGridModel";
import { dependencyLineGeometry, type DependencyRow } from "./dependencyModel";
import {
  ZOOM_PIXELS_PER_DAY, activityTimelineModel, headerTicks, isMilestone,
  parseTimelineDate, timelinePosition, timelineRange, timelineSpan, type TimelineZoom,
} from "./timelineModel";

type Props = {
  activities: ActivityGridRow[];
  dataDate?: string | null;
  highlightedActivityId?: number | null;
  onActivityHighlight?: (activityId: number | null) => void;
  verticalScrollTop?: number;
  onVerticalScroll?: (scrollTop: number) => void;
  dependencies?: DependencyRow[];
};

export default function Timeline({ activities: input, dataDate, highlightedActivityId, onActivityHighlight, verticalScrollTop, onVerticalScroll, dependencies = [] }: Props) {
  const activities = useMemo(() => sortActivities(input), [input]);
  const [zoom, setZoom] = useState<TimelineZoom>("week");
  const [fitPixelsPerDay, setFitPixelsPerDay] = useState<number | null>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const range = useMemo(() => timelineRange(activities, dataDate), [activities, dataDate]);
  const projectDataDate = useMemo(() => parseTimelineDate(dataDate), [dataDate]);
  const pixelsPerDay = fitPixelsPerDay ?? ZOOM_PIXELS_PER_DAY[zoom];
  const dependencyLines = useMemo(() => range ? dependencyLineGeometry(dependencies, activities, range.start, pixelsPerDay) : [], [dependencies, activities, range, pixelsPerDay]);

  useEffect(() => {
    if (viewportRef.current && verticalScrollTop !== undefined && viewportRef.current.scrollTop !== verticalScrollTop) {
      viewportRef.current.scrollTop = verticalScrollTop;
    }
  }, [verticalScrollTop]);

  function selectZoom(value: TimelineZoom) {
    setZoom(value);
    setFitPixelsPerDay(null);
  }

  function fitProject() {
    if (!range) return;
    const width = viewportRef.current?.clientWidth ?? 800;
    setFitPixelsPerDay(Math.max(1, (width - 8) / range.days));
    viewportRef.current?.scrollTo({ left: 0 });
  }

  return (
    <section className="space-y-3" aria-label="Activity timeline">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-4">
          <div><h3 className="text-sm font-semibold">Timeline</h3><p className="text-xs text-muted-foreground">Read-only schedule dates</p></div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1"><span className="h-2.5 w-4 rounded bg-blue-600"></span> Normal</span>
            <span className="inline-flex items-center gap-1"><span className="h-2.5 w-4 rounded bg-red-600"></span> Critical</span>
            <span className="inline-flex items-center gap-1"><span className="h-2.5 w-4 rounded bg-emerald-600"></span> Actual</span>
            <span className="inline-flex items-center gap-1"><span className="h-2.5 w-4 rounded border border-dashed border-slate-500 bg-slate-100"></span> CPM</span>
            <span className="inline-flex items-center gap-1"><span className="h-2.5 w-4 rounded bg-slate-300"></span> Shaded = % complete</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-1" aria-label="Timeline zoom">
          {(["day", "week", "month", "quarter"] as TimelineZoom[]).map((value) => (
            <Button key={value} type="button" size="sm" variant={zoom === value && fitPixelsPerDay === null ? "default" : "outline"}
              aria-pressed={zoom === value && fitPixelsPerDay === null} onClick={() => selectZoom(value)} className="capitalize">{value}</Button>
          ))}
          <Button type="button" size="sm" variant={fitPixelsPerDay !== null ? "default" : "outline"} onClick={fitProject} disabled={!range}>Fit Project</Button>
        </div>
      </div>
      {!range ? (
        <div className="rounded border bg-white p-8 text-center text-sm text-muted-foreground">No dates</div>
      ) : (
        <div ref={viewportRef} onScroll={(event) => onVerticalScroll?.(event.currentTarget.scrollTop)} className="max-h-[520px] overflow-auto rounded border bg-white" data-testid="timeline-scroll-viewport">
          <div className="relative min-w-full" style={{ width: range.days * pixelsPerDay }}>
            <div className="sticky top-0 z-20 flex h-10 border-b bg-slate-100/95 text-xs" data-testid="timeline-sticky-header">
              {headerTicks(range.start, range.days, zoom).map((tick) => (
                <div key={tick.date.toISOString()} className="shrink-0 border-r px-1 py-2 text-center" style={{ width: tick.spanDays * pixelsPerDay }}>{tick.label}</div>
              ))}
            </div>
            <div className="relative" style={{ height: activities.length * SCHEDULE_ROW_HEIGHT }}>
              <svg className="pointer-events-none absolute inset-0 z-10 h-full w-full overflow-visible" aria-label="Dependency lines">
                <defs><marker id="dependency-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M 0 0 L 8 4 L 0 8 z" fill="currentColor" /></marker></defs>
                {dependencyLines.map((line) => <g key={line.id} aria-label={`${line.type} dependency`} className="text-slate-600">
                  <path d={line.path} fill="none" stroke="currentColor" strokeWidth="1.5" markerEnd="url(#dependency-arrow)" />
                  <circle cx={line.startX} cy={line.startY} r="3" fill="currentColor" />
                  <circle cx={line.endX} cy={line.endY} r="3" fill="white" stroke="currentColor" strokeWidth="1.5" />
                </g>)}
              </svg>
              {activities.map((activity, rowIndex) => {
                const { primary, actual, progress } = activityTimelineModel(activity);
                const isPlanned = primary?.source === "planned";
                const highlighted = highlightedActivityId === activity.id;
                const isCritical = (activity.totalFloatDays ?? 0) <= 0 && activity.earlyStart != null;
                const barKind = isPlanned ? "Planned" : "CPM";
                // Progress is truthful only when a real Actual Finish exists; a
                // 100% activity that is still open is labelled as such.
                const progressLabel = progress.isComplete && !progress.hasActualFinish
                  ? "100% complete (no Actual Finish)"
                  : `${progress.percent}% complete`;
                return (
                  <button key={activity.id} type="button" aria-label={`Highlight ${activity.activityName}`}
                    onMouseEnter={() => onActivityHighlight?.(activity.id)} onMouseLeave={() => onActivityHighlight?.(null)} onFocus={() => onActivityHighlight?.(activity.id)}
                    className={`absolute left-0 w-full border-b text-left transition-colors ${highlighted ? "bg-blue-50" : "hover:bg-slate-50"}`}
                    style={{ top: rowIndex * SCHEDULE_ROW_HEIGHT, height: SCHEDULE_ROW_HEIGHT }}>
                    {primary && (isMilestone(activity, primary.span) ? (
                      /* A milestone stays a diamond whatever its span source; only the fill
                         distinguishes a planned commitment (solid) from CPM output (hollow,
                         dashed). A milestone is never widened into a duration bar. */
                      <span title={`${activity.activityName} milestone${isPlanned ? "" : " (CPM early dates)"}${isCritical ? " (Critical)" : ""}`}
                        aria-label={`${barKind} milestone`}
                        className={`absolute top-3 h-4 w-4 rotate-45 border-2 ${isPlanned
                          ? (isCritical ? "border-red-700 bg-red-500" : "border-blue-700 bg-blue-500")
                          : `border-dashed bg-transparent ${isCritical ? "border-red-600" : "border-slate-500"}`}`}
                        style={{ left: timelinePosition(primary.span.start, range.start, pixelsPerDay) - 8 }} />
                    ) : (
                      /* Planned geometry is exactly Planned Start -> Planned Finish and is never
                         resized by Data Date, % complete or CPM. A CPM-sourced bar is drawn
                         hollow/dashed so it can never read as a planned commitment. */
                      <span title={`${activity.activityName}: ${progressLabel}; ${isPlanned ? "planned" : "CPM early"} dates${isCritical ? ` (Critical, ${activity.totalFloatDays ?? 0}d float)` : ""}`}
                        aria-label={`${barKind} bar, ${progressLabel}`}
                        className={`absolute top-2 h-3 overflow-hidden rounded ${isPlanned
                          ? (isCritical ? "bg-red-600" : "bg-blue-600")
                          : `border border-dashed bg-transparent ${isCritical ? "border-red-600" : "border-slate-500"}`}`}
                        style={{ left: timelinePosition(primary.span.start, range.start, pixelsPerDay), width: timelineSpan(primary.span.start, primary.span.finish, pixelsPerDay) }}>
                        {isPlanned && <span aria-label={progressLabel} className="block h-full bg-white/55" style={{ width: `${progress.percent}%` }} />}
                      </span>
                    ))}
                    {/* Closed actual pair: an exact Actual Start -> Actual Finish bar. */}
                    {actual.kind === "closed" && <span title={`${activity.activityName}: actual dates`} aria-label="Actual bar" className="absolute top-6 h-2 rounded bg-emerald-600"
                      style={{ left: timelinePosition(actual.start, range.start, pixelsPerDay), width: timelineSpan(actual.start, actual.finish, pixelsPerDay) }} />}
                    {/* Open actual: a start marker plus a fading open-ended tail. No closed bar,
                        because no Actual Finish exists to close it with. */}
                    {actual.kind === "open" && (
                      <span title={`${activity.activityName}: actual start ${activity.actualStart} (in progress, no Actual Finish)`}
                        aria-label="Actual start marker, in progress with no Actual Finish"
                        className="absolute top-6 flex h-2 items-center"
                        style={{ left: timelinePosition(actual.start, range.start, pixelsPerDay) }}>
                        <span className="h-2 w-2 rounded-full bg-emerald-600" />
                        <span aria-hidden="true" className="h-1 w-6 rounded-r bg-gradient-to-r from-emerald-600 to-transparent" />
                      </span>
                    )}
                    {/* 100% with no Actual Finish: state is shown as a label, never as a date. */}
                    {progress.isComplete && !progress.hasActualFinish && (
                      <span aria-label="100% complete, no Actual Finish recorded"
                        className="absolute top-5 rounded bg-amber-100 px-1 text-[10px] font-medium text-amber-800"
                        style={{ left: primary ? timelinePosition(primary.span.start, range.start, pixelsPerDay) + timelineSpan(primary.span.start, primary.span.finish, pixelsPerDay) + 4 : 8 }}>
                        100% · no Actual Finish
                      </span>
                    )}
                    {!primary && actual.kind === "none" && <span className="absolute left-2 top-3 text-xs text-muted-foreground">No dates</span>}
                  </button>
                );
              })}
              {range.today >= range.start && range.today <= range.finish && <div aria-label="Today marker" className="pointer-events-none absolute inset-y-0 z-10 w-px bg-red-500"
                style={{ left: timelinePosition(range.today, range.start, pixelsPerDay) }}><span className="absolute top-0 -translate-x-1/2 bg-red-500 px-1 text-[10px] text-white">Today</span></div>}
              {projectDataDate && projectDataDate >= range.start && projectDataDate <= range.finish && <div aria-label="Project data date marker" className="pointer-events-none absolute inset-y-0 z-10 border-l-2 border-dashed border-violet-600"
                style={{ left: timelinePosition(projectDataDate, range.start, pixelsPerDay) }}><span className="absolute top-3 -translate-x-1/2 bg-violet-600 px-1 text-[10px] text-white">Data date</span></div>}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
