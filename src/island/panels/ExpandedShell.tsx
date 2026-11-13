import { useLayoutEffect, useRef, type ReactNode } from "react";

import { GearIcon } from "../../components/icons";
import { commands, run } from "../../lib/ipc";
import { PANELS, useIsland, type PanelId } from "../../stores/island";
import { Clock } from "../compact/Clock";
import { CodePanel } from "./CodePanel";
import styles from "./ExpandedShell.module.css";
import { FocusPanel } from "./FocusPanel";
import { HomePanel } from "./HomePanel";
import { MediaPanel } from "./MediaPanel";
import { PrompterPanel } from "./PrompterPanel";
import { StatsPanel } from "./StatsPanel";

const PANEL_VIEWS: Record<PanelId, () => ReactNode> = {
  home: () => <HomePanel />,
  media: () => <MediaPanel />,
  code: () => <CodePanel />,
  prompter: () => <PrompterPanel />,
  focus: () => <FocusPanel />,
  stats: () => <StatsPanel />,
};

export function ExpandedShell({ width }: { width: number }) {
  const panel = useIsland((s) => s.panel);
  const setPanel = useIsland((s) => s.setPanel);
  const setPanelHeight = useIsland((s) => s.setPanelHeight);
  const ref = useRef<HTMLDivElement>(null);

  // The island grows to exactly this content's height: no dead space.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setPanelHeight(panel, Math.ceil(el.offsetHeight));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [panel, setPanelHeight]);

  return (
    <div ref={ref} className={styles.shell} style={{ width }}>
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
        <button
          type="button"
          className={styles.gear}
          aria-label="Settings"
          title="Settings"
          onClick={() => run(commands.openSettings(), "open_settings_window")}
        >
          <GearIcon size={16} />
        </button>
      </nav>

      <section className={styles.body} aria-label={PANELS.find((p) => p.id === panel)?.label}>
        {PANEL_VIEWS[panel]()}
      </section>
    </div>
  );
}
