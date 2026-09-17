/**
 * PeWordmark — the Programs Engineering identity lockup.
 *
 * The banner sets PROGRAMS in engineering blue stacked over ENGINEERING in
 * teal, with the tagline in dark charcoal beneath. This component is the single
 * implementation of that lockup so the suite never re-invents it.
 */
export const PE_TAGLINE = "Engineering Solutions. Powering Progress.";

interface Props {
  size?: "sm" | "md" | "lg";
  /** Show "Engineering Solutions. Powering Progress." under the wordmark. */
  tagline?: boolean;
  /** Dark surfaces (the banner's photographic panel) need light type. */
  onDark?: boolean;
  className?: string;
}

const LINE_SIZE: Record<NonNullable<Props["size"]>, { line: number; tag: number }> = {
  sm: { line: 11, tag: 9 },
  md: { line: 15, tag: 10.5 },
  lg: { line: 34, tag: 13 },
};

export default function PeWordmark({
  size = "md",
  tagline = true,
  onDark = false,
  className = "",
}: Props) {
  const { line, tag } = LINE_SIZE[size];

  return (
    <span className={`pe-wordmark ${className}`.trim()} style={{ gap: size === "lg" ? 4 : 1 }}>
      <span
        className="pe-wordmark__line1"
        style={{ fontSize: line, letterSpacing: "0.14em" }}
      >
        Programs
      </span>
      <span
        className="pe-wordmark__line2"
        style={{ fontSize: line, letterSpacing: "0.14em" }}
      >
        Engineering
      </span>
      {tagline && (
        <span
          style={{
            marginTop: size === "lg" ? 10 : 3,
            fontSize: tag,
            fontWeight: 400,
            textTransform: "none",
            letterSpacing: "0.01em",
            color: onDark ? "rgba(255,255,255,0.82)" : "var(--pe-text-muted)",
          }}
        >
          {PE_TAGLINE}
        </span>
      )}
    </span>
  );
}
