// Monochrome marks for each AI tool, from Simple Icons (CC0). Codex uses the
// OpenAI mark. Trademark notes are in THIRD_PARTY_NOTICES.md.

import type { ProviderId } from "../lib/ipc";
import { SIMPLE_ICON_PATHS } from "./simpleIcons";

export function ProviderMark({ id, size = 14, color = "currentColor" }: { id: ProviderId; size?: number; color?: string }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill={color}>
      <path d={SIMPLE_ICON_PATHS[id]} />
    </svg>
  );
}

/** The mark on a small rounded tile, for lists and pickers. */
export function ProviderIcon({ id, size = 20, muted = false }: { id: ProviderId; size?: number; muted?: boolean }) {
  return (
    <span
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.3,
        background: "var(--ol-surface-raised)",
        color: muted ? "var(--ol-text-3)" : "var(--ol-text)",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
      }}
    >
      <ProviderMark id={id} size={size * 0.62} />
    </span>
  );
}
