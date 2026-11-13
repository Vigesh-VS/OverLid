// Simple, recognisable marks for each AI tool. Drawn as neutral glyphs in
// each tool's colour rather than copies of their logos.

import type { ProviderId } from "../lib/ipc";

const COLORS: Record<ProviderId, string> = {
  claude: "#D97757",
  codex: "#E8E8EA",
  copilot: "#B88CFF",
  gemini: "#6FA8FF",
};

function Glyph({ id }: { id: ProviderId }) {
  switch (id) {
    case "claude":
      // A radiating burst.
      return (
        <g stroke="currentColor" strokeWidth={2.4} strokeLinecap="round">
          {[0, 30, 60, 90, 120, 150].map((a) => (
            <line key={a} x1="12" y1="5" x2="12" y2="19" transform={`rotate(${a} 12 12)`} />
          ))}
        </g>
      );
    case "codex":
      // A terminal prompt.
      return (
        <g fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
          <path d="m6 8 4 4-4 4" />
          <path d="M13 17h5" />
        </g>
      );
    case "copilot":
      // Goggles.
      return (
        <g fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinejoin="round">
          <rect x="3.5" y="8" width="7.5" height="7" rx="3" />
          <rect x="13" y="8" width="7.5" height="7" rx="3" />
          <path d="M11 11.5h2" />
        </g>
      );
    case "gemini":
      // A four-point spark.
      return <path d="M12 3c.6 4.8 4.2 8.4 9 9-4.8.6-8.4 4.2-9 9-.6-4.8-4.2-8.4-9-9 4.8-.6 8.4-4.2 9-9Z" fill="currentColor" />;
  }
}

export function ProviderIcon({ id, size = 20, muted = false }: { id: ProviderId; size?: number; muted?: boolean }) {
  return (
    <span
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.3,
        background: "var(--ol-surface-raised)",
        color: muted ? "var(--ol-text-3)" : COLORS[id],
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
      }}
    >
      <svg width={size * 0.66} height={size * 0.66} viewBox="0 0 24 24">
        <Glyph id={id} />
      </svg>
    </span>
  );
}
