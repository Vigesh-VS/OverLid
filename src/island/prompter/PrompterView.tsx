import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

import { LockIcon, MicIcon, PauseIcon, PlayIcon, StopIcon } from "../../components/icons";
import { leadSession, useCode } from "../../stores/code";
import { useIsland } from "../../stores/island";
import { parseScript, usePrompter } from "../../stores/prompter";
import { useSystem } from "../../stores/system";
import styles from "./PrompterView.module.css";

/** Keep scrolling this long after speech stops, then ease to a halt. */
const VOICE_HANGOVER_MS = 600;

export function PrompterView() {
  const script = usePrompter((s) => s.script);
  const hardPaused = usePrompter((s) => s.hardPaused);
  const ended = usePrompter((s) => s.ended);
  const speed = usePrompter((s) => s.speed);
  const fontSize = usePrompter((s) => s.fontSize);
  const level = usePrompter((s) => s.level);
  const voiceError = usePrompter((s) => s.voiceError);
  const jump = usePrompter((s) => s.jump);
  const togglePause = usePrompter((s) => s.togglePause);
  const stop = usePrompter((s) => s.stop);
  const setEnded = usePrompter((s) => s.setEnded);
  const hovered = useIsland((s) => s.hovered);
  const prefs = useSystem((s) => s.settings?.prompter);
  const capture = useSystem((s) => s.settings?.general.hideFromCapture ?? "prompterOnly");
  const waiting = useCode((s) => leadSession(s.sessions)?.status === "waiting");

  const blocks = useMemo(() => parseScript(script?.body ?? ""), [script]);
  const sections = blocks.filter((b) => b.kind === "section");

  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const sectionRefs = useRef<(HTMLElement | null)[]>([]);
  const offset = useRef(0);
  const velocity = useRef(0);
  const lastVoice = useRef(0);
  const [current, setCurrent] = useState(0);

  const live = useRef({ hovered, hardPaused, speed, level, voice: !!prefs?.voice, threshold: prefs?.voiceThreshold ?? 0.35 });
  live.current = { hovered, hardPaused, speed, level, voice: !!prefs?.voice, threshold: prefs?.voiceThreshold ?? 0.35 };

  const maxOffset = () => {
    const content = contentRef.current;
    const viewport = viewportRef.current;
    if (!content || !viewport) return 0;
    return Math.max(0, content.scrollHeight - viewport.clientHeight * 0.45);
  };

  const apply = () => {
    if (contentRef.current) {
      contentRef.current.style.transform = `translate3d(0, ${-offset.current}px, 0)`;
    }
  };

  // Scroll engine: rAF + translateY so the GPU does the work.
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let lastSection = -1;
    const step = (t: number) => {
      const dt = Math.min(0.1, (t - last) / 1000);
      last = t;
      const s = live.current;
      let target = 0;
      if (!s.hardPaused && !s.hovered) {
        if (s.voice) {
          if (s.level > s.threshold) lastVoice.current = t;
          target = t - lastVoice.current < VOICE_HANGOVER_MS ? s.speed : 0;
        } else {
          target = s.speed;
        }
      }
      velocity.current += (target - velocity.current) * Math.min(1, dt * 6);
      if (Math.abs(velocity.current) > 0.05) {
        const max = maxOffset();
        offset.current = Math.min(max, Math.max(0, offset.current + velocity.current * dt));
        apply();
        if (offset.current >= max && max > 0 && !s.hardPaused) {
          velocity.current = 0;
          setEnded(true);
        }
      }
      // Track which section is under the reading line.
      const tops = sectionRefs.current.map((el) => el?.offsetTop ?? Infinity);
      let idx = 0;
      tops.forEach((top, i) => {
        if (top <= offset.current + 4) idx = i;
      });
      if (idx !== lastSection) {
        lastSection = idx;
        setCurrent(idx);
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [setEnded]);

  // Section jumps from shortcuts.
  useEffect(() => {
    if (!jump || sections.length === 0) return;
    const target = Math.min(sections.length - 1, Math.max(0, current + jump.dir));
    jumpTo(target);
  }, [jump]);

  // Esc stops when the island has focus.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") stop();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [stop]);

  function jumpTo(index: number) {
    const el = sectionRefs.current[index];
    if (!el) return;
    offset.current = Math.min(maxOffset(), el.offsetTop);
    velocity.current = 0;
    setEnded(false);
    apply();
  }

  const onWheel = (e: React.WheelEvent) => {
    offset.current = Math.min(maxOffset(), Math.max(0, offset.current + e.deltaY));
    if (ended && e.deltaY < 0) setEnded(false);
    apply();
  };

  const protectedNow = capture !== "never";
  const paused = hardPaused || hovered;
  const color = prefs?.color ?? "#FFFFFF";
  const height = prefs?.height ?? 200;
  const textStyle: CSSProperties = {
    fontFamily: `"${prefs?.fontFamily ?? "Segoe UI Variable Display"}", var(--ol-font)`,
    fontSize,
    lineHeight: prefs?.lineHeight ?? 1.4,
    color,
  };

  return (
    <div className={styles.prompter}>
      <div className={styles.header}>
        <span className={protectedNow ? styles.protected : styles.exposed}>
          <LockIcon size={12} />
          {protectedNow ? "Hidden from screen share" : "Visible in screen share"}
        </span>
        <span className={styles.meta}>
          {waiting && <span className={styles.waitDot} role="img" aria-label="An agent needs you" />}
          {ended ? "End of script · " : paused ? "Paused · " : ""}
          {Math.round(speed)} px/s · {fontSize} px
        </span>
      </div>

      <div
        ref={viewportRef}
        className={styles.viewport}
        style={{ height, "--fade": `${Math.round(height * 0.22)}px` } as CSSProperties}
        onWheel={onWheel}
      >
        <div className={prefs?.mirror ? styles.mirror : undefined}>
          <div
            ref={contentRef}
            className={styles.content}
            style={{ ...textStyle, paddingTop: height * 0.3, paddingBottom: height * 0.5 }}
          >
            {blocks.map((b, i) =>
              b.kind === "section" ? (
                <h3
                  key={i}
                  ref={(el) => {
                    sectionRefs.current[b.index] = el;
                  }}
                  className={styles.section}
                  style={{ color }}
                >
                  {b.text}
                </h3>
              ) : (
                <p key={i} className={styles.para}>
                  {b.text}
                </p>
              ),
            )}
            {blocks.length === 0 && <p className={styles.para}>This script is empty.</p>}
          </div>
        </div>
      </div>

      <div className={styles.beamTrack} aria-hidden="true">
        {prefs?.voice && (
          <div
            className={styles.beam}
            style={{ width: `${Math.round(level * 100)}%`, background: color, boxShadow: `0 0 10px ${color}` }}
          />
        )}
      </div>

      <div className={styles.footer}>
        <button
          type="button"
          className={styles.round}
          aria-label={hardPaused ? "Play" : "Pause"}
          onClick={togglePause}
        >
          {hardPaused ? <PlayIcon size={12} /> : <PauseIcon size={12} />}
        </button>
        <div className={styles.sections}>
          {sections.map((s, i) => (
            <button
              key={s.index}
              type="button"
              className={i === current ? styles.sectionOn : styles.sectionChip}
              aria-current={i === current ? "step" : undefined}
              onClick={() => jumpTo(i)}
            >
              {s.text}
            </button>
          ))}
        </div>
        {prefs?.voice && (
          <span className={styles.voice} title={voiceError ?? undefined}>
            <MicIcon size={14} color={voiceError ? "var(--ol-red)" : "var(--ol-text-2)"} />
            {voiceError ? "Mic unavailable" : "Voice · never recorded"}
          </span>
        )}
        <button type="button" className={styles.round} aria-label="Stop prompter" onClick={stop}>
          <StopIcon size={12} />
        </button>
      </div>
    </div>
  );
}

export function Countdown() {
  const count = usePrompter((s) => s.count);
  return (
    <div className={styles.countdown} role="timer" aria-live="assertive">
      <span className={styles.countLabel}>Starting in</span>
      <span className={styles.count}>{count}</span>
    </div>
  );
}
