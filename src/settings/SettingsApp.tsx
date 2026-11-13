import { useState } from "react";

import styles from "./Settings.module.css";
import { AboutTab } from "./tabs/AboutTab";
import { CodeTab } from "./tabs/CodeTab";
import { FocusTab } from "./tabs/FocusTab";
import { GeneralTab } from "./tabs/GeneralTab";
import { PrompterTab } from "./tabs/PrompterTab";
import { ScriptsTab } from "./tabs/ScriptsTab";
import { useSettings } from "./useSettings";

const TABS = [
  { id: "general", label: "General" },
  { id: "scripts", label: "Scripts" },
  { id: "prompter", label: "Teleprompter" },
  { id: "code", label: "CodeNotch" },
  { id: "focus", label: "Focus" },
  { id: "about", label: "About" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export function SettingsApp() {
  const [tab, setTab] = useState<TabId>("general");
  const { settings, error } = useSettings();

  return (
    <div className={styles.app}>
      <nav className={styles.sidebar} aria-label="Settings sections">
        <div className={styles.brand}>
          <span className={styles.brandPill} aria-hidden="true" />
          Overlid
        </div>
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={t.id === tab ? styles.navOn : styles.nav}
            aria-current={t.id === tab ? "page" : undefined}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <main className={tab === "scripts" ? styles.mainFull : styles.main}>
        {error && <p className={styles.error}>{error}</p>}
        {!settings ? (
          <p className={styles.loading}>Loading settings…</p>
        ) : tab === "general" ? (
          <GeneralTab />
        ) : tab === "scripts" ? (
          <ScriptsTab />
        ) : tab === "prompter" ? (
          <PrompterTab />
        ) : tab === "code" ? (
          <CodeTab />
        ) : tab === "focus" ? (
          <FocusTab />
        ) : (
          <AboutTab />
        )}
      </main>
    </div>
  );
}
