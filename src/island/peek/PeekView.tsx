import { BoltIcon, CheckIcon, KeyUpIcon } from "../../components/icons";
import { Ring } from "../../components/Ring";
import type { Peek, Tone } from "../../lib/ipc";
import styles from "./PeekView.module.css";

const TONE_COLOR: Record<Tone, string> = {
  neutral: "var(--ol-text)",
  good: "var(--ol-green)",
  warn: "var(--ol-amber)",
  critical: "var(--ol-red)",
};

export function PeekView({ peek, action }: { peek: Peek; action?: React.ReactNode }) {
  const color = TONE_COLOR[peek.tone];
  return (
    <div className={styles.peek} role="status" aria-live="polite">
      <PeekIcon peek={peek} color={color} />
      <div className={styles.text}>
        <span
          className={styles.title}
          style={peek.kind === "agentWaiting" ? { color } : undefined}
        >
          {peek.title}
        </span>
        {peek.subtitle && <span className={styles.subtitle}>{peek.subtitle}</span>}
      </div>
      {peek.badge && <PeekBadge peek={peek} color={color} />}
      {action}
    </div>
  );
}

function PeekIcon({ peek, color }: { peek: Peek; color: string }) {
  switch (peek.kind) {
    case "capsLock":
    case "numLock":
      return (
        <span className={styles.keyIcon}>
          <KeyUpIcon size={16} />
        </span>
      );
    case "charging":
    case "onBattery":
    case "lowBattery":
      return <BoltIcon size={20} color={peek.kind === "onBattery" ? "var(--ol-text-2)" : color} />;
    case "agentDone":
      return (
        <span className={styles.doneIcon}>
          <CheckIcon size={16} color="var(--ol-black)" />
        </span>
      );
    case "agentWaiting":
      return (
        <span className={styles.waitIcon}>
          <span />
        </span>
      );
    case "usage":
    case "quotaBack":
    case "focusDone":
      return <Ring size={28} stroke={3.5} value={peek.value ?? 1} color={color} />;
  }
}

function PeekBadge({ peek, color }: { peek: Peek; color: string }) {
  const battery = peek.kind === "charging" || peek.kind === "onBattery" || peek.kind === "lowBattery";
  if (!battery) {
    return <span className={styles.badge}>{peek.badge}</span>;
  }
  return (
    <span className={styles.batteryBadge}>
      <span style={{ color }}>{peek.badge}</span>
      <span className={styles.battery} aria-hidden="true">
        <span className={styles.batteryBody}>
          <span style={{ width: `${(peek.value ?? 0) * 100}%`, background: color }} />
        </span>
        <span className={styles.batteryTip} />
      </span>
    </span>
  );
}
