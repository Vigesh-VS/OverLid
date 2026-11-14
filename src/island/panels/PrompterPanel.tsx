import { useRef, useState, type DragEvent } from "react";

import { ImportPreview } from "../../components/ImportPreview";
import { IMPORT_ACCEPT, ImportError, droppedFile, importFile, type ImportedScript } from "../../lib/importScript";
import { commands, run, type Settings } from "../../lib/ipc";
import { usePrompter } from "../../stores/prompter";
import { useSystem } from "../../stores/system";
import styles from "./PrompterPanel.module.css";

export function PrompterPanel() {
  const scripts = usePrompter((s) => s.scripts);
  const selectedId = usePrompter((s) => s.selectedId);
  const select = usePrompter((s) => s.select);
  const start = usePrompter((s) => s.start);
  const settings = useSystem((s) => s.settings);
  const voice = settings?.prompter.voice ?? false;
  const toggleKey = settings?.prompter.shortcuts.toggle ?? "Ctrl+Alt+P";
  const fileInput = useRef<HTMLInputElement>(null);
  const [imported, setImported] = useState<ImportedScript | null>(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const setVoice = (on: boolean) => {
    if (!settings) return;
    run(commands.settingsSet({ ...settings, prompter: { ...settings.prompter, voice: on } }), "settings_set");
  };

  const load = (file: File | null) => {
    if (!file) return;
    setImportError(null);
    setImporting(true);
    importFile(file)
      .then(setImported, (e: unknown) => setImportError(e instanceof ImportError ? e.message : "That file couldn't be imported."))
      .finally(() => setImporting(false));
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    load(droppedFile(e));
  };

  if (imported) {
    return (
      <ImportPreview
        imported={imported}
        settings={settings}
        onCancel={() => setImported(null)}
        onSaved={(script) => {
          setImported(null);
          select(script.id);
        }}
      />
    );
  }

  return (
    <div
      className={dragOver ? `${styles.panel} ${styles.dragOver}` : styles.panel}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
    >
      <div className={styles.list}>
        <div className={styles.listHead}>
          <span className={styles.heading}>Scripts</span>
          <button type="button" className={styles.importButton} disabled={importing} onClick={() => fileInput.current?.click()}>
            {importing ? "Importing…" : "Import file"}
          </button>
          <input
            ref={fileInput}
            type="file"
            accept={IMPORT_ACCEPT}
            hidden
            onChange={(e) => {
              load(e.target.files?.[0] ?? null);
              e.target.value = "";
            }}
          />
        </div>
        {importError && (
          <p className={styles.importError} role="alert">
            {importError}
          </p>
        )}
        {scripts.length === 0 ? (
          <div className={styles.empty}>
            <span className={styles.emptyTitle}>No scripts yet</span>
            <span className={styles.emptyHint}>Drop a .txt, .md, .docx or .pdf here, or write one in Settings.</span>
            <button
              type="button"
              className={styles.openSettings}
              onClick={() => run(commands.openSettings(), "open_settings_window")}
            >
              Open Settings
            </button>
          </div>
        ) : (
          <div className={styles.rows} role="listbox" aria-label="Scripts">
            {scripts.map((s) => (
              <button
                key={s.id}
                type="button"
                role="option"
                aria-selected={s.id === selectedId}
                className={s.id === selectedId ? `${styles.row} ${styles.selected}` : styles.row}
                onClick={() => select(s.id)}
                onDoubleClick={() => start(s)}
              >
                <span className={styles.rowTitle}>
                  {s.favorite && <span className={styles.star} aria-label="Favourite">★</span>}
                  {s.title}
                </span>
                <span className={styles.preview}>{preview(s.body)}</span>
              </button>
            ))}
          </div>
        )}
        {dragOver && <div className={styles.dropHint}>Drop to import</div>}
      </div>

      <div className={styles.side}>
        <button
          type="button"
          className={styles.start}
          disabled={scripts.length === 0}
          onClick={() => start()}
        >
          Start presenting
        </button>
        <span className={styles.hint}>
          3-2-1, then the script scrolls out of the notch. {toggleKey} starts and stops it from anywhere.
        </span>

        <label className={styles.toggle}>
          <input type="checkbox" checked={voice} onChange={(e) => setVoice(e.target.checked)} />
          <span>
            <strong>Voice mode</strong>
            <span>Scrolls only while you talk. Mic audio is never recorded, stored or sent.</span>
          </span>
        </label>

        <div className={styles.before}>
          {settings?.general.hideFromCapture === "never" ? (
            <span className={styles.exposed}>Visible in screen share. Change it in Settings › General.</span>
          ) : (
            <span className={styles.privacy}>Hidden from screen share and recordings while presenting.</span>
          )}
          <span className={styles.pace}>
            {pace(settings)} · {settings?.prompter.fontSize ?? 28} px text · {settings?.prompter.width ?? 560} × {settings?.prompter.height ?? 200}
          </span>
        </div>
      </div>
    </div>
  );
}

function pace(settings: Settings | null): string {
  const p = settings?.prompter;
  if (!p) return "60 px/s";
  if (p.voice) return "Voice mode";
  if (p.timingMode === "lines") return `${Math.round(p.linesPerMinute)} lines/min`;
  if (p.timingMode === "duration") return `Finish in ${p.durationMin} min`;
  return `${Math.round(p.speed)} px/s`;
}

function preview(body: string): string {
  const line = body
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l && !l.startsWith("## "));
  return line ?? "Empty script";
}
