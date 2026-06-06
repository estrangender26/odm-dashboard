import { useMemo, useState } from "react";
import { Link } from "react-router";
import * as XLSX from "xlsx";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import AIAssistant from "@/components/AIAssistant";
import ProgramsEngineeringLogo from "@/components/ProgramsEngineeringLogo";
import { trpc } from "@/providers/trpc";

type PlantFilter = "all" | "htt" | "aglipay";
type FutureDoer = "Operator" | "AMD In-house" | "Outsourced SLA";
type ConsensusStatus =
  | "Full Consensus"
  | "Partial Consensus"
  | "Conflict"
  | "Unassigned";
type RecommendedFutureDoer = FutureDoer | "Conflict" | "Unassigned";
type ChartFilter = {
  type: "familiarity" | "currentDoer" | "futureDoer" | "action";
  value: string;
} | null;

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

type ActionType =
  | "Training"
  | "SMP Development"
  | "Owner Assignment"
  | "Resource Loading"
  | "Ownership Decision";

type TaskGroup = {
  equipment?: { name?: string | null; initials?: string | null } | null;
  tasks?: Array<{
    id: number;
    taskList: string;
    frequency: string;
    responsiblePersonnel: string | null;
    operations: string | null;
    amd: string | null;
    ard: string | null;
    procedureFamiliarity?: string | null;
  }>;
};

type ActionItem = {
  id: string;
  type: ActionType;
  plant: "htt" | "aglipay";
  equipment: string;
  taskId: number;
  task: string;
  priority: "High" | "Medium" | "Low";
  owner: string;
  futureDoer: RecommendedFutureDoer;
  consensusStatus: ConsensusStatus;
  rationale: string;
};

type RiskType = "Ownership Conflict" | "Unassigned Future Doer";

type RiskRegisterItem = {
  id: string;
  type: RiskType;
  plant: "htt" | "aglipay";
  equipment: string;
  taskId: number;
  task: string;
  currentDoer: string;
  consensusStatus: ConsensusStatus;
  recommendedFutureDoer: RecommendedFutureDoer;
  operationsPreference: string;
  amdPreference: string;
  ardPreference: string;
  recommendedAction: string;
};

const PLANT_LABELS: Record<PlantFilter, string> = {
  all: "All Plants",
  htt: "HTT STP",
  aglipay: "Aglipay STP",
};

const FUTURE_DOERS = ["Operator", "AMD In-house", "Outsourced SLA"] as const;
const FUTURE_DOER_COLORS: Record<FutureDoer, string> = {
  Operator: "#16a34a",
  "AMD In-house": "#2563eb",
  "Outsourced SLA": "#dc2626",
};
const TRANSITION_COLORS: Record<RecommendedFutureDoer, string> = {
  Operator: "bg-green-50 text-green-800 border-green-200",
  "AMD In-house": "bg-blue-50 text-blue-800 border-blue-200",
  "Outsourced SLA": "bg-red-50 text-red-800 border-red-200",
  Conflict: "bg-rose-50 text-rose-800 border-rose-200",
  Unassigned: "bg-slate-100 text-slate-700 border-slate-300",
};
const CONSENSUS_COLORS: Record<ConsensusStatus, string> = {
  "Full Consensus": "bg-emerald-50 text-emerald-800 border-emerald-200",
  "Partial Consensus": "bg-amber-50 text-amber-800 border-amber-200",
  Conflict: "bg-rose-50 text-rose-800 border-rose-200",
  Unassigned: "bg-slate-100 text-slate-700 border-slate-300",
};
const ACTION_COLORS: Record<ActionType, string> = {
  Training: "#f97316",
  "SMP Development": "#8b5cf6",
  "Owner Assignment": "#0ea5e9",
  "Resource Loading": "#14b8a6",
  "Ownership Decision": "#e11d48",
};

