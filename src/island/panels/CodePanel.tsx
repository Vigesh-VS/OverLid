import { useEffect, useState } from "react";

import { ConnectPrompt, useConnectFlow } from "../../components/ConnectFlow";
import { ProviderIcon } from "../../components/ProviderIcon";
import { Ring } from "../../components/Ring";
import { commands, run, type ProviderId, type ProviderStatus } from "../../lib/ipc";
import { LEVEL_COLOR, ageLabel, resetLabel, useCode, usageLevel } from "../../stores/code";
import { useSystem } from "../../stores/system";
import styles from "./CodePanel.module.css";
import { SessionList } from "./SessionList";

const DERIVED_HINT = "Derived from an unofficial usage endpoint. It can differ slightly from the tool's own numbers.";

/** Re-render every `ms` so relative times stay fresh. */
export function useNow(ms = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(id);
  }, [ms]);
  return now;
}

/**
 * Nothing connected: pick a tool. One connected: that tool full-size, with
 * small connect icons for the rest. Two or more: split view; with more than
 * two, a switcher picks the second slot.
 */
export function CodePanel() {
  const usage = useCode((s) => s.usage);
  const providers = useCode((s) => s.providers);
  const flow = useConnectFlow();
  const [second, setSecond] = useState<string | null>(null);

  const connected = usage;
  const unconnected = providers.filter((p) => !p.connected);
  const claudeShown = (ids: string[]) => ids.includes("claude");

  if (connected.length === 0) {
    return (
      <div className={styles.panel}>
        <span className={styles.heading}>Connect an AI coding tool to see its usage</span>
        <div className={styles.picker}>
          {providers.map((p) => (
            <button key={p.id} type="button" className={styles.pick} onClick={() => flow.begin(p)}>
              <ProviderIcon id={p.id} size={32} muted={!p.available} />
              <span className={styles.pickName}>{p.name}</span>
              <span className={p.available ? styles.pickAction : styles.pickSoon}>
                {p.available ? "Connect" : "Coming soon"}
              </span>
            </button>
          ))}
        </div>
        <ConnectPrompt flow={flow} />
      </div>
    );
  }

  const primary = connected[0];
  const others = connected.slice(1);
  const secondStatus = others.find((o) => o.providerId === second) ?? others[0];
  const shown = secondStatus ? [primary, secondStatus] : [primary];

  return (
    <div className={styles.panel}>
      {others.length > 1 && (
        <div className={styles.switcher} role="tablist" aria-label="Second tool">
          {others.map((o) => (
            <button
              key={o.providerId}
              type="button"
              role="tab"
              aria-selected={o.providerId === secondStatus?.providerId}
              className={o.providerId === secondStatus?.providerId ? styles.switchOn : styles.switch}
              onClick={() => setSecond(o.providerId)}
            >
              <ProviderIcon id={o.providerId as ProviderId} size={16} />
              {o.displayName}
            </button>
          ))}
        </div>
      )}

      {shown.length === 1 ? (
        <div className={styles.single}>
          <UsageCard status={primary} wide={!claudeShown([primary.providerId])} />
          {primary.providerId === "claude" && (
            <div className={styles.sessions}>
              <SessionList />
            </div>
          )}
        </div>
      ) : (
        <>
          <div className={styles.split}>
            {shown.map((s) => (
              <UsageCard key={s.providerId} status={s} compact />
            ))}
          </div>
          {claudeShown(shown.map((s) => s.providerId)) && (
            <div className={styles.sessionsStrip}>
              <SessionList compact />
            </div>
          )}
        </>
      )}

      {unconnected.length > 0 && (
        <div className={styles.more}>
          <span>Add</span>
          {unconnected.map((p) => (
            <button
              key={p.id}
              type="button"
              className={styles.mini}
              aria-label={p.available ? `Connect ${p.name}` : `${p.name}, coming soon`}
              title={p.available ? `Connect ${p.name}` : `${p.name}: coming soon`}
              onClick={() => flow.begin(p)}
            >
              <ProviderIcon id={p.id} size={18} muted={!p.available} />
            </button>
          ))}
        </div>
      )}
      <ConnectPrompt flow={flow} />
    </div>
  );
}

function UsageCard({ status, compact = false, wide = false }: { status: ProviderStatus; compact?: boolean; wide?: boolean }) {
  const now = useNow();
  const code = useSystem((s) => s.settings?.code);
  const warn = code?.warnPct ?? 80;
  const critical = code?.criticalPct ?? 95;
  const windows = (status.snapshot?.windows ?? []).slice(0, compact ? 2 : 3);
  const stale = status.state !== "ok" && !!status.snapshot;
  const ringSize = compact ? 52 : 60;

  return (
    <div className={wide ? `${styles.usage} ${styles.wide}` : compact ? `${styles.usage} ${styles.compact}` : styles.usage}>
      <div className={styles.usageHeader}>
        <span className={styles.title}>
          <ProviderIcon id={status.providerId as ProviderId} size={18} />
          {status.displayName}
        </span>
        <span className={styles.derived} title={DERIVED_HINT}>
          derived
        </span>
      </div>

      {windows.length > 0 ? (
        <div className={styles.rings} style={{ gridTemplateColumns: `repeat(${windows.length}, minmax(0, 1fr))` }}>
          {windows.map((w) => {
            const color = stale ? "var(--ol-text-3)" : LEVEL_COLOR[usageLevel(w.usedPercent, warn, critical)];
            return (
              <div key={w.key} className={styles.ringCell}>
                <div className={styles.ring} style={{ width: ringSize, height: ringSize }}>
                  <Ring size={ringSize} stroke={compact ? 5 : 6} value={w.usedPercent / 100} color={color} />
                  <span className={styles.ringValue} style={{ color }}>
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
          {status.snapshot ? `Updated ${ageLabel(status.snapshot.fetchedAt, now)}` : " "}
          {stale && status.message ? ` · ${status.message}` : ""}
          {!stale && status.snapshot?.plan ? ` · ${status.snapshot.plan}` : ""}
        </span>
        <button type="button" className={styles.refresh} onClick={() => run(commands.codeRefreshUsage(), "code_refresh_usage")}>
          Refresh
        </button>
      </div>
    </div>
  );
}

function UsageEmpty({ status }: { status: ProviderStatus }) {
  const [title, hint] =
    status.state === "needsAuth"
      ? [`Sign in to ${status.displayName}`, status.message ?? ""]
      : status.state === "disabled"
        ? ["Usage is turned off", "Turn it on in Settings › AI tools."]
        : status.state === "error" || status.state === "rateLimited"
          ? ["Couldn't read usage", status.message ?? "Try again in a minute."]
          : ["Checking usage…", ""];
  return (
    <div className={styles.usageEmpty}>
      <span className={styles.emptyTitle}>{title}</span>
      {hint && <span className={styles.emptyHint}>{hint}</span>}
    </div>
  );
}
