import { useEffect, useState } from "react";

import { commands, on, type PrompterShortcuts } from "../../lib/ipc";
import { Group, Row, Select, Slider, TextField, Toggle } from "../controls";
import styles from "../Settings.module.css";
import { section, useSettingsStore } from "../useSettings";

const COLORS = [
  { value: "#FFFFFF", label: "White" },
  { value: "#4BE37A", label: "Matrix green" },
  { value: "#5CE1E6", label: "Cyan" },
  { value: "#FFB224", label: "Amber" },
];

const FONTS = [
  "Segoe UI Variable Display",
  "Segoe UI",
  "Arial",
  "Georgia",
  "Verdana",
  "Consolas",
  "Cascadia Code",
];

const SHORTCUT_LABELS: Record<keyof PrompterShortcuts, string> = {
  toggle: "Start / stop the prompter",
  playPause: "Play / pause",
  faster: "Faster",
  slower: "Slower",
  bigger: "Bigger text",
  smaller: "Smaller text",
  prevSection: "Previous section",
  nextSection: "Next section",
};

export function PrompterTab() {
  const settings = useSettingsStore((s) => s.settings);
  const update = useSettingsStore((s) => s.update);
  const [devices, setDevices] = useState<string[]>([]);

  useEffect(() => {
    commands.voiceDevices().then(setDevices, () => undefined);
  }, []);

  if (!settings) return null;
  const p = settings.prompter;
  const set = (patch: Partial<typeof p>) => update(section("prompter", patch));
  const custom = !COLORS.some((c) => c.value.toLowerCase() === p.color.toLowerCase());

  return (
    <>
      <Group title="Text">
        <Select
          label="Font"
          value={FONTS.includes(p.fontFamily) ? p.fontFamily : FONTS[0]}
          options={FONTS.map((f) => ({ value: f, label: f }))}
          onChange={(v) => set({ fontFamily: v })}
        />
        <Slider label="Size" value={p.fontSize} min={14} max={72} format={(v) => `${v} px`} onChange={(v) => set({ fontSize: v })} />
        <Slider
          label="Line height"
          value={p.lineHeight}
          min={1}
          max={2.2}
          step={0.05}
          format={(v) => v.toFixed(2)}
          onChange={(v) => set({ lineHeight: v })}
        />
        <Row label="Colour">
          <div className={styles.swatches} role="radiogroup" aria-label="Text colour">
            {COLORS.map((c) => (
              <button
                key={c.value}
                type="button"
                role="radio"
                aria-checked={c.value.toLowerCase() === p.color.toLowerCase()}
                aria-label={c.label}
                title={c.label}
                className={c.value.toLowerCase() === p.color.toLowerCase() ? styles.swatchOn : styles.swatch}
                style={{ background: c.value }}
                onClick={() => set({ color: c.value })}
              />
            ))}
            <input
              type="color"
              aria-label="Custom colour"
              title="Custom colour"
              value={custom ? p.color : "#ffffff"}
              onChange={(e) => set({ color: e.target.value.toUpperCase() })}
            />
          </div>
        </Row>
        <Toggle
          label="Mirror mode"
          hint="Flip the text for teleprompter glass."
          checked={p.mirror}
          onChange={(v) => set({ mirror: v })}
        />
      </Group>

      <Group title="Size and speed">
        <Slider label="Default speed" value={p.speed} min={5} max={400} format={(v) => `${Math.round(v)} px/s`} onChange={(v) => set({ speed: v })} />
        <Slider label="Width" value={p.width} min={320} max={760} step={10} format={(v) => `${v} px`} onChange={(v) => set({ width: v })} />
        <Slider label="Height" value={p.height} min={120} max={420} step={10} format={(v) => `${v} px`} onChange={(v) => set({ height: v })} />
      </Group>

      <Group
        title="Voice mode"
        note="The script moves only while you're talking. The microphone level is worked out in memory, and audio is never recorded, stored or sent anywhere."
      >
        <Toggle label="Scroll with my voice" checked={p.voice} onChange={(v) => set({ voice: v })} />
        <Select
          label="Microphone"
          value={p.micDevice ?? ""}
          options={[{ value: "", label: "Windows default" }, ...devices.map((d) => ({ value: d, label: d }))]}
          onChange={(v) => set({ micDevice: v || null })}
        />
        <Slider
          label="Sensitivity"
          hint="Lower picks up quieter speech. Raise it if background noise moves the script."
          value={Math.round(p.voiceThreshold * 100)}
          min={0}
          max={100}
          format={(v) => `${v}`}
          onChange={(v) => set({ voiceThreshold: v / 100 })}
        />
        <MicTest device={p.micDevice} threshold={p.voiceThreshold} />
      </Group>

      <Group
        title="Shortcuts"
        note="Work from any app. Only the start/stop shortcut is active when you're not presenting. Use names like Ctrl+Alt+P, Ctrl+Shift+ArrowUp or Alt+Equal."
      >
        {(Object.keys(SHORTCUT_LABELS) as Array<keyof PrompterShortcuts>).map((key) => (
          <TextField
            key={key}
            label={SHORTCUT_LABELS[key]}
            value={p.shortcuts[key]}
            onChange={(v) => set({ shortcuts: { ...p.shortcuts, [key]: v } })}
          />
        ))}
      </Group>
    </>
  );
}

function MicTest({ device, threshold }: { device: string | null; threshold: number }) {
  const [testing, setTesting] = useState(false);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!testing) return;
    setError(null);
    const offLevel = on("voice://level", setLevel);
    const offError = on("voice://error", (e) => {
      setError(e);
      setTesting(false);
    });
    void commands.voiceStart(device);
    return () => {
      void commands.voiceStop();
      void offLevel.then((f) => f());
      void offError.then((f) => f());
      setLevel(0);
    };
  }, [testing, device]);

  return (
    <Row
      label="Test microphone"
      hint={error ?? (testing ? "Talk normally. The bar should pass the amber mark only while you speak." : undefined)}
    >
      {testing && (
        <div className={styles.meter} aria-hidden="true">
          <span style={{ width: `${Math.round(level * 100)}%` }} />
          <i style={{ left: `${Math.round(threshold * 100)}%` }} />
        </div>
      )}
      <button type="button" className={styles.button} onClick={() => setTesting((t) => !t)}>
        {testing ? "Stop" : "Test"}
      </button>
    </Row>
  );
}
