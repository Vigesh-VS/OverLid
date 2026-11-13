import type { CSSProperties, MouseEvent } from "react";

import { NextIcon, PauseIcon, PlayIcon, PreviousIcon } from "../../components/icons";
import { withAlpha } from "../../lib/color";
import { formatTrackTime } from "../../lib/format";
import { commands, run } from "../../lib/ipc";
import { useMedia, useMediaPosition } from "../../stores/media";
import styles from "./MediaPanel.module.css";

export function MediaPanel() {
  const media = useMedia((s) => s.media);
  const accent = useMedia((s) => s.accent);
  const position = useMediaPosition(media);

  if (!media) {
    return (
      <div className={styles.empty}>
        <p className={styles.emptyTitle}>Nothing playing</p>
        <p className={styles.emptyHint}>
          Play something in Spotify, a browser or any app that shows Windows media controls.
        </p>
      </div>
    );
  }

  const progress = media.durationMs > 0 ? position / media.durationMs : 0;
  const multi = media.sessionCount > 1;
  const vars = { "--accent": accent, "--accent-glow": withAlpha(accent, 0.4) } as CSSProperties;

  const seek = (e: MouseEvent<HTMLButtonElement>) => {
    if (media.durationMs <= 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const fraction = (e.clientX - rect.left) / rect.width;
    run(commands.mediaSeek(fraction * media.durationMs), "media_seek");
  };

  return (
    <div className={styles.panel} style={vars}>
      <button
        type="button"
        className={styles.art}
        aria-label={multi ? "Album art, switch to the next player" : "Album art"}
        onClick={() => multi && run(commands.mediaCycleSession(), "media_cycle_session")}
      >
        {media.art ? <img src={media.art} alt="" /> : <span className={styles.artFallback} />}
      </button>

      <div className={styles.details}>
        <div className={styles.meta}>
          <div className={styles.sourceRow}>
            <span className={styles.chip}>{media.sourceApp || "Media"}</span>
            {multi && (
              <span className={styles.hint}>
                {media.sessionIndex + 1} of {media.sessionCount} players, click the art to switch
              </span>
            )}
          </div>
          <span className={styles.title}>{media.title || "Unknown title"}</span>
          <span className={styles.artist}>
            {[media.artist, media.album].filter(Boolean).join(" · ") || media.sourceApp}
          </span>
        </div>

        {media.durationMs > 0 && (
          <div className={styles.timeline}>
            <button type="button" className={styles.track} aria-label="Seek" onClick={seek}>
              <span className={styles.fill} style={{ width: `${progress * 100}%` }} />
            </button>
            <div className={styles.times}>
              <span>{formatTrackTime(position)}</span>
              <span>-{formatTrackTime(media.durationMs - position)}</span>
            </div>
          </div>
        )}

        <div className={styles.controls}>
          <button
            type="button"
            className={styles.skip}
            aria-label="Previous"
            onClick={() => run(commands.mediaPrevious(), "media_previous")}
          >
            <PreviousIcon />
          </button>
          <button
            type="button"
            className={styles.play}
            aria-label={media.playing ? "Pause" : "Play"}
            onClick={() => run(commands.mediaPlayPause(), "media_play_pause")}
          >
            {media.playing ? <PauseIcon /> : <PlayIcon />}
          </button>
          <button
            type="button"
            className={styles.skip}
            aria-label="Next"
            onClick={() => run(commands.mediaNext(), "media_next")}
          >
            <NextIcon />
          </button>
        </div>
      </div>
    </div>
  );
}
