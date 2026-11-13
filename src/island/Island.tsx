import { useEffect, useState, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion, type Transition } from "framer-motion";

import { commands, inTauri } from "../lib/ipc";
import type { PeekKind } from "../lib/ipc";
import { useIsland, type PanelId } from "../stores/island";
import { readIslandTokens, type Shape } from "../styles/tokens";
import { CompactBar } from "./compact/CompactBar";
import { ExpandedShell } from "./panels/ExpandedShell";
import { PeekView } from "./peek/PeekView";
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

const fadeOut: Transition = { duration: 0.08 };
const fadeIn: Transition = { duration: 0.16, delay: 0.08 };

export function Island() {
  const [tokens] = useState(readIslandTokens);
  const reduceMotion = useReducedMotion();
  const { mode, hovered, panel, peek, setMode, setPanel, setHovered, nextPeek, clearPeeks } =
    useIsland();
  const expanded = mode === "expanded";

  let view: "compact" | "peek" | "expanded" = "compact";
  let shape: Shape = tokens.pill;
  let content: ReactNode = <CompactBar />;
  let key = "compact";

  if (expanded) {
    view = "expanded";
    shape = { ...tokens.expanded, height: tokens.expanded.heights[panel] };
    content = <ExpandedShell />;
    key = "expanded";
  } else if (peek) {
    view = "peek";
    shape = peek.subtitle ? tokens.peek.tall : tokens.peek.short;
    content = <PeekView peek={peek} />;
    key = `peek-${peek.kind}-${peek.title}-${peek.badge ?? ""}`;
  }

  const spring: Transition = reduceMotion
    ? { duration: 0 }
    : { type: "spring", stiffness: tokens.spring.stiffness, damping: tokens.spring.damping };

  // Hover intent: expand after a short hover, collapse after the cursor has been gone a while.
  useEffect(() => {
    if (hovered && !expanded) {
      const id = window.setTimeout(() => {
        const current = useIsland.getState().peek;
        const target = current && panelForPeek(current.kind);
        if (target) setPanel(target);
        setMode("expanded");
      }, tokens.hoverInMs);
      return () => window.clearTimeout(id);
    }
    if (!hovered && expanded) {
      const id = window.setTimeout(() => setMode("collapsed"), tokens.hoverOutMs);
      return () => window.clearTimeout(id);
    }
  }, [hovered, expanded, setMode, setPanel, tokens]);

  // Opening the island supersedes any pending peeks.
  useEffect(() => {
    if (expanded) clearPeeks();
  }, [expanded, clearPeeks]);

  // Each peek stays for a few seconds, then the next queued one shows.
  useEffect(() => {
    if (!peek || expanded) return;
    const ms = peek.kind === "agentWaiting" ? 4500 : 3000;
    const id = window.setTimeout(nextPeek, ms);
    return () => window.clearTimeout(id);
  }, [peek, expanded, nextPeek]);

  // Report the target shape up front, so the cursor stays "inside" while the island grows.
  useEffect(() => {
    if (!inTauri) return;
    const report = () => {
      commands
        .setHitRect({
          x: (window.innerWidth - shape.width) / 2,
          y: 0,
          width: shape.width,
          height: shape.height,
        })
        .catch((e: unknown) => console.error("set_hit_rect failed", e));
    };
    report();
    window.addEventListener("resize", report);
    return () => window.removeEventListener("resize", report);
  }, [shape.width, shape.height]);

  return (
    <div className={styles.stage}>
      <motion.div
        className={styles.island}
        initial={false}
        animate={{
          width: shape.width,
          height: shape.height,
          borderBottomLeftRadius: shape.radius,
          borderBottomRightRadius: shape.radius,
        }}
        transition={spring}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        data-view={view}
      >
        <Ear side="left" size={shape.ear} transition={spring} />
        <Ear side="right" size={shape.ear} transition={spring} />

        <div className={styles.clip}>
          <AnimatePresence initial={false}>
            <motion.div
              key={key}
              className={view === "expanded" ? styles.expanded : styles.fill}
              style={view === "expanded" ? { height: shape.height } : undefined}
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
