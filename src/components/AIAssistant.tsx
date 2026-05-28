import { useState, useRef, useEffect } from "react";
import { trpc } from "@/providers/trpc";

export type DashboardContext =
  | "maintenance"
  | "gantt"
  | "inspection"
  | "smp"
  | "manuals"
  | "scorecard"
  | "governance"
  | "help";

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
  help: [
    "Explain dashboard features",
    "Guide on data import",
    "Troubleshoot issues",
    "Suggest best practices",
  ],
};

/**
 * Build a rich data context string from dashboard data.
 * Handles arrays, objects, and nested structures.
 */
function buildDataContext(data: any[] | any, contextType: DashboardContext, filters?: any, metadata?: any): string {
  let ctx = "";
  const now = new Date().toISOString().slice(0, 10);

  ctx += `=== DASHBOARD CONTEXT ===\n`;
  ctx += `Current Date: ${now}\n`;
  ctx += `Dashboard Type: ${contextType}\n`;

  // Filters
  if (filters && Object.keys(filters).length > 0) {
    const activeFilters = Object.entries(filters).filter(([, v]) => v !== "" && v !== undefined && v !== null);
    if (activeFilters.length > 0) {
      ctx += `Active Filters: ${activeFilters.map(([k, v]) => `${k}=${v}`).join(", ")}\n`;
    }
  }

  // Metadata
  if (metadata) {
    if (metadata.facilityName) ctx += `Facility: ${metadata.facilityName}\n`;
    if (metadata.uploads?.length) ctx += `Uploads: ${metadata.uploads.length} documents\n`;
    if (metadata.aiContext && contextType === "manuals") {
      const aiCtx = metadata.aiContext;
      const safeEntries = (record: Record<string, number> | undefined, limit = 10) =>
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
      if (Array.isArray(aiCtx?.sampleRecords) && aiCtx.sampleRecords.length > 0) {
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

    // --- MAINTENANCE / EFM dashboard ---
    if (contextType === "maintenance" && fields.includes("Equipment")) {
      // Status breakdown
      const statusMap: Record<string, number> = {};
      const plantMap: Record<string, { total: number; overdue: number }> = {};
      const overdueItems: string[] = [];
      let pmCount = 0, cmCount = 0;

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
      Object.entries(statusMap).sort(([, a], [, b]) => (b as number) - (a as number)).forEach(([s, c]) => {
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
        overdueItems.slice(0, 15).forEach((item) => { ctx += `- ${item}\n`; });
      }

      ctx += `\nWork Order Types: ${pmCount} PM, ${cmCount} CM\n`;
    }

    // --- GANTT dashboard ---
    else if (contextType === "gantt" && (fields.includes("text") || fields.includes("name"))) {
      const totalTasks = data.length;
      const milestones = data.filter((t: any) => (t.type || "").toLowerCase() === "milestone").length;
      const projects = data.filter((t: any) => (t.type || "").toLowerCase() === "project").length;
      const parentTasks = data.filter((t: any) => t.parent === 0 || t.parent === undefined || t.parent === null).length;
      const childTasks = data.filter((t: any) => t.parent && t.parent !== 0).length;

      ctx += `=== GANTT SUMMARY ===\n`;
      ctx += `- Total Tasks: ${totalTasks}\n`;
      ctx += `- Milestones: ${milestones}\n`;
      ctx += `- Projects: ${projects}\n`;
      ctx += `- Parent Tasks: ${parentTasks}\n`;
      ctx += `- Sub-tasks: ${childTasks}\n`;

      // Date range
      const starts = data.map((t: any) => t.start_date).filter(Boolean).sort();
      const ends = data.map((t: any) => t.end_date).filter(Boolean).sort();
      if (starts.length && ends.length) {
        ctx += `- Date Range: ${starts[0]} to ${ends[ends.length - 1]}\n`;
      }
    }

    // --- GOVERNANCE dashboard ---
    else if (contextType === "governance" && fields.includes("milestone")) {
      const statusMap: Record<string, number> = {};
      data.forEach((r: any) => {
        const st = r.status || r.Status || "Unknown";
        statusMap[st] = (statusMap[st] || 0) + 1;
      });
      ctx += `=== MILESTONE STATUS ===\n`;
      Object.entries(statusMap).forEach(([s, c]) => { ctx += `- ${s}: ${c}\n`; });
    }

    // --- SMP dashboard ---
    else if (contextType === "smp" || (fields.includes("smp") || fields.includes("SMP") || fields.includes("document") || fields.includes("Document"))) {
      ctx += `=== SMP DOCUMENTS ===\n`;
      ctx += `Total Documents: ${data.length}\n`;

      const statusMap: Record<string, number> = {};
      const equipMap: Record<string, number> = {};
      const respMap: Record<string, number> = {};

      data.forEach((r: any) => {
        const st = r.Status || r.status || "Unknown";
        statusMap[st] = (statusMap[st] || 0) + 1;
        const eq = r.EquipmentType || r.equipmentType || r.System || r.system || "Unknown";
        equipMap[eq] = (equipMap[eq] || 0) + 1;
        const resp = r.Responsible || r.responsible || r.Owner || r.owner || "Unknown";
        respMap[resp] = (respMap[resp] || 0) + 1;
      });

      ctx += `\nStatus Breakdown:\n`;
      Object.entries(statusMap).forEach(([s, c]) => { ctx += `- ${s}: ${c}\n`; });

      ctx += `\nEquipment Types:\n`;
      Object.entries(equipMap).sort(([, a], [, b]) => (b as number) - (a as number)).slice(0, 10).forEach(([e, c]) => { ctx += `- ${e}: ${c}\n`; });

      ctx += `\nResponsible Parties:\n`;
      Object.entries(respMap).sort(([, a], [, b]) => (b as number) - (a as number)).slice(0, 10).forEach(([r, c]) => { ctx += `- ${r}: ${c}\n`; });
    }

    // --- SCORECARD dashboard ---
    else if (contextType === "scorecard" || (fields.includes("kpi") || fields.includes("KPI"))) {
      ctx += `=== KPI DATA ===\n`;
      ctx += `Total KPIs: ${data.length}\n\n`;

      data.slice(0, 20).forEach((r: any, i: number) => {
        const name = r.kpi || r.KPI || r.name || r.Name || `KPI ${i + 1}`;
        const actual = r.actual ?? r.Actual ?? r.value ?? r.Value ?? "N/A";
        const target = r.target ?? r.Target ?? r.benchmark ?? r.Benchmark ?? "N/A";
        const status = (r.status || r.Status) ?? "";
        ctx += `${i + 1}. ${name}: Actual=${actual}, Target=${target}${status ? `, Status=${status}` : ""}\n`;
      });
    }

    // --- Generic array fallback ---
    else {
      ctx += `Fields: ${fields.join(", ")}\n\n`;

      // Numeric summary for numeric fields
      const numericFields = fields.filter((f) => {
        const v = first[f];
        return typeof v === "number" || (typeof v === "string" && !isNaN(Number(v)) && v !== "");
      });

      if (numericFields.length > 0) {
        ctx += `=== NUMERIC SUMMARIES ===\n`;
        numericFields.forEach((f) => {
          const values = data.map((r: any) => Number(r[f])).filter((v: number) => !isNaN(v));
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

      // Show first 10 records as sample
      ctx += `=== SAMPLE RECORDS (first ${Math.min(10, data.length)}) ===\n`;
      data.slice(0, 10).forEach((r: any, i: number) => {
        const summary = fields.slice(0, 5).map((f) => `${f}=${JSON.stringify(r[f]).slice(0, 40)}`).join(", ");
        ctx += `${i + 1}. ${summary}\n`;
      });
    }
  }

  // Handle objects (non-array)
  else if (typeof data === "object" && data !== null) {
    const keys = Object.keys(data);
    ctx += `Data Type: Object with keys [${keys.join(", ")}]\n`;

    // O&M Manuals folder structure
    if (contextType === "manuals") {
      if (data.folders !== undefined) ctx += `Folders: ${data.folders}\n`;
      if (data.files !== undefined) ctx += `Files: ${data.files}\n`;
      if (data.tree) {
        const countNodes = (node: any, depth = 0): number => {
          if (!node || typeof node !== "object") return 0;
          let count = 1;
          Object.values(node).forEach((child: any) => {
            if (typeof child === "object" && child !== null) count += countNodes(child, depth + 1);
          });
          return count;
        };
        ctx += `Tree nodes: ${countNodes(data.tree)}\n`;
      }
    }

    // Help context
    if (contextType === "help") {
      ctx += `Help Topics: ${keys.filter((k) => k !== "__html").join(", ")}\n`;
    }
  }

  ctx += `\n`;
  return ctx;
}

export default function AIAssistant({ contextType, data, filters, metadata, title, quickQuestions, position = "bottom-left" }: AIAssistantProps) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<{ role: "user" | "assistant"; content: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const chatMut = trpc.ai.maintenanceChat.useMutation({
    onSuccess: (res) => {
      setLoading(false);
      setMessages((prev) => [...prev, { role: "assistant", content: res.reply }]);
    },
    onError: (e) => {
      setLoading(false);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `⚠️ Error: ${e.message}\n\nThe AI service may not be configured. Please set GROQ_API_KEY in your Render environment variables.\n\nGet a free key at: https://console.groq.com`,
        },
      ]);
    },
  });

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  const send = (text?: string) => {
    const msg = (text || input).trim();
    if (!msg || loading) return;
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: msg }]);
    setLoading(true);

    // Build data context and prepend to message
    const dataContext = buildDataContext(data, contextType, filters, metadata);
    let fullMessage = dataContext + `USER QUESTION: ${msg}\n\nAnswer based ONLY on the dashboard data provided above. Be specific with numbers and names.`;
    if (fullMessage.length > MAX_AI_CONTEXT_CHARS) {
      const keepTail = `\n\nUSER QUESTION: ${msg}\n\nAnswer based ONLY on the dashboard data provided above. Be specific with numbers and names.`;
      const allowedContext = Math.max(0, MAX_AI_CONTEXT_CHARS - keepTail.length);
      const summarized = dataContext.slice(0, allowedContext);
      fullMessage = `${summarized}\n[context summarized due to size]${keepTail}`;
    }

    const history = messages.slice(-6).map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

    chatMut.mutate({ message: fullMessage, history });
  };

  const prompts = quickQuestions || CONTEXT_PROMPTS[contextType] || CONTEXT_PROMPTS.help;

  return (
    <>
      {/* Floating button */}
      <button
        onClick={() => setOpen(!open)}
        style={{
          position: "fixed",
          bottom: "calc(1rem + env(safe-area-inset-bottom))",
          right: position === "bottom-right" ? "1rem" : undefined,
          left: position === "bottom-left" ? "1rem" : undefined,
          zIndex: 200,
          width: 48,
          height: 48,
          borderRadius: "50%",
          background: "linear-gradient(135deg, #7C3AED, #6D28D9)",
          color: "#fff",
          border: "none",
          boxShadow: "0 4px 16px rgba(124,58,237,.35)",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 20,
          transition: "all .2s",
        }}
        title={title || "AI Analysis"}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2z"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
      </button>

      {/* Panel */}
      {open && (
        <div
          style={{
            position: "fixed",
            bottom: "calc(5.5rem + env(safe-area-inset-bottom))",
            right: position === "bottom-right" ? "1rem" : undefined,
            left: position === "bottom-left" ? "1rem" : undefined,
            zIndex: 200,
            width: "min(380px, calc(100vw - 40px))",
            height: "min(480px, calc(100vh - 120px))",
            background: "#fff",
            borderRadius: 16,
            boxShadow: "0 20px 60px rgba(0,0,0,.25)",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            fontFamily: "Inter, sans-serif",
            border: "1px solid #D6DFE8",
          }}
        >
          {/* Header */}
          <div style={{ padding: "12px 16px", background: "linear-gradient(135deg, #7C3AED, #6D28D9)", color: "#fff", display: "flex", alignItems: "center", gap: 8 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2z"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
            <span style={{ fontSize: 12, fontWeight: 700, flex: 1 }}>{title || "AI Analysis"}</span>
            <button onClick={() => setMessages([])} style={{ background: "none", border: "none", color: "#fff", fontSize: 10, cursor: "pointer", opacity: .8 }}>Clear</button>
            <button onClick={() => setOpen(false)} style={{ background: "none", border: "none", color: "#fff", fontSize: 18, cursor: "pointer", lineHeight: 1 }}>&times;</button>
          </div>

          {/* Messages */}
          <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
            {messages.length === 0 && (
              <div style={{ textAlign: "center", padding: "16px 8px", color: "#94A3B8", fontSize: 11 }}>
                <p style={{ margin: "0 0 12px" }}>Ask AI to analyze this dashboard&apos;s data.</p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, justifyContent: "center" }}>
                  {prompts.map((p) => (
                    <button key={p} onClick={() => send(p)} style={{ padding: "4px 10px", fontSize: 10, border: "1px solid #D6DFE8", borderRadius: 12, background: "#fff", color: "#475569", cursor: "pointer", fontFamily: "Inter, sans-serif" }}>
                      {p}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} style={{ alignSelf: m.role === "user" ? "flex-end" : "flex-start", maxWidth: "85%", padding: "6px 10px", borderRadius: m.role === "user" ? "10px 10px 2px 10px" : "10px 10px 10px 2px", background: m.role === "user" ? "#7C3AED" : "#F1F5F9", color: m.role === "user" ? "#fff" : "#2D3748", fontSize: 11, lineHeight: 1.5, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                {m.content}
              </div>
            ))}
            {loading && (
              <div style={{ alignSelf: "flex-start", padding: "8px 12px", background: "#F1F5F9", borderRadius: "10px 10px 10px 2px" }}>
                <span style={{ display: "inline-flex", gap: 3 }}>
                  <span style={{ width: 5, height: 5, background: "#94A3B8", borderRadius: "50%", animation: "dotPulse 1.4s ease-in-out infinite" }} />
                  <span style={{ width: 5, height: 5, background: "#94A3B8", borderRadius: "50%", animation: "dotPulse 1.4s ease-in-out infinite .2s" }} />
                  <span style={{ width: 5, height: 5, background: "#94A3B8", borderRadius: "50%", animation: "dotPulse 1.4s ease-in-out infinite .4s" }} />
                </span>
              </div>
            )}
          </div>

          {/* Input */}
          <div style={{ padding: "8px 12px", borderTop: "1px solid #E2E8F0", display: "flex", gap: 6, alignItems: "flex-end" }}>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }}}
              placeholder="Ask AI..."
              rows={1}
              style={{ flex: 1, padding: "6px 10px", fontSize: 11, border: "1px solid #D6DFE8", borderRadius: 8, fontFamily: "Inter, sans-serif", resize: "none", outline: "none", maxHeight: 60 }}
            />
            <button onClick={() => send()} disabled={!input.trim() || loading} style={{ padding: "6px 14px", fontSize: 11, fontWeight: 600, background: input.trim() && !loading ? "#7C3AED" : "#CBD5E1", color: "#fff", border: "none", borderRadius: 8, cursor: input.trim() && !loading ? "pointer" : "not-allowed" }}>
              Send
            </button>
          </div>
        </div>
      )}

      <style>{`@keyframes dotPulse { 0%,80%,100%{opacity:.3;transform:scale(.8)} 40%{opacity:1;transform:scale(1)} }`}</style>
    </>
  );
}
