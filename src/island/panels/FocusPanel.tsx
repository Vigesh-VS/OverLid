import { Ring } from "../../components/Ring";
import { formatCountdown, formatDuration } from "../../lib/format";
import { commands, run } from "../../lib/ipc";
import { PHASE_LABEL, usePomodoro } from "../../stores/pomodoro";
import { useSystem } from "../../stores/system";
import styles from "./FocusPanel.module.css";

export function FocusPanel() {
  const state = usePomodoro((s) => s.state);
  const focus = useSystem((s) => s.settings?.focus);

  if (!state) {
    return <div className={styles.loading}>Starting the timer…</div>;
  }

  const progress = state.totalMs > 0 ? 1 - state.remainingMs / state.totalMs : 0;
  const onBreak = state.phase !== "focus";
  const fresh = !state.running && state.remainingMs >= state.totalMs;
  const nextUp = onBreak
    ? `Next: focus, ${focus?.focusMin ?? 25} min`
    : state.round >= state.roundsPerCycle
      ? `Next: long break, ${focus?.longMin ?? 15} min`
      : `Next: short break, ${focus?.shortMin ?? 5} min · long break after round ${state.roundsPerCycle}`;

  return (
    <div className={styles.panel}>
      <div className={styles.dial}>
        <Ring
          size={168}
          stroke={8}
          value={progress}
          track="var(--ol-surface-raised)"
          color={onBreak ? "var(--ol-green)" : "var(--ol-text)"}
        />
        <div className={styles.dialText}>
          <span className={styles.time}>{formatCountdown(state.remainingMs)}</span>
          <span className={styles.phase}>{PHASE_LABEL[state.phase]}</span>
        </div>
      </div>

      <div className={styles.side}>
        <div className={styles.rounds}>
          <span className={styles.roundTitle}>
            Round {state.round} of {state.roundsPerCycle}
          </span>
          <div className={styles.dots} role="img" aria-label={`Round ${state.round} of ${state.roundsPerCycle}`}>
            {Array.from({ length: state.roundsPerCycle }, (_, i) => {
              const n = i + 1;
              const cls =
                n < state.round || (n === state.round && onBreak)
                  ? styles.dotDone
                  : n === state.round
                    ? styles.dotNow
                    : styles.dot;
              return <span key={n} className={cls} />;
            })}
          </div>
          <span className={styles.next}>{nextUp}</span>
        </div>

        <div className={styles.buttons}>
          {state.running ? (
            <button type="button" className={styles.primary} onClick={() => run(commands.pomoPause(), "pomo_pause")}>
              Pause
            </button>
          ) : (
            <button type="button" className={styles.primary} onClick={() => run(commands.pomoStart(), "pomo_start")}>
              {fresh ? (onBreak ? "Start break" : "Start focus") : "Resume"}
            </button>
          )}
          <button type="button" className={styles.secondary} onClick={() => run(commands.pomoSkip(), "pomo_skip")}>
            Skip
          </button>
          <button type="button" className={styles.secondary} onClick={() => run(commands.pomoReset(), "pomo_reset")}>
            Reset
          </button>
        </div>

        <div className={styles.today}>
          <div>
            <strong>{formatDuration(state.today.minutes * 60)}</strong>
            <span>focused today</span>
          </div>
          <div>
            <strong>{state.today.sessions}</strong>
            <span>{state.today.sessions === 1 ? "session" : "sessions"}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
