import { Link } from "react-router";
import { useAuth } from "@/hooks/useAuth";

export default function Home() {
  const { user, isAuthenticated } = useAuth();

  return (
    <div className="min-h-screen" style={{ background: '#FFFFFF', fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, sans-serif' }}>
      {/* Manila Water Header */}
      <header style={{ background: 'linear-gradient(180deg, #0B1D44 0%, #07132E 100%)', color: '#fff', position: 'sticky', top: 0, zIndex: 100, boxShadow: '0 2px 8px rgba(0,0,0,.06)' }}>
        <div style={{ maxWidth: 1440, margin: '0 auto', padding: '10px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
            <img src="/mw-logo.png" alt="Manila Water" style={{ width: 28, height: 28, background: '#fff', borderRadius: 4, padding: 2, flexShrink: 0 }} />
            <div>
              <h1 style={{ fontSize: 15, fontWeight: 700, letterSpacing: '-0.2px', lineHeight: 1.2, whiteSpace: 'nowrap' }}>Program Oversight Center</h1>
              <span style={{ fontSize: 10, opacity: 0.7, textTransform: 'uppercase', letterSpacing: '0.5px', display: 'block', marginTop: 1 }}>Care in Every Drop</span>
            </div>
          </div>
          {isAuthenticated && user && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
              <img src={user.avatar || undefined} alt="" style={{ width: 28, height: 28, borderRadius: '50%', background: 'rgba(255,255,255,0.1)' }} />
              <span>{user.name}</span>
            </div>
          )}
        </div>
      </header>

      {/* Main Content */}
      <main style={{ maxWidth: 1200, margin: '0 auto', padding: '40px 20px 60px' }}>
        {/* Sub-header */}
        <div style={{ marginBottom: 32 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: '#0B1D44', letterSpacing: '-0.3px', marginBottom: 4 }}>Dashboard Suite</h2>
          <p style={{ fontSize: 13, color: '#5A6B7D' }}>Select a dashboard to access your O&M management tools</p>
        </div>

        {/* Dashboard Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Maintenance Planning Post-PPP */}
          <Link
            to="/equipment"
            className="block rounded-lg p-5 border transition hover:shadow-lg hover:-translate-y-0.5"
            style={{
              background: '#FFFFFF',
              borderColor: '#D6DFE8',
              boxShadow: '0 1px 3px rgba(0,0,0,.08), 0 4px 12px rgba(0,0,0,.04)',
              textDecoration: 'none',
              color: 'inherit',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <div style={{ width: 40, height: 40, borderRadius: 8, background: 'rgba(0,102,166,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>🔧</div>
              <div>
                <h3 style={{ fontSize: 15, fontWeight: 700, color: '#0B1D44', lineHeight: 1.3 }}>Maintenance Planning Post-PPP</h3>
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
            className="block rounded-lg p-5 border transition hover:shadow-lg hover:-translate-y-0.5"
            style={{
              background: '#FFFFFF',
              borderColor: '#D6DFE8',
              boxShadow: '0 1px 3px rgba(0,0,0,.08), 0 4px 12px rgba(0,0,0,.04)',
              textDecoration: 'none',
              color: 'inherit',
            }}
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

          {/* Operator-Driven Maintenance */}
          <a
            href="/mw-dashboard"
            className="block rounded-lg p-5 border transition hover:shadow-lg hover:-translate-y-0.5"
            style={{
              background: '#FFFFFF',
              borderColor: '#D6DFE8',
              boxShadow: '0 1px 3px rgba(0,0,0,.08), 0 4px 12px rgba(0,0,0,.04)',
              textDecoration: 'none',
              color: 'inherit',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <div style={{ width: 40, height: 40, borderRadius: 8, background: 'rgba(42,170,138,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>🏭</div>
              <div>
                <h3 style={{ fontSize: 15, fontWeight: 700, color: '#0B1D44', lineHeight: 1.3 }}>Operator-Driven Maintenance</h3>
              </div>
            </div>
            <p style={{ fontSize: 13, color: '#5A6B7D', lineHeight: 1.5, marginBottom: 14 }}>
              Manila Water corporate analytics, predictive insights, inspector tracking, data quality, and escalation monitoring.
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
        <span style={{ fontWeight: 600, color: '#0B1D44' }}>Manila Water</span> — Program Oversight Center — Care in Every Drop
      </footer>
    </div>
  );
}
