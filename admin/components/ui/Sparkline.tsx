// Sparkline — tiny inline SVG line chart, hand-rolled in pure SVG so
// the admin bundle has zero chart-library weight. Renders a moss line
// over a soft area fill. Intended for MetricCard trend hints; pass 3-7
// numbers for best visual density.

export interface SparklineProps {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
  strokeWidth?: number;
  ariaLabel?: string;
}

export default function Sparkline({
  data,
  width = 60,
  height = 20,
  color = "var(--accent)",
  strokeWidth = 1.5,
  ariaLabel,
}: SparklineProps) {
  if (!data || data.length === 0) {
    return (
      <svg width={width} height={height} role="img" aria-label={ariaLabel ?? "no trend data"} />
    );
  }
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const stepX = data.length > 1 ? width / (data.length - 1) : 0;
  const pad = strokeWidth;
  const innerH = height - pad * 2;
  const points = data.map((v, i) => {
    const x = i * stepX;
    const y = pad + innerH - ((v - min) / range) * innerH;
    return [x, y] as const;
  });
  const path = points
    .map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`)
    .join(" ");
  const areaPath = `${path} L${(points[points.length - 1]?.[0] ?? 0).toFixed(2)} ${height} L0 ${height} Z`;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={ariaLabel ?? "trend"}
    >
      <path d={areaPath} fill={color} fillOpacity="0.12" />
      <path d={path} fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
    </svg>
  );
}
