import { useEffect, useState } from "react";

import { commands, type HookStatus } from "../../lib/ipc";
import { Group, NumberField, Row, Select, Toggle } from "../controls";
import styles from "../Settings.module.css";
import { section, useSettingsStore } from "../useSettings";

const POLL = [
  { value: "60", label: "Every minute" },
  { value: "120", label: "Every 2 minutes" },
  { value: "300", label: "Every 5 minutes" },
  { value: "600", label: "Every 10 minutes" },
];

export function CodeTab() {
  const settings = useSettingsStore((s) => s.settings);
  const update = useSettingsStore((s) => s.update);
  const [hooks, setHooks] = useState<HookStatus | null>(null);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = () => commands.codeHookStatus().then(setHooks, () => undefined);
  useEffect(() => {
    void refresh();
  }, []);

  if (!settings) return null;
  const c = settings.code;
  const set = (patch: Partial<typeof c>) => update(section("code", patch));

  const change = (connect: boolean) => {
    setWorking(true);
    setError(null);
    setMessage(null);
    (connect ? commands.codeConnect() : commands.codeDisconnect())
      .then((report) => {
        setHooks(report.status);
        const backup = report.backup ? ` Backup saved as ${report.backup}.` : "";
        setMessage((connect ? "Connected. New Claude Code sessions will report here." : "Disconnected. Only Overlid's hooks were removed.") + backup);
      })
      .catch((e: unknown) => setError(String(e)))
      .finally(() => setWorking(false));
  };

  const listening = hooks?.listeningPort;
  const mismatch = hooks?.installed && listening && hooks.port !== listening;

  return (
    <>
      <Group
        title="Claude Code sessions"
        note="Overlid adds HTTP hooks to Claude Code's settings.json so each session can report busy, waiting and done. Your file is backed up first, your own hooks are kept, and Disconnect removes only Overlid's entries. When Overlid isn't running the hooks fail quietly and Claude Code carries on."
      >
        <Row
          label={hooks?.installed ? "Connected" : hooks?.partial ? "Partly connected" : "Not connected"}
          hint={hooks?.settingsPath ?? undefined}
        >
          {hooks?.installed || hooks?.partial ? (
            <>
              {hooks.partial && (
                <button type="button" className={styles.button} disabled={working} onClick={() => change(true)}>
                  Repair
                </button>
              )}
              <button type="button" className={styles.button} disabled={working} onClick={() => change(false)}>
                Disconnect
              </button>
            </>
          ) : (
            <button type="button" className={styles.primaryButton} disabled={working || !listening} onClick={() => change(true)}>
              Connect Claude Code
            </button>
          )}
        </Row>
        <NumberField
          label="Listening port"
          hint={
            listening
              ? `Receiving on 127.0.0.1:${listening}.${mismatch ? " Hooks point at another port; Overlid updates them on start." : ""}`
              : "The receiver couldn't start. Try another port."
          }
          value={c.port}
          min={1024}
          max={65535}
          onChange={(v) => {
            set({ port: v });
            window.setTimeout(() => void refresh(), 800);
          }}
        />
      </Group>
      {message && <p className={`${styles.statusLine} ${styles.good}`}>{message}</p>}
      {error && <p className={`${styles.statusLine} ${styles.error}`}>{error}</p>}

      <Group
        title="Usage"
        note="Reads the sign-in Claude Code already saved on this PC, read-only, and asks Anthropic's usage endpoint for your 5-hour and 7-day limits. It's an unofficial endpoint, so the numbers are marked derived. Nothing else is sent anywhere."
      >
        <Toggle label="Show Claude usage" checked={c.enabled} onChange={(v) => set({ enabled: v })} />
        <Select
          label="Check"
          hint="Checks every minute while a session is busy."
          value={String(c.pollSecs)}
          options={POLL}
          onChange={(v) => set({ pollSecs: Number(v) })}
        />
        <NumberField label="Warning at" value={c.warnPct} min={1} max={100} unit="%" onChange={(v) => set({ warnPct: v })} />
        <NumberField label="Critical at" value={c.criticalPct} min={1} max={100} unit="%" onChange={(v) => set({ criticalPct: v })} />
      </Group>
    </>
  );
}
