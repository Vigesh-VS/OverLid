import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent } from "react";

import { AmbientLayer, useAmbientColors } from "../../components/AmbientLayer";
import { LockIcon, MicIcon, PauseIcon, PlayIcon } from "../../components/icons";
import { commands, run } from "../../lib/ipc";
import { leadSession, useCode } from "../../stores/code";
import { useIsland } from "../../stores/island";
import { effectiveFontSize, parseScript, usePrompter, voiceLevel, type Block } from "../../stores/prompter";
import { useSystem } from "../../stores/system";
import { renderInline } from "./inline";
import styles from "./PrompterView.module.css";

/** Keep scrolling this long after speech stops, then ease to a halt. */
const VOICE_HANGOVER_MS = 600;
/** Consecutive above-threshold samples needed to count as speech (rejects clicks). */
const SPEECH_SAMPLES = 2;
/** Eye-line, as a fraction of the text area height. */
const EYE_LINE = 0.3;
/** Max paragraphs per rendered chunk. Every section also starts a chunk. */
const CHUNK_BLOCKS = 12;

export const AREA_LIMITS = { minW: 320, maxW: 760, minH: 120, maxH: 420 };

interface Chunk {
  blocks: Block[];
  /** Section index this chunk starts, if it starts with a heading. */
  section: number | null;
}

function chunkBlocks(blocks: Block[]): Chunk[] {
  const chunks: Chunk[] = [];
  let current: Chunk = { blocks: [], section: null };
  for (const b of blocks) {
    if (b.kind === "section" || current.blocks.length >= CHUNK_BLOCKS) {
      if (current.blocks.length) chunks.push(current);
      current = { blocks: [], section: b.kind === "section" ? b.index : null };
    }
    current.blocks.push(b);
  }
  if (current.blocks.length) chunks.push(current);
  return chunks;
}

