import { useState } from "react";

import { commands, type Script, type Settings } from "../lib/ipc";
import type { ImportedScript } from "../lib/importScript";
import styles from "./ImportPreview.module.css";

/**
 * After importing: title, auto-scroll or voice, speed, then Start (or just
 * save). The result is a normal, editable script.
 */
export function ImportPreview({
  imported,
  settings,
  onCancel,
  onSaved,
}: {
  imported: ImportedScript;
  settings: Settings | null;
  onCancel: () => void;
  onSaved: (script: Script, started: boolean) => void;
}) {
  const [title, setTitle] = useState(imported.title);
  const [voice, setVoice] = useState(settings?.prompter.voice ?? false);
  const [speed, setSpeed] = useState(settings?.prompter.speed ?? 60);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sections = imported.body.split("\n").filter((l) => l.startsWith("## ")).length;
  const words = imported.body.split(/\s+/).filter(Boolean).length;

  const save = async (start: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const created = await commands.scriptCreate(title.trim() || imported.title);
      const script = await commands.scriptSave({ ...created, body: imported.body });
      if (settings && (settings.prompter.voice !== voice || settings.prompter.speed !== speed)) {
        await commands.settingsSet({
          ...settings,
          prompter: { ...settings.prompter, voice, speed, timingMode: voice ? settings.prompter.timingMode : "speed" },
        });
      }
      if (start) await commands.prompterStart(script.id);
      onSaved(script, start);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.preview} role="dialog" aria-label="Import preview">
      <label className={styles.field}>
        <span>Title</span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} spellCheck={false} />
      </label>

      <p className={styles.summary}>
        {words} words · {sections} {sections === 1 ? "section" : "sections"} · about {Math.max(1, Math.round(words / 140))} min spoken
      </p>
      <p className={styles.excerpt}>{imported.body.slice(0, 220)}{imported.body.length > 220 ? "…" : ""}</p>
      {imported.notes.map((n) => (
        <p key={n} className={styles.note}>
          {n}
        </p>
      ))}

      <div className={styles.mode} role="radiogroup" aria-label="Scrolling">
        <button type="button" role="radio" aria-checked={!voice} className={!voice ? styles.on : styles.off} onClick={() => setVoice(false)}>
          Auto-scroll
        </button>
        <button type="button" role="radio" aria-checked={voice} className={voice ? styles.on : styles.off} onClick={() => setVoice(true)}>
          Voice mode
        </button>
      </div>
      {!voice && (
        <label className={styles.field}>
          <span>Speed · {Math.round(speed)} px/s</span>
          <input type="range" min={5} max={400} value={speed} onChange={(e) => setSpeed(Number(e.target.value))} />
        </label>
      )}

      {error && <p className={styles.error}>{error}</p>}
      <div className={styles.actions}>
        <button type="button" className={styles.primary} disabled={busy} onClick={() => void save(true)}>
          Start
        </button>
        <button type="button" className={styles.secondary} disabled={busy} onClick={() => void save(false)}>
          Save only
        </button>
        <button type="button" className={styles.secondary} disabled={busy} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
