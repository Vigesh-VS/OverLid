import type { MouseEvent } from "react";

import { commands, run, type AgentSession } from "../../lib/ipc";
import styles from "./PillIndicators.module.css";

/**
 * "Claude needs you": a ringing bell with an amber glow that stays until the
 * session moves on or you click it. Clicking opens the session's folder.
 */
export function AttentionBell({ session, onPress }: { session: AgentSession; onPress: (e: MouseEvent) => void }) {
  const open = (e: MouseEvent) => {
    onPress(e);
    run(commands.codeOpenFolder(session.id), "code_open_folder");
    run(commands.codeDismiss(session.id), "code_dismiss");
  };
  const label = `${session.label} needs you: ${session.message ?? "waiting for input"}. Click to open its folder.`;
  return (
    <button type="button" className={styles.bell} data-indicator aria-label={label} title={label} onClick={open}>
      <svg
        aria-hidden="true"
        width={15}
        height={15}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15Z" />
        <path d="M10 21a2 2 0 0 0 4 0" />
      </svg>
    </button>
  );
}
