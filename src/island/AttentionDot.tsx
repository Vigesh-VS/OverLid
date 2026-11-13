import { useEffect, useState } from "react";

import { commands, on, run, type AgentSession } from "../lib/ipc";

/**
 * Tiny amber dot shown at the top edge while the island is hidden (full
 * screen, game mode, paused) and an agent needs you. Click opens the folder.
 */
export function AttentionDot() {
  const [session, setSession] = useState<AgentSession | null>(null);

  useEffect(() => {
    const pick = (list: AgentSession[]) => setSession(list.find((s) => s.status === "waiting" && !s.acknowledged) ?? null);
    commands.codeSessions().then(pick, () => undefined);
    const off = on("code://session", pick);
    return () => {
      void off.then((f) => f());
    };
  }, []);

  const open = () => {
    if (!session) return;
    run(commands.codeOpenFolder(session.id), "code_open_folder");
    run(commands.codeDismiss(session.id), "code_dismiss");
  };

  return (
    <button
      type="button"
      onClick={open}
      aria-label={session ? `${session.label} needs you. Open its folder.` : "Agent needs you"}
      title={session ? `${session.label}: ${session.message ?? "needs you"}` : undefined}
      style={{
        position: "fixed",
        inset: 0,
        padding: 0,
        border: 0,
        background: "transparent",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
      }}
    >
      <span
        style={{
          width: 24,
          height: 6,
          borderRadius: "0 0 4px 4px",
          background: "var(--ol-amber)",
          boxShadow: "0 0 8px 2px rgb(255 178 36 / 0.55)",
        }}
      />
    </button>
  );
}
