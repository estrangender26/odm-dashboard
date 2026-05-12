import { Link } from "react-router";
import ProgramsEngineeringLogo from "@/components/ProgramsEngineeringLogo";

export default function Help() {
  return (
    <div className="min-h-screen" style={{ background: '#F8FAFC', fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, sans-serif' }}>
      {/* Header */}
      <header style={{ background: 'linear-gradient(135deg, #16324F 0%, #0D2137 50%, #16324F 100%)', color: '#fff', boxShadow: '0 4px 12px rgba(22,50,79,0.10)' }}>
        <div style={{ maxWidth: 1440, margin: '0 auto', padding: '10px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <Link to="/" style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none', color: 'inherit' }}>
            <ProgramsEngineeringLogo size={72} borderRadius={8} />
            <div>
              <h1 className="text-sm sm:text-[15px] font-bold" style={{ letterSpacing: '-0.2px', lineHeight: 1.2 }}>Program Oversight Center</h1>
              <span className="text-[10px] block mt-0.5 opacity-55" style={{ textTransform: 'uppercase', letterSpacing: '1.5px' }}>Programs</span>
            </div>
          </Link>

        </div>
      </header>

      {/* Content */}
      <main style={{ maxWidth: 900, margin: '0 auto', padding: '32px 16px 60px' }} className="sm:!px-6">
        <h2 style={{ fontSize: 22, fontWeight: 700, color: '#0B1D44', marginBottom: 8 }}>Help & User Guide</h2>
        <p style={{ fontSize: 14, color: '#5A6B7D', marginBottom: 32 }}>How to navigate and use each dashboard in the Programs suite.</p>

        {/* Dashboard Cards */}
        <div className="space-y-6">

          {/* Maintenance Planning (Post-PPP) */}
          <div className="bg-white rounded-xl border border-gray-200 p-5 sm:p-6 shadow-sm transition-all duration-200 hover:shadow-md hover:border-gray-300" style={{transitionTimingFunction:'cubic-bezier(.4,0,.2,1)'}}>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg flex items-center justify-center text-lg" style={{ background: '#F0F4FF' }}>📋</div>
              <div>
                <h3 className="text-base font-bold text-gray-900">Maintenance Planning (Post-PPP)</h3>
                <p className="text-xs text-gray-500">/equipment</p>
              </div>
            </div>
            <div className="space-y-3 text-sm text-gray-700">
              <p><strong>What it does:</strong> Manage maintenance task schedules across facilities. Plan when each maintenance activity (Operations, AMD, ARD) should occur.</p>
              <div className="bg-gray-50 rounded-lg p-3 space-y-2">
                <p className="font-semibold text-gray-900 text-xs uppercase tracking-wide">How to use</p>
                <ul className="list-disc list-inside space-y-1 text-sm">
                  <li><strong>Filter:</strong> Use dropdowns to filter by Equipment Type, Frequency, or Personnel (Aglipay tab).</li>
                  <li><strong>Expand/Collapse:</strong> Click equipment group headers to show/hide tasks. Use Expand/Collapse All buttons.</li>
                  <li><strong>Select tasks:</strong> Check the box next to tasks or use "Select All" to select multiple.</li>
                  <li><strong>Edit dates:</strong> Click Edit, pick dates from the calendar dropdowns, then Save.</li>
                  <li><strong>Export:</strong> Select tasks and click Export, or export all without selecting.</li>
                  <li><strong>Import:</strong> Click Import and upload a CSV or Excel file. Blank cells won't overwrite existing data.</li>
                </ul>
              </div>
            </div>
          </div>

          {/* O&M Governance */}
          <div className="bg-white rounded-xl border border-gray-200 p-5 sm:p-6 shadow-sm transition-all duration-200 hover:shadow-md hover:border-gray-300" style={{transitionTimingFunction:'cubic-bezier(.4,0,.2,1)'}}>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg flex items-center justify-center text-lg" style={{ background: '#FFF7ED' }}>🏗️</div>
              <div>
                <h3 className="text-base font-bold text-gray-900">O&M Manual Governance</h3>
                <p className="text-xs text-gray-500">/governance.html (standalone)</p>
              </div>
            </div>
            <div className="space-y-3 text-sm text-gray-700">
              <p><strong>What it does:</strong> Track O&M manual delivery progress across water treatment facilities (Aglipay, HTT, East Bay, Kaysakat).</p>
              <div className="bg-gray-50 rounded-lg p-3 space-y-2">
                <p className="font-semibold text-gray-900 text-xs uppercase tracking-wide">How to use</p>
                <ul className="list-disc list-inside space-y-1 text-sm">
                  <li><strong>Tabs:</strong> Progress Chart, Deliverables, S-Curve, Extra Uploads.</li>
                  <li><strong>Check milestones:</strong> Click checkboxes to mark items complete.</li>
                  <li><strong>Upload files:</strong> Click Upload next to any TOC item to attach documents.</li>
                  <li><strong>PPP/Comp dates:</strong> Enter dates to calculate progress percentages.</li>
                  <li><strong>Multi-user:</strong> Click Refresh to see updates from other users.</li>
                </ul>
              </div>
            </div>
          </div>

          {/* ODM Dashboard */}
          <div className="bg-white rounded-xl border border-gray-200 p-5 sm:p-6 shadow-sm transition-all duration-200 hover:shadow-md hover:border-gray-300" style={{transitionTimingFunction:'cubic-bezier(.4,0,.2,1)'}}>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg flex items-center justify-center text-lg" style={{ background: '#F0FDF4' }}>🔧</div>
              <div>
                <h3 className="text-base font-bold text-gray-900">ODM Dashboard</h3>
                <p className="text-xs text-gray-500">/mw-dashboard.html (standalone)</p>
              </div>
            </div>
            <div className="space-y-3 text-sm text-gray-700">
              <p><strong>What it does:</strong> View operator-driven maintenance inspection records and KPIs (asset health, compliance, abnormalities).</p>
              <div className="bg-gray-50 rounded-lg p-3 space-y-2">
                <p className="font-semibold text-gray-900 text-xs uppercase tracking-wide">How to use</p>
                <ul className="list-disc list-inside space-y-1 text-sm">
                  <li><strong>Import Excel:</strong> Upload inspection data from Excel files. Supports .xlsx format.</li>
                  <li><strong>View KPIs:</strong> See health score, compliance rate, and abnormal findings at a glance.</li>
                  <li><strong>Filter:</strong> Use dropdowns to filter by date range, asset tag, or status.</li>
                  <li><strong>Charts:</strong> Toggle between bar, line, and pie chart views.</li>
                  <li><strong>Reset:</strong> Clear all data to start fresh.</li>
                </ul>
              </div>
            </div>
          </div>

          {/* Monthly KPI Scorecard */}
          <div className="bg-white rounded-xl border border-gray-200 p-5 sm:p-6 shadow-sm transition-all duration-200 hover:shadow-md hover:border-gray-300" style={{transitionTimingFunction:'cubic-bezier(.4,0,.2,1)'}}>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg flex items-center justify-center text-lg" style={{ background: '#F0F9FF' }}>📈</div>
              <div>
                <h3 className="text-base font-bold text-gray-900">Monthly KPI Scorecard</h3>
                <p className="text-xs text-gray-500">/scorecard-kpi.html (standalone)</p>
              </div>
            </div>
            <div className="space-y-3 text-sm text-gray-700">
              <p><strong>What it does:</strong> Track 8 KPIs across 5 business units with color-coded performance, Excel import, and budget analytics.</p>
              <div className="bg-gray-50 rounded-lg p-3 space-y-2">
                <p className="font-semibold text-gray-900 text-xs uppercase tracking-wide">How to use</p>
                <ul className="list-disc list-inside space-y-1 text-sm">
                  <li><strong>Select Year/Month:</strong> Choose the year and month from the dropdowns, then click Load.</li>
                  <li><strong>Input Manually:</strong> Click Input Data Manually to enter KPI values per business unit.</li>
                  <li><strong>Import Excel:</strong> Upload a pre-formatted Excel file with KPI data. Use the Import Excel button.</li>
                  <li><strong>Color Codes:</strong> Green = passed benchmark, Yellow = missing data, Red = below benchmark.</li>
                  <li><strong>Business Units:</strong> Manila Water / EZ, Laguna Water, Clark Water, Tagum Water.</li>
                  <li><strong>Clear:</strong> Click Clear to remove all data for the selected period.</li>
                </ul>
              </div>
            </div>
          </div>

          {/* General Tips */}
          <div className="bg-white rounded-xl border border-gray-200 p-5 sm:p-6 shadow-sm transition-all duration-200 hover:shadow-md hover:border-gray-300" style={{transitionTimingFunction:'cubic-bezier(.4,0,.2,1)'}}>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg flex items-center justify-center text-lg" style={{ background: '#FEF2F2' }}>💡</div>
              <h3 className="text-base font-bold text-gray-900">General Tips</h3>
            </div>
            <div className="space-y-2 text-sm text-gray-700">
              <ul className="list-disc list-inside space-y-1">
                <li><strong>Logo click:</strong> Click the Programs logo on any page to return to the home/landing page.</li>
                <li><strong>Multi-user sync:</strong> Use the Refresh button to load the latest data from other users.</li>
                <li><strong>File uploads:</strong> Files are stored in the database and visible to all users after refresh.</li>
                <li><strong>Import safety:</strong> Blank cells in imported files will NOT overwrite existing data.</li>
                <li><strong>Mobile:</strong> All dashboards are responsive and work on phones and tablets.</li>
                <li><strong>Need help?</strong> Contact your system administrator for account or access issues.</li>
              </ul>
            </div>
          </div>

        </div>
      </main>

      <footer style={{ borderTop: '1px solid #D6DFE8', padding: '20px', textAlign: 'right', fontSize: 12, color: '#5A6B7D', marginTop: 'auto' }}>
        Program Oversight Center &copy; 2026
      </footer>
    </div>
  );
}
