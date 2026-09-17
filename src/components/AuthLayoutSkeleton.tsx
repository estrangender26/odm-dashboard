import { Skeleton } from "./ui/skeleton";

/**
 * AuthLayoutSkeleton — bare layout placeholder while auth resolves.
 *
 * Intentionally still a skeleton: no suite masthead, no content, no identity
 * rows. Only the greys are re-voiced to Programs Engineering neutrals so the
 * placeholder sits on the same canvas as the authenticated shell:
 *   canvas    --pe-bg
 *   blocks    --pe-surface-sunk
 *   dividers  --pe-border
 */
const BLOCK = { background: "var(--pe-surface-sunk)" };

export function AuthLayoutSkeleton() {
  return (
    <div className="flex min-h-screen" style={{ background: "var(--pe-bg)" }}>
      {/* Sidebar skeleton */}
      <div
        className="w-70 border-r p-4 space-y-6"
        style={{
          background: "var(--pe-white)",
          borderRight: "1px solid var(--pe-border)",
        }}
      >
        {/* Logo area */}
        <div className="flex items-center gap-3 px-2">
          <Skeleton className="h-8 w-8 rounded-md" style={BLOCK} />
          <Skeleton className="h-4 w-24" style={BLOCK} />
        </div>

        {/* Menu items */}
        <div className="space-y-2 px-2">
          <Skeleton className="h-10 w-full rounded-lg" style={BLOCK} />
          <Skeleton className="h-10 w-full rounded-lg" style={BLOCK} />
          <Skeleton className="h-10 w-full rounded-lg" style={BLOCK} />
        </div>

        {/* User profile area at bottom */}
        <div className="absolute bottom-4 left-4 right-4">
          <div className="flex items-center gap-3 px-1">
            <Skeleton className="h-9 w-9 rounded-full" style={BLOCK} />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3 w-20" style={BLOCK} />
              <Skeleton className="h-2 w-32" style={BLOCK} />
            </div>
          </div>
        </div>
      </div>

      {/* Main content skeleton */}
      <div className="flex-1 p-4 space-y-4">
        {/* Content blocks */}
        <Skeleton className="h-12 w-48 rounded-lg" style={BLOCK} />
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <Skeleton className="h-32 rounded-xl" style={BLOCK} />
          <Skeleton className="h-32 rounded-xl" style={BLOCK} />
          <Skeleton className="h-32 rounded-xl" style={BLOCK} />
        </div>
        <Skeleton className="h-64 rounded-xl" style={BLOCK} />
      </div>
    </div>
  );
}
