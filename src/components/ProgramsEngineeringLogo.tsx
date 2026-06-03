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
}

const ProgramsEngineeringLogo: React.FC<Props> = ({
  size = 72,
  borderRadius = 8,
  className = "",
  style,
  alt = "Programs",
}) => (
  <span
    className={`pe-liquid-logo ${className}`.trim()}
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
