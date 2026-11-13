import { KeyUpIcon } from "../../components/icons";
import type { Peek } from "../../lib/ipc";

/** Caps Lock / Num Lock shown inside the pill: icon + "Caps Lock on". */
export function LockToast({ peek }: { peek: Peek }) {
  const on = (peek.badge ?? "").toLowerCase() === "on";
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--ol-space-2)",
        fontSize: "var(--ol-fs-md)",
        fontWeight: 600,
        whiteSpace: "nowrap",
        color: on ? "var(--ol-text)" : "var(--ol-text-2)",
      }}
    >
      <KeyUpIcon size={14} />
      {peek.title} {on ? "on" : "off"}
    </div>
  );
}
