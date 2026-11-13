// Subscribes the island window to every Rust event once and feeds the stores.

import { commands, inTauri, on } from "../lib/ipc";
import { chime } from "../lib/sound";
import { useCode } from "./code";
import { useIsland } from "./island";
import { useMedia } from "./media";
import { usePomodoro } from "./pomodoro";
import { usePrompter, voiceLevel } from "./prompter";
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
    // Stay quiet while presenting; the peek waits in the queue.
    if (peek.sound && usePrompter.getState().status === "idle") {
      chime(peek.kind === "agentWaiting" ? "attention" : "done");
    }
  });
  void on("media://update", (media) => useMedia.getState().setMedia(media));
  void on("settings://changed", (settings) => system.setSettings(settings));
  void on("system://tick", (tick) => system.setTick(tick));
  void on("system://keys", (keys) => system.setKeys(keys));
  void on("pomo://tick", (state) => usePomodoro.getState().setState(state));
  void on("code://usage", (usage) => useCode.getState().setUsage(usage));
  void on("code://session", (sessions) => useCode.getState().setSessions(sessions));
  void on("prompter://command", (action) => usePrompter.getState().handle(action));
  void on("prompter://scripts", () => loadScripts());
  void on("voice://level", (v) => {
    if (v.owner !== "prompter") return;
    voiceLevel.level = v.level;
    voiceLevel.at = performance.now();
  });
  void on("voice://status", (status) => usePrompter.getState().setVoiceStatus(status));

  commands.mediaGet().then((m) => useMedia.getState().setMedia(m), ignore);
  commands.islandFlags().then(island.setFlags, ignore);
  commands.settingsGet().then(system.setSettings, ignore);
  commands.systemGet().then(system.setTick, ignore);
  commands.codeUsage().then((u) => useCode.getState().setUsage(u), ignore);
  commands.codeSessions().then((s) => useCode.getState().setSessions(s), ignore);
  commands.codeHookStatus().then((h) => useCode.getState().setHooks(h), ignore);
  loadScripts();
  commands.pomoGet().then((p) => p && usePomodoro.getState().setState(p), ignore);
}

function loadScripts(): void {
  commands.scriptsList().then((s) => usePrompter.getState().setScripts(s), ignore);
}
