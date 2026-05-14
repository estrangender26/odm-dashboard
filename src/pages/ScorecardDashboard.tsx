import { useState, useEffect } from "react";
import { Link } from "react-router";
import AIAssistant from "@/components/AIAssistant";

// ── Mock KPI data for AI context ──
const KPI_DATA = {
  month: "January 2025",
  businessUnits: [
    { name: "East Zone", availability: 98.5, mttr: 4.2, mtbf: 720, backlog: 12, compliance: 95, energy: 0.85, cost: 92 },
    { name: "South Zone", availability: 97.1, mttr: 5.8, mtbf: 650, backlog: 18, compliance: 88, energy: 0.92, cost: 85 },
    { name: "Central Zone", availability: 99.2, mttr: 3.1, mtbf: 850, backlog: 8, compliance: 98, energy: 0.78, cost: 96 },
    { name: "North Zone", availability: 96.8, mttr: 6.5, mtbf: 580, backlog: 25, compliance: 82, energy: 1.05, cost: 78 },
    { name: "West Zone", availability: 98.0, mttr: 4.8, mtbf: 690, backlog: 15, compliance: 91, energy: 0.88, cost: 88 },
    { name: "Corporate", availability: 99.5, mttr: 2.5, mtbf: 920, backlog: 5, compliance: 99, energy: 0.72, cost: 97 },
  ],
  benchmarks: {
    availability: 98.0, mttr: 4.0, mtbf: 720, backlog: 10, compliance: 95, energy: 0.85, cost: 90,
  },
  overall: {
    totalAssets: 1247, pmCompleted: 892, pmScheduled: 945, cmCount: 156, woBacklog: 83,
    availabilityAvg: 98.2, complianceAvg: 92.1,
  },
};

export default function ScorecardDashboard() {
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => setIsLoading(false), 500);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="h-screen flex flex-col bg-gray-50">
      {/* Header */}
      <header className="flex-shrink-0 text-white" style={{ background: "linear-gradient(135deg, #16324F 0%, #0D2137 50%, #16324F 100%)" }}>
        <div className="flex items-center justify-between px-4 py-2">
          <Link to="/" className="flex items-center gap-2 no-underline text-white">
            <span className="text-sm font-bold">&#8592; Back to Dashboards</span>
          </Link>
          <h1 className="text-sm font-bold">Monthly KPI Scorecard</h1>
          <span className="text-[0.6rem] opacity-55 uppercase tracking-wider">AI-Enhanced</span>
        </div>
      </header>

      {/* Main content — iframe for existing HTML + AI panel */}
      <div className="flex-1 flex overflow-hidden">
        {/* Scorecard iframe */}
        <div className="flex-1 overflow-hidden">
          {isLoading ? (
            <div className="flex items-center justify-center h-full text-gray-400 text-sm">Loading scorecard...</div>
          ) : (
            <iframe
              src="/scorecard-kpi.html"
              title="Monthly KPI Scorecard"
              className="w-full h-full border-0"
              sandbox="allow-scripts allow-same-origin allow-downloads"
            />
          )}
        </div>
      </div>

      {/* AI Assistant */}
      <AIAssistant
        contextType="scorecard"
        data={KPI_DATA}
        quickQuestions={[
          "Which KPIs are below benchmark?",
          "Which BUs are underperforming?",
          "What corrective actions are recommended?",
          "Summarize BU performance.",
          "Which zones need immediate attention?",
          "What is the overall scorecard summary?",
        ]}
      />
    </div>
  );
}
