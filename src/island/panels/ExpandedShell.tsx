import { PANELS, useIsland, type PanelId } from "../../stores/island";
import { Clock } from "../compact/Clock";
import styles from "./ExpandedShell.module.css";

// Placeholder copy until each module lands (SPEC §12).
const COMING: Record<PanelId, string> = {
  home: "A summary of every module will show here.",
  media: "Media controls arrive in Phase 1.",
  code: "Claude Code usage and sessions arrive in Phases 4 and 5.",
  prompter: "The teleprompter arrives in Phase 6.",
  focus: "The Pomodoro timer arrives in Phase 3.",
  stats: "CPU, memory and battery arrive in Phase 2.",
};

export function ExpandedShell() {
  const panel = useIsland((s) => s.panel);
  const setPanel = useIsland((s) => s.setPanel);

  return (
    <div className={styles.shell}>
      <nav className={styles.tabs} aria-label="Island panels">
        {PANELS.map((p) => (
          <button
            key={p.id}
            type="button"
            className={styles.tab}
            aria-current={p.id === panel ? "page" : undefined}
            onClick={() => setPanel(p.id)}
          >
            {p.label}
          </button>
        ))}
        <span className={styles.spacer} />
        <Clock className={styles.clock} />
      </nav>

      <section className={styles.panel} aria-label={PANELS.find((p) => p.id === panel)?.label}>
        <p className={styles.coming}>{COMING[panel]}</p>
      </section>
    </div>
  );
}
