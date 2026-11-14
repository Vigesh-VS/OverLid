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

export function AboutTab() {
  const [version, setVersion] = useState("");

  useEffect(() => {
    commands.appVersion().then(setVersion, () => undefined);
  }, []);

  return (
    <>
      <div className={styles.aboutHero}>
        <Logo variant="metallic" size={88} label="Overlid logo" />
        <div>
          <h1>Overlid {version && <span className={styles.version}>v{version}</span>}</h1>
          <p>
            A dynamic island for Windows with AI coding status and a notch teleprompter. Open source under the MIT licence.
            No telemetry.
          </p>
        </div>
      </div>

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
        <ul className={styles.credits}>
          <li>dynamic-island-for-windows by rajsriv, and Nusa</li>
          <li>CodeNotch by vinzdg, and codenotch-windows by MakFly</li>
          <li>TopCue, NotchPrompter and Moody</li>
        </ul>
      </Group>

      <Group title="Privacy">
        <ul className={styles.credits}>
          <li>No telemetry and no accounts.</li>
          <li>
            Usage is only fetched for AI tools you connect, using the sign-in their own CLI already saved, read-only, sent
            only to that provider's usage endpoint.
          </li>
          <li>Microphone audio is measured for loudness in memory and never recorded or sent.</li>
          <li>Clipboard history stays in memory, is never saved or sent, and skips content password managers mark as private.</li>
          <li>Live screen colour (teleprompter background) is sampled in memory only and never saved or sent.</li>
          <li>Caps Lock and Num Lock are read with GetKeyState. There is no keyboard hook.</li>
        </ul>
      </Group>

      <Group title="Brand">
        <p className={styles.groupNote}>The Overlid name and logo are © 2026 Vigesh and aren't covered by the MIT licence.</p>
      </Group>
    </>
  );
}
