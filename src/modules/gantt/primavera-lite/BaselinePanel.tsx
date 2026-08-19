import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate } from "./activityGridModel";

type Props = {
  slug: string;
  access: string;
  role: "admin" | "editor" | "viewer";
  expectedRevision: number;
  onRevisionChange: (revision: number) => void;
  onRefresh: () => Promise<unknown> | void;
};

type ComparisonRow = {
  snapshotId: number;
  activityId: number;
  activityCode: string | null;
  activityName: string;
  wbsNodeId: number;
  wbsCode: string | null;
  wbsName: string | null;
  calendarId: number | null;
  calendarName: string | null;
  originalDurationDays: number;
  baselineScheduledStart: string | null;
  baselineScheduledFinish: string | null;
  currentScheduledStart: string | null;
  currentScheduledFinish: string | null;
  startVariance: number | null;
  finishVariance: number | null;
  currentArchivedAt: Date | string | null;
  currentMissing: boolean;
};

function varianceBadge(variance: number | null): string {
  if (variance === null) return "—";
  if (variance > 0) return `+${variance}`;
  return String(variance);
}

function varianceClass(variance: number | null): string {
  if (variance === null) return "text-muted-foreground";
  if (variance > 0) return "text-amber-700";
  if (variance < 0) return "text-emerald-700";
  return "text-muted-foreground";
}

export default function BaselinePanel({ slug, access, role, expectedRevision, onRevisionChange, onRefresh }: Props) {
  const isAdmin = role === "admin";
  const [selectedBaselineId, setSelectedBaselineId] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
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
      onRevisionChange(result.revision);
      void onRefresh();
      void listQuery.refetch();
      if (result.baseline) setSelectedBaselineId(result.baseline.id);
    },
    onError: (error) => {
      setCaptureError(error.message);
    },
  });

  function handleCapture(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    captureBaseline.mutate({
      slug,
      access,
      expectedRevision,
      name: name.trim(),
      description: description.trim() || undefined,
    });
  }

  const baselines = listQuery.data?.baselines ?? [];
  const comparisons = (compareQuery.data?.comparisons ?? []) as ComparisonRow[];
  const selectedBaseline = baselines.find((b) => b.id === selectedBaselineId) ?? null;

  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle>Baselines</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {isAdmin && (
          <form onSubmit={handleCapture} className="space-y-2 rounded border p-3">
            <div className="text-sm font-medium">Capture new baseline (admin only)</div>
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
            <Button type="submit" disabled={!name.trim() || captureBaseline.isPending}>
              {captureBaseline.isPending ? "Capturing…" : "Capture Baseline"}
            </Button>
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
          <div className="space-y-2">
            <div className="text-sm font-medium">
              Comparison: {selectedBaseline.name}
              {selectedBaseline.capturedAt && (
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  captured {new Date(selectedBaseline.capturedAt).toLocaleString()}
                </span>
              )}
            </div>
            {comparisons.length === 0 ? (
              <div className="text-sm text-muted-foreground">This baseline contains no activities.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b">
                    <tr className="text-left text-muted-foreground">
                      <th className="pb-1 pr-2">Activity</th>
                      <th className="pb-1 pr-2">WBS</th>
                      <th className="pb-1 pr-2">Baseline Start</th>
                      <th className="pb-1 pr-2">Current Start</th>
                      <th className="pb-1 pr-2">Start Variance</th>
                      <th className="pb-1 pr-2">Baseline Finish</th>
                      <th className="pb-1 pr-2">Current Finish</th>
                      <th className="pb-1 pr-2">Finish Variance</th>
                      <th className="pb-1 pr-2">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {comparisons.map((row) => (
                      <tr key={row.snapshotId} className="border-b last:border-0">
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
                        <td className={`py-1 pr-2 font-medium ${varianceClass(row.startVariance)}`}>{varianceBadge(row.startVariance)}</td>
                        <td className="py-1 pr-2">{formatDate(row.baselineScheduledFinish) || "—"}</td>
                        <td className="py-1 pr-2">{formatDate(row.currentScheduledFinish) || "—"}</td>
                        <td className={`py-1 pr-2 font-medium ${varianceClass(row.finishVariance)}`}>{varianceBadge(row.finishVariance)}</td>
                        <td className="py-1 pr-2">
                          {row.currentMissing && <span className="text-xs text-red-600">Missing</span>}
                          {!row.currentMissing && row.currentArchivedAt && (
                            <span className="text-xs text-amber-700">Archived</span>
                          )}
                          {!row.currentMissing && !row.currentArchivedAt && (
                            <span className="text-xs text-emerald-700">Active</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
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
