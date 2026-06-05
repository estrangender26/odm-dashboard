import { useState, useEffect } from "react";

export default function ScorecardDashboard() {
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => setIsLoading(false), 500);
    return () => clearTimeout(timer);
  }, []);

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
              src="/scorecard-kpi.html"
              title="Monthly KPI Scorecard"
              className="w-full h-full border-0"
              sandbox="allow-scripts allow-same-origin allow-downloads allow-top-navigation-by-user-activation"
            />
          )}
        </div>
      </div>
    </div>
  );
}
