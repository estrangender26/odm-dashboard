/**
 * PeModuleCard — the Programs Engineering module navigation card.
 *
 * Shared by the suite landing page so every module reads as one product family:
 * consistent icon treatment (a circular blue/teal orb), typography, spacing,
 * border language, hover/focus behaviour and accent system.
 *
 * Modules are recognisable through icon + title + subtitle. There is no
 * per-module colour scheme — only the banner's alternating blue / teal voice.
 */
import type { ReactNode } from "react";
import { Link } from "react-router";
import { ArrowRight } from "lucide-react";
import PeIconOrb from "./PeIconOrb";
import type { ModuleIdentity } from "./moduleIdentity";

interface Props {
  identity: ModuleIdentity;
  description: string;
  /** Optional short line under the title, used by cards carrying a "New" tag. */
  tagline?: string;
  badges?: string[];
  /** CTA label, e.g. "Open Monitoring". */
  cta: string;
  /** Internal route (React Router). Use `href` instead for full-page loads. */
  to?: string;
  /** Full-page link target, used for the static governance surface. */
  href?: string;
  newTag?: boolean;
}

const cardStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  padding: 16,
  borderRadius: "var(--pe-radius-lg)",
  border: "1px solid var(--pe-border)",
  background: "var(--pe-surface)",
  color: "inherit",
  textDecoration: "none",
  height: "100%",
  transition: "border-color var(--pe-transition), box-shadow var(--pe-transition)",
};

/**
 * Literal class names on purpose — see the note in PeIconOrb. A composed
 * `pe-badge--${tone}` is invisible to Tailwind's layered-rule tree-shaking.
 */
const BADGE_CLASS: Record<ModuleIdentity["tone"], string> = {
  blue: "pe-badge--blue",
  teal: "pe-badge--teal",
};

const CTA_COLOR: Record<ModuleIdentity["tone"], string> = {
  blue: "var(--pe-blue-ink)",
  teal: "var(--pe-teal-ink)",
};

export default function PeModuleCard({
  identity,
  description,
  tagline,
  badges = [],
  cta,
  to,
  href,
  newTag = false,
}: Props) {
  const body: ReactNode = (
    <>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 12 }}>
        <PeIconOrb icon={identity.icon} tone={identity.tone} size="md" />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <h3
              style={{
                margin: 0,
                fontSize: 15,
                fontWeight: 700,
                letterSpacing: "-0.2px",
                lineHeight: 1.3,
                color: "var(--pe-text-strong)",
              }}
            >
              {identity.title}
            </h3>
            {newTag && (
              <span
                className={`pe-badge ${BADGE_CLASS[identity.tone]}`}
                style={{ fontSize: 9, textTransform: "uppercase", letterSpacing: ".06em" }}
              >
                New
              </span>
            )}
          </div>
          {tagline && (
            <p style={{ margin: "3px 0 0", fontSize: 12, color: "var(--pe-text-faint)" }}>
              {tagline}
            </p>
          )}
        </div>
      </div>

      <p
        style={{
          margin: "0 0 12px",
          fontSize: 13,
          lineHeight: 1.55,
          color: "var(--pe-text-muted)",
        }}
      >
        {description}
      </p>

      {badges.length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
          {badges.map((b) => (
            <span key={b} className="pe-badge">
              {b}
            </span>
          ))}
        </div>
      )}

      <span
        style={{
          marginTop: "auto",
          fontSize: 12.5,
          fontWeight: 600,
          display: "flex",
          alignItems: "center",
          gap: 4,
          color: CTA_COLOR[identity.tone],
        }}
      >
        {cta} <ArrowRight size={14} aria-hidden="true" />
      </span>
    </>
  );

  const className = "pe-card pe-card--interactive pe-focusable";

  if (href) {
    return (
      <a href={href} className={className} style={cardStyle}>
        {body}
      </a>
    );
  }

  return (
    <Link to={to ?? "/"} className={className} style={cardStyle}>
      {body}
    </Link>
  );
}
