import { useState } from "react";

import { CheckIcon } from "../../components/icons";
import { BusyArc } from "../../components/Ring";
import { commands, run, type AgentSession } from "../../lib/ipc";
import { ageLabel, useCode } from "../../stores/code";
import { useNow } from "./CodePanel";
import styles from "./CodePanel.module.css";
import list from "./SessionList.module.css";

/** Live Claude Code sessions reported by the hooks. */
export function SessionList() {
  const sessions = useCode((s) => s.sessions);
  const hooks = useCode((s) => s.hooks);
  const now = useNow(1000);

  return (
    <>
      <span className={styles.heading}>Sessions</span>
      {sessions.length > 0 ? (
        <>
          <div className={list.rows}>
            {sessions.slice(0, 4).map((s) => (
              <SessionRow key={s.id} session={s} now={now} />
            ))}
          </div>
          <span className={list.footnote}>Click a session to open its folder</span>
        </>
      ) : hooks?.installed ? (
        <div className={styles.sessionsEmpty}>
          <span className={styles.emptyTitle}>No sessions running</span>
          <span className={styles.emptyHint}>Start claude in a terminal and its status shows up here.</span>
        </div>
      ) : (
        <ConnectPrompt />
      )}
    </>
  );
}

function SessionRow({ session, now }: { session: AgentSession; now: number }) {
  const elapsed =
    session.status === "busy" && session.turnStartedAt
      ? clock(now - new Date(session.turnStartedAt).getTime())
      : session.status === "done"
        ? "just now"
        : ageLabel(session.updatedAt, now);

  const detail =
    session.status === "busy"
      ? session.tool
        ? `Busy · using ${session.tool}`
        : "Busy"
      : session.status === "waiting"
        ? `Waiting · ${session.message ?? "needs you"}`
        : session.status === "done"
          ? "Done"
          : "Idle";

  return (
    <button
      type="button"
      className={session.status === "waiting" ? `${list.row} ${list.waiting}` : list.row}
      onClick={() => run(commands.codeOpenFolder(session.id), "code_open_folder")}
      title={session.cwd}
    >
      <StatusIcon status={session.status} />
      <span className={list.text}>
        <span className={list.name}>{session.label}</span>
        <span className={list.detail}>{detail}</span>
      </span>
      <span className={list.time}>{elapsed}</span>
    </button>
  );
}

function StatusIcon({ status }: { status: AgentSession["status"] }) {
  switch (status) {
    case "busy":
      return <BusyArc size={22} stroke={2.5} className={list.spin} />;
    case "waiting":
      return (
        <span className={list.iconBox}>
          <span className={list.waitDot} />
        </span>
      );
    case "done":
      return (
        <span className={list.doneIcon}>
          <CheckIcon size={12} color="var(--ol-black)" />
        </span>
      );
    case "idle":
      return (
        <span className={list.iconBox}>
          <span className={list.idleDot} />
        </span>
      );
  }
}

function ConnectPrompt() {
  const setHooks = useCode((s) => s.setHooks);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const connect = () => {
    setBusy(true);
    setError(null);
    commands
      .codeConnect()
      .then((report) => setHooks(report.status))
      .catch((e: unknown) => setError(String(e)))
      .finally(() => setBusy(false));
  };

  return (
    <div className={styles.sessionsEmpty}>
      <span className={styles.emptyTitle}>See live session status</span>
      <span className={styles.emptyHint}>
        Adds Overlid's hooks to Claude Code's settings. Your file is backed up first and your own hooks stay as they are.
      </span>
      <button type="button" className={list.connect} onClick={connect} disabled={busy}>
        {busy ? "Connecting…" : "Connect Claude Code"}
      </button>
      {error && <span className={list.error}>{error}</span>}
    </div>
  );
}

function clock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}:${String(s).padStart(2, "0")}`;
}
