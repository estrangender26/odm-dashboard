import { useState, useEffect } from "react";
import { Link } from "react-router";

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


    </div>
  );
}
