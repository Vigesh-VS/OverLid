import { useEffect, useState } from "react";

import { Logo } from "../components/Logo";
import { commands, type IslandPosition } from "../lib/ipc";
import { Choice, Group, Row, Toggle } from "./controls";
import type { TabId } from "./SettingsApp";
import styles from "./Settings.module.css";
import { section, useSettingsStore } from "./useSettings";

const POSITIONS: ReadonlyArray<{ value: IslandPosition; label: string }> = [
  { value: "left", label: "Top left" },
  { value: "center", label: "Top centre" },
  { value: "right", label: "Top right" },
];

/** First run: what Overlid is, plus the three choices most people want to make. */
export function WelcomeScreen({ onDone }: { onDone: (next?: TabId) => void }) {
  const settings = useSettingsStore((s) => s.settings);
  const update = useSettingsStore((s) => s.update);
  const [autostart, setAutostart] = useState(false);

  useEffect(() => {
    commands.autostartGet().then(setAutostart, () => undefined);
  }, []);

  if (!settings) return null;

  return (
    <div className={styles.welcome}>
      <div className={styles.welcomeInner}>
        <Logo variant="metallic" size={112} label="Overlid" />
        <h1 className={styles.welcomeTitle}>Welcome to Overlid</h1>
        <p className={styles.welcomeLead}>
          A notch at the top of your screen. Hover it for media, your focus timer, system stats and Claude Code status, or
          use it as a teleprompter right under your webcam. It's already running; close this window any time and it keeps
          going in the tray.
        </p>

        <Group title="Get set up">
          <Toggle
            label="Start with Windows"
            checked={autostart}
            onChange={(on) => {
              setAutostart(on);
              commands.autostartSet(on).then(setAutostart, () => setAutostart(!on));
            }}
          />
          <Choice
            label="Position"
            value={settings.general.position}
            options={POSITIONS}
            onChange={(v) => update(section("general", { position: v, offsetX: 0 }))}
          />
          <Row label="AI coding tools" hint="Show Claude Code, Codex or Copilot usage and live session status.">
            <button type="button" className={styles.button} onClick={() => onDone("code")}>
              Connect AI tools
            </button>
          </Row>
        </Group>

        <button type="button" className={styles.primaryButton} onClick={() => onDone()}>
          Start using Overlid
        </button>
      </div>
    </div>
  );
}
