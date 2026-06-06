import { useRef, useState, useEffect } from "react";
import AIAssistant from "@/components/AIAssistant";

type ScorecardWindow = Window & {
  KPIs?: Array<{ key: string; name: string; unit?: string; benchmark?: number; benchmarkLabel?: string }>;
  KpiAggregates?: unknown;
  MonthlyScoreData?: unknown;
  selectedBusinessUnitId?: string;
  getSelectedYear?: () => number;
  getSelectedMonth?: () => number;
};

export default function ScorecardDashboard() {
  const [isLoading, setIsLoading] = useState(true);
  const [kpiAiData, setKpiAiData] = useState<Record<string, unknown>>({ source: "scorecard-kpi.html", dashboard: "Monthly KPI Scorecard" });
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const timer = setTimeout(() => setIsLoading(false), 500);
    return () => clearTimeout(timer);
  }, []);

  const captureKpiData = () => {
    const scorecardWindow = iframeRef.current?.contentWindow as ScorecardWindow | null;
    if (!scorecardWindow) return;
    setKpiAiData({
      source: "scorecard-kpi.html",
      dashboard: "Monthly KPI Scorecard",
      kpis: scorecardWindow.KPIs || [],
      aggregates: scorecardWindow.KpiAggregates || null,
      monthlyScoreData: scorecardWindow.MonthlyScoreData || null,
      selectedBusinessUnitId: scorecardWindow.selectedBusinessUnitId || null,
      selectedYear: scorecardWindow.getSelectedYear?.() || null,
      selectedMonth: scorecardWindow.getSelectedMonth?.() || null,
    });
  };

  return (
    <div className="h-screen flex flex-col bg-gray-50">
      {/* Main content — iframe for existing HTML + AI panel */}
      <div className="flex-1 flex overflow-hidden">
        {/* Scorecard iframe */}
        <div className="flex-1 overflow-hidden">
          {isLoading ? (
            <div className="flex items-center justify-center h-full text-gray-400 text-sm">Loading scorecard...</div>
          ) : (
            <iframe
              ref={iframeRef}
              onLoad={() => setTimeout(captureKpiData, 750)}
              src="/scorecard-kpi.html"
              title="Monthly KPI Scorecard"
              className="w-full h-full border-0"
              sandbox="allow-scripts allow-same-origin allow-downloads allow-top-navigation-by-user-activation"
            />
          )}
        </div>
      </div>
      <AIAssistant
        contextType="scorecard"
        data={kpiAiData}
        metadata={{ sourceModule: "Monthly KPI Scorecard", sourceRecordId: "monthly-kpi-scorecard", sourceRecordLabel: "Monthly KPI Scorecard" }}
        title="Monthly KPI AI"
        position="bottom-right"
      />
    </div>
  );
}
