import { useState, type MouseEvent } from "react";

import { QuickIcon } from "../../components/quickIcons";
import { commands, type QuickAction } from "../../lib/ipc";
import styles from "./PillIndicators.module.css";

/** The pill's configurable quick action. Pulses briefly when it runs. */
export function QuickActionButton({ action, onPress }: { action: QuickAction; onPress: (e: MouseEvent) => void }) {
  const [pulse, setPulse] = useState(0);
  const [failed, setFailed] = useState<string | null>(null);

  const press = (e: MouseEvent) => {
    onPress(e);
    setPulse((n) => n + 1);
    commands.quickActionRun().then(
      () => setFailed(null),
      (err: unknown) => setFailed(String(err)),
    );
  };

  const label = failed ?? (action.tooltip || "Quick action");
  return (
    <button
      key={pulse}
      type="button"
      className={pulse ? `${styles.quick} ${styles.pulse}` : styles.quick}
      data-indicator
      aria-label={label}
      title={label}
      onClick={press}
    >
      {action.icon === "app" && action.iconData ? (
        <img src={action.iconData} alt="" width={16} height={16} draggable={false} />
      ) : (
        <QuickIcon name={action.icon} size={14} />
      )}
    </button>
  );
}
