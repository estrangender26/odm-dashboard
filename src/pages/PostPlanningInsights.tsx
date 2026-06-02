import { useMemo, useState } from "react";
import { Link } from "react-router";
import * as XLSX from "xlsx";
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import AIAssistant from "@/components/AIAssistant";
import ProgramsEngineeringLogo from "@/components/ProgramsEngineeringLogo";
import { trpc } from "@/providers/trpc";

type PlantFilter = "all" | "htt" | "aglipay";
type ChartFilter = { type: "familiarity" | "owner" | "action"; value: string } | null;

type TaskRow = {
  id: number;
  taskList: string;
  frequency: string;
  responsiblePersonnel: string | null;
  operations: string | null;
  amd: string | null;
  ard: string | null;
  procedureFamiliarity?: string | null;
  equipmentName: string;
  equipmentInitials: string;
  plant: "htt" | "aglipay";
};

type ActionType = "Training" | "SMP Development" | "Owner Assignment" | "AMD Workload" | "ARD";

type ActionItem = {
  id: string;
  type: ActionType;
  plant: "htt" | "aglipay";
  equipment: string;
  taskId: number;
  task: string;
  priority: "High" | "Medium" | "Low";
  owner: string;
  rationale: string;
};

const PLANT_LABELS: Record<PlantFilter, string> = {
  all: "All Plants",
  htt: "HTT STP",
  aglipay: "Aglipay STP",
};

const FAMILIARITY_LEVELS = ["Fully Familiar", "Partially Familiar", "Requires Guidance", "Not Familiar", "Blank"] as const;
const FAMILIARITY_COLORS: Record<string, string> = {
  "Fully Familiar": "#16a34a",
  "Partially Familiar": "#2563eb",
  "Requires Guidance": "#d97706",
  "Not Familiar": "#dc2626",
  Blank: "#64748b",
};
const ACTION_COLORS: Record<ActionType, string> = {
  Training: "#f97316",
  "SMP Development": "#8b5cf6",
  "Owner Assignment": "#0ea5e9",
  "AMD Workload": "#ef4444",
  ARD: "#14b8a6",
};

function flattenGroups(groups: any[] | undefined, plant: "htt" | "aglipay"): TaskRow[] {
  return (groups || []).flatMap((group) =>
    (group.tasks || []).map((task: any) => ({
      id: task.id,
      taskList: task.taskList,
      frequency: task.frequency,
      responsiblePersonnel: task.responsiblePersonnel,
      operations: task.operations,
      amd: task.amd,
      ard: task.ard,
      procedureFamiliarity: task.procedureFamiliarity,
      equipmentName: group.equipment?.name || "Unknown Equipment",
      equipmentInitials: group.equipment?.initials || "—",
      plant,
    }))
  );
}

function familiarityLabel(value: string | null | undefined): string {
  const trimmed = (value || "").trim();
  return trimmed || "Blank";
}

function ownerIsBlank(value: string | null | undefined): boolean {
  return !(value || "").trim();
}

