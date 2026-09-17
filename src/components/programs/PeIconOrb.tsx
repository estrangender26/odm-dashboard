/**
 * PeIconOrb — the Programs Engineering icon container.
 *
 * Derived from the reference banner's INNOVATE / ENGINEER / DELIVER / EMPOWER
 * treatment: a filled circular disc carrying a simple white line icon. The
 * banner alternates blue and teal discs, so `tone` exposes exactly those two
 * brand voices rather than a per-module rainbow.
 *
 * Modules differentiate through icon + title, not through colour.
 */
import type { LucideIcon } from "lucide-react";

export type PeOrbTone = "blue" | "teal";
export type PeOrbSize = "sm" | "md" | "lg";

interface Props {
  icon: LucideIcon;
  tone?: PeOrbTone;
  size?: PeOrbSize;
  /** Soft variant: pale tinted disc with a coloured icon, for dense toolbars. */
  soft?: boolean;
  /** Alternate by module index — the banner's blue / teal / blue / teal rhythm. */
  className?: string;
  "aria-hidden"?: boolean;
}

const DIMENSIONS: Record<PeOrbSize, { box: number; icon: number }> = {
  sm: { box: 28, icon: 15 },
  md: { box: 40, icon: 20 },
  lg: { box: 52, icon: 26 },
};

/**
 * Written as literal strings on purpose.
 *
 * These variants live in `@layer components`, and Tailwind only emits layered
 * rules whose class name appears literally in scanned source. Composing the
 * name (`pe-orb--${tone}`) silently dropped every teal variant, so the whole
 * icon row rendered blue. Keep these literal; the Tailwind `safelist` is the
 * second line of defence.
 */
const SOLID_CLASS: Record<PeOrbTone, string> = {
  blue: "pe-orb--blue",
  teal: "pe-orb--teal",
};

const SOFT_CLASS: Record<PeOrbTone, string> = {
  blue: "pe-orb--soft-blue",
  teal: "pe-orb--soft-teal",
};

export default function PeIconOrb({
  icon: Icon,
  tone = "blue",
  size = "md",
  soft = false,
  className = "",
  ...rest
}: Props) {
  const { box, icon } = DIMENSIONS[size];
  const variant = soft ? SOFT_CLASS[tone] : SOLID_CLASS[tone];

  return (
    <span
      className={`pe-orb ${variant} ${className}`.trim()}
      style={{ width: box, height: box }}
      aria-hidden={rest["aria-hidden"] ?? true}
    >
      <Icon size={icon} strokeWidth={2} aria-hidden="true" />
    </span>
  );
}
