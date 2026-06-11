import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import { IconSprite } from "./components/Icons";
import "./styles.css";

const base = (import.meta.env.BASE_URL ?? "/").replace(/\/$/, "");

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <BrowserRouter basename={base}>
      <IconSprite />
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
