import type { ReactNode } from "react";

import { BoltIcon, CheckIcon, KeyUpIcon } from "../../components/icons";
import { Ring } from "../../components/Ring";
import type { Peek, Tone } from "../../lib/ipc";

const TONE: Record<Tone, string> = {
  neutral: "var(--ol-text)",
  good: "var(--ol-green)",
  warn: "var(--ol-amber)",
  critical: "var(--ol-red)",
};

export interface Notification {
  icon: ReactNode;
  /** Short text next to the icon, e.g. "64%", "Done", "Caps on". */
  label: string;
  color: string;
  /** Full sentence for screen readers and the tooltip. */
  title: string;
}

/** A peek as a compact, island-style notification: icon + a few words. */
export function toNotification(peek: Peek): Notification {
  const color = TONE[peek.tone];
  const title = [peek.title, peek.subtitle].filter(Boolean).join(". ");
  switch (peek.kind) {
    case "capsLock":
    case "numLock": {
      const on = (peek.badge ?? "").toLowerCase() === "on";
      return {
        icon: <KeyUpIcon size={15} />,
        label: `${peek.kind === "capsLock" ? "Caps" : "Num"} ${on ? "on" : "off"}`,
        color: on ? "var(--ol-text)" : "var(--ol-text-2)",
        title,
      };
    }
    case "charging":
    case "onBattery":
    case "lowBattery":
      return {
        icon: <BoltIcon size={15} color={peek.kind === "onBattery" ? "var(--ol-text-2)" : color} />,
        label: peek.badge ?? "",
        color: peek.kind === "onBattery" ? "var(--ol-text)" : color,
        title,
      };
    case "agentDone":
      return {
        icon: (
          <span style={{ width: 16, height: 16, borderRadius: "50%", background: "var(--ol-green)", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
            <CheckIcon size={11} color="var(--ol-black)" />
          </span>
        ),
        label: "Done",
        color: "var(--ol-green)",
        title,
      };
    case "agentWaiting":
      return {
        icon: <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--ol-amber)", boxShadow: "0 0 0 3px rgb(255 178 36 / 0.25)" }} />,
        label: "Needs you",
        color: "var(--ol-amber)",
        title,
      };
    case "usage":
    case "quotaBack":
      return {
        icon: <Ring size={15} stroke={2.5} value={peek.value ?? 1} color={color} />,
        label: peek.kind === "quotaBack" ? "Ready" : `${Math.round((peek.value ?? 0) * 100)}%`,
        color,
        title,
      };
    case "focusDone":
      return {
        icon: <Ring size={15} stroke={2.5} value={peek.value ?? 1} color={color} />,
        label: peek.title === "Break over" ? "Break over" : "Focus done",
        color,
        title,
      };
  }
}
