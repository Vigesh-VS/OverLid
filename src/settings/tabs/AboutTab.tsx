import { useEffect, useState } from "react";

import { Logo } from "../../components/Logo";
import { commands, run } from "../../lib/ipc";
import { Group, Row, Toggle } from "../controls";
import styles from "../Settings.module.css";

type LinkKind = Parameters<typeof commands.openLink>[0];

const LINKS: ReadonlyArray<{ kind: LinkKind; label: string; hint: string; primary?: boolean }> = [
  { kind: "star", label: "⭐ Star on GitHub", hint: "Helps other people find Overlid.", primary: true },
  { kind: "repo", label: "Open on GitHub", hint: "Source code and releases." },
  { kind: "bug", label: "Report a bug", hint: "Opens a new issue with the bug template." },
  { kind: "feature", label: "Request a feature", hint: "Opens a new issue with the feature template." },
  { kind: "discussions", label: "Discussions", hint: "Questions, ideas and show-and-tell." },
  { kind: "sponsor", label: "Sponsor", hint: "Support development on GitHub Sponsors." },
];

const INSPIRED = [
  { name: "dynamic-island-for-windows", by: "rajsriv, and Nusa", what: "the hover notch, media and system pop-ups" },
  { name: "CodeNotch", by: "vinzdg, and codenotch-windows by MakFly", what: "AI usage rings and session status" },
  { name: "TopCue, NotchPrompter and Moody", by: "", what: "the notch teleprompter and voice scrolling" },
];

const PRIVACY = [
  { title: "No telemetry, no accounts", text: "Overlid never phones home." },
  {
    title: "AI usage",
    text: "Only for tools you connect, using the sign-in their own CLI already saved, read-only, and sent only to that tool's usage endpoint.",
  },
  { title: "Microphone", text: "Voice mode measures loudness in memory. Audio is never recorded, saved or sent." },
  { title: "Clipboard", text: "History stays in memory, is never saved or sent, and skips anything password managers mark as private." },
  { title: "Screen colour", text: "The teleprompter's ambient glow samples a tiny copy of the screen in memory only, while presenting." },
  { title: "Keyboard", text: "Caps Lock and Num Lock are read with GetKeyState. There is no keyboard hook." },
];

/** Everything Overlid keeps on this PC. Nothing else is stored anywhere. */
const STORED = [
  { title: "Settings", text: "Your choices, in settings.json in Overlid's app data folder." },
  { title: "Scripts", text: "Teleprompter scripts, one file each in the scripts folder." },
  { title: "Focus history", text: "How many focus rounds and minutes you did each day (pomodoro.json)." },
  { title: "Logs", text: "Up to 4 files of 1 MB for troubleshooting. Anything that looks like a token is masked." },
  {
    title: "Hook token",
    text: "A random key in Windows Credential Manager that proves hook events came from your Claude Code. Live session names and folders are kept in memory only.",
  },
];

/** A plain, readable row of text inside a settings group. */
function TextRow({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className={styles.row}>
      <div className={styles.rowText}>
        <span className={styles.rowLabel}>{title}</span>
        {children && <span className={styles.rowHint}>{children}</span>}
      </div>
    </div>
  );
}

/** "Clear all Overlid data", behind an explicit second step. */
function ClearData() {
  const [confirming, setConfirming] = useState(false);
  const [disconnect, setDisconnect] = useState(true);
  const [status, setStatus] = useState<string | null>(null);

  const clear = () => {
    setStatus("Clearing…");
    commands.privacyClearAll(disconnect).then(
      () => {
        setStatus("All Overlid data was cleared.");
        setConfirming(false);
      },
      (e: unknown) => setStatus(String(e)),
    );
  };

  if (!confirming) {
    return (
      <Row label="Clear all Overlid data" hint={status ?? "Settings, scripts, focus history, logs and the hook token."}>
        <button type="button" className={styles.dangerButton} onClick={() => setConfirming(true)}>
          Clear…
        </button>
      </Row>
    );
  }
  return (
    <>
      <Toggle
        label="Also disconnect Claude Code live sessions"
        hint="Removes Overlid's hooks from Claude Code's settings. Its backups are kept."
        checked={disconnect}
        onChange={setDisconnect}
      />
      <Row label="This can't be undone" hint="Scripts are deleted for good. Export any you want to keep first.">
        <div className={styles.tryRow}>
          <button type="button" className={styles.button} onClick={() => setConfirming(false)}>
            Cancel
          </button>
          <button type="button" className={styles.dangerButton} onClick={clear}>
            Clear everything
          </button>
        </div>
      </Row>
    </>
  );
}

export function AboutTab() {
  const [version, setVersion] = useState("");

  useEffect(() => {
    commands.appVersion().then(setVersion, () => undefined);
  }, []);

  return (
    <>
      <div className={styles.aboutHero}>
        <Logo variant="metallic" size={88} label="Overlid logo" />
        <div className={styles.aboutText}>
          <h1>
            Overlid {version && <span className={styles.version}>v{version}</span>}
          </h1>
          <p>A dynamic island for Windows with AI coding status and a notch teleprompter.</p>
          <p className={styles.byline}>
            Created by <strong>Vigesh</strong>
          </p>
        </div>
      </div>

      <Group title="Creator">
        <Row label="Vigesh" hint="Designed and built Overlid.">
          <button type="button" className={styles.button} onClick={() => run(commands.openLink("author"), "open_link")}>
            GitHub profile
          </button>
        </Row>
      </Group>

      <Group title="Get involved" note="All support goes through GitHub.">
        {LINKS.map((l) => (
          <Row key={l.kind} label={l.label} hint={l.hint}>
            <button
              type="button"
              className={l.primary ? styles.primaryButton : styles.button}
              onClick={() => run(commands.openLink(l.kind), "open_link")}
            >
              Open
            </button>
          </Row>
        ))}
      </Group>

      <Group title="Inspired by" note="Ideas only; no code was copied. Thank you to these MIT-licensed projects.">
        {INSPIRED.map((p) => (
          <TextRow key={p.name} title={p.by ? `${p.name} by ${p.by}` : p.name}>
            {p.what}
          </TextRow>
        ))}
      </Group>

      <Group title="Privacy">
        {PRIVACY.map((p) => (
          <TextRow key={p.title} title={p.title}>
            {p.text}
          </TextRow>
        ))}
      </Group>

      <Group title="Stored on this PC" note="Nothing is uploaded. This is the full list.">
        {STORED.map((p) => (
          <TextRow key={p.title} title={p.title}>
            {p.text}
          </TextRow>
        ))}
        <ClearData />
      </Group>

      <Group title="Licence">
        <TextRow title="Code: MIT licence">© 2026 Vigesh. Free to use, change and share.</TextRow>
        <TextRow title="Name and logo">
          The Overlid name and logo are © 2026 Vigesh and aren't covered by the MIT licence. Forks need their own branding.
        </TextRow>
      </Group>
    </>
  );
}
