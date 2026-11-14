import type { CSSProperties, MouseEvent, ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";

import { ProviderMark } from "../../components/ProviderIcon";
import { Ring } from "../../components/Ring";
import { formatCountdown } from "../../lib/format";
import { commands, run, type ProviderId, type ProviderStatus, type UsageWindow } from "../../lib/ipc";
import { LEVEL_COLOR, leadSession, useCode, usageLevel } from "../../stores/code";
import { useIsland } from "../../stores/island";
import { useMedia } from "../../stores/media";
import { pomoActive, usePomoView } from "../../stores/pomodoro";
import { useSystem } from "../../stores/system";
import { AttentionBell } from "./AttentionBell";
import { Clock } from "./Clock";
import { QuickActionButton } from "./QuickActionButton";
import styles from "./CompactBar.module.css";
import { toNotification } from "./notification";
import { PILL, clockWidth, notifyWidth, pillSlots, pillWidth, slotWidth, type PillSlots, type Slot } from "./pillLayout";

/** True when the system clock is 12-hour ("9:14 am"). */
const TWELVE_HOUR = new Intl.DateTimeFormat(undefined, { hour: "numeric" }).resolvedOptions().hour12 ?? false;
const TIME_WIDTH = clockWidth(TWELVE_HOUR);

/** The AI tool the pill should represent: the one you're using, else the primary. */
function activeTool(usage: ProviderStatus[], claudeActive: boolean): { status: ProviderStatus; window: UsageWindow } | null {
  const status = (claudeActive && usage.find((u) => u.providerId === "claude")) || usage[0];
  const windows = status?.snapshot?.windows ?? [];
  const window = windows.find((w) => w.key === "five_hour" || w.key === "primary") ?? windows[0];
  return status && window ? { status, window } : null;
}

/** What the collapsed pill shows right now. Shared by the island (width) and the bar (content). */
export function usePill(): { slots: PillSlots; width: number } {
  const media = useMedia((s) => s.media);
  const usage = useCode((s) => s.usage);
  const sessions = useCode((s) => s.sessions);
  const attention = useCode((s) => s.attention);
  const general = useSystem((s) => s.settings?.general);
  const focusInPill = useSystem((s) => s.settings?.focus.showInPill ?? false);
  const quick = useSystem((s) => s.settings?.quickAction);
  const { state: pomo } = usePomoView();
  const peek = useIsland((s) => s.peek);
  const notification = peek ? toNotification(peek) : null;

  const lead = leadSession(sessions);
  const claudeActive = lead?.status === "busy" || lead?.status === "waiting";
  const slots = pillSlots({
    mediaPlaying: (general?.indicators.media ?? true) && !!media?.playing,
    attention: !!attention,
    extended: general?.extendedPill ?? false,
    usage: !!activeTool(usage, claudeActive),
    quickAction: !!quick && quick.kind !== "none",
    focus: focusInPill && pomoActive(pomo),
    notify: notification ? notifyWidth(notification.label) : 0,
  });
  return { slots, width: pillWidth(slots, TIME_WIDTH) };
}

/**
 * The collapsed pill: the bold time dead centre, optional slots either side.
 * Each slot is a fixed-width box, matching the widths the layout used.
 */
export function CompactBar() {
  const { slots } = usePill();
  const media = useMedia((s) => s.media);
  const accent = useMedia((s) => s.accent);
  const usage = useCode((s) => s.usage);
  const sessions = useCode((s) => s.sessions);
  const attention = useCode((s) => s.attention);
  const code = useSystem((s) => s.settings?.code);
  const quick = useSystem((s) => s.settings?.quickAction);
  const { state: pomo, remainingMs, progress } = usePomoView();
  const setOverIndicator = useIsland((s) => s.setOverIndicator);
  const setSuppressExpand = useIsland((s) => s.setSuppressExpand);
  const peek = useIsland((s) => s.peek);
  const notification = peek ? toNotification(peek) : null;
  const reduceMotion = useReducedMotion();

  function clickIndicator(e: MouseEvent) {
    e.stopPropagation();
    setSuppressExpand(true);
  }

  const lead = leadSession(sessions);
  const tool = activeTool(usage, lead?.status === "busy" || lead?.status === "waiting");

  const render = (slot: Slot): ReactNode => {
    switch (slot) {
      case "bell":
        return attention && <AttentionBell session={attention} onPress={clickIndicator} />;
      case "art":
        return (
          <button
            type="button"
            className={styles.media}
            data-indicator
            aria-label={media?.playing ? "Pause media" : "Play media"}
            onClick={(e) => {
              clickIndicator(e);
              run(commands.mediaPlayPause(), "media_play_pause");
            }}
          >
            {media?.art ? <img className={styles.art} src={media.art} alt="" draggable={false} /> : <span className={styles.art} />}
          </button>
        );
      case "bars":
        return <Bars />;
      case "usage": {
        if (!tool) return null;
        const color = LEVEL_COLOR[usageLevel(tool.window.usedPercent, code?.warnPct, code?.criticalPct)];
        return (
          <span className={styles.usage} style={{ color }} title={`${tool.status.displayName} ${tool.window.label}`}>
            <ProviderMark id={tool.status.providerId as ProviderId} size={13} color="var(--ol-text)" />
            <span className={styles.usagePct}>{Math.round(tool.window.usedPercent)}%</span>
          </span>
        );
      }
      case "focus":
        return (
          pomo && (
            <span className={styles.pomo}>
              <Ring size={14} stroke={2.5} value={progress} color={pomo.phase === "focus" ? "var(--ol-text)" : "var(--ol-green)"} />
              <span className={pomo.running ? styles.pomoTime : `${styles.pomoTime} ${styles.paused}`}>
                {formatCountdown(remainingMs)}
              </span>
            </span>
          )
        );
      case "quick":
        return quick && <QuickActionButton action={quick} onPress={clickIndicator} />;
      case "notify":
        return (
          notification && (
            <span className={styles.notify} role="status" aria-live="polite" title={notification.title} style={{ color: notification.color }}>
              <span className={styles.notifyIcon}>{notification.icon}</span>
              <span className={styles.notifyLabel}>{notification.label}</span>
            </span>
          )
        );
    }
  };

  // The pill widens first (spring); the new icon pops in once there's room.
  const pop = reduceMotion
    ? { initial: false as const, animate: { opacity: 1 }, exit: { opacity: 0 } }
    : {
        initial: { opacity: 0, scale: 0.4 },
        animate: { opacity: 1, scale: 1, transition: { delay: 0.14, type: "spring" as const, stiffness: 520, damping: 26 } },
        exit: { opacity: 0, scale: 0.6, transition: { duration: 0.1 } },
      };
  // A new notification re-pops even if one was already showing.
  const keyFor = (slot: Slot) => (slot === "notify" && peek ? `notify-${peek.kind}-${peek.title}-${peek.badge ?? ""}` : slot);

  const side = (list: Slot[], align: "left" | "right") => (
    <div
      className={styles.side}
      style={
        align === "left"
          ? { right: `calc(50% + ${TIME_WIDTH / 2 + PILL.gap}px)`, justifyContent: "flex-end" }
          : { left: `calc(50% + ${TIME_WIDTH / 2 + PILL.gap}px)` }
      }
    >
      <AnimatePresence initial={false} mode="popLayout">
        {list.map((slot) => (
          <motion.span key={keyFor(slot)} className={styles.slot} style={{ width: slotWidth(slot, slots) }} {...pop}>
            {render(slot)}
          </motion.span>
        ))}
      </AnimatePresence>
    </div>
  );

  return (
    <div
      className={styles.bar}
      style={{ "--accent": accent } as CSSProperties}
      onPointerOver={(e) => setOverIndicator(!!(e.target as HTMLElement).closest("[data-indicator]"))}
    >
      {side(slots.left, "left")}
      <Clock className={styles.clock} />
      {side(slots.right, "right")}
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
