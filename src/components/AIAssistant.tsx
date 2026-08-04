import { useState, useRef, useEffect } from "react";
import { trpc } from "@/providers/trpc";
import {
  VOICE_UNSUPPORTED_MESSAGE,
  buildSpeechFriendlyAssistantReply,
  describeSpeechRecognitionError,
  getSpeechRecognitionConstructor,
} from "@/lib/voiceAgent";
import {
  formatOdmTalkAiPost,
  inferOdmTalkSource,
  type OdmTalkShareType,
  type OdmTalkThreadType,
} from "@/lib/odmTalkBridge";
import {
  normProgress,
  rowStatus,
} from "@/modules/gantt/engine/schedulingEngine";
import {
  calcProjectCompletion,
  normalizeTaskStatus,
  taskCompletionPercent,
} from "@/modules/gantt/engine/uiUtilsEngine";

type VoiceRecognition = InstanceType<
  NonNullable<ReturnType<typeof getSpeechRecognitionConstructor>>
>;

export type DashboardContext =
  | "maintenance"
  | "gantt"
  | "inspection"
  | "smp"
  | "manuals"
  | "scorecard"
  | "governance"
  | "help"
  | "postPlanningInsights";

interface AIAssistantProps {
  contextType: DashboardContext;
  data?: any[] | any;
  filters?: any;
  metadata?: any;
  title?: string;
  quickQuestions?: string[];
  position?: "bottom-left" | "bottom-right";
}

const MAX_AI_CONTEXT_CHARS = 3900;
const MAX_GANTT_TASK_ROWS = 40;
const SHARED_ASSISTANT_TITLE = "ODM Dashboard AI";
const SHARED_ASSISTANT_SUBTITLE = "Grounded in active dashboard data";
const MODULE_DATA_NOT_LOADED_MESSAGE =
  "Module data is not loaded. Open the relevant dashboard module first so I can analyze its data.";
const NO_VOICE_CAPTURED_MESSAGE =
  "No voice captured. Please try again or use text chat.";
const VOICE_REPLY_UNSUPPORTED_MESSAGE =
  "Voice reply is not supported on this browser.";
const VOICE_CAPTURED_REVIEW_MESSAGE = "Voice captured. Review then tap Send.";
const VOICE_CAPTURE_TIMEOUT_MS = 10000;

const GENERAL_HELP_PROMPTS = [
  "What can this dashboard do?",
  "Which module should I open?",
  "How do I use Maintenance Planning?",
  "How do I use ODM Talk?",
];

const DASHBOARD_GROUNDING_INSTRUCTION = `Use dashboard data first and active module data first for module-specific questions. General knowledge questions may be answered normally. Current, live, recent, or external questions may use server-side web search when available, except simple time/date questions must use dashboard/browser runtime time instead of web search. If module data is empty or unavailable for a module-specific question, say exactly "Module data is not loaded. Open the relevant dashboard module first so I can analyze its data." Do not invent missing module data, task counts, KPI values, equipment names, ownership decisions, SMP coverage, document counts, schedule delays, or file/folder counts. Web search must not override dashboard/module records.`;

const CONTEXT_PROMPTS: Record<DashboardContext, string[]> = {
  maintenance: [
    "Analyze PM compliance trends",
    "Identify high-risk equipment",
    "Suggest maintenance optimization",
    "Review overdue work orders",
  ],
  gantt: [
    "Analyze schedule delays",
    "Suggest task sequencing improvements",
    "Review critical path",
    "Identify resource conflicts",
  ],
  inspection: [
    "Analyze inspection findings",
    "Classify risk levels",
    "Suggest corrective actions",
    "Review compliance status",
  ],
  smp: [
    "Which equipment types are missing SMPs?",
    "Which SMPs are expired or under review?",
    "Summarize SMP coverage by system.",
    "Which responsible parties have the most SMPs?",
  ],
  manuals: [
    "Which facilities have the most documents?",
    "Which folders have no files?",
    "What is the overall document coverage?",
    "Which facilities lack manuals?",
  ],
  scorecard: [
    "Which KPIs are below benchmark?",
    "Which BUs are underperforming?",
    "What corrective actions are recommended?",
    "Summarize BU performance.",
  ],
  governance: [
    "Analyze governance compliance",
    "Review milestone status",
    "Check document status",
    "Identify governance risks",
    "Suggest policy improvements",
  ],
  postPlanningInsights: [
    "Show contractor-to-operator transition",
    "Show contractor-to-AMD transition",
    "Show outsourced SLA workload",
    "Show operator training backlog",
    "Show AMD training backlog",
    "Show SMP development priorities",
  ],
  help: [
    "Explain dashboard features",
    "Guide on data import",
    "Troubleshoot issues",
    "Suggest best practices",
  ],
};

function hasNonEmptyRecord(value: any): boolean {
  if (!value || typeof value !== "object") return false;
  return Object.values(value).some(
    field =>
      field !== undefined &&
      field !== null &&
      field !== "" &&
      !(Array.isArray(field) && field.length === 0)
  );
}

function hasUsableModuleData(
  data: any[] | any,
  contextType: DashboardContext,
  metadata?: any
): boolean {
  if (contextType === "help") return false;

  if (Array.isArray(data)) return data.some(hasNonEmptyRecord);

  if (data && typeof data === "object") {
    if (contextType === "scorecard") {
      return (
        (Array.isArray(data.kpis) && data.kpis.some(hasNonEmptyRecord)) ||
        (Array.isArray(data.monthlyScoreData) &&
          data.monthlyScoreData.some(hasNonEmptyRecord)) ||
        (data.aggregates && Object.keys(data.aggregates).length > 0)
      );
    }

    if (contextType === "gantt") {
      return Array.isArray(data.tasks) && data.tasks.some(hasNonEmptyRecord);
    }

    if (contextType === "manuals") {
      const aiTotals = metadata?.aiContext?.totals;
      return Boolean(
        Number(data.folders) > 0 ||
        Number(data.files) > 0 ||
        (data.tree && Object.keys(data.tree).length > 0) ||
        Number(aiTotals?.folders) > 0 ||
        Number(aiTotals?.files) > 0
      );
    }

    return Object.values(data).some(value => {
      if (Array.isArray(value)) return value.some(hasNonEmptyRecord);
      if (value && typeof value === "object")
        return Object.keys(value).length > 0;
      return false;
    });
  }

  return false;
}

