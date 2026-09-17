/**
 * ModuleMasthead — per-module identity under the suite identity.
 *
 * Spec shape:
 *
 *     ┌──────────────────────────────────────────────────────────┐
 *     │ PROGRAMS ENGINEERING                 [blue → teal accent] │
 *     │ Engineering Solutions. Powering Progress.                │
 *     ├──────────────────────────────────────────────────────────┤
 *     │ (○)  MODULE TITLE                                        │
 *     │      module subtitle / context                           │
 *     └──────────────────────────────────────────────────────────┘
 *
 * Deliberately shallow: identity without materially reducing usable vertical
 * workspace for engineering tables, plans, KPIs, schedules and forms.
 *
 * Modules differentiate through icon, title and subtitle — never by swapping in
 * a new colour theme. `tone` only alternates the two brand voices.
 */
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import PeIconOrb, { type PeOrbTone } from "./PeIconOrb";
import { PE_TAGLINE } from "./PeWordmark";

interface Props {
  icon: LucideIcon;
  title: string;
  subtitle?: string;
  tone?: PeOrbTone;
  /** Right-hand slot: module-level controls, badges, primary action. */
  actions?: ReactNode;
  /** Optional breadcrumb row rendered above the module title. */
  breadcrumb?: ReactNode;
  /** Hide the suite identity row when the page already renders SuiteMasthead. */
  showIdentityRow?: boolean;
}

export default function ModuleMasthead({
  icon,
  title,
  subtitle,
  tone = "blue",
  actions,
  breadcrumb,
  showIdentityRow = true,
}: Props) {
  return (
    <section
      style={{
        background: "var(--pe-white)",
        borderBottom: "1px solid var(--pe-border)",
      }}
    >
      {showIdentityRow && (
        <>
          <div
            style={{
              maxWidth: 1440,
              margin: "0 auto",
              padding: "7px 20px 6px",
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
                flexDirection: "column",
                lineHeight: 1,
              }}
            >
              <span
                className="pe-wordmark__line1"
                style={{ fontSize: 11, letterSpacing: "0.14em" }}
              >
                Programs
              </span>
              <span
                className="pe-wordmark__line2"
                style={{ fontSize: 11, letterSpacing: "0.14em", marginTop: 1 }}
              >
                Engineering
              </span>
            </span>
            <span
              style={{
                fontSize: 10,
                color: "var(--pe-text-muted)",
                letterSpacing: "0.04em",
              }}
            >
              {PE_TAGLINE}
            </span>
          </div>
          <hr className="pe-gradient-rule pe-gradient-rule--thin" style={{ margin: 0 }} />
        </>
      )}

      <div
        style={{
          maxWidth: 1440,
          margin: "0 auto",
          padding: "10px 20px",
          display: "flex",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <PeIconOrb icon={icon} tone={tone} size="md" />

        <div style={{ minWidth: 0, flex: "1 1 auto" }}>
          {breadcrumb && (
            <div style={{ fontSize: 11.5, color: "var(--pe-text-faint)", marginBottom: 2 }}>
              {breadcrumb}
            </div>
          )}
          <h1
            style={{
              margin: 0,
              fontSize: 20,
              fontWeight: 750,
              letterSpacing: "-0.3px",
              lineHeight: 1.2,
              color: "var(--pe-text-strong)",
            }}
          >
            {title}
          </h1>
          {subtitle && (
            <p
              style={{
                margin: "3px 0 0",
                fontSize: 12.5,
                color: "var(--pe-text-muted)",
                lineHeight: 1.4,
              }}
            >
              {subtitle}
            </p>
          )}
        </div>

        {actions && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              flexWrap: "wrap",
              marginLeft: "auto",
            }}
          >
            {actions}
          </div>
        )}
      </div>
    </section>
  );
}
