import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion, type Transition } from "framer-motion";

import { commands, inTauri } from "../lib/ipc";
import { useIsland } from "../stores/island";
import { readIslandTokens } from "../styles/tokens";
import { CompactBar } from "./compact/CompactBar";
import { ExpandedShell } from "./panels/ExpandedShell";
import styles from "./Island.module.css";

const fadeOut: Transition = { duration: 0.08 };
const fadeIn: Transition = { duration: 0.16, delay: 0.08 };

export function Island() {
  const [tokens] = useState(readIslandTokens);
  const reduceMotion = useReducedMotion();
  const { mode, hovered, panel, setMode, setHovered } = useIsland();
  const expanded = mode === "expanded";
  const shape = expanded
    ? { ...tokens.expanded, height: tokens.expanded.heights[panel] }
    : tokens.pill;

  const spring: Transition = reduceMotion
    ? { duration: 0 }
    : { type: "spring", stiffness: tokens.spring.stiffness, damping: tokens.spring.damping };

  // Hover intent: expand after a short hover, collapse after the cursor has been gone a while.
  useEffect(() => {
    if (hovered && !expanded) {
      const id = window.setTimeout(() => setMode("expanded"), tokens.hoverInMs);
      return () => window.clearTimeout(id);
    }
    if (!hovered && expanded) {
      const id = window.setTimeout(() => setMode("collapsed"), tokens.hoverOutMs);
      return () => window.clearTimeout(id);
    }
  }, [hovered, expanded, setMode, tokens]);

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
      >
        <Ear side="left" size={shape.ear} transition={spring} />
        <Ear side="right" size={shape.ear} transition={spring} />

        <div className={styles.clip}>
          <AnimatePresence initial={false}>
            {expanded ? (
              <motion.div
                key="expanded"
                className={styles.expanded}
                style={{ height: shape.height }}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1, transition: fadeIn }}
                exit={{ opacity: 0, transition: fadeOut }}
              >
                <ExpandedShell />
              </motion.div>
            ) : (
              <motion.div
                key="compact"
                className={styles.compact}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1, transition: fadeIn }}
                exit={{ opacity: 0, transition: fadeOut }}
              >
                <CompactBar />
              </motion.div>
            )}
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
