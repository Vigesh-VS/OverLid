// Subscribes the island window to every Rust event once and feeds the stores.

import { commands, inTauri, on } from "../lib/ipc";
import { chime } from "../lib/sound";
import { useIsland } from "./island";
import { useMedia } from "./media";
import { useSystem } from "./system";

let started = false;

function ignore(): undefined {
  return undefined;
}

export function startBridge(): void {
  if (started || !inTauri) return;
  started = true;

  const island = useIsland.getState();
  const system = useSystem.getState();

  void on("island://hover", (hovered) => useIsland.getState().setHovered(hovered));
  void on("island://state", (flags) => island.setFlags(flags));
  void on("island://peek", (peek) => {
    useIsland.getState().pushPeek(peek);
    if (peek.sound) chime(peek.kind === "agentWaiting" ? "attention" : "done");
  });
  void on("media://update", (media) => useMedia.getState().setMedia(media));
  void on("settings://changed", (settings) => system.setSettings(settings));
  void on("system://tick", (tick) => system.setTick(tick));
  void on("system://keys", (keys) => system.setKeys(keys));

  commands.mediaGet().then((m) => useMedia.getState().setMedia(m), ignore);
  commands.islandFlags().then(island.setFlags, ignore);
  commands.settingsGet().then(system.setSettings, ignore);
  commands.systemGet().then(system.setTick, ignore);
}
