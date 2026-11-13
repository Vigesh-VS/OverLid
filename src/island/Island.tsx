import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion, type Transition } from "framer-motion";

import { commands, inTauri, type IslandPosition, type PeekKind } from "../lib/ipc";
import { useIsland, type PanelId } from "../stores/island";
import { usePrompter } from "../stores/prompter";
import { useSystem } from "../stores/system";
import { readIslandTokens, type Shape } from "../styles/tokens";
import { CompactBar, PILL_LAYOUT } from "./compact/CompactBar";
import { LockToast } from "./compact/LockToast";
import { ExpandedShell } from "./panels/ExpandedShell";
import { PeekView } from "./peek/PeekView";
import { Countdown, PrompterView } from "./prompter/PrompterView";
import styles from "./Island.module.css";

/** Hovering a peek opens the panel it's about. */
function panelForPeek(kind: PeekKind): PanelId | null {
  switch (kind) {
    case "agentDone":
    case "agentWaiting":
    case "usage":
    case "quotaBack":
      return "code";
    case "focusDone":
      return "focus";
    case "charging":
    case "onBattery":
    case "lowBattery":
      return "stats";
    default:
      return null;
  }
}

const isLockKey = (kind: PeekKind) => kind === "capsLock" || kind === "numLock";

/** Hovering a clickable pill indicator waits this long, so you can click it. */
const INDICATOR_HOVER_MS = 700;

const fadeOut: Transition = { duration: 0.08 };
const fadeIn: Transition = { duration: 0.16, delay: 0.08 };

