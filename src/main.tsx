import React from "react";
import ReactDOM from "react-dom/client";

import "./styles/global.css";
import { Island } from "./island/Island";
import { SettingsApp } from "./settings/SettingsApp";
import { startBridge } from "./stores/bridge";

const isSettings = new URLSearchParams(window.location.search).get("window") === "settings";
document.documentElement.dataset.window = isSettings ? "settings" : "island";

if (!isSettings) startBridge();

const root = document.getElementById("root");
if (root) {
  ReactDOM.createRoot(root).render(
    <React.StrictMode>{isSettings ? <SettingsApp /> : <Island />}</React.StrictMode>,
  );
}
