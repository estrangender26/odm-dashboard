import { Link, useNavigate } from "react-router";
import { useRef } from "react";
import { LogOut } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import ProgramsEngineeringLogo from "@/components/ProgramsEngineeringLogo";
import AIAssistant from "@/components/AIAssistant";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LOGIN_PATH } from "@/const";

export default function Home() {
  const { user, isAuthenticated, logout } = useAuth();
  const navigate = useNavigate();

  // Hidden OWNER entry: 5 clicks on the dashboard logo/title within a rolling
  // 3-second window navigates to /login. Invisible by design — no counter,
  // toast, tooltip, or console output. Convenience only; security stays on
  // Google OAuth + server-side role assignment.
  //
  // Reliability notes:
  // - preventDefault() stops the surrounding React Router Link from running its
  //   own navigate("/") after this handler — previously the Link navigation
  //   fired after navigate(LOGIN_PATH) on the 5th click and clobbered it, so
  //   the gesture appeared dead. With preventDefault, React Router's
  //   useLinkClickHandler skips its navigation entirely and no router work
  //   (re-render/remount) can interfere with click accumulation.
  // - A true rolling 3-second window: clicks older than 3s are dropped, so the
  //   five clicks must all fall within any 3-second span. No timer state is
  //   needed; the array is reset after a successful trigger.
  const ownerClicks = useRef<number[]>([]);

  const handleOwnerLogoClick = (event: React.MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    const now = Date.now();
    ownerClicks.current = ownerClicks.current.filter((t) => now - t < 3000);
    ownerClicks.current.push(now);
    if (ownerClicks.current.length >= 5) {
      ownerClicks.current = [];
      navigate(LOGIN_PATH);
    }
  };
  const navCardClassName =
    "block rounded-xl border p-5 no-underline text-inherit cursor-pointer transition-all duration-200 ease-out motion-reduce:transition-none motion-reduce:transform-none md:hover:-translate-y-0.5 md:hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#005BAC]/35 focus-visible:ring-offset-2 active:translate-y-0 active:shadow-sm";
  const navCardStyle = {
    background: "#FFFFFF",
    borderColor: "#D6DFE8",
    boxShadow: "0 1px 3px rgba(0,0,0,.08), 0 4px 12px rgba(0,0,0,.04)",
    color: "inherit",
  } as const;

  return (
    <div className="min-h-screen" style={{ background: '#FFFFFF', fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, sans-serif' }}>
      {/* Programs Header */}
      <header style={{ background: 'linear-gradient(135deg, #16324F 0%, #0D2137 50%, #16324F 100%)', backgroundSize: '200% 200%', color: '#fff', position: 'sticky', top: 0, zIndex: 100, boxShadow: '0 4px 12px rgba(22,50,79,0.10)' }}>
        <div style={{ maxWidth: 1440, margin: '0 auto', padding: '10px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <Link to="/" onClick={handleOwnerLogoClick} style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, textDecoration: 'none', color: 'inherit' }}>
            <ProgramsEngineeringLogo size={72} borderRadius={8} />
            <div className="min-w-0">
              <h1 className="text-sm sm:text-[15px] font-bold truncate" style={{ letterSpacing: '-0.2px', lineHeight: 1.2 }}>Program Oversight Center</h1>
              <span className="text-[10px] block mt-0.5 opacity-55" style={{ textTransform: 'uppercase', letterSpacing: '1.5px' }}>Programs</span>
            </div>
          </Link>
          <div className="flex items-center gap-2 ml-auto flex-shrink-0">
            <Link to="/help" className="text-xs font-medium px-3 py-1.5 bg-white/10 border border-white/20 rounded-lg text-white hover:bg-white/20 transition">Help</Link>
            {isAuthenticated && user && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    aria-label="Account menu"
                    className="flex items-center gap-2 text-xs rounded-lg px-1.5 py-1 hover:bg-white/10 transition cursor-pointer"
                  >
                    <img src={user.avatar || undefined} alt="" className="w-6 h-6 sm:w-7 sm:h-7 rounded-full" style={{ background: 'rgba(255,255,255,0.1)' }} />
                    <span className="hidden sm:inline max-w-[100px] truncate">{user.name}</span>
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  className="w-48 z-[110]"
                >
                  <DropdownMenuItem
                    onClick={logout}
                    className="cursor-pointer text-destructive focus:text-destructive"
                  >
                    <LogOut className="mr-2 h-4 w-4" />
                    <span>Sign out</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
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
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {/* Post-Planning Insights & Action Plan */}
          <Link
            to="/post-planning-insights"
            className={navCardClassName}
            style={navCardStyle}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <div style={{ width: 40, height: 40, borderRadius: 8, background: 'rgba(234,88,12,0.10)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>📈</div>
              <div>
                <h3 style={{ fontSize: 15, fontWeight: 700, color: '#0B1D44', lineHeight: 1.3 }}>Post-Planning Insights &amp; Action Plan</h3>
              </div>
            </div>
            <p style={{ fontSize: 13, color: '#5A6B7D', lineHeight: 1.5, marginBottom: 14 }}>
              KPI dashboard, interactive charts, generated action plan, and Post-Planning AI assistant using live HTT STP and Aglipay STP task data.
            </p>
            <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 12, background: '#DBEAFE', color: '#1D4ED8' }}>KPIs</span>
              <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 12, background: '#FFEDD5', color: '#EA580C' }}>Action Plan</span>
              <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 12, background: '#E0E7FF', color: '#4F46E5' }}>AI Assistant</span>
            </div>
            <span style={{ fontSize: 13, fontWeight: 600, color: '#EA580C', display: 'flex', alignItems: 'center', gap: 4 }}>
              Open Insights →
            </span>
          </Link>

          {/* Maintenance Planning (Post-PPP) */}
          <Link
            to="/equipment"
            className={navCardClassName}
            style={navCardStyle}
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
              Open Task Table →
            </span>
          </Link>

          {/* O&M Manual Governance */}
          <a
            href="/governance"
            className={navCardClassName}
            style={navCardStyle}
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
            href="/scorecard-kpi"
            className={navCardClassName}
            style={navCardStyle}
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
            href="/mw-dashboard"
            className={navCardClassName}
            style={navCardStyle}
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

          {/* ODM Primavera Lite */}
          <Link
            to="/gantt"
            className={navCardClassName}
            style={navCardStyle}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <div style={{ width: 40, height: 40, borderRadius: 8, background: 'rgba(124,58,237,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>📅</div>
              <div>
                <h3 style={{ fontSize: 15, fontWeight: 700, color: '#0B1D44', lineHeight: 1.3 }}>ODM Primavera Lite</h3>
              </div>
            </div>
            <p style={{ fontSize: 13, color: '#5A6B7D', lineHeight: 1.5, marginBottom: 14 }}>
              ODM Primavera Lite Online — link-based project scheduling. Create WBS, activities, dependencies, and schedules without an account.
            </p>
            <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 12, background: '#EDE9FE', color: '#7C3AED' }}>Gantt</span>
              <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 12, background: '#EDE9FE', color: '#7C3AED' }}>CRUD</span>
              <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 12, background: '#FEF3C7', color: '#D97706' }}>Excel</span>
            </div>
            <span style={{ fontSize: 13, fontWeight: 600, color: '#0066A6', display: 'flex', alignItems: 'center', gap: 4 }}>
              Open Primavera Lite →
            </span>
          </Link>

          {/* SMP — Standard Maintenance Procedures */}
          <Link
            to="/smp-dashboard"
            className={navCardClassName}
            style={navCardStyle}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, marginBottom: 10 }}>
              <div style={{ width: 44, height: 44, borderRadius: 10, background: 'linear-gradient(135deg, #0B1D44 0%, #005BAC 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, flexShrink: 0 }}>
                📘
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <h3 style={{ fontSize: 15, fontWeight: 700, color: '#0B1D44', lineHeight: 1.3, margin: 0 }}>Standard Maintenance Procedures</h3>
                  <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 4, background: '#005BAC', color: '#fff', textTransform: 'uppercase', letterSpacing: '0.5px' }}>New</span>
                </div>
                <p style={{ fontSize: 12, color: '#8BA3B8', margin: '4px 0 0' }}>
                  Centralized repository for SOPs, SMPs, and preventive maintenance documentation.
                </p>
              </div>
            </div>
            <p style={{ fontSize: 14, color: '#5A6B7D', lineHeight: 1.6, margin: '0 0 14px' }}>
              Browse maintenance procedure documents organized by equipment type and system. PDF viewer with upload/download support. Searchable and filterable document library.
            </p>
            <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 12, background: '#DBEAFE', color: '#005BAC' }}>Documents</span>
              <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 12, background: '#DBEAFE', color: '#005BAC' }}>PDF</span>
              <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 12, background: '#FEF3C7', color: '#D97706' }}>Upload</span>
              <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 12, background: '#D1FAE5', color: '#059669' }}>Download</span>
            </div>
            <span style={{ fontSize: 13, fontWeight: 600, color: '#005BAC', display: 'flex', alignItems: 'center', gap: 4 }}>
              Open SMP Library →
            </span>
          </Link>

          {/* O&M Manuals Library */}
          <Link
            to="/om-manuals-library"
            className={navCardClassName}
            style={navCardStyle}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, marginBottom: 10 }}>
              <div style={{ width: 44, height: 44, borderRadius: 10, background: 'linear-gradient(135deg, #1E3A5F 0%, #0B1D44 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, flexShrink: 0 }}>
                📖
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <h3 style={{ fontSize: 15, fontWeight: 700, color: '#0B1D44', lineHeight: 1.3, margin: 0 }}>O&M Manuals Library</h3>
                <p style={{ fontSize: 12, color: '#8BA3B8', margin: '4px 0 0' }}>
                  Full O&M Manuals for each facility — search, view, and download.
                </p>
              </div>
            </div>
            <p style={{ fontSize: 14, color: '#5A6B7D', lineHeight: 1.6, margin: '0 0 14px' }}>
              Browse full Operation and Maintenance Manuals for each facility. Search by plant, equipment type, or system. View and download PDF manuals.
            </p>
            <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 12, background: '#DBEAFE', color: '#005BAC' }}>Manuals</span>
              <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 12, background: '#DBEAFE', color: '#005BAC' }}>PDF</span>
              <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 12, background: '#FEF3C7', color: '#D97706' }}>Search</span>
              <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 12, background: '#D1FAE5', color: '#059669' }}>Download</span>
            </div>
            <span style={{ fontSize: 13, fontWeight: 600, color: '#005BAC', display: 'flex', alignItems: 'center', gap: 4 }}>
              Open O&M Library →
            </span>
          </Link>

          {/* Projects without PPP — Masterdata Submittal Monitoring */}
          <Link
            to="/projects-without-ppp"
            className={navCardClassName}
            style={navCardStyle}
          >
            <div style={{ display: "flex", alignItems: "flex-start", gap: 14, marginBottom: 10 }}>
              <div style={{ width: 44, height: 44, borderRadius: 10, background: "linear-gradient(135deg, #0F766E 0%, #0B1D44 100%)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, flexShrink: 0 }}>
                📋
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <h3 style={{ fontSize: 15, fontWeight: 700, color: "#0B1D44", lineHeight: 1.3, margin: 0 }}>Projects without PPP</h3>
                  <span style={{ fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 4, background: "#005BAC", color: "#fff", textTransform: "uppercase", letterSpacing: "0.5px" }}>New</span>
                </div>
                <p style={{ fontSize: 12, color: "#8BA3B8", margin: "4px 0 0" }}>
                  Masterdata submittal monitoring for 50 projects — upload Excel/PDF, track submission status.
                </p>
              </div>
            </div>
            <p style={{ fontSize: 14, color: "#5A6B7D", lineHeight: 1.6, margin: "0 0 14px" }}>
              Monitoring-first dashboard: submission KPIs, filtering, and per-project masterdata upload for the Projects without PPP population.
            </p>
            <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
              <span style={{ fontSize: 11, fontWeight: 600, padding: "3px 10px", borderRadius: 12, background: "#DBEAFE", color: "#005BAC" }}>50 Projects</span>
              <span style={{ fontSize: 11, fontWeight: 600, padding: "3px 10px", borderRadius: 12, background: "#D1FAE5", color: "#059669" }}>Submitted</span>
              <span style={{ fontSize: 11, fontWeight: 600, padding: "3px 10px", borderRadius: 12, background: "#FEF3C7", color: "#D97706" }}>Upload</span>
            </div>
            <span style={{ fontSize: 13, fontWeight: 600, color: "#005BAC", display: "flex", alignItems: "center", gap: 4 }}>
              Open Monitoring →
            </span>
          </Link>

          {/* Presentation Center */}
          <Link
            to="/presentation-center"
            className={navCardClassName}
            style={navCardStyle}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, marginBottom: 10 }}>
              <div style={{ width: 44, height: 44, borderRadius: 10, background: 'linear-gradient(135deg, #005BAC 0%, #00A8D2 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, flexShrink: 0 }}>
                📊
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <h3 style={{ fontSize: 15, fontWeight: 700, color: '#0B1D44', lineHeight: 1.3, margin: 0 }}>Presentation Center</h3>
                <p style={{ fontSize: 12, color: '#8BA3B8', margin: '4px 0 0' }}>
                  Create, manage, and generate PowerPoint presentations from dashboard data.
                </p>
              </div>
            </div>
            <p style={{ fontSize: 14, color: '#5A6B7D', lineHeight: 1.6, margin: '0 0 14px' }}>
              Upload PowerPoint decks, maintain a presentation library, generate Monthly KPI Scorecard decks, and prepare for future AI-assisted deck generation.
            </p>
            <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 12, background: '#DBEAFE', color: '#005BAC' }}>PPTX</span>
              <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 12, background: '#FEF3C7', color: '#D97706' }}>Generate</span>
              <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 12, background: '#D1FAE5', color: '#059669' }}>Library</span>
            </div>
            <span style={{ fontSize: 13, fontWeight: 600, color: '#005BAC', display: 'flex', alignItems: 'center', gap: 4 }}>
              Open Presentation Center →
            </span>
          </Link>
        </div>
      </main>

      {/* Footer */}
      <footer style={{ borderTop: '1px solid #D6DFE8', padding: '20px', textAlign: 'right', fontSize: 12, color: '#5A6B7D', marginTop: 'auto' }}>
        Program Oversight Center &copy; 2026
      </footer>

      {/* Unified AI Assistant */}
      <AIAssistant
        contextType="help"
        metadata={{
          sourceModule: "Help",
          sourceRecordId: "home-dashboard-suite",
          sourceRecordLabel: "Dashboard Suite Home",
        }}
        title="ODM Dashboard AI"
        quickQuestions={[
          "What can this dashboard do?",
          "Which module should I open?",
          "How do I use Maintenance Planning?",
        ]}
      />
    </div>
  );
}
