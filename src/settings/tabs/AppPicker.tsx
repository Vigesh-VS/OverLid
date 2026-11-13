import { useEffect, useMemo, useState } from "react";

import { commands, type AppIcon, type InstalledApp } from "../../lib/ipc";
import styles from "../Settings.module.css";

const VISIBLE = 40;
const iconCache = new Map<string, string | null>();

/** Searchable list of installed apps (Start menu) with their real icons. */
export function AppPicker({
  apps,
  selected,
  onPick,
  toDataUrl,
}: {
  apps: InstalledApp[] | null;
  selected: string;
  onPick: (path: string) => void;
  toDataUrl: (icon: AppIcon) => string | null;
}) {
  const [query, setQuery] = useState("");
  const [, setLoaded] = useState(0);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = apps ?? [];
    return (q ? list.filter((a) => a.name.toLowerCase().includes(q)) : list).slice(0, VISIBLE);
  }, [apps, query]);

  // Load icons for what's on screen only.
  useEffect(() => {
    let cancelled = false;
    for (const app of shown) {
      if (iconCache.has(app.path)) continue;
      iconCache.set(app.path, null);
      commands.appIcon(app.path).then(
        (icon) => {
          iconCache.set(app.path, toDataUrl(icon));
          if (!cancelled) setLoaded((n) => n + 1);
        },
        () => undefined,
      );
    }
    return () => {
      cancelled = true;
    };
  }, [shown, toDataUrl]);

  return (
    <div className={styles.appPicker}>
      <input
        className={styles.search}
        type="search"
        placeholder={apps === null ? "Finding installed apps…" : `Search ${apps.length} installed apps`}
        aria-label="Search installed apps"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className={styles.appList} role="listbox" aria-label="Installed apps">
        {shown.map((app) => {
          const icon = iconCache.get(app.path);
          return (
            <button
              key={app.path}
              type="button"
              role="option"
              aria-selected={app.path.toLowerCase() === selected.toLowerCase()}
              className={app.path.toLowerCase() === selected.toLowerCase() ? styles.appOn : styles.appItem}
              title={app.path}
              onClick={() => onPick(app.path)}
            >
              {icon ? <img src={icon} alt="" width={20} height={20} /> : <span className={styles.appIconBlank} />}
              <span>{app.name}</span>
            </button>
          );
        })}
        {apps !== null && shown.length === 0 && <p className={styles.statusLine}>No apps match.</p>}
      </div>
    </div>
  );
}
