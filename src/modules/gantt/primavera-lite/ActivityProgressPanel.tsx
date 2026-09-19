import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatDate } from "./activityGridModel";
import {
  autoActualFinishFromDataDate,
  normalizeIsoDate,
  resolveProgress,
  type ProgressFields,
} from "@lihok/project-controls";
import {
  activityLifecycle,
  forecastRemainingDays,
  LIFECYCLE_CHIP_CLASS,
  LIFECYCLE_LABELS,
} from "@lihok/project-controls";
import type { ActivityGridRow } from "./activityGridModel";

type ProgressChanges = Partial<ProgressFields>;

type Props = {
  activity: ActivityGridRow;
  dataDate?: string | null;
  pending?: boolean;
  error?: string | null;
  onSave: (changes: ProgressChanges) => void;
  onCancel: () => void;
};

/**
 * Focused progress editor for a single activity.
 *
 * Kept deliberately narrow so the ActivityGrid does not have to grow a
 * permanent column for every statusing field. The panel never decides the
 * outcome itself: it previews the decision using the same canonical
 * resolveProgress rules the server applies, then submits only the fields the
 * user actually changed, so the server stays authoritative.
 */
export default function ActivityProgressPanel({
  activity,
  dataDate,
  pending,
  error,
  onSave,
  onCancel,
}: Props) {
  const [draftActualStart, setDraftActualStart] = useState(() => formatDate(activity.actualStart));
  const [draftActualFinish, setDraftActualFinish] = useState(() => formatDate(activity.actualFinish));
  const [draftPercent, setDraftPercent] = useState(() => String(activity.percentComplete ?? 0));
  const [draftRemaining, setDraftRemaining] = useState(() =>
    activity.remainingDurationDays == null ? "" : String(activity.remainingDurationDays)
  );

  /**
   * EMPTY is a distinct editing state from NUMERIC ZERO. An emptied % field is
   * an incomplete required value, never an explicit 0% claim: it contributes no
   * change and blocks Save until the user enters a number — including an
   * explicit 0 when 0% is what they mean. Never infer zero with truthiness.
   */
  const percentDraftEmpty = draftPercent.trim() === "";
  const percentDraftValue = percentDraftEmpty ? null : Number(draftPercent);
  const percentDraftInvalid = percentDraftValue != null && !Number.isFinite(percentDraftValue);

  /** Only changed fields are submitted: untouched fields must never be re-sent
   *  as explicit facts, or the server's contradiction rules would reject an
   *  otherwise valid edit (e.g. re-sending an Actual Finish at < 100%). */
  const changes = useMemo<ProgressChanges>(() => {
    const next: ProgressChanges = {};
    const currentStart = normalizeIsoDate(activity.actualStart);
    const currentFinish = normalizeIsoDate(activity.actualFinish);
    const nextStart = draftActualStart.trim() === "" ? null : draftActualStart.trim();
    const nextFinish = draftActualFinish.trim() === "" ? null : draftActualFinish.trim();
    if (nextStart !== currentStart) next.actualStart = nextStart;
    if (nextFinish !== currentFinish) next.actualFinish = nextFinish;
    if (percentDraftValue != null && Number.isFinite(percentDraftValue) && percentDraftValue !== (activity.percentComplete ?? 0)) {
      next.percentComplete = percentDraftValue;
    }
    const trimmedRemaining = draftRemaining.trim();
    const currentRemaining = activity.remainingDurationDays ?? null;
    if (trimmedRemaining === "") {
      if (currentRemaining != null) next.remainingDurationDays = null;
    } else if (Number(trimmedRemaining) !== currentRemaining) {
      next.remainingDurationDays = Number(trimmedRemaining);
    }
    return next;
  }, [activity, draftActualStart, draftActualFinish, draftPercent, draftRemaining]);

  const dirty = Object.keys(changes).length > 0;

  const currentFields: ProgressFields = {
    percentComplete: activity.percentComplete ?? 0,
    actualStart: normalizeIsoDate(activity.actualStart),
    actualFinish: normalizeIsoDate(activity.actualFinish),
    remainingDurationDays: activity.remainingDurationDays ?? null,
    originalDurationDays: activity.originalDurationDays ?? 0,
    status: activity.status ?? null,
  };

  // Preview uses the exact canonical server rules: the message the user sees
  // before saving is the message the server would return.
  const preview = useMemo(
    () => resolveProgress({ current: currentFields, changes, dataDate: dataDate ?? null, mode: "update" }),
    [currentFields, changes, dataDate]
  );

  // Only the values the resolver decided to change override the stored row;
  // everything else keeps its current value, so the preview always shows the
  // state that saving would produce.
  const resolved = preview.ok && !preview.noop ? (preview.values ?? {}) : {};
  const resolvedPercent = resolved.percentComplete ?? currentFields.percentComplete;
  const resolvedStart = resolved.actualStart !== undefined ? resolved.actualStart : currentFields.actualStart;
  const resolvedFinish = resolved.actualFinish !== undefined ? resolved.actualFinish : currentFields.actualFinish;
  const resolvedRemaining = resolved.remainingDurationDays !== undefined
    ? resolved.remainingDurationDays
    : currentFields.remainingDurationDays;

  const previewLifecycle = activityLifecycle({
    id: activity.id,
    wbsNodeId: activity.wbsNodeId,
    activityName: activity.activityName,
    percentComplete: resolvedPercent,
    actualStart: resolvedStart,
    actualFinish: resolvedFinish,
  });

  // The hint must describe what the SCHEDULE will do, not what the storage
  // helper computes: the engine treats a milestone as zero duration and a
  // not-started activity as its full original duration, so the panel delegates
  // to the same function the ActivityGrid Remaining column and Run Schedule use.
  const derivedRemaining = forecastRemainingDays({
    id: activity.id,
    wbsNodeId: activity.wbsNodeId,
    activityName: activity.activityName,
    activityType: activity.activityType ?? null,
    originalDurationDays: activity.originalDurationDays ?? 0,
    remainingDurationDays: resolvedRemaining ?? undefined,
    percentComplete: resolvedPercent,
    actualStart: resolvedStart,
    actualFinish: resolvedFinish,
  });

  // Completing without a finish is auto-filled from the Data Date by the
  // server; say so up front (and surface the same error when no Data Date
  // exists, instead of inventing today's date).
  const completionHint = useMemo(() => {
    if (resolvedPercent !== 100) return null;
    const storedFinish = normalizeIsoDate(activity.actualFinish);
    if (storedFinish || draftActualFinish.trim() !== "") return "This activity is complete.";
    const auto = autoActualFinishFromDataDate(dataDate ?? null, resolvedStart);
    return auto.ok
      ? `Actual Finish will be recorded as the Data Date (${auto.actualFinish}).`
      : auto.error;
  }, [resolvedPercent, activity.actualFinish, draftActualFinish, dataDate, resolvedStart]);

  const percentEditingError = percentDraftEmpty
    ? "Percent complete is required; enter a whole number from 0 to 100"
    : percentDraftInvalid
      ? "Percent complete must be a whole number from 0 to 100"
      : null;
  const validationError = percentEditingError ?? (!preview.ok ? preview.error : null);
  const canSave = dirty && !validationError && !pending;

  return (
    <section
      aria-label={`Update progress for ${activity.activityName}`}
      className="rounded border bg-white p-3"
      data-testid="activity-progress-panel"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-semibold">
          Update progress — <span className="font-normal">{activity.activityName}</span>
        </h4>
        <span className={`rounded border px-2 py-0.5 text-xs ${LIFECYCLE_CHIP_CLASS[previewLifecycle]}`} data-testid="progress-preview-status">
          {LIFECYCLE_LABELS[previewLifecycle]}
        </span>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="min-w-0">
          <label className="block text-xs font-medium" htmlFor="progress-actual-start">
            Actual Start
          </label>
          <Input
            id="progress-actual-start"
            type="date"
            value={draftActualStart}
            onChange={(e) => setDraftActualStart(e.target.value)}
            aria-label="Actual Start"
          />
        </div>
        <div className="min-w-0">
          <label className="block text-xs font-medium" htmlFor="progress-actual-finish">
            Actual Finish
          </label>
          <Input
            id="progress-actual-finish"
            type="date"
            value={draftActualFinish}
            onChange={(e) => setDraftActualFinish(e.target.value)}
            aria-label="Actual Finish"
          />
          <p className="mt-1 text-[11px] text-muted-foreground">Only for completed work.</p>
        </div>
        <div className="min-w-0">
          <label className="block text-xs font-medium" htmlFor="progress-percent">
            % Complete
          </label>
          <Input
            id="progress-percent"
            type="number"
            min={0}
            max={100}
            step={1}
            value={draftPercent}
            onChange={(e) => setDraftPercent(e.target.value)}
            aria-label="Percent Complete"
          />
        </div>
        <div className="min-w-0">
          <label className="block text-xs font-medium" htmlFor="progress-remaining">
            Remaining duration (days)
          </label>
          <Input
            id="progress-remaining"
            type="number"
            min={0}
            step={1}
            value={draftRemaining}
            placeholder={String(derivedRemaining)}
            onChange={(e) => setDraftRemaining(e.target.value)}
            aria-label="Remaining Duration (days)"
          />
          <p className="mt-1 text-[11px] text-muted-foreground">
            Blank = let the schedule derive it ({derivedRemaining} working day{derivedRemaining === 1 ? "" : "s"} forecast).
          </p>
        </div>
      </div>

      {completionHint && !percentEditingError && (
        <p className="mt-2 text-xs text-muted-foreground">{completionHint}</p>
      )}
      {validationError && (
        <p role="alert" className="mt-2 text-xs text-red-600">
          {validationError}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-2 text-xs text-red-600">
          {error}
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" disabled={!canSave} onClick={() => onSave(changes)}>
          {pending ? "Saving…" : "Save progress"}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <span className="text-[11px] text-muted-foreground">
          Actual Start and Actual Finish are execution facts: recalculation never moves them.
        </span>
      </div>
    </section>
  );
}
