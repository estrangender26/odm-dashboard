import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/providers/trpc";
import { WEEKDAY_LABELS, formatWorkingDays } from "./calendarModel";

export type CalendarException = {
  id: number;
  calendarId: number;
  exceptionDate: string | null;
  isWorking: boolean;
  description: string | null;
};

export type ProjectCalendar = {
  id: number;
  name: string;
  workingDays: number[];
  exceptions?: CalendarException[];
};

export type CalendarPanelActivity = {
  calendarId?: number | null;
  archivedAt?: string | Date | null;
};

export interface CalendarPanelProps {
  slug: string;
  access: string;
  role: "admin" | "editor" | "viewer";
  expectedRevision: number;
  defaultCalendarId: number | null | undefined;
  calendars: ProjectCalendar[];
  activities: CalendarPanelActivity[];
  onRevisionChange: (revision: number) => void;
  onRefresh: () => void;
}

const EMPTY_DAYS = [1, 2, 3, 4, 5];

export default function CalendarPanel(props: CalendarPanelProps) {
  const { slug, access, role, expectedRevision, defaultCalendarId, calendars, activities } = props;
  const canEdit = role === "admin" || role === "editor";
  const isAdmin = role === "admin";

  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDays, setNewDays] = useState<number[]>(EMPTY_DAYS);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editDays, setEditDays] = useState<number[]>(EMPTY_DAYS);
  const [message, setMessage] = useState<string | null>(null);

  const [exceptionCalendarId, setExceptionCalendarId] = useState<number | null>(null);
  const [exDate, setExDate] = useState("");
  const [exWorking, setExWorking] = useState(false);
  const [exDescription, setExDescription] = useState("");
  const [editingExceptionId, setEditingExceptionId] = useState<number | null>(null);

  const usageByCalendar = useMemo(() => {
    const counts = new Map<number, number>();
    for (const activity of activities) {
      if (activity.archivedAt) continue;
      if (activity.calendarId == null) continue;
      counts.set(activity.calendarId, (counts.get(activity.calendarId) ?? 0) + 1);
    }
    return counts;
  }, [activities]);

  const createCalendar = trpc.primaveraLite.createCalendar.useMutation({
    onSuccess: (res) => {
      props.onRevisionChange(res.revision);
      setAdding(false);
      setNewName("");
      setNewDays(EMPTY_DAYS);
      setMessage(null);
      props.onRefresh();
    },
    onError: (err) => setMessage(err.message),
  });
  const updateCalendar = trpc.primaveraLite.updateCalendar.useMutation({
    onSuccess: (res) => {
      props.onRevisionChange(res.revision);
      setEditingId(null);
      setMessage(null);
      props.onRefresh();
    },
    onError: (err) => setMessage(err.message),
  });
  const setDefault = trpc.primaveraLite.setProjectDefaultCalendar.useMutation({
    onSuccess: (res) => {
      props.onRevisionChange(res.revision);
      setMessage(null);
      props.onRefresh();
    },
    onError: (err) => setMessage(err.message),
  });
  const createException = trpc.primaveraLite.createCalendarException.useMutation({
    onSuccess: (res) => {
      props.onRevisionChange(res.revision);
      resetExceptionForm();
      setMessage(null);
      props.onRefresh();
    },
    onError: (err) => setMessage(err.message),
  });
  const updateException = trpc.primaveraLite.updateCalendarException.useMutation({
    onSuccess: (res) => {
      props.onRevisionChange(res.revision);
      resetExceptionForm();
      setMessage(null);
      props.onRefresh();
    },
    onError: (err) => setMessage(err.message),
  });
  const deleteException = trpc.primaveraLite.deleteCalendarException.useMutation({
    onSuccess: (res) => {
      props.onRevisionChange(res.revision);
      setMessage(null);
      props.onRefresh();
    },
    onError: (err) => setMessage(err.message),
  });

  function resetExceptionForm() {
    setExceptionCalendarId(null);
    setEditingExceptionId(null);
    setExDate("");
    setExWorking(false);
    setExDescription("");
  }

  function submitCreate() {
    if (!newName.trim() || newDays.length === 0) return;
    createCalendar.mutate({
      slug,
      access,
      expectedRevision,
      calendar: { name: newName.trim(), workingDays: newDays },
    });
  }

  function startEdit(calendar: ProjectCalendar) {
    setEditingId(calendar.id);
    setEditName(calendar.name);
    setEditDays([...(calendar.workingDays ?? EMPTY_DAYS)]);
  }

  function submitEdit(calendarId: number) {
    if (!editName.trim() || editDays.length === 0) return;
    updateCalendar.mutate({
      slug,
      access,
      expectedRevision,
      calendarId,
      changes: { name: editName.trim(), workingDays: editDays },
    });
  }

  function submitException() {
    if (!exceptionCalendarId || !exDate) return;
    if (editingExceptionId) {
      updateException.mutate({
        slug,
        access,
        expectedRevision,
        exceptionId: editingExceptionId,
        changes: { exceptionDate: exDate, isWorking: exWorking, description: exDescription || null },
      });
      return;
    }
    createException.mutate({
      slug,
      access,
      expectedRevision,
      calendarId: exceptionCalendarId,
      exception: { exceptionDate: exDate, isWorking: exWorking, description: exDescription || null },
    });
  }

  function startEditException(calendarId: number, exception: CalendarException) {
    setExceptionCalendarId(calendarId);
    setEditingExceptionId(exception.id);
    setExDate(exception.exceptionDate ?? "");
    setExWorking(exception.isWorking);
    setExDescription(exception.description ?? "");
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold">Calendars</span>
        {canEdit && (
          <Button variant="outline" size="sm" onClick={() => setAdding((v) => !v)}>
            {adding ? "Cancel" : "Add Calendar"}
          </Button>
        )}
      </div>

      {message && (
        <div role="alert" className="rounded border border-amber-300 bg-amber-50 p-2 text-sm">
          {message}
        </div>
      )}

      {adding && canEdit && (
        <div className="space-y-2 rounded border bg-white p-3">
          <Input
            aria-label="New calendar name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Calendar name"
            className="h-8 text-sm"
          />
          <WeekdayToggles days={newDays} onChange={setNewDays} disabled={false} />
          <Button size="sm" onClick={submitCreate} disabled={createCalendar.isPending || newDays.length === 0}>
            {createCalendar.isPending ? "Saving…" : "Save Calendar"}
          </Button>
        </div>
      )}

      {calendars.length === 0 ? (
        <p className="text-sm text-muted-foreground">No calendars found.</p>
      ) : (
        <div className="space-y-3">
          {calendars.map((calendar) => {
            const isDefault = calendar.id === defaultCalendarId;
            const usage = usageByCalendar.get(calendar.id) ?? 0;
            const isEditing = editingId === calendar.id;
            return (
              <div key={calendar.id} className="rounded border bg-white p-3 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  {isEditing ? (
                    <Input
                      aria-label="Calendar name"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className="h-8 w-56 text-sm"
                    />
                  ) : (
                    <span className="text-sm font-medium">{calendar.name}</span>
                  )}
                  {isDefault && (
                    <span className="rounded bg-slate-200 px-2 py-0.5 text-xs font-semibold">Default</span>
                  )}
                  <span className="text-xs text-muted-foreground">
                    {usage} active {usage === 1 ? "activity" : "activities"}
                  </span>
                </div>

                {isEditing ? (
                  <WeekdayToggles days={editDays} onChange={setEditDays} disabled={false} />
                ) : (
                  <div className="text-xs text-slate-600">{formatWorkingDays(calendar.workingDays)}</div>
                )}

                {canEdit && (
                  <div className="flex flex-wrap gap-2">
                    {isEditing ? (
                      <>
                        <Button size="sm" onClick={() => submitEdit(calendar.id)} disabled={updateCalendar.isPending || editDays.length === 0}>
                          Save
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => setEditingId(null)}>
                          Cancel
                        </Button>
                      </>
                    ) : (
                      <Button size="sm" variant="outline" onClick={() => startEdit(calendar)}>
                        Edit
                      </Button>
                    )}
                    {isAdmin && !isDefault && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setDefault.mutate({ slug, access, expectedRevision, calendarId: calendar.id })}
                        disabled={setDefault.isPending}
                      >
                        Set as Default
                      </Button>
                    )}
                  </div>
                )}

                <div className="space-y-1">
                  <div className="text-xs font-semibold text-slate-500">Exceptions</div>
                  {(calendar.exceptions ?? []).length === 0 && (
                    <p className="text-xs text-muted-foreground">No exceptions.</p>
                  )}
                  {(calendar.exceptions ?? []).map((exception) => (
                    <div key={exception.id} className="flex flex-wrap items-center gap-2 text-xs">
                      <span>{exception.exceptionDate}</span>
                      <span>{exception.isWorking ? "Working" : "Non-working"}</span>
                      <span className="text-muted-foreground">{exception.description}</span>
                      {canEdit && (
                        <>
                          <Button size="sm" variant="ghost" className="h-6 px-2" onClick={() => startEditException(calendar.id, exception)}>
                            Edit exception
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 px-2 text-destructive"
                            onClick={() => deleteException.mutate({ slug, access, expectedRevision, exceptionId: exception.id })}
                          >
                            Delete exception
                          </Button>
                        </>
                      )}
                    </div>
                  ))}
                  {canEdit && exceptionCalendarId === calendar.id && (
                    <div className="flex flex-wrap items-end gap-2 pt-1">
                      <label className="text-xs">
                        Date
                        <input
                          type="date"
                          aria-label="Exception date"
                          value={exDate}
                          onChange={(e) => setExDate(e.target.value)}
                          className="ml-1 h-8 rounded border px-1"
                        />
                      </label>
                      <label className="text-xs flex items-center gap-1">
                        <input type="checkbox" checked={exWorking} onChange={(e) => setExWorking(e.target.checked)} />
                        Working
                      </label>
                      <Input
                        aria-label="Exception description"
                        value={exDescription}
                        onChange={(e) => setExDescription(e.target.value)}
                        placeholder="Description"
                        className="h-8 w-40 text-xs"
                      />
                      <Button size="sm" onClick={submitException} disabled={!exDate}>
                        {editingExceptionId ? "Save exception" : "Save new exception"}
                      </Button>
                      <Button size="sm" variant="outline" onClick={resetExceptionForm}>
                        Cancel
                      </Button>
                    </div>
                  )}
                  {canEdit && exceptionCalendarId !== calendar.id && (
                    <Button size="sm" variant="outline" onClick={() => { resetExceptionForm(); setExceptionCalendarId(calendar.id); }}>
                      Add exception
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function WeekdayToggles({
  days,
  onChange,
  disabled,
}: {
  days: number[];
  onChange: (next: number[]) => void;
  disabled: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="Working weekdays">
      {WEEKDAY_LABELS.map((day) => {
        const checked = days.includes(day.value);
        return (
          <label key={day.value} className="flex items-center gap-1 text-xs">
            <input
              type="checkbox"
              aria-label={day.short}
              disabled={disabled}
              checked={checked}
              onChange={() => {
                const next = checked ? days.filter((d) => d !== day.value) : [...days, day.value];
                onChange(next);
              }}
            />
            {day.short}
          </label>
        );
      })}
    </div>
  );
}
