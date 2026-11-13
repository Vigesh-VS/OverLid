import { useEffect, useState } from "react";

import { commands, type RunningApp, type VisibilityMode } from "../../lib/ipc";
import { Choice, Group, Row, Slider, Toggle } from "../controls";
import styles from "../Settings.module.css";
import { section, useSettingsStore } from "../useSettings";

const VISIBILITY: ReadonlyArray<{ value: VisibilityMode; label: string }> = [
  { value: "alwaysOnTop", label: "Always on top" },
  { value: "selectedApps", label: "Only over selected apps" },
  { value: "normal", label: "Normal window" },
];

const VISIBILITY_HINT: Record<VisibilityMode, string> = {
  alwaysOnTop: "The island floats over everything.",
  selectedApps: "On top only while one of the apps below is in front. Otherwise it sits behind your windows.",
  normal: "Not topmost: it goes behind whatever you open.",
};

const fileName = (path: string) => path.split(/[\\/]/).pop()?.toLowerCase() ?? path.toLowerCase();

export function DisplayTab() {
  const settings = useSettingsStore((s) => s.settings);
  const update = useSettingsStore((s) => s.update);
  const [running, setRunning] = useState<RunningApp[]>([]);

  const refreshRunning = () => commands.listRunningApps().then(setRunning, () => undefined);
  useEffect(() => {
    void refreshRunning();
  }, []);

  if (!settings) return null;
  const g = settings.general;
  const set = (patch: Partial<typeof g>) => update(section("general", patch));
  const selected = new Set(g.selectedApps);
  const toggleApp = (exe: string, on: boolean) =>
    set({ selectedApps: on ? [...g.selectedApps, exe] : g.selectedApps.filter((a) => a !== exe) });

  const choices = [
    ...running,
    ...g.selectedApps.filter((exe) => !running.some((r) => r.exe === exe)).map((exe) => ({ name: exe.replace(/\.exe$/, ""), exe, path: exe })),
  ];

  return (
    <>
      <Group title="Visibility">
        <Choice
          label="Show the island"
          hint={VISIBILITY_HINT[g.visibility]}
          value={g.visibility}
          options={VISIBILITY}
          onChange={(v) => set({ visibility: v })}
        />
      </Group>

      {g.visibility === "selectedApps" && (
        <Group title="Selected apps" note="Tick the apps the island should stay on top of. Apps that aren't running yet can be added with Browse.">
          {choices.map((app) => (
            <Toggle
              key={app.exe}
              label={app.name}
              hint={app.exe}
              checked={selected.has(app.exe)}
              onChange={(on) => toggleApp(app.exe, on)}
            />
          ))}
          <Row label="Add another app">
            <button type="button" className={styles.button} onClick={() => void refreshRunning()}>
              Refresh list
            </button>
            <button
              type="button"
              className={styles.button}
              onClick={() =>
                commands.pickExe().then((path) => {
                  if (!path) return;
                  const exe = fileName(path);
                  if (!selected.has(exe)) set({ selectedApps: [...g.selectedApps, exe] });
                }, () => undefined)
              }
            >
              Browse…
            </button>
          </Row>
        </Group>
      )}

      <Group title="Size" note="Everything in the island scales together: text, icons, rings, artwork, spacing and the area you can hover.">
        <Slider
          label="Scale"
          value={Math.round(g.uiScale * 100)}
          min={75}
          max={150}
          step={5}
          format={(v) => `${v} %`}
          onChange={(v) => set({ uiScale: v / 100 })}
        />
        <Slider
          label="Open width"
          hint="Width of the island when it's open."
          value={g.expandedWidth}
          min={560}
          max={760}
          step={10}
          format={(v) => `${v} px`}
          onChange={(v) => set({ expandedWidth: v })}
        />
        <Slider
          label="Pill height"
          value={g.pillHeight}
          min={28}
          max={44}
          format={(v) => `${v} px`}
          onChange={(v) => set({ pillHeight: v })}
        />
      </Group>

      <Group title="Behaviour">
        <Slider
          label="Close delay"
          hint="How long the island stays open after the cursor leaves. 0.3–0.5 s feels natural."
          value={g.closeDelayMs / 1000}
          min={0.2}
          max={1}
          step={0.1}
          format={(v) => `${v.toFixed(1)} s`}
          onChange={(v) => set({ closeDelayMs: Math.round(v * 1000) })}
        />
      </Group>

      <Group title="Collapsed pill" note="By default the pill shows only the time. While media plays: album art on the left, the time in the middle, bars on the right.">
        <Toggle
          label="Now playing"
          hint="Album art and bars while media plays. Click the art to play or pause."
          checked={g.indicators.media}
          onChange={(v) => set({ indicators: { ...g.indicators, media: v } })}
        />
        <Toggle
          label="Extended pill"
          hint="When nothing is playing: the AI tool you're using and its usage on the left, your quick action on the right."
          checked={g.extendedPill}
          onChange={(v) => set({ extendedPill: v })}
        />
      </Group>
    </>
  );
}