function buildActionPlan(tasks: TaskRow[]): ActionItem[] {
  const actions: ActionItem[] = [];
  for (const task of tasks) {
    const fam = familiarityLabel(task.procedureFamiliarity);
    const owner = task.responsiblePersonnel || "Maintenance Planner";
    const plantName = PLANT_LABELS[task.plant];

    if (["Not Familiar", "Requires Guidance", "Partially Familiar", "Blank"].includes(fam)) {
      actions.push({
        id: `training-${task.plant}-${task.id}`,
        type: "Training",
        plant: task.plant,
        equipment: task.equipmentName,
        taskId: task.id,
        task: task.taskList,
        priority: fam === "Not Familiar" || fam === "Blank" ? "High" : fam === "Requires Guidance" ? "Medium" : "Low",
        owner,
        rationale: `${plantName}: ${fam} procedure familiarity requires field coaching or refresher training.`,
      });
    }

    if (fam === "Not Familiar" || fam === "Requires Guidance" || ownerIsBlank(task.operations)) {
      actions.push({
        id: `smp-${task.plant}-${task.id}`,
        type: "SMP Development",
        plant: task.plant,
        equipment: task.equipmentName,
        taskId: task.id,
        task: task.taskList,
        priority: fam === "Not Familiar" ? "High" : "Medium",
        owner: "SMP Custodian",
        rationale: `${plantName}: task needs a standard maintenance procedure or clearer job steps before rollout.`,
      });
    }

    if (ownerIsBlank(task.responsiblePersonnel) || ownerIsBlank(task.operations)) {
      actions.push({
        id: `owner-${task.plant}-${task.id}`,
        type: "Owner Assignment",
        plant: task.plant,
        equipment: task.equipmentName,
        taskId: task.id,
        task: task.taskList,
        priority: "High",
        owner: "Operations Superintendent",
        rationale: `${plantName}: assign accountable task owner and operations implementor before execution.`,
      });
    }

    if (!ownerIsBlank(task.amd)) {
      actions.push({
        id: `amd-${task.plant}-${task.id}`,
        type: "AMD Workload",
        plant: task.plant,
        equipment: task.equipmentName,
        taskId: task.id,
        task: task.taskList,
        priority: task.frequency?.toLowerCase().includes("daily") || task.frequency?.toLowerCase().includes("weekly") ? "High" : "Medium",
        owner: task.amd || "AMD Lead",
        rationale: `${plantName}: AMD involvement identified; include in workload balancing and weekly planning.`,
      });
    }

    if (!ownerIsBlank(task.ard)) {
      actions.push({
        id: `ard-${task.plant}-${task.id}`,
        type: "ARD",
        plant: task.plant,
        equipment: task.equipmentName,
        taskId: task.id,
        task: task.taskList,
        priority: "Medium",
        owner: task.ard || "ARD Lead",
        rationale: `${plantName}: ARD support identified; track dependency and readiness.`,
      });
    }
  }
  return actions;
}

function exportWorkbook(fileName: string, sheets: Record<string, unknown[]>) {
  const wb = XLSX.utils.book_new();
  for (const [sheetName, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), sheetName.slice(0, 31));
  }
  XLSX.writeFile(wb, fileName);
}

