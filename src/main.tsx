import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";
import { replaceLegacyHashRoute } from "./lib/legacy-route";
import { applyLightAppearance } from "./app/lib/datetime";

// Repair old shared links such as `/overview#/find` before BrowserRouter
// reads the location, so every page opens at its clean canonical path.
replaceLegacyHashRoute();
// Zybble is permanently light mode; pin it before first paint so the OS
// color-scheme preference can never flash or switch the theme.
applyLightAppearance();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
