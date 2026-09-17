import { BookOpen } from "lucide-react";
import AIAssistant from "@/components/AIAssistant";
import { PeIconOrb, SuiteMasthead } from "@/components/programs";

/**
 * Help — user guide for the whole suite.
 *
 * Supporting surface: the dark navy header/hero are gone. The page now opens
 * with the compact SuiteMasthead, then a light PE identity band, and every
 * panel is a .pe-card on the soft PE canvas. All help content, headings, routes
 * and section structure are unchanged.
 */
const DASHBOARDS = [
  {
    icon: "📅",
    bg: "var(--pe-blue-soft)",
    title: "ODM Primavera Lite",
    route: "/gantt",
    desc: "Link-based project scheduling. Create WBS nodes, activities, dependencies, and run schedule calculations without an account.",
    steps: [
      "Create a new project from /gantt/new and keep the admin link safe.",
      "Build a WBS tree, add activities, and assign calendars.",
      "Link activities with FS/SS/FF/SF dependencies.",
      "Run the schedule engine to compute early/late dates and float.",
      "Share view-only or editor links with stakeholders.",
      "Ask AI: identify schedule risks, delayed activities, and recovery actions.",
    ],
  },
  {
    icon: "🔧",
    bg: "var(--pe-teal-soft)",
    title: "Standard Maintenance Procedures",
    route: "/smp-dashboard",
    desc: "Controlled engineering-document repository for approved SMP PDFs with reference numbers, revisions, effectivity dates, and structured procedure data.",
    steps: [
      "Upload approved SMP PDFs as controlled documents with revision and effectivity metadata.",
      "Search by reference number, title, SMP ID, family, asset, equipment, or facility type.",
      "Filter by SMP Family, Equipment Type, Facility Type, Criticality, Revision, or Status.",
      "Select an SMP to view document control, applicability, the approved PDF, and procedure data.",
      "Upload a new revision — the previous revision is retained as superseded history, never overwritten.",
      "Export the SMP library to Excel for reporting.",
      "Ask AI: find missing SMPs, superseded documents, or coverage gaps by family and equipment.",
    ],
  },
  {
    icon: "📖",
    bg: "var(--pe-blue-soft)",
    title: "O&M Manuals Library",
    route: "/om-manuals-library",
    desc: "Document management system with configurable folder tree, PDF upload/view, download, delete, and 14-item Standard TOC tracking.",
    steps: [
      "Create folders and subfolders to organize documents.",
      "Upload PDF, Word, or Excel files into any folder.",
      "Download files with original filename preserved.",
      "Delete files with confirmation dialog.",
      "Search across all folders and files.",
      "Right-click (or tap ⋮) for folder/file actions: rename, move, delete.",
      "Ask AI: summarize document coverage, identify missing manuals, and prioritize uploads.",
    ],
  },
  {
    icon: "📈",
    bg: "var(--pe-teal-soft)",
    title: "Monthly KPI Scorecard",
    route: "/scorecard-kpi",
    desc: "Track 8 KPIs across 6 business units with color-coded performance, benchmark comparison, and Excel import.",
    steps: [
      "Select Year and Month, then click Load.",
      "Input data manually or import from Excel.",
      "Color codes: Green = passed, Yellow = missing, Red = below benchmark.",
      "View summary matrix with all BUs and KPIs.",
      "Drill down into individual BU performance.",
      "Ask AI: identify underperforming BUs, benchmark gaps, and recommended actions.",
    ],
  },
  {
    icon: "🏗️",
    bg: "var(--pe-blue-soft)",
    title: "O&M Manual Governance",
    route: "/governance.html",
    desc: "Track O&M manual delivery progress across water treatment facilities (Aglipay, HTT, East Bay, Kaysakat).",
    steps: [
      "Tabs: Progress Chart, Deliverables, S-Curve, Extra Uploads.",
      "Check milestones by clicking checkboxes.",
      "Upload files next to any TOC item.",
      "Enter PPP/Comp dates to calculate progress percentages.",
      "Click Refresh to see updates from other users.",
    ],
  },
  {
    icon: "🔧",
    bg: "var(--pe-teal-soft)",
    title: "ODM Dashboard",
    route: "/mw-dashboard.html",
    desc: "View operator-driven maintenance inspection records and KPIs (asset health, compliance, abnormalities).",
    steps: [
      "Import Excel: upload inspection data from .xlsx files.",
      "View KPIs: health score, compliance rate, abnormal findings.",
      "Filter by date range, asset tag, or status.",
      "Toggle between bar, line, and pie chart views.",
    ],
  },
];

