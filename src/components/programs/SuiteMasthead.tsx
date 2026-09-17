/**
 * SuiteMasthead — the compact Programs Engineering identity bar.
 *
 * The suite identity sits ABOVE the individual modules:
 *
 *     PROGRAMS ENGINEERING
 *             ↓
 *     ODM Dashboard Suite
 *             ↓
 *     Individual Modules
 *
 * Internal modules must not spend vertical workspace on a hero banner, so this
 * stays shallow (a single identity row plus the blue → teal accent rule) and
 * leaves the operational area intact. The expressive treatment is reserved for
 * the Home landing page.
 */
import type { ReactNode } from "react";
import { Link } from "react-router";
import ProgramsEngineeringLogo from "@/components/ProgramsEngineeringLogo";
import PeWordmark from "./PeWordmark";

interface Props {
  /** Right-hand slot: help link, account menu, module actions. */
  actions?: ReactNode;
  /** Optional link target for the identity lockup (defaults to the suite home). */
  to?: string;
  onClick?: (event: React.MouseEvent<HTMLAnchorElement>) => void;
  /** Suite-level context shown beside the wordmark, e.g. "ODM Dashboard Suite". */
  suiteLabel?: string;
  /**
   * Suite display name rendered inside the identity link. Kept as a prop so the
   * link's accessible name stays stable (Home's hidden OWNER gesture targets it).
   */
  suiteTitle?: string;
  /**
   * Accessible name / tooltip for the identity link. Several modules already
   * expose this link as "Dashboard Home"; pass it through so the contract holds.
   */
  linkAriaLabel?: string;
  linkTitle?: string;
}

export default function SuiteMasthead({
  actions,
  to = "/",
  onClick,
  suiteLabel,
  suiteTitle,
  linkAriaLabel,
  linkTitle,
}: Props) {
  const displayName = suiteTitle ?? suiteLabel ?? "ODM Dashboard Suite";

  return (
    /*
     * z-index 45 is deliberate. The shared Radix overlays (dialog, sheet,
     * drawer, alert-dialog, dropdown, context menu) all sit at z-50 and up, and
     * several modules use z-50 / z-60 / z-70 / z-110 for their own modals. The
     * module headers this masthead replaced used z-100, which painted the sticky
     * bar ON TOP of those modals and made them partly unusable. 45 keeps the
     * masthead above page chrome (page content tops out around z-40) while every
     * overlay correctly covers it.
     */
    <header className="pe-masthead" style={{ position: "sticky", top: 0, zIndex: 45 }}>
      <div className="pe-masthead__inner">
        <Link
          to={to}
          onClick={onClick}
          aria-label={linkAriaLabel}
          title={linkTitle}
          className="pe-focusable"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            minWidth: 0,
            textDecoration: "none",
            color: "inherit",
            borderRadius: 8,
          }}
        >
          <ProgramsEngineeringLogo size={40} borderRadius={8} />
          <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
            <PeWordmark size="sm" tagline={false} />
            {displayName && (
              <span
                style={{
                  fontSize: 10.5,
                  color: "var(--pe-text-faint)",
                  marginTop: 2,
                  whiteSpace: "nowrap",
                }}
              >
                {displayName}
              </span>
            )}
          </span>
        </Link>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginLeft: "auto",
            flexShrink: 0,
          }}
        >
          {actions}
        </div>
      </div>

      {/* The banner's blue → teal sweep, reduced to a hairline. */}
      <hr className="pe-gradient-rule pe-gradient-rule--thin" />
    </header>
  );
}