function isRuntimeTimeQuestion(message: string): boolean {
  return /^\s*(?:what(?:\s+is|'s)?\s+(?:the\s+)?time(?:\s+is\s+it)?|what\s+time\s+is\s+it|current\s+time|time\s+now|what(?:\s+is|'s)?\s+(?:today(?:'s|’s)?\s+date|the\s+date|today)|what\s+day\s+is\s+it|current\s+date|date\s+today)\??\s*$/i.test(
    message
  );
}

function isPureWebCurrentQuestion(message: string): boolean {
  if (isRuntimeTimeQuestion(message)) return false;

  const pureWebCurrentTerms =
    /\b(current|currently|live|latest|today|tonight|tomorrow|yesterday|this week|this month|this year|now|right now|recent|newest|breaking|news|price|prices|market|stock|ranking|rankings|richest|wealthiest|billionaire|billionaires|net worth|ceo|chief executive|weather|forecast|exchange rate|inflation|interest rate|law|laws|regulation|regulations|standard|standards|version|release|model info|product info|availability)\b/i;
  const moduleAnchorTerms =
    /\b(this dashboard|active dashboard|dashboard data|module data|active module|these records|loaded records|my dashboard|our dashboard)\b/i;

  return pureWebCurrentTerms.test(message) && !moduleAnchorTerms.test(message);
}

function isDataAnalysisQuestion(message: string): boolean {
  if (isPureWebCurrentQuestion(message)) return false;

  const definitionQuestion =
    /\b(what is|what are|define|explain|difference between|compare)\b/i.test(
      message
    );
  const activeModuleReference =
    /\b(this|these|active|dashboard|module|loaded|my|our)\b/i.test(message);
  if (definitionQuestion && !activeModuleReference) return false;

  return /\b(analy[sz]e|analysis|trend|trends|risk|high-risk|equipment|kpi|kpis|benchmark|schedule|delay|delays|critical path|resource conflict|compliance|overdue|work order|task count|document count|folder|file|coverage|underperform|ownership|responsible|corrective action|recommendation|milestone|inspection|smp|manual)\b/i.test(
    message
  );
}

/**
 * Build a rich data context string from dashboard data.
 * Handles arrays, objects, and nested structures.
 */
function buildDataContext(
  data: any[] | any,
  contextType: DashboardContext,
  filters?: any,
  metadata?: any
): string {
  let ctx = "";
  const browserNow = new Date();
  const now = browserNow.toISOString().slice(0, 10);
  const browserTimeZone =
    typeof Intl !== "undefined"
      ? Intl.DateTimeFormat().resolvedOptions().timeZone || "unknown"
      : "unknown";

  ctx += `=== DASHBOARD CONTEXT ===\n`;
  ctx += `Current Date: ${now}\n`;
  ctx += `Dashboard/browser runtime ISO: ${browserNow.toISOString()}\n`;
  ctx += `Dashboard/browser runtime timezone: ${browserTimeZone}\n`;
  ctx += `Dashboard Type: ${contextType}\n`;

  // Filters
  if (filters && Object.keys(filters).length > 0) {
    const activeFilters = Object.entries(filters).filter(
      ([, v]) => v !== "" && v !== undefined && v !== null
    );
    if (activeFilters.length > 0) {
      ctx += `Active Filters: ${activeFilters.map(([k, v]) => `${k}=${v}`).join(", ")}\n`;
    }
  }

  // Metadata
  if (metadata) {
    if (metadata.facilityName) ctx += `Facility: ${metadata.facilityName}\n`;
    if (metadata.dashboardTaskCount !== undefined)
      ctx += `Dashboard Task Count: ${metadata.dashboardTaskCount}\n`;
    if (metadata.sourceTaskCount !== undefined)
      ctx += `Source Task Count: ${metadata.sourceTaskCount}\n`;
    if (metadata.source) ctx += `Data Source: ${metadata.source}\n`;
    if (metadata.uploads?.length)
      ctx += `Uploads: ${metadata.uploads.length} documents\n`;
    const metadataEvidence = Object.fromEntries(
      Object.entries(metadata).filter(
        ([key, value]) =>
          !["aiContext", "uploads"].includes(key) &&
          value !== undefined &&
          value !== null &&
          typeof value !== "function"
      )
    );
    if (Object.keys(metadataEvidence).length > 0) {
      ctx += `Module Metadata Evidence: ${JSON.stringify(metadataEvidence).slice(0, 1200)}\n`;
    }
    if (metadata.aiContext && contextType === "manuals") {
      const aiCtx = metadata.aiContext;
      const safeEntries = (
        record: Record<string, number> | undefined,
        limit = 10
      ) =>
        Object.entries(record || {})
          .sort(([, a], [, b]) => b - a)
          .slice(0, limit)
          .map(([k, v]) => `${k}: ${v}`)
          .join(", ");
      ctx += `\n=== O&M MANUALS DATABASE METADATA ===\n`;
      ctx += `Total folders: ${aiCtx?.totals?.folders ?? 0}\n`;
      ctx += `Total files: ${aiCtx?.totals?.files ?? 0}\n`;
      ctx += `PDF count: ${aiCtx?.totals?.pdfCount ?? 0}\n`;
      ctx += `Counts by facility: ${safeEntries(aiCtx?.distribution?.facility)}\n`;
      ctx += `Counts by category: ${safeEntries(aiCtx?.distribution?.category)}\n`;
      ctx += `Counts by approval/status: ${safeEntries(aiCtx?.distribution?.approvalStatus)}\n`;
      ctx += `Latest revisions summary: ${(aiCtx?.latestRevisionHints || []).slice(0, 5).join(" | ") || "None"}\n`;
      ctx += `Indicators (missing/obsolete/overdue): ${aiCtx?.totals?.missingIndicators ?? 0}/${aiCtx?.totals?.obsoleteIndicators ?? 0}/${aiCtx?.totals?.overdueIndicators ?? 0}\n`;
      if (
        Array.isArray(aiCtx?.sampleRecords) &&
        aiCtx.sampleRecords.length > 0
      ) {
        ctx += `Sample records (max 5):\n`;
        aiCtx.sampleRecords.slice(0, 5).forEach((s: any, i: number) => {
          ctx += `${i + 1}. ${s.title || "Untitled"} | ${s.revision || "No rev"} | ${s.facilityPath || "No path"}\n`;
        });
      }
      ctx += `Use this metadata as primary evidence for counts, facilities, status, revisions, and completeness answers.\n`;
    }
  }

  // Data analysis
  if (!data) {
    ctx += `Status: No data loaded\n`;
    return ctx;
  }

  // Handle arrays
  if (Array.isArray(data)) {
    ctx += `Total Records: ${data.length}\n\n`;

    if (data.length === 0) {
      ctx += `Dataset is empty.\n`;
      return ctx;
    }

    // Field names from first item
    const first = data[0];
    const fields = Object.keys(first || {});

    // --- MAINTENANCE PLANNING dashboard (trpc.tasks.list task data) ---
    if (
      contextType === "maintenance" &&
      (fields.includes("taskList") ||
        fields.includes("responsiblePersonnel") ||
        fields.includes("currentPppDoer"))
    ) {
      const countBy = (picker: (r: any) => string | null | undefined) => {
        const map: Record<string, number> = {};
        data.forEach((r: any) => {
          const key = (picker(r) || "Blank").trim() || "Blank";
          map[key] = (map[key] || 0) + 1;
        });
        return Object.entries(map).sort(([, a], [, b]) => b - a);
      };
      const getCurrentPppDoer = (r: any) =>
        r.currentPppDoer ||
        r.Responsible ||
        r.responsible ||
        r.responsiblePersonnel;
      ctx += `=== MAINTENANCE PLANNING TASK DATA (trpc.tasks.list) ===\n`;
      ctx += `Total Tasks: ${data.length}\n`;
      ctx += `Ownership Rule: Responsible/currentPppDoer/responsiblePersonnel is the current PPP execution doer only. Operations, AMD, and ARD are future ownership preference fields and must not be treated as the current doer.\n`;
      ctx += `Current PPP Doer (top):\n`;
      countBy(getCurrentPppDoer)
        .slice(0, 10)
        .forEach(([name, c]) => {
          ctx += `- ${name}: ${c} tasks\n`;
        });
      ctx += `Frequencies:\n`;
      countBy(r => r.frequency || r.Frequency)
        .slice(0, 10)
        .forEach(([name, c]) => {
          ctx += `- ${name}: ${c} tasks\n`;
        });
      ctx += `Equipment (top):\n`;
      countBy(
        r => r.equipmentName || r.equipment?.name || r.Equipment || r.equipment
      )
        .slice(0, 10)
        .forEach(([name, c]) => {
          ctx += `- ${name}: ${c} tasks\n`;
        });
      ctx += `Future preference fields (do not confuse with current PPP doer):\n`;
      ["operations", "amd", "ard"].forEach(field => {
        ctx += `- ${field.toUpperCase()}: ${
          countBy(r => r[field])
            .slice(0, 6)
            .map(([name, c]) => `${name}=${c}`)
            .join(", ") || "No values loaded"
        }\n`;
      });
      ctx += `Task Records (first ${Math.min(15, data.length)}):\n`;
      data.slice(0, 15).forEach((r: any, i: number) => {
        ctx += `${i + 1}. equipment=${r.equipmentName || r.equipment?.name || "Unknown"} | task=${r.taskList || "Untitled"} | frequency=${r.frequency || "Blank"} | currentPppDoer=${getCurrentPppDoer(r) || "Blank"} | operations=${r.operations || "Blank"} | amd=${r.amd || "Blank"} | ard=${r.ard || "Blank"}\n`;
      });
    }

    // --- MAINTENANCE / EFM dashboard ---
    else if (contextType === "maintenance" && fields.includes("Equipment")) {
      // Status breakdown
      const statusMap: Record<string, number> = {};
      const plantMap: Record<string, { total: number; overdue: number }> = {};
      const overdueItems: string[] = [];
      let pmCount = 0,
        cmCount = 0;

      data.forEach((r: any) => {
        const st = r.Status || r.status || "Unknown";
        statusMap[st] = (statusMap[st] || 0) + 1;

        const plant = r.Plant || r.Facility || "Unknown";
        if (!plantMap[plant]) plantMap[plant] = { total: 0, overdue: 0 };
        plantMap[plant].total++;

        if (st.toLowerCase().includes("overdue")) {
          plantMap[plant].overdue++;
          overdueItems.push(`${r.Equipment || r.equipment || "?"} (${plant})`);
        }
        if ((r.Type || "").toLowerCase().includes("pm")) pmCount++;
        if ((r.Type || "").toLowerCase().includes("cm")) cmCount++;
      });

      ctx += `=== STATUS BREAKDOWN ===\n`;
      Object.entries(statusMap)
        .sort(([, a], [, b]) => (b as number) - (a as number))
        .forEach(([s, c]) => {
          ctx += `- ${s}: ${c}\n`;
        });

      ctx += `\n=== PLANT / FACILITY BREAKDOWN ===\n`;
      Object.entries(plantMap)
        .sort(([, a]: any, [, b]: any) => b.overdue - a.overdue)
        .forEach(([p, d]: any) => {
          ctx += `- ${p}: ${d.total} items, ${d.overdue} overdue\n`;
        });

      if (overdueItems.length > 0) {
        ctx += `\n=== OVERDUE ITEMS (${overdueItems.length}) ===\n`;
        overdueItems.slice(0, 15).forEach(item => {
          ctx += `- ${item}\n`;
        });
      }

      ctx += `\nWork Order Types: ${pmCount} PM, ${cmCount} CM\n`;
    }

    // --- GANTT dashboard ---
    else if (
      contextType === "gantt" &&
      (fields.includes("text") || fields.includes("name"))
    ) {
      const toDate = (value: any): Date | null => {
        if (!value) return null;
        const d = new Date(value);
        return Number.isNaN(d.getTime()) ? null : d;
      };
      const asNum = (value: any, fallback = 0): number => {
        const n = Number(value);
        return Number.isFinite(n) ? n : fallback;
      };
      const isCompletedStatus = (statusRaw: string): boolean => {
        const normalized = statusRaw.toLowerCase();
        return (
          normalized.includes("complete") ||
          normalized.includes("done") ||
          normalized === "closed"
        );
      };
      const pickDate = (...values: any[]): Date | null => {
        for (const value of values) {
          const parsed = toDate(value);
          if (parsed) return parsed;
        }
        return null;
      };
      const toStatus = (
        statusRaw: string,
        overdue: boolean,
        progress: number,
        completed: boolean
      ): string => {
        if (completed) return "Completed";
        if (statusRaw) return statusRaw;
        if (overdue) return "Overdue";
        if (progress > 0) return "In Progress";
        return "Not Started";
      };

      const totalTasks = data.length;
      const milestones = data.filter(
        (t: any) => (t.type || "").toLowerCase() === "milestone"
      ).length;
      const projects = data.filter(
        (t: any) => (t.type || "").toLowerCase() === "project"
      ).length;
      const parentTasks = data.filter(
        (t: any) =>
          t.parent === 0 || t.parent === undefined || t.parent === null
      ).length;
      const childTasks = data.filter(
        (t: any) => t.parent && t.parent !== 0
      ).length;
      const taskById = new Map(data.map((t: any) => [t.id, t]));
      const today = new Date();
      const todayMs = new Date(
        today.getFullYear(),
        today.getMonth(),
        today.getDate()
      ).getTime();
      const normalizedTasks = data.map((t: any) => {
        const progress = Math.max(
          0,
          Math.min(
            100,
            normProgress(t.progressPercent ?? t.progress_percent ?? t.progress)
          )
        );
        const duration = Math.max(0, asNum(t.duration, 0));
        const statusRaw =
          `${rowStatus(t) ?? t.status ?? t.Status ?? ""}`.trim();
        const completed =
          progress >= 100 ||
          isCompletedStatus(statusRaw) ||
          !!pickDate(
            t.actual_end,
            t.actualEnd,
            t.actual_end_date,
            t.actualEndDate,
            t.end_date,
            t.endDate
          );
        const plannedStart = pickDate(
          t.planned_start,
          t.plannedStart,
          t.start_date,
          t.startDate
        );
        const plannedEnd = pickDate(
          t.planned_end,
          t.plannedEnd,
          t.end_date,
          t.endDate
        );
        const actualStart = pickDate(
          t.actual_start,
          t.actualStart,
          t.actual_start_date,
          t.actualStartDate,
          t.start_date,
          t.startDate
        );
        const actualEnd = pickDate(
          t.actual_end,
          t.actualEnd,
          t.actual_end_date,
          t.actualEndDate,
          t.end_date,
          t.endDate
        );
        const scheduleEnd = actualEnd ?? plannedEnd;
        const isOverdue = !!(
          scheduleEnd &&
          scheduleEnd.getTime() < todayMs &&
          !completed
        );
        const predecessorId =
          t.predecessorTaskId ??
          t.predecessor_task_id ??
          t.predecessorId ??
          t.predecessor ??
          null;
        return {
          id: t.id,
          taskName: t.text || t.name || `Task ${t.id ?? "?"}`,
          type: `${t.taskType ?? t.type ?? "task"}`.toLowerCase(),
          parentId: t.parentTaskId ?? t.parent ?? 0,
          hierarchy: (t.parentTaskId ?? t.parent ?? 0) ? "child" : "parent",
          plannedStartRaw:
            t.planned_start ??
            t.plannedStart ??
            t.start_date ??
            t.startDate ??
            plannedStart?.toISOString() ??
            "",
          plannedEndRaw:
            t.planned_end ?? t.plannedEnd ?? t.end_date ?? t.endDate ?? "",
          actualStartRaw:
            t.actual_start ??
            t.actualStart ??
            t.actual_start_date ??
            t.actualStartDate ??
            t.start_date ??
            t.startDate ??
            actualStart?.toISOString() ??
            "",
          actualEndRaw:
            t.actual_end ??
            t.actualEnd ??
            t.actual_end_date ??
            t.actualEndDate ??
            t.end_date ??
            t.endDate ??
            "",
          duration,
          progress,
          status: toStatus(statusRaw, isOverdue, progress, completed),
          isCompleted: completed,
          isOverdue: isOverdue,
          predecessorId: predecessorId || null,
        };
      });

      const childrenByParent = new Map<number, any[]>();
      normalizedTasks.forEach(task => {
        if (!childrenByParent.has(task.parentId))
          childrenByParent.set(task.parentId, []);
        childrenByParent.get(task.parentId)!.push(task);
      });
      normalizedTasks.forEach(task => {
        const children = childrenByParent.get(task.id) || [];
        if (children.length === 0) return;
        const allChildrenCompleted = children.every(child => child.isCompleted);
        const anyChildInProgress = children.some(
          child => !child.isCompleted && child.progress > 0
        );
        const anyChildOverdue = children.some(child => child.isOverdue);
        if (allChildrenCompleted) {
          task.isCompleted = true;
          task.isOverdue = false;
          task.progress = 100;
          task.status = "Completed";
        } else if (anyChildOverdue) {
          task.status = "Overdue";
        } else if (anyChildInProgress) {
          task.status = "In Progress";
        } else {
          task.status = "Not Started";
        }
      });

      normalizedTasks.forEach(t => {
        if (t.isCompleted) {
          t.isOverdue = false;
          if (t.status.toLowerCase() === "not started") t.status = "Completed";
        }
      });

      const completedCount = normalizedTasks.filter(
        t => normalizeTaskStatus(t.status) === "completed"
      ).length;
      const inProgressCount = normalizedTasks.filter(
        t => normalizeTaskStatus(t.status) === "in progress"
      ).length;
      const notStartedCount = normalizedTasks.filter(
        t => normalizeTaskStatus(t.status) === "not started"
      ).length;
      const overdueCount = normalizedTasks.filter(t => {
        const end = pickDate(t.actualEndRaw, t.plannedEndRaw);
        return !!(
          end &&
          end.getTime() < todayMs &&
          normalizeTaskStatus(t.status) !== "completed"
        );
      }).length;
      const completionPct = calcProjectCompletion(
        normalizedTasks.map(t => ({
          status: t.status,
          progress_percent: taskCompletionPercent(t),
          duration_days: t.duration,
        }))
      );
      const avgDuration =
        normalizedTasks.length > 0
          ? (
              normalizedTasks.reduce((sum, t) => sum + t.duration, 0) /
              normalizedTasks.length
            ).toFixed(1)
          : "0.0";

      ctx += `=== GANTT SUMMARY ===\n`;
      ctx += `- Total Tasks: ${totalTasks}\n`;
      ctx += `- Milestones: ${milestones}\n`;
      ctx += `- Projects: ${projects}\n`;
      ctx += `- Parent Tasks: ${parentTasks}\n`;
      ctx += `- Sub-tasks: ${childTasks}\n`;
      ctx += `- Completed: ${completedCount}\n`;
      ctx += `- In Progress: ${inProgressCount}\n`;
      ctx += `- Not Started: ${notStartedCount}\n`;
      ctx += `- Overdue: ${overdueCount}\n`;
      ctx += `- Completion %: ${completionPct}%\n`;
      ctx += `- Average Duration: ${avgDuration} days\n`;

      // Date range
      const starts = data
        .map((t: any) => t.start_date)
        .filter(Boolean)
        .sort();
      const ends = data
        .map((t: any) => t.end_date)
        .filter(Boolean)
        .sort();
      if (starts.length && ends.length) {
        ctx += `- Date Range: ${starts[0]} to ${ends[ends.length - 1]}\n`;
      }

      ctx += `\n=== TASK RECORDS (max ${MAX_GANTT_TASK_ROWS}) ===\n`;
      normalizedTasks.slice(0, MAX_GANTT_TASK_ROWS).forEach((t, i) => {
        const parentName =
          t.parentId && taskById.get(t.parentId)
            ? taskById.get(t.parentId)?.text ||
              taskById.get(t.parentId)?.name ||
              `Task ${t.parentId}`
            : "ROOT";
        const predName =
          t.predecessorId && taskById.get(t.predecessorId)
            ? taskById.get(t.predecessorId)?.text ||
              taskById.get(t.predecessorId)?.name ||
              `Task ${t.predecessorId}`
            : "None";
        ctx += `${i + 1}. ${t.taskName} | type=${t.type} (${t.hierarchy}) | parent=${parentName} (${t.parentId || 0}) | plannedStart=${t.plannedStartRaw || "-"} | plannedEnd=${t.plannedEndRaw || "-"} | actualStart=${t.actualStartRaw || "-"} | actualEnd=${t.actualEndRaw || "-"} | dur=${t.duration}d | prog=${t.progress}% | status=${t.status} | isCompleted=${t.isCompleted ? "Y" : "N"} | isOverdue=${t.isOverdue ? "Y" : "N"} | pred=${predName}${t.predecessorId ? ` (${t.predecessorId})` : ""}\n`;
      });
      if (normalizedTasks.length > MAX_GANTT_TASK_ROWS) {
        ctx += `... ${normalizedTasks.length - MAX_GANTT_TASK_ROWS} more tasks not shown.\n`;
      }
    }

    // --- POST-PLANNING INSIGHTS dashboard ---
    else if (contextType === "postPlanningInsights") {
      const count = (field: string, value: string) =>
        data.filter(
          (r: any) => `${r[field] || ""}`.toLowerCase() === value.toLowerCase()
        ).length;
      const groupCount = (
        field: string,
        predicate: (r: any) => boolean = () => true
      ) => {
        const map: Record<string, number> = {};
        data.filter(predicate).forEach((r: any) => {
          const key = r[field] || "Blank";
          map[key] = (map[key] || 0) + 1;
        });
        return Object.entries(map).sort(([, a], [, b]) => b - a);
      };
      const loadByFutureDoer: Record<string, number> = {};
      data.forEach((r: any) => {
        const future = r.futureDoer || "Blank";
        loadByFutureDoer[future] =
          (loadByFutureDoer[future] || 0) + Number(r.monthlyResourceLoad || 0);
      });

      ctx += `=== POST-PLANNING OWNERSHIP MODEL ===\n`;
      ctx += `Responsible/currentPppDoer means Current PPP execution doer.\n`;
      ctx += `Operations, AMD, and ARD are preference fields only; use derived futureDoer for Future Post-PPP execution.\n`;
      ctx += `Future doer categories are only Operator, AMD In-house, and Outsourced SLA.\n`;
      ctx += `Use this context to answer current PPP execution, future post-PPP execution, transition workload, training backlog, SMP backlog, and resource requirements.\n`;

      ctx += `\nFuture Post-PPP Execution Model:\n`;
      ["Operator", "AMD In-house", "Outsourced SLA"].forEach(name => {
        ctx += `- ${name}: ${count("futureDoer", name)} tasks\n`;
      });

      ctx += `\nCurrent PPP Execution (top doers):\n`;
      groupCount("currentPppDoer")
        .slice(0, 10)
        .forEach(([name, c]) => {
          ctx += `- ${name}: ${c} tasks\n`;
        });

      ctx += `\nTransition Workload (Current PPP Doer -> Future Doer):\n`;
      groupCount("transition")
        .slice(0, 12)
        .forEach(([name, c]) => {
          ctx += `- ${name}: ${c} tasks\n`;
        });

      ctx += `\nTraining Backlog by Future Doer:\n`;
      ["Operator", "AMD In-house", "Outsourced SLA"].forEach(name => {
        ctx += `- ${name}: ${data.filter((r: any) => r.futureDoer === name && r.trainingBacklog === "Yes").length} tasks\n`;
      });

      ctx += `\nSMP Backlog by Future Doer:\n`;
      ["Operator", "AMD In-house", "Outsourced SLA"].forEach(name => {
        ctx += `- ${name}: ${data.filter((r: any) => r.futureDoer === name && r.smpBacklog === "Yes").length} tasks\n`;
      });

      ctx += `\nResource Requirements by Future Doer (monthly load units):\n`;
      ["Operator", "AMD In-house", "Outsourced SLA"].forEach(name => {
        ctx += `- ${name}: ${(loadByFutureDoer[name] || 0).toFixed(2)}\n`;
      });
    }

    // --- GOVERNANCE dashboard ---
    else if (contextType === "governance" && fields.includes("milestone")) {
      const statusMap: Record<string, number> = {};
      data.forEach((r: any) => {
        const st = r.status || r.Status || "Unknown";
        statusMap[st] = (statusMap[st] || 0) + 1;
      });
      ctx += `=== MILESTONE STATUS ===\n`;
      Object.entries(statusMap).forEach(([s, c]) => {
        ctx += `- ${s}: ${c}\n`;
      });
    }

    // --- SMP dashboard ---
    else if (
      contextType === "smp" ||
      fields.includes("smp") ||
      fields.includes("SMP") ||
      fields.includes("document") ||
      fields.includes("Document")
    ) {
      ctx += `=== SMP DOCUMENTS ===\n`;
      ctx += `Total Documents: ${data.length}\n`;

      const statusMap: Record<string, number> = {};
      const equipMap: Record<string, number> = {};
      const respMap: Record<string, number> = {};

      data.forEach((r: any) => {
        const st = r.Status || r.status || "Unknown";
        statusMap[st] = (statusMap[st] || 0) + 1;
        const eq =
          r.EquipmentType ||
          r.equipmentType ||
          r.System ||
          r.system ||
          "Unknown";
        equipMap[eq] = (equipMap[eq] || 0) + 1;
        const resp =
          r.Responsible || r.responsible || r.Owner || r.owner || "Unknown";
        respMap[resp] = (respMap[resp] || 0) + 1;
      });

      ctx += `\nStatus Breakdown:\n`;
      Object.entries(statusMap).forEach(([s, c]) => {
        ctx += `- ${s}: ${c}\n`;
      });

      ctx += `\nEquipment Types:\n`;
      Object.entries(equipMap)
        .sort(([, a], [, b]) => (b as number) - (a as number))
        .slice(0, 10)
        .forEach(([e, c]) => {
          ctx += `- ${e}: ${c}\n`;
        });

      ctx += `\nResponsible Parties:\n`;
      Object.entries(respMap)
        .sort(([, a], [, b]) => (b as number) - (a as number))
        .slice(0, 10)
        .forEach(([r, c]) => {
          ctx += `- ${r}: ${c}\n`;
        });
    }

    // --- SCORECARD dashboard ---
    else if (
      contextType === "scorecard" ||
      fields.includes("kpi") ||
      fields.includes("KPI")
    ) {
      ctx += `=== KPI DATA ===\n`;
      ctx += `Total KPIs: ${data.length}\n\n`;

      data.slice(0, 20).forEach((r: any, i: number) => {
        const name = r.kpi || r.KPI || r.name || r.Name || `KPI ${i + 1}`;
        const actual = r.actual ?? r.Actual ?? r.value ?? r.Value ?? "N/A";
        const target =
          r.target ?? r.Target ?? r.benchmark ?? r.Benchmark ?? "N/A";
        const status = (r.status || r.Status) ?? "";
        ctx += `${i + 1}. ${name}: Actual=${actual}, Target=${target}${status ? `, Status=${status}` : ""}\n`;
      });
    }

    // --- Generic array fallback ---
    else {
      ctx += `Fields: ${fields.join(", ")}\n\n`;

      // Numeric summary for numeric fields
      const numericFields = fields.filter(f => {
        const v = first[f];
        return (
          typeof v === "number" ||
          (typeof v === "string" && !isNaN(Number(v)) && v !== "")
        );
      });

      if (numericFields.length > 0) {
        ctx += `=== NUMERIC SUMMARIES ===\n`;
        numericFields.forEach(f => {
          const values = data
            .map((r: any) => Number(r[f]))
            .filter((v: number) => !isNaN(v));
          if (values.length > 0) {
            const sum = values.reduce((a: number, b: number) => a + b, 0);
            const avg = (sum / values.length).toFixed(1);
            const max = Math.max(...values);
            const min = Math.min(...values);
            ctx += `- ${f}: sum=${sum}, avg=${avg}, min=${min}, max=${max}\n`;
          }
        });
        ctx += `\n`;
      }

      // Show an excerpt of actual dashboard rows unless a dashboard opts out.
      if (!metadata?.disableSampleRecords) {
        ctx += `=== DASHBOARD RECORDS EXCERPT (first ${Math.min(10, data.length)}) ===\n`;
        data.slice(0, 10).forEach((r: any, i: number) => {
          const summary = fields
            .slice(0, 5)
            .map(f => `${f}=${JSON.stringify(r[f]).slice(0, 40)}`)
            .join(", ");
          ctx += `${i + 1}. ${summary}\n`;
        });
      }
    }
  }

  // Handle objects (non-array)
  else if (typeof data === "object" && data !== null) {
    const keys = Object.keys(data);
    ctx += `Data Type: Object with keys [${keys.join(", ")}]\n`;

    if (contextType === "scorecard") {
      const kpis = Array.isArray(data.kpis) ? data.kpis : [];
      const hasRuntimeData =
        kpis.length > 0 || !!data.aggregates || !!data.monthlyScoreData;
      ctx += `=== MONTHLY KPI IFRAME RUNTIME STATE ===\n`;
      ctx += `Selected BU/year/month: ${data.selectedBusinessUnitId ?? "not loaded"}/${data.selectedYear ?? "not loaded"}/${data.selectedMonth ?? "not loaded"}\n`;
      ctx += `KPIs loaded: ${kpis.length}\n`;
      if (!hasRuntimeData) {
        ctx += `Status: KPI iframe runtime data is not loaded. Do not invent KPI values.\n`;
      } else {
        ctx += `KPI Definitions: ${JSON.stringify(kpis).slice(0, 1200)}\n`;
        ctx += `KpiAggregates: ${JSON.stringify(data.aggregates ?? null).slice(0, 1200)}\n`;
        ctx += `MonthlyScoreData: ${JSON.stringify(data.monthlyScoreData ?? null).slice(0, 1200)}\n`;
      }
    }

    if (contextType === "gantt" && Array.isArray(data.tasks)) {
      ctx += buildDataContext(data.tasks, contextType, filters, metadata);
      const links = Array.isArray(data.links) ? data.links : [];
      ctx += `=== GANTT LINKS / DEPENDENCIES ===\n`;
      ctx += `Total Links: ${links.length}\n`;
      links.slice(0, 40).forEach((l: any, i: number) => {
        ctx += `${i + 1}. source=${l.source ?? l.predecessorTaskId ?? "?"} target=${l.target ?? l.successorTaskId ?? "?"} type=${l.type ?? l.dependencyType ?? "FS"} lag=${l.lag ?? l.lagDays ?? 0}\n`;
      });
    }

    // O&M Manuals folder structure
    if (contextType === "manuals") {
      if (data.folders !== undefined) ctx += `Folders: ${data.folders}\n`;
      if (data.files !== undefined) ctx += `Files: ${data.files}\n`;
      if (data.tree) {
        const countNodes = (node: any, depth = 0): number => {
          if (!node || typeof node !== "object") return 0;
          let count = 1;
          Object.values(node).forEach((child: any) => {
            if (typeof child === "object" && child !== null)
              count += countNodes(child, depth + 1);
          });
          return count;
        };
        ctx += `Tree nodes: ${countNodes(data.tree)}\n`;
      }
    }

    // Help context
    if (contextType === "help") {
      ctx += `Help Topics: ${keys.filter(k => k !== "__html").join(", ")}\n`;
    }
  }

  ctx += `\n`;
  return ctx;
}

export default function AIAssistant({
  contextType,
  data,
  filters,
  metadata,
  title,
  quickQuestions,
}: AIAssistantProps) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<
    { role: "user" | "assistant"; content: string }[]
  >([]);
  const [loading, setLoading] = useState(false);
  const [odmTalkStatus, setOdmTalkStatus] = useState("");
  const [selectedThreadId, setSelectedThreadId] = useState("");
  const [listening, setListening] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState("");
  const [voiceReplyEnabled, setVoiceReplyEnabled] = useState(false);
  const [copyStatus, setCopyStatus] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<VoiceRecognition | null>(null);
  const voiceCaptureTimeoutRef = useRef<ReturnType<
    typeof globalThis.setTimeout
  > | null>(null);
  const manualVoiceStopRef = useRef(false);
  const voiceReplyEnabledRef = useRef(voiceReplyEnabled);
  const hasModuleData = hasUsableModuleData(data, contextType, metadata);
  const odmTalkSource = inferOdmTalkSource(
    contextType,
    title,
    metadata,
    filters
  );
  const relatedThreads = trpc.odmTalk.related.useQuery(
    {
      sourceModule: odmTalkSource.sourceModule,
      sourceRecordId: odmTalkSource.sourceRecordId,
    },
    { enabled: open }
  );
  const odmTalkUtils = trpc.useUtils();
  const createOdmTalkThread = trpc.odmTalk.createThread.useMutation({
    onSuccess: res => {
      setSelectedThreadId(String(res.threadId));
      setOdmTalkStatus(`Posted to ODM Talk thread #${res.threadId}.`);
      odmTalkUtils.odmTalk.related.invalidate({
        sourceModule: odmTalkSource.sourceModule,
        sourceRecordId: odmTalkSource.sourceRecordId,
      });
    },
    onError: e => setOdmTalkStatus(`ODM Talk post failed: ${e.message}`),
  });
  const postToOdmTalkThread = trpc.odmTalk.postToThread.useMutation({
    onSuccess: res => {
      setOdmTalkStatus(`Added to ODM Talk thread #${res.threadId}.`);
      odmTalkUtils.odmTalk.related.invalidate({
        sourceModule: odmTalkSource.sourceModule,
        sourceRecordId: odmTalkSource.sourceRecordId,
      });
    },
    onError: e => setOdmTalkStatus(`ODM Talk post failed: ${e.message}`),
  });

  const speakAssistantReply = (reply: string) => {
    if (!voiceReplyEnabledRef.current) return;

    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      setVoiceStatus(VOICE_REPLY_UNSUPPORTED_MESSAGE);
      return;
    }

    const Utterance =
      window.SpeechSynthesisUtterance ||
      (typeof SpeechSynthesisUtterance !== "undefined"
        ? SpeechSynthesisUtterance
        : undefined);
    if (!Utterance) {
      setVoiceStatus(VOICE_REPLY_UNSUPPORTED_MESSAGE);
      return;
    }

    const speechReply = buildSpeechFriendlyAssistantReply(reply);
    if (!speechReply) return;

    window.speechSynthesis.cancel();
    const utterance = new Utterance(speechReply);
    window.speechSynthesis.speak(utterance);
  };

  const appendAssistantMessage = (content: string) => {
    setMessages(prev => [...prev, { role: "assistant", content }]);
    speakAssistantReply(content);
  };

  const chatMut = trpc.ai.maintenanceChat.useMutation({
    onSuccess: res => {
      setLoading(false);
      appendAssistantMessage(res.reply);
    },
    onError: e => {
      setLoading(false);
      appendAssistantMessage(
        `⚠️ Error: ${e.message}\n\nThe AI service may not be configured. Please set OLLAMA_BASE_URL (and OLLAMA_API_KEY if required) in your environment variables.\n\nFor local development, point OLLAMA_BASE_URL to your Ollama endpoint (e.g., http://localhost:11434).`
      );
    },
  });

  useEffect(() => {
    voiceReplyEnabledRef.current = voiceReplyEnabled;
    if (
      !voiceReplyEnabled &&
      typeof window !== "undefined" &&
      "speechSynthesis" in window
    ) {
      window.speechSynthesis.cancel();
    }
  }, [voiceReplyEnabled]);

  useEffect(() => {
    return () => {
      if (voiceCaptureTimeoutRef.current) {
        globalThis.clearTimeout(voiceCaptureTimeoutRef.current);
        voiceCaptureTimeoutRef.current = null;
      }
      recognitionRef.current?.stop();
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, loading]);

  const send = (text?: string) => {
    const msg = (text || input).trim();
    if (!msg || loading) return;
    setInput("");
    setMessages(prev => [...prev, { role: "user", content: msg }]);

    if (!hasModuleData && isDataAnalysisQuestion(msg)) {
      appendAssistantMessage(MODULE_DATA_NOT_LOADED_MESSAGE);
      return;
    }

    setLoading(true);

    // Build data context and prepend to message
    const dataContext = buildDataContext(data, contextType, filters, metadata);
    const odmTalkContext = relatedThreads.data?.length
      ? `\n=== RELATED ODM TALK THREADS (secondary context only; module data remains source of truth) ===\n${relatedThreads.data.map(t => `- #${t.id} ${t.threadType}: ${t.title} (${t.status})`).join("\n")}\n`
      : "";
    const baseInstruction =
      contextType === "gantt"
        ? `${DASHBOARD_GROUNDING_INSTRUCTION} Be specific with numbers and task names. If task rows are provided, do not ask for more data and instead analyze delays, overdue tasks, dependencies, and likely schedule drivers from the provided records. Completed tasks are not overdue even if planned finish date is in the past. If a task is completed, do not classify it as delayed or overdue.`
        : `${DASHBOARD_GROUNDING_INSTRUCTION} Be specific with numbers and names from the active module data.`;
    let fullMessage =
      dataContext +
      odmTalkContext +
      `=== REQUIRED ANSWERING RULES ===\n${baseInstruction}\n\nUSER QUESTION: ${msg}`;
    if (fullMessage.length > MAX_AI_CONTEXT_CHARS) {
      const keepTail = `\n\n=== REQUIRED ANSWERING RULES ===\n${baseInstruction}\n\nUSER QUESTION: ${msg}`;
      const allowedContext = Math.max(
        0,
        MAX_AI_CONTEXT_CHARS - keepTail.length
      );
      const summarized = dataContext.slice(0, allowedContext);
      fullMessage = `${summarized}\n[context summarized due to size]${keepTail}`;
    }

    const history = messages.slice(-6).map(m => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

    chatMut.mutate({ message: fullMessage, history });
  };

  const startVoiceListening = () => {
    if (listening || loading) return;

    const Recognition = getSpeechRecognitionConstructor();
    if (!Recognition) {
      setVoiceStatus(VOICE_UNSUPPORTED_MESSAGE);
      return;
    }

    const recognition = new Recognition();
    manualVoiceStopRef.current = false;
    recognitionRef.current = recognition;
    recognition.lang = "en-US";
    recognition.continuous = false;
    recognition.interimResults = true;

    let finalTranscript = "";
    let hadVoiceError = false;

    recognition.onstart = () => {
      setListening(true);
      setVoiceStatus("Listening…");
      if (voiceCaptureTimeoutRef.current) {
        globalThis.clearTimeout(voiceCaptureTimeoutRef.current);
      }
      voiceCaptureTimeoutRef.current = globalThis.setTimeout(() => {
        if (recognitionRef.current === recognition) {
          hadVoiceError = true;
          recognitionRef.current = null;
          setListening(false);
          setVoiceStatus(NO_VOICE_CAPTURED_MESSAGE);
          recognition.stop();
        }
      }, VOICE_CAPTURE_TIMEOUT_MS);
    };

    recognition.onresult = event => {
      const transcript = Array.from(event.results)
        .map(result => result[0]?.transcript || "")
        .join(" ")
        .trim();
      if (transcript) {
        finalTranscript = transcript;
        setInput(transcript);
        if (voiceCaptureTimeoutRef.current) {
          globalThis.clearTimeout(voiceCaptureTimeoutRef.current);
          voiceCaptureTimeoutRef.current = null;
        }
      }
    };

    recognition.onerror = event => {
      hadVoiceError = true;
      if (voiceCaptureTimeoutRef.current) {
        globalThis.clearTimeout(voiceCaptureTimeoutRef.current);
        voiceCaptureTimeoutRef.current = null;
      }
      if (recognitionRef.current === recognition) {
        recognitionRef.current = null;
      }
      setVoiceStatus(describeSpeechRecognitionError(event));
      setListening(false);
    };

    recognition.onend = () => {
      if (voiceCaptureTimeoutRef.current) {
        globalThis.clearTimeout(voiceCaptureTimeoutRef.current);
        voiceCaptureTimeoutRef.current = null;
      }
      setListening(false);
      if (recognitionRef.current === recognition) {
        recognitionRef.current = null;
      }
      if (manualVoiceStopRef.current) {
        manualVoiceStopRef.current = false;
        return;
      }
      if (finalTranscript.trim()) {
        setInput(finalTranscript);
        setVoiceStatus(VOICE_CAPTURED_REVIEW_MESSAGE);
      } else if (!hadVoiceError) {
        setVoiceStatus(NO_VOICE_CAPTURED_MESSAGE);
      }
    };

    try {
      recognition.start();
    } catch {
      if (voiceCaptureTimeoutRef.current) {
        globalThis.clearTimeout(voiceCaptureTimeoutRef.current);
        voiceCaptureTimeoutRef.current = null;
      }
      recognitionRef.current = null;
      manualVoiceStopRef.current = false;
      setListening(false);
      setVoiceStatus(
        "Voice input is already active. Please stop listening before starting again."
      );
    }
  };

  const stopVoiceListening = () => {
    if (voiceCaptureTimeoutRef.current) {
      globalThis.clearTimeout(voiceCaptureTimeoutRef.current);
      voiceCaptureTimeoutRef.current = null;
    }
    const recognition = recognitionRef.current;
    manualVoiceStopRef.current = true;
    recognitionRef.current = null;
    recognition?.stop();
    setListening(false);
    setVoiceStatus("");
  };

  const copyAssistantMessage = async (content: string) => {
    if (!content) return;
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(content);
      } else if (typeof document !== "undefined") {
        const textarea = document.createElement("textarea");
        textarea.value = content;
        textarea.style.position = "fixed";
        textarea.style.left = "-9999px";
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
      }
      setCopyStatus("Copied assistant response.");
      globalThis.setTimeout(() => setCopyStatus(""), 2200);
    } catch {
      setCopyStatus(
        "Copy failed. Please select and copy the response manually."
      );
    }
  };

  const prompts = hasModuleData
    ? quickQuestions || CONTEXT_PROMPTS[contextType] || CONTEXT_PROMPTS.help
    : GENERAL_HELP_PROMPTS;

  const lastAssistantMessage =
    [...messages].reverse().find(m => m.role === "assistant")?.content || "";
  const postLastAssistantMessage = (
    threadType: OdmTalkThreadType,
    shareType: OdmTalkShareType,
    threadId?: number
  ) => {
    if (
      !lastAssistantMessage ||
      createOdmTalkThread.isPending ||
      postToOdmTalkThread.isPending
    )
      return;
    const payload = {
      ...odmTalkSource,
      threadType,
      shareType,
      title: `${threadType}: ${odmTalkSource.sourceRecordLabel || odmTalkSource.sourceRecordId}`,
      content: formatOdmTalkAiPost(lastAssistantMessage, odmTalkSource),
    };
    setOdmTalkStatus("Posting to ODM Talk...");
    if (threadId) {
      postToOdmTalkThread.mutate({ ...payload, threadId });
    } else {
      createOdmTalkThread.mutate(payload);
    }
  };

  return (
    <>
      {/* Floating button */}
      <button
        className="odm-ai-fab"
        onClick={() => setOpen(!open)}
        title={SHARED_ASSISTANT_TITLE}
        aria-label={
          open
            ? `Close ${SHARED_ASSISTANT_TITLE}`
            : `Open ${SHARED_ASSISTANT_TITLE}`
        }
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2z" />
          <path d="M12 16v-4" />
          <path d="M12 8h.01" />
        </svg>
      </button>

      {/* Panel */}
      {open && (
        <div
          className="odm-ai-panel"
          role="dialog"
          aria-label={SHARED_ASSISTANT_TITLE}
        >
          {/* Header */}
          <div className="odm-ai-header">
            <div className="odm-ai-title-wrap">
              <span className="odm-ai-header-icon" aria-hidden="true">
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2z" />
                  <path d="M12 16v-4" />
                  <path d="M12 8h.01" />
                </svg>
              </span>
              <div>
                <div className="odm-ai-title">{SHARED_ASSISTANT_TITLE}</div>
                <div className="odm-ai-subtitle">
                  {SHARED_ASSISTANT_SUBTITLE}
                </div>
              </div>
            </div>
            <div className="odm-ai-header-actions">
              <button
                onClick={() => {
                  setMessages([]);
                  setOdmTalkStatus("");
                  setCopyStatus("");
                }}
                className="odm-ai-header-btn"
              >
                Clear
              </button>
              <button
                onClick={() => setOpen(false)}
                className="odm-ai-close-btn"
                aria-label="Close AI assistant"
              >
                &times;
              </button>
            </div>
          </div>

          {/* Messages */}
          <div ref={scrollRef} className="odm-ai-messages">
            {messages.length === 0 && (
              <div className="odm-ai-empty-state">
                <div className="odm-ai-empty-icon">✨</div>
                <p>Ask AI to analyze this dashboard&apos;s data.</p>
                <div className="odm-ai-prompt-grid">
                  {prompts.map(p => (
                    <button
                      key={p}
                      onClick={() => send(p)}
                      className="odm-ai-prompt-chip"
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((m, i) => (
              <div
                key={`${m.role}-${i}`}
                className={`odm-ai-message-row ${m.role === "user" ? "odm-ai-message-row-user" : "odm-ai-message-row-assistant"}`}
              >
                <div
                  className={`odm-ai-message-bubble ${m.role === "user" ? "odm-ai-user-bubble" : "odm-ai-assistant-bubble"}`}
                >
                  {m.content}
                </div>
                {m.role === "assistant" && (
                  <button
                    onClick={() => copyAssistantMessage(m.content)}
                    className="odm-ai-copy-btn"
                    aria-label="Copy assistant response"
                  >
                    Copy
                  </button>
                )}
              </div>
            ))}
            {loading && (
              <div
                className="odm-ai-loading-bubble"
                aria-label="AI response loading"
              >
                <span className="odm-ai-loading-dot" />
                <span className="odm-ai-loading-dot" />
                <span className="odm-ai-loading-dot" />
              </div>
            )}
          </div>

          <div className="odm-ai-footer">
            {/* Voice controls: kept immediately above the input row on desktop and mobile. */}
            <div
              className="odm-ai-voice-controls"
              aria-label="AI voice controls"
            >
              <button
                onClick={startVoiceListening}
                disabled={listening || loading}
                title="Start voice listening"
                aria-label="Start voice listening"
                className="odm-ai-voice-btn odm-ai-voice-start"
              >
                🎙️ Start voice listening
              </button>
              <button
                onClick={stopVoiceListening}
                disabled={!listening}
                title="Stop voice listening"
                aria-label="Stop voice listening"
                className="odm-ai-voice-btn odm-ai-voice-stop"
              >
                Stop
              </button>
              <button
                onClick={() => setVoiceReplyEnabled(enabled => !enabled)}
                title={voiceReplyEnabled ? "Voice reply ON" : "Voice reply OFF"}
                aria-label={
                  voiceReplyEnabled ? "Voice reply ON" : "Voice reply OFF"
                }
                className={`odm-ai-voice-btn odm-ai-voice-reply ${voiceReplyEnabled ? "odm-ai-voice-reply-on" : ""}`}
              >
                {voiceReplyEnabled ? "Voice reply ON" : "Voice reply OFF"}
              </button>
              <button
                onClick={() => {
                  const lastAssistantReply = [...messages]
                    .reverse()
                    .find(message => message.role === "assistant")?.content;
                  if (lastAssistantReply)
                    speakAssistantReply(lastAssistantReply);
                }}
                disabled={
                  !voiceReplyEnabled ||
                  !messages.some(message => message.role === "assistant")
                }
                title="Speak last reply"
                aria-label="Speak last reply"
                className="odm-ai-voice-btn odm-ai-voice-speak-last"
              >
                Speak last reply
              </button>
              {voiceStatus && (
                <span
                  className={`odm-ai-voice-status ${voiceStatus === VOICE_UNSUPPORTED_MESSAGE || voiceStatus === VOICE_REPLY_UNSUPPORTED_MESSAGE || voiceStatus.includes("Microphone permission") ? "odm-ai-status-error" : ""}`}
                >
                  {listening ? "Listening…" : voiceStatus}
                </span>
              )}
            </div>

            {/* Input */}
            <div className="odm-ai-input-row">
              <textarea
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send();
                  }
                }}
                placeholder="Ask about this dashboard's data..."
                rows={1}
                className="odm-ai-input"
              />
              <button
                onClick={() => send()}
                disabled={!input.trim() || loading}
                className="odm-ai-send-btn"
              >
                Send
              </button>
            </div>

            {/* ODM Talk bridge actions */}
            <div className="odm-ai-odm-talk">
              <div className="odm-ai-odm-talk-header">
                <span>ODM Talk Bridge</span>
                <a href="/odm-talk">Open Hub</a>
              </div>
              <div className="odm-ai-odm-actions">
                <button
                  onClick={() =>
                    postLastAssistantMessage("General Discussion", "AI summary")
                  }
                  disabled={
                    !lastAssistantMessage || createOdmTalkThread.isPending
                  }
                >
                  Send to ODM Talk
                </button>
                <button
                  onClick={() =>
                    postLastAssistantMessage("General Discussion", "AI summary")
                  }
                  disabled={
                    !lastAssistantMessage || createOdmTalkThread.isPending
                  }
                >
                  Create Discussion
                </button>
                <button
                  onClick={() =>
                    postLastAssistantMessage("General Discussion", "AI summary")
                  }
                  disabled={
                    !lastAssistantMessage || createOdmTalkThread.isPending
                  }
                >
                  Share Summary
                </button>
                <button
                  onClick={() =>
                    postLastAssistantMessage("Post-PPP Decision", "Decision")
                  }
                  disabled={
                    !lastAssistantMessage || createOdmTalkThread.isPending
                  }
                >
                  Create Decision Thread
                </button>
                <button
                  onClick={() =>
                    postLastAssistantMessage(
                      "Maintenance Recommendation",
                      "AI recommendation"
                    )
                  }
                  disabled={
                    !lastAssistantMessage || createOdmTalkThread.isPending
                  }
                >
                  Share Recommendation
                </button>
                <button
                  onClick={() =>
                    postLastAssistantMessage(
                      "Action Tracking",
                      "AI-generated action items"
                    )
                  }
                  disabled={
                    !lastAssistantMessage || createOdmTalkThread.isPending
                  }
                >
                  Share Action Items
                </button>
              </div>
              <div className="odm-ai-discussion-row">
                <select
                  value={selectedThreadId}
                  onChange={e => setSelectedThreadId(e.target.value)}
                >
                  <option value="">Add to Discussion...</option>
                  {(relatedThreads.data || []).map(thread => (
                    <option key={thread.id} value={thread.id}>
                      #{thread.id} {thread.threadType}
                    </option>
                  ))}
                </select>
                <button
                  onClick={() =>
                    selectedThreadId &&
                    postLastAssistantMessage(
                      "General Discussion",
                      "AI summary",
                      Number(selectedThreadId)
                    )
                  }
                  disabled={
                    !lastAssistantMessage ||
                    !selectedThreadId ||
                    postToOdmTalkThread.isPending
                  }
                >
                  Add to Discussion
                </button>
              </div>
              <div
                className={`odm-ai-bridge-status ${odmTalkStatus.includes("failed") ? "odm-ai-status-error" : ""}`}
              >
                {odmTalkStatus ||
                  copyStatus ||
                  `${odmTalkSource.assistantName} shares labels, backlinks, source record metadata, and keeps ${odmTalkSource.sourceModule} data as primary context.`}
              </div>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .odm-ai-fab {
          position: fixed;
          bottom: calc(1rem + env(safe-area-inset-bottom));
          right: 1rem;
          z-index: 2147483000;
          width: 48px;
          height: 48px;
          border-radius: 999px;
          background: linear-gradient(135deg, #7C3AED, #6D28D9);
          color: #fff;
          border: none;
          box-shadow: 0 4px 16px rgba(124, 58, 237, .35);
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: transform .2s ease, box-shadow .2s ease;
        }
        .odm-ai-fab:hover { transform: translateY(-1px); box-shadow: 0 8px 22px rgba(124, 58, 237, .42); }
        .odm-ai-panel {
          position: fixed;
          bottom: calc(5.5rem + env(safe-area-inset-bottom));
          right: 1rem;
          z-index: 2147483000;
          width: min(390px, calc(100vw - 32px));
          height: min(560px, calc(100dvh - 120px));
          background: #fff;
          border-radius: 16px;
          box-shadow: 0 20px 60px rgba(15, 23, 42, .26);
          display: flex;
          flex-direction: column;
          overflow: hidden;
          font-family: Inter, sans-serif;
          border: 1px solid #D6DFE8;
        }
        .odm-ai-header { padding: 12px 14px; background: linear-gradient(135deg, #7C3AED, #6D28D9); color: #fff; display: flex; align-items: center; gap: 10px; justify-content: space-between; }
        .odm-ai-title-wrap { min-width: 0; display: flex; align-items: center; gap: 8px; }
        .odm-ai-header-icon { flex: 0 0 auto; display: inline-flex; }
        .odm-ai-title { font-size: 12px; font-weight: 800; line-height: 1.2; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 220px; }
        .odm-ai-subtitle { font-size: 9px; opacity: .78; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 220px; }
        .odm-ai-header-actions { display: flex; align-items: center; gap: 6px; flex: 0 0 auto; }
        .odm-ai-header-btn, .odm-ai-close-btn { background: rgba(255,255,255,.12); border: none; color: #fff; cursor: pointer; border-radius: 7px; font-family: Inter, sans-serif; }
        .odm-ai-header-btn { font-size: 10px; padding: 5px 8px; font-weight: 700; }
        .odm-ai-close-btn { font-size: 20px; line-height: 1; width: 28px; height: 28px; }
        .odm-ai-messages { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 8px; background: #fff; }
        .odm-ai-empty-state { text-align: center; padding: 16px 8px; color: #94A3B8; font-size: 11px; }
        .odm-ai-empty-state p { margin: 0 0 12px; }
        .odm-ai-empty-icon { width: 30px; height: 30px; margin: 0 auto 8px; border-radius: 999px; background: #F5F3FF; color: #6D28D9; display: flex; align-items: center; justify-content: center; }
        .odm-ai-prompt-grid { display: flex; flex-wrap: wrap; gap: 6px; justify-content: center; }
        .odm-ai-prompt-chip { padding: 4px 10px; font-size: 10px; border: 1px solid #D6DFE8; border-radius: 12px; background: #fff; color: #475569; cursor: pointer; font-family: Inter, sans-serif; }
        .odm-ai-message-row { max-width: 88%; display: flex; flex-direction: column; gap: 3px; }
        .odm-ai-message-row-user { align-self: flex-end; align-items: flex-end; }
        .odm-ai-message-row-assistant { align-self: flex-start; align-items: flex-start; }
        .odm-ai-message-bubble { padding: 7px 10px; font-size: 11px; line-height: 1.5; white-space: pre-wrap; word-break: break-word; }
        .odm-ai-user-bubble { border-radius: 11px 11px 3px 11px; background: #7C3AED; color: #fff; }
        .odm-ai-assistant-bubble { border-radius: 11px 11px 11px 3px; background: #F1F5F9; color: #2D3748; }
        .odm-ai-copy-btn { font-size: 9px; color: #64748B; background: none; border: none; cursor: pointer; padding: 0 2px; font-family: Inter, sans-serif; font-weight: 700; }
        .odm-ai-loading-bubble { align-self: flex-start; padding: 8px 12px; background: #F1F5F9; border-radius: 11px 11px 11px 3px; display: inline-flex; gap: 3px; }
        .odm-ai-loading-dot { width: 5px; height: 5px; background: #94A3B8; border-radius: 999px; animation: dotPulse 1.4s ease-in-out infinite; }
        .odm-ai-loading-dot:nth-child(2) { animation-delay: .2s; }
        .odm-ai-loading-dot:nth-child(3) { animation-delay: .4s; }
        .odm-ai-footer { flex: 0 0 auto; border-top: 1px solid #E2E8F0; background: #fff; }
        .odm-ai-voice-controls { padding: 8px 12px 6px; display: flex; align-items: center; gap: 6px; flex-wrap: wrap; background: #FFFFFF; }
        .odm-ai-voice-btn { padding: 5px 8px; font-size: 10px; font-weight: 800; border-radius: 8px; cursor: pointer; font-family: Inter, sans-serif; }
        .odm-ai-voice-btn:disabled { cursor: not-allowed; }
        .odm-ai-voice-start { border: 1px solid #C4B5FD; background: #FFFFFF; color: #5B21B6; }
        .odm-ai-voice-start:disabled { background: #F5F3FF; }
        .odm-ai-voice-stop { border: 1px solid #CBD5E1; background: #FFFFFF; color: #334155; }
        .odm-ai-voice-stop:disabled { background: #F1F5F9; }
        .odm-ai-voice-reply { border: 1px solid #BAE6FD; background: #FFFFFF; color: #075985; }
        .odm-ai-voice-reply-on { background: #E0F2FE; }
        .odm-ai-voice-status { flex-basis: 100%; font-size: 10px; color: #64748B; }
        .odm-ai-status-error { color: #B91C1C; }
        .odm-ai-input-row { padding: 0 12px 8px; display: flex; gap: 6px; align-items: flex-end; }
        .odm-ai-input { flex: 1; min-width: 0; padding: 7px 10px; font-size: 11px; border: 1px solid #D6DFE8; border-radius: 8px; font-family: Inter, sans-serif; resize: none; outline: none; max-height: 64px; line-height: 1.4; }
        .odm-ai-send-btn { padding: 7px 14px; font-size: 11px; font-weight: 800; background: #7C3AED; color: #fff; border: none; border-radius: 8px; cursor: pointer; font-family: Inter, sans-serif; }
        .odm-ai-send-btn:disabled { background: #CBD5E1; cursor: not-allowed; }
        .odm-ai-odm-talk { padding: 8px 12px; border-top: 1px solid #E2E8F0; background: #FAFBFF; }
        .odm-ai-odm-talk-header { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 6px; }
        .odm-ai-odm-talk-header span { font-size: 10px; font-weight: 900; color: #334155; text-transform: uppercase; letter-spacing: .5px; }
        .odm-ai-odm-talk-header a { font-size: 10px; color: #2563EB; text-decoration: none; font-weight: 800; }
        .odm-ai-odm-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-bottom: 6px; }
        .odm-ai-odm-actions button, .odm-ai-discussion-row button { padding: 5px 8px; font-size: 10px; border: 1px solid #C7D2FE; border-radius: 8px; background: #EEF2FF; color: #3730A3; cursor: pointer; font-weight: 800; font-family: Inter, sans-serif; }
        .odm-ai-odm-actions button:disabled, .odm-ai-discussion-row button:disabled { background: #F1F5F9; color: #64748B; border-color: #CBD5E1; cursor: not-allowed; }
        .odm-ai-discussion-row { display: flex; gap: 6px; }
        .odm-ai-discussion-row select { flex: 1; min-width: 0; padding: 5px 6px; font-size: 10px; border: 1px solid #CBD5E1; border-radius: 8px; font-family: Inter, sans-serif; }
        .odm-ai-bridge-status { margin-top: 5px; font-size: 9px; color: #64748B; line-height: 1.35; }
        @media (max-width: 640px) {
          .odm-ai-fab { right: 1rem; bottom: calc(.875rem + env(safe-area-inset-bottom)); }
          .odm-ai-panel {
            right: .75rem;
            left: .75rem;
            bottom: calc(4.75rem + env(safe-area-inset-bottom));
            width: auto;
            height: min(620px, calc(100dvh - 96px - env(safe-area-inset-bottom)));
            border-radius: 14px;
          }
          .odm-ai-title, .odm-ai-subtitle { max-width: 175px; }
          .odm-ai-voice-controls { padding-top: 8px; }
          .odm-ai-voice-btn { flex: 1 1 auto; }
          .odm-ai-input-row { align-items: stretch; }
          .odm-ai-input { min-height: 36px; }
          .odm-ai-send-btn { min-width: 64px; }
          .odm-ai-odm-actions { grid-template-columns: 1fr; }
        }
        @keyframes dotPulse { 0%,80%,100%{opacity:.3;transform:scale(.8)} 40%{opacity:1;transform:scale(1)} }
      `}</style>
    </>
  );
}
