import { useEffect, useState } from "react";

import { Logo } from "../../components/Logo";
import { commands, run } from "../../lib/ipc";
import { Group, Row } from "../controls";
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

      <Group title="Licence">
        <TextRow title="Code: MIT licence">© 2026 Vigesh. Free to use, change and share.</TextRow>
        <TextRow title="Name and logo">
          The Overlid name and logo are © 2026 Vigesh and aren't covered by the MIT licence. Forks need their own branding.
        </TextRow>
      </Group>
    </>
  );
}
