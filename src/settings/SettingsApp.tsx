import { useCallback, useEffect, useRef, useState, type PointerEvent } from "react";

import { Logo } from "../components/Logo";
import styles from "./Settings.module.css";
import { AboutTab } from "./tabs/AboutTab";
import { CodeTab } from "./tabs/CodeTab";
import { DisplayTab } from "./tabs/DisplayTab";
import { FocusTab } from "./tabs/FocusTab";
import { GeneralTab } from "./tabs/GeneralTab";
import { PrompterTab } from "./tabs/PrompterTab";
import { QuickActionTab } from "./tabs/QuickActionTab";
import { ScriptsTab } from "./tabs/ScriptsTab";
import { WelcomeScreen } from "./WelcomeScreen";
import { useSettings } from "./useSettings";

const TABS = [
  { id: "general", label: "General" },
  { id: "display", label: "Display" },
  { id: "code", label: "AI tools" },
  { id: "quick", label: "Quick action" },
  { id: "scripts", label: "Scripts" },
  { id: "prompter", label: "Teleprompter" },
  { id: "focus", label: "Focus" },
  { id: "about", label: "About" },
] as const;

export type TabId = (typeof TABS)[number]["id"];

const SIDEBAR = { min: 160, max: 320, initial: 200, key: "overlid.sidebarWidth" };

function readSidebarWidth(): number {
  try {
    const saved = Number(localStorage.getItem(SIDEBAR.key));
    if (Number.isFinite(saved) && saved >= SIDEBAR.min && saved <= SIDEBAR.max) return saved;
  } catch {
    // Storage can be unavailable; fall back to the default.
  }
  return SIDEBAR.initial;
}

export function SettingsApp() {
  const [tab, setTab] = useState<TabId>("general");
  const { settings, error, update } = useSettings();
  const [sidebar, setSidebar] = useState(readSidebarWidth);
  const drag = useRef<{ x: number; w: number } | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR.key, String(sidebar));
    } catch {
      // Not critical.
    }
  }, [sidebar]);

  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, w: sidebar };
  };
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    const w = drag.current.w + e.clientX - drag.current.x;
    setSidebar(Math.round(Math.min(SIDEBAR.max, Math.max(SIDEBAR.min, w))));
  };
  const onUp = () => {
    drag.current = null;
  };
  const nudge = useCallback((delta: number) => {
    setSidebar((w) => Math.min(SIDEBAR.max, Math.max(SIDEBAR.min, w + delta)));
  }, []);

  if (settings && !settings.general.welcomeSeen) {
    return (
      <WelcomeScreen
        onDone={(next) => {
          update((s) => ({ ...s, general: { ...s.general, welcomeSeen: true } }));
          if (next) setTab(next);
        }}
      />
    );
  }

  return (
    <div className={styles.app}>
      <nav className={styles.sidebar} style={{ width: sidebar }} aria-label="Settings sections">
        <div className={styles.brand}>
          <Logo variant="micro-white" size={22} />
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

      <div
        className={styles.divider}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
        aria-valuemin={SIDEBAR.min}
        aria-valuemax={SIDEBAR.max}
        aria-valuenow={sidebar}
        tabIndex={0}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") nudge(-16);
          if (e.key === "ArrowRight") nudge(16);
        }}
      />

      <main className={tab === "scripts" ? styles.mainFull : styles.main}>
        {error && <p className={styles.error}>{error}</p>}
        {!settings ? (
          <p className={styles.loading}>Loading settings…</p>
        ) : tab === "general" ? (
          <GeneralTab />
        ) : tab === "display" ? (
          <DisplayTab />
        ) : tab === "code" ? (
          <CodeTab />
        ) : tab === "quick" ? (
          <QuickActionTab />
        ) : tab === "scripts" ? (
          <ScriptsTab />
        ) : tab === "prompter" ? (
          <PrompterTab />
        ) : tab === "focus" ? (
          <FocusTab />
        ) : (
          <AboutTab />
        )}
      </main>
    </div>
  );
}