function flattenGroups(
  groups: TaskGroup[] | undefined,
  plant: "htt" | "aglipay"
): TaskRow[] {
  return (groups || []).flatMap(group =>
    (group.tasks || []).map(task => ({
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

function currentDoerLabel(value: string | null | undefined): string {
  const trimmed = (value || "").trim();
  return trimmed || "Blank";
}

function ownerIsBlank(value: string | null | undefined): boolean {
  return !(value || "").trim();
}

function normalizeFutureDoer(
  value: string | null | undefined
): FutureDoer | null {
  const normalized = (value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, " ");
  if (!normalized) return null;
  if (
    normalized.includes("outsource") ||
    normalized.includes("sla") ||
    normalized.includes("contract")
  )
    return "Outsourced SLA";
  if (normalized.includes("amd")) return "AMD In-house";
  if (normalized.includes("operator") || normalized.includes("operation"))
    return "Operator";
  return null;
}

function preferenceVotes(task: TaskRow): FutureDoer[] {
  return [task.operations, task.amd, task.ard]
    .map(normalizeFutureDoer)
    .filter(Boolean) as FutureDoer[];
}

function deriveConsensus(task: TaskRow): {
  status: ConsensusStatus;
  recommendedFutureDoer: RecommendedFutureDoer;
  majorityValue: FutureDoer | null;
} {
  const votes = preferenceVotes(task);
  if (votes.length === 0) {
    return {
      status: "Unassigned",
      recommendedFutureDoer: "Unassigned",
      majorityValue: null,
    };
  }

  const counts = new Map<FutureDoer, number>();
  for (const vote of votes) counts.set(vote, (counts.get(vote) || 0) + 1);
  const entries = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);

  if (entries.length === 1) {
    return {
      status: "Full Consensus",
      recommendedFutureDoer: entries[0][0],
      majorityValue: entries[0][0],
    };
  }

  if (entries[0][1] >= 2) {
    return {
      status: "Partial Consensus",
      recommendedFutureDoer: entries[0][0],
      majorityValue: entries[0][0],
    };
  }

  return {
    status: "Conflict",
    recommendedFutureDoer: "Conflict",
    majorityValue: null,
  };
}

function deriveFutureDoer(task: TaskRow): RecommendedFutureDoer {
  return deriveConsensus(task).recommendedFutureDoer;
}

function needsTraining(task: TaskRow): boolean {
  return [
    "Not Familiar",
    "Requires Guidance",
    "Partially Familiar",
    "Blank",
  ].includes(familiarityLabel(task.procedureFamiliarity));
}

function needsSmp(task: TaskRow): boolean {
  const fam = familiarityLabel(task.procedureFamiliarity);
  return (
    fam === "Not Familiar" || fam === "Requires Guidance" || fam === "Blank"
  );
}

function resourceLoad(task: TaskRow): number {
  const frequency = (task.frequency || "").toLowerCase();
  if (frequency.includes("daily")) return 30;
  if (frequency.includes("weekly")) return 4;
  if (frequency.includes("monthly")) return 1;
  if (frequency.includes("quarter")) return 0.33;
  if (frequency.includes("annual") || frequency.includes("year")) return 0.08;
  return 1;
}

function loadLabel(value: number): string {
  return Number.isInteger(value) ? `${value}` : value.toFixed(2);
}

function buildActionPlan(tasks: TaskRow[]): ActionItem[] {
  const actions: ActionItem[] = [];
  for (const task of tasks) {
    const fam = familiarityLabel(task.procedureFamiliarity);
    const currentDoer = currentDoerLabel(task.responsiblePersonnel);
    const consensus = deriveConsensus(task);
    const futureDoer = consensus.recommendedFutureDoer;
    const plantName = PLANT_LABELS[task.plant];

    if (futureDoer === "Conflict" || futureDoer === "Unassigned") {
      actions.push({
        id: `ownership-decision-${task.plant}-${task.id}`,
        type: "Ownership Decision",
        plant: task.plant,
        equipment: task.equipmentName,
        taskId: task.id,
        task: task.taskList,
        priority: "High",
        owner: "Transition Steering Committee",
        futureDoer,
        consensusStatus: consensus.status,
        rationale: `${plantName}: ${consensus.status} across Operations, AMD, and ARD preferences. Recommended action: Resolve ownership preference conflict.`,
      });
    }

    if (needsTraining(task)) {
      actions.push({
        id: `training-${task.plant}-${task.id}`,
        type: "Training",
        plant: task.plant,
        equipment: task.equipmentName,
        taskId: task.id,
        task: task.taskList,
        priority:
          fam === "Not Familiar" || fam === "Blank"
            ? "High"
            : fam === "Requires Guidance"
              ? "Medium"
              : "Low",
        owner: `${futureDoer} training lead`,
        futureDoer,
        consensusStatus: consensus.status,
        rationale: `${plantName}: ${fam} procedure familiarity creates a ${futureDoer} training backlog item for post-PPP execution.`,
      });
    }

    if (needsSmp(task)) {
      actions.push({
        id: `smp-${task.plant}-${task.id}`,
        type: "SMP Development",
        plant: task.plant,
        equipment: task.equipmentName,
        taskId: task.id,
        task: task.taskList,
        priority: fam === "Not Familiar" || fam === "Blank" ? "High" : "Medium",
        owner: "SMP Custodian",
        futureDoer,
        consensusStatus: consensus.status,
        rationale: `${plantName}: standard job steps are needed before ${futureDoer} can absorb this post-PPP work.`,
      });
    }

    if (ownerIsBlank(task.responsiblePersonnel)) {
      actions.push({
        id: `owner-${task.plant}-${task.id}`,
        type: "Owner Assignment",
        plant: task.plant,
        equipment: task.equipmentName,
        taskId: task.id,
        task: task.taskList,
        priority: "High",
        owner: "PPP Execution Lead",
        futureDoer,
        consensusStatus: consensus.status,
        rationale: `${plantName}: Responsible is blank, so current PPP execution ownership must be confirmed before transition to ${futureDoer}.`,
      });
    }

    if (resourceLoad(task) >= 4 || futureDoer === "Outsourced SLA") {
      actions.push({
        id: `resource-${task.plant}-${task.id}`,
        type: "Resource Loading",
        plant: task.plant,
        equipment: task.equipmentName,
        taskId: task.id,
        task: task.taskList,
        priority:
          resourceLoad(task) >= 30 || futureDoer === "Outsourced SLA"
            ? "High"
            : "Medium",
        owner: `${futureDoer} resource planner`,
        futureDoer,
        consensusStatus: consensus.status,
        rationale: `${plantName}: ${task.frequency || "Unspecified"} cadence contributes ${loadLabel(resourceLoad(task))} monthly load units to the ${futureDoer} post-PPP model.`,
      });
    }

    if (
      currentDoer.toLowerCase().includes("contract") &&
      futureDoer !== "Outsourced SLA"
    ) {
      actions.push({
        id: `transition-${task.plant}-${task.id}`,
        type: "Resource Loading",
        plant: task.plant,
        equipment: task.equipmentName,
        taskId: task.id,
        task: task.taskList,
        priority: "High",
        owner: `${futureDoer} transition owner`,
        futureDoer,
        consensusStatus: consensus.status,
        rationale: `${plantName}: contractor current PPP execution transitions to ${futureDoer}, requiring handover capacity and readiness tracking.`,
      });
    }
  }
  return actions;
}

function buildRiskRegister(tasks: TaskRow[]): RiskRegisterItem[] {
  return tasks.flatMap(task => {
    const consensus = deriveConsensus(task);
    if (consensus.recommendedFutureDoer !== "Conflict" && consensus.recommendedFutureDoer !== "Unassigned") {
      return [];
    }

    const isConflict = consensus.recommendedFutureDoer === "Conflict";
    return [
      {
        id: `risk-${task.plant}-${task.id}`,
        type: isConflict ? "Ownership Conflict" : "Unassigned Future Doer",
        plant: task.plant,
        equipment: task.equipmentName,
        taskId: task.id,
        task: task.taskList,
        currentDoer: currentDoerLabel(task.responsiblePersonnel),
        consensusStatus: consensus.status,
        recommendedFutureDoer: consensus.recommendedFutureDoer,
        operationsPreference: normalizeFutureDoer(task.operations) || task.operations || "Blank",
        amdPreference: normalizeFutureDoer(task.amd) || task.amd || "Blank",
        ardPreference: normalizeFutureDoer(task.ard) || task.ard || "Blank",
        recommendedAction: isConflict
          ? "Resolve ownership preference conflict"
          : "Assign future doer preference",
      },
    ];
  });
}

function countByFutureDoer(
  tasks: TaskRow[],
  predicate: (task: TaskRow) => boolean = () => true
) {
  return FUTURE_DOERS.map(futureDoer => ({
    name: futureDoer,
    value: tasks.filter(
      task => deriveFutureDoer(task) === futureDoer && predicate(task)
    ).length,
  }));
}

function summarizeByFutureDoer(
  tasks: TaskRow[],
  predicate: (task: TaskRow) => boolean = () => true
) {
  return FUTURE_DOERS.map(futureDoer => {
    const matching = tasks.filter(
      task => deriveFutureDoer(task) === futureDoer && predicate(task)
    );
    const load = matching.reduce((sum, task) => sum + resourceLoad(task), 0);
    return {
      futureDoer,
      taskCount: matching.length,
      monthlyLoad: load,
      highRisk: matching.filter(task =>
        ["Not Familiar", "Blank"].includes(
          familiarityLabel(task.procedureFamiliarity)
        )
      ).length,
    };
  });
}

function exportWorkbook(fileName: string, sheets: Record<string, unknown[]>) {
  const wb = XLSX.utils.book_new();
  for (const [sheetName, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(rows),
      sheetName.slice(0, 31)
    );
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
    () => [
      ...flattenGroups(httQuery.data?.groups, "htt"),
      ...flattenGroups(aglipayQuery.data?.groups, "aglipay"),
    ],
    [httQuery.data?.groups, aglipayQuery.data?.groups]
  );

  const plantTasks = useMemo(
    () =>
      plant === "all"
        ? allTasks
        : allTasks.filter(task => task.plant === plant),
    [allTasks, plant]
  );
  const actions = useMemo(() => buildActionPlan(plantTasks), [plantTasks]);
  const riskRegister = useMemo(() => buildRiskRegister(plantTasks), [plantTasks]);

  const filteredTasks = useMemo(() => {
    const term = search.trim().toLowerCase();
    return plantTasks.filter(task => {
      if (
        chartFilter?.type === "familiarity" &&
        familiarityLabel(task.procedureFamiliarity) !== chartFilter.value
      )
        return false;
      if (
        chartFilter?.type === "currentDoer" &&
        currentDoerLabel(task.responsiblePersonnel) !== chartFilter.value
      )
        return false;
      if (
        chartFilter?.type === "futureDoer" &&
        deriveFutureDoer(task) !== chartFilter.value
      )
        return false;
      if (
        chartFilter?.type === "action" &&
        !actions.some(
          action =>
            action.taskId === task.id &&
            action.plant === task.plant &&
            action.type === chartFilter.value
        )
      )
        return false;
      if (!term) return true;
      return [
        task.taskList,
        task.equipmentName,
        task.frequency,
        task.responsiblePersonnel,
        task.operations,
        task.amd,
        task.ard,
      ].some(value => (value || "").toLowerCase().includes(term));
    });
  }, [actions, chartFilter, plantTasks, search]);

  const kpis = useMemo(() => {
    const sourceCount =
      plant === "all"
        ? (httStats.data?.count || 0) + (aglipayStats.data?.count || 0)
        : plant === "htt"
          ? httStats.data?.count || 0
          : aglipayStats.data?.count || 0;
    const highRisk = plantTasks.filter(task =>
      ["Not Familiar", "Requires Guidance", "Blank"].includes(
        familiarityLabel(task.procedureFamiliarity)
      )
    ).length;
    const missingOwner = plantTasks.filter(task =>
      ownerIsBlank(task.responsiblePersonnel)
    ).length;
    const consensusCounts = plantTasks.reduce(
      (acc, task) => {
        const consensus = deriveConsensus(task);
        acc[consensus.status] += 1;
        if (consensus.recommendedFutureDoer === "Conflict") acc.conflict += 1;
        if (consensus.recommendedFutureDoer === "Unassigned") acc.unassigned += 1;
        return acc;
      },
      {
        "Full Consensus": 0,
        "Partial Consensus": 0,
        Conflict: 0,
        Unassigned: 0,
        conflict: 0,
        unassigned: 0,
      } as Record<ConsensusStatus, number> & { conflict: number; unassigned: number }
    );
    return {
      sourceCount,
      dashboardCount: plantTasks.length,
      highRisk,
      missingOwner,
      fullConsensus: consensusCounts["Full Consensus"],
      partialConsensus: consensusCounts["Partial Consensus"],
      conflict: consensusCounts.conflict,
      unassigned: consensusCounts.unassigned,
    };
  }, [aglipayStats.data?.count, httStats.data?.count, plant, plantTasks]);

  const currentDoerData = useMemo(() => {
    const counts = new Map<string, number>();
    for (const task of plantTasks)
      counts.set(
        task.responsiblePersonnel || "Blank",
        (counts.get(task.responsiblePersonnel || "Blank") || 0) + 1
      );
    return Array.from(counts.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8);
  }, [plantTasks]);
  const futureDoerData = useMemo(
    () => countByFutureDoer(plantTasks),
    [plantTasks]
  );
  const trainingReadiness = useMemo(
    () => summarizeByFutureDoer(plantTasks, needsTraining),
    [plantTasks]
  );
  const smpBacklog = useMemo(
    () => summarizeByFutureDoer(plantTasks, needsSmp),
    [plantTasks]
  );
  const resourceLoading = useMemo(
    () => summarizeByFutureDoer(plantTasks),
    [plantTasks]
  );
  const transitionRows = useMemo(() => {
    const counts = new Map<
      string,
      { currentDoer: string; futureDoer: FutureDoer; value: number }
    >();
    for (const task of plantTasks) {
      const currentDoer = currentDoerLabel(task.responsiblePersonnel);
      const futureDoer = deriveFutureDoer(task);
      if (futureDoer === "Conflict" || futureDoer === "Unassigned") continue;
      const key = `${currentDoer}::${futureDoer}`;
      const existing = counts.get(key);
      if (existing) existing.value += 1;
      else counts.set(key, { currentDoer, futureDoer, value: 1 });
    }
    return Array.from(counts.values()).sort((a, b) => b.value - a.value);
  }, [plantTasks]);

  const actionData = useMemo(
    () =>
      (Object.keys(ACTION_COLORS) as ActionType[]).map(type => ({
        name: type,
        value: actions.filter(action => action.type === type).length,
      })),
    [actions]
  );

  const summaryRows = [
    { Metric: "Active Plant Filter", Value: PLANT_LABELS[plant] },
    { Metric: "Source Task Count", Value: kpis.sourceCount },
    { Metric: "Dashboard Task Count", Value: kpis.dashboardCount },
    {
      Metric: "Counts Match Source",
      Value: kpis.sourceCount === kpis.dashboardCount ? "Yes" : "No",
    },
    { Metric: "Full Consensus Tasks", Value: kpis.fullConsensus },
    { Metric: "Partial Consensus Tasks", Value: kpis.partialConsensus },
    { Metric: "Conflict Tasks", Value: kpis.conflict },
    { Metric: "Unassigned Tasks", Value: kpis.unassigned },
    ...futureDoerData.map(row => ({
      Metric: `Recommended Future Doer - ${row.name}`,
      Value: row.value,
    })),
    ...trainingReadiness.map(row => ({
      Metric: `Training Backlog - ${row.futureDoer}`,
      Value: row.taskCount,
    })),
    ...smpBacklog.map(row => ({
      Metric: `SMP Backlog - ${row.futureDoer}`,
      Value: row.taskCount,
    })),
    ...resourceLoading.map(row => ({
      Metric: `Resource Load - ${row.futureDoer}`,
      Value: loadLabel(row.monthlyLoad),
    })),
    ...actionData.map(row => ({
      Metric: `Action - ${row.name}`,
      Value: row.value,
    })),
  ];

  const taskExportRows = filteredTasks.map(task => ({
    Plant: PLANT_LABELS[task.plant],
    "Task ID": task.id,
    Equipment: task.equipmentName,
    Task: task.taskList,
    Frequency: task.frequency,
    "Current PPP Doer": task.responsiblePersonnel || "",
    "Consensus Status": deriveConsensus(task).status,
    "Recommended Future Doer": deriveFutureDoer(task),
    "Operations Preference": task.operations || "",
    "AMD Preference": task.amd || "",
    "ARD Preference": task.ard || "",
    Familiarity: familiarityLabel(task.procedureFamiliarity),
  }));

  const actionRows = actions.map(action => ({
    Type: action.type,
    Plant: PLANT_LABELS[action.plant],
    Equipment: action.equipment,
    "Task ID": action.taskId,
    Task: action.task,
    Priority: action.priority,
    Owner: action.owner,
    "Consensus Status": action.consensusStatus,
    "Recommended Future Doer": action.futureDoer,
    Rationale: action.rationale,
  }));

  const riskRows = riskRegister.map(risk => ({
    Type: risk.type,
    Plant: PLANT_LABELS[risk.plant],
    Equipment: risk.equipment,
    "Task ID": risk.taskId,
    Task: risk.task,
    "Current PPP Doer": risk.currentDoer,
    "Consensus Status": risk.consensusStatus,
    "Recommended Future Doer": risk.recommendedFutureDoer,
    "Operations Preference": risk.operationsPreference,
    "AMD Preference": risk.amdPreference,
    "ARD Preference": risk.ardPreference,
    "Recommended Action": risk.recommendedAction,
  }));

  const loading = httQuery.isLoading || aglipayQuery.isLoading;
  const sourceMatches = kpis.sourceCount === kpis.dashboardCount;

  const aiRows = filteredTasks.map(task => ({
    plant: PLANT_LABELS[task.plant],
    taskId: task.id,
    equipment: task.equipmentName,
    task: task.taskList,
    frequency: task.frequency,
    currentPppDoer: task.responsiblePersonnel || "Blank",
    consensusStatus: deriveConsensus(task).status,
    recommendedFutureDoer: deriveFutureDoer(task),
    transition: `${currentDoerLabel(task.responsiblePersonnel)} -> ${deriveFutureDoer(task)}`,
    operationsPreference: task.operations || "Blank",
    amdPreference: task.amd || "Blank",
    ardPreference: task.ard || "Blank",
    ownershipDecisionNeeded: deriveFutureDoer(task) === "Conflict" || deriveFutureDoer(task) === "Unassigned" ? "Yes" : "No",
    trainingBacklog: needsTraining(task) ? "Yes" : "No",
    smpBacklog: needsSmp(task) ? "Yes" : "No",
    monthlyResourceLoad: resourceLoad(task),
    familiarity: familiarityLabel(task.procedureFamiliarity),
  }));

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-4 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3">
            <Link
              to="/"
              aria-label="Return to Program Oversight Center"
              title="Return to Program Oversight Center"
              className="inline-flex shrink-0"
            >
              <ProgramsEngineeringLogo size={0} className="h-11 w-11" />
            </Link>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-blue-700">
                Post-Planning Insights
              </p>
              <h1 className="text-2xl font-bold text-slate-950">
                Insights Dashboard
              </h1>
              <p className="text-sm text-slate-500">
                Separate current PPP execution from the future post-PPP
                execution model, transition workload, training backlog, SMP
                backlog, and resource loading.
              </p>
            </div>
          </div>
          <Link
            to="/"
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
          >
            Back Home
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-5 px-4 py-5 sm:px-6">
        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="grid gap-3 lg:grid-cols-[1fr_auto] lg:items-end">
            <div>
              <label className="text-xs font-bold uppercase tracking-wide text-slate-500">
                Plant Filter
              </label>
              <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
                {(["all", "htt", "aglipay"] as PlantFilter[]).map(option => (
                  <button
                    key={option}
                    onClick={() => {
                      setPlant(option);
                      setChartFilter(null);
                    }}
                    className={`rounded-xl border px-4 py-3 text-left font-semibold transition ${plant === option ? "border-blue-600 bg-blue-50 text-blue-800" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"}`}
                  >
                    {PLANT_LABELS[option]}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
              <button
                onClick={() =>
                  exportWorkbook("post-planning-dashboard-summary.xlsx", {
                    Summary: summaryRows,
                  })
                }
                className="rounded-lg bg-blue-700 px-4 py-3 text-sm font-bold text-white hover:bg-blue-800"
              >
                Export Dashboard Summary
              </button>
              <button
                onClick={() =>
                  exportWorkbook("post-planning-action-plan.xlsx", {
                    "Action Plan": actionRows,
                  })
                }
                className="rounded-lg bg-orange-600 px-4 py-3 text-sm font-bold text-white hover:bg-orange-700"
              >
                Export Action Plan
              </button>
              <button
                onClick={() =>
                  exportWorkbook("post-planning-filtered-task-list.xlsx", {
                    Tasks: taskExportRows,
                  })
                }
                className="rounded-lg bg-emerald-700 px-4 py-3 text-sm font-bold text-white hover:bg-emerald-800"
              >
                Export Filtered Tasks
              </button>
              <button
                onClick={() =>
                  exportWorkbook("post-planning-risk-register.xlsx", {
                    "Risk Register": riskRows,
                  })
                }
                className="rounded-lg bg-rose-700 px-4 py-3 text-sm font-bold text-white hover:bg-rose-800"
              >
                Export Risk Register
              </button>
            </div>
          </div>
        </section>

        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-bold uppercase text-slate-500">
              Dashboard Tasks
            </p>
            <p className="mt-2 text-3xl font-black text-slate-950">
              {kpis.dashboardCount}
            </p>
            <p className="text-sm text-slate-500">Source: {kpis.sourceCount}</p>
          </div>
          <div
            className={`rounded-2xl border p-4 shadow-sm ${sourceMatches ? "border-green-200 bg-green-50" : "border-red-200 bg-red-50"}`}
          >
            <p className="text-xs font-bold uppercase text-slate-500">
              KPI Source Match
            </p>
            <p
              className={`mt-2 text-3xl font-black ${sourceMatches ? "text-green-700" : "text-red-700"}`}
            >
              {sourceMatches ? "PASS" : "CHECK"}
            </p>
            <p className="text-sm text-slate-600">
              Counts match source task data.
            </p>
          </div>
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 shadow-sm">
            <p className="text-xs font-bold uppercase text-slate-500">
              Guidance / Risk
            </p>
            <p className="mt-2 text-3xl font-black text-amber-700">
              {kpis.highRisk}
            </p>
            <p className="text-sm text-slate-600">
              Not familiar, guidance, or blank.
            </p>
          </div>
          <div className="rounded-2xl border border-sky-200 bg-sky-50 p-4 shadow-sm">
            <p className="text-xs font-bold uppercase text-slate-500">
              Current PPP Gaps
            </p>
            <p className="mt-2 text-3xl font-black text-sky-700">
              {kpis.missingOwner}
            </p>
            <p className="text-sm text-slate-600">
              Blank Responsible assignment.
            </p>
          </div>
        </section>

        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
          {[
            { label: "Full Consensus Tasks", value: kpis.fullConsensus, color: "border-emerald-200 bg-emerald-50 text-emerald-700" },
            { label: "Partial Consensus Tasks", value: kpis.partialConsensus, color: "border-amber-200 bg-amber-50 text-amber-700" },
            { label: "Conflict Tasks", value: kpis.conflict, color: "border-rose-200 bg-rose-50 text-rose-700" },
            { label: "Unassigned Tasks", value: kpis.unassigned, color: "border-slate-200 bg-slate-100 text-slate-700" },
            ...futureDoerData.map(row => ({
              label: `Recommended ${row.name} Tasks`,
              value: row.value,
              color:
                row.name === "Operator"
                  ? "border-green-200 bg-green-50 text-green-700"
                  : row.name === "AMD In-house"
                    ? "border-blue-200 bg-blue-50 text-blue-700"
                    : "border-red-200 bg-red-50 text-red-700",
            })),
          ].map(card => (
            <button
              key={card.label}
              onClick={() => {
                if (card.label.startsWith("Recommended ")) {
                  const value = card.label
                    .replace("Recommended ", "")
                    .replace(" Tasks", "");
                  setChartFilter({ type: "futureDoer", value });
                }
              }}
              className={`rounded-2xl border p-4 text-left shadow-sm ${card.color}`}
            >
              <p className="text-[0.68rem] font-black uppercase leading-tight tracking-wide">
                {card.label}
              </p>
              <p className="mt-2 text-3xl font-black">{card.value}</p>
            </button>
          ))}
        </section>

        <section className="grid gap-4 xl:grid-cols-3">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h2 className="font-bold">Recommended Future Doer</h2>
                <p className="text-xs text-slate-500">
                  Consensus-based recommendation from independent Operations, AMD, and ARD preference fields. Conflicts and unassigned tasks are excluded from this chart.
                </p>
              </div>
              {chartFilter?.type === "futureDoer" && (
                <button
                  onClick={() => setChartFilter(null)}
                  className="text-sm font-semibold text-blue-700"
                >
                  Clear
                </button>
              )}
            </div>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={futureDoerData}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={55}
                    outerRadius={92}
                    onClick={entry =>
                      setChartFilter({ type: "futureDoer", value: entry.name })
                    }
                  >
                    {futureDoerData.map(entry => (
                      <Cell
                        key={entry.name}
                        fill={FUTURE_DOER_COLORS[entry.name as FutureDoer]}
                      />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="grid grid-cols-1 gap-2 text-sm">
              {futureDoerData.map(row => (
                <button
                  key={row.name}
                  onClick={() =>
                    setChartFilter({ type: "futureDoer", value: row.name })
                  }
                  className={`flex justify-between rounded-lg border px-3 py-2 text-left ${TRANSITION_COLORS[row.name as FutureDoer]}`}
                >
                  <span>{row.name}</span>
                  <strong>{row.value}</strong>
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-bold">Current PPP Execution</h2>
              {chartFilter?.type === "currentDoer" && (
                <button
                  onClick={() => setChartFilter(null)}
                  className="text-sm font-semibold text-blue-700"
                >
                  Clear
                </button>
              )}
            </div>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={currentDoerData}
                  margin={{ left: 0, right: 10, top: 10, bottom: 45 }}
                >
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis
                    dataKey="name"
                    angle={-30}
                    textAnchor="end"
                    interval={0}
                    height={70}
                    tick={{ fontSize: 10 }}
                  />
                  <YAxis allowDecimals={false} />
                  <Tooltip />
                  <Bar
                    dataKey="value"
                    fill="#0ea5e9"
                    onClick={entry =>
                      setChartFilter({ type: "currentDoer", value: entry.name })
                    }
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-bold">Action Plan Engine</h2>
              {chartFilter?.type === "action" && (
                <button
                  onClick={() => setChartFilter(null)}
                  className="text-sm font-semibold text-blue-700"
                >
                  Clear
                </button>
              )}
            </div>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={actionData}
                  layout="vertical"
                  margin={{ left: 25, right: 20, top: 10, bottom: 10 }}
                >
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis type="number" allowDecimals={false} />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={110}
                    tick={{ fontSize: 11 }}
                  />
                  <Tooltip />
                  <Bar
                    dataKey="value"
                    onClick={entry =>
                      setChartFilter({ type: "action", value: entry.name })
                    }
                  >
                    {actionData.map(entry => (
                      <Cell
                        key={entry.name}
                        fill={ACTION_COLORS[entry.name as ActionType]}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </section>

        <section className="grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="font-bold">Transition Matrix</h2>
            <p className="mb-3 text-sm text-slate-500">
              Current PPP Doer → Recommended Future Doer transition workload. Conflict and unassigned tasks are tracked separately in the Handover Risk Register.
            </p>
            <div className="max-h-80 overflow-auto rounded-xl border border-slate-200">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-100 text-xs uppercase text-slate-600">
                  <tr>
                    <th className="px-3 py-2">Current PPP Doer</th>
                    <th className="px-3 py-2">Recommended Future Doer</th>
                    <th className="px-3 py-2 text-right">Tasks</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {transitionRows.map(row => (
                    <tr key={`${row.currentDoer}-${row.futureDoer}`}>
                      <td className="px-3 py-2 font-semibold">
                        {row.currentDoer}
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={`rounded-full border px-2 py-1 text-xs font-bold ${TRANSITION_COLORS[row.futureDoer]}`}
                        >
                          {row.futureDoer}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right font-black">
                        {row.value}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="grid gap-4">
            {[
              {
                title: "Training Readiness",
                rows: trainingReadiness,
                note: "Training backlog grouped by future doer.",
              },
              {
                title: "SMP Development Backlog",
                rows: smpBacklog,
                note: "SMP backlog grouped by future doer.",
              },
              {
                title: "Resource Loading",
                rows: resourceLoading,
                note: "Monthly load units grouped by future doer.",
              },
            ].map(section => (
              <div
                key={section.title}
                className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
              >
                <h2 className="font-bold">{section.title}</h2>
                <p className="mb-3 text-sm text-slate-500">{section.note}</p>
                <div className="grid gap-2 sm:grid-cols-3">
                  {section.rows.map(row => (
                    <button
                      key={`${section.title}-${row.futureDoer}`}
                      onClick={() =>
                        setChartFilter({
                          type: "futureDoer",
                          value: row.futureDoer,
                        })
                      }
                      className={`rounded-xl border p-3 text-left ${TRANSITION_COLORS[row.futureDoer]}`}
                    >
                      <p className="text-xs font-bold uppercase">
                        {row.futureDoer}
                      </p>
                      <p className="mt-1 text-2xl font-black">
                        {section.title === "Resource Loading"
                          ? loadLabel(row.monthlyLoad)
                          : row.taskCount}
                      </p>
                      <p className="text-xs opacity-80">
                        {section.title === "Resource Loading"
                          ? `${row.taskCount} tasks`
                          : `${loadLabel(row.monthlyLoad)} load units`}
                      </p>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="font-bold">Filtered Task List</h2>
                <p className="text-sm text-slate-500">
                  {filteredTasks.length} tasks shown. Drill-down chart clicks
                  update this table.
                </p>
              </div>
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search tasks, equipment, owners..."
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm sm:w-80"
              />
            </div>
            {chartFilter && (
              <div className="mb-3 rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-800">
                Chart filter: <strong>{chartFilter.type}</strong> ={" "}
                <strong>{chartFilter.value}</strong>{" "}
                <button
                  onClick={() => setChartFilter(null)}
                  className="ml-2 font-bold underline"
                >
                  clear
                </button>
              </div>
            )}
            <div className="max-h-[34rem] overflow-auto rounded-xl border border-slate-200">
              <table className="min-w-[1120px] w-full text-left text-sm">
                <thead className="sticky top-0 bg-slate-100 text-xs uppercase text-slate-600">
                  <tr>
                    <th className="px-3 py-2">Plant</th>
                    <th className="px-3 py-2">ID</th>
                    <th className="px-3 py-2">Equipment</th>
                    <th className="px-3 py-2">Task</th>
                    <th className="px-3 py-2">Frequency</th>
                    <th className="px-3 py-2">Current PPP Doer</th>
                    <th className="px-3 py-2">Consensus Status</th>
                    <th className="px-3 py-2">Recommended Future Doer</th>
                    <th className="px-3 py-2">Operations Preference</th>
                    <th className="px-3 py-2">AMD Preference</th>
                    <th className="px-3 py-2">ARD Preference</th>
                    <th className="px-3 py-2">Familiarity</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {loading ? (
                    <tr>
                      <td
                        className="px-3 py-6 text-center text-slate-500"
                        colSpan={12}
                      >
                        Loading source task data…
                      </td>
                    </tr>
                  ) : (
                    filteredTasks.map(task => (
                      <tr
                        key={`${task.plant}-${task.id}`}
                        className="hover:bg-slate-50"
                      >
                        <td className="px-3 py-2 font-semibold">
                          {PLANT_LABELS[task.plant]}
                        </td>
                        <td className="px-3 py-2">{task.id}</td>
                        <td className="px-3 py-2">{task.equipmentName}</td>
                        <td className="px-3 py-2">{task.taskList}</td>
                        <td className="px-3 py-2">{task.frequency}</td>
                        <td className="px-3 py-2">
                          {task.responsiblePersonnel || "Blank"}
                        </td>
                        <td className="px-3 py-2">
                          <span
                            className={`rounded-full border px-2 py-1 text-xs font-bold ${CONSENSUS_COLORS[deriveConsensus(task).status]}`}
                          >
                            {deriveConsensus(task).status}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          <span
                            className={`rounded-full border px-2 py-1 text-xs font-bold ${TRANSITION_COLORS[deriveFutureDoer(task)]}`}
                          >
                            {deriveFutureDoer(task)}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          {task.operations || "Blank"}
                        </td>
                        <td className="px-3 py-2">{task.amd || "Blank"}</td>
                        <td className="px-3 py-2">{task.ard || "Blank"}</td>
                        <td className="px-3 py-2">
                          <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold">
                            {familiarityLabel(task.procedureFamiliarity)}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="grid gap-4">
            <div className="rounded-2xl border border-rose-200 bg-white p-4 shadow-sm">
              <h2 className="font-bold">Handover Risk Register</h2>
              <p className="mb-3 text-sm text-slate-500">
                Conflict and unassigned ownership items requiring decision before transition.
              </p>
              <div className="max-h-72 space-y-2 overflow-auto pr-1">
                {riskRegister.length === 0 ? (
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-800">
                    No ownership conflicts or unassigned future doer risks in the current filter.
                  </div>
                ) : (
                  riskRegister.slice(0, 80).map(risk => (
                    <div
                      key={risk.id}
                      className="rounded-xl border border-rose-100 bg-rose-50 p-3"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full bg-rose-700 px-2 py-1 text-xs font-bold text-white">
                          {risk.type}
                        </span>
                        <span
                          className={`rounded-full border px-2 py-1 text-xs font-bold ${CONSENSUS_COLORS[risk.consensusStatus]}`}
                        >
                          {risk.consensusStatus}
                        </span>
                        <span className="text-xs text-slate-500">
                          {PLANT_LABELS[risk.plant]} · Task {risk.taskId}
                        </span>
                      </div>
                      <p className="mt-2 text-sm font-semibold text-slate-900">
                        {risk.task}
                      </p>
                      <p className="mt-1 text-xs text-slate-600">
                        Ops: {risk.operationsPreference} · AMD: {risk.amdPreference} · ARD: {risk.ardPreference}
                      </p>
                      <p className="mt-1 text-xs font-semibold text-rose-800">
                        Recommended action: {risk.recommendedAction}
                      </p>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="font-bold">Generated Action Plan</h2>
            <p className="mb-3 text-sm text-slate-500">
              Training, SMP development, owner assignment, resource loading, and
              transition actions are grouped by the derived future doer.
            </p>
            <div className="max-h-[34rem] space-y-2 overflow-auto pr-1">
              {actions.slice(0, 120).map(action => (
                <button
                  key={action.id}
                  onClick={() =>
                    setChartFilter({ type: "action", value: action.type })
                  }
                  className="w-full rounded-xl border border-slate-200 p-3 text-left hover:bg-slate-50"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className="rounded-full px-2 py-1 text-xs font-bold text-white"
                      style={{ background: ACTION_COLORS[action.type] }}
                    >
                      {action.type}
                    </span>
                    <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold">
                      {action.priority}
                    </span>
                    <span className="text-xs text-slate-500">
                      {PLANT_LABELS[action.plant]} · Task {action.taskId}
                    </span>
                  </div>
                  <p className="mt-2 text-sm font-semibold text-slate-900">
                    {action.task}
                  </p>
                  <p className="mt-1 text-xs text-slate-600">
                    Owner: {action.owner} · Future Doer: {action.futureDoer}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    {action.rationale}
                  </p>
                </button>
              ))}
            </div>
            </div>
          </div>
        </section>
      </main>

      <AIAssistant
        contextType="postPlanningInsights"
        data={aiRows}
        filters={{
          activePlant: PLANT_LABELS[plant],
          chartFilter: chartFilter
            ? `${chartFilter.type}=${chartFilter.value}`
            : "",
          search,
        }}
        metadata={{
          facilityName: PLANT_LABELS[plant],
          source: "post-planning-insights-task-data",
          sourceModule: "Post-PPP Planning",
          disableSampleRecords: true,
          dashboardTaskCount: filteredTasks.length,
          sourceTaskCount: kpis.sourceCount,
          actionCounts: actionData,
          riskCounts: {
            ownershipConflicts: riskRegister.filter(risk => risk.type === "Ownership Conflict").length,
            unassignedFutureDoers: riskRegister.filter(risk => risk.type === "Unassigned Future Doer").length,
          },
          consensusModel:
            "Operations, AMD, and ARD are independent preference inputs. Consensus status is derived separately from the recommended future doer. Do not force tie-breaks; ties/no consensus become Conflict and all blanks become Unassigned.",
        }}
        title="Post-PPP Planning AI"
        quickQuestions={[
          "Show ownership conflicts",
          "Show tasks with full consensus",
          "Show tasks needing ownership decision",
          "Compare Operations vs AMD preferences",
          "Compare AMD vs ARD preferences",
          "Recommend future doer based on consensus",
        ]}
        position="bottom-right"
      />
    </div>
  );
}
