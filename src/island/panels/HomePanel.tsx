import type { CSSProperties } from "react";

import { PauseIcon, PlayIcon, ResetIcon, SkipIcon } from "../../components/icons";
import { Ring } from "../../components/Ring";
import { withAlpha } from "../../lib/color";
import { formatCountdown } from "../../lib/format";
import { commands, run } from "../../lib/ipc";
import { LEVEL_COLOR, leadSession, useCode, usageLevel } from "../../stores/code";
import { useIsland } from "../../stores/island";
import { useMedia } from "../../stores/media";
import { PHASE_LABEL, usePomoView } from "../../stores/pomodoro";
import { useSystem } from "../../stores/system";
import styles from "./HomePanel.module.css";

/** One glance at every module; each tile opens its panel. */
export function HomePanel() {
  return (
    <div className={styles.grid}>
      <MediaTile />
      <FocusTile />
      <CodeTile />
      <SystemTile />
    </div>
  );
}

function Tile({ title, panel, children, aside }: {
  title: string;
  panel: Parameters<ReturnType<typeof useIsland.getState>["setPanel"]>[0];
  children: React.ReactNode;
  aside?: React.ReactNode;
}) {
  const setPanel = useIsland((s) => s.setPanel);
  return (
    <div className={styles.tile}>
      <div className={styles.tileHead}>
        <button type="button" className={styles.tileTitle} onClick={() => setPanel(panel)}>
          {title}
        </button>
        {aside}
      </div>
      {children}
    </div>
  );
}

function MediaTile() {
  const media = useMedia((s) => s.media);
  const accent = useMedia((s) => s.accent);
  return (
    <Tile title="Now playing" panel="media">
      {media ? (
        <div className={styles.media}>
          {media.art ? (
            <img className={styles.art} src={media.art} alt="" style={{ boxShadow: `0 6px 20px ${withAlpha(accent, 0.35)}` }} />
          ) : (
            <span className={styles.art} style={{ background: accent } as CSSProperties} />
          )}
          <div className={styles.lines}>
            <span className={styles.strong}>{media.title || "Unknown title"}</span>
            <span className={styles.muted}>{[media.artist, media.sourceApp].filter(Boolean).join(" · ")}</span>
          </div>
          <button
            type="button"
            className={styles.play}
            aria-label={media.playing ? "Pause" : "Play"}
            onClick={() => run(commands.mediaPlayPause(), "media_play_pause")}
          >
            {media.playing ? <PauseIcon size={14} /> : <PlayIcon size={14} />}
          </button>
        </div>
      ) : (
        <span className={styles.muted}>Nothing playing</span>
      )}
    </Tile>
  );
}

function FocusTile() {
  const { state: pomo, remainingMs, progress } = usePomoView();
  if (!pomo) return <Tile title="Focus" panel="focus"><span className={styles.muted}>Starting…</span></Tile>;
  return (
    <Tile title="Focus" panel="focus">
      <div className={styles.media}>
        <Ring size={44} stroke={4} value={progress} color={pomo.phase === "focus" ? "var(--ol-text)" : "var(--ol-green)"} />
        <div className={styles.lines}>
          <span className={styles.big}>{formatCountdown(remainingMs)}</span>
          <span className={styles.muted}>
            {pomo.breaks ? `${PHASE_LABEL[pomo.phase]} · round ${pomo.round} of ${pomo.roundsPerCycle}` : `${pomo.today.sessions} today`}
          </span>
        </div>
        <div className={styles.icons}>
          <button
            type="button"
            className={styles.play}
            aria-label={pomo.running ? "Pause" : "Start"}
            title={pomo.running ? "Pause" : "Start"}
            onClick={() => run(pomo.running ? commands.pomoPause() : commands.pomoStart(), "pomo")}
          >
            {pomo.running ? <PauseIcon size={14} /> : <PlayIcon size={14} />}
          </button>
          <button type="button" className={styles.iconButton} aria-label="Skip" title="Skip" onClick={() => run(commands.pomoSkip(), "pomo_skip")}>
            <SkipIcon size={13} />
          </button>
          <button type="button" className={styles.iconButton} aria-label="Reset" title="Reset" onClick={() => run(commands.pomoReset(), "pomo_reset")}>
            <ResetIcon size={13} />
          </button>
        </div>
      </div>
    </Tile>
  );
}

function CodeTile() {
  const usage = useCode((s) => s.usage);
  const sessions = useCode((s) => s.sessions);
  const code = useSystem((s) => s.settings?.code);
  const primary = usage[0];
  const windows = (primary?.snapshot?.windows ?? []).slice(0, 2);
  const lead = leadSession(sessions);
  const status =
    lead?.status === "waiting"
      ? { text: `${lead.label} needs you`, cls: styles.warn }
      : lead?.status === "busy"
        ? { text: `${lead.label} is working`, cls: styles.muted }
        : lead?.status === "done"
          ? { text: `${lead.label} finished`, cls: styles.good }
          : null;

  return (
    <Tile title={primary?.displayName ?? "AI tools"} panel="code" aside={status && <span className={status.cls}>{status.text}</span>}>
      {windows.length ? (
        <div className={styles.bars}>
          {windows.map((w) => {
            const color = LEVEL_COLOR[usageLevel(w.usedPercent, code?.warnPct, code?.criticalPct)];
            return (
              <div key={w.key} className={styles.bar}>
                <div className={styles.barHead}>
                  <span>{w.label}</span>
                  <span style={{ color }}>{Math.round(w.usedPercent)}%</span>
                </div>
                <div className={styles.track}>
                  <span style={{ width: `${Math.min(100, w.usedPercent)}%`, background: color }} />
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <span className={styles.muted}>
          {primary ? "Waiting for the first usage reading…" : "Connect Claude Code, Codex or Copilot in the Code tab."}
        </span>
      )}
    </Tile>
  );
}

function SystemTile() {
  const tick = useSystem((s) => s.tick);
  const battery = tick?.battery;
  return (
    <Tile title="System" panel="stats">
      {tick && tick.memTotal > 0 ? (
        <div className={styles.stats}>
          <div>
            <span className={styles.big}>{Math.round(tick.cpuPercent)}%</span>
            <span className={styles.muted}>CPU</span>
          </div>
          <div>
            <span className={styles.big}>{Math.round((tick.memUsed / tick.memTotal) * 100)}%</span>
            <span className={styles.muted}>Memory</span>
          </div>
          <div>
            <span className={battery?.onAc ? `${styles.big} ${styles.good}` : styles.big}>
              {battery ? `${battery.percent}%` : "AC"}
            </span>
            <span className={styles.muted}>{battery ? "Battery" : "Power"}</span>
          </div>
        </div>
      ) : (
        <span className={styles.muted}>Reading stats…</span>
      )}
    </Tile>
  );
}
