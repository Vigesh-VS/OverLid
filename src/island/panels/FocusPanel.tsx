import { useEffect, useRef, useState } from "react";

import { PauseIcon, PlayIcon, ResetIcon, SkipIcon } from "../../components/icons";
import { formatCountdown, formatDuration } from "../../lib/format";
import { commands, run, type PomoPhase } from "../../lib/ipc";
import { PHASE_LABEL, usePomodoro } from "../../stores/pomodoro";
import { useSystem } from "../../stores/system";
import styles from "./FocusPanel.module.css";

const PRESETS = [5, 15, 25, 50];

export function FocusPanel() {
  const state = usePomodoro((s) => s.state);
  const focus = useSystem((s) => s.settings?.focus);
  const [editing, setEditing] = useState(false);

  if (!state || !focus) {
    return <div className={styles.loading}>Starting the timer…</div>;
  }

  const progress = state.totalMs > 0 ? 1 - state.remainingMs / state.totalMs : 0;
  const onBreak = state.phase !== "focus";
  const fresh = !state.running && state.remainingMs >= state.totalMs;
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
              aria-label={`${formatCountdown(state.remainingMs)} left. Change the ${PHASE_LABEL[state.phase].toLowerCase()} length`}
              onClick={() => setEditing(true)}
            >
              {formatCountdown(state.remainingMs)}
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
        <BreakField label="Short" value={focus.shortMin} phase="shortBreak" />
        <BreakField label="Long" value={focus.longMin} phase="longBreak" />
        <span className={styles.today}>
          <strong>{formatDuration(state.today.minutes * 60)}</strong> today · {state.today.sessions}{" "}
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

function BreakField({ label, value, phase }: { label: string; value: number; phase: PomoPhase }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = () => {
    const m = Number.parseInt(draft, 10);
    if (Number.isFinite(m) && m !== value) run(commands.pomoSetLength(phase, Math.min(180, Math.max(1, m))), "pomo_set_length");
    else setDraft(String(value));
  };
  return (
    <label className={styles.breakField}>
      {label}
      <input
        type="number"
        min={1}
        max={180}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && commit()}
      />
      min
    </label>
  );
}
