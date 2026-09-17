import { useRef } from "react";
import { useNavigate } from "react-router";
import { LogOut } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import AIAssistant from "@/components/AIAssistant";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  MODULE_IDENTITY,
  PE_TAGLINE,
  PE_VERBS,
  PeHeroGeometry,
  PeIconOrb,
  PeModuleCard,
  SuiteMasthead,
} from "@/components/programs";
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

  const verbIcons = [
    MODULE_IDENTITY.primavera.icon,
    MODULE_IDENTITY.odm.icon,
    MODULE_IDENTITY.scorecard.icon,
    MODULE_IDENTITY.governance.icon,
  ];

  return (
    <div
      className="odm-canvas min-h-screen flex flex-col"
      style={{ fontFamily: "Inter, -apple-system, BlinkMacSystemFont, sans-serif" }}
    >
      <SuiteMasthead
        suiteTitle="Program Oversight Center"
        onClick={handleOwnerLogoClick}
        actions={
          <>
            <a
              href="/help"
              className="pe-btn pe-btn--secondary"
              style={{ textDecoration: "none", fontSize: 12.5 }}
            >
              Help
            </a>
            {isAuthenticated && user && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    aria-label="Account menu"
                    className="pe-focusable"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      fontSize: 12,
                      borderRadius: 8,
                      padding: "3px 6px",
                      background: "transparent",
                      border: "1px solid var(--pe-border)",
                      cursor: "pointer",
                      color: "var(--pe-text)",
                    }}
                  >
                    <img
                      src={user.avatar || undefined}
                      alt=""
                      style={{
                        width: 24,
                        height: 24,
                        borderRadius: "50%",
                        background: "var(--pe-surface-sunk)",
                      }}
                    />
                    <span
                      className="hidden sm:inline"
                      style={{
                        maxWidth: 100,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {user.name}
                    </span>
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48 z-[110]">
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
          </>
        }
      />

      {/* ── Programs Engineering hero ──────────────────────────────────────
          The reference banner's composition translated for the application:
          white-dominant, identity on the left, engineering geometry on the
          right, and the banner's four circular verbs beneath the tagline. */}
      <section className="pe-hero">
        <div className="pe-hero__inner">
          <div className="pe-hero__copy">
            <p className="odm-eyebrow" style={{ margin: "0 0 10px", color: "var(--pe-text-faint)" }}>
              Programs Engineering
            </p>
            <h1 style={{ margin: 0, display: "flex", flexDirection: "column", gap: 2 }}>
              <span
                className="pe-wordmark__line1"
                style={{
                  fontSize: "clamp(30px, 5vw, 52px)",
                  fontWeight: 800,
                  letterSpacing: "0.1em",
                  lineHeight: 1.02,
                }}
              >
                Programs
              </span>
              <span
                className="pe-wordmark__line2"
                style={{
                  fontSize: "clamp(30px, 5vw, 52px)",
                  fontWeight: 800,
                  letterSpacing: "0.1em",
                  lineHeight: 1.02,
                }}
              >
                Engineering
              </span>
            </h1>
            <p
              style={{
                margin: "12px 0 0",
                fontSize: 14.5,
                color: "var(--pe-text)",
                letterSpacing: "0.01em",
              }}
            >
              {PE_TAGLINE}
            </p>
            <span
              className="pe-gradient-rule"
              style={{ display: "block", width: 132, margin: "16px 0 0" }}
            />

            {/* The banner's icon row, in the application's own words. */}
            <div className="pe-verbs">
              {PE_VERBS.map((verb, i) => (
                <span className="pe-verb" key={verb}>
                  <PeIconOrb
                    icon={verbIcons[i]}
                    tone={i % 2 === 0 ? "blue" : "teal"}
                    size="md"
                  />
                  <span className="pe-verb__caption">{verb}</span>
                </span>
              ))}
            </div>
          </div>

          <div className="pe-hero__art" aria-hidden="true">
            <PeHeroGeometry size={360} />
          </div>
        </div>
        <span className="pe-hero__curve" aria-hidden="true" />
      </section>

      {/* Main Content */}
      <main className="pe-section" style={{ width: "100%" }}>
        <div style={{ marginBottom: 22 }}>
          <h2
            style={{
              fontSize: 18,
              fontWeight: 700,
              color: "var(--pe-text-strong)",
              letterSpacing: "-0.3px",
              margin: "0 0 4px",
            }}
          >
            Dashboard Suite
          </h2>
          <p style={{ fontSize: 13, color: "var(--pe-text-muted)", margin: 0 }}>
            Select a dashboard to access your O&amp;M management tools
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <PeModuleCard
            identity={MODULE_IDENTITY.governance}
            href="/governance"
            description="Track 4 facilities (AGLIPAY, HTT, EASTBAY, KAYSAKAT) through 9 milestones with S-Curve progress and deliverables."
            badges={["4 Facilities", "9 Milestones", "14 TOC Items"]}
            cta="Open Dashboard"
          />
          <PeModuleCard
            identity={MODULE_IDENTITY.scorecard}
            to="/scorecard-kpi"
            description="Track 8 KPIs across 5 business units with color-coded performance, Excel import, and budget analytics."
            badges={["5 BUs", "8 KPIs", "Excel Import"]}
            cta="Open Scorecard"
          />
          <PeModuleCard
            identity={MODULE_IDENTITY.odm}
            href="/mw-dashboard"
            description="Corporate analytics, predictive insights, inspector tracking, data quality, and escalation monitoring."
            badges={["Analytics", "Predictive", "Insights"]}
            cta="Open Dashboard"
          />
          <PeModuleCard
            identity={MODULE_IDENTITY.primavera}
            to="/gantt"
            description="ODM Primavera Lite Online — link-based project scheduling. Create WBS, activities, dependencies, and schedules without an account."
            badges={["Gantt", "CRUD", "Excel"]}
            cta="Open Primavera Lite"
          />
          <PeModuleCard
            identity={MODULE_IDENTITY.smp}
            to="/smp-dashboard"
            tagline="Centralized repository for SOPs, SMPs, and preventive maintenance documentation."
            description="Browse maintenance procedure documents organized by equipment type and system. PDF viewer with upload/download support. Searchable and filterable document library."
            badges={["Documents", "PDF", "Upload", "Download"]}
            cta="Open SMP Library"
            newTag
          />
          <PeModuleCard
            identity={MODULE_IDENTITY.omLibrary}
            to="/om-manuals-library"
            tagline="Full O&M Manuals for each facility — search, view, and download."
            description="Browse full Operation and Maintenance Manuals for each facility. Search by plant, equipment type, or system. View and download PDF manuals."
            badges={["Manuals", "PDF", "Search", "Download"]}
            cta="Open O&M Library"
          />
          <PeModuleCard
            identity={MODULE_IDENTITY.projectsWithoutPpp}
            to="/projects-without-ppp"
            tagline="Masterdata submittal monitoring for 50 projects — upload Excel/PDF, track submission status."
            description="Monitoring-first dashboard: submission KPIs, filtering, and per-project masterdata upload for the Projects without PPP population."
            badges={["50 Projects", "Submitted", "Upload"]}
            cta="Open Monitoring"
            newTag
          />
          <PeModuleCard
            identity={MODULE_IDENTITY.presentationCenter}
            to="/presentation-center"
            tagline="Create, manage, and generate PowerPoint presentations from dashboard data."
            description="Upload PowerPoint decks, maintain a presentation library, generate Monthly KPI Scorecard decks, and prepare for future AI-assisted deck generation."
            badges={["PPTX", "Generate", "Library"]}
            cta="Open Presentation Center"
          />
        </div>
      </main>

      {/* Footer */}
      <footer
        style={{
          borderTop: "1px solid var(--pe-border)",
          background: "var(--pe-surface)",
          padding: "14px 20px",
          marginTop: "auto",
        }}
      >
        <div
          style={{
            maxWidth: 1440,
            margin: "0 auto",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <span
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontSize: 11.5,
              color: "var(--pe-text-muted)",
            }}
          >
            <span className="pe-gradient-rule" style={{ display: "inline-block", width: 26 }} />
            Programs Engineering · {PE_TAGLINE}
          </span>
          <span style={{ fontSize: 12, color: "var(--pe-text-muted)" }}>
            Program Oversight Center &copy; 2026
          </span>
        </div>
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
        quickQuestions={["What can this dashboard do?", "Which module should I open?"]}
      />
    </div>
  );
}
