import { useEffect, useRef, useState } from "react";

import { AmbientLayer, safeOpacity } from "../../components/AmbientLayer";
import {
  commands,
  on,
  type AmbientSettings,
  type AmbientSource,
  type AmbientSpeed,
  type PrompterShortcuts,
  type TimingMode,
  type VoiceStatus,
} from "../../lib/ipc";
import { Choice, Group, Row, Select, Slider, TextField, Toggle } from "../controls";
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

const TIMING: ReadonlyArray<{ value: TimingMode; label: string }> = [
  { value: "speed", label: "Speed" },
  { value: "lines", label: "Lines per minute" },
  { value: "duration", label: "Finish in" },
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

const CALIBRATE_MS = 3000;

const AMBIENT_SOURCES: ReadonlyArray<{ value: AmbientSource; label: string }> = [
  { value: "screen", label: "Live screen colour" },
  { value: "wallpaper", label: "Wallpaper" },
  { value: "album", label: "Album art" },
  { value: "custom", label: "Custom" },
];

const AMBIENT_SPEEDS: ReadonlyArray<{ value: AmbientSpeed; label: string }> = [
  { value: "static", label: "Still" },
  { value: "slow", label: "Slow" },
  { value: "medium", label: "Medium" },
];

const toDb = (level: number) => Math.round(level * 60 - 60);

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
      <Group title="Text" note="Text size is separate from the prompter's size. Text always wraps to fit the width.">
        <Select
          label="Font"
          value={FONTS.includes(p.fontFamily) ? p.fontFamily : FONTS[0]}
          options={FONTS.map((f) => ({ value: f, label: f }))}
          onChange={(v) => set({ fontFamily: v })}
        />
        <Slider label="Size" value={p.fontSize} min={14} max={72} format={(v) => `${v} px`} onChange={(v) => set({ fontSize: v })} />
        <Toggle
          label="Auto-fit"
          hint="Scale the text with the prompter's width. Off keeps your size fixed."
          checked={p.autoFit}
          onChange={(v) => set({ autoFit: v })}
        />
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
        <Toggle label="Mirror mode" hint="Flip the text for teleprompter glass." checked={p.mirror} onChange={(v) => set({ mirror: v })} />
      </Group>

      <Group title="Area" note="You can also drag the prompter's left, right and bottom edges while presenting.">
        <Slider label="Width" value={p.width} min={320} max={760} step={10} format={(v) => `${v} px`} onChange={(v) => set({ width: v })} />
        <Slider label="Height" value={p.height} min={120} max={420} step={10} format={(v) => `${v} px`} onChange={(v) => set({ height: v })} />
      </Group>

      <Group title="Auto-scroll timing" note="Ctrl+Alt+Up and Down still adjust the pace while you present.">
        <Choice label="Pace by" value={p.timingMode} options={TIMING} onChange={(v) => set({ timingMode: v })} />
        {p.timingMode === "speed" && (
          <Slider label="Speed" value={p.speed} min={5} max={400} format={(v) => `${Math.round(v)} px/s`} onChange={(v) => set({ speed: v })} />
        )}
        {p.timingMode === "lines" && (
          <Slider
            label="Lines per minute"
            value={p.linesPerMinute}
            min={2}
            max={200}
            format={(v) => `${Math.round(v)} lines`}
            onChange={(v) => set({ linesPerMinute: v })}
          />
        )}
        {p.timingMode === "duration" && (
          <Slider
            label="Finish the script in"
            hint="Overlid works out the speed from the script's length."
            value={p.durationMin}
            min={0.5}
            max={60}
            step={0.5}
            format={(v) => `${v} min`}
            onChange={(v) => set({ durationMin: v })}
          />
        )}
      </Group>

      <Group
        title="Voice mode"
        note="The script moves only while you're talking, then eases to a stop. Auto-scroll is off while voice mode is on. The microphone level is worked out in memory, and audio is never recorded, stored or sent anywhere."
      >
        <Toggle label="Scroll with my voice" checked={p.voice} onChange={(v) => set({ voice: v })} />
        <Select
          label="Microphone"
          value={p.micDevice ?? ""}
          options={[{ value: "", label: "Windows default" }, ...devices.map((d) => ({ value: d, label: d }))]}
          onChange={(v) => set({ micDevice: v || null })}
        />
        <Slider
          label="Threshold"
          hint="Speech must be louder than this. Calibrate sets it for you."
          value={Math.round(p.voiceThreshold * 100)}
          min={0}
          max={100}
          format={(v) => `${toDb(v / 100)} dB`}
          onChange={(v) => set({ voiceThreshold: v / 100 })}
        />
        <MicMeter
          device={p.micDevice}
          threshold={p.voiceThreshold}
          onCalibrated={(t) => set({ voiceThreshold: t })}
        />
      </Group>

      <AmbientGroup ambient={p.ambient} textColor={p.color} onChange={(ambient) => set({ ambient })} />

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

/** Live level meter plus a 3-second silence calibration. */
function MicMeter({
  device,
  threshold,
  onCalibrated,
}: {
  device: string | null;
  threshold: number;
  onCalibrated: (threshold: number) => void;
}) {
  const [active, setActive] = useState(false);
  const [level, setLevel] = useState(0);
  const [status, setStatus] = useState<VoiceStatus | null>(null);
  const [calibrating, setCalibrating] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const samples = useRef<number[] | null>(null);

  useEffect(() => {
    commands.voicePrivacy().then((reason) => reason && setResult(reason), () => undefined);
  }, []);

  useEffect(() => {
    if (!active) return;
    const offLevel = on("voice://level", (v) => {
      if (v.owner !== "settings") return;
      setLevel(v.level);
      samples.current?.push(v.level);
    });
    const offStatus = on("voice://status", (s) => s.owner === "settings" && setStatus(s));
    void commands.voiceStart("settings", device);
    return () => {
      void commands.voiceStop("settings");
      void offLevel.then((f) => f());
      void offStatus.then((f) => f());
      setLevel(0);
      setStatus(null);
    };
  }, [active, device]);

  const calibrate = () => {
    setResult(null);
    setActive(true);
    setCalibrating(true);
    // Let the stream warm up, then record 3 s of room noise.
    window.setTimeout(() => {
      samples.current = [];
      window.setTimeout(() => {
        const got = samples.current ?? [];
        samples.current = null;
        setCalibrating(false);
        if (got.length < 20 || got.every((v) => v === 0)) {
          setResult("Couldn't hear the microphone. Check it isn't muted or blocked, then try again.");
          return;
        }
        // 95th percentile of the noise, plus headroom so breathing and clicks don't count.
        const sorted = [...got].sort((a, b) => a - b);
        const floor = sorted[Math.floor(sorted.length * 0.95)];
        const next = Math.min(0.9, Math.max(0.15, floor + 0.12));
        onCalibrated(Math.round(next * 100) / 100);
        setResult(`Room noise is about ${toDb(floor)} dB. Threshold set to ${toDb(next)} dB.`);
      }, CALIBRATE_MS);
    }, 1600);
  };

  const problem =
    status && (status.state === "blocked" || status.state === "silent" || status.state === "error") ? status.message : null;

  return (
    <Row
      label="Microphone level"
      hint={
        problem ??
        (calibrating
          ? "Stay quiet for 3 seconds…"
          : (result ?? (active ? `Talk normally. The bar should pass the amber mark only while you speak.` : undefined)))
      }
    >
      {active && (
        <div className={styles.meter} aria-hidden="true">
          <span style={{ width: `${Math.round(level * 100)}%`, background: level > threshold ? "var(--ol-green)" : "var(--ol-text-3)" }} />
          <i style={{ left: `${Math.round(threshold * 100)}%` }} />
        </div>
      )}
      <button type="button" className={styles.button} disabled={calibrating} onClick={calibrate}>
        Calibrate
      </button>
      <button type="button" className={styles.button} disabled={calibrating} onClick={() => setActive((a) => !a)}>
        {active ? "Stop" : "Test"}
      </button>
    </Row>
  );
}

function AmbientGroup({
  ambient,
  textColor,
  onChange,
}: {
  ambient: AmbientSettings;
  textColor: string;
  onChange: (a: AmbientSettings) => void;
}) {
  const set = (patch: Partial<AmbientSettings>) => onChange({ ...ambient, ...patch });
  const previewColors =
    ambient.source === "custom" ? ambient.colors : ambient.source === "screen" ? ["#3b5bdb", "#7048e8"] : ["#c2410c"];
  const effective = Math.round(safeOpacity(ambient.intensity, previewColors, textColor) * 100);

  return (
    <Group
      title="Ambient background"
      note="An optional, very subtle glow behind the text while you present. The text itself never changes, and its contrast always stays at 7:1 or better."
    >
      <Toggle label="Show ambient glow" checked={ambient.enabled} onChange={(v) => set({ enabled: v })} />
      <Choice
        label="Colour from"
        hint={
          ambient.source === "screen"
            ? "Sampled about once a second from a tiny copy of your screen, only while presenting. Kept in memory, never saved or sent."
            : ambient.source === "album"
              ? "Follows the now-playing album art."
              : undefined
        }
        value={ambient.source}
        options={AMBIENT_SOURCES}
        onChange={(v) => set({ source: v })}
      />
      {ambient.source === "custom" && (
        <Row label="Colours" hint="Up to three.">
          <div className={styles.swatches}>
            {ambient.colors.map((c, i) => (
              <input
                key={i}
                type="color"
                aria-label={`Colour ${i + 1}`}
                value={c}
                onChange={(e) => set({ colors: ambient.colors.map((x, j) => (j === i ? e.target.value.toUpperCase() : x)) })}
              />
            ))}
            {ambient.colors.length < 3 && (
              <button type="button" className={styles.button} onClick={() => set({ colors: [...ambient.colors, "#7048E8"] })}>
                Add
              </button>
            )}
            {ambient.colors.length > 1 && (
              <button type="button" className={styles.button} onClick={() => set({ colors: ambient.colors.slice(0, -1) })}>
                Remove
              </button>
            )}
          </div>
        </Row>
      )}
      <Slider
        label="Intensity"
        hint={effective < Math.round(ambient.intensity * 100) ? `Capped at ${effective} % to keep the text readable.` : undefined}
        value={Math.round(ambient.intensity * 100)}
        min={5}
        max={50}
        format={(v) => `${v} %`}
        onChange={(v) => set({ intensity: v / 100 })}
      />
      <Slider label="Blur" value={ambient.blur} min={0} max={160} step={5} format={(v) => `${v} px`} onChange={(v) => set({ blur: v })} />
      <Choice label="Animation" value={ambient.speed} options={AMBIENT_SPEEDS} onChange={(v) => set({ speed: v })} />
      <Row label="Preview" hint={ambient.source === "screen" ? "Preview uses sample colours; live colour is only read while presenting." : undefined}>
        <div className={styles.ambientPreview}>
          <AmbientLayer settings={{ ...ambient, enabled: true }} colors={previewColors} textColor={textColor} />
          <span style={{ color: textColor }}>Your script reads like this.</span>
        </div>
      </Row>
    </Group>
  );
}
