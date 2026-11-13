import { useLayoutEffect, useRef, type CSSProperties, type MouseEvent, type ReactNode } from "react";

import { Ring } from "../../components/Ring";
import { formatCountdown } from "../../lib/format";
import { commands, run } from "../../lib/ipc";
import { LEVEL_COLOR, primaryUsage, useCode, usageLevel } from "../../stores/code";
import { useIsland } from "../../stores/island";
import { useMedia } from "../../stores/media";
import { pomoActive, usePomodoro } from "../../stores/pomodoro";
import { useSystem } from "../../stores/system";
import { AttentionBell } from "./AttentionBell";
import { Clock } from "./Clock";
import styles from "./CompactBar.module.css";
import { QuickActionButton } from "./QuickActionButton";

/** Geometry the island uses to size the pill around the centred time. */
export const PILL_LAYOUT = {
  /** Width reserved for "00:00" in bold tabular figures. */
  timeWidth: 44,
  gap: 10,
  padding: 12,
  minWidth: 120,
};

/**
 * The collapsed pill. The time is always centred and never replaced. Other
 * indicators sit to its right in a fixed order: attention · now playing ·
 * focus · AI usage · quick action. Each appears only when it has something to
 * show; the island grows the pill symmetrically so the time stays put.
 */
export function CompactBar() {
  const media = useMedia((s) => s.media);
  const accent = useMedia((s) => s.accent);
  const pomo = usePomodoro((s) => s.state);
  const usage = useCode((s) => s.usage);
  const attention = useCode((s) => s.attention);
  const general = useSystem((s) => s.settings?.general);
  const code = useSystem((s) => s.settings?.code);
  const quick = useSystem((s) => s.settings?.quickAction);
  const setIndicatorsWidth = useIsland((s) => s.setIndicatorsWidth);
  const setOverIndicator = useIsland((s) => s.setOverIndicator);
  const setSuppressExpand = useIsland((s) => s.setSuppressExpand);
  const groupRef = useRef<HTMLDivElement>(null);

  const show = general?.indicators ?? { media: true, focus: true, usage: true, quickAction: true };
  const items: ReactNode[] = [];

  function clickIndicator(e: MouseEvent) {
    e.stopPropagation();
    setSuppressExpand(true);
  }

  if (attention) items.push(<AttentionBell key="attention" session={attention} onPress={clickIndicator} />);

  if (show.media && media?.playing) {
    items.push(
      <button
        key="media"
        type="button"
        className={styles.media}
        data-indicator
        aria-label="Pause media"
        onClick={(e) => {
          clickIndicator(e);
          run(commands.mediaPlayPause(), "media_play_pause");
        }}
      >
        {media.art ? <img className={styles.art} src={media.art} alt="" draggable={false} /> : <span className={styles.art} />}
        <Bars />
      </button>,
    );
  }

  if (show.focus && pomo && pomoActive(pomo)) {
    const progress = pomo.totalMs > 0 ? 1 - pomo.remainingMs / pomo.totalMs : 0;
    items.push(
      <span key="pomo" className={styles.pomo}>
        <Ring size={14} stroke={2.5} value={progress} color={pomo.phase === "focus" ? "var(--ol-text)" : "var(--ol-green)"} />
        <span className={pomo.running ? styles.pomoTime : `${styles.pomoTime} ${styles.paused}`}>
          {formatCountdown(pomo.remainingMs)}
        </span>
      </span>,
    );
  }

  const primary = primaryUsage(usage);
  if (show.usage && primary) {
    const color = LEVEL_COLOR[usageLevel(primary.usedPercent, code?.warnPct, code?.criticalPct)];
    items.push(
      <span key="usage" className={styles.usage} style={{ color }}>
        <Ring size={14} stroke={2.5} value={primary.usedPercent / 100} color={color} label={`${primary.label} usage`} />
        <span className={styles.usagePct}>{Math.round(primary.usedPercent)}%</span>
      </span>,
    );
  }

  if (show.quickAction && quick && quick.kind !== "none") {
    items.push(<QuickActionButton key="quick" action={quick} onPress={clickIndicator} />);
  }

  // Tell the island how wide the right-hand group is (in unscaled px).
  useLayoutEffect(() => {
    const el = groupRef.current;
    if (!el) return;
    const measure = () => setIndicatorsWidth(el.childElementCount ? el.offsetWidth : 0);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [items.length, setIndicatorsWidth]);

  return (
    <div
      className={styles.bar}
      style={{ "--accent": accent } as CSSProperties}
      onPointerOver={(e) => setOverIndicator(!!(e.target as HTMLElement).closest("[data-indicator]"))}
    >
      <Clock className={styles.clock} />
      <div
        ref={groupRef}
        className={styles.right}
        style={{ left: `calc(50% + ${PILL_LAYOUT.timeWidth / 2 + PILL_LAYOUT.gap}px)` }}
      >
        {items}
      </div>
    </div>
  );
}

export function Bars() {
  return (
    <span className={`${styles.bars} ${styles.playing}`} aria-hidden="true">
      <span />
      <span />
      <span />
      <span />
    </span>
  );
}
