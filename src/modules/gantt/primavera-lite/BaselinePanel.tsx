import { useEffect, useRef, useState } from "react";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate } from "./activityGridModel";
import {
  BASELINE_STATUS_SYMBOLS,
  baselineCapturedDate,
  describeBaselineState,
  selectActiveBaseline,
  type BaselineVarianceStatus,
} from "./baselineVariance";

type Props = {
  slug: string;
  access: string;
  role: "admin" | "editor" | "viewer";
  expectedRevision: number;
  onRevisionChange: (revision: number) => void;
  onRefresh: () => Promise<unknown> | void;
};

type ComparisonRow = {
  snapshotId: number | null;
  activityId: number;
  activityCode: string | null;
  activityName: string;
  wbsNodeId: number | null;
  wbsCode: string | null;
  wbsName: string | null;
  /** Approved (baseline) duration in working days. */
  baselineDurationDays: number | null;
  originalDurationDays?: number | null;
  baselineScheduledStart: string | null;
  baselineScheduledFinish: string | null;
  currentScheduledStart: string | null;
  currentScheduledFinish: string | null;
  currentDurationDays: number | null;
  startVariance: number | null;
  finishVariance: number | null;
  durationVariance: number | null;
  status?: BaselineVarianceStatus;
  statusLabel?: string;
  statusSymbol?: string;
  hasBaseline?: boolean;
  currentArchivedAt: Date | string | null;
  currentMissing: boolean;
};

type ProjectComparison = {
  baselineStart: string | null;
  baselineFinish: string | null;
  currentStart: string | null;
  currentFinish: string | null;
  startVariance: number | null;
  finishVariance: number | null;
  baselineActivityCount: number;
  newSinceBaselineCount: number;
  removedSinceBaselineCount: number;
};

function varianceBadge(variance: number | null): string {
  if (variance === null || variance === undefined) return "—";
  if (variance > 0) return `+${variance}`;
  return String(variance);
}

function varianceClass(variance: number | null): string {
  if (variance === null || variance === undefined) return "text-muted-foreground";
  if (variance > 0) return "text-amber-700";
  if (variance < 0) return "text-emerald-700";
  return "text-muted-foreground";
}

function days(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return `${value} ${value === 1 ? "day" : "days"}`;
}

/**
 * Status text is always explicit. Colour is only ever an addition, never the
 * only signal, so "Ahead" / "On baseline" / "Behind baseline" stay readable
 * without perceiving colour.
 */
function statusText(row: ComparisonRow): string {
  if (row.status === "new-since-baseline") return "New since baseline";
  // An archived or deleted activity is not part of the current schedule. This
  // also covers a payload without an explicit status.
  if (row.status === "removed" || row.currentMissing || row.currentArchivedAt) {
    return row.currentArchivedAt ? "Archived since baseline" : "Removed since baseline";
  }
  if (row.status && row.statusLabel) return row.statusLabel;
  if (row.finishVariance === null || row.finishVariance === undefined) return "No comparable dates";
  if (row.finishVariance > 0) return "Behind baseline";
  if (row.finishVariance < 0) return "Ahead of baseline";
  return "On baseline";
}

function statusSymbol(row: ComparisonRow): string {
  if (row.statusSymbol) return row.statusSymbol;
  if (row.status) return BASELINE_STATUS_SYMBOLS[row.status];
  if (row.currentMissing || row.currentArchivedAt) return BASELINE_STATUS_SYMBOLS.removed;
  if (row.finishVariance === null || row.finishVariance === undefined) {
    return BASELINE_STATUS_SYMBOLS.undated;
  }
  if (row.finishVariance > 0) return BASELINE_STATUS_SYMBOLS.late;
  if (row.finishVariance < 0) return BASELINE_STATUS_SYMBOLS.ahead;
  return BASELINE_STATUS_SYMBOLS["on-baseline"];
}