// Help context data for AI
const HELP_CONTEXT = {
  totalDashboards: DASHBOARDS.length,
  dashboardNames: DASHBOARDS.map(d => d.title),
  features: [
    "Folder-based document management with CRUD operations",
    "PDF upload, view, download, and delete",
    "Interactive Gantt charts with 6 zoom levels",
    "Equipment type grouping with inference engine",
    "KPI scorecards with benchmark tracking",
    "SMP document library with search and filter",
    "AI-powered insights on all dashboards",
    "Excel import/export across all modules",
    "Mobile-responsive design",
  ],
  shortcuts: [
    "Click Programs logo to return to home page",
    "Ctrl+F to focus search in O&M Manuals Library",
    "Tap floating AI button for dashboard insights",
    "Swipe AI panel to close on mobile",
  ],
};

export default function Help() {
  return (
    <div className="odm-canvas min-h-screen flex flex-col" style={{ fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, sans-serif' }}>
      {/* Suite identity — replaces the previous dark navy header. */}
      <SuiteMasthead suiteTitle="Program Oversight Center" />

      {/* Help intro — the previous dark hero, re-voiced on white. */}
      <section style={{ background: 'var(--pe-white)', borderBottom: '1px solid var(--pe-border)' }}>
        <div style={{ maxWidth: 900, margin: '0 auto', padding: '22px 20px 20px' }}>
          <div className="flex items-start gap-3">
            <PeIconOrb icon={BookOpen} tone="blue" size="md" />
            <div>
              <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 6, color: 'var(--pe-text-strong)' }}>Help &amp; User Guide</h2>
              <p style={{ fontSize: 13, color: 'var(--pe-text-muted)', maxWidth: 600 }}>
                How to navigate and use each dashboard in the Programs suite.
                All dashboards include AI-powered insights — tap the floating button on any page to ask questions.
              </p>
            </div>
          </div>
          <div className="flex gap-2 mt-3 flex-wrap">
            <span className="pe-badge pe-badge--blue">{DASHBOARDS.length} Dashboards</span>
            <span className="pe-badge pe-badge--teal">AI-Enhanced</span>
            <span className="pe-badge">Mobile Ready</span>
          </div>
        </div>
      </section>

      {/* Content */}
      <main style={{ maxWidth: 900, margin: '0 auto', padding: '24px 16px 40px' }} className="sm:!px-6 flex-1">

        {/* AI Feature Highlight */}
        <div className="pe-card p-5 sm:p-6 mb-6" style={{ borderLeft: '4px solid var(--pe-blue)' }}>
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-lg flex items-center justify-center text-lg flex-shrink-0" style={{ background: 'var(--pe-blue-soft)' }}>🤖</div>
            <div>
              <h3 className="text-base font-bold mb-1" style={{ color: 'var(--pe-text-strong)' }}>AI Assistant — Available on Every Dashboard</h3>
              <p className="text-sm mb-3" style={{ color: 'var(--pe-text-muted)' }}>
                Every dashboard now includes an AI-powered assistant. Tap the floating button in the bottom-right corner to open the AI panel.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs" style={{ color: 'var(--pe-text-muted)' }}>
                <div className="flex items-start gap-2">
                  <span className="font-bold flex-shrink-0" style={{ color: 'var(--pe-blue)' }}>1.</span>
                  <span><strong>Ask questions</strong> about your data in natural language</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="font-bold flex-shrink-0" style={{ color: 'var(--pe-blue)' }}>2.</span>
                  <span><strong>Quick questions</strong> — tap pre-built question chips for instant insights</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="font-bold flex-shrink-0" style={{ color: 'var(--pe-blue)' }}>3.</span>
                  <span><strong>Summarize</strong> coverage, gaps, risks, and priorities</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="font-bold flex-shrink-0" style={{ color: 'var(--pe-blue)' }}>4.</span>
                  <span><strong>Mobile-friendly</strong> — swipe to close, scrollable panel</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Dashboard Cards */}
        <div className="space-y-5">
          {DASHBOARDS.map((d) => (
            <div key={d.route} className="pe-card pe-card--interactive p-5 sm:p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-lg flex items-center justify-center text-lg" style={{ background: d.bg }}>{d.icon}</div>
                <div>
                  <h3 className="text-base font-bold" style={{ color: 'var(--pe-text-strong)' }}>{d.title}</h3>
                  <p className="text-xs" style={{ color: 'var(--pe-text-faint)' }}>{d.route}</p>
                </div>
              </div>
              <div className="space-y-3 text-sm" style={{ color: 'var(--pe-text)' }}>
                <p><strong>What it does:</strong> {d.desc}</p>
                <div className="rounded-lg p-3 space-y-2" style={{ background: 'var(--pe-surface-sunk)' }}>
                  <p className="font-semibold text-xs uppercase tracking-wide" style={{ color: 'var(--pe-text-muted)' }}>How to use</p>
                  <ul className="list-disc list-inside space-y-1 text-sm">
                    {d.steps.map((s, i) => (
                      <li key={i} dangerouslySetInnerHTML={{ __html: s.replace(/(Ask AI)/, '<strong>$1</strong>') }} />
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* General Tips */}
        <div className="pe-card p-5 sm:p-6 mt-5">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-lg flex items-center justify-center text-lg" style={{ background: 'var(--pe-blue-soft)' }}>💡</div>
            <h3 className="text-base font-bold" style={{ color: 'var(--pe-text-strong)' }}>General Tips &amp; Shortcuts</h3>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm" style={{ color: 'var(--pe-text)' }}>
            {HELP_CONTEXT.shortcuts.map((tip, i) => (
              <div key={i} className="flex items-start gap-2">
                <span className="font-bold text-xs flex-shrink-0 mt-0.5" style={{ color: 'var(--pe-teal)' }}>●</span>
                <span>{tip}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Keyboard Shortcuts */}
        <div className="pe-card p-5 sm:p-6 mt-5">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-lg flex items-center justify-center text-lg" style={{ background: 'var(--pe-teal-soft)' }}>⌨️</div>
            <h3 className="text-base font-bold" style={{ color: 'var(--pe-text-strong)' }}>Keyboard Shortcuts</h3>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm" style={{ color: 'var(--pe-text)' }}>
            <div className="flex items-center justify-between rounded px-3 py-2" style={{ background: 'var(--pe-surface-sunk)' }}>
              <span>Focus search</span>
              <kbd className="px-2 py-0.5 rounded text-xs font-mono" style={{ background: 'var(--pe-white)', border: '1px solid var(--pe-border-strong)', color: 'var(--pe-text)' }}>Ctrl + F</kbd>
            </div>
            <div className="flex items-center justify-between rounded px-3 py-2" style={{ background: 'var(--pe-surface-sunk)' }}>
              <span>Return to home</span>
              <kbd className="px-2 py-0.5 rounded text-xs font-mono" style={{ background: 'var(--pe-white)', border: '1px solid var(--pe-border-strong)', color: 'var(--pe-text)' }}>Click Logo</kbd>
            </div>
            <div className="flex items-center justify-between rounded px-3 py-2" style={{ background: 'var(--pe-surface-sunk)' }}>
              <span>Open AI panel</span>
              <kbd className="px-2 py-0.5 rounded text-xs font-mono" style={{ background: 'var(--pe-white)', border: '1px solid var(--pe-border-strong)', color: 'var(--pe-text)' }}>Tap AI Button</kbd>
            </div>
            <div className="flex items-center justify-between rounded px-3 py-2" style={{ background: 'var(--pe-surface-sunk)' }}>
              <span>Close AI panel</span>
              <kbd className="px-2 py-0.5 rounded text-xs font-mono" style={{ background: 'var(--pe-white)', border: '1px solid var(--pe-border-strong)', color: 'var(--pe-text)' }}>Swipe / Tap ✕</kbd>
            </div>
          </div>
        </div>
      </main>

      <footer style={{ background: 'var(--pe-surface)', borderTop: '1px solid var(--pe-border)', padding: '20px', textAlign: 'right', fontSize: 12, color: 'var(--pe-text-muted)' }}>
        Program Oversight Center &copy; 2026
      </footer>

      {/* AI Assistant */}
      <AIAssistant
        contextType="maintenance"
        data={HELP_CONTEXT}
        quickQuestions={[
          "How do I create a folder in O&M Manuals Library?",
          "How do I upload a file?",
          "How do I use the Gantt chart?",
          "How do I export data to Excel?",
          "How do I use the AI assistant?",
          "Which dashboards have AI support?",
        ]}
      />
    </div>
  );
}