export default function PostPlanningInsights() {
  const [plant, setPlant] = useState<PlantFilter>("all");
  const [chartFilter, setChartFilter] = useState<ChartFilter>(null);
  const [search, setSearch] = useState("");

  const httQuery = trpc.tasks.list.useQuery({ dataset: "htt" });
  const aglipayQuery = trpc.tasks.list.useQuery({ dataset: "aglipay" });
  const httStats = trpc.tasks.stats.useQuery({ dataset: "htt" });
  const aglipayStats = trpc.tasks.stats.useQuery({ dataset: "aglipay" });

  const allTasks = useMemo(
    () => [...flattenGroups(httQuery.data?.groups, "htt"), ...flattenGroups(aglipayQuery.data?.groups, "aglipay")],
    [httQuery.data?.groups, aglipayQuery.data?.groups]
  );

  const plantTasks = useMemo(() => (plant === "all" ? allTasks : allTasks.filter((task) => task.plant === plant)), [allTasks, plant]);
  const actions = useMemo(() => buildActionPlan(plantTasks), [plantTasks]);

  const filteredTasks = useMemo(() => {
    const term = search.trim().toLowerCase();
    return plantTasks.filter((task) => {
      if (chartFilter?.type === "familiarity" && familiarityLabel(task.procedureFamiliarity) !== chartFilter.value) return false;
      if (chartFilter?.type === "owner" && (task.responsiblePersonnel || "Blank") !== chartFilter.value) return false;
      if (chartFilter?.type === "action" && !actions.some((action) => action.taskId === task.id && action.plant === task.plant && action.type === chartFilter.value)) return false;
      if (!term) return true;
      return [task.taskList, task.equipmentName, task.frequency, task.responsiblePersonnel, task.operations, task.amd, task.ard]
        .some((value) => (value || "").toLowerCase().includes(term));
    });
  }, [actions, chartFilter, plantTasks, search]);

  const kpis = useMemo(() => {
    const sourceCount = (plant === "all" ? (httStats.data?.count || 0) + (aglipayStats.data?.count || 0) : plant === "htt" ? httStats.data?.count || 0 : aglipayStats.data?.count || 0);
    const highRisk = plantTasks.filter((task) => ["Not Familiar", "Requires Guidance", "Blank"].includes(familiarityLabel(task.procedureFamiliarity))).length;
    const missingOwner = plantTasks.filter((task) => ownerIsBlank(task.responsiblePersonnel) || ownerIsBlank(task.operations)).length;
    return { sourceCount, dashboardCount: plantTasks.length, highRisk, missingOwner };
  }, [aglipayStats.data?.count, httStats.data?.count, plant, plantTasks]);

  const familiarityData = useMemo(() => FAMILIARITY_LEVELS.map((level) => ({ name: level, value: plantTasks.filter((task) => familiarityLabel(task.procedureFamiliarity) === level).length })), [plantTasks]);
  const ownerData = useMemo(() => {
    const counts = new Map<string, number>();
    for (const task of plantTasks) counts.set(task.responsiblePersonnel || "Blank", (counts.get(task.responsiblePersonnel || "Blank") || 0) + 1);
    return Array.from(counts.entries()).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 8);
  }, [plantTasks]);
  const actionData = useMemo(() => (Object.keys(ACTION_COLORS) as ActionType[]).map((type) => ({ name: type, value: actions.filter((action) => action.type === type).length })), [actions]);

  const summaryRows = [
    { Metric: "Active Plant Filter", Value: PLANT_LABELS[plant] },
    { Metric: "Source Task Count", Value: kpis.sourceCount },
    { Metric: "Dashboard Task Count", Value: kpis.dashboardCount },
    { Metric: "Counts Match Source", Value: kpis.sourceCount === kpis.dashboardCount ? "Yes" : "No" },
    ...familiarityData.map((row) => ({ Metric: `Familiarity - ${row.name}`, Value: row.value })),
    ...actionData.map((row) => ({ Metric: `Action - ${row.name}`, Value: row.value })),
  ];

  const taskExportRows = filteredTasks.map((task) => ({
    Plant: PLANT_LABELS[task.plant],
    "Task ID": task.id,
    Equipment: task.equipmentName,
    Task: task.taskList,
    Frequency: task.frequency,
    Owner: task.responsiblePersonnel || "",
    Operations: task.operations || "",
    AMD: task.amd || "",
    ARD: task.ard || "",
    Familiarity: familiarityLabel(task.procedureFamiliarity),
  }));

  const actionRows = actions.map((action) => ({
    Type: action.type,
    Plant: PLANT_LABELS[action.plant],
    Equipment: action.equipment,
    "Task ID": action.taskId,
    Task: action.task,
    Priority: action.priority,
    Owner: action.owner,
    Rationale: action.rationale,
  }));

  const loading = httQuery.isLoading || aglipayQuery.isLoading;
  const sourceMatches = kpis.sourceCount === kpis.dashboardCount;

  const aiRows = filteredTasks.map((task) => ({
    plant: PLANT_LABELS[task.plant],
    taskId: task.id,
    equipment: task.equipmentName,
    task: task.taskList,
    frequency: task.frequency,
    owner: task.responsiblePersonnel || "Blank",
    operations: task.operations || "Blank",
    amd: task.amd || "Blank",
    ard: task.ard || "Blank",
    familiarity: familiarityLabel(task.procedureFamiliarity),
  }));

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-4 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3">
            <ProgramsEngineeringLogo size={0} className="h-11 w-11" />
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-blue-700">Post-Planning Insights</p>
              <h1 className="text-2xl font-bold text-slate-950">Insights Dashboard</h1>
              <p className="text-sm text-slate-500">Validate planning readiness, familiarity, owners, AMD/ARD workload, and action plans using source task data only.</p>
            </div>
          </div>
          <Link to="/" className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100">Back Home</Link>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-5 px-4 py-5 sm:px-6">
        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="grid gap-3 lg:grid-cols-[1fr_auto] lg:items-end">
            <div>
              <label className="text-xs font-bold uppercase tracking-wide text-slate-500">Plant Filter</label>
              <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
                {(["all", "htt", "aglipay"] as PlantFilter[]).map((option) => (
                  <button key={option} onClick={() => { setPlant(option); setChartFilter(null); }} className={`rounded-xl border px-4 py-3 text-left font-semibold transition ${plant === option ? "border-blue-600 bg-blue-50 text-blue-800" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"}`}>
                    {PLANT_LABELS[option]}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <button onClick={() => exportWorkbook("post-planning-dashboard-summary.xlsx", { Summary: summaryRows })} className="rounded-lg bg-blue-700 px-4 py-3 text-sm font-bold text-white hover:bg-blue-800">Export Dashboard Summary</button>
              <button onClick={() => exportWorkbook("post-planning-action-plan.xlsx", { "Action Plan": actionRows })} className="rounded-lg bg-orange-600 px-4 py-3 text-sm font-bold text-white hover:bg-orange-700">Export Action Plan</button>
              <button onClick={() => exportWorkbook("post-planning-filtered-task-list.xlsx", { Tasks: taskExportRows })} className="rounded-lg bg-emerald-700 px-4 py-3 text-sm font-bold text-white hover:bg-emerald-800">Export Filtered Tasks</button>
            </div>
          </div>
        </section>

        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><p className="text-xs font-bold uppercase text-slate-500">Dashboard Tasks</p><p className="mt-2 text-3xl font-black text-slate-950">{kpis.dashboardCount}</p><p className="text-sm text-slate-500">Source: {kpis.sourceCount}</p></div>
          <div className={`rounded-2xl border p-4 shadow-sm ${sourceMatches ? "border-green-200 bg-green-50" : "border-red-200 bg-red-50"}`}><p className="text-xs font-bold uppercase text-slate-500">KPI Source Match</p><p className={`mt-2 text-3xl font-black ${sourceMatches ? "text-green-700" : "text-red-700"}`}>{sourceMatches ? "PASS" : "CHECK"}</p><p className="text-sm text-slate-600">Counts match source task data.</p></div>
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 shadow-sm"><p className="text-xs font-bold uppercase text-slate-500">Guidance / Risk</p><p className="mt-2 text-3xl font-black text-amber-700">{kpis.highRisk}</p><p className="text-sm text-slate-600">Not familiar, guidance, or blank.</p></div>
          <div className="rounded-2xl border border-sky-200 bg-sky-50 p-4 shadow-sm"><p className="text-xs font-bold uppercase text-slate-500">Owner Gaps</p><p className="mt-2 text-3xl font-black text-sky-700">{kpis.missingOwner}</p><p className="text-sm text-slate-600">Blank owner or operations assignment.</p></div>
        </section>

        <section className="grid gap-4 xl:grid-cols-3">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between"><h2 className="font-bold">Familiarity Counts</h2>{chartFilter?.type === "familiarity" && <button onClick={() => setChartFilter(null)} className="text-sm font-semibold text-blue-700">Clear</button>}</div>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={familiarityData} dataKey="value" nameKey="name" innerRadius={55} outerRadius={92} onClick={(entry) => setChartFilter({ type: "familiarity", value: entry.name })}>{familiarityData.map((entry) => <Cell key={entry.name} fill={FAMILIARITY_COLORS[entry.name]} />)}</Pie><Tooltip /></PieChart></ResponsiveContainer>
            </div>
            <div className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
              {familiarityData.map((row) => <button key={row.name} onClick={() => setChartFilter({ type: "familiarity", value: row.name })} className="flex justify-between rounded-lg bg-slate-50 px-3 py-2 text-left"><span>{row.name}</span><strong>{row.value}</strong></button>)}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between"><h2 className="font-bold">Owner Assignment Chart</h2>{chartFilter?.type === "owner" && <button onClick={() => setChartFilter(null)} className="text-sm font-semibold text-blue-700">Clear</button>}</div>
            <div className="h-72"><ResponsiveContainer width="100%" height="100%"><BarChart data={ownerData} margin={{ left: 0, right: 10, top: 10, bottom: 45 }}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="name" angle={-30} textAnchor="end" interval={0} height={70} tick={{ fontSize: 10 }} /><YAxis allowDecimals={false} /><Tooltip /><Bar dataKey="value" fill="#0ea5e9" onClick={(entry) => setChartFilter({ type: "owner", value: entry.name })} /></BarChart></ResponsiveContainer></div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between"><h2 className="font-bold">Action Plan Engine</h2>{chartFilter?.type === "action" && <button onClick={() => setChartFilter(null)} className="text-sm font-semibold text-blue-700">Clear</button>}</div>
            <div className="h-72"><ResponsiveContainer width="100%" height="100%"><BarChart data={actionData} layout="vertical" margin={{ left: 25, right: 20, top: 10, bottom: 10 }}><CartesianGrid strokeDasharray="3 3" /><XAxis type="number" allowDecimals={false} /><YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 11 }} /><Tooltip /><Bar dataKey="value" onClick={(entry) => setChartFilter({ type: "action", value: entry.name })}>{actionData.map((entry) => <Cell key={entry.name} fill={ACTION_COLORS[entry.name as ActionType]} />)}</Bar></BarChart></ResponsiveContainer></div>
          </div>
        </section>

        <section className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div><h2 className="font-bold">Filtered Task List</h2><p className="text-sm text-slate-500">{filteredTasks.length} tasks shown. Drill-down chart clicks update this table.</p></div>
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search tasks, equipment, owners..." className="rounded-lg border border-slate-300 px-3 py-2 text-sm sm:w-80" />
            </div>
            {chartFilter && <div className="mb-3 rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-800">Chart filter: <strong>{chartFilter.type}</strong> = <strong>{chartFilter.value}</strong> <button onClick={() => setChartFilter(null)} className="ml-2 font-bold underline">clear</button></div>}
            <div className="max-h-[34rem] overflow-auto rounded-xl border border-slate-200">
              <table className="min-w-[980px] w-full text-left text-sm">
                <thead className="sticky top-0 bg-slate-100 text-xs uppercase text-slate-600"><tr><th className="px-3 py-2">Plant</th><th className="px-3 py-2">ID</th><th className="px-3 py-2">Equipment</th><th className="px-3 py-2">Task</th><th className="px-3 py-2">Frequency</th><th className="px-3 py-2">Owner</th><th className="px-3 py-2">AMD</th><th className="px-3 py-2">ARD</th><th className="px-3 py-2">Familiarity</th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {loading ? <tr><td className="px-3 py-6 text-center text-slate-500" colSpan={9}>Loading source task data…</td></tr> : filteredTasks.map((task) => <tr key={`${task.plant}-${task.id}`} className="hover:bg-slate-50"><td className="px-3 py-2 font-semibold">{PLANT_LABELS[task.plant]}</td><td className="px-3 py-2">{task.id}</td><td className="px-3 py-2">{task.equipmentName}</td><td className="px-3 py-2">{task.taskList}</td><td className="px-3 py-2">{task.frequency}</td><td className="px-3 py-2">{task.responsiblePersonnel || "Blank"}</td><td className="px-3 py-2">{task.amd || "Blank"}</td><td className="px-3 py-2">{task.ard || "Blank"}</td><td className="px-3 py-2"><span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold">{familiarityLabel(task.procedureFamiliarity)}</span></td></tr>)}
                </tbody>
              </table>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="font-bold">Generated Action Plan</h2>
            <p className="mb-3 text-sm text-slate-500">Training, SMP development, owner assignment, AMD workload, and ARD actions are generated from active task data.</p>
            <div className="max-h-[34rem] space-y-2 overflow-auto pr-1">
              {actions.slice(0, 120).map((action) => <button key={action.id} onClick={() => setChartFilter({ type: "action", value: action.type })} className="w-full rounded-xl border border-slate-200 p-3 text-left hover:bg-slate-50"><div className="flex flex-wrap items-center gap-2"><span className="rounded-full px-2 py-1 text-xs font-bold text-white" style={{ background: ACTION_COLORS[action.type] }}>{action.type}</span><span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold">{action.priority}</span><span className="text-xs text-slate-500">{PLANT_LABELS[action.plant]} · Task {action.taskId}</span></div><p className="mt-2 text-sm font-semibold text-slate-900">{action.task}</p><p className="mt-1 text-xs text-slate-600">Owner: {action.owner}</p><p className="mt-1 text-xs text-slate-500">{action.rationale}</p></button>)}
            </div>
          </div>
        </section>
      </main>

      <AIAssistant
        contextType="postPlanningInsights"
        data={aiRows}
        filters={{ activePlant: PLANT_LABELS[plant], chartFilter: chartFilter ? `${chartFilter.type}=${chartFilter.value}` : "", search }}
        metadata={{ facilityName: PLANT_LABELS[plant], source: "post-planning-insights-task-data", disableSampleRecords: true, dashboardTaskCount: filteredTasks.length, sourceTaskCount: kpis.sourceCount, actionCounts: actionData }}
        title="Post-Planning AI"
        quickQuestions={["Which plant has the highest training need?", "Summarize current filters and task counts", "Which actions should be prioritized first?"]}
        position="bottom-right"
      />
    </div>
  );
}