export function Island() {
  const [tokens] = useState(readIslandTokens);
  const reduceMotion = useReducedMotion();
  const { mode, hovered, panel, peek, setMode, setPanel, setHovered, nextPeek, clearPeeks } = useIsland();
  const dragging = useIsland((s) => s.dragging);
  const panelHeights = useIsland((s) => s.panelHeights);
  const indicatorsWidth = useIsland((s) => s.indicatorsWidth);
  const overIndicator = useIsland((s) => s.overIndicator);
  const suppressExpand = useIsland((s) => s.suppressExpand);
  const prompter = usePrompter((s) => s.status);
  const area = usePrompter((s) => s.area);
  const settings = useSystem((s) => s.settings);
  const general = settings?.general;
  const prompterPrefs = settings?.prompter;

  const position: IslandPosition = general?.position ?? "center";
  const scale = general?.uiScale ?? 1;
  const closeDelay = general?.closeDelayMs ?? tokens.hoverOutMs;
  const presenting = prompter !== "idle";
  const expanded = mode === "expanded" && !presenting;

  // Collapsed pill: the time is centred, so the pill grows by twice the
  // indicator group's width and the time never moves.
  const pillHeight = general?.pillHeight ?? tokens.pill.height;
  const pillWidth = Math.max(
    PILL_LAYOUT.minWidth,
    PILL_LAYOUT.timeWidth + 2 * (indicatorsWidth > 0 ? indicatorsWidth + PILL_LAYOUT.gap : 0) + 2 * PILL_LAYOUT.padding,
  );
  const pill: Shape = { ...tokens.pill, width: pillWidth, height: pillHeight, radius: pillHeight / 2 };

  let view: "compact" | "lock" | "peek" | "expanded" | "countdown" | "prompter" = "compact";
  let shape: Shape = pill;
  let content: ReactNode = <CompactBar />;
  let key = "compact";

  if (prompter === "presenting") {
    view = "prompter";
    shape = {
      width: (area?.width ?? prompterPrefs?.width ?? 560) + 40,
      height: (area?.height ?? prompterPrefs?.height ?? 200) + tokens.prompterChrome,
      radius: tokens.expanded.radius,
      ear: tokens.expanded.ear,
    };
    content = <PrompterView />;
    key = "prompter";
  } else if (prompter === "countdown") {
    view = "countdown";
    shape = tokens.countdown;
    content = <Countdown />;
    key = "countdown";
  } else if (expanded) {
    view = "expanded";
    shape = {
      width: general?.expandedWidth ?? tokens.expanded.width,
      height: panelHeights[panel] ?? tokens.expanded.heights[panel],
      radius: tokens.expanded.radius,
      ear: tokens.expanded.ear,
    };
    content = <ExpandedShell width={shape.width} />;
    key = "expanded";
  } else if (peek && isLockKey(peek.kind)) {
    // Lock keys stay inside the pill: it just widens to fit the message.
    view = "lock";
    shape = { ...pill, width: Math.max(pill.width, tokens.lock.width) };
    content = <LockToast peek={peek} />;
    key = `lock-${peek.kind}-${peek.badge ?? ""}`;
  } else if (peek) {
    view = "peek";
    shape = peek.subtitle ? tokens.peek.tall : tokens.peek.short;
    content = <PeekView peek={peek} />;
    key = `peek-${peek.kind}-${peek.title}-${peek.badge ?? ""}`;
  }

  const spring: Transition = reduceMotion
    ? { duration: 0 }
    : { type: "spring", stiffness: tokens.spring.stiffness, damping: tokens.spring.damping };

  // Hover intent: expand after a short hover, collapse after the close delay.
  useEffect(() => {
    if (presenting) return;
    if (hovered && !expanded && !suppressExpand) {
      const delay = overIndicator ? INDICATOR_HOVER_MS : tokens.hoverInMs;
      const id = window.setTimeout(() => {
        const current = useIsland.getState().peek;
        const target = current && panelForPeek(current.kind);
        if (target) setPanel(target);
        setMode("expanded");
      }, delay);
      return () => window.clearTimeout(id);
    }
    if (!hovered && expanded) {
      const id = window.setTimeout(() => setMode("collapsed"), closeDelay);
      return () => window.clearTimeout(id);
    }
  }, [hovered, expanded, presenting, overIndicator, suppressExpand, closeDelay, setMode, setPanel, tokens]);

  // Starting the prompter closes the expanded island.
  useEffect(() => {
    if (presenting) setMode("collapsed");
  }, [presenting, setMode]);

  // Opening the island supersedes any pending peeks.
  useEffect(() => {
    if (expanded) clearPeeks();
  }, [expanded, clearPeeks]);

  // Each peek stays briefly, then the next queued one shows. Lock keys are a
  // quick ~1 s blip.
  useEffect(() => {
    // While presenting, peeks wait in the queue until the prompter stops.
    if (!peek || expanded || presenting) return;
    const ms = isLockKey(peek.kind) ? tokens.lock.ms : peek.kind === "agentWaiting" ? 4500 : 3000;
    const id = window.setTimeout(nextPeek, ms);
    return () => window.clearTimeout(id);
  }, [peek, expanded, presenting, nextPeek, tokens]);

  // Report the target shape up front, so the cursor stays "inside" while the
  // island grows. Sizes are scaled by --ui-scale.
  useEffect(() => {
    if (!inTauri) return;
    const report = () => {
      const w = shape.width * scale;
      const h = shape.height * scale;
      const x = position === "left" ? 0 : position === "right" ? window.innerWidth - w : (window.innerWidth - w) / 2;
      // While resizing, the whole window takes the cursor so the drag can't fall through.
      const rect = dragging
        ? { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight }
        : { x, y: 0, width: w, height: h };
      commands.setHitRect(rect).catch((e: unknown) => console.error("set_hit_rect failed", e));
    };
    report();
    window.addEventListener("resize", report);
    return () => window.removeEventListener("resize", report);
  }, [shape.width, shape.height, dragging, position, scale]);

  // Corners: in a screen corner the edge side is square and only the inner
  // side curves.
  const left = position === "left" ? 0 : shape.radius;
  const right = position === "right" ? 0 : shape.radius;

  return (
    <div className={styles.stage} data-position={position} style={{ "--ui-scale": scale } as CSSProperties}>
      <motion.div
        className={styles.island}
        initial={false}
        animate={{
          width: shape.width,
          height: shape.height,
          borderBottomLeftRadius: left,
          borderBottomRightRadius: right,
        }}
        transition={spring}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        data-view={view}
      >
        {position !== "left" && <Ear side="left" size={shape.ear} transition={spring} />}
        {position !== "right" && <Ear side="right" size={shape.ear} transition={spring} />}

        <div className={styles.clip}>
          <AnimatePresence initial={false}>
            <motion.div
              key={key}
              className={view === "expanded" ? styles.expanded : styles.fill}
              data-align={position}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1, transition: fadeIn }}
              exit={{ opacity: 0, transition: fadeOut }}
            >
              {content}
            </motion.div>
          </AnimatePresence>
        </div>
      </motion.div>
    </div>
  );
}

/** Concave fillet joining the island to the screen's top edge. */
function Ear({
  side,
  size,
  transition,
}: {
  side: "left" | "right";
  size: number;
  transition: Transition;
}) {
  const path = side === "left" ? "M0 0 H1 V1 A1 1 0 0 0 0 0 Z" : "M1 0 H0 V1 A1 1 0 0 1 1 0 Z";
  return (
    <motion.svg
      aria-hidden="true"
      className={side === "left" ? styles.earLeft : styles.earRight}
      viewBox="0 0 1 1"
      preserveAspectRatio="none"
      initial={false}
      animate={{ width: size, height: size }}
      transition={transition}
    >
      <path d={path} fill="var(--ol-black)" />
    </motion.svg>
  );
}
