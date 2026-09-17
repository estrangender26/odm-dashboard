/**
 * PeHeroGeometry — the Programs Engineering hero composition.
 *
 * A CSS/SVG translation of the reference banner's engineering panel. The OWNER
 * rejected the first version as a generic SaaS/radar illustration, so this is a
 * deliberate ENGINEERING composition rather than a decorative dial of rings:
 *
 *   - a large gear silhouette with a real tooth profile (parametric, so the
 *     proportions stay honest at any size);
 *   - a smaller meshing gear on the same pitch line;
 *   - a pump/impeller motif in the gear hub (curved vanes in a volute casing);
 *   - an electrical transmission pylon with sagging conductors;
 *   - engineering-drawing furniture: a fine construction grid, centre-lines and
 *     a dimensioned span with arrowheads;
 *   - the banner's layered blue / teal sweeps with a white separation between.
 *
 * No stock photography is introduced — the mission forbids inventing industrial
 * imagery, so the banner's *geometry* carries the identity instead.
 *
 * Decorative only: hidden from assistive tech and free of motion.
 */
interface Props {
  className?: string;
}

/** Builds a gear outline as a single path: trapezoidal teeth on a root circle. */
function gearPath(cx: number, cy: number, rootR: number, tipR: number, teeth: number) {
  const step = 360 / teeth;
  const pt = (angleDeg: number, r: number) => {
    const a = ((angleDeg - 90) * Math.PI) / 180;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)] as const;
  };
  let d = "";
  for (let i = 0; i < teeth; i += 1) {
    const a0 = i * step;
    const [x0, y0] = pt(a0, rootR);
    const [x1, y1] = pt(a0 + step * 0.1, rootR);
    const [x2, y2] = pt(a0 + step * 0.17, tipR);
    const [x3, y3] = pt(a0 + step * 0.4, tipR);
    const [x4, y4] = pt(a0 + step * 0.47, rootR);
    const [x5, y5] = pt(a0 + step, rootR);
    if (i === 0) d += `M ${x0.toFixed(2)} ${y0.toFixed(2)} `;
    d +=
      `L ${x1.toFixed(2)} ${y1.toFixed(2)} L ${x2.toFixed(2)} ${y2.toFixed(2)} ` +
      `L ${x3.toFixed(2)} ${y3.toFixed(2)} L ${x4.toFixed(2)} ${y4.toFixed(2)} ` +
      `L ${x5.toFixed(2)} ${y5.toFixed(2)} `;
  }
  return d + "Z";
}

/** Pump impeller: curved vanes swept outward from a hub inside a volute casing. */
function impellerVanes(cx: number, cy: number, hubR: number, outR: number, count: number, sweep: number) {
  const paths: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const a = (i * 360) / count;
    const rad = (a * Math.PI) / 180;
    const sx = cx + hubR * Math.cos(rad);
    const sy = cy + hubR * Math.sin(rad);
    const endA = ((a + sweep) * Math.PI) / 180;
    const ex = cx + outR * Math.cos(endA);
    const ey = cy + outR * Math.sin(endA);
    // Control point pushed tangentially, which is what gives a vane its curl.
    const ctrlA = ((a + sweep * 0.35) * Math.PI) / 180;
    const ctrlR = (hubR + outR) * 0.62;
    const cxp = cx + ctrlR * Math.cos(ctrlA) - 14 * Math.sin(ctrlA);
    const cyp = cy + ctrlR * Math.sin(ctrlA) + 14 * Math.cos(ctrlA);
    paths.push(
      `M ${sx.toFixed(1)} ${sy.toFixed(1)} Q ${cxp.toFixed(1)} ${cyp.toFixed(1)} ${ex.toFixed(1)} ${ey.toFixed(1)}`
    );
  }
  return paths;
}

