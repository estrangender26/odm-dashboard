/**
 * ProgramsEngineeringLogo — SVG flowing water shimmer logo.
 *
 * The logo stays whole and sharp. On hover, a diagonal gradient
 * sweeps across the surface like light catching flowing water.
 *
 * Usage:
 *   <ProgramsEngineeringLogo size={36} borderRadius={8} />
 *   <ProgramsEngineeringLogo size={0} borderRadius={8} className="w-9 h-9" />
 */

import React from "react";

interface Props {
  size?: number;
  borderRadius?: number;
  className?: string;
  style?: React.CSSProperties;
  alt?: string;
  /**
   * Reclaim the asset's internal padding so the mark fills its box.
   *
   * programs_engineering_vertical_logo.svg is a 1024x1024 white square whose
   * artwork occupies only the middle ~45% x ~59%, so at masthead sizes the
   * identity reads as much smaller than its box. `tight` scales and re-centres
   * the artwork in place (see ProgramsEngineeringLogo.css) — more presence at
   * the same box height, no taller masthead.
   */
  tight?: boolean;
}

const ProgramsEngineeringLogo: React.FC<Props> = ({
  size = 72,
  borderRadius = 8,
  className = "",
  style,
  alt = "Programs",
  tight = false,
}) => (
  <span
    className={`pe-liquid-logo ${tight ? "pe-liquid-logo--tight" : ""} ${className}`.trim()}
    title="Return to Program Oversight Center"
    style={{
      width: size || undefined,
      height: size || undefined,
      borderRadius,
      ...style,
    }}
    role="img"
    aria-label={alt}
  >
    <img
      className="pe-liquid-logo__base"
      src="/programs_engineering_vertical_logo.svg"
      alt={alt}
      draggable={false}
    />
  </span>
);

export default ProgramsEngineeringLogo;
