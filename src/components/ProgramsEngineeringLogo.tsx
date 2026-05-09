/**
 * ProgramsEngineeringLogo — SVG flowing water logo component.
 *
 * On hover, the logo image is sliced into 7 horizontal bands that each
 * shift left/right at different speeds, creating a gentle water-wave
 * distortion. Two shimmer "current" overlays sweep diagonally for a
 * premium liquid-glass effect.
 *
 * Usage:
 *   <ProgramsEngineeringLogo size={36} borderRadius={8} />
 */

import React from "react";

interface Props {
  /** Width/height in px */
  size?: number;
  /** Border radius in px */
  borderRadius?: number;
  /** Additional CSS classes */
  className?: string;
  /** Additional inline styles (merged with base) */
  style?: React.CSSProperties;
  /** Alt text for accessibility */
  alt?: string;
}

const BANDS = 7;

const ProgramsEngineeringLogo: React.FC<Props> = ({
  size = 36,
  borderRadius = 8,
  className = "",
  style,
  alt = "Programs",
}) => {
  const svgUrl = "/programs_engineering_vertical_logo.svg";

  return (
    <span
      className={`pe-liquid-logo ${className}`.trim()}
      style={{
        ...(size > 0 ? { width: size, height: size } : {}),
        borderRadius,
        ...style,
      }}
      role="img"
      aria-label={alt}
    >
      {/* Base logo — always visible and sharp */}
      <img
        className="pe-liquid-logo__base"
        src={svgUrl}
        alt={alt}
        draggable={false}
      />

      {/* Wave band layer — 7 horizontal slices */}
      <span className="pe-liquid-logo__wave-layer" aria-hidden="true">
        {Array.from({ length: BANDS }, (_, i) => (
          <span
            key={i}
            className={`pe-liquid-logo__band pe-liquid-logo__band--${i + 1}`}
          />
        ))}
      </span>

      {/* Shimmer current overlays */}
      <span className="pe-liquid-logo__current current-a" aria-hidden="true" />
      <span className="pe-liquid-logo__current current-b" aria-hidden="true" />
    </span>
  );
};

export default ProgramsEngineeringLogo;
