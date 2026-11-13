import type { CSSProperties, ReactNode } from "react";

import { useMedia } from "../../stores/media";
import { Clock } from "./Clock";
import styles from "./CompactBar.module.css";

/**
 * The collapsed pill's content. At most two indicators, by priority:
 * Pomodoro › Claude session › media › clock. The centre stays empty so
 * nothing sits under the webcam.
 */
export function CompactBar() {
  const media = useMedia((s) => s.media);
  const accent = useMedia((s) => s.accent);

  const slots: ReactNode[] = [];

  const showMedia = media?.playing ?? false;
  if (showMedia && slots.length === 0) {
    // Media alone gets both ends: art on the left, live bars on the right.
    return (
      <div className={styles.bar} style={{ "--accent": accent } as CSSProperties}>
        <MediaArt art={media?.art ?? null} />
        <Bars playing />
      </div>
    );
  }

  if (slots.length === 0) {
    return (
      <div className={styles.center}>
        <Clock className={styles.clock} />
      </div>
    );
  }

  return (
    <div className={styles.bar} style={{ "--accent": accent } as CSSProperties}>
      {slots[0]}
      {slots[1] ?? <Clock className={styles.clock} />}
    </div>
  );
}

export function MediaArt({ art }: { art: string | null }) {
  return art ? (
    <img className={styles.art} src={art} alt="" />
  ) : (
    <span className={styles.art} style={{ background: "var(--accent)" }} />
  );
}

export function Bars({ playing }: { playing: boolean }) {
  return (
    <span className={playing ? `${styles.bars} ${styles.playing}` : styles.bars} aria-hidden="true">
      <span />
      <span />
      <span />
      <span />
    </span>
  );
}
