import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import UpdaterWindow from "./views/UpdaterWindow";
import { CardWatchProvider } from "./lib/cardWatch";
import "./index.css";

// The same bundle serves both windows; the "updater" window renders the
// standalone software-update UI instead of the full app shell.
function currentLabel(): string {
  try {
    // Read synchronously from Tauri internals; no IPC, no permission needed.
    const internals = (window as unknown as {
      __TAURI_INTERNALS__?: { metadata?: { currentWindow?: { label?: string } } };
    }).__TAURI_INTERNALS__;
    return internals?.metadata?.currentWindow?.label ?? "main";
  } catch {
    return "main";
  }
}

const isUpdater = currentLabel() === "updater";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {isUpdater ? (
      <UpdaterWindow />
    ) : (
      <CardWatchProvider>
        <App />
      </CardWatchProvider>
    )}
  </React.StrictMode>,
);
