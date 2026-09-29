import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";
import { replaceLegacyHashRoute } from "./lib/legacy-route";

// Repair old shared links such as `/overview#/find` before BrowserRouter
// reads the location, so every page opens at its clean canonical path.
replaceLegacyHashRoute();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
