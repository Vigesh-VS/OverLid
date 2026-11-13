import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { commands, on, type Script } from "../../lib/ipc";
import styles from "../Settings.module.css";

const AUTOSAVE_MS = 600;

export function ScriptsTab() {
  const [scripts, setScripts] = useState<Script[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Script | null>(null);
  const [query, setQuery] = useState("");
  const [saved, setSaved] = useState<"saved" | "saving" | "error">("saved");
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const dirty = useRef<Script | null>(null);

  const reload = useCallback(() => {
    commands.scriptsList().then(setScripts, (e: unknown) => setError(String(e)));
  }, []);

  useEffect(() => {
    reload();
    const unlisten = on("prompter://scripts", reload);
    return () => {
      void unlisten.then((off) => off());
    };
  }, [reload]);

  // Keep a selection and load the selected script into the editor.
  useEffect(() => {
    if (!selectedId && scripts[0]) setSelectedId(scripts[0].id);
  }, [scripts, selectedId]);

  useEffect(() => {
    if (dirty.current?.id === selectedId) return;
    setDraft(scripts.find((s) => s.id === selectedId) ?? null);
  }, [selectedId, scripts]);

  const flush = useCallback(() => {
    window.clearTimeout(timer.current);
    const pending = dirty.current;
    if (!pending) return;
    dirty.current = null;
    setSaved("saving");
    commands.scriptSave(pending).then(
      () => setSaved("saved"),
      (e: unknown) => {
        setSaved("error");
        setError(String(e));
      },
    );
  }, []);

  // Save on unmount / tab switch.
  useEffect(() => flush, [flush]);

  const edit = (patch: Partial<Script>) => {
    if (!draft) return;
    const next = { ...draft, ...patch };
    setDraft(next);
    dirty.current = next;
    setSaved("saving");
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(flush, AUTOSAVE_MS);
  };

  const pick = (id: string) => {
    flush();
    setSelectedId(id);
  };

  const create = () => {
    flush();
    commands.scriptCreate().then((s) => {
      setSelectedId(s.id);
      setDraft(s);
    }, (e: unknown) => setError(String(e)));
  };

  const importFile = () => {
    flush();
    commands.scriptImport().then((s) => s && setSelectedId(s.id), (e: unknown) => setError(String(e)));
  };

  const duplicate = () => {
    if (!draft) return;
    flush();
    commands.scriptDuplicate(draft.id).then((s) => setSelectedId(s.id), (e: unknown) => setError(String(e)));
  };

  const remove = () => {
    if (!draft) return;
    if (!window.confirm(`Delete “${draft.title}”? This can't be undone.`)) return;
    dirty.current = null;
    window.clearTimeout(timer.current);
    commands.scriptDelete(draft.id).then(() => {
      setSelectedId(null);
      setDraft(null);
    }, (e: unknown) => setError(String(e)));
  };

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return scripts;
    return scripts.filter((s) => s.title.toLowerCase().includes(q) || s.body.toLowerCase().includes(q));
  }, [scripts, query]);

  const sections = draft ? draft.body.split(/\r?\n/).filter((l) => l.trim().startsWith("## ")).length : 0;
  const words = draft ? draft.body.split(/\s+/).filter(Boolean).length : 0;

  return (
    <div className={styles.scripts}>
      <aside className={styles.scriptList}>
        <div className={styles.scriptTools}>
          <input
            className={styles.search}
            type="search"
            placeholder="Search scripts"
            aria-label="Search scripts"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div>
            <button type="button" className={styles.primaryButton} onClick={create}>
              New
            </button>
            <button type="button" className={styles.button} onClick={importFile}>
              Import
            </button>
          </div>
        </div>
        <div className={styles.scriptItems}>
          {visible.map((s) => (
            <button
              key={s.id}
              type="button"
              className={s.id === selectedId ? styles.scriptItemOn : styles.scriptItem}
              onClick={() => pick(s.id)}
            >
              <span className={styles.scriptItemTitle}>
                {s.favorite && <span className={styles.star}>★</span>}
                {s.id === draft?.id ? draft.title : s.title}
              </span>
              <span className={styles.scriptItemMeta}>
                Edited {new Date(s.updatedAt).toLocaleDateString(undefined, { day: "numeric", month: "short" })}
              </span>
            </button>
          ))}
          {visible.length === 0 && (
            <p className={styles.statusLine}>{scripts.length ? "No scripts match." : "No scripts yet."}</p>
          )}
        </div>
      </aside>

      <section className={styles.editor}>
        {error && <p className={styles.error}>{error}</p>}
        {draft ? (
          <>
            <div className={styles.editorBar}>
              <input
                className={styles.titleInput}
                aria-label="Script title"
                value={draft.title}
                onChange={(e) => edit({ title: e.target.value })}
              />
              <button
                type="button"
                className={styles.button}
                aria-pressed={draft.favorite}
                onClick={() => edit({ favorite: !draft.favorite })}
              >
                {draft.favorite ? "★ Favourite" : "☆ Favourite"}
              </button>
              <button type="button" className={styles.button} onClick={duplicate}>
                Duplicate
              </button>
              <button
                type="button"
                className={styles.button}
                onClick={() => {
                  flush();
                  void commands.scriptExport(draft.id);
                }}
              >
                Export
              </button>
              <button type="button" className={styles.dangerButton} onClick={remove}>
                Delete
              </button>
            </div>
            <textarea
              className={styles.body}
              aria-label="Script text"
              value={draft.body}
              placeholder={"## Intro\nWrite what you want to say. Start a line with ## to make a section you can jump to."}
              onChange={(e) => edit({ body: e.target.value })}
              onBlur={flush}
            />
            <div className={styles.editorFoot}>
              <span>
                {words} words · {sections} {sections === 1 ? "section" : "sections"} · about{" "}
                {Math.max(1, Math.round(words / 140))} min spoken
              </span>
              <span>{saved === "saving" ? "Saving…" : saved === "error" ? "Not saved" : "Saved"}</span>
            </div>
          </>
        ) : (
          <div className={styles.emptyEditor}>
            <p>Pick a script on the left, or start a new one.</p>
            <button type="button" className={styles.primaryButton} onClick={create}>
              New script
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
