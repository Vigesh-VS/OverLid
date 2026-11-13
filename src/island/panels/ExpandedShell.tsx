import { PANELS, useIsland, type PanelId } from "../../stores/island";
import { Clock } from "../compact/Clock";
import styles from "./ExpandedShell.module.css";
import { CodePanel } from "./CodePanel";
import { FocusPanel } from "./FocusPanel";
import { MediaPanel } from "./MediaPanel";
import { PrompterPanel } from "./PrompterPanel";
import { StatsPanel } from "./StatsPanel";

// Placeholder copy until each module lands (SPEC §12).
const COMING: Partial<Record<PanelId, string>> = {
  home: "A summary of every module will show here.",
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

      <section className={styles.body} aria-label={PANELS.find((p) => p.id === panel)?.label}>
        {panel === "media" ? (
          <MediaPanel />
        ) : panel === "prompter" ? (
          <PrompterPanel />
        ) : panel === "code" ? (
          <CodePanel />
        ) : panel === "focus" ? (
          <FocusPanel />
        ) : panel === "stats" ? (
          <StatsPanel />
        ) : (
          <div className={styles.placeholder}>
            <p className={styles.coming}>{COMING[panel]}</p>
          </div>
        )}
      </section>
    </div>
  );
}
