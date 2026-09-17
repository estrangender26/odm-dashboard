import { Button } from "@/components/ui/button";
import {
  LIFECYCLE_CHIP_CLASS,
  LIFECYCLE_LABELS,
  summarizeStatusing,
  type StatusingActivityInput,
} from "./statusingModel";

type Props = {
  activities: StatusingActivityInput[];
  dataDate?: string | null;
  scheduleOutOfDate?: boolean;
  /** The Data Date control stays admin-only; every role sees the roll-up. */
  isAdmin: boolean;
  dataDateDraft: string;
  onDataDateDraftChange: (value: string) => void;
  onSaveDataDate: () => void;
  savingDataDate?: boolean;
  dataDateError?: string | null;
};

/**
 * Project statusing roll-up: what is not started / in progress / completed,
 * what actually started or finished, how much forecast duration remains and
 * what the remaining schedule forecasts — all as of the stored Data Date.
 *
 * Read-only for every role: this panel reports the recorded facts and never
 * rewrites them. Changing the Data Date is an explicit, admin-only action.
 */
export default function StatusingPanel({
  activities,
  dataDate,
  scheduleOutOfDate,
  isAdmin,
  dataDateDraft,
  onDataDateDraftChange,
  onSaveDataDate,
  savingDataDate,
  dataDateError,
}: Props) {
  const summary = summarizeStatusing(activities, dataDate);
  const tiles: Array<{ label: string; value: string; hint?: string }> = [
    { label: "Not started", value: String(summary.notStarted) },
    { label: "In progress", value: String(summary.inProgress) },
    { label: "Completed", value: String(summary.completed) },
    { label: "Actually started", value: String(summary.actualStarted) },
    {
      label: "Actually finished",
      value: String(summary.actualFinished),
      hint: summary.latestActualFinish ? `latest ${summary.latestActualFinish}` : undefined,
    },
    {
      label: "Remaining work",
      value: `${summary.totalRemainingDays} ${summary.totalRemainingDays === 1 ? "day" : "days"}`,
      hint: "forecast working days",
    },
    {
      label: "Forecast finish",
      value: summary.forecastFinish ?? "—",
      hint: "remaining work",
    },
    { label: "Project finish", value: summary.projectFinish ?? "—" },
  ];

  return (
    <section aria-label="Progress status" className="rounded border bg-white p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">Progress status</h3>
          <p className="text-xs text-muted-foreground">
            As of Data Date{" "}
            <span className="font-medium text-slate-800" data-testid="statusing-data-date">
              {summary.dataDateIsSet ? summary.dataDate : "not set"}
            </span>
            {!summary.dataDateIsSet && " — the schedule is anchored on the current date until a Data Date is set."}
          </p>
        </div>
        {isAdmin && (
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <label className="text-xs font-medium" htmlFor="project-data-date">
              Data Date
            </label>
            <input
              id="project-data-date"
              type="date"
              value={dataDateDraft}
              onChange={(e) => onDataDateDraftChange(e.target.value)}
              className="h-9 rounded border px-2 text-sm"
              aria-label="Project Data Date"
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={onSaveDataDate}
              disabled={savingDataDate}
            >
              {savingDataDate ? "Saving…" : "Set Data Date"}
            </Button>
            {dataDateError && <span className="text-xs text-red-600">{dataDateError}</span>}
          </div>
        )}
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {tiles.map((tile) => (
          <div key={tile.label} className="min-w-0 rounded border bg-slate-50 p-2" data-testid={`statusing-tile-${tile.label}`}>
            <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{tile.label}</dt>
            <dd className="truncate text-sm font-semibold text-slate-800">{tile.value}</dd>
            {tile.hint && <dd className="truncate text-[11px] text-muted-foreground">{tile.hint}</dd>}
          </div>
        ))}
      </dl>

      <p className="mt-2 text-xs text-muted-foreground" data-testid="statusing-total">
        {summary.total === 1 ? "1 current activity" : `${summary.total} current activities`}
        {summary.actualStarted > 0 && ` · ${summary.actualStarted} with an Actual Start`}
        {summary.actualStarted === 0 && " · nothing has actually started yet"}
      </p>

      {(scheduleOutOfDate || summary.warnings.length > 0) && (
        <ul className="mt-3 space-y-1" aria-label="Statusing notices">
          {scheduleOutOfDate && (
            <li className="rounded bg-amber-50 p-2 text-xs text-amber-800">
              Schedule is out of date — recalculate the schedule before trusting the forecast.
            </li>
          )}
          {summary.warnings.map((warning) => (
            <li
              key={warning.code}
              data-testid={`statusing-warning-${warning.code}`}
              className="rounded bg-amber-50 p-2 text-xs text-amber-800"
            >
              {warning.message}
            </li>
          ))}
        </ul>
      )}

      <p className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
        <span className={`rounded border px-1.5 py-0.5 ${LIFECYCLE_CHIP_CLASS["not-started"]}`}>{LIFECYCLE_LABELS["not-started"]}</span>
        <span className={`rounded border px-1.5 py-0.5 ${LIFECYCLE_CHIP_CLASS["in-progress"]}`}>{LIFECYCLE_LABELS["in-progress"]}</span>
        <span className={`rounded border px-1.5 py-0.5 ${LIFECYCLE_CHIP_CLASS.completed}`}>{LIFECYCLE_LABELS.completed}</span>
        <span>Status is derived from Actual Start / Actual Finish / % complete — not stored by hand.</span>
      </p>
    </section>
  );
}
