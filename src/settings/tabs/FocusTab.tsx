import { useEffect, useState } from "react";

import { commands, type DayStats } from "../../lib/ipc";
import { Group, NumberField, Toggle } from "../controls";
import styles from "../Settings.module.css";
import { section, useSettingsStore } from "../useSettings";

function lastDays(n: number): string[] {
  const days: string[] = [];
  const d = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const day = new Date(d.getFullYear(), d.getMonth(), d.getDate() - i);
    const y = day.getFullYear();
    const m = String(day.getMonth() + 1).padStart(2, "0");
    const dd = String(day.getDate()).padStart(2, "0");
    days.push(`${y}-${m}-${dd}`);
  }
  return days;
}

export function FocusTab() {
  const settings = useSettingsStore((s) => s.settings);
  const update = useSettingsStore((s) => s.update);
  const [history, setHistory] = useState<Record<string, DayStats>>({});

  useEffect(() => {
    commands.pomoHistory().then(setHistory, () => undefined);
  }, []);

  if (!settings) return null;
  const f = settings.focus;
  const set = (patch: Partial<typeof f>) => update(section("focus", patch));

  const days = lastDays(7);
  const minutes = days.map((d) => history[d]?.minutes ?? 0);
  const peak = Math.max(25, ...minutes);
  const total = minutes.reduce((a, b) => a + b, 0);

  return (
    <>
      <Group title="Timer">
        <NumberField label="Focus length" value={f.focusMin} min={1} max={180} unit="min" onChange={(v) => set({ focusMin: v })} />
        <Toggle
          label="Show focus countdown in pill"
          hint="Shows the ring and time next to the clock while a timer is running."
          checked={f.showInPill}
          onChange={(v) => set({ showInPill: v })}
        />
      </Group>

      <Group title="Pomodoro breaks" note="Off: a simple focus timer. On: focus rounds alternate with short breaks, and a long break after a set number of rounds.">
        <Toggle label="Pomodoro breaks" checked={f.breaks} onChange={(v) => set({ breaks: v })} />
        {f.breaks && (
          <>
            <NumberField label="Short break" value={f.shortMin} min={1} max={60} unit="min" onChange={(v) => set({ shortMin: v })} />
            <NumberField label="Long break" value={f.longMin} min={1} max={120} unit="min" onChange={(v) => set({ longMin: v })} />
            <NumberField
              label="Long break after"
              value={f.longEvery}
              min={1}
              max={12}
              unit="rounds"
              onChange={(v) => set({ longEvery: v })}
            />
            <Toggle
              label="Start breaks automatically"
              hint="Focus rounds always wait for you."
              checked={f.autoStartBreaks}
              onChange={(v) => set({ autoStartBreaks: v })}
            />
          </>
        )}
      </Group>

      <Group title="Last 7 days" note={`${Math.round(total / 6) / 10} hours of focus this week.`}>
        <div className={styles.bars} role="img" aria-label={`Focus minutes for the last 7 days: ${minutes.join(", ")}`}>
          {days.map((d, i) => (
            <div key={d}>
              <span style={{ height: `${(minutes[i] / peak) * 100}%` }} />
              <small>{new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { weekday: "short" })}</small>
            </div>
          ))}
        </div>
      </Group>
    </>
  );
}