/** Height guess for a chunk that hasn't been rendered yet. */
function estimate(chunk: Chunk, size: number, lineHeight: number, width: number): number {
  const linePx = size * lineHeight;
  const charsPerLine = Math.max(10, width / (size * 0.52));
  return chunk.blocks.reduce((h, b) => {
    if (b.kind === "section") return h + size * 0.5 * lineHeight + size * 0.35;
    return h + Math.ceil(Math.max(1, b.text.length) / charsPerLine) * linePx + size * 0.55;
  }, 0);
}

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
  const handle = usePrompter((s) => s.handle);
  const setEnded = usePrompter((s) => s.setEnded);
  const switchToAutoScroll = usePrompter((s) => s.switchToAutoScroll);
  const hovered = useIsland((s) => s.hovered);
  const prefs = useSystem((s) => s.settings?.prompter);
  const capture = useSystem((s) => s.settings?.general.hideFromCapture ?? "prompterOnly");
  const waiting = useCode((s) => leadSession(s.sessions)?.status === "waiting");

  const blocks = useMemo(() => parseScript(script?.body ?? ""), [script]);
  const chunks = useMemo(() => chunkBlocks(blocks), [blocks]);
  const sections = useMemo(() => blocks.filter((b) => b.kind === "section"), [blocks]);

  const width = area?.width ?? prefs?.width ?? 560;
  const height = area?.height ?? prefs?.height ?? 200;
  const autoFit = prefs?.autoFit ?? false;
  const size = effectiveFontSize(fontSize, width, autoFit);
  const lineHeight = prefs?.lineHeight ?? 1.4;
  const linePx = size * lineHeight;
  const eyeLine = Math.round(height * EYE_LINE);
  const voiceWanted = !!prefs?.voice && !forceAuto;
  const voiceState = voiceStatus?.state ?? "starting";
  const voiceBroken = voiceWanted && (voiceState === "blocked" || voiceState === "silent" || voiceState === "error");

  // Chunk heights: estimated until rendered, then measured.
  const heights = useRef<number[]>([]);
  const measured = useRef<boolean[]>([]);
  const [layoutVersion, setLayoutVersion] = useState(0);
  useMemo(() => {
    heights.current = chunks.map((c) => estimate(c, size, lineHeight, width));
    measured.current = chunks.map(() => false);
  }, [chunks, size, lineHeight, width]);

  /** Top of each chunk inside the content (after the eye-line padding). */
  const tops = () => {
    const out: number[] = [];
    let y = eyeLine;
    for (const h of heights.current) {
      out.push(y);
      y += h;
    }
    out.push(y);
    return out;
  };
  const sectionTop = (index: number) => {
    const t = tops();
    const ci = chunks.findIndex((c) => c.section === index);
    return ci < 0 ? 0 : t[ci] - eyeLine;
  };
  const maxOffset = () => {
    const t = tops();
    // Stop when the last line reaches the eye-line.
    return Math.max(0, t[t.length - 1] - eyeLine - linePx);
  };

  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const beamRef = useRef<HTMLDivElement>(null);
  const offset = useRef(0);
  const velocity = useRef(0);
  const [current, setCurrent] = useState(0);
  const [range, setRange] = useState<[number, number]>([0, 4]);

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
    height: 200,
    maxOffset: (): number => 0,
    tops: (): number[] => [],
    chunks: [] as Chunk[],
  });
  live.current = {
    paused: hardPaused || hovered || voiceBroken,
    voice: voiceWanted,
    voiceReady: voiceState === "listening",
    threshold: prefs?.voiceThreshold ?? 0.4,
    mode: prefs?.timingMode ?? "speed",
    pxPerSec: prefs?.speed ?? 60,
    linePx,
    lpm: prefs?.linesPerMinute ?? 30,
    durationSec: (prefs?.durationMin ?? 5) * 60,
    rate,
    height,
    maxOffset,
    tops,
    chunks,
  };

  const apply = () => {
    // Sub-pixel on purpose: no rounding, so motion is continuous.
    if (contentRef.current) contentRef.current.style.transform = `translate3d(0, ${-offset.current}px, 0)`;
  };

  /** Chunks overlapping the visible area plus a screen of buffer each way. */
  const visibleRange = (t: number[], y: number, h: number): [number, number] => {
    let first = 0;
    while (first < t.length - 2 && t[first + 1] < y - h) first++;
    let last = first;
    while (last < t.length - 2 && t[last + 1] < y + 2 * h) last++;
    return [first, last];
  };

  // Scroll engine: requestAnimationFrame + delta time, position kept as a float
  // in a ref. React only re-renders when the rendered chunk window or the
  // current section changes, never per frame.
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let lastSampleAt = 0;
    let above = 0;
    let lastSpeech = -Infinity;
    let lastSection = -1;
    let lastRange = "";
    const step = (t: number) => {
      const dt = Math.min(0.05, (t - last) / 1000);
      last = t;
      const s = live.current;
      const max = s.maxOffset();

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

      const tp = s.tops();
      const r = visibleRange(tp, offset.current, s.height);
      const key = `${r[0]}:${r[1]}`;
      if (key !== lastRange) {
        lastRange = key;
        setRange(r);
      }
      // Current section: the last section chunk that has reached the eye-line.
      let idx = 0;
      s.chunks.forEach((c, i) => {
        if (c.section !== null && tp[i] - tp[0] <= offset.current + 4) idx = c.section;
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

  // Measure rendered chunks so the layout gets exact as you go.
  const chunkRefs = useRef(new Map<number, HTMLDivElement>());
  useLayoutEffect(() => {
    let changed = false;
    chunkRefs.current.forEach((el, i) => {
      const h = el.offsetHeight;
      if (h > 0 && Math.abs(h - (heights.current[i] ?? 0)) > 0.5) {
        heights.current[i] = h;
        changed = true;
      }
      measured.current[i] = true;
    });
    if (changed) setLayoutVersion((v) => v + 1);
  });

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
    offset.current = Math.min(maxOffset(), Math.max(0, sectionTop(index)));
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
  const ambientColors = useAmbientColors(prefs?.ambient, true);
  const t = tops();
  const [first, last] = range;
  const lastIndex = Math.min(last, chunks.length - 1);
  const textStyle: CSSProperties = {
    fontFamily: `"${prefs?.fontFamily ?? "Segoe UI Variable Display"}", var(--ol-font)`,
    fontSize: size,
    lineHeight,
    color,
    paddingTop: t[Math.min(first, chunks.length)] ?? eyeLine,
    paddingBottom: Math.max(0, (t[t.length - 1] ?? 0) - (t[lastIndex + 1] ?? 0)) + height,
  };
  void layoutVersion;

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
    <div className={styles.prompter} style={{ width: width + 40 }}>
      {prefs?.ambient && <AmbientLayer settings={prefs.ambient} colors={ambientColors} textColor={color} />}

      {/* Toolbar layer: always above the text and always clickable. */}
      <div className={styles.header}>
        <span className={protectedNow ? styles.protected : styles.exposed}>
          <LockIcon size={12} />
          {protectedNow ? "Hidden from screen share" : "Visible in screen share"}
        </span>
        <span className={styles.meta}>
          {waiting && <span className={styles.waitDot} role="img" aria-label="An agent needs you" />}
          {voiceWanted && (
            <span className={styles.micOn} title="Microphone in use for voice mode. Never recorded." aria-label="Microphone on">
              <MicIcon size={12} color={voiceBroken ? "var(--ol-amber)" : "var(--ol-red)"} />
            </span>
          )}
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
        <div className={styles.readingLine} style={{ top: eyeLine - 2, height: linePx + 4 }} aria-hidden="true" />
        <div className={prefs?.mirror ? styles.mirror : undefined}>
          <div ref={contentRef} className={styles.content} style={textStyle}>
            {chunks.slice(first, lastIndex + 1).map((chunk, k) => {
              const i = first + k;
              return (
                <div
                  key={i}
                  ref={(el) => {
                    if (el) chunkRefs.current.set(i, el);
                    else chunkRefs.current.delete(i);
                  }}
                  className={styles.chunk}
                >
                  {chunk.blocks.map((b, j) =>
                    b.kind === "section" ? (
                      <h3 key={j} className={styles.section} style={{ color }}>
                        {b.text}
                      </h3>
                    ) : (
                      <p key={j} className={styles.para}>
                        {renderInline(b.text)}
                      </p>
                    ),
                  )}
                </div>
              );
            })}
            {blocks.length === 0 && <p className={styles.para}>This script is empty.</p>}
          </div>
        </div>

        {voiceBroken && (
          <div className={styles.micAlert} role="alert">
            <MicIcon size={16} color="var(--ol-amber)" />
            <div>
              <strong>
                {voiceState === "blocked"
                  ? "Microphone blocked"
                  : voiceState === "silent"
                    ? "No sound from the microphone"
                    : "Microphone unavailable"}
              </strong>
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
        <button type="button" className={styles.round} aria-label={hardPaused ? "Play" : "Pause"} title="Play / pause" onClick={togglePause}>
          {hardPaused ? <PlayIcon size={12} /> : <PauseIcon size={12} />}
        </button>
        <div className={styles.stepper} role="group" aria-label="Speed">
          <button type="button" aria-label="Slower" title="Slower" onClick={() => handle("slower")}>
            −
          </button>
          <span>Speed</span>
          <button type="button" aria-label="Faster" title="Faster" onClick={() => handle("faster")}>
            +
          </button>
        </div>
        <div className={styles.stepper} role="group" aria-label="Text size">
          <button type="button" aria-label="Smaller text" title="Smaller text" onClick={() => handle("smaller")}>
            A−
          </button>
          <button type="button" aria-label="Bigger text" title="Bigger text" onClick={() => handle("bigger")}>
            A+
          </button>
        </div>
        <div className={styles.sections}>
          {sections.map((s, i) => (
            <button
              key={s.index}
              type="button"
              className={i === current ? styles.sectionOn : styles.sectionChip}
              aria-current={i === current ? "step" : undefined}
              ref={(el) => {
                if (el && i === current) el.scrollIntoView({ block: "nearest", inline: "nearest" });
              }}
              onClick={() => jumpTo(i)}
            >
              {s.text}
            </button>
          ))}
        </div>
        <button type="button" className={`${styles.round} ${styles.stop}`} aria-label="Stop teleprompter" title="Stop (Esc)" onClick={stop}>
          ✕
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
  const scale = useSystem((s) => s.settings?.general.uiScale ?? 1);
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
    // Pointer moves in screen px; the island is drawn at --ui-scale.
    const dx = (e.clientX - d.x) / scale;
    // A centred island grows on both sides, so each side moves half as far.
    const factor = position === "center" ? 2 : 1;
    let w = d.w;
    if (d.edge === "right") w = d.w + dx * factor;
    if (d.edge === "left") w = d.w - dx * factor;
    const h = d.edge === "bottom" ? d.h + (e.clientY - d.y) / scale : d.h;
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
