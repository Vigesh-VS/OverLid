import type { CSSProperties, MouseEvent, ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";

import { KeyUpIcon } from "../../components/icons";
import { ProviderMark } from "../../components/ProviderIcon";
import { Ring } from "../../components/Ring";
import { formatCountdown } from "../../lib/format";
import { commands, run, type Peek, type ProviderId, type ProviderStatus, type UsageWindow } from "../../lib/ipc";
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
import {
  PILL,
  clockWidth,
  lockWidth,
  notifyWidth,
  pillSlots,
  pillGeometry,
  sideColumn,
  slotWidth,
  type PillSlots,
  type Slot,
} from "./pillLayout";

/** True when the system clock is 12-hour ("9:14 am"). */
const TWELVE_HOUR = new Intl.DateTimeFormat(undefined, { hour: "numeric" }).resolvedOptions().hour12 ?? false;
const TIME_WIDTH = clockWidth(TWELVE_HOUR);

/** Column gap from tokens.css (--ol-pill-slot-gap), so CSS and layout agree. */
const GAP = (() => {
  const v = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--ol-pill-slot-gap"));
  return Number.isFinite(v) ? v : PILL.gap;
})();

const isLockKey = (peek: Peek | null) => peek?.kind === "capsLock" || peek?.kind === "numLock";

function lockLabel(peek: Peek): string {
  const on = (peek.badge ?? "").toLowerCase() === "on";
  return `${peek.kind === "capsLock" ? "Caps Lock" : "Num Lock"} ${on ? "on" : "off"}`;
}

/** The AI tool the pill should represent: the one you're using, else the primary. */
function activeTool(usage: ProviderStatus[], claudeActive: boolean): { status: ProviderStatus; window: UsageWindow } | null {
  const status = (claudeActive && usage.find((u) => u.providerId === "claude")) || usage[0];
  const windows = status?.snapshot?.windows ?? [];
  const window = windows.find((w) => w.key === "five_hour" || w.key === "primary") ?? windows[0];
  return status && window ? { status, window } : null;
}

interface PillModel {
  slots: PillSlots;
  /** Width of each side column (equal on both sides). */
  side: number;
  /** Width of the centre column: the time, or a wider lock-key label. */
  centre: number;
  width: number;
  /** Time on the left, notification on the right (see pillGeometry). */
  split: boolean;
  timeShift: number;
  notifyFromCentre: number;
}

/** What the collapsed pill shows right now. Shared by the island (width) and the bar (content). */
export function usePill(): PillModel {
  const media = useMedia((s) => s.media);
  const usage = useCode((s) => s.usage);
  const sessions = useCode((s) => s.sessions);
  const attention = useCode((s) => s.attention);
  const general = useSystem((s) => s.settings?.general);
  const focusInPill = useSystem((s) => s.settings?.focus.showInPill ?? false);
  const quick = useSystem((s) => s.settings?.quickAction);
  const { state: pomo } = usePomoView();
  const peek = useIsland((s) => s.peek);

  // Lock keys use the centre column; other notifications sit on the right.
  const lock = isLockKey(peek) && peek ? lockLabel(peek) : null;
  const notification = peek && !lock ? toNotification(peek) : null;

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
  // The pill only grows for a lock label if it's wider than the time.
  const centre = Math.max(TIME_WIDTH, lock ? lockWidth(lock) : 0);
  const g = pillGeometry(slots, centre, GAP);
  return { slots, side: sideColumn(slots, GAP), centre, ...g };
}

/**
 * The collapsed pill as a 3-column grid: [left] [time] [right]. Both side
 * columns are the same width and their items are centred in them, so the
 * time is always exactly centred.
 */
export function CompactBar() {
  const { slots, side, centre, split, timeShift, notifyFromCentre } = usePill();
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
  const lock = isLockKey(peek) && peek ? peek : null;
  const notification = peek && !lock ? toNotification(peek) : null;
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

  // The pill widens first (spring); new side items pop in once there's room.
  const pop = reduceMotion
    ? { initial: false as const, animate: { opacity: 1 }, exit: { opacity: 0 } }
    : {
        initial: { opacity: 0, scale: 0.4 },
        animate: { opacity: 1, scale: 1, transition: { delay: 0.14, type: "spring" as const, stiffness: 520, damping: 26 } },
        exit: { opacity: 0, scale: 0.6, transition: { duration: 0.1 } },
      };
  const fade = { initial: { opacity: 0 }, animate: { opacity: 1, transition: { duration: 0.14 } }, exit: { opacity: 0, transition: { duration: 0.1 } } };
  // A new notification re-pops even if one was already showing.
  const keyFor = (slot: Slot) => (slot === "notify" && peek ? `notify-${peek.kind}-${peek.title}-${peek.badge ?? ""}` : slot);

  /** One side column: fixed width, items centred in it. */
  const column = (list: Slot[], align: "left" | "right") => (
    <div
      className={styles.side}
      style={{
        width: side,
        ...(align === "left"
          ? { right: `calc(50% + ${centre / 2 + GAP}px)` }
          : { left: `calc(50% + ${centre / 2 + GAP}px)` }),
      }}
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
      {!split && side > 0 && column(slots.left, "left")}
      {/* The time glides left when a notification splits the pill, and back. */}
      <motion.div
        className={styles.centre}
        style={{ width: centre, marginLeft: -centre / 2 }}
        initial={false}
        animate={{ x: timeShift }}
        transition={reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 400, damping: 30 }}
      >
        <AnimatePresence initial={false} mode="popLayout">
          {lock ? (
            <motion.span key={`lock-${lock.kind}-${lock.badge ?? ""}`} className={styles.lock} role="status" aria-live="polite" {...fade}>
              <KeyUpIcon size={13} />
              {lockLabel(lock)}
            </motion.span>
          ) : (
            <motion.span key="time" className={styles.timeWrap} {...fade}>
              <Clock className={styles.clock} />
            </motion.span>
          )}
        </AnimatePresence>
      </motion.div>
      {!split && side > 0 && column(slots.right, "right")}
      <AnimatePresence initial={false}>
        {split && notification && peek && (
          <motion.div
            key={`split-${peek.kind}-${peek.title}-${peek.badge ?? ""}`}
            className={styles.splitNotify}
            style={{ left: `calc(50% + ${notifyFromCentre}px)`, width: slots.notifyWidth }}
            initial={reduceMotion ? false : { opacity: 0, x: 18 }}
            animate={{ opacity: 1, x: 0, transition: { delay: reduceMotion ? 0 : 0.08, type: "spring", stiffness: 420, damping: 30 } }}
            exit={{ opacity: 0, x: 18, transition: { duration: 0.14 } }}
          >
            {render("notify")}
          </motion.div>
        )}
      </AnimatePresence>
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
