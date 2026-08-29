import { Link } from "react-router";
import ProgramsEngineeringLogo from "@/components/ProgramsEngineeringLogo";
import AIAssistant from "@/components/AIAssistant";

const DASHBOARDS = [
  {
    icon: "📋",
    bg: "#F0F4FF",
    title: "Maintenance Planning (Post-PPP)",
    route: "/equipment",
    desc: "Manage maintenance task schedules across facilities. Plan when each maintenance activity (Operations, AMD, ARD) should occur.",
    steps: [
      "Filter by Equipment Type, Frequency, or Personnel.",
      "Expand/Collapse equipment groups to show/hide tasks.",
      "Select tasks with checkboxes or use Select All.",
      "Edit dates by clicking Edit, then pick from calendar dropdowns.",
      "Export: select tasks and click Export, or export all.",
      "Import: upload a CSV or Excel file. Blank cells won't overwrite existing data.",
      "Ask AI: click the floating AI button for insights on coverage, overloads, and anomalies.",
    ],
  },
  {
    icon: "📅",
    bg: "#ECFDF5",
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
    bg: "#FFF7ED",
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
    bg: "#F5F3FF",
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
    bg: "#F0F9FF",
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
    bg: "#FFF7ED",
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
    bg: "#F0FDF4",
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
    <div className="min-h-screen flex flex-col" style={{ background: '#F8FAFC', fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, sans-serif' }}>
      {/* Header */}
      <header style={{ background: 'linear-gradient(135deg, #16324F 0%, #0D2137 50%, #16324F 100%)', color: '#fff', boxShadow: '0 4px 12px rgba(22,50,79,0.10)' }}>
        <div style={{ maxWidth: 1440, margin: '0 auto', padding: '10px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <Link to="/" style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none', color: 'inherit' }}>
            <ProgramsEngineeringLogo size={72} borderRadius={8} />
            <div>
              <h1 className="text-sm sm:text-[15px] font-bold" style={{ letterSpacing: '-0.2px', lineHeight: 1.2 }}>Program Oversight Center</h1>
              <span className="text-[10px] block mt-0.5 opacity-55" style={{ textTransform: 'uppercase', letterSpacing: '1.5px' }}>Help & User Guide</span>
            </div>
          </Link>
        </div>
      </header>

      {/* Hero */}
      <div style={{ background: 'linear-gradient(135deg, #16324F 0%, #0D2137 100%)', color: '#fff' }}>
        <div style={{ maxWidth: 900, margin: '0 auto', padding: '28px 20px 24px' }}>
          <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 6 }}>Help & User Guide</h2>
          <p style={{ fontSize: 13, opacity: 0.7, maxWidth: 600 }}>
            How to navigate and use each dashboard in the Programs suite. 
            All dashboards include AI-powered insights — tap the floating button on any page to ask questions.
          </p>
          <div className="flex gap-2 mt-3 flex-wrap">
            <span className="text-[10px] font-semibold px-2 py-1 rounded-full" style={{ background: 'rgba(255,255,255,0.12)', color: '#fff' }}>{DASHBOARDS.length} Dashboards</span>
            <span className="text-[10px] font-semibold px-2 py-1 rounded-full" style={{ background: 'rgba(255,255,255,0.12)', color: '#fff' }}>AI-Enhanced</span>
            <span className="text-[10px] font-semibold px-2 py-1 rounded-full" style={{ background: 'rgba(255,255,255,0.12)', color: '#fff' }}>Mobile Ready</span>
          </div>
        </div>
      </div>

      {/* Content */}
      <main style={{ maxWidth: 900, margin: '0 auto', padding: '24px 16px 40px' }} className="sm:!px-6 flex-1">

        {/* AI Feature Highlight */}
        <div className="bg-white rounded-xl border border-gray-200 p-5 sm:p-6 shadow-sm mb-6" style={{ borderLeft: '4px solid #0066A6' }}>
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-lg flex items-center justify-center text-lg flex-shrink-0" style={{ background: '#F0F4FF' }}>🤖</div>
            <div>
              <h3 className="text-base font-bold text-gray-900 mb-1">AI Assistant — Available on Every Dashboard</h3>
              <p className="text-sm text-gray-600 mb-3">
                Every dashboard now includes an AI-powered assistant. Tap the floating button in the bottom-right corner to open the AI panel.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-gray-600">
                <div className="flex items-start gap-2">
                  <span className="text-blue-600 font-bold flex-shrink-0">1.</span>
                  <span><strong>Ask questions</strong> about your data in natural language</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-blue-600 font-bold flex-shrink-0">2.</span>
                  <span><strong>Quick questions</strong> — tap pre-built question chips for instant insights</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-blue-600 font-bold flex-shrink-0">3.</span>
                  <span><strong>Summarize</strong> coverage, gaps, risks, and priorities</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-blue-600 font-bold flex-shrink-0">4.</span>
                  <span><strong>Mobile-friendly</strong> — swipe to close, scrollable panel</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Dashboard Cards */}
        <div className="space-y-5">
          {DASHBOARDS.map((d) => (
            <div key={d.route} className="bg-white rounded-xl border border-gray-200 p-5 sm:p-6 shadow-sm transition-all duration-200 hover:shadow-md hover:border-gray-300" style={{transitionTimingFunction:'cubic-bezier(.4,0,.2,1)'}}>
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-lg flex items-center justify-center text-lg" style={{ background: d.bg }}>{d.icon}</div>
                <div>
                  <h3 className="text-base font-bold text-gray-900">{d.title}</h3>
                  <p className="text-xs text-gray-500">{d.route}</p>
                </div>
              </div>
              <div className="space-y-3 text-sm text-gray-700">
                <p><strong>What it does:</strong> {d.desc}</p>
                <div className="bg-gray-50 rounded-lg p-3 space-y-2">
                  <p className="font-semibold text-gray-900 text-xs uppercase tracking-wide">How to use</p>
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
        <div className="bg-white rounded-xl border border-gray-200 p-5 sm:p-6 shadow-sm mt-5" style={{transitionTimingFunction:'cubic-bezier(.4,0,.2,1)'}}>
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-lg flex items-center justify-center text-lg" style={{ background: '#FEF2F2' }}>💡</div>
            <h3 className="text-base font-bold text-gray-900">General Tips & Shortcuts</h3>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm text-gray-700">
            {HELP_CONTEXT.shortcuts.map((tip, i) => (
              <div key={i} className="flex items-start gap-2">
                <span className="text-red-500 font-bold text-xs flex-shrink-0 mt-0.5">●</span>
                <span>{tip}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Keyboard Shortcuts */}
        <div className="bg-white rounded-xl border border-gray-200 p-5 sm:p-6 shadow-sm mt-5" style={{transitionTimingFunction:'cubic-bezier(.4,0,.2,1)'}}>
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-lg flex items-center justify-center text-lg" style={{ background: '#F0FDF4' }}>⌨️</div>
            <h3 className="text-base font-bold text-gray-900">Keyboard Shortcuts</h3>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm text-gray-700">
            <div className="flex items-center justify-between bg-gray-50 rounded px-3 py-2">
              <span>Focus search</span>
              <kbd className="px-2 py-0.5 bg-white border border-gray-300 rounded text-xs font-mono">Ctrl + F</kbd>
            </div>
            <div className="flex items-center justify-between bg-gray-50 rounded px-3 py-2">
              <span>Return to home</span>
              <kbd className="px-2 py-0.5 bg-white border border-gray-300 rounded text-xs font-mono">Click Logo</kbd>
            </div>
            <div className="flex items-center justify-between bg-gray-50 rounded px-3 py-2">
              <span>Open AI panel</span>
              <kbd className="px-2 py-0.5 bg-white border border-gray-300 rounded text-xs font-mono">Tap AI Button</kbd>
            </div>
            <div className="flex items-center justify-between bg-gray-50 rounded px-3 py-2">
              <span>Close AI panel</span>
              <kbd className="px-2 py-0.5 bg-white border border-gray-300 rounded text-xs font-mono">Swipe / Tap ✕</kbd>
            </div>
          </div>
        </div>
      </main>

      <footer style={{ borderTop: '1px solid #D6DFE8', padding: '20px', textAlign: 'right', fontSize: 12, color: '#5A6B7D' }}>
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
