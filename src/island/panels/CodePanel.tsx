import { useEffect, useState } from "react";

import { Ring } from "../../components/Ring";
import { commands, run, type ProviderStatus } from "../../lib/ipc";
import { LEVEL_COLOR, ageLabel, resetLabel, useCode, usageLevel } from "../../stores/code";
import { useSystem } from "../../stores/system";
import styles from "./CodePanel.module.css";
import { SessionList } from "./SessionList";

const DERIVED_HINT =
  "Derived from Claude's unofficial usage endpoint. It can differ slightly from /usage in Claude Code.";

/** Re-render every `ms` so relative times stay fresh. */
export function useNow(ms = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(id);
  }, [ms]);
  return now;
}

export function CodePanel() {
  const usage = useCode((s) => s.usage);
  const claude = usage.find((p) => p.providerId === "claude") ?? null;

  return (
    <div className={styles.panel}>
      <UsageCard status={claude} />
      <div className={styles.sessions}>
        <SessionList />
      </div>
    </div>
  );
}

function UsageCard({ status }: { status: ProviderStatus | null }) {
  const now = useNow();
  const code = useSystem((s) => s.settings?.code);
  const warn = code?.warnPct ?? 80;
  const critical = code?.criticalPct ?? 95;
  const windows = (status?.snapshot?.windows ?? []).slice(0, 3);
  const stale = status && status.state !== "ok" && status.snapshot;

  return (
    <div className={styles.usage}>
      <div className={styles.usageHeader}>
        <span className={styles.heading}>Claude usage</span>
        <span className={styles.derived} title={DERIVED_HINT}>
          derived
        </span>
      </div>

      {windows.length > 0 ? (
        <div className={styles.rings} style={{ gridTemplateColumns: `repeat(${windows.length}, minmax(0, 1fr))` }}>
          {windows.map((w) => {
            const color = LEVEL_COLOR[usageLevel(w.usedPercent, warn, critical)];
            return (
              <div key={w.key} className={styles.ringCell}>
                <div className={styles.ring}>
                  <Ring size={64} stroke={6} value={w.usedPercent / 100} color={stale ? "var(--ol-text-3)" : color} />
                  <span className={styles.ringValue} style={{ color: stale ? "var(--ol-text-2)" : color }}>
                    {Math.round(w.usedPercent)}%
                  </span>
                </div>
                <span className={styles.ringLabel}>{w.label}</span>
                <span className={styles.ringReset}>{resetLabel(w.resetsAt, now)}</span>
              </div>
            );
          })}
        </div>
      ) : (
        <UsageEmpty status={status} />
      )}

      <div className={styles.usageFooter}>
        <span>
          {status?.snapshot ? `Updated ${ageLabel(status.snapshot.fetchedAt, now)}` : " "}
          {stale && status.message ? ` · ${status.message}` : ""}
        </span>
        <button
          type="button"
          className={styles.refresh}
          onClick={() => run(commands.codeRefreshUsage(), "code_refresh_usage")}
        >
          Refresh
        </button>
      </div>
    </div>
  );
}

function UsageEmpty({ status }: { status: ProviderStatus | null }) {
  const state = status?.state ?? "loading";
  const [title, hint] =
    state === "needsAuth"
      ? ["Sign in to Claude Code", "Run claude once in a terminal, then refresh."]
      : state === "disabled"
        ? ["Usage is turned off", "Turn it on in Settings › CodeNotch."]
        : state === "error" || state === "rateLimited"
          ? ["Couldn't read usage", status?.message ?? "Try again in a minute."]
          : ["Checking usage…", ""];
  return (
    <div className={styles.usageEmpty}>
      <span className={styles.emptyTitle}>{title}</span>
      {hint && <span className={styles.emptyHint}>{hint}</span>}
    </div>
  );
}
