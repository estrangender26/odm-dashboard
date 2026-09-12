import { Link, useNavigate } from "react-router";
import { useRef } from "react";
import {
  Activity,
  ArrowRight,
  BookOpenCheck,
  CalendarDays,
  ClipboardList,
  Factory,
  Library,
  LogOut,
  Presentation,
  ShieldCheck,
} from "lucide-react";
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
    "group flex flex-col rounded-[10px] border p-4 no-underline text-inherit cursor-pointer transition-[border-color,box-shadow,transform] duration-150 ease-out motion-reduce:transition-none motion-reduce:transform-none hover:border-[var(--odm-border-strong)] hover:shadow-[var(--odm-shadow-sm)] md:hover:-translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--odm-blue)]/35 focus-visible:ring-offset-2 active:translate-y-0 active:shadow-none";
  const navCardStyle = {
    background: "var(--odm-surface)",
    borderColor: "var(--odm-border)",
    color: "inherit",
  } as const;

  /* Icon treatment: a 40px tinted square, one restrained accent per module
     family, sourced from the existing ODM identity — never a rainbow. */
  const iconTile = (tint: "blue" | "navy" | "green") => ({
    width: 40, height: 40, borderRadius: 8, flex: "0 0 auto",
    display: "flex", alignItems: "center", justifyContent: "center",
    background: tint === "green" ? "var(--odm-success-bg)" : tint === "blue" ? "var(--odm-blue-soft)" : "#EEF2F7",
    border: `1px solid ${tint === "green" ? "var(--odm-success-border)" : tint === "blue" ? "var(--odm-blue-border)" : "#DBE3EC"}`,
    color: tint === "green" ? "var(--odm-success)" : tint === "blue" ? "var(--odm-blue)" : "var(--odm-navy)",
  } as const);

  /* Badges communicate state, not decoration: neutral unless the value is
     genuinely healthy / at-risk. Values themselves are unchanged. */
  const badgeStyle = (kind: "neutral" | "success" = "neutral") => ({
    fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 6,
    lineHeight: "18px", whiteSpace: "nowrap",
    background: kind === "success" ? "var(--odm-success-bg)" : "var(--odm-neutral-bg)",
    color: kind === "success" ? "var(--odm-success)" : "var(--odm-neutral-ink)",
    border: `1px solid ${kind === "success" ? "var(--odm-success-border)" : "var(--odm-border)"}`,
  } as const);

  const cardTitleStyle = { fontSize: 15, fontWeight: 700, color: "var(--odm-text-strong)", letterSpacing: "-0.2px", lineHeight: 1.3, margin: 0 } as const;
  const cardDescStyle = { fontSize: 13, color: "var(--odm-text-muted)", lineHeight: 1.55, margin: "0 0 12px" } as const;
  const cardTaglineStyle = { fontSize: 12, color: "var(--odm-text-faint)", margin: "3px 0 0" } as const;
  const cardMetaStyle = { display: "flex", gap: 6, flexWrap: "wrap" as const, marginBottom: 12 };
  const cardCtaStyle = { fontSize: 12.5, fontWeight: 600, color: "var(--odm-blue)", display: "flex", alignItems: "center", gap: 4 } as const;
  const newTagStyle = { fontSize: 9, fontWeight: 700, padding: "1px 6px", borderRadius: 4, background: "var(--odm-blue)", color: "#fff", textTransform: "uppercase" as const, letterSpacing: ".06em" };

  return (
    <div className="odm-canvas min-h-screen" style={{ fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, sans-serif' }}>
      {/* Programs Header */}
      <header style={{ background: 'linear-gradient(180deg, var(--odm-navy) 0%, var(--odm-navy-deep) 100%)', color: '#fff', position: 'sticky', top: 0, zIndex: 100, borderBottom: '1px solid rgba(255,255,255,.08)', boxShadow: 'var(--odm-shadow-sm)' }}>
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
          <h2 style={{ fontSize: 18, fontWeight: 700, color: 'var(--odm-text-strong)', letterSpacing: '-0.3px', marginBottom: 4 }}>Dashboard Suite</h2>
          <p style={{ fontSize: 13, color: '#5A6B7D' }}>Select a dashboard to access your O&M management tools</p>
        </div>

        {/* Dashboard Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {/* O&M Manual Governance */}
          <a href="/governance" className={navCardClassName} style={navCardStyle}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 12 }}>
              <span style={iconTile("blue")}><ShieldCheck size={19} strokeWidth={2} aria-hidden="true" /></span>
              <h3 style={cardTitleStyle}>O&amp;M Manual Governance</h3>
            </div>
            <p style={cardDescStyle}>
              Track 4 facilities (AGLIPAY, HTT, EASTBAY, KAYSAKAT) through 9 milestones with S-Curve progress and deliverables.
            </p>
            <div style={cardMetaStyle}>
              <span style={badgeStyle()}>4 Facilities</span>
              <span style={badgeStyle()}>9 Milestones</span>
              <span style={badgeStyle()}>14 TOC Items</span>
            </div>
            <span style={{ ...cardCtaStyle, marginTop: 'auto' }}>
              Open Dashboard <ArrowRight size={14} aria-hidden="true" />
            </span>
          </a>

          {/* Monthly KPI Scorecard */}
          <a href="/scorecard-kpi" className={navCardClassName} style={navCardStyle}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 12 }}>
              <span style={iconTile("blue")}><Activity size={19} strokeWidth={2} aria-hidden="true" /></span>
              <h3 style={cardTitleStyle}>Monthly KPI Scorecard</h3>
            </div>
            <p style={cardDescStyle}>
              Track 8 KPIs across 5 business units with color-coded performance, Excel import, and budget analytics.
            </p>
            <div style={cardMetaStyle}>
              <span style={badgeStyle()}>5 BUs</span>
              <span style={badgeStyle()}>8 KPIs</span>
              <span style={badgeStyle()}>Excel Import</span>
            </div>
            <span style={{ ...cardCtaStyle, marginTop: 'auto' }}>
              Open Scorecard <ArrowRight size={14} aria-hidden="true" />
            </span>
          </a>

          {/* Operator-Driven Maintenance */}
          <a href="/mw-dashboard" className={navCardClassName} style={navCardStyle}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 12 }}>
              <span style={iconTile("green")}><Factory size={19} strokeWidth={2} aria-hidden="true" /></span>
              <h3 style={cardTitleStyle}>Operator-Driven Maintenance</h3>
            </div>
            <p style={cardDescStyle}>
              Corporate analytics, predictive insights, inspector tracking, data quality, and escalation monitoring.
            </p>
            <div style={cardMetaStyle}>
              <span style={badgeStyle()}>Analytics</span>
              <span style={badgeStyle()}>Predictive</span>
              <span style={badgeStyle()}>Insights</span>
            </div>
            <span style={{ ...cardCtaStyle, marginTop: 'auto' }}>
              Open Dashboard <ArrowRight size={14} aria-hidden="true" />
            </span>
          </a>

          {/* ODM Primavera Lite */}
          <Link to="/gantt" className={navCardClassName} style={navCardStyle}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 12 }}>
              <span style={iconTile("navy")}><CalendarDays size={19} strokeWidth={2} aria-hidden="true" /></span>
              <h3 style={cardTitleStyle}>Primavera Lite</h3>
            </div>
            <p style={cardDescStyle}>
              ODM Primavera Lite Online — link-based project scheduling. Create WBS, activities, dependencies, and schedules without an account.
            </p>
            <div style={cardMetaStyle}>
              <span style={badgeStyle()}>Gantt</span>
              <span style={badgeStyle()}>CRUD</span>
              <span style={badgeStyle()}>Excel</span>
            </div>
            <span style={{ ...cardCtaStyle, marginTop: 'auto' }}>
              Open Primavera Lite <ArrowRight size={14} aria-hidden="true" />
            </span>
          </Link>

          {/* SMP — Standard Maintenance Procedures */}
          <Link to="/smp-dashboard" className={navCardClassName} style={navCardStyle}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 12 }}>
              <span style={iconTile("navy")}><BookOpenCheck size={19} strokeWidth={2} aria-hidden="true" /></span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <h3 style={cardTitleStyle}>Standard Maintenance Procedures</h3>
                  <span style={newTagStyle}>New</span>
                </div>
                <p style={cardTaglineStyle}>Centralized repository for SOPs, SMPs, and preventive maintenance documentation.</p>
              </div>
            </div>
            <p style={cardDescStyle}>
              Browse maintenance procedure documents organized by equipment type and system. PDF viewer with upload/download support. Searchable and filterable document library.
            </p>
            <div style={cardMetaStyle}>
              <span style={badgeStyle()}>Documents</span>
              <span style={badgeStyle()}>PDF</span>
              <span style={badgeStyle()}>Upload</span>
              <span style={badgeStyle()}>Download</span>
            </div>
            <span style={{ ...cardCtaStyle, marginTop: 'auto' }}>
              Open SMP Library <ArrowRight size={14} aria-hidden="true" />
            </span>
          </Link>

          {/* O&M Manuals Library */}
          <Link to="/om-manuals-library" className={navCardClassName} style={navCardStyle}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 12 }}>
              <span style={iconTile("navy")}><Library size={19} strokeWidth={2} aria-hidden="true" /></span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <h3 style={cardTitleStyle}>O&amp;M Manuals Library</h3>
                <p style={cardTaglineStyle}>Full O&amp;M Manuals for each facility — search, view, and download.</p>
              </div>
            </div>
            <p style={cardDescStyle}>
              Browse full Operation and Maintenance Manuals for each facility. Search by plant, equipment type, or system. View and download PDF manuals.
            </p>
            <div style={cardMetaStyle}>
              <span style={badgeStyle()}>Manuals</span>
              <span style={badgeStyle()}>PDF</span>
              <span style={badgeStyle()}>Search</span>
              <span style={badgeStyle()}>Download</span>
            </div>
            <span style={{ ...cardCtaStyle, marginTop: 'auto' }}>
              Open O&amp;M Library <ArrowRight size={14} aria-hidden="true" />
            </span>
          </Link>

          {/* Projects without PPP — Masterdata Submittal Monitoring */}
          <Link to="/projects-without-ppp" className={navCardClassName} style={navCardStyle}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 12 }}>
              <span style={iconTile("blue")}><ClipboardList size={19} strokeWidth={2} aria-hidden="true" /></span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <h3 style={cardTitleStyle}>Projects without PPP</h3>
                  <span style={newTagStyle}>New</span>
                </div>
                <p style={cardTaglineStyle}>Masterdata submittal monitoring for 50 projects — upload Excel/PDF, track submission status.</p>
              </div>
            </div>
            <p style={cardDescStyle}>
              Monitoring-first dashboard: submission KPIs, filtering, and per-project masterdata upload for the Projects without PPP population.
            </p>
            <div style={cardMetaStyle}>
              <span style={badgeStyle()}>50 Projects</span>
              <span style={badgeStyle("success")}>Submitted</span>
              <span style={badgeStyle()}>Upload</span>
            </div>
            <span style={{ ...cardCtaStyle, marginTop: 'auto' }}>
              Open Monitoring <ArrowRight size={14} aria-hidden="true" />
            </span>
          </Link>

          {/* Presentation Center */}
          <Link to="/presentation-center" className={navCardClassName} style={navCardStyle}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 12 }}>
              <span style={iconTile("blue")}><Presentation size={19} strokeWidth={2} aria-hidden="true" /></span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <h3 style={cardTitleStyle}>Presentation Center</h3>
                <p style={cardTaglineStyle}>Create, manage, and generate PowerPoint presentations from dashboard data.</p>
              </div>
            </div>
            <p style={cardDescStyle}>
              Upload PowerPoint decks, maintain a presentation library, generate Monthly KPI Scorecard decks, and prepare for future AI-assisted deck generation.
            </p>
            <div style={cardMetaStyle}>
              <span style={badgeStyle()}>PPTX</span>
              <span style={badgeStyle()}>Generate</span>
              <span style={badgeStyle()}>Library</span>
            </div>
            <span style={{ ...cardCtaStyle, marginTop: 'auto' }}>
              Open Presentation Center <ArrowRight size={14} aria-hidden="true" />
            </span>
          </Link>

        </div>
      </main>

      {/* Footer */}
      <footer style={{ borderTop: '1px solid var(--odm-border)', background: 'var(--odm-surface)', padding: '14px 20px', textAlign: 'right', fontSize: 12, color: 'var(--odm-text-muted)', marginTop: 'auto' }}>
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
        ]}
      />
    </div>
  );
}
