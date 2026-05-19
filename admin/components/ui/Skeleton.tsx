import type { CSSProperties } from "react";

// Skeleton — loading shimmer rectangle. Honors `prefers-reduced-motion`:
// users with reduce-motion get a static low-contrast block instead of
// the pulsing gradient. Sizing controlled by inline width/height props
// so the shimmer doesn't reflow content when real data lands.

export interface SkeletonProps {
  width?: number | string;
  height?: number | string;
  radius?: number;
  className?: string;
  style?: CSSProperties;
}

export default function Skeleton({
  width = "100%",
  height = 16,
  radius = 6,
  className,
  style,
}: SkeletonProps) {
  return (
    <span
      aria-hidden="true"
      className={["om-skeleton", className].filter(Boolean).join(" ")}
      style={{ width, height, borderRadius: radius, ...style }}
    />
  );
}
