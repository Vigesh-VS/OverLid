import { useEffect, useState } from "react";

import { QUICK_ICONS, QuickIcon } from "../../components/quickIcons";
import { commands, type AppIcon, type QuickAction, type QuickKind, type RunningApp, type Script } from "../../lib/ipc";
import { Choice, Group, Row, Select, TextField } from "../controls";
import styles from "../Settings.module.css";
import { useSettingsStore } from "../useSettings";

const KINDS: ReadonlyArray<{ value: QuickKind; label: string }> = [
  { value: "launch", label: "Open an app" },
  { value: "url", label: "Open a link or folder" },
  { value: "pomodoro", label: "Start focus" },
  { value: "prompter", label: "Start prompter" },
  { value: "media", label: "Play / pause" },
  { value: "none", label: "Off" },
];

const DEFAULT_ICON: Record<QuickKind, string> = {
  launch: "app",
  url: "globe",
  pomodoro: "timer",
  prompter: "prompter",
  media: "play",
  none: "bolt",
};

const DEFAULT_TOOLTIP: Record<QuickKind, string> = {
  launch: "Open app",
  url: "Open link",
  pomodoro: "Start focus timer",
  prompter: "Start the prompter",
  media: "Play / pause",
  none: "",
};

/** RGBA from Rust → PNG data URL. */
function iconToDataUrl(icon: AppIcon): string | null {
  const canvas = document.createElement("canvas");
  canvas.width = icon.width;
  canvas.height = icon.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const bytes = Uint8ClampedArray.from(atob(icon.rgba), (c) => c.charCodeAt(0));
  ctx.putImageData(new ImageData(bytes, icon.width, icon.height), 0, 0);
  return canvas.toDataURL("image/png");
}

const appName = (path: string) => path.split(/[\\/]/).pop()?.replace(/\.exe$/i, "") ?? path;

export function QuickActionTab() {
  const settings = useSettingsStore((s) => s.settings);
  const update = useSettingsStore((s) => s.update);
  const [running, setRunning] = useState<RunningApp[]>([]);
  const [scripts, setScripts] = useState<Script[]>([]);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    commands.listRunningApps().then(setRunning, () => undefined);
    commands.scriptsList().then(setScripts, () => undefined);
  }, []);

  if (!settings) return null;
  const qa = settings.quickAction;
  const set = (patch: Partial<QuickAction>) => update((s) => ({ ...s, quickAction: { ...s.quickAction, ...patch } }));

  const chooseApp = async (path: string) => {
    const icon = await commands.appIcon(path).then(iconToDataUrl, () => null);
    set({ payload: path, icon: icon ? "app" : "bolt", iconData: icon, tooltip: `Open ${appName(path)}` });
  };

  const test = () => {
    setStatus(null);
    commands.quickActionRun().then(
      () => setStatus("Done."),
      (e: unknown) => setStatus(String(e)),
    );
  };

  return (
    <>
      <Group title="Quick action" note="A button at the right end of the collapsed pill. Choose what it does.">
        <Choice
          label="When clicked"
          value={qa.kind}
          options={KINDS}
          onChange={(kind) =>
            set({ kind, icon: DEFAULT_ICON[kind], tooltip: DEFAULT_TOOLTIP[kind], payload: "", iconData: null })
          }
        />

        {qa.kind === "launch" && (
          <>
            <Row label="App" hint={qa.payload || "No app chosen yet."}>
              {qa.iconData && <img src={qa.iconData} alt="" width={24} height={24} />}
              <button
                type="button"
                className={styles.button}
                onClick={() => commands.pickExe().then((p) => p && void chooseApp(p), () => undefined)}
              >
                Browse…
              </button>
            </Row>
            {running.length > 0 && (
              <Select
                label="Or pick a running app"
                value=""
                options={[{ value: "", label: "Choose…" }, ...running.map((r) => ({ value: r.path, label: r.name }))]}
                onChange={(p) => p && void chooseApp(p)}
              />
            )}
          </>
        )}

        {qa.kind === "url" && (
          <>
            <TextField
              label="Link or folder"
              hint="A web address (https://…) or a folder path."
              value={qa.payload}
              placeholder="https://"
              onChange={(v) => set({ payload: v })}
            />
            <Row label="Folder">
              <button
                type="button"
                className={styles.button}
                onClick={() =>
                  commands.pickFolder().then((p) => p && set({ payload: p, icon: "folder", tooltip: `Open ${appName(p)}` }), () => undefined)
                }
              >
                Choose folder…
              </button>
            </Row>
          </>
        )}

        {qa.kind === "prompter" && (
          <Select
            label="Script"
            value={qa.payload}
            options={[{ value: "", label: "The selected script" }, ...scripts.map((s) => ({ value: s.id, label: s.title }))]}
            onChange={(v) => set({ payload: v })}
          />
        )}

        {qa.kind !== "none" && (
          <>
            <Row label="Icon">
              <div className={styles.iconPicker} role="radiogroup" aria-label="Icon">
                {qa.kind === "launch" && qa.iconData && (
                  <button
                    type="button"
                    role="radio"
                    aria-checked={qa.icon === "app"}
                    aria-label="App icon"
                    className={qa.icon === "app" ? styles.iconOn : styles.iconChoice}
                    onClick={() => set({ icon: "app" })}
                  >
                    <img src={qa.iconData} alt="" width={16} height={16} />
                  </button>
                )}
                {QUICK_ICONS.map((name) => (
                  <button
                    key={name}
                    type="button"
                    role="radio"
                    aria-checked={qa.icon === name}
                    aria-label={name}
                    title={name}
                    className={qa.icon === name ? styles.iconOn : styles.iconChoice}
                    onClick={() => set({ icon: name })}
                  >
                    <QuickIcon name={name} size={16} />
                  </button>
                ))}
              </div>
            </Row>
            <TextField label="Tooltip" value={qa.tooltip} onChange={(v) => set({ tooltip: v })} />
            <Row label="Try it" hint={status ?? undefined}>
              <button type="button" className={styles.button} onClick={test}>
                Run now
              </button>
            </Row>
          </>
        )}
      </Group>
    </>
  );
}
