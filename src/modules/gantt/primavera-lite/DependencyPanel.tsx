import { useEffect, useMemo, useState } from "react";
import { Archive, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/providers/trpc";
import { sortActivities, type ActivityGridRow } from "./activityGridModel";
import {
  dependencyPermissions, optimisticDependencyArchive, optimisticDependencyUpdate,
  sortDependencies, type DependencyRow, type DependencyType,
} from "./dependencyModel";

type Props = {
  slug: string;
  access: string;
  role: "admin" | "editor" | "viewer";
  expectedRevision: number;
  activities: ActivityGridRow[];
  dependencies: DependencyRow[];
  onRevisionChange: (revision: number) => void;
  onRefresh: () => Promise<unknown> | void;
};

const TYPES: DependencyType[] = ["FS", "SS", "FF", "SF"];

export function LagInput({ dependency, disabled, onCommit }: { dependency: DependencyRow; disabled: boolean; onCommit: (lagDays: number) => void }) {
  const [value, setValue] = useState(String(dependency.lagDays));
  useEffect(() => setValue(String(dependency.lagDays)), [dependency.lagDays]);
  return <Input aria-label={`Lag for dependency ${dependency.id}`} disabled={disabled} type="number" step="1" value={value}
    onChange={(event) => setValue(event.target.value)}
    onBlur={() => { const lag = Number(value); if (!Number.isInteger(lag)) setValue(String(dependency.lagDays)); else if (lag !== dependency.lagDays) onCommit(lag); }} className="h-8" />;
}

export default function DependencyPanel(props: Props) {
  const { slug, access, expectedRevision } = props;
  const utils = trpc.useUtils();
  const queryInput = { slug, access };
  const { canEdit } = dependencyPermissions(props.role);
  const activities = useMemo(() => sortActivities(props.activities).filter((a) => !a.archivedAt), [props.activities]);
  const dependencies = useMemo(() => sortDependencies(props.dependencies), [props.dependencies]);
  const [predecessorId, setPredecessorId] = useState<number | null>(activities[0]?.id ?? null);
  const [successorId, setSuccessorId] = useState<number | null>(activities[1]?.id ?? null);
  const [type, setType] = useState<DependencyType>("FS");
  const [lagDays, setLagDays] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const activityIds = activities.map((activity) => activity.id);
  const selectedPredecessorId = predecessorId !== null && activityIds.includes(predecessorId) ? predecessorId : activityIds[0] ?? null;
  const selectedSuccessorId = successorId !== null && activityIds.includes(successorId) && successorId !== selectedPredecessorId
    ? successorId : activityIds.find((id) => id !== selectedPredecessorId) ?? null;

  function setCachedDependencies(updater: (rows: DependencyRow[]) => DependencyRow[]) {
    utils.primaveraLite.load.setData(queryInput, (current) => current ? { ...current, dependencies: updater(current.dependencies) as typeof current.dependencies } : current);
  }
  const createDependency = trpc.primaveraLite.createDependency.useMutation({
    onSuccess: (result) => {
      props.onRevisionChange(result.revision);
      setCachedDependencies((rows) => sortDependencies([...rows, result.dependency as DependencyRow]));
      setMessage(null);
    },
    onError: (error) => setMessage(error.message),
  });
  const updateDependency = trpc.primaveraLite.updateDependency.useMutation({
    onMutate: async (input) => {
      await utils.primaveraLite.load.cancel(queryInput);
      const snapshot = utils.primaveraLite.load.getData(queryInput);
      setCachedDependencies((rows) => optimisticDependencyUpdate(rows, input.dependencyId, input.changes));
      return { snapshot };
    },
    onSuccess: (result) => {
      props.onRevisionChange(result.revision);
      setCachedDependencies((rows) => optimisticDependencyUpdate(rows, result.dependency.id, result.dependency as DependencyRow));
      setMessage(null);
    },
    onError: async (error, _input, context) => {
      if (context?.snapshot) utils.primaveraLite.load.setData(queryInput, context.snapshot);
      if (error.data?.code === "CONFLICT") await props.onRefresh();
      setMessage(error.message);
    },
  });
  const archiveDryRun = trpc.primaveraLite.archiveDependencyDryRun.useMutation();
  const archiveDependency = trpc.primaveraLite.archiveDependency.useMutation({
    onMutate: async (input) => {
      await utils.primaveraLite.load.cancel(queryInput);
      const snapshot = utils.primaveraLite.load.getData(queryInput);
      setCachedDependencies((rows) => optimisticDependencyArchive(rows, input.dependencyId));
      return { snapshot };
    },
    onSuccess: (result) => props.onRevisionChange(result.revision),
    onError: async (error, _input, context) => {
      if (context?.snapshot) utils.primaveraLite.load.setData(queryInput, context.snapshot);
      if (error.data?.code === "CONFLICT") await props.onRefresh();
      setMessage(error.message);
    },
  });

  function create() {
    if (selectedPredecessorId === null || selectedSuccessorId === null) return;
    createDependency.mutate({ slug, access, expectedRevision, dependency: { predecessorActivityId: selectedPredecessorId, successorActivityId: selectedSuccessorId, dependencyType: type, lagDays } });
  }
  function update(id: number, changes: Partial<Pick<DependencyRow, "predecessorActivityId" | "successorActivityId" | "dependencyType" | "lagDays">>) {
    updateDependency.mutate({ slug, access, expectedRevision, dependencyId: id, changes });
  }
  async function archive(id: number) {
    if (!window.confirm("Archive this dependency?")) return;
    const preview = await archiveDryRun.mutateAsync({ slug, access, expectedRevision, dependencyId: id });
    archiveDependency.mutate({ slug, access, expectedRevision, dependencyId: id, previewToken: preview.previewToken, confirmed: true });
  }
  const activityLabel = (id: number) => {
    const activity = activities.find((row) => row.id === id);
    return activity ? `${activity.activityId ?? "—"} — ${activity.activityName}` : `Activity ${id}`;
  };

  return <section className="space-y-3" aria-label="Dependencies">
    <div className="flex items-center justify-between"><h3 className="text-sm font-semibold">Dependencies</h3><span className="text-xs text-muted-foreground">{dependencies.length} relationships</span></div>
    {canEdit && <div className="grid gap-2 rounded border bg-white p-3 md:grid-cols-[1fr_1fr_auto_7rem_auto]">
      <select aria-label="New predecessor" className="h-9 rounded border px-2" value={selectedPredecessorId ?? ""} onChange={(event) => setPredecessorId(Number(event.target.value))}>{activities.map((activity) => <option key={activity.id} value={activity.id}>{activityLabel(activity.id)}</option>)}</select>
      <select aria-label="New successor" className="h-9 rounded border px-2" value={selectedSuccessorId ?? ""} onChange={(event) => setSuccessorId(Number(event.target.value))}>{activities.map((activity) => <option key={activity.id} value={activity.id}>{activityLabel(activity.id)}</option>)}</select>
      <select aria-label="New dependency type" className="h-9 rounded border px-2" value={type} onChange={(event) => setType(event.target.value as DependencyType)}>{TYPES.map((value) => <option key={value}>{value}</option>)}</select>
      <Input aria-label="New dependency lag" type="number" step="1" value={lagDays} onChange={(event) => setLagDays(Number(event.target.value))} />
      <Button onClick={create} disabled={selectedPredecessorId === null || selectedSuccessorId === null || createDependency.isPending}><Plus className="mr-1 h-4 w-4" />Add</Button>
    </div>}
    {message && <div role="alert" className="rounded border border-amber-300 bg-amber-50 p-2 text-sm">{message}</div>}
    <div className="overflow-x-auto rounded border bg-white"><table className="w-full min-w-[720px] text-sm"><thead className="bg-slate-100 text-left"><tr><th className="p-2">Predecessor</th><th className="p-2">Successor</th><th className="p-2">Type</th><th className="p-2">Lag (days)</th><th className="p-2">Archive</th></tr></thead>
      <tbody>{dependencies.map((dependency) => <tr key={dependency.id} className="border-t">
        <td className="p-1"><select aria-label={`Predecessor for dependency ${dependency.id}`} disabled={!canEdit} className="h-8 w-full rounded border px-1 disabled:border-transparent disabled:appearance-none" value={dependency.predecessorActivityId} onChange={(event) => update(dependency.id, { predecessorActivityId: Number(event.target.value) })}>{activities.map((activity) => <option key={activity.id} value={activity.id}>{activityLabel(activity.id)}</option>)}</select></td>
        <td className="p-1"><select aria-label={`Successor for dependency ${dependency.id}`} disabled={!canEdit} className="h-8 w-full rounded border px-1 disabled:border-transparent disabled:appearance-none" value={dependency.successorActivityId} onChange={(event) => update(dependency.id, { successorActivityId: Number(event.target.value) })}>{activities.map((activity) => <option key={activity.id} value={activity.id}>{activityLabel(activity.id)}</option>)}</select></td>
        <td className="p-1"><select aria-label={`Type for dependency ${dependency.id}`} disabled={!canEdit} className="h-8 rounded border px-1 disabled:border-transparent" value={dependency.dependencyType} onChange={(event) => update(dependency.id, { dependencyType: event.target.value as DependencyType })}>{TYPES.map((value) => <option key={value}>{value}</option>)}</select></td>
        <td className="p-1"><LagInput dependency={dependency} disabled={!canEdit} onCommit={(lagDays) => update(dependency.id, { lagDays })} /></td>
        <td className="p-1">{canEdit && <Button variant="ghost" size="icon" aria-label={`Archive dependency ${dependency.id}`} onClick={() => archive(dependency.id)}><Archive className="h-4 w-4" /></Button>}</td>
      </tr>)}</tbody></table>{dependencies.length === 0 && <p className="p-5 text-center text-sm text-muted-foreground">No dependencies yet.</p>}</div>
  </section>;
}
