/**
 * Minimal inline-SVG sparkline. Pure and server-renderable (no interactivity),
 * so it adds no client JS. Renders a trailing-window trend as a single polyline
 * over a faint baseline.
 */
export function Sparkline({
  data,
  width = 84,
  height = 22,
  className = "text-clay",
}: {
  data: number[];
  width?: number;
  height?: number;
  className?: string;
}) {
  if (!data || data.length === 0) {
    return <div style={{ width, height }} aria-hidden />;
  }
  const max = Math.max(1, ...data);
  const span = data.length > 1 ? data.length - 1 : 1;
  const pts = data
    .map((v, i) => {
      const x = (i / span) * width;
      const y = height - (v / max) * (height - 2) - 1;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className={className}
      aria-hidden
    >
      <line
        x1={0}
        y1={height - 1}
        x2={width}
        y2={height - 1}
        stroke="currentColor"
        strokeWidth={0.5}
        opacity={0.18}
      />
      <polyline
        points={pts}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
