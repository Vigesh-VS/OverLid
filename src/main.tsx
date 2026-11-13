import React from "react";
import ReactDOM from "react-dom/client";

import "./styles/global.css";
import { AttentionDot } from "./island/AttentionDot";
import { Island } from "./island/Island";
import { SettingsApp } from "./settings/SettingsApp";
import { startBridge } from "./stores/bridge";

type WindowKind = "island" | "settings" | "dot";
const param = new URLSearchParams(window.location.search).get("window");
const kind: WindowKind = param === "settings" || param === "dot" ? param : "island";
document.documentElement.dataset.window = kind;

/** Fields where selecting, copying and the native menu still make sense. */
function isEditable(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el?.closest?.("input, textarea, [contenteditable='true'], .selectable");
}

// No WebView right-click menu or native drags on UI chrome.
document.addEventListener("contextmenu", (e) => {
  if (!isEditable(e.target)) e.preventDefault();
});
document.addEventListener("dragstart", (e) => {
  if (!isEditable(e.target)) e.preventDefault();
});

if (kind === "island") startBridge();

const root = document.getElementById("root");
if (root) {
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      {kind === "settings" ? <SettingsApp /> : kind === "dot" ? <AttentionDot /> : <Island />}
    </React.StrictMode>,
  );
}
