import { useEffect, useMemo, useRef, useState } from "react";
import { Archive, GripVertical, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/providers/trpc";
import {
  activityGridPermissions, formatDate, isActivityEditNoop, optimisticActivityArchive, optimisticActivityEdit, optimisticActivityReorder,
  preserveConflictAttempt, selectValidNewWbs, sortActivities, validateActivityEdit, validateDatePair,
  SCHEDULE_ROW_HEIGHT, type ActivityGridRow, type ConflictRecovery,
} from "./activityGridModel";

type WbsNode = { id: number; code: string; name: string; isLeaf: boolean; archivedAt?: string | Date | null };
type Calendar = { id: number; name: string };
type MutationError = { message: string; data?: { code?: string } | null; shape?: { data?: { code?: string } | null } | null };

const dateFieldNames = ["plannedStart", "plannedFinish", "actualStart", "actualFinish"] as const;

type EditableTextField = "activityId" | "activityName";
type EditableNumericField = "wbsNodeId" | "originalDurationDays" | "percentComplete";
type EditableDateField = (typeof dateFieldNames)[number];

function isDateFieldName(field: string): field is EditableDateField {
  return (dateFieldNames as readonly string[]).includes(field);
}

type Props = {
  slug: string;
  access: string;
  role: "admin" | "editor" | "viewer";
  expectedRevision: number;
  activities: ActivityGridRow[];
  wbsNodes: WbsNode[];
  calendars: Calendar[];
  onRevisionChange: (revision: number) => void;
  onRefresh: () => Promise<unknown> | void;
  onEditingChange: (editing: boolean) => void;
  highlightedActivityId?: number | null;
  onActivityHighlight?: (activityId: number | null) => void;
  verticalScrollTop?: number;
  onVerticalScroll?: (scrollTop: number) => void;
};

export default function ActivityGrid(props: Props) {
  const { slug, access, role, expectedRevision, wbsNodes, calendars } = props;
  const utils = trpc.useUtils();
  const queryInput = { slug, access };
  const { canEdit } = activityGridPermissions(role);
  const leafNodes = useMemo(() => wbsNodes.filter((node) => node.isLeaf && !node.archivedAt), [wbsNodes]);
  const activities = useMemo(() => sortActivities(props.activities), [props.activities]);
  const [newName, setNewName] = useState("");
  const [newWbs, setNewWbs] = useState<number | null>(leafNodes[0]?.id ?? null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<string>("");
  const [conflict, setConflict] = useState<ConflictRecovery>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [draggedId, setDraggedId] = useState<number | null>(null);
  const rowsViewportRef = useRef<HTMLDivElement>(null);
  const selectedNewWbs = selectValidNewWbs(newWbs, leafNodes.map((node) => node.id));

  useEffect(() => {
    if (rowsViewportRef.current && props.verticalScrollTop !== undefined && rowsViewportRef.current.scrollTop !== props.verticalScrollTop) {
      rowsViewportRef.current.scrollTop = props.verticalScrollTop;
    }
  }, [props.verticalScrollTop]);

  function setCachedActivities(updater: (rows: ActivityGridRow[]) => ActivityGridRow[]) {
    utils.primaveraLite.load.setData(queryInput, (current) => current ? { ...current, activities: updater(current.activities) } : current);
  }
  function startEdit(activity: ActivityGridRow, field: keyof ActivityGridRow) {
    if (!canEdit) return;
    setEditing(`${activity.id}:${field}`);
    setDraft(isDateFieldName(field as string) ? formatDate(activity[field]) : String(activity[field] ?? ""));
    props.onEditingChange(true);
  }
  function endEdit() {
    setEditing(null);
    props.onEditingChange(false);
  }
  function isConflict(error: MutationError) {
    return error?.data?.code === "CONFLICT" || error?.shape?.data?.code === "CONFLICT";
  }

  const createActivity = trpc.primaveraLite.createActivity.useMutation({
    onSuccess: (result) => {
      props.onRevisionChange(result.revision);
      setNewName("");
      setCachedActivities((rows) => sortActivities([...rows, result.activity]));
    },
    onError: (error) => setMessage(error.message),
  });
  const updateActivity = trpc.primaveraLite.updateActivity.useMutation({
    onMutate: async (input) => {
      await utils.primaveraLite.load.cancel(queryInput);
      const snapshot = utils.primaveraLite.load.getData(queryInput);
      setCachedActivities((rows) => optimisticActivityEdit(rows, input.activityId, input.changes));
      return { snapshot, input };
    },
    onSuccess: (result) => {
      props.onRevisionChange(result.revision);
      setCachedActivities((rows) => optimisticActivityEdit(rows, result.activity.id, result.activity));
      setConflict(null);
      endEdit();
    },
    onError: async (error, input, context) => {
      if (context?.snapshot) utils.primaveraLite.load.setData(queryInput, context.snapshot);
      const [field, attemptedValue] = Object.entries(input.changes)[0] ?? ["unknown", null];
      if (isConflict(error)) {
        setConflict(preserveConflictAttempt(input.activityId, field, attemptedValue));
        setDraft(String(attemptedValue ?? ""));
        await props.onRefresh();
      }
      setMessage(error.message);
    },
  });
  const archiveDryRun = trpc.primaveraLite.archiveActivityDryRun.useMutation();
  const archiveActivity = trpc.primaveraLite.archiveActivity.useMutation({
    onMutate: async (input) => {
      await utils.primaveraLite.load.cancel(queryInput);
      const snapshot = utils.primaveraLite.load.getData(queryInput);
      setCachedActivities((rows) => optimisticActivityArchive(rows, input.activityId));
      return { snapshot };
    },
    onSuccess: (result) => props.onRevisionChange(result.revision),
    onError: async (error, _input, context) => {
      if (context?.snapshot) utils.primaveraLite.load.setData(queryInput, context.snapshot);
      if (isConflict(error)) await props.onRefresh();
      setMessage(error.message);
    },
  });
  const reorderActivity = trpc.primaveraLite.reorderActivity.useMutation({
    onMutate: async (input) => {
      await utils.primaveraLite.load.cancel(queryInput);
      const snapshot = utils.primaveraLite.load.getData(queryInput);
      setCachedActivities((rows) => optimisticActivityReorder(rows, input.activityId, input.targetWbsNodeId, input.newSortOrder));
      return { snapshot };
    },
    onSuccess: (result) => props.onRevisionChange(result.revision),
    onError: async (error, _input, context) => {
      if (context?.snapshot) utils.primaveraLite.load.setData(queryInput, context.snapshot);
      if (isConflict(error)) await props.onRefresh();
      setMessage(error.message);
    },
  });

  function submitEdit(
    activity: ActivityGridRow,
    field: EditableTextField | EditableNumericField | EditableDateField | "calendarId",
    rawValue: string
  ) {
    const isDateField = isDateFieldName(field);
    const isNumeric = field === "originalDurationDays" || field === "percentComplete" || field === "wbsNodeId";
    let value: unknown;
    if (isDateField) {
      value = rawValue === "" ? null : rawValue;
    } else if (isNumeric) {
      value = Number(rawValue);
    } else if (field === "calendarId") {
      value = rawValue ? Number(rawValue) : null;
    } else {
      value = rawValue;
    }
    const validation = validateActivityEdit(field, value);
    if (validation) return setMessage(validation);
    if (isDateField) {
      const pairError = validateActivityDatePair(activity, field, value as string | null);
      if (pairError) return setMessage(pairError);
    }
    if (isActivityEditNoop(activity, field, value)) return endEdit();
    updateActivity.mutate({ slug, access, expectedRevision, activityId: activity.id, changes: { [field]: value } });
  }

  function validateActivityDatePair(activity: ActivityGridRow, field: EditableDateField, value: string | null): string | null {
    if (field === "plannedStart" || field === "plannedFinish") {
      return validateDatePair(
        field === "plannedStart" ? value : (formatDate(activity.plannedStart) || null),
        field === "plannedFinish" ? value : (formatDate(activity.plannedFinish) || null),
        "Planned"
      );
    }
    return validateDatePair(
      field === "actualStart" ? value : (formatDate(activity.actualStart) || null),
      field === "actualFinish" ? value : (formatDate(activity.actualFinish) || null),
      "Actual"
    );
  }
  async function archive(activityId: number) {
    if (!window.confirm("Archive this activity?")) return;
    const preview = await archiveDryRun.mutateAsync({ slug, access, expectedRevision, activityId });
    archiveActivity.mutate({ slug, access, expectedRevision, activityId, previewToken: preview.previewToken, confirmed: true });
  }
  function dropOn(target: ActivityGridRow) {
    if (!canEdit || draggedId == null || draggedId === target.id) return;
    reorderActivity.mutate({ slug, access, expectedRevision, activityId: draggedId, targetWbsNodeId: target.wbsNodeId, newSortOrder: target.sortOrder });
    setDraggedId(null);
  }

  const editableCell = (activity: ActivityGridRow, field: "activityId" | "activityName" | "originalDurationDays" | "percentComplete", type: "text" | "number" = "text") => {
    const active = editing === `${activity.id}:${field}`;
    return active ? (
      <Input autoFocus type={type} value={draft} onChange={(event) => setDraft(event.target.value)}
        onBlur={() => submitEdit(activity, field, draft)}
        onKeyDown={(event) => { if (event.key === "Enter") submitEdit(activity, field, draft); if (event.key === "Escape") endEdit(); }}
        className="h-8 min-w-24" />
    ) : (
      <button type="button" disabled={!canEdit} onClick={() => startEdit(activity, field)} className="min-h-8 w-full rounded px-2 text-left hover:bg-slate-100 disabled:cursor-default disabled:hover:bg-transparent">
        {activity[field] ?? "—"}
      </button>
    );
  };

  const editableDateCell = (activity: ActivityGridRow, field: EditableDateField) => {
    const active = editing === `${activity.id}:${field}`;
    return active ? (
      <Input autoFocus type="date" value={draft} onChange={(event) => setDraft(event.target.value)}
        onBlur={() => submitEdit(activity, field, draft)}
        onKeyDown={(event) => { if (event.key === "Enter") submitEdit(activity, field, draft); if (event.key === "Escape") endEdit(); }}
        className="h-8 min-w-36" />
    ) : (
      <button type="button" disabled={!canEdit} onClick={() => startEdit(activity, field)} className="min-h-8 w-full rounded px-2 text-left hover:bg-slate-100 disabled:cursor-default disabled:hover:bg-transparent">
        {formatDate(activity[field]) || "—"}
      </button>
    );
  };

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between"><h3 className="text-sm font-semibold">Activities</h3><span className="text-xs text-muted-foreground">{activities.length} activities</span></div>
      {canEdit && (
        <div className="flex flex-wrap items-end gap-2 rounded border bg-white p-3">
          <div className="min-w-64 flex-1"><label className="text-xs font-medium">Activity name</label><Input value={newName} onChange={(e) => setNewName(e.target.value)} /></div>
          <div><label className="block text-xs font-medium">WBS</label><select className="h-9 rounded border px-2" value={selectedNewWbs ?? ""} onChange={(e) => setNewWbs(Number(e.target.value))}>{leafNodes.map((node) => <option key={node.id} value={node.id}>{node.code} — {node.name}</option>)}</select></div>
          <Button disabled={!newName.trim() || selectedNewWbs === null || createActivity.isPending} onClick={() => createActivity.mutate({ slug, access, expectedRevision, wbsNodeId: selectedNewWbs!, activity: { activityName: newName.trim() } })}><Plus className="mr-1 h-4 w-4" />Add Activity</Button>
        </div>
      )}
      {message && <div role="alert" className="rounded border border-amber-300 bg-amber-50 p-2 text-sm">{message}{conflict && <span> Your attempted value is preserved; retry the highlighted edit.</span>}</div>}
      <div ref={rowsViewportRef} onScroll={(event) => props.onVerticalScroll?.(event.currentTarget.scrollTop)}
        className="max-h-[520px] overflow-auto rounded border bg-white" data-testid="activity-grid-scroll-viewport">
        <table className="w-full min-w-[2200px] text-sm">
          <thead className="sticky top-0 z-20 bg-slate-100 text-left"><tr style={{ height: SCHEDULE_ROW_HEIGHT }}><th className="w-10 p-2" aria-label="Reorder"/><th className="p-2">Activity ID</th><th className="p-2">Activity name</th><th className="p-2">WBS</th><th className="p-2">Planned start</th><th className="p-2">Planned finish</th><th className="p-2">Actual start</th><th className="p-2">Actual finish</th><th className="p-2">Original duration</th><th className="p-2">Calendar</th><th className="p-2">% complete</th><th className="p-2">Early start</th><th className="p-2">Early finish</th><th className="p-2">Late start</th><th className="p-2">Late finish</th><th className="p-2">Total float</th><th className="w-16 p-2">Archive</th></tr></thead>
          <tbody>{activities.map((activity) => (
            <tr key={activity.id} draggable={canEdit} onDragStart={() => setDraggedId(activity.id)} onDragOver={(e) => e.preventDefault()} onDrop={() => dropOn(activity)}
              onMouseEnter={() => props.onActivityHighlight?.(activity.id)} onMouseLeave={() => props.onActivityHighlight?.(null)}
              onFocus={() => props.onActivityHighlight?.(activity.id)}
              style={{ height: SCHEDULE_ROW_HEIGHT }} className={`border-t transition-colors ${props.highlightedActivityId === activity.id ? "bg-blue-50" : ""}`}>
              <td className="p-2 text-slate-400">{canEdit && <GripVertical className="h-4 w-4 cursor-grab" />}</td>
              <td className="p-1">{editableCell(activity, "activityId")}</td><td className="p-1">{editableCell(activity, "activityName")}</td>
              <td className="p-1"><select disabled={!canEdit} value={activity.wbsNodeId} onChange={(e) => submitEdit(activity, "wbsNodeId", e.target.value)} className="h-8 w-full rounded border px-1 disabled:border-transparent disabled:appearance-none">{leafNodes.map((node) => <option key={node.id} value={node.id}>{node.code} — {node.name}</option>)}</select></td>
              <td className="p-1">{editableDateCell(activity, "plannedStart")}</td>
              <td className="p-1">{editableDateCell(activity, "plannedFinish")}</td>
              <td className="p-1">{editableDateCell(activity, "actualStart")}</td>
              <td className="p-1">{editableDateCell(activity, "actualFinish")}</td>
              <td className="p-1">{editableCell(activity, "originalDurationDays", "number")}</td>
              <td className="p-1"><select disabled={!canEdit} value={activity.calendarId ?? ""} onChange={(e) => submitEdit(activity, "calendarId", e.target.value)} className="h-8 w-full rounded border px-1 disabled:border-transparent disabled:appearance-none"><option value="">Project default / unassigned</option>{calendars.map((calendar) => <option key={calendar.id} value={calendar.id}>{calendar.name}</option>)}</select></td>
              <td className="p-1">{editableCell(activity, "percentComplete", "number")}</td>
              <td className="p-2 text-muted-foreground">{formatDate(activity.earlyStart) || "—"}</td>
              <td className="p-2 text-muted-foreground">{formatDate(activity.earlyFinish) || "—"}</td>
              <td className="p-2 text-muted-foreground">{formatDate(activity.lateStart) || "—"}</td>
              <td className="p-2 text-muted-foreground">{formatDate(activity.lateFinish) || "—"}</td>
              <td className="p-2 text-muted-foreground">{activity.totalFloatDays ?? "—"}</td>
              <td className="p-2">{canEdit && <Button variant="ghost" size="icon" onClick={() => archive(activity.id)} aria-label={`Archive ${activity.activityName}`}><Archive className="h-4 w-4" /></Button>}</td>
            </tr>
          ))}</tbody>
        </table>
        {activities.length === 0 && <p className="p-6 text-center text-sm text-muted-foreground">No activities yet.</p>}
      </div>
    </section>
  );
}
