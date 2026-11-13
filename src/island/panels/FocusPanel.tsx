import { useEffect, useRef, useState } from "react";

import { PauseIcon, PlayIcon, ResetIcon, SkipIcon } from "../../components/icons";
import { formatCountdown, formatDuration } from "../../lib/format";
import { commands, run, type PomoPhase } from "../../lib/ipc";
import { PHASE_LABEL, usePomoView } from "../../stores/pomodoro";
import { useSystem } from "../../stores/system";
import styles from "./FocusPanel.module.css";

const PRESETS = [5, 10, 15, 25];

export function FocusPanel() {
  const { state, remainingMs, progress } = usePomoView();
  const focus = useSystem((s) => s.settings?.focus);
  const [editing, setEditing] = useState(false);

  if (!state || !focus) {
    return <div className={styles.loading}>Starting the timer…</div>;
  }

  const onBreak = state.phase !== "focus";
  const fresh = !state.running && remainingMs >= state.totalMs;
  const minutesFor: Record<PomoPhase, number> = {
    focus: focus.focusMin,
    shortBreak: focus.shortMin,
    longBreak: focus.longMin,
  };

  return (
    <div className={styles.panel}>
      <div className={styles.row}>
        <div className={styles.left}>
          <span className={onBreak ? `${styles.phase} ${styles.break}` : styles.phase}>{PHASE_LABEL[state.phase]}</span>
          {state.breaks && (
          <>
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
          <span className={styles.round}>
            Round {state.round} of {state.roundsPerCycle}
          </span>
          </>
          )}
          {!state.breaks && (
            <span className={styles.round}>
              {state.running ? "Running" : fresh ? "Ready" : "Paused"}
            </span>
          )}
        </div>

        <div className={styles.center}>
          {editing ? (
            <MinutesField
              initial={minutesFor[state.phase]}
              onDone={(m) => {
                setEditing(false);
                if (m !== null) run(commands.pomoSetLength(state.phase, m), "pomo_set_length");
              }}
            />
          ) : (
            <button
              type="button"
              className={styles.time}
              title={`Click to change the ${PHASE_LABEL[state.phase].toLowerCase()} length`}
              aria-label={`${formatCountdown(remainingMs)} left. Change the ${PHASE_LABEL[state.phase].toLowerCase()} length`}
              onClick={() => setEditing(true)}
            >
              {formatCountdown(remainingMs)}
            </button>
          )}
        </div>

        <div className={styles.controls}>
          <button
            type="button"
            className={styles.primary}
            aria-label={state.running ? "Pause" : fresh ? "Start" : "Resume"}
            title={state.running ? "Pause" : fresh ? "Start" : "Resume"}
            onClick={() => run(state.running ? commands.pomoPause() : commands.pomoStart(), "pomo")}
          >
            {state.running ? <PauseIcon size={16} /> : <PlayIcon size={16} />}
          </button>
          <button type="button" className={styles.icon} aria-label="Skip to next phase" title="Skip" onClick={() => run(commands.pomoSkip(), "pomo_skip")}>
            <SkipIcon size={15} />
          </button>
          <button type="button" className={styles.icon} aria-label="Reset" title="Reset" onClick={() => run(commands.pomoReset(), "pomo_reset")}>
            <ResetIcon size={15} />
          </button>
        </div>
      </div>

      <div className={styles.progress} aria-hidden="true">
        <span style={{ width: `${progress * 100}%`, background: onBreak ? "var(--ol-green)" : "var(--ol-text)" }} />
      </div>

      <div className={styles.options}>
        <div className={styles.presets} role="group" aria-label="Focus length">
          {PRESETS.map((m) => (
            <button
              key={m}
              type="button"
              className={m === focus.focusMin ? styles.presetOn : styles.preset}
              aria-pressed={m === focus.focusMin}
              onClick={() => run(commands.pomoSetLength("focus", m), "pomo_set_length")}
            >
              {m}
            </button>
          ))}
          <span className={styles.unit}>min focus</span>
        </div>
        <span className={styles.today}>
          <strong>{state.today.minutes > 0 ? formatDuration(state.today.minutes * 60) : "0m"}</strong> today ·{" "}
          {state.today.sessions}{" "}
          {state.today.sessions === 1 ? "session" : "sessions"}
        </span>
      </div>
    </div>
  );
}

/** The countdown turns into a minutes field when clicked. */
function MinutesField({ initial, onDone }: { initial: number; onDone: (minutes: number | null) => void }) {
  const [value, setValue] = useState(String(initial));
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.select();
  }, []);
  const commit = () => {
    const m = Number.parseInt(value, 10);
    onDone(Number.isFinite(m) ? Math.min(180, Math.max(1, m)) : null);
  };
  return (
    <span className={styles.edit}>
      <input
        ref={ref}
        className={styles.minutes}
        type="number"
        min={1}
        max={180}
        value={value}
        aria-label="Minutes"
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") onDone(null);
        }}
      />
      <span>min</span>
    </span>
  );
}
