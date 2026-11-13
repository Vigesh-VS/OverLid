import { useEffect, useState } from "react";

import { ConnectPrompt, useConnectFlow } from "../../components/ConnectFlow";
import { ProviderIcon } from "../../components/ProviderIcon";
import { commands, on, type HookStatus, type ProviderInfo } from "../../lib/ipc";
import { Choice, Group, NumberField, Row, Select, Toggle } from "../controls";
import styles from "../Settings.module.css";
import { section, useSettingsStore } from "../useSettings";

const POLL = [
  { value: "60", label: "Every minute" },
  { value: "120", label: "Every 2 minutes" },
  { value: "300", label: "Every 5 minutes" },
  { value: "600", label: "Every 10 minutes" },
];

const CHIME = [
  { value: "off", label: "Off" },
  { value: "once", label: "Once" },
  { value: "every2Min", label: "Every 2 min" },
] as const;

export function CodeTab() {
  const settings = useSettingsStore((s) => s.settings);
  const update = useSettingsStore((s) => s.update);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [hooks, setHooks] = useState<HookStatus | null>(null);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const flow = useConnectFlow();

  const reload = () => {
    commands.codeProviders().then(setProviders, () => undefined);
    commands.codeHookStatus().then(setHooks, () => undefined);
  };
  useEffect(() => {
    reload();
    const off = on("settings://changed", reload);
    return () => {
      void off.then((f) => f());
    };
  }, []);

  if (!settings) return null;
  const c = settings.code;
  const set = (patch: Partial<typeof c>) => update(section("code", patch));
  const order = c.connected;
  const sorted = [...providers].sort((a, b) => {
    const ia = order.indexOf(a.id);
    const ib = order.indexOf(b.id);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });

  const changeHooks = (connect: boolean) => {
    setWorking(true);
    setError(null);
    setMessage(null);
    (connect ? commands.codeConnect() : commands.codeDisconnect())
      .then((report) => {
        setHooks(report.status);
        const backup = report.backup ? ` Backup saved as ${report.backup}.` : "";
        setMessage(
          (connect ? "Connected. New Claude Code sessions will report here." : "Disconnected. Only Overlid's hooks were removed.") +
            backup,
        );
      })
      .catch((e: unknown) => setError(String(e)))
      .finally(() => setWorking(false));
  };
  const listening = hooks?.listeningPort;

  return (
    <>
      <Group
        title="AI tools"
        note="Usage only shows for tools you connect. Connecting uses the sign-in that tool's own CLI already saved on this PC, read-only. Overlid never writes or refreshes tokens, and sends each one only to that tool's usage endpoint. These endpoints are unofficial, so numbers are marked derived."
      >
        {sorted.map((p) => {
          const index = order.indexOf(p.id);
          return (
            <Row
              key={p.id}
              label={p.name}
              hint={
                !p.available
                  ? "Coming soon: there's no reliable usage source yet."
                  : p.connected
                    ? index === 0
                      ? "Connected · primary (shown in the pill)"
                      : "Connected"
                    : `Not connected. To sign in, ${p.signInHint}.`
              }
            >
              <ProviderIcon id={p.id} size={24} muted={!p.available} />
              {p.connected ? (
                <>
                  {index > 0 && (
                    <button type="button" className={styles.button} onClick={() => void commands.codeSetPrimary(p.id)}>
                      Make primary
                    </button>
                  )}
                  <button type="button" className={styles.button} onClick={() => void commands.codeDisconnectProvider(p.id)}>
                    Disconnect
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className={p.available ? styles.primaryButton : styles.button}
                  disabled={!p.available}
                  onClick={() => flow.begin(p)}
                >
                  {p.available ? "Connect" : "Coming soon"}
                </button>
              )}
            </Row>
          );
        })}
      </Group>
      {flow.target && (
        <div className={styles.group}>
          <ConnectPrompt flow={flow} />
        </div>
      )}

      <Group
        title="Claude Code live sessions"
        note="Overlid adds HTTP hooks to Claude Code's settings.json so each session can report busy, waiting and done. Your file is backed up first, your own hooks are kept, and Disconnect removes only Overlid's entries. When Overlid isn't running the hooks fail quietly and Claude Code carries on."
      >
        <Row
          label={hooks?.installed ? "Connected" : hooks?.partial ? "Partly connected" : "Not connected"}
          hint={hooks?.settingsPath ?? undefined}
        >
          {hooks?.installed || hooks?.partial ? (
            <>
              {hooks.partial && (
                <button type="button" className={styles.button} disabled={working} onClick={() => changeHooks(true)}>
                  Repair
                </button>
              )}
              <button type="button" className={styles.button} disabled={working} onClick={() => changeHooks(false)}>
                Disconnect
              </button>
            </>
          ) : (
            <button
              type="button"
              className={styles.primaryButton}
              disabled={working || !listening}
              onClick={() => changeHooks(true)}
            >
              Connect live sessions
            </button>
          )}
        </Row>
        <Choice
          label="Chime when a session needs you"
          hint="The bell in the pill stays until the session continues or you click it."
          value={c.waitingChime}
          options={CHIME}
          onChange={(v) => set({ waitingChime: v })}
        />
        <NumberField
          label="Listening port"
          hint={listening ? `Receiving on 127.0.0.1:${listening}.` : "The receiver couldn't start. Try another port."}
          value={c.port}
          min={1024}
          max={65535}
          onChange={(v) => {
            set({ port: v });
            window.setTimeout(reload, 800);
          }}
        />
      </Group>
      {message && <p className={`${styles.statusLine} ${styles.good}`}>{message}</p>}
      {error && <p className={`${styles.statusLine} ${styles.error}`}>{error}</p>}

      <Group title="Usage checks">
        <Toggle label="Check usage" checked={c.enabled} onChange={(v) => set({ enabled: v })} />
        <Select
          label="How often"
          hint="Claude is checked every minute while a session is busy."
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
