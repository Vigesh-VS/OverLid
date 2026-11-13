import { commands, run } from "../../lib/ipc";
import { usePrompter } from "../../stores/prompter";
import { useSystem } from "../../stores/system";
import styles from "./PrompterPanel.module.css";

export function PrompterPanel() {
  const scripts = usePrompter((s) => s.scripts);
  const selectedId = usePrompter((s) => s.selectedId);
  const select = usePrompter((s) => s.select);
  const start = usePrompter((s) => s.start);
  const settings = useSystem((s) => s.settings);
  const voice = settings?.prompter.voice ?? false;
  const toggleKey = settings?.prompter.shortcuts.toggle ?? "Ctrl+Alt+P";

  const setVoice = (on: boolean) => {
    if (!settings) return;
    run(commands.settingsSet({ ...settings, prompter: { ...settings.prompter, voice: on } }), "settings_set");
  };

  return (
    <div className={styles.panel}>
      <div className={styles.list}>
        <span className={styles.heading}>Scripts</span>
        {scripts.length === 0 ? (
          <div className={styles.empty}>
            <span className={styles.emptyTitle}>No scripts yet</span>
            <span className={styles.emptyHint}>Write one in Settings, or import a .txt or .md file.</span>
            <button
              type="button"
              className={styles.openSettings}
              onClick={() => run(commands.openSettings(), "open_settings_window")}
            >
              Open Settings
            </button>
          </div>
        ) : (
          <div className={styles.rows} role="listbox" aria-label="Scripts">
            {scripts.map((s) => (
              <button
                key={s.id}
                type="button"
                role="option"
                aria-selected={s.id === selectedId}
                className={s.id === selectedId ? `${styles.row} ${styles.selected}` : styles.row}
                onClick={() => select(s.id)}
                onDoubleClick={() => start(s)}
              >
                <span className={styles.rowTitle}>
                  {s.favorite && <span className={styles.star} aria-label="Favourite">★</span>}
                  {s.title}
                </span>
                <span className={styles.preview}>{preview(s.body)}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className={styles.side}>
        <button
          type="button"
          className={styles.start}
          disabled={scripts.length === 0}
          onClick={() => start()}
        >
          Start presenting
        </button>
        <span className={styles.hint}>
          3-2-1, then the script scrolls out of the notch. {toggleKey} starts and stops it from anywhere.
        </span>

        <label className={styles.toggle}>
          <input type="checkbox" checked={voice} onChange={(e) => setVoice(e.target.checked)} />
          <span>
            <strong>Voice mode</strong>
            <span>Scrolls only while you talk. Mic audio is never recorded, stored or sent.</span>
          </span>
        </label>

        <span className={styles.privacy}>Hidden from screen share and recordings while presenting.</span>
      </div>
    </div>
  );
}

function preview(body: string): string {
  const line = body
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l && !l.startsWith("## "));
  return line ?? "Empty script";
}
