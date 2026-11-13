interface RingProps {
  size: number;
  stroke: number;
  /** 0–1 */
  value: number;
  color?: string;
  track?: string;
  label?: string;
}

/** Progress ring starting at 12 o'clock. Decorative unless `label` is set. */
export function Ring({
  size,
  stroke,
  value,
  color = "var(--ol-text)",
  track = "var(--ol-track)",
  label,
}: RingProps) {
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const clamped = Math.min(Math.max(value, 0), 1);
  const a11y = label ? { role: "img", "aria-label": label } : { "aria-hidden": true };
  return (
    <svg
      {...a11y}
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      style={{ transform: "rotate(-90deg)", flexShrink: 0 }}
    >
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={stroke} />
      {clamped > 0 && (
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - clamped)}
          style={{ transition: "stroke-dashoffset 400ms ease" }}
        />
      )}
    </svg>
  );
}

/** Indeterminate busy arc (spins via CSS class from the caller). */
export function BusyArc({ size, stroke, className }: { size: number; stroke: number; className?: string }) {
  const r = (size - stroke) / 2;
  const c = size / 2;
  return (
    <svg aria-hidden="true" className={className} width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={c} cy={c} r={r} fill="none" stroke="var(--ol-track)" strokeWidth={stroke} />
      <path
        d={`M${c} ${c - r} A${r} ${r} 0 0 1 ${c + r} ${c}`}
        fill="none"
        stroke="var(--ol-text)"
        strokeWidth={stroke}
        strokeLinecap="round"
      />
    </svg>
  );
}
