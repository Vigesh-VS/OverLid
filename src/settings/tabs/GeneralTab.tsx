import { useEffect, useState } from "react";

import { commands, type CaptureMode, type IslandPosition } from "../../lib/ipc";
import { Choice, Group, Row, Slider, Toggle } from "../controls";
import styles from "../Settings.module.css";
import { section, useSettingsStore } from "../useSettings";

const POSITIONS: ReadonlyArray<{ value: IslandPosition; label: string }> = [
  { value: "left", label: "Top left" },
  { value: "center", label: "Top centre" },
  { value: "right", label: "Top right" },
];

const CAPTURE: ReadonlyArray<{ value: CaptureMode; label: string }> = [
  { value: "always", label: "Always" },
  { value: "prompterOnly", label: "While presenting" },
  { value: "never", label: "Never" },
];

export function GeneralTab() {
  const settings = useSettingsStore((s) => s.settings);
  const update = useSettingsStore((s) => s.update);
  const [autostart, setAutostart] = useState(false);

  useEffect(() => {
    commands.autostartGet().then(setAutostart, () => undefined);
  }, []);

  if (!settings) return null;
  const { general, peeks } = settings;

  return (
    <>
      <Group title="Island">
        <Choice
          label="Position"
          hint="On your main display. In a corner the island sits flush with the screen edge."
          value={general.position}
          options={POSITIONS}
          onChange={(v) => update(section("general", { position: v, offsetX: 0 }))}
        />
        <Slider
          label="Horizontal offset"
          hint={general.position === "center" ? "Nudge left or right of centre." : "Move in from the corner."}
          value={general.offsetX}
          min={general.position === "center" ? -400 : 0}
          max={400}
          step={2}
          format={(v) => `${v > 0 && general.position === "center" ? "+" : ""}${v} px`}
          onChange={(v) => update(section("general", { offsetX: v }))}
        />
        <Choice
          label="Hide from screen share and recordings"
          hint={
            general.hideFromCapture === "never"
              ? "Your script will be visible to anyone you share your screen with."
              : "Teams, Meet, Zoom, OBS and screenshots see through the island."
          }
          value={general.hideFromCapture}
          options={CAPTURE}
          onChange={(v) => update(section("general", { hideFromCapture: v }))}
        />
        <Toggle
          label="Start with Windows"
          checked={autostart}
          onChange={(on) => {
            setAutostart(on);
            commands.autostartSet(on).then(setAutostart, () => setAutostart(!on));
          }}
        />
      </Group>

      <Group
        title="Clipboard"
        note="The Home tab keeps your last 30 copied texts and images so you can copy them again. Kept in memory only: never saved to disk, cleared when Overlid quits. Passwords copied from password managers are skipped."
      >
        <Toggle
          label="Keep clipboard history"
          hint="Turning it off also clears the history."
          checked={general.clipboardHistory}
          onChange={(v) => update(section("general", { clipboardHistory: v }))}
        />
      </Group>

      <Group title="Peeks" note="Short pop-outs from the notch when something happens. Each type can be turned off.">
        <Toggle
          label="Caps Lock and Num Lock"
          checked={peeks.lockKeys}
          onChange={(v) => update(section("peeks", { lockKeys: v }))}
        />
        <Toggle
          label="Charger and low battery"
          checked={peeks.battery}
          onChange={(v) => update(section("peeks", { battery: v }))}
        />
        <Toggle
          label="Claude Code finished or needs you"
          checked={peeks.agent}
          onChange={(v) => update(section("peeks", { agent: v }))}
        />
        <Toggle
          label="Usage limits"
          hint="At the warning and critical levels, and when quota comes back."
          checked={peeks.usage}
          onChange={(v) => update(section("peeks", { usage: v }))}
        />
        <Toggle
          label="Focus timer"
          checked={peeks.focus}
          onChange={(v) => update(section("peeks", { focus: v }))}
        />
        <Row label="Try it" hint="Shows a sample in the island so you can see how notifications look.">
          <div className={styles.tryRow}>
            <button type="button" className={styles.button} onClick={() => void commands.peekTest("agentWaiting")}>
              Claude needs you
            </button>
            <button type="button" className={styles.button} onClick={() => void commands.peekTest("agentDone")}>
              Claude finished
            </button>
            <button type="button" className={styles.button} onClick={() => void commands.peekTest("charging")}>
              Charging
            </button>
            <button type="button" className={styles.button} onClick={() => void commands.peekTest("capsLock")}>
              Caps Lock
            </button>
          </div>
        </Row>
        <Toggle
          label="Play a sound"
          hint="A soft chime with agent, timer and limit peeks."
          checked={peeks.sound}
          onChange={(v) => update(section("peeks", { sound: v }))}
        />
      </Group>

      <Group
        title="Troubleshooting"
        note="Logs stay on this PC (up to 4 files of 1 MB). Anything that looks like a token is masked before it's written."
      >
        <Toggle
          label="Detailed logging"
          hint="Only turn on when chasing a bug."
          checked={general.debugLogging}
          onChange={(v) => update(section("general", { debugLogging: v }))}
        />
      </Group>
    </>
  );
}