export default function PeHeroGeometry({ className = "" }: Props) {
  const BIG = { cx: 396, cy: 214, root: 108, tip: 126, teeth: 26 };
  const SMALL = { cx: 234, cy: 116, root: 46, tip: 58, teeth: 15 };

  const bigGear = gearPath(BIG.cx, BIG.cy, BIG.root, BIG.tip, BIG.teeth);
  const smallGear = gearPath(SMALL.cx, SMALL.cy, SMALL.root, SMALL.tip, SMALL.teeth);
  const vanes = impellerVanes(BIG.cx, BIG.cy, 18, 52, 7, 52);

  return (
    <svg
      className={className}
      viewBox="0 0 600 420"
      preserveAspectRatio="xMidYMid meet"
      role="presentation"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id="peArcBlue" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0%" stopColor="#258ac1" />
          <stop offset="100%" stopColor="#4aa2d3" />
        </linearGradient>
        <linearGradient id="peArcTeal" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0%" stopColor="#209c8c" />
          <stop offset="100%" stopColor="#55c0ae" />
        </linearGradient>
        <linearGradient id="peGearFace" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="100%" stopColor="#f2f8fb" />
        </linearGradient>
        {/* Engineering-drawing construction grid. */}
        <pattern id="peGrid" width="24" height="24" patternUnits="userSpaceOnUse">
          <path d="M 24 0 L 0 0 0 24" fill="none" stroke="var(--pe-border)" strokeWidth="0.8" />
        </pattern>
        <pattern id="peGridMajor" width="120" height="120" patternUnits="userSpaceOnUse">
          <path d="M 120 0 L 0 0 0 120" fill="none" stroke="var(--pe-border-strong)" strokeWidth="1.1" />
        </pattern>
        <radialGradient id="peGridFade" cx="0.62" cy="0.5" r="0.62">
          <stop offset="0%" stopColor="#fff" stopOpacity="0.95" />
          <stop offset="100%" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
        <mask id="peGridMask">
          <rect x="0" y="0" width="600" height="420" fill="url(#peGridFade)" />
        </mask>
      </defs>

      {/* ── Engineering drawing grid ─────────────────────────────────────── */}
      <g mask="url(#peGridMask)">
        <rect x="0" y="0" width="600" height="420" fill="url(#peGrid)" />
        <rect x="0" y="0" width="600" height="420" fill="url(#peGridMajor)" />
      </g>

      {/* ── The banner's layered sweeps: blue sweep → white gap → teal sweep ── */}
      <g fill="none" strokeLinecap="round">
        <path d="M -30 372 Q 250 286 630 40" stroke="url(#peArcBlue)" strokeWidth="13" opacity="0.55" />
        <path d="M -30 406 Q 262 314 630 70" stroke="url(#peArcTeal)" strokeWidth="9" opacity="0.5" />
      </g>

      {/* ── Electrical transmission pylon + conductors ───────────────────── */}
      <g stroke="var(--pe-blue-light)" strokeWidth="2.2" fill="none" opacity="0.95">
        {/* legs */}
        <path d="M 62 392 L 92 236 M 128 392 L 98 236" />
        {/* cross braces */}
        <path d="M 70 358 L 120 358 M 76 322 L 114 322 M 82 288 L 108 288 M 87 258 L 103 258" strokeWidth="1.7" />
        {/* X bracing */}
        <path d="M 70 358 L 114 322 M 120 358 L 76 322 M 76 322 L 108 288 M 114 322 L 82 288 M 82 288 L 103 258 M 108 288 L 87 258" strokeWidth="1.2" opacity="0.75" />
        {/* crossarm */}
        <path d="M 48 236 L 142 236 M 40 246 L 150 246" strokeWidth="2.4" />
        {/* insulator strings */}
        <path d="M 56 246 L 56 262 M 88 246 L 88 262 M 102 246 L 102 262 M 134 246 L 134 262" strokeWidth="1.6" />
        {/* base plinth */}
        <path d="M 54 392 L 136 392" strokeWidth="3" />
      </g>
      {/* sagging conductors */}
      <g fill="none" stroke="var(--pe-blue)" strokeWidth="1.6" opacity="0.6">
        <path d="M 56 262 Q 150 300 250 262" />
        <path d="M 134 262 Q 230 302 330 268" />
      </g>

      {/* ── Large gear ───────────────────────────────────────────────────── */}
      <g>
        <path
          d={bigGear}
          fill="url(#peGearFace)"
          stroke="var(--pe-blue)"
          strokeWidth="2.4"
          strokeLinejoin="round"
        />
        <circle cx={BIG.cx} cy={BIG.cy} r={BIG.root - 6} fill="none" stroke="var(--pe-teal)" strokeWidth="3" />
        <circle cx={BIG.cx} cy={BIG.cy} r={BIG.root - 30} fill="var(--pe-white)" stroke="var(--pe-border-strong)" strokeWidth="1.6" />
        {/* lightening holes, as on a real casting */}
        {Array.from({ length: 6 }, (_, i) => {
          const a = ((i * 360) / 6 + 30) * (Math.PI / 180);
          const r = BIG.root - 18;
          return (
            <circle
              key={i}
              cx={BIG.cx + r * Math.cos(a)}
              cy={BIG.cy + r * Math.sin(a)}
              r="7.5"
              fill="var(--pe-surface-sunk)"
              stroke="var(--pe-border-strong)"
              strokeWidth="1.2"
            />
          );
        })}
        {/* centre-lines (dash-dot), the engineering-drawing signature */}
        <g stroke="var(--pe-blue-light)" strokeWidth="1" strokeDasharray="14 4 2 4" opacity="0.9">
          <path d={`M ${BIG.cx - BIG.tip - 26} ${BIG.cy} L ${BIG.cx + BIG.tip + 26} ${BIG.cy}`} />
          <path d={`M ${BIG.cx} ${BIG.cy - BIG.tip - 26} L ${BIG.cx} ${BIG.cy + BIG.tip + 26}`} />
        </g>
      </g>

      {/* ── Pump / impeller in the gear hub ──────────────────────────────── */}
      <g>
        <circle cx={BIG.cx} cy={BIG.cy} r="56" fill="var(--pe-white)" stroke="var(--pe-teal)" strokeWidth="2.4" />
        <circle cx={BIG.cx} cy={BIG.cy} r="50" fill="none" stroke="var(--pe-teal-border)" strokeWidth="1.4" />
        <g fill="none" stroke="var(--pe-teal)" strokeWidth="2.6" strokeLinecap="round" opacity="0.95">
          {vanes.map((d, i) => (
            <path key={i} d={d} />
          ))}
        </g>
        <circle cx={BIG.cx} cy={BIG.cy} r="15" fill="var(--pe-teal-soft)" stroke="var(--pe-teal-deep)" strokeWidth="2.4" />
        <circle cx={BIG.cx} cy={BIG.cy} r="5" fill="var(--pe-teal-deep)" />
        {/* volute outlet */}
        <path
          d={`M ${BIG.cx + 52} ${BIG.cy - 18} L ${BIG.cx + 74} ${BIG.cy - 30}`}
          stroke="var(--pe-teal-deep)"
          strokeWidth="7"
          strokeLinecap="round"
          fill="none"
        />
      </g>

      {/* ── Smaller meshing gear ─────────────────────────────────────────── */}
      <g>
        <path
          d={smallGear}
          fill="url(#peGearFace)"
          stroke="var(--pe-teal-deep)"
          strokeWidth="2.2"
          strokeLinejoin="round"
        />
        <circle cx={SMALL.cx} cy={SMALL.cy} r={SMALL.root - 8} fill="none" stroke="var(--pe-blue-light)" strokeWidth="2.4" />
        <circle cx={SMALL.cx} cy={SMALL.cy} r="12" fill="var(--pe-white)" stroke="var(--pe-blue)" strokeWidth="2.4" />
        <circle cx={SMALL.cx} cy={SMALL.cy} r="4" fill="var(--pe-blue)" />
      </g>

      {/* ── Dimensioned span with arrowheads ─────────────────────────────── */}
      <g stroke="var(--pe-blue-ink)" strokeWidth="1.3" opacity="0.85">
        <path d="M 174 168 L 174 178 M 294 168 L 294 178" />
        <path d="M 174 173 L 294 173" />
        <path d="M 174 173 L 184 169 L 184 177 Z" fill="var(--pe-blue-ink)" stroke="none" />
        <path d="M 294 173 L 284 169 L 284 177 Z" fill="var(--pe-blue-ink)" stroke="none" />
      </g>
      {/* radius callout on the large gear */}
      <g stroke="var(--pe-blue-ink)" strokeWidth="1.2" opacity="0.8" fill="none">
        <path d={`M ${BIG.cx} ${BIG.cy} L ${BIG.cx - 74} ${BIG.cy - 74}`} strokeDasharray="6 4" />
        <circle cx={BIG.cx - 74} cy={BIG.cy - 74} r="3" fill="var(--pe-blue-ink)" stroke="none" />
      </g>
    </svg>
  );
}
