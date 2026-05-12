import { Link } from "react-router";
import { useAuth } from "@/hooks/useAuth";
import ProgramsEngineeringLogo from "@/components/ProgramsEngineeringLogo";

export default function Home() {
  const { user, isAuthenticated } = useAuth();

  return (
    <div className="min-h-screen" style={{ background: '#FFFFFF', fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, sans-serif' }}>
      {/* Programs Header */}
      <header style={{ background: 'linear-gradient(135deg, #16324F 0%, #0D2137 50%, #16324F 100%)', backgroundSize: '200% 200%', color: '#fff', position: 'sticky', top: 0, zIndex: 100, boxShadow: '0 4px 12px rgba(22,50,79,0.10)' }}>
        <div style={{ maxWidth: 1440, margin: '0 auto', padding: '10px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <Link to="/" style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, textDecoration: 'none', color: 'inherit' }}>
            <ProgramsEngineeringLogo size={72} borderRadius={8} />
            <div className="min-w-0">
              <h1 className="text-sm sm:text-[15px] font-bold truncate" style={{ letterSpacing: '-0.2px', lineHeight: 1.2 }}>Program Oversight Center</h1>
              <span className="text-[10px] block mt-0.5 opacity-55" style={{ textTransform: 'uppercase', letterSpacing: '1.5px' }}>Programs</span>
            </div>
          </Link>
          <div className="flex items-center gap-2 ml-auto flex-shrink-0">
            <Link to="/help" className="text-xs font-medium px-3 py-1.5 bg-white/10 border border-white/20 rounded-lg text-white hover:bg-white/20 transition">Help</Link>
            {isAuthenticated && user && (
              <div className="flex items-center gap-2 text-xs">
                <img src={user.avatar || undefined} alt="" className="w-6 h-6 sm:w-7 sm:h-7 rounded-full" style={{ background: 'rgba(255,255,255,0.1)' }} />
                <span className="hidden sm:inline max-w-[100px] truncate">{user.name}</span>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main style={{ maxWidth: 1200, margin: '0 auto', padding: '24px 16px 40px' }} className="sm:!px-5 sm:!py-10 lg:!px-6 lg:!pb-16">
        {/* Sub-header */}
        <div style={{ marginBottom: 32 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: '#0B1D44', letterSpacing: '-0.3px', marginBottom: 4 }}>Dashboard Suite</h2>
          <p style={{ fontSize: 13, color: '#5A6B7D' }}>Select a dashboard to access your O&M management tools</p>
        </div>

        {/* Dashboard Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Maintenance Planning (Post-PPP) */}
          <Link
            to="/equipment"
            className="block rounded-lg p-5 border transition-all duration-200 hover:shadow-lg hover:-translate-y-0.5"
            style={{
              background: '#FFFFFF',
              borderColor: '#D6DFE8',
              boxShadow: '0 1px 3px rgba(0,0,0,.08), 0 4px 12px rgba(0,0,0,.04)',
              textDecoration: 'none',
              color: 'inherit',
              transitionTimingFunction: 'cubic-bezier(.4,0,.2,1)',
            }}
            onMouseEnter={e=>{e.currentTarget.style.borderColor='#B8C8D8';e.currentTarget.style.boxShadow='0 4px 16px rgba(0,0,0,.1), 0 8px 24px rgba(0,0,0,.06)'}}
            onMouseLeave={e=>{e.currentTarget.style.borderColor='#D6DFE8';e.currentTarget.style.boxShadow='0 1px 3px rgba(0,0,0,.08), 0 4px 12px rgba(0,0,0,.04)'}}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <div style={{ width: 40, height: 40, borderRadius: 8, background: 'rgba(0,102,166,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>🔧</div>
              <div>
                <h3 style={{ fontSize: 15, fontWeight: 700, color: '#0B1D44', lineHeight: 1.3 }}>Maintenance Planning (Post-PPP)</h3>
              </div>
            </div>
            <p style={{ fontSize: 13, color: '#5A6B7D', lineHeight: 1.5, marginBottom: 14 }}>
              HTT STP &amp; Aglipay STP — 1,377 maintenance tasks across 128 equipment types with Edit/Save/Cancel workflow.
            </p>
            <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 12, background: '#E6F5EF', color: '#0A9B6E' }}>976 HTT Tasks</span>
              <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 12, background: '#E6F5EF', color: '#0A9B6E' }}>401 Aglipay Tasks</span>
              <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 12, background: '#FEF3C7', color: '#D97706' }}>128 Equip. Types</span>
            </div>
            <span style={{ fontSize: 13, fontWeight: 600, color: '#0066A6', display: 'flex', alignItems: 'center', gap: 4 }}>
              Open Dashboard →
            </span>
          </Link>

          {/* O&M Manual Governance */}
          <a
            href="/governance"
            className="block rounded-lg p-5 border transition-all duration-200 hover:shadow-lg hover:-translate-y-0.5"
            style={{
              background: '#FFFFFF',
              borderColor: '#D6DFE8',
              boxShadow: '0 1px 3px rgba(0,0,0,.08), 0 4px 12px rgba(0,0,0,.04)',
              textDecoration: 'none',
              color: 'inherit',
              transitionTimingFunction: 'cubic-bezier(.4,0,.2,1)',
            }}
            onMouseEnter={e=>{e.currentTarget.style.borderColor='#B8C8D8';e.currentTarget.style.boxShadow='0 4px 16px rgba(0,0,0,.1), 0 8px 24px rgba(0,0,0,.06)'}}
            onMouseLeave={e=>{e.currentTarget.style.borderColor='#D6DFE8';e.currentTarget.style.boxShadow='0 1px 3px rgba(0,0,0,.08), 0 4px 12px rgba(0,0,0,.04)'}}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <div style={{ width: 40, height: 40, borderRadius: 8, background: 'rgba(0,168,210,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>📊</div>
              <div>
                <h3 style={{ fontSize: 15, fontWeight: 700, color: '#0B1D44', lineHeight: 1.3 }}>O&amp;M Manual Governance</h3>
              </div>
            </div>
            <p style={{ fontSize: 13, color: '#5A6B7D', lineHeight: 1.5, marginBottom: 14 }}>
              Track 4 facilities (AGLIPAY, HTT, EASTBAY, KAYSAKAT) through 9 milestones with S-Curve progress and deliverables.
            </p>
            <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 12, background: '#FEF3C7', color: '#D97706' }}>4 Facilities</span>
              <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 12, background: '#FEF3C7', color: '#D97706' }}>9 Milestones</span>
              <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 12, background: '#FEF2F2', color: '#DC2626' }}>14 TOC Items</span>
            </div>
            <span style={{ fontSize: 13, fontWeight: 600, color: '#0066A6', display: 'flex', alignItems: 'center', gap: 4 }}>
              Open Dashboard →
            </span>
          </a>

          {/* Monthly KPI Scorecard */}
          <a
            href="/scorecard-kpi.html"
            className="block rounded-lg p-5 border transition-all duration-200 hover:shadow-lg hover:-translate-y-0.5"
            style={{
              background: '#FFFFFF',
              borderColor: '#D6DFE8',
              boxShadow: '0 1px 3px rgba(0,0,0,.08), 0 4px 12px rgba(0,0,0,.04)',
              textDecoration: 'none',
              color: 'inherit',
              transitionTimingFunction: 'cubic-bezier(.4,0,.2,1)',
            }}
            onMouseEnter={e=>{e.currentTarget.style.borderColor='#B8C8D8';e.currentTarget.style.boxShadow='0 4px 16px rgba(0,0,0,.1), 0 8px 24px rgba(0,0,0,.06)'}}
            onMouseLeave={e=>{e.currentTarget.style.borderColor='#D6DFE8';e.currentTarget.style.boxShadow='0 1px 3px rgba(0,0,0,.08), 0 4px 12px rgba(0,0,0,.04)'}}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <div style={{ width: 40, height: 40, borderRadius: 8, background: 'rgba(0,168,210,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>📈</div>
              <div>
                <h3 style={{ fontSize: 15, fontWeight: 700, color: '#0B1D44', lineHeight: 1.3 }}>Monthly KPI Scorecard</h3>
              </div>
            </div>
            <p style={{ fontSize: 13, color: '#5A6B7D', lineHeight: 1.5, marginBottom: 14 }}>
              Track 8 KPIs across 5 business units with color-coded performance, Excel import, and budget analytics.
            </p>
            <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 12, background: '#E6F5EF', color: '#0A9B6E' }}>5 BUs</span>
              <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 12, background: '#F0F9FF', color: '#0066A6' }}>8 KPIs</span>
              <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 12, background: '#FEF3C7', color: '#D97706' }}>Excel Import</span>
            </div>
            <span style={{ fontSize: 13, fontWeight: 600, color: '#0066A6', display: 'flex', alignItems: 'center', gap: 4 }}>
              Open Scorecard →
            </span>
          </a>

          {/* Operator-Driven Maintenance */}
          <a
            href="/mw-dashboard.html"
            className="block rounded-lg p-5 border transition-all duration-200 hover:shadow-lg hover:-translate-y-0.5"
            style={{
              background: '#FFFFFF',
              borderColor: '#D6DFE8',
              boxShadow: '0 1px 3px rgba(0,0,0,.08), 0 4px 12px rgba(0,0,0,.04)',
              textDecoration: 'none',
              color: 'inherit',
              transitionTimingFunction: 'cubic-bezier(.4,0,.2,1)',
            }}
            onMouseEnter={e=>{e.currentTarget.style.borderColor='#B8C8D8';e.currentTarget.style.boxShadow='0 4px 16px rgba(0,0,0,.1), 0 8px 24px rgba(0,0,0,.06)'}}
            onMouseLeave={e=>{e.currentTarget.style.borderColor='#D6DFE8';e.currentTarget.style.boxShadow='0 1px 3px rgba(0,0,0,.08), 0 4px 12px rgba(0,0,0,.04)'}}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <div style={{ width: 40, height: 40, borderRadius: 8, background: 'rgba(42,170,138,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>🏭</div>
              <div>
                <h3 style={{ fontSize: 15, fontWeight: 700, color: '#0B1D44', lineHeight: 1.3 }}>Operator-Driven Maintenance</h3>
              </div>
            </div>
            <p style={{ fontSize: 13, color: '#5A6B7D', lineHeight: 1.5, marginBottom: 14 }}>
              Corporate analytics, predictive insights, inspector tracking, data quality, and escalation monitoring.
            </p>
            <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 12, background: '#E6F5EF', color: '#0A9B6E' }}>Analytics</span>
              <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 12, background: '#E6F5EF', color: '#0A9B6E' }}>Predictive</span>
              <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 12, background: '#E6F5EF', color: '#0A9B6E' }}>Insights</span>
            </div>
            <span style={{ fontSize: 13, fontWeight: 600, color: '#0066A6', display: 'flex', alignItems: 'center', gap: 4 }}>
              Open Dashboard →
            </span>
          </a>
        </div>
      </main>

      {/* Footer */}
      <footer style={{ borderTop: '1px solid #D6DFE8', padding: '20px', textAlign: 'center', fontSize: 12, color: '#5A6B7D', marginTop: 'auto' }}>
        <span style={{ fontWeight: 600, color: '#16324F' }}>Programs</span> — Program Oversight Center
      </footer>
    </div>
  );
}
