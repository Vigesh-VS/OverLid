import React from "react";
import ReactDOM from "react-dom/client";

import "./styles/global.css";
import { Island } from "./island/Island";

const root = document.getElementById("root");
if (root) {
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <Island />
    </React.StrictMode>,
  );
}
