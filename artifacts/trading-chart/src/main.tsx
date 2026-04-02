import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// Suppress the "ResizeObserver loop limit exceeded" / "ResizeObserver loop
// completed with undelivered notifications" errors that Chrome fires when a
// ResizeObserver callback triggers a layout change (e.g. chart.applyOptions).
// These are harmless — the browser still delivers all notifications on the
// next frame — but they appear as "(unknown runtime error)" because Chrome
// sets event.error = null, which makes Vite's overlay report a crash.
window.addEventListener("error", (event) => {
  if (
    event.message?.includes("ResizeObserver loop") ||
    event.message?.includes("ResizeObserver loop limit") ||
    event.message?.includes("undelivered notifications")
  ) {
    event.stopImmediatePropagation();
    event.preventDefault();
  }
});

createRoot(document.getElementById("root")!).render(<App />);
