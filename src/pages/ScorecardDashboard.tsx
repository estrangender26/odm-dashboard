import { useState, useEffect } from "react";
import { Link } from "react-router";
import ProgramsEngineeringLogo from "@/components/ProgramsEngineeringLogo";

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
        <div className="flex items-center px-4 py-2.5">
          <Link
            to="/"
            aria-label="Dashboard Home"
            title="Dashboard Home"
            className="flex items-center gap-3 no-underline text-white"
          >
            <ProgramsEngineeringLogo size={44} borderRadius={8} />
            <div>
              <h1 className="text-sm font-bold leading-tight">Monthly KPI Scorecard</h1>
              <p className="text-[0.6rem] opacity-55 uppercase tracking-wider">AI-Enhanced</p>
            </div>
          </Link>
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


    </div>
  );
}
