/**
 * PeHeroGeometry — the Programs Engineering hero composition.
 *
 * A CSS/SVG translation of the reference banner's right-hand panel: large
 * circular gear geometry, concentric rings, sweeping blue -> teal arcs and
 * restrained halftone dots, on white with clean curved separators.
 *
 * No stock photography is introduced — the mission forbids inventing industrial
 * imagery — so the banner's *geometry* carries the identity instead.
 *
 * Decorative only: hidden from assistive tech, and static under
 * prefers-reduced-motion.
 */
interface Props {
  /** Rendered size in px (square). */
  size?: number;
  className?: string;
}

export default function PeHeroGeometry({ size = 420, className = "" }: Props) {
  // 24 gear teeth around a hub, generated so the count stays a single constant.
  const teeth = Array.from({ length: 24 }, (_, i) => {
    const angle = (i * 360) / 24;
    return (
      <rect
        key={i}
        x={198}
        y={62}
        width={9}
        height={16}
        rx={2.5}
        fill="var(--pe-blue-light)"
        opacity={0.9}
        transform={`rotate(${angle} 200 200)`}
      />
    );
  });

  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 400 400"
      role="presentation"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id="peArc" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#258ac1" />
          <stop offset="100%" stopColor="#2fb19f" />
        </linearGradient>
        <linearGradient id="peArcSoft" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#4aa2d3" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#55c0ae" stopOpacity="0.35" />
        </linearGradient>
        <pattern id="peDots" width="16" height="16" patternUnits="userSpaceOnUse">
          <circle cx="1.6" cy="1.6" r="1.6" fill="var(--pe-border-strong)" />
        </pattern>
        <mask id="peDotFade">
          <radialGradient id="peDotFadeGrad" cx="0.5" cy="0.5" r="0.5">
            <stop offset="0%" stopColor="#fff" stopOpacity="0.9" />
            <stop offset="100%" stopColor="#fff" stopOpacity="0" />
          </radialGradient>
          <rect x="0" y="0" width="400" height="400" fill="url(#peDotFadeGrad)" />
        </mask>
        <clipPath id="peGearClip">
          <circle cx="200" cy="200" r="138" />
        </clipPath>
      </defs>

      {/* Restrained halftone field, feathered at the edges. */}
      <rect x="0" y="0" width="400" height="400" fill="url(#peDots)" mask="url(#peDotFade)" />

      {/* Sweeping arcs — the banner's blue -> teal curves. */}
      <g fill="none" strokeLinecap="round">
        <path
          d="M 22 268 A 196 196 0 0 1 268 22"
          stroke="url(#peArc)"
          strokeWidth="14"
          opacity="0.9"
        />
        <path
          d="M 52 322 A 210 210 0 0 1 322 52"
          stroke="url(#peArcSoft)"
          strokeWidth="9"
        />
      </g>

      {/* Gear geometry */}
      <g>
        {teeth}
        <circle cx="200" cy="200" r="138" fill="none" stroke="var(--pe-blue)" strokeWidth="10" />
        <circle cx="200" cy="200" r="126" fill="none" stroke="var(--pe-teal)" strokeWidth="3" />
        <circle cx="200" cy="200" r="112" fill="var(--pe-white)" stroke="var(--pe-border)" strokeWidth="2" />
      </g>

      {/* Engineering line motif inside the gear: spokes + hub. */}
      <g stroke="var(--pe-blue-light)" strokeWidth="2" opacity="0.75" clipPath="url(#peGearClip)">
        {Array.from({ length: 8 }, (_, i) => (
          <line
            key={i}
            x1="200"
            y1="200"
            x2="200"
            y2="88"
            transform={`rotate(${(i * 360) / 8} 200 200)`}
          />
        ))}
      </g>
      <circle cx="200" cy="200" r="86" fill="none" stroke="var(--pe-border)" strokeWidth="2" />
      <circle cx="200" cy="200" r="46" fill="var(--pe-teal-soft)" stroke="var(--pe-teal)" strokeWidth="3" />
      <circle cx="200" cy="200" r="20" fill="var(--pe-white)" stroke="var(--pe-blue)" strokeWidth="3" />
    </svg>
  );
}
