import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent } from "react";

import { LockIcon, MicIcon, PauseIcon, PlayIcon, StopIcon } from "../../components/icons";
import { commands, run } from "../../lib/ipc";
import { leadSession, useCode } from "../../stores/code";
import { useIsland } from "../../stores/island";
import { effectiveFontSize, parseScript, usePrompter, voiceLevel } from "../../stores/prompter";
import { useSystem } from "../../stores/system";
import styles from "./PrompterView.module.css";

/** Keep scrolling this long after speech stops, then ease to a halt. */
const VOICE_HANGOVER_MS = 600;
/** Consecutive above-threshold samples needed to count as speech (rejects clicks). */
const SPEECH_SAMPLES = 2;
/** Eye-line, as a fraction of the text area height. */
const EYE_LINE = 0.3;

export const AREA_LIMITS = { minW: 320, maxW: 760, minH: 120, maxH: 420 };

export function PrompterView() {
  const script = usePrompter((s) => s.script);
  const hardPaused = usePrompter((s) => s.hardPaused);
  const ended = usePrompter((s) => s.ended);
  const rate = usePrompter((s) => s.rate);
  const fontSize = usePrompter((s) => s.fontSize);
  const voiceStatus = usePrompter((s) => s.voiceStatus);
  const forceAuto = usePrompter((s) => s.forceAuto);
  const area = usePrompter((s) => s.area);
  const jump = usePrompter((s) => s.jump);
  const togglePause = usePrompter((s) => s.togglePause);
  const stop = usePrompter((s) => s.stop);
  const setEnded = usePrompter((s) => s.setEnded);
  const switchToAutoScroll = usePrompter((s) => s.switchToAutoScroll);
  const hovered = useIsland((s) => s.hovered);
  const prefs = useSystem((s) => s.settings?.prompter);
  const capture = useSystem((s) => s.settings?.general.hideFromCapture ?? "prompterOnly");
  const waiting = useCode((s) => leadSession(s.sessions)?.status === "waiting");

  const blocks = useMemo(() => parseScript(script?.body ?? ""), [script]);
  const sections = blocks.filter((b) => b.kind === "section");

  const width = area?.width ?? prefs?.width ?? 560;
  const height = area?.height ?? prefs?.height ?? 200;
  const autoFit = prefs?.autoFit ?? false;
  const size = effectiveFontSize(fontSize, width, autoFit);
  const lineHeight = prefs?.lineHeight ?? 1.4;
  const voiceWanted = !!prefs?.voice && !forceAuto;
  const voiceState = voiceStatus?.state ?? "starting";
  const voiceBroken = voiceWanted && (voiceState === "blocked" || voiceState === "silent" || voiceState === "error");

  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const beamRef = useRef<HTMLDivElement>(null);
  const sectionRefs = useRef<(HTMLElement | null)[]>([]);
  const offset = useRef(0);
  const velocity = useRef(0);
  const [current, setCurrent] = useState(0);

  // Everything the frame loop needs, refreshed on render without restarting the loop.
  const live = useRef({
    paused: false,
    voice: false,
    voiceReady: false,
    threshold: 0.4,
    mode: "speed" as "speed" | "lines" | "duration",
    pxPerSec: 60,
    linePx: 39,
    lpm: 30,
    durationSec: 300,
    rate: 1,
  });
  live.current = {
    paused: hardPaused || hovered || voiceBroken,
    voice: voiceWanted,
    voiceReady: voiceState === "listening",
    threshold: prefs?.voiceThreshold ?? 0.4,
    mode: prefs?.timingMode ?? "speed",
    pxPerSec: prefs?.speed ?? 60,
    linePx: size * lineHeight,
    lpm: prefs?.linesPerMinute ?? 30,
    durationSec: (prefs?.durationMin ?? 5) * 60,
    rate,
  };

  const maxOffset = () => {
    const content = contentRef.current;
    const viewport = viewportRef.current;
    if (!content || !viewport) return 0;
    // Stop when the last line reaches the eye-line.
    return Math.max(0, content.scrollHeight - viewport.clientHeight * (1 - EYE_LINE) - size * lineHeight);
  };

  const apply = () => {
    // Sub-pixel on purpose: no rounding, so motion is continuous.
    if (contentRef.current) contentRef.current.style.transform = `translate3d(0, ${-offset.current}px, 0)`;
  };

  // Scroll engine: requestAnimationFrame + delta time, position kept as a float
  // in a ref. React never re-renders per frame.
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let lastSampleAt = 0;
    let above = 0;
    let lastSpeech = -Infinity;
    let lastSection = -1;
    const step = (t: number) => {
      const dt = Math.min(0.05, (t - last) / 1000);
      last = t;
      const s = live.current;
      const max = maxOffset();

      let speed: number;
      if (s.mode === "lines") speed = (s.lpm * s.linePx) / 60;
      else if (s.mode === "duration") speed = max / Math.max(1, s.durationSec);
      else speed = s.pxPerSec;
      speed *= s.rate;

      let target = s.paused ? 0 : speed;
      if (s.voice && !s.paused) {
        // New mic sample? Count consecutive frames above the threshold.
        if (voiceLevel.at !== lastSampleAt) {
          lastSampleAt = voiceLevel.at;
          above = voiceLevel.level > s.threshold ? above + 1 : 0;
          if (above >= SPEECH_SAMPLES) lastSpeech = t;
        }
        target = s.voiceReady && t - lastSpeech < VOICE_HANGOVER_MS ? speed : 0;
      }
      // Ease towards the target so starts and stops are gentle.
      velocity.current += (target - velocity.current) * Math.min(1, dt * 7);
      if (target === 0 && velocity.current < 0.5) velocity.current = 0;

      if (velocity.current > 0) {
        offset.current = Math.min(max, offset.current + velocity.current * dt);
        apply();
        if (max > 0 && offset.current >= max) {
          velocity.current = 0;
          setEnded(true);
        }
      }

      if (beamRef.current) {
        const lvl = s.voice ? voiceLevel.level : 0;
        beamRef.current.style.transform = `scaleX(${lvl.toFixed(3)})`;
        beamRef.current.style.opacity = lvl > s.threshold ? "1" : "0.45";
      }

      let idx = 0;
      sectionRefs.current.forEach((el, i) => {
        if (el && el.offsetTop <= offset.current + 4) idx = i;
      });
      if (idx !== lastSection) {
        lastSection = idx;
        setCurrent(idx);
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // The loop reads `live`; restarting it would reset the clocks.
  }, [setEnded]);

  // Keep the position valid when the text size or area changes.
  useEffect(() => {
    offset.current = Math.min(offset.current, maxOffset());
    apply();
  });

  // Section jumps from shortcuts.
  useEffect(() => {
    if (!jump || sections.length === 0) return;
    jumpTo(Math.min(sections.length - 1, Math.max(0, current + jump.dir)));
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

  const effectivePxs = (() => {
    const mode = prefs?.timingMode ?? "speed";
    if (mode === "lines") return (((prefs?.linesPerMinute ?? 30) * size * lineHeight) / 60) * rate;
    if (mode === "duration") return null;
    return (prefs?.speed ?? 60) * rate;
  })();

  const protectedNow = capture !== "never";
  const color = prefs?.color ?? "#FFFFFF";
  const eyeLine = Math.round(height * EYE_LINE);
  const textStyle: CSSProperties = {
    fontFamily: `"${prefs?.fontFamily ?? "Segoe UI Variable Display"}", var(--ol-font)`,
    fontSize: size,
    lineHeight,
    color,
    paddingTop: eyeLine,
    paddingBottom: height,
  };

  const statusText = ended
    ? "End of script"
    : voiceBroken
      ? "Voice paused"
      : hardPaused
        ? "Paused"
        : hovered
          ? "Paused while hovering"
          : voiceWanted && voiceState !== "listening"
            ? "Starting mic…"
            : null;

  return (
    <div className={styles.prompter}>
      <div className={styles.header}>
        <span className={protectedNow ? styles.protected : styles.exposed}>
          <LockIcon size={12} />
          {protectedNow ? "Hidden from screen share" : "Visible in screen share"}
        </span>
        <span className={styles.meta}>
          {waiting && <span className={styles.waitDot} role="img" aria-label="An agent needs you" />}
          {statusText && <span>{statusText} ·</span>}
          {effectivePxs === null ? `${prefs?.durationMin ?? 5} min run` : `${Math.round(effectivePxs)} px/s`}
          {" · "}
          {size} px
        </span>
      </div>

      <div
        ref={viewportRef}
        className={styles.viewport}
        style={{ height, "--fade": `${Math.round(height * 0.2)}px` } as CSSProperties}
        onWheel={onWheel}
      >
        <div
          className={styles.readingLine}
          style={{ top: eyeLine - 2, height: size * lineHeight + 4 }}
          aria-hidden="true"
        />
        <div className={prefs?.mirror ? styles.mirror : undefined}>
          <div ref={contentRef} className={styles.content} style={textStyle}>
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

        {voiceBroken && (
          <div className={styles.micAlert} role="alert">
            <MicIcon size={16} color="var(--ol-amber)" />
            <div>
              <strong>{voiceState === "blocked" ? "Microphone blocked" : voiceState === "silent" ? "No sound from the microphone" : "Microphone unavailable"}</strong>
              <span>{voiceStatus?.message ?? "Voice mode can't hear you."}</span>
            </div>
            <button type="button" onClick={switchToAutoScroll}>
              Use auto-scroll
            </button>
          </div>
        )}
      </div>

      <div className={styles.beamTrack} aria-hidden="true">
        {voiceWanted && <div ref={beamRef} className={styles.beam} style={{ background: color, boxShadow: `0 0 10px ${color}` }} />}
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
        {voiceWanted && (
          <span className={styles.voice}>
            <MicIcon size={14} color={voiceBroken ? "var(--ol-amber)" : "var(--ol-text-2)"} />
            {voiceBroken ? "Mic problem" : voiceStatus?.device ? "Voice · never recorded" : "Voice"}
          </span>
        )}
        <button type="button" className={styles.round} aria-label="Stop prompter" onClick={stop}>
          <StopIcon size={12} />
        </button>
      </div>

      <ResizeHandles width={width} height={height} />
    </div>
  );
}

/** Drag the prompter's left, right and bottom edges to resize the text area. */
function ResizeHandles({ width, height }: { width: number; height: number }) {
  const setArea = usePrompter((s) => s.setArea);
  const position = useSystem((s) => s.settings?.general.position ?? "center");
  const drag = useRef<{ x: number; y: number; w: number; h: number; edge: "left" | "right" | "bottom" } | null>(null);

  const begin = (edge: "left" | "right" | "bottom") => (e: PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, w: width, h: height, edge };
    useIsland.getState().setDragging(true);
    setArea({ width, height });
  };

  const move = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    // A centred island grows on both sides, so each side moves half as far.
    const factor = position === "center" ? 2 : 1;
    let w = d.w;
    if (d.edge === "right") w = d.w + dx * factor;
    if (d.edge === "left") w = d.w - dx * factor;
    const h = d.edge === "bottom" ? d.h + (e.clientY - d.y) : d.h;
    setArea({
      width: Math.round(Math.min(AREA_LIMITS.maxW, Math.max(AREA_LIMITS.minW, w))),
      height: Math.round(Math.min(AREA_LIMITS.maxH, Math.max(AREA_LIMITS.minH, h))),
    });
  };

  const end = () => {
    if (!drag.current) return;
    drag.current = null;
    useIsland.getState().setDragging(false);
    const area = usePrompter.getState().area;
    const settings = useSystem.getState().settings;
    if (area && settings) {
      run(
        commands.settingsSet({ ...settings, prompter: { ...settings.prompter, width: area.width, height: area.height } }),
        "settings_set",
      );
    }
    // Keep the live size until the saved settings arrive, then let them take over.
    window.setTimeout(() => setArea(null), 400);
  };

  const handlers = { onPointerMove: move, onPointerUp: end, onPointerCancel: end };
  return (
    <>
      {position !== "left" && (
        <div className={`${styles.handle} ${styles.handleLeft}`} onPointerDown={begin("left")} {...handlers} aria-hidden="true" />
      )}
      {position !== "right" && (
        <div className={`${styles.handle} ${styles.handleRight}`} onPointerDown={begin("right")} {...handlers} aria-hidden="true" />
      )}
      <div className={`${styles.handle} ${styles.handleBottom}`} onPointerDown={begin("bottom")} {...handlers} aria-hidden="true" />
    </>
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
