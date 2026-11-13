import { useEffect, useState } from "react";

import { commands } from "../../lib/ipc";
import { Group, Row } from "../controls";
import styles from "../Settings.module.css";

export function AboutTab() {
  const [version, setVersion] = useState("");

  useEffect(() => {
    commands.appVersion().then(setVersion, () => undefined);
  }, []);

  return (
    <>
      <Group
        title="Overlid"
        note="A Dynamic-Island-style notch for Windows: media, system stats, a focus timer, Claude Code status and a teleprompter. Open source under the MIT licence. No telemetry."
      >
        <Row label="Version">
          <span>{version || "…"}</span>
        </Row>
        <Row label="Source code" hint="github.com/Vigesh-VS/OverLid">
          <button type="button" className={styles.button} onClick={() => void commands.openRepo()}>
            Open on GitHub
          </button>
        </Row>
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
          <li>The only network call is Claude's usage endpoint, made with the sign-in Claude Code already saved.</li>
          <li>Microphone audio is measured for loudness in memory and never recorded or sent.</li>
          <li>Caps Lock and Num Lock are read with GetKeyState. There is no keyboard hook.</li>
        </ul>
      </Group>
    </>
  );
}
