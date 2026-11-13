import { useState } from "react";

import { commands, type Detection, type ProviderInfo } from "../lib/ipc";
import { ProviderIcon } from "./ProviderIcon";
import styles from "./ConnectFlow.module.css";

/**
 * "Connect" = find the provider CLI's existing sign-in and ask before using
 * it. If none is found, show the exact command to sign in. Overlid never
 * writes or refreshes anyone's tokens.
 */
export function useConnectFlow() {
  const [target, setTarget] = useState<ProviderInfo | null>(null);
  const [detection, setDetection] = useState<Detection | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const begin = (p: ProviderInfo) => {
    setTarget(p);
    setDetection(null);
    setError(null);
    if (!p.available) return;
    setBusy(true);
    commands
      .codeDetect(p.id)
      .then(setDetection, (e: unknown) => setError(String(e)))
      .finally(() => setBusy(false));
  };

  const confirm = () => {
    if (!target) return;
    setBusy(true);
    commands
      .codeConnectProvider(target.id)
      .then(() => setTarget(null), (e: unknown) => setError(String(e)))
      .finally(() => setBusy(false));
  };

  const cancel = () => setTarget(null);

  return { target, detection, busy, error, begin, confirm, cancel };
}

export function ConnectPrompt({ flow }: { flow: ReturnType<typeof useConnectFlow> }) {
  const { target, detection, busy, error, confirm, cancel, begin } = flow;
  if (!target) return null;
  const notAvailable = !target.available;
  return (
    <div className={styles.prompt} role="dialog" aria-label={`Connect ${target.name}`}>
      <ProviderIcon id={target.id} size={28} />
      <div className={styles.text}>
        {notAvailable ? (
          <>
            <strong>{target.name} is coming soon</strong>
            <span>There's no reliable source for its usage yet, so Overlid won't guess.</span>
          </>
        ) : busy && !detection ? (
          <strong>Looking for your {target.name} sign-in…</strong>
        ) : error ? (
          <>
            <strong>Couldn't connect {target.name}</strong>
            <span>{error}</span>
          </>
        ) : detection?.found ? (
          <>
            <strong>Use this sign-in?</strong>
            <span>
              {detection.detail ?? `${target.name} sign-in found.`} Overlid only reads it to fetch your usage.
            </span>
          </>
        ) : (
          <>
            <strong>Sign in to {target.name} first</strong>
            <span>
              {detection?.detail ? `${detection.detail} ` : ""}To sign in, {target.signInHint}. Then try again.
            </span>
          </>
        )}
      </div>
      <div className={styles.actions}>
        {detection?.found && !error && (
          <button type="button" className={styles.primary} disabled={busy} onClick={confirm}>
            Connect
          </button>
        )}
        {!notAvailable && !detection?.found && !busy && (
          <button type="button" className={styles.secondary} onClick={() => begin(target)}>
            Try again
          </button>
        )}
        <button type="button" className={styles.secondary} onClick={cancel}>
          {detection?.found ? "Cancel" : "Close"}
        </button>
      </div>
    </div>
  );
}