export default function BaselinePanel({ slug, access, role, expectedRevision, onRevisionChange, onRefresh }: Props) {
  const isAdmin = role === "admin";
  const [selectedBaselineId, setSelectedBaselineId] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [confirmingCapture, setConfirmingCapture] = useState(false);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [compareError, setCompareError] = useState<string | null>(null);

  const listQuery = trpc.primaveraLite.listBaselines.useQuery(
    { slug, access },
    { enabled: !!slug && !!access }
  );

  const compareQuery = trpc.primaveraLite.compareBaseline.useQuery(
    { slug, access, baselineId: selectedBaselineId ?? 0 },
    { enabled: !!slug && !!access && selectedBaselineId !== null }
  );

  const captureBaseline = trpc.primaveraLite.captureBaseline.useMutation({
    onSuccess: (result) => {
      setName("");
      setDescription("");
      setCaptureError(null);
      setConfirmingCapture(false);
      onRevisionChange(result.revision);
      void onRefresh();
      void listQuery.refetch();
      if (result.baseline) setSelectedBaselineId(result.baseline.id);
    },
    onError: (error) => {
      setCaptureError(error.message);
      setConfirmingCapture(false);
    },
  });

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    // Establishing a baseline is a controlled action: the request is only sent
    // after an explicit confirmation step.
    setCaptureError(null);
    setConfirmingCapture(true);
  }

  function handleConfirmCapture() {
    if (!name.trim()) return;
    captureBaseline.mutate({
      slug,
      access,
      expectedRevision,
      name: name.trim(),
      description: description.trim() || undefined,
    });
  }

  // The comparison is derived from the CURRENT schedule, so a project mutation —
  // most importantly Run Schedule, which clears schedule staleness — must not
  // leave a previous comparison, or a previous staleness error, on screen.
  const lastRevisionRef = useRef(expectedRevision);
  const selectedBaselineIdRef = useRef<number | null>(null);
  useEffect(() => {
    selectedBaselineIdRef.current = selectedBaselineId;
  }, [selectedBaselineId]);
  useEffect(() => {
    if (lastRevisionRef.current === expectedRevision) return;
    lastRevisionRef.current = expectedRevision;
    void listQuery.refetch();
    if (selectedBaselineIdRef.current !== null) void compareQuery.refetch();
  }, [expectedRevision, listQuery, compareQuery]);

  const baselines = listQuery.data?.baselines ?? [];
  const comparisons = (compareQuery.data?.comparisons ?? []) as ComparisonRow[];
  const newSinceBaseline = ((compareQuery.data as { newSinceBaseline?: ComparisonRow[] } | undefined)
    ?.newSinceBaseline ?? []) as ComparisonRow[];
  const project =
    ((compareQuery.data as { project?: ProjectComparison } | undefined)?.project as ProjectComparison | undefined) ??
    null;
  const selectedBaseline = baselines.find((b) => b.id === selectedBaselineId) ?? null;

  const activeBaseline = selectActiveBaseline(baselines);
  const baselineState = describeBaselineState(
    activeBaseline
      ? {
          id: activeBaseline.id,
          name: activeBaseline.name,
          capturedAt: activeBaseline.capturedAt,
          capturedByName: (activeBaseline as { capturedByName?: string | null }).capturedByName ?? null,
        }
      : null
  );

  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle>Baselines</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1" data-testid="baseline-state">
          <div className="text-sm font-medium">{baselineState.label}</div>
          <div className="text-xs text-muted-foreground">
            A baseline is the approved reference schedule. Current dates are the schedule&apos;s
            forecast — they are never actuals.
          </div>
          {baselineState.established && (
            <div className="text-xs text-muted-foreground">
              Active baseline: {baselineState.name}
              {baselineState.capturedByName ? ` — captured by ${baselineState.capturedByName}` : ""}
            </div>
          )}
        </div>

        {isAdmin && (
          <form onSubmit={handleSubmit} className="space-y-2 rounded border p-3">
            <div className="text-sm font-medium">
              {baselineState.established ? "Replace baseline (re-baseline) — admin only" : "Establish baseline (admin only)"}
            </div>
            <Input
              placeholder="Baseline name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-label="Baseline name"
              disabled={captureBaseline.isPending}
            />
            <Textarea
              placeholder="Description (optional)"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              aria-label="Baseline description"
              disabled={captureBaseline.isPending}
              rows={2}
            />
            {!confirmingCapture && (
              <Button type="submit" disabled={!name.trim() || captureBaseline.isPending}>
                {baselineState.established ? "Replace Baseline" : "Capture Baseline"}
              </Button>
            )}
            {confirmingCapture && (
              <div
                className="space-y-2 rounded border border-amber-300 bg-amber-50 p-3"
                data-testid="baseline-capture-confirm"
              >
                <div className="text-sm font-medium">
                  Establish “{name.trim()}” as the approved reference schedule?
                </div>
                <div className="text-xs text-muted-foreground">
                  The schedule must already be calculated. This freezes the current forecast as the
                  approved plan used for variance comparison.
                  {baselineState.established &&
                    " Existing baselines are kept as history — nothing is overwritten."}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    onClick={handleConfirmCapture}
                    disabled={captureBaseline.isPending}
                    data-testid="baseline-capture-confirm-button"
                  >
                    {captureBaseline.isPending ? "Capturing…" : "Confirm capture"}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setConfirmingCapture(false)}
                    disabled={captureBaseline.isPending}
                    data-testid="baseline-capture-cancel-button"
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}
            {captureError && <div className="text-xs text-red-600">{captureError}</div>}
          </form>
        )}

        {!isAdmin && baselines.length === 0 && (
          <div className="text-sm text-muted-foreground" data-testid="baseline-empty-state">
            No baselines have been captured yet.
          </div>
        )}

        {baselines.length > 0 && (
          <div className="space-y-2">
            <div className="text-sm font-medium">Select baseline</div>
            <div className="flex flex-wrap gap-2">
              {baselines.map((baseline) => (
                <Button
                  key={baseline.id}
                  type="button"
                  variant={selectedBaselineId === baseline.id ? "default" : "outline"}
                  size="sm"
                  onClick={() => {
                    setSelectedBaselineId(baseline.id);
                    setCompareError(null);
                  }}
                  aria-pressed={selectedBaselineId === baseline.id}
                  data-testid={`baseline-select-${baseline.id}`}
                >
                  {baseline.name}
                  <span className="ml-2 text-xs opacity-70">({baseline.activityCount} activities)</span>
                </Button>
              ))}
            </div>
          </div>
        )}

        {selectedBaselineId !== null && compareQuery.isLoading && (
          <div className="text-sm text-muted-foreground">Loading comparison…</div>
        )}

        {selectedBaseline && !compareQuery.isLoading && (
          <div className="space-y-4">
            <div className="text-sm font-medium">
              Comparison: {selectedBaseline.name}
              {selectedBaseline.capturedAt && (
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  captured {baselineCapturedDate(selectedBaseline.capturedAt) ?? "—"}
                </span>
              )}
            </div>

            {project && (
              <div className="space-y-2" data-testid="baseline-project-comparison">
                <div className="text-sm font-medium">Project</div>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                  <div className="rounded border p-2">
                    <div className="text-xs text-muted-foreground">Baseline Start</div>
                    <div className="text-sm font-medium">{formatDate(project.baselineStart) || "—"}</div>
                  </div>
                  <div className="rounded border p-2">
                    <div className="text-xs text-muted-foreground">Current / Forecast Start</div>
                    <div className="text-sm font-medium">{formatDate(project.currentStart) || "—"}</div>
                  </div>
                  <div className="rounded border p-2">
                    <div className="text-xs text-muted-foreground">Start Variance</div>
                    <div className={`text-sm font-medium ${varianceClass(project.startVariance)}`}>
                      {varianceBadge(project.startVariance)}
                    </div>
                  </div>
                  <div className="rounded border p-2">
                    <div className="text-xs text-muted-foreground">Baseline Finish</div>
                    <div className="text-sm font-medium">{formatDate(project.baselineFinish) || "—"}</div>
                  </div>
                  <div className="rounded border p-2">
                    <div className="text-xs text-muted-foreground">Current / Forecast Finish</div>
                    <div className="text-sm font-medium">{formatDate(project.currentFinish) || "—"}</div>
                  </div>
                  <div className="rounded border p-2">
                    <div className="text-xs text-muted-foreground">Finish Variance</div>
                    <div className={`text-sm font-medium ${varianceClass(project.finishVariance)}`}>
                      {varianceBadge(project.finishVariance)}
                    </div>
                  </div>
                </div>
                <div className="text-xs text-muted-foreground" data-testid="baseline-project-counts">
                  {project.baselineActivityCount} approved{" · "}
                  {project.newSinceBaselineCount} new since baseline{" · "}
                  {project.removedSinceBaselineCount} removed since baseline
                </div>
              </div>
            )}

            {comparisons.length === 0 ? (
              <div className="text-sm text-muted-foreground">This baseline contains no activities.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[900px] text-sm">
                  <thead className="border-b">
                    <tr className="text-left text-muted-foreground">
                      <th className="pb-1 pr-2">Activity</th>
                      <th className="pb-1 pr-2">WBS</th>
                      <th className="pb-1 pr-2">Baseline Start</th>
                      <th className="pb-1 pr-2">Current / Forecast Start</th>
                      <th className="pb-1 pr-2">Start Variance</th>
                      <th className="pb-1 pr-2">Baseline Finish</th>
                      <th className="pb-1 pr-2">Current / Forecast Finish</th>
                      <th className="pb-1 pr-2">Finish Variance</th>
                      <th className="pb-1 pr-2">Baseline Duration</th>
                      <th className="pb-1 pr-2">Current / Forecast Duration</th>
                      <th className="pb-1 pr-2">Duration Variance</th>
                      <th className="pb-1 pr-2">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {comparisons.map((row) => (
                      <tr key={row.snapshotId ?? row.activityId} className="border-b last:border-0">
                        <td className="py-1 pr-2">
                          <div className="font-medium">{row.activityName}</div>
                          {row.activityCode && <div className="text-xs text-muted-foreground">{row.activityCode}</div>}
                        </td>
                        <td className="py-1 pr-2">
                          {row.wbsCode ?? "—"}
                          {row.wbsName && <div className="text-xs text-muted-foreground">{row.wbsName}</div>}
                        </td>
                        <td className="py-1 pr-2">{formatDate(row.baselineScheduledStart) || "—"}</td>
                        <td className="py-1 pr-2">{formatDate(row.currentScheduledStart) || "—"}</td>
                        <td className={`py-1 pr-2 font-medium ${varianceClass(row.startVariance)}`}>
                          {varianceBadge(row.startVariance)}
                        </td>
                        <td className="py-1 pr-2">{formatDate(row.baselineScheduledFinish) || "—"}</td>
                        <td className="py-1 pr-2">{formatDate(row.currentScheduledFinish) || "—"}</td>
                        <td className={`py-1 pr-2 font-medium ${varianceClass(row.finishVariance)}`}>
                          {varianceBadge(row.finishVariance)}
                        </td>
                        <td className="py-1 pr-2">{days(row.baselineDurationDays)}</td>
                        <td className="py-1 pr-2">{days(row.currentDurationDays)}</td>
                        <td className={`py-1 pr-2 font-medium ${varianceClass(row.durationVariance)}`}>
                          {varianceBadge(row.durationVariance)}
                        </td>
                        <td className="py-1 pr-2 text-xs" data-testid={`baseline-status-${row.activityId}`}>
                          {statusSymbol(row)} {statusText(row)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {newSinceBaseline.length > 0 && (
              <div className="space-y-2" data-testid="baseline-new-since">
                <div className="text-sm font-medium">New since baseline ({newSinceBaseline.length})</div>
                <div className="text-xs text-muted-foreground">
                  Added after this baseline was approved, so they have no baseline dates and no
                  variance. They are never given invented baseline values.
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[900px] text-sm">
                    <thead className="border-b">
                      <tr className="text-left text-muted-foreground">
                        <th className="pb-1 pr-2">Activity</th>
                        <th className="pb-1 pr-2">WBS</th>
                        <th className="pb-1 pr-2">Baseline Start</th>
                        <th className="pb-1 pr-2">Current / Forecast Start</th>
                        <th className="pb-1 pr-2">Baseline Finish</th>
                        <th className="pb-1 pr-2">Current / Forecast Finish</th>
                        <th className="pb-1 pr-2">Baseline Duration</th>
                        <th className="pb-1 pr-2">Current / Forecast Duration</th>
                        <th className="pb-1 pr-2">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {newSinceBaseline.map((row) => (
                        <tr key={row.activityId} className="border-b last:border-0">
                          <td className="py-1 pr-2">
                            <div className="font-medium">{row.activityName}</div>
                            {row.activityCode && <div className="text-xs text-muted-foreground">{row.activityCode}</div>}
                          </td>
                          <td className="py-1 pr-2">
                            {row.wbsCode ?? "—"}
                            {row.wbsName && <div className="text-xs text-muted-foreground">{row.wbsName}</div>}
                          </td>
                          <td className="py-1 pr-2 text-muted-foreground">—</td>
                          <td className="py-1 pr-2">{formatDate(row.currentScheduledStart) || "—"}</td>
                          <td className="py-1 pr-2 text-muted-foreground">—</td>
                          <td className="py-1 pr-2">{formatDate(row.currentScheduledFinish) || "—"}</td>
                          <td className="py-1 pr-2 text-muted-foreground">—</td>
                          <td className="py-1 pr-2">{days(row.currentDurationDays)}</td>
                          <td className="py-1 pr-2 text-xs">{statusSymbol(row)} {statusText(row)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {compareError && <div className="text-xs text-red-600">{compareError}</div>}
            {compareQuery.error && !compareError && (
              <div className="text-xs text-red-600">{compareQuery.error.message}</div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
