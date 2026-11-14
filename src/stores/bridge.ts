// Subscribes the island window to every Rust event once and feeds the stores.

import { commands, inTauri, on } from "../lib/ipc";
import { useAmbientColor } from "../components/AmbientLayer";
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
    if (!peek.sound || usePrompter.getState().status !== "idle") return;
    if (peek.kind === "agentWaiting") {
      if (useSystem.getState().settings?.code.waitingChime !== "off") chime("attention");
    } else {
      chime("done");
    }
  });
  void on("media://update", (media) => useMedia.getState().setMedia(media));
  void on("settings://changed", (settings) => {
    system.setSettings(settings);
    loadProviders();
  });
  void on("system://tick", (tick) => system.setTick(tick));
  void on("system://keys", (keys) => system.setKeys(keys));
  void on("pomo://tick", (state) => usePomodoro.getState().setState(state));
  void on("code://usage", (usage) => useCode.getState().setUsage(usage));
  void on("code://session", (sessions) => useCode.getState().setSessions(sessions));
  void on("prompter://command", (action) => usePrompter.getState().handle(action));
  void on("prompter://scripts", () => loadScripts());
  void on("prompter://start", (scriptId) => {
    const known = usePrompter.getState().scripts.find((x) => x.id === scriptId);
    if (known || !scriptId) {
      usePrompter.getState().start(known);
      return;
    }
    // A just-imported script: reload the list first.
    commands.scriptsList().then((list) => {
      usePrompter.getState().setScripts(list);
      usePrompter.getState().start(list.find((x) => x.id === scriptId));
    }, ignore);
  });
  void on("voice://level", (v) => {
    if (v.owner !== "prompter") return;
    voiceLevel.level = v.level;
    voiceLevel.at = performance.now();
  });
  void on("voice://status", (status) => usePrompter.getState().setVoiceStatus(status));
  void on("ambient://color", (hex) => useAmbientColor.getState().set(hex));

  commands.mediaGet().then((m) => useMedia.getState().setMedia(m), ignore);
  commands.islandFlags().then(island.setFlags, ignore);
  commands.settingsGet().then(system.setSettings, ignore);
  commands.systemGet().then(system.setTick, ignore);
  commands.codeUsage().then((u) => useCode.getState().setUsage(u), ignore);
  loadProviders();
  commands.codeSessions().then((s) => useCode.getState().setSessions(s), ignore);
  commands.codeHookStatus().then((h) => useCode.getState().setHooks(h), ignore);
  loadScripts();
  loadPomodoro();
}

function loadScripts(): void {
  commands.scriptsList().then((s) => usePrompter.getState().setScripts(s), ignore);
}

/** "Every 2 min": keep reminding while an agent is still waiting. */
const REMIND_MS = 2 * 60 * 1000;
let reminder: number | undefined;
useCode.subscribe((state, prev) => {
  if (state.attention?.id === prev.attention?.id && !!state.attention === !!prev.attention) return;
  window.clearInterval(reminder);
  if (!state.attention) return;
  reminder = window.setInterval(() => {
    const repeat = useSystem.getState().settings?.code.waitingChime === "every2Min";
    if (repeat && useCode.getState().attention && usePrompter.getState().status === "idle") chime("attention");
  }, REMIND_MS);
});

function loadProviders(): void {
  commands.codeProviders().then((p) => useCode.getState().setProviders(p), ignore);
}

/**
 * The timer only broadcasts while running, so an idle timer must be read
 * once. Retry until Rust has it ready rather than staying on "Starting…".
 */
function loadPomodoro(attempt = 0): void {
  commands.pomoGet().then(
    (p) => {
      if (p) usePomodoro.getState().setState(p);
      else if (attempt < 20) window.setTimeout(() => loadPomodoro(attempt + 1), 250);
    },
    () => attempt < 20 && window.setTimeout(() => loadPomodoro(attempt + 1), 250),
  );
}
