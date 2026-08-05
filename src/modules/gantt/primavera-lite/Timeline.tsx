import { useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { sortActivities, type ActivityGridRow } from "./activityGridModel";
import {
  ZOOM_PIXELS_PER_DAY, actualDates, headerTicks, isMilestone, plannedDates,
  parseTimelineDate, timelinePosition, timelineRange, timelineSpan, type TimelineZoom,
} from "./timelineModel";

type Props = {
  activities: ActivityGridRow[];
  dataDate?: string | null;
  highlightedActivityId?: number | null;
  onActivityHighlight?: (activityId: number | null) => void;
};

const ROW_HEIGHT = 40;

export default function Timeline({ activities: input, dataDate, highlightedActivityId, onActivityHighlight }: Props) {
  const activities = useMemo(() => sortActivities(input), [input]);
  const [zoom, setZoom] = useState<TimelineZoom>("week");
  const [fitPixelsPerDay, setFitPixelsPerDay] = useState<number | null>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const range = useMemo(() => timelineRange(activities, dataDate), [activities, dataDate]);
  const projectDataDate = useMemo(() => parseTimelineDate(dataDate), [dataDate]);
  const pixelsPerDay = fitPixelsPerDay ?? ZOOM_PIXELS_PER_DAY[zoom];

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
        <div><h3 className="text-sm font-semibold">Timeline</h3><p className="text-xs text-muted-foreground">Read-only schedule dates</p></div>
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
        <div ref={viewportRef} className="max-h-[520px] overflow-auto rounded border bg-white" data-testid="timeline-scroll-viewport">
          <div className="relative min-w-full" style={{ width: range.days * pixelsPerDay }}>
            <div className="sticky top-0 z-20 flex h-10 border-b bg-slate-100/95 text-xs" data-testid="timeline-sticky-header">
              {headerTicks(range.start, range.days, zoom).map((tick) => (
                <div key={tick.date.toISOString()} className="shrink-0 border-r px-1 py-2 text-center" style={{ width: tick.spanDays * pixelsPerDay }}>{tick.label}</div>
              ))}
            </div>
            <div className="relative" style={{ height: activities.length * ROW_HEIGHT }}>
              {activities.map((activity, rowIndex) => {
                const planned = plannedDates(activity);
                const actual = actualDates(activity);
                const highlighted = highlightedActivityId === activity.id;
                return (
                  <button key={activity.id} type="button" aria-label={`Highlight ${activity.activityName}`}
                    onMouseEnter={() => onActivityHighlight?.(activity.id)} onMouseLeave={() => onActivityHighlight?.(null)} onFocus={() => onActivityHighlight?.(activity.id)}
                    className={`absolute left-0 w-full border-b text-left transition-colors ${highlighted ? "bg-blue-50" : "hover:bg-slate-50"}`}
                    style={{ top: rowIndex * ROW_HEIGHT, height: ROW_HEIGHT }}>
                    {planned && (isMilestone(activity) ? (
                      <span title={`${activity.activityName} milestone`} aria-label="Planned milestone" className="absolute top-3 h-4 w-4 rotate-45 border-2 border-blue-700 bg-blue-500"
                        style={{ left: timelinePosition(planned.start, range.start, pixelsPerDay) - 8 }} />
                    ) : (
                      <span title={`${activity.activityName}: ${planned.source} dates`} aria-label="Planned bar" className="absolute top-2 h-3 rounded bg-blue-600"
                        style={{ left: timelinePosition(planned.start, range.start, pixelsPerDay), width: timelineSpan(planned.start, planned.finish, pixelsPerDay) }} />
                    ))}
                    {actual && <span title={`${activity.activityName}: actual dates`} aria-label="Actual bar" className="absolute top-6 h-2 rounded bg-emerald-600"
                      style={{ left: timelinePosition(actual.start, range.start, pixelsPerDay), width: timelineSpan(actual.start, actual.finish, pixelsPerDay) }} />}
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
