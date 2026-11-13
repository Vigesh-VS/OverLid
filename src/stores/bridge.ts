// Subscribes the island window to every Rust event once and feeds the stores.

import { commands, inTauri, on } from "../lib/ipc";
import { useIsland } from "./island";
import { useMedia } from "./media";

let started = false;

export function startBridge(): void {
  if (started || !inTauri) return;
  started = true;

  void on("island://hover", (hovered) => useIsland.getState().setHovered(hovered));
  void on("media://update", (media) => useMedia.getState().setMedia(media));

  commands
    .mediaGet()
    .then((media) => useMedia.getState().setMedia(media))
    .catch(() => undefined);
}
