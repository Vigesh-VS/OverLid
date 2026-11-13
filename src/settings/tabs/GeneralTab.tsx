import { useEffect, useState } from "react";

import { commands, type CaptureMode, type MonitorInfo } from "../../lib/ipc";
import { Choice, Group, Select, Toggle } from "../controls";
import { section, useSettingsStore } from "../useSettings";

const CAPTURE: ReadonlyArray<{ value: CaptureMode; label: string }> = [
  { value: "always", label: "Always" },
  { value: "prompterOnly", label: "While presenting" },
  { value: "never", label: "Never" },
];

export function GeneralTab() {
  const settings = useSettingsStore((s) => s.settings);
  const update = useSettingsStore((s) => s.update);
  const [monitors, setMonitors] = useState<MonitorInfo[]>([]);
  const [autostart, setAutostart] = useState(false);

  useEffect(() => {
    commands.listMonitors().then(setMonitors, () => undefined);
    commands.autostartGet().then(setAutostart, () => undefined);
  }, []);

  if (!settings) return null;
  const { general, peeks } = settings;

  const monitorOptions = [
    { value: "", label: "Primary display" },
    ...monitors.map((m) => ({
      value: m.name,
      label: `${m.name.replace(/^\\\\\.\\/, "")} · ${m.width}×${m.height}${m.primary ? " (primary)" : ""}`,
    })),
  ];

  return (
    <>
      <Group title="Island">
        <Select
          label="Show on"
          hint="The island sits at the top centre of this display."
          value={general.monitor ?? ""}
          options={monitorOptions}
          onChange={(v) => update(section("general", { monitor: v || null }))}
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
        <Toggle
          label="Play a sound"
          hint="A soft chime with agent, timer and limit peeks."
          checked={peeks.sound}
          onChange={(v) => update(section("peeks", { sound: v }))}
        />
      </Group>
    </>
  );
}
